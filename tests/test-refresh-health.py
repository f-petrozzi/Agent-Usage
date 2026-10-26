"""Provider-free regression checks for refresh health, schedules and diagnostics."""
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
import time
import unittest
import urllib.error
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import agent_usage_service as shared

loader = importlib.machinery.SourceFileLoader('usage_refresh', str(ROOT / 'scripts/agent-usage'))
spec = importlib.util.spec_from_loader(loader.name, loader)
usage = importlib.util.module_from_spec(spec)
loader.exec_module(usage)


def reading(provider, used=25):
    return dict(id=provider, provider=provider, label=provider, limits=[
        dict(label='5 hours', usedPercent=used, windowMins=300, resetsAt=time.time() + 3600)])


def http_error(status, retry=None):
    return urllib.error.HTTPError('https://provider.invalid', status, 'private body',
                                  {} if retry is None else {'Retry-After': retry}, None)


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / 'home'
        self.home.mkdir()
        self.env = patch.dict(os.environ, {
            'HOME': str(self.home), 'CLAUDE_CONFIG_DIR': str(self.home / '.claude'),
            'AGENT_USAGE_STATE_DIR': str(self.root), 'AGENT_USAGE_CACHE_DIR': str(self.root / 'cache'),
            'CLAUDE_BIN': str(self.root / 'missing-claude'), 'CODEX_BIN': str(self.root / 'missing-codex')})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.service = shared.UsageService(usage, [], root=self.root)

    def test_classification_of_transport_and_cli_failures(self):
        cases = [(http_error(429, '1234'), 'rate_limited', 429, 1234),
                 (http_error(429), 'rate_limited', 429, None),
                 (http_error(429, '0'), 'rate_limited', 429, 0),
                 (http_error(401), 'auth', 401, None), (http_error(403), 'auth', 403, None),
                 (http_error(503), 'network', 503, None),
                 (subprocess.TimeoutExpired('fake', 1), 'network', None, None),
                 (socket.gaierror('DNS failed'), 'network', None, None),
                 (ConnectionError('reset'), 'network', None, None),
                 (json.JSONDecodeError('bad', '', 0), 'parse', None, None),
                 (FileNotFoundError('fake binary'), 'process', None, None),
                 (PermissionError('cannot start'), 'process', None, None),
                 (RuntimeError('expired credentials'), 'auth', None, None),
                 (RuntimeError('{"code":429}'), 'rate_limited', 429, None),
                 (RuntimeError('unrecognized'), 'unknown', None, None)]
        for error, kind, status, retry in cases:
            with self.subTest(error=type(error).__name__, kind=kind):
                actual = usage.classify_error(error)
                self.assertEqual((actual.kind, actual.http_status), (kind, status))
                if retry is not None:
                    self.assertEqual(actual.retry_after, retry)

    def test_claude_query_raises_typed_errors_and_keeps_http_metadata(self):
        failures = [(http_error(429, '7200'), 'rate_limited'), (http_error(429), 'rate_limited'),
                    (http_error(401), 'auth'), (TimeoutError(), 'network'),
                    (json.JSONDecodeError('bad JSON', '', 0), 'parse')]
        for index, (error, kind) in enumerate(failures):
            with self.subTest(kind=kind), patch.dict(os.environ, {'AGENT_USAGE_CACHE_DIR': str(self.root / str(index))}), \
                    patch.object(usage, '_claude_token', return_value=('fixture-token', 'pro', False)), \
                    patch.object(usage, '_claude_fetch', side_effect=error), \
                    patch.object(usage, '_claude_cli_usage', side_effect=AssertionError('no CLI calls')):
                with self.assertRaises(usage.UsageError) as raised:
                    usage.query_claude(.1, allow_cli=False, strict=True)
                self.assertEqual(raised.exception.kind, kind)
                if index == 0:
                    self.assertEqual(raised.exception.retry_after, 7200)
        with self.assertRaises(usage.UsageError) as raised:
            usage._query_claude_uncached(.1, allow_cli=False)
        self.assertEqual(raised.exception.kind, 'auth')

    def test_fake_agy_binary_parse_timeout_auth_and_missing_process(self):
        binary = self.root / 'agy'
        for body, kind in [('print("bad json")', 'parse'),
                           ('import time; time.sleep(10)', 'network'),
                           ('print(\'{"code":401}\'); sys.exit(1)', 'auth')]:
            binary.write_text('#!' + sys.executable + '\nimport sys\n'
                              'if "--version" in sys.argv: print("1.2.13"); sys.exit()\n' + body + '\n')
            binary.chmod(0o700)
            with self.subTest(kind=kind), patch.object(usage, 'antigravity_executable', return_value=str(binary)):
                with self.assertRaises(usage.UsageError) as raised:
                    usage.query_antigravity(.15, strict=True)
                self.assertEqual(raised.exception.kind, kind)
        with patch.object(usage, 'antigravity_executable', return_value=None):
            with self.assertRaises(usage.UsageError) as raised:
                usage.query_antigravity(.1, strict=True)
        self.assertEqual(raised.exception.kind, 'process')

    def test_schedules_minimums_jitter_and_server_hints(self):
        cases = [('claude', 'rate_limited', [300, 600, 900, 900]),
                 ('claude', 'network', [300] * 4), ('claude', 'auth', [1800] * 4),
                 ('codex', 'network', [60, 120, 300, 300]),
                 ('antigravity', 'network', [300] * 4),
                 ('codex', 'rate_limited', [300, 900, 900, 900]),
                 ('antigravity', 'rate_limited', [300, 900, 900, 900])]
        with patch.object(usage.os, 'urandom', return_value=b'\0\0'):
            for provider, kind, expected in cases:
                for count, delay in enumerate(expected, 1):
                    with self.subTest(provider=provider, kind=kind, count=count):
                        self.assertEqual(usage.retry_delay(provider, kind, count), delay)
                        self.assertEqual(usage.retry_delay(provider, kind, count, 0), delay)
                        self.assertEqual(usage.retry_delay(provider, kind, count, 7200), 7200)
            for provider in shared.MIN_GAP:
                self.assertEqual(usage.retry_delay(provider, 'parse', 1), 3600)
        with patch.object(usage.os, 'urandom', return_value=b'\xff\xff'):
            self.assertEqual([usage.retry_delay('claude', 'rate_limited', i) for i in (1, 2, 3)], [315, 615, 900])

    def test_failure_keeps_measurement_and_freshness_is_recomputed(self):
        self.service.accept('claude', reading('claude'))
        original = copy.deepcopy(self.service.rows['claude'])
        self.service.queries['claude'] = Mock(side_effect=http_error(429, '7200'))
        self.service.poll('claude')
        row = shared.read_snapshot(self.root / 'shared.json')['accounts'][0]
        for field in ('limits', 'sampledAt', 'source', 'origin'):
            self.assertEqual(row[field], original[field])
        self.assertFalse(row['stale'])
        self.assertIsNone(row['error'])
        self.assertEqual(row['refresh']['state'], 'rate_limited')
        self.assertEqual(row['refresh']['successAt'], original['refresh']['successAt'])
        self.assertGreater(row['refresh']['retryAt'] - time.time(), 7199)
        document = json.loads((self.root / 'shared.json').read_text())
        now = time.time() + 601
        document['updatedAt'] = now
        (self.root / 'shared.json').write_text(json.dumps(document))
        self.assertTrue(shared.read_snapshot(self.root / 'shared.json', now=now)['accounts'][0]['stale'])

    def test_live_and_local_sources_reset_failure_health(self):
        for source, origin in [('live', 'claude-runtime'), ('live', 'claude-statusline'), ('poll', 'provider-poll')]:
            self.service.failed('claude', TimeoutError())
            self.service.accept('claude', reading('claude'), source=source, origin=origin)
            row = self.service.rows['claude']
            self.assertEqual(self.service.failures['claude'], 0)
            self.assertEqual(row['refresh']['state'], 'ok')
            self.assertIsNone(row['refresh']['retryAt'])
            self.assertNotIn('warning', row)
        # Exercise the actual rollout scanner too, without a provider process.
        home = self.root / 'profile'
        sessions = home / 'sessions'
        sessions.mkdir(parents=True)
        service = shared.UsageService(usage, [('a', home)], include_claude=False, include_agy=False, root=self.root)
        service.failed('codex:a', TimeoutError())
        event = dict(timestamp=time.time(), type='event_msg', payload=dict(type='token_count', rate_limits=dict(
            limit_id='codex', primary=dict(used_percent=20, window_minutes=300, resets_at=time.time() + 3600))))
        (sessions / 'rollout-fake.jsonl').write_text(json.dumps(event) + '\n')
        service.local.scan()
        self.assertEqual(service.failures['codex:a'], 0)
        self.assertEqual(service.rows['codex:a']['refresh']['state'], 'ok')

    def test_error_classes_have_independent_streaks(self):
        for error in [TimeoutError(), TimeoutError(), usage.UsageError('429', 'rate_limited'), TimeoutError()]:
            self.service.failed('antigravity', error)
        self.assertEqual(self.service.failures['antigravity'], 1)
        self.assertEqual(self.service.rows['antigravity']['refresh']['state'], 'network')

    def test_claude_pause_wakes_on_credentials_or_version_change_but_keeps_gap(self):
        credentials = self.home / '.claude/.credentials.json'
        credentials.parent.mkdir()
        credentials.write_text('{}')
        self.service.rows['claude']['pollAttemptedAt'] = time.time()
        self.service.failed('claude', usage.UsageError('signed out', 'auth'))
        self.assertGreater(self.service.due['claude'] - time.monotonic(), 1799)
        due = self.service.due['claude']
        self.service.wake_changed_claude('claude')
        self.assertEqual(self.service.due['claude'], due)
        os.utime(credentials, ns=(credentials.stat().st_atime_ns, credentials.stat().st_mtime_ns + 1000000))
        self.service.pause_checked['claude'] = 0
        self.service.wake_changed_claude('claude')
        self.assertGreater(self.service.due['claude'] - time.monotonic(), 299)
        self.assertLess(self.service.due['claude'] - time.monotonic(), 301)
        with patch.object(usage, '_claude_cli', return_value=('fake', (2, 1, 1))):
            self.service.failed('claude', usage.UsageError('invalid output', 'parse'))
        self.assertGreater(self.service.due['claude'] - time.monotonic(), 3599)
        self.service.pause_checked['claude'] = 0
        with patch.object(usage, '_claude_cli', return_value=('fake', (2, 1, 2))):
            self.service.wake_changed_claude('claude')
        self.assertGreater(self.service.due['claude'] - time.monotonic(), 299)
        self.assertLess(self.service.due['claude'] - time.monotonic(), 301)

    def test_agy_near_limit_and_completion_checks_cannot_poll_before_five_minutes(self):
        self.service.rows['antigravity']['pollAttemptedAt'] = time.time()
        self.service.accept('antigravity', reading('antigravity', 99))
        self.assertEqual(shared.MIN_GAP['antigravity'], 300)
        for _ in range(10):
            self.service.request_check('antigravity')
            self.assertGreater(self.service.due['antigravity'] - time.monotonic(), 299)

    def test_cooldown_survives_restart_and_repeated_live_recovery(self):
        self.service.failed('claude', http_error(429, '7200'))
        retry = self.service.rows['claude']['pollRetryAt']
        for _ in range(2):
            self.service.accept('claude', reading('claude'), source='live', origin='claude-runtime')
            self.assertEqual(self.service.rows['claude']['pollRetryAt'], retry)
            self.assertEqual(self.service.failures['claude'], 0)
        restored = shared.UsageService(usage, [], root=self.root)
        restored.load()
        self.assertGreater(restored.due['claude'] - time.monotonic(), 7199)
        self.assertEqual(restored.rows['claude']['refresh']['state'], 'ok')

    def test_claude_credential_cache_cooldown_survives_new_query_and_legacy_format(self):
        with patch.object(usage, '_claude_token', return_value=('fixture-token', 'pro', False)), \
                patch.object(usage, '_claude_fetch', side_effect=http_error(429, '7200')) as fetch:
            for _ in range(2):
                with self.assertRaises(usage.UsageError) as raised:
                    usage.query_claude(.1, allow_cli=False, strict=True)
                self.assertGreater(raised.exception.retry_at - time.time(), 7199)
            self.assertEqual(fetch.call_count, 1)
            path = next((self.root / 'cache').glob('claude-*.json'))
            saved = json.loads(path.read_text())
            saved['account'].pop('refresh')
            path.write_text(json.dumps(saved))
            with self.assertRaises(usage.UsageError) as raised:
                usage.query_claude(.1, allow_cli=False, strict=True)
            self.assertEqual(raised.exception.kind, 'rate_limited')
            self.assertGreater(raised.exception.retry_at - time.time(), 7199)
            self.assertEqual(fetch.call_count, 1)

    def test_journal_is_bounded_redacted_and_records_missing_claude_utilization(self):
        self.service.publish(dict(account='claude', sampledAt=time.time(), result=dict(
            five_hour={}, seven_day={}, token='SECRET', transcript='SECRET', cwd='/secret/workspace')))
        self.service.publish(dict(account='claude', sampledAt=time.time(), result=dict(
            five_hour=dict(used_percentage=20, resets_at=time.time() + 3600))))
        events = [json.loads(line) for line in (self.root / 'refresh.jsonl').read_text().splitlines()]
        self.assertFalse(events[0]['five_hour'])
        self.assertFalse(events[0]['seven_day'])
        self.assertTrue(events[1]['five_hour'])
        self.assertFalse(events[1]['seven_day'])
        # Small rotation threshold exercises the same bound without large fixtures.
        failure = usage.classify_error(RuntimeError('HTTP 429 SECRET authorization=SECRET /secret/workspace'))
        with patch.object(shared, 'JOURNAL_BYTES', 512):
            for _ in range(30):
                self.service.journal('claude', 'poll', failure.kind, failure)
        paths = sorted(self.root.glob('refresh.jsonl*'))
        self.assertEqual(len(paths), 2)
        allowed = {'time', 'account', 'source', 'outcome', 'httpStatus', 'retryAfter', 'five_hour', 'seven_day'}
        for path in paths:
            self.assertLessEqual(path.stat().st_size, 512)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            raw = path.read_text()
            for secret in ('SECRET', 'authorization', 'token', 'transcript', '/secret/workspace'):
                self.assertNotIn(secret, raw)
            for line in raw.splitlines():
                self.assertLessEqual(set(json.loads(line)), allowed)


if __name__ == '__main__':
    unittest.main()
