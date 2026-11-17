"""Internal quota checks never become chat activity or completed-turn nudges."""
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from agent_usage_processes import collector_owned
from agent_usage_live import LocalFeeds

loader = importlib.machinery.SourceFileLoader('internal_usage', str(SCRIPTS / 'agent-usage'))
spec = importlib.util.spec_from_loader(loader.name, loader)
usage = importlib.util.module_from_spec(spec)
loader.exec_module(usage)


class InternalClaudeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.proc = self.root / 'proc'
        self.collector = self.root / 'bin/agent-usage'
        self.config = self.root / 'claude'
        (self.config / 'sessions').mkdir(parents=True)

    def process(self, pid, parent, *args):
        path = self.proc / str(pid)
        path.mkdir(parents=True, exist_ok=True)
        (path / 'cmdline').write_bytes(b'\0'.join(os.fsencode(arg) for arg in args) + b'\0')
        (path / 'stat').write_text(f'{pid} (renamed Claude) S {parent} ' + '0 ' * 18)
        (path / 'cwd').symlink_to(self.root, target_is_directory=True)

    def owned(self, pids):
        return collector_owned(pids, [self.collector], self.proc)

    def test_renamed_usage_process_is_recognized_by_its_collector_ancestor(self):
        self.process(101, 100, 'claude')
        self.process(100, 1, '/usr/bin/python3', self.collector, '--serve')
        self.assertTrue(self.owned([101, 100]))

    def test_other_launchers_or_prompt_arguments_do_not_establish_ownership(self):
        for args in (
            ('claude', '-p', str(self.collector)),
            ('/usr/bin/python3', '-c', 'pass', str(self.collector)),
            ('/usr/bin/python3', '/another/bin/agent-usage', '--serve'),
            ('/bin/bash', str(self.collector)),
        ):
            with self.subTest(args=args):
                (self.proc / '101/cwd').unlink(missing_ok=True)
                self.process(101, 1, *args)
                self.assertFalse(self.owned([101]))

    def test_relative_script_path_and_python_flags_are_supported(self):
        self.process(100, 1, '/usr/bin/python3', '-B', '-I', '--', 'bin/agent-usage', '--serve')
        self.assertTrue(self.owned([100]))

    def test_missing_or_oversized_process_metadata_keeps_activity_visible(self):
        self.assertFalse(self.owned([101, None, True, -1]))
        self.process(100, 1, '/usr/bin/python3', self.collector)
        (self.proc / '100/cmdline').write_bytes(b'x' * 32769)
        self.assertFalse(self.owned([100]))

    def sessions(self):
        ancestry = usage.process_ancestry
        with patch.object(usage, '__file__', str(self.collector)), \
                patch.object(usage, '_process_matches', return_value=True), \
                patch.object(usage, 'process_ancestry', side_effect=lambda pid: ancestry(pid, self.proc)), \
                patch('agent_usage_processes.collector_owned', side_effect=lambda pids, paths: collector_owned(pids, paths, self.proc)):
            return usage.claude_sessions(self.config, include_terminal=True)

    def status(self, pid, state, ident):
        (self.config / 'sessions' / f'{pid}.json').write_text(json.dumps(
            dict(pid=pid, sessionId=ident, status=state, name='fab-9f', entrypoint='sdk-cli')))

    def test_internal_states_never_drive_activity_or_turn_completion(self):
        self.process(101, 100, 'claude')
        self.process(100, 1, '/usr/bin/python3', self.collector, '--serve')
        self.process(201, 1, 'claude')
        feeds = LocalFeeds(SimpleNamespace())
        for state in ('busy', 'waiting', 'idle'):
            with self.subTest(state=state):
                self.status(101, state, 'internal')
                self.status(201, 'busy', 'real-short-chat')
                sessions = self.sessions()
                self.assertEqual([(s['id'], s['name'], s['state']) for s in sessions],
                                 [('real-short-chat', 'fab-9f', 'busy')])
                feeds.observe_sessions(sessions)
                self.assertIsNone(feeds.pending_turn)
        self.status(201, 'idle', 'real-short-chat')
        feeds.observe_sessions(self.sessions())
        self.assertIsNotNone(feeds.pending_turn)

    def test_real_process_tree_with_replaced_child_argv(self):
        # No provider: an ordinary sleep stands in for Claude after process-title replacement.
        self.collector.parent.mkdir()
        self.collector.write_text(
            'import subprocess,time\n'
            'p=subprocess.Popen(["bash","-c","exec -a claude sleep 10"])\n'
            'print(p.pid,flush=True)\n'
            'try: time.sleep(10)\n'
            'except KeyboardInterrupt: pass\n'
            'finally: p.terminate();p.wait()\n')
        parent = subprocess.Popen([sys.executable, str(self.collector)], stdout=subprocess.PIPE, text=True)
        try:
            pid = int(parent.stdout.readline())
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                if Path(f'/proc/{pid}/cmdline').read_bytes().startswith(b'claude\0'):
                    break
                time.sleep(.01)
            else:
                self.fail('Synthetic child did not replace argv')
            chain = usage.process_ancestry(pid)
            self.assertTrue(collector_owned(chain, [self.collector]))
        finally:
            # SIGINT runs the fixture's finally block and reaps only its own child.
            import signal
            parent.send_signal(signal.SIGINT)
            parent.wait(timeout=5)
            parent.stdout.close()


if __name__ == '__main__':
    unittest.main()
