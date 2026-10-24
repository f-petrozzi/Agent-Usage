"""Shared cache ownership, provider failures and native reader lifecycle."""
import concurrent.futures
import copy
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import agent_usage_service as shared
loader = importlib.machinery.SourceFileLoader('usage', str(ROOT / 'scripts/agent-usage'))
spec = importlib.util.spec_from_loader(loader.name, loader)
usage = importlib.util.module_from_spec(spec)
loader.exec_module(usage)


FIXTURE_TIME = int(time.time())

def native(percent=25, balance='12.123456', **extra):
    return {'rateLimits': {'primary': {'usedPercent': percent, 'resetsAt': FIXTURE_TIME + 3600, 'windowDurationMins': 300},
                           'secondary': {'usedPercent': 50, 'resetsAt': FIXTURE_TIME + 700000, 'windowDurationMins': 10080},
                           'credits': {'balance': balance}, **extra}}


def measured(ident):
    return {'id': ident, 'provider': ident, 'label': ident, 'limits': [
        {'usedPercent': 10, 'resetsAt': int(time.time()) + 3600, 'windowMins': 300}], 'sampledAt': time.time()}


class SharedTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.service = shared.UsageService(usage, [('a', self.root/'profile')], root=self.root)
        self.service.queries = {'codex:a': lambda: native(), 'claude': lambda: measured('claude'),
                                'antigravity': lambda: measured('antigravity')}
    def tearDown(self):
        for reader in self.service.readers.values(): reader.close()
        self.temp.cleanup()
    def seed(self):
        for ident in self.service.queries: self.service.poll(ident)
    def test_all_providers_share_one_cache_and_reads_never_poll(self):
        calls = dict.fromkeys(self.service.queries, 0)
        for ident, query in list(self.service.queries.items()):
            def read(ident=ident, query=query):
                calls[ident] += 1
                return query()
            self.service.queries[ident] = read
        self.seed()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            docs = list(pool.map(lambda _: shared.read_snapshot(self.root/'shared.json'), range(40)))
        self.assertEqual(calls, dict.fromkeys(calls, 1))
        self.assertEqual([r['provider'] for r in docs[0]['accounts']], ['codex', 'claude', 'antigravity'])
        self.assertTrue(all(d['accounts'] == docs[0]['accounts'] for d in docs))
        self.assertNotIn('_native', docs[0]['accounts'][0])
        self.assertEqual(self.root.joinpath('shared.json').stat().st_mode & 0o777, 0o600)
    def test_failure_preserves_reading_time_and_backs_off(self):
        self.seed()
        original = copy.deepcopy(self.service.rows['codex:a'])
        self.service.queries['codex:a'] = lambda: (_ for _ in ()).throw(OSError('unavailable'))
        self.service.poll('codex:a')
        row = self.service.rows['codex:a']
        self.assertEqual(row['limits'], original['limits'])
        self.assertEqual(row['sampledAt'], original['sampledAt'])
        self.assertTrue(row['stale'])
        self.assertEqual(self.service.failures['codex:a'], 1)
        self.service.poll('codex:a')
        self.assertGreater(self.service.due['codex:a'] - time.monotonic(), 119)
        self.assertFalse(self.service.rows['antigravity']['stale'])
    def test_rate_limit_retry_after_is_respected(self):
        retry = time.time()+1800
        self.service.queries['claude'] = lambda: {**measured('claude'), 'warning': '429', 'retryAt': retry}
        self.service.poll('claude')
        self.assertGreater(self.service.due['claude'] - time.monotonic(), 1799)
    def test_delayed_poll_cannot_overwrite_push(self):
        self.seed()
        def query():
            self.service.publish({'account': 'codex:a', 'sampledAt': time.time(), 'result': native(80)})
            return native(20)
        self.service.queries['codex:a'] = query
        exposed = []
        save = self.service.save
        def observe_save():
            save()
            doc = shared.read_snapshot(self.root/'shared.json')
            exposed.append(doc['accounts'][0]['limits'][0]['usedPercent'])
        with patch.object(self.service, 'save', side_effect=observe_save):
            self.service.poll('codex:a')
        self.assertNotIn(20, exposed, 'A concurrent reader must never see the lower intermediate poll value')
        self.assertEqual(self.service.rows['codex:a']['limits'][0]['usedPercent'], 80)
        stamp = self.service.rows['codex:a']['sampledAt']
        self.assertFalse(self.service.publish({'account': 'codex:a', 'sampledAt': stamp-1, 'result': native(10)})['accepted'])
    def push(self, value):
        return self.service.publish({'account':'codex:a','sampledAt':time.time(),'result':value})
    def test_newer_live_reading_can_reset_usage_and_clear_block(self):
        self.service.accept('codex:a', native(96, rateLimitReachedType='rate_limit_reached'))
        self.assertTrue(self.push(native(1, rateLimitReachedType=None))['accepted'])
        row = self.service.rows['codex:a']
        self.assertEqual(row['limits'][0]['usedPercent'], 1)
        self.assertFalse(row['blocked'])
        self.assertEqual(row['source'], 'live')
        self.assertFalse(row['stale'])
    def test_partial_event_keeps_omitted_windows_and_their_time(self):
        self.seed()
        previous = copy.deepcopy(self.service.rows['codex:a'])
        update = native(99)
        update['rateLimits'].pop('secondary')
        update['rateLimits'].pop('credits')
        self.assertTrue(self.push(update)['accepted'])
        row = self.service.rows['codex:a']
        self.assertEqual(row['sampledAt'], previous['sampledAt'])
        self.assertEqual(row['limits'][1], previous['limits'][1])
        self.assertGreater(row['limits'][0]['sampledAt'], previous['sampledAt'])
        self.assertEqual(row['_native']['rateLimits']['credits'], previous['_native']['rateLimits']['credits'])
    def test_live_can_seed_and_recover_a_known_account_but_rejects_old_events(self):
        self.assertTrue(self.push(native(1))['accepted'])
        stamp = self.service.rows['codex:a']['sampledAt']
        self.assertFalse(self.service.publish({'account':'codex:a','sampledAt':stamp-1,'result':native(90)})['accepted'])
        with self.assertRaises(ValueError):
            self.service.publish({'account':'codex:unknown','sampledAt':time.time(),'result':native(1)})
        with self.assertRaises(ValueError):
            self.service.publish({'account':'codex:a','sampledAt':time.time()-121,'result':native(1)})
    def test_new_reset_replaces_window_without_retaining_old_duplicate(self):
        self.seed()
        update = native(1)
        update['rateLimits']['primary']['resetsAt'] += 9000
        self.push(update)
        row = self.service.rows['codex:a']
        self.assertEqual(len(row['limits']), 2)
        self.assertEqual(row['limits'][0]['resetsAt'], update['rateLimits']['primary']['resetsAt'])
        self.assertEqual(row['_native']['rateLimits']['primary'], update['rateLimits']['primary'])
    def test_live_recovers_freshness_without_bypassing_poll_backoff(self):
        self.seed()
        self.service.failed('codex:a','Synthetic failure', time.time()+900)
        due = self.service.due['codex:a']
        self.assertTrue(self.push(native(99))['accepted'])
        self.assertFalse(self.service.rows['codex:a']['stale'])
        self.assertAlmostEqual(self.service.due['codex:a'], due, delta=.01)
        self.assertEqual(self.service.failures['codex:a'], 1)
    def test_live_during_failed_poll_survives_and_endpoint_still_backs_off(self):
        self.seed()
        def query():
            self.push(native(99))
            raise OSError('Unavailable')
        self.service.queries['codex:a'] = query
        self.service.poll('codex:a')
        self.assertFalse(self.service.rows['codex:a']['stale'])
        self.assertEqual(self.service.rows['codex:a']['limits'][0]['usedPercent'], 99)
        self.assertEqual(self.service.failures['codex:a'], 1)
        self.assertGreater(self.service.due['codex:a']-time.monotonic(), 59)
    def test_live_events_defer_idle_polls_until_the_sample_expires(self):
        self.seed()
        self.push(native(40))
        self.assertGreater(self.service.due['codex:a']-time.monotonic(), 119)
        for _ in range(20): self.push(native(1))
        self.assertGreater(self.service.due['codex:a']-time.monotonic(), 119)
    def test_credit_precision_partial_metadata_and_invalid_push(self):
        with self.service.lock:
            initial = native()
            initial['rateLimitResetCredits'] = {'availableCount': 2}
            self.service.accept('codex:a', initial)
            self.service.publish({'account': 'codex:a', 'sampledAt': time.time(), 'result': native(30)})
            self.assertEqual(self.service.rows['codex:a']['resetCredits'], 2)
        row = shared.read_snapshot(self.root/'shared.json', internal=True)['accounts'][0]
        self.assertEqual(row['_native']['rateLimits']['credits']['balance'], '12.123456')
        for value in ({}, {'rateLimits': []}, {'rateLimits': {'primary': []}}, native(float('nan')),
                      {'rateLimits': {'limitId': 'other', 'primary': native()['rateLimits']['primary']}}):
            with self.assertRaises(ValueError):
                self.service.publish({'account': 'codex:a', 'sampledAt': time.time(), 'result': value})
    def test_dead_daemon_expired_windows_and_future_readings_are_stale(self):
        self.seed()
        data = shared.read_snapshot(self.root/'shared.json', now=time.time()+46)
        self.assertTrue(all(r['stale'] for r in data['accounts']))
        data = json.loads((self.root/'shared.json').read_text())
        data['accounts'][0]['limits'][0]['resetsAt'] = time.time()-1
        data['accounts'][1]['sampledAt'] = time.time()+10
        (self.root/'shared.json').write_text(json.dumps(data))
        doc = shared.read_snapshot(self.root/'shared.json')
        self.assertTrue(doc['accounts'][0]['stale'])
        self.assertTrue(doc['accounts'][1]['stale'])
        self.assertFalse(doc['accounts'][2]['stale'])
    def test_restart_preserves_stale_readings_without_inventing_success(self):
        self.seed()
        service = shared.UsageService(usage, [('a', self.root/'profile')], root=self.root)
        service.load()
        self.assertTrue(service.rows['codex:a']['stale'])
        self.assertEqual(service.rows['claude']['sampledAt'], self.service.rows['claude']['sampledAt'])
    def test_cli_reads_cache_and_never_falls_back_when_enabled(self):
        self.seed()
        env = {**os.environ, 'AGENT_USAGE_STATE_DIR': str(self.root), 'CODEX_ACCOUNTS_DIR': str(self.root/'accounts')}
        (self.root/'accounts/profiles/a').mkdir(parents=True)
        result = subprocess.run([sys.executable, str(ROOT/'scripts/agent-usage'), '--shared', '--compact'], env=env,
                                capture_output=True, check=True)
        doc = json.loads(result.stdout)
        self.assertEqual(len(doc['accounts']), 3)
        self.assertEqual(doc['source'], 'shared')
        (self.root/'shared.json').unlink()
        (self.root/'shared.enabled').touch()
        result = subprocess.run([sys.executable, str(ROOT/'scripts/agent-usage'), '--compact'], env=env, capture_output=True, timeout=3)
        self.assertNotEqual(result.returncode, 0)
    def test_socket_accepts_updates_and_second_daemon_is_rejected(self):
        self.seed()
        thread = threading.Thread(target=self.service.run)
        thread.start()
        try:
            deadline = time.monotonic()+3
            while not (self.root/'updates.sock').exists() and time.monotonic()<deadline: time.sleep(.01)
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(2)
                client.connect(str(self.root/'updates.sock'))
                client.sendall(json.dumps({'account':'codex:a','sampledAt':time.time(),'result':native(71)}).encode()+b'\n')
                self.assertTrue(json.loads(client.recv(1024))['accepted'])
            other = shared.UsageService(usage, [], root=self.root)
            with self.assertRaises(BlockingIOError): other.run()
            self.assertEqual((self.root/'updates.sock').stat().st_mode & 0o777, 0o600)
        finally:
            self.service.stop.set()
            thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertFalse((self.root/'updates.sock').exists())
        self.assertTrue(shared.read_snapshot(self.root/'shared.json')['accounts'][0]['stale'])


class ReaderTests(unittest.TestCase):
    def test_reuses_reader_and_restarts_after_disconnect(self):
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            binary = root/'codex'
            count = root/'starts'
            binary.write_text('#!'+sys.executable+'\nimport json,sys\nfrom pathlib import Path\np=Path('+repr(str(count))+')\np.write_text(p.read_text()+"x" if p.exists() else "x")\nfor line in sys.stdin:\n m=json.loads(line)\n if "id" in m:\n  print(json.dumps({"id":m["id"],"result":'+repr(native())+' if m["method"]=="account/rateLimits/read" else {}}),flush=True)\n')
            binary.chmod(0o755)
            adapter = SimpleNamespace(_codex_cli=lambda: str(binary), _codex_env=lambda _: dict(os.environ),
                                      _send=usage._send, _wait_for_response=usage._wait_for_response,
                                      AUTH_STORE_OVERRIDE=usage.AUTH_STORE_OVERRIDE)
            reader = shared.CodexReader(adapter, 'a', root/'profile', 2)
            try:
                reader.read(); reader.read()
                self.assertEqual(count.read_text(), 'x')
                reader.proc.kill(); reader.proc.wait()
                reader.read()
                self.assertEqual(count.read_text(), 'xx')
            finally: reader.close()

if __name__ == '__main__': unittest.main()
