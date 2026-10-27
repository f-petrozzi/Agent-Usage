"""Synthetic collector session files keep parent/helper activity and incremental caches separate."""
import importlib.machinery
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader('isolated_usage', str(Path(__file__).parents[1] / 'scripts/agent-usage'))
spec = importlib.util.spec_from_loader(loader.name, loader)
usage = importlib.util.module_from_spec(spec)
loader.exec_module(usage)


class AccountIsolationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.now = time.time()
        self.profiles = [(name, self.root / name) for name in ('a', 'b')]
        self.paths = {}
        for name, home in self.profiles:
            day = home / 'sessions' / time.strftime('%Y/%m/%d', time.localtime(self.now))
            day.mkdir(parents=True)
            path = day / ('rollout-' + name + '.jsonl')
            path.write_text(json.dumps({'type': 'session_meta', 'payload': {'cwd': '/synthetic/' + name}}) + '\n')
            self.paths[name] = path
        self.addCleanup(patch.stopall)
        patch.object(usage, 'rollout_processes', return_value={}).start()

    def event(self, account, kind):
        with self.paths[account].open('a') as out:
            out.write(json.dumps({'timestamp': '2026-10-27T05:00:00Z', 'type': 'event_msg',
                                  'payload': {'type': kind}}) + '\n')

    def states(self):
        return {row['account']: row['state'] for row in usage.codex_sessions(self.profiles, self.now, True)}

    def test_busy_parent_and_idle_helper_never_share_cached_turn_state(self):
        self.event('a', 'task_started')
        self.event('b', 'task_started')
        self.event('b', 'task_complete')
        self.assertEqual(self.states(), {'codex:a': 'busy', 'codex:b': 'idle'})
        self.event('a', 'token_count')
        self.assertEqual(self.states(), {'codex:a': 'busy', 'codex:b': 'idle'})
        self.event('b', 'task_started')
        self.assertEqual(self.states(), {'codex:a': 'busy', 'codex:b': 'busy'})
        self.event('b', 'task_complete')
        self.assertEqual(self.states(), {'codex:a': 'busy', 'codex:b': 'idle'})
        self.event('a', 'task_complete')
        self.assertEqual(self.states(), {'codex:a': 'idle', 'codex:b': 'idle'})

    def test_native_subagent_metadata_is_not_inherited_as_account_activity(self):
        meta = {'type': 'session_meta', 'payload': {'cwd': '/synthetic/b',
                'parent_thread_id': 'synthetic-parent', 'source': {'subagent': 'thread_spawn'}}}
        self.paths['b'].write_text(json.dumps(meta) + '\n')
        self.event('a', 'task_started')
        self.event('b', 'task_started')
        self.assertEqual(self.states(), {'codex:a': 'busy'})


if __name__ == '__main__':
    unittest.main()
