"""Session state for the notch's arcs: Claude's status files and Codex rollouts."""
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
import unittest

loader = importlib.machinery.SourceFileLoader('usage', str(Path(__file__).parents[1]/'scripts/agent-usage'))
spec = importlib.util.spec_from_loader(loader.name, loader)
usage = importlib.util.module_from_spec(spec)
loader.exec_module(usage)


def own_start():
    stat = Path(f'/proc/{os.getpid()}/stat').read_text()
    return stat[stat.rfind(')') + 2:].split()[19]


class ClaudeSessionTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        (self.dir / 'sessions').mkdir()

    def write(self, filename, **record):
        (self.dir / 'sessions' / filename).write_text(json.dumps(record))

    def test_live_busy_and_waiting_sessions_are_reported(self):
        self.write('1.json', pid=os.getpid(), procStart=own_start(), sessionId='a', name='homelab-1',
                   status='busy', statusUpdatedAt=1790000000000)
        self.write('2.json', pid=os.getpid(), procStart=own_start(), sessionId='b', cwd='/srv/nest',
                   status='waiting', waitingFor='permission', statusUpdatedAt=1790000001000)
        got = {s['id']: s for s in usage.claude_sessions(self.dir)}
        self.assertEqual(got['a']['state'], 'busy')
        self.assertEqual(got['a']['since'], 1790000000)
        self.assertEqual(got['b']['state'], 'waiting')
        self.assertEqual(got['b']['waitingFor'], 'permission')
        self.assertEqual(got['b']['name'], 'nest')

    def test_idle_crashed_and_reused_pids_are_left_out(self):
        self.write('1.json', pid=os.getpid(), procStart=own_start(), status='idle')
        self.write('2.json', pid=2**22 + 12345, procStart='1', status='busy')  # no such process
        self.write('3.json', pid=os.getpid(), procStart='1', status='busy')  # pid now someone else's
        self.assertEqual(usage.claude_sessions(self.dir), [])

    def test_key_files_are_never_opened(self):
        key = self.dir / 'sessions' / '1.abc.key'
        key.write_text('{"peerToken":"secret"}')
        key.chmod(0)
        self.write('1.json', pid=os.getpid(), procStart=own_start(), status='busy')
        self.assertEqual(len(usage.claude_sessions(self.dir)), 1)


class CodexSessionTests(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp())
        self.now = time.time()
        self.day = self.home / 'sessions' / time.strftime('%Y/%m/%d', time.localtime(self.now))
        self.day.mkdir(parents=True)

    def rollout(self, name, *events, age=0):
        lines = [{'type': 'session_meta', 'payload': {'cwd': '/mnt/ssd/homelab/projects/Nest'}}]
        lines += [{'timestamp': '2026-09-29T19:00:00Z', 'type': 'event_msg', 'payload': {'type': e}} for e in events]
        path = self.day / f'rollout-{name}.jsonl'
        path.write_text('\n'.join(json.dumps(l) for l in lines) + '\n')
        os.utime(path, (self.now - age, self.now - age))

    def test_open_turn_is_busy_and_closed_turns_are_not(self):
        self.rollout('open', 'task_started', 'task_complete', 'task_started', 'token_count')
        self.rollout('done', 'task_started', 'task_complete')
        self.rollout('aborted', 'task_started', 'turn_aborted')
        got = usage.codex_sessions([('a', self.home)], self.now)
        self.assertEqual([(s['id'], s['state'], s['account'], s['name']) for s in got],
                         [('rollout-open', 'busy', 'codex:a', 'Nest')])
        self.assertEqual(got[0]['since'], 1790708400)

    def test_a_turn_quiet_for_half_an_hour_is_not_busy(self):
        self.rollout('stuck', 'task_started', age=usage.CODEX_QUIET_SECONDS + 60)
        self.assertEqual(usage.codex_sessions([('a', self.home)], self.now), [])

    def test_a_rollout_shared_by_two_profiles_counts_once(self):
        self.rollout('open', 'task_started')
        self.assertEqual(len(usage.codex_sessions([('a', self.home), ('b', self.home)], self.now)), 1)


if __name__ == '__main__':
    unittest.main()
