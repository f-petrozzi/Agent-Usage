"""Session state for the notch's arcs: Claude's status files and Codex rollouts."""
import importlib.machinery
import importlib.util
import json
import sqlite3
import fcntl
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

    def test_terminal_feed_reports_idle_only_while_process_is_alive(self):
        self.write('live.json', pid=os.getpid(), procStart=own_start(), sessionId='live', status='idle')
        self.write('dead.json', pid=2**22 + 12345, status='idle')
        got = usage.claude_sessions(self.dir, include_terminal=True)
        self.assertEqual([(s['id'], s['state']) for s in got], [('live', 'idle')])

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

    def test_completion_and_cancellation_are_distinct_terminal_states(self):
        self.rollout('done', 'task_started', 'task_complete')
        self.rollout('aborted', 'task_started', 'turn_aborted')
        got = usage.codex_sessions([('a', self.home)], self.now, include_terminal=True)
        self.assertEqual({s['id']: s['state'] for s in got},
                         {'rollout-done': 'idle', 'rollout-aborted': 'canceled'})

    def test_a_turn_quiet_for_half_an_hour_is_not_busy(self):
        self.rollout('stuck', 'task_started', age=usage.CODEX_QUIET_SECONDS + 60)
        self.assertEqual(usage.codex_sessions([('a', self.home)], self.now), [])

    def test_a_long_turn_stays_busy_past_the_tail_and_its_end_is_seen(self):
        # A 30-minute Codex turn writes megabytes of tool output after task_started
        path = self.day / 'rollout-long.jsonl'
        filler = json.dumps({'type': 'response_item', 'payload': {'type': 'function_call_output', 'output': 'x' * 4000}})
        lines = [json.dumps({'type': 'session_meta', 'payload': {'cwd': '/mnt/ssd/homelab'}}),
                 json.dumps({'type': 'event_msg', 'timestamp': '2026-09-30T17:20:51Z', 'payload': {'type': 'task_started'}})]
        lines += [filler] * (usage.SESSION_TAIL_BYTES // 4000 * 3)
        path.write_text('\n'.join(lines) + '\n'); os.utime(path, (self.now, self.now))
        usage._codex_turns.clear()
        got = usage.codex_sessions([('b', self.home)], self.now, include_terminal=True)
        self.assertEqual([(s['id'], s['state']) for s in got], [('rollout-long', 'busy')], 'a first look reads back far enough')
        with path.open('a') as handle:
            handle.write('\n'.join([filler] * 80) + '\n')
        got = usage.codex_sessions([('b', self.home)], self.now, include_terminal=True)
        self.assertEqual([s['state'] for s in got], ['busy'], 'still working as the rollout grows')
        with path.open('a') as handle:
            handle.write(json.dumps({'type': 'event_msg', 'timestamp': '2026-09-30T17:53:32Z', 'payload': {'type': 'task_complete'}}) + '\n')
        got = usage.codex_sessions([('b', self.home)], self.now, include_terminal=True)
        self.assertEqual([s['state'] for s in got], ['idle'], 'and its end is seen, so it can be announced')

    def test_sub_agents_are_part_of_their_parent_not_sessions(self):
        # Codex's guardian reviews an approval in a rollout of its own; its quick tasks must not read as finished work
        lines = [{'type': 'session_meta', 'payload': {'cwd': '/mnt/ssd/homelab', 'source': {'subagent': {'other': 'guardian'}},
                  'parent_thread_id': 'parent', 'thread_source': 'guardian_review'}},
                 {'type': 'event_msg', 'timestamp': '2026-09-30T17:16:05Z', 'payload': {'type': 'task_started'}},
                 {'type': 'event_msg', 'timestamp': '2026-09-30T17:16:10Z', 'payload': {'type': 'task_complete'}}]
        path = self.day / 'rollout-guardian.jsonl'
        path.write_text('\n'.join(json.dumps(line) for line in lines) + '\n')
        os.utime(path, (self.now, self.now))
        self.rollout('parent', 'task_started')
        got = usage.codex_sessions([('a', self.home)], self.now, include_terminal=True)
        self.assertEqual([(s['id'], s['state']) for s in got], [('rollout-parent', 'busy')])

    def test_a_rollout_shared_by_two_profiles_counts_once(self):
        self.rollout('open', 'task_started')
        self.assertEqual(len(usage.codex_sessions([('a', self.home), ('b', self.home)], self.now)), 1)


class AntigravitySessionTests(unittest.TestCase):
    def test_live_status_waiting_idle_background_and_crashes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'presence').mkdir()
            conn = sqlite3.connect(root / 'conversation_summaries.db')
            conn.execute('CREATE TABLE conversation_summaries (conversation_id TEXT, title TEXT, status TEXT, not_fully_idle INTEGER, killed INTEGER, last_modified_time TEXT)')
            locks = []
            try:
                for identity, status, background, killed, held in [
                    ('running', 'RUNNING', 0, 0, True), ('waiting', 'BUSY', 0, 0, True),
                    ('idle', 'IDLE', 0, 0, True), ('background', 'IDLE', 1, 0, True),
                    ('crashed', 'RUNNING', 0, 0, False), ('killed', 'RUNNING', 0, 1, True)]:
                    conn.execute('INSERT INTO conversation_summaries VALUES (?,?,?,?,?,?)',
                                 (identity, identity, 'CASCADE_RUN_STATUS_' + status, background, killed, '2026-09-29T19:00:00Z'))
                    lock = (root / 'presence' / (identity + '.lock')).open('wb')
                    locks.append(lock)
                    if held:
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                conn.commit()
                transcript = root / 'brain/waiting/.system_generated/logs/transcript.jsonl'
                transcript.parent.mkdir(parents=True)
                transcript.write_text(json.dumps({'type': 'TOOL', 'status': 'WAITING'}) + '\n{"partial":')
                got = {s['id']: s for s in usage.antigravity_sessions(root)}
                self.assertEqual(set(got), {'running', 'waiting', 'background'})
                terminal = {s['id']: s for s in usage.antigravity_sessions(root, include_terminal=True)}
                self.assertEqual(terminal['idle']['state'], 'idle')
                self.assertNotIn('killed', terminal)
                self.assertNotIn('crashed', terminal)
                self.assertEqual(got['running']['state'], 'busy')
                self.assertEqual(got['waiting']['state'], 'waiting')
                self.assertEqual(got['waiting']['account'], 'antigravity')
                transcript.write_text(json.dumps({'status':'DONE','type':'PLANNER_RESPONSE','tool_calls':[{'name':'ask_question'}]}) + '\n')
                self.assertEqual({s['id']: s for s in usage.antigravity_sessions(root)}['waiting']['state'], 'waiting')
                transcript.write_text(json.dumps({'status': 'DONE'}) + '\n')
                self.assertEqual({s['id']: s for s in usage.antigravity_sessions(root)}['waiting']['state'], 'busy')
            finally:
                conn.close()
                for lock in locks:
                    lock.close()
            self.assertEqual(usage.antigravity_sessions(root), [])

    def test_missing_or_incompatible_database_is_quiet(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertEqual(usage.antigravity_sessions(root), [])
            (root / 'conversation_summaries.db').write_text('not a database')
            self.assertEqual(usage.antigravity_sessions(root), [])


if __name__ == '__main__':
    unittest.main()
