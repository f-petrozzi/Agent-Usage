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
        self.assertEqual(got['a']['sessionId'], 'a')

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


class TerminalIdentityTests(unittest.TestCase):
    def test_parent_chain_and_rollout_writer_use_only_process_metadata(self):
        root = Path(tempfile.mkdtemp())
        for pid, parent in [(101, 90), (90, 80), (80, 1)]:
            (root / str(pid)).mkdir()
            (root / str(pid) / 'stat').write_text(f'{pid} (name with spaces) S {parent} 0 0 0')
        self.assertEqual(usage.process_ancestry(101, root), [101, 90, 80])
        executable = root / 'codex'; executable.write_text('')
        (root / '101' / 'exe').symlink_to(executable)
        (root / '101' / 'fd').mkdir()
        rollout = root / 'rollout-example.jsonl'; rollout.write_text('private message body')
        (root / '101' / 'fd' / '3').symlink_to(rollout)
        self.assertEqual(usage.rollout_processes(root), {str(rollout): [101, 90, 80]})



class CodexSessionTests(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp())
        usage._codex_turns.clear()
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

    def test_codex_session_link_uses_uuid_from_rollout_name(self):
        identity = '12345678-1234-5678-abcd-123456789012'
        self.rollout('2026-09-30T12-00-00-' + identity, 'task_started')
        got = usage.codex_sessions([('a', self.home)], self.now)
        self.assertEqual(got[0]['sessionId'], identity)

    def test_historical_links_export_completion_metadata_without_messages(self):
        identity = '12345678-1234-5678-abcd-123456789012'
        path = self.day / ('rollout-' + identity + '.jsonl')
        stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(self.now))
        path.write_text('\n'.join(json.dumps(event) for event in [
            {'type': 'session_meta', 'payload': {'id': identity, 'cwd': '/srv/project'}},
            {'type': 'response_item', 'payload': {'message': 'never export private chat text'}},
            {'type': 'event_msg', 'timestamp': stamp, 'payload': {'type': 'task_complete'}}]) + '\n')
        sessions = usage.session_links([('a', self.home)], self.home, self.now)
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]['sessionId'], identity)
        self.assertEqual(sessions[0]['name'], 'project')
        self.assertNotIn('private chat text', json.dumps(sessions))

    def test_completion_and_cancellation_are_distinct_terminal_states(self):
        self.rollout('done', 'task_started', 'task_complete')
        self.rollout('aborted', 'task_started', 'turn_aborted')
        got = usage.codex_sessions([('a', self.home)], self.now, include_terminal=True)
        self.assertEqual({s['id']: s['state'] for s in got},
                         {'rollout-done': 'idle', 'rollout-aborted': 'canceled'})

    def test_a_turn_quiet_for_half_an_hour_is_not_busy(self):
        self.rollout('stuck', 'task_started', age=usage.CODEX_QUIET_SECONDS + 60)
        self.assertEqual(usage.codex_sessions([('a', self.home)], self.now), [])

    def question_entry(self, call_id='question', async_question=False):
        return {'type': 'response_item', 'payload': {'type': 'function_call', 'call_id': call_id,
                'name': 'request_user_input_async' if async_question else 'request_user_input',
                'arguments': json.dumps({'questions': [{'question': 'Private question text'}]})}}

    def append_entry(self, path, entry):
        with path.open('a') as handle:
            handle.write(json.dumps(entry) + '\n')

    def session_state(self, include_terminal=True):
        return usage.codex_sessions([('a', self.home)], self.now, include_terminal=include_terminal)[0]

    def test_question_waits_until_matching_answer_and_exports_no_question_text(self):
        self.rollout('question', 'task_started')
        path = self.day / 'rollout-question.jsonl'
        self.assertEqual(self.session_state()['state'], 'busy')
        self.append_entry(path, self.question_entry())
        waiting = self.session_state(include_terminal=False)
        self.assertEqual(waiting['state'], 'waiting')
        self.assertEqual(waiting['waitingFor'], 'input needed')
        self.assertEqual(waiting['since'], 1790708400)
        self.assertNotIn('Private question text', json.dumps(waiting))
        self.append_entry(path, {'type': 'response_item', 'payload': {'type': 'function_call_output', 'call_id': 'unrelated', 'output': 'done'}})
        self.assertEqual(self.session_state()['state'], 'waiting')
        self.append_entry(path, {'type': 'response_item', 'payload': {'type': 'function_call_output', 'call_id': 'question', 'output': '{"answers":{}}'}})
        self.assertEqual(self.session_state()['state'], 'busy')

    def test_async_question_keeps_waiting_through_acknowledgment_and_background_work(self):
        self.rollout('question', 'task_started')
        path = self.day / 'rollout-question.jsonl'
        self.append_entry(path, self.question_entry(async_question=True))
        self.append_entry(path, {'type': 'response_item', 'payload': {'type': 'function_call_output', 'call_id': 'question', 'output': '{"accepted":true}'}})
        self.append_entry(path, {'type': 'response_item', 'payload': {'type': 'function_call', 'call_id': 'work', 'name': 'exec_command'}})
        self.assertEqual(self.session_state()['state'], 'waiting')
        self.append_entry(path, {'type': 'response_item', 'payload': {'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': 'Private answer'}]}})
        self.assertEqual(self.session_state()['state'], 'busy')
        # Growing within the old overlap window must not replay the question.
        self.append_entry(path, {'type': 'event_msg', 'payload': {'type': 'token_count'}})
        self.assertEqual(self.session_state()['state'], 'busy')

    def test_multiple_questions_and_rejected_async_prompt(self):
        self.rollout('question', 'task_started')
        path = self.day / 'rollout-question.jsonl'
        for call in ('one', 'two'):
            self.append_entry(path, self.question_entry(call))
        self.assertEqual(self.session_state()['state'], 'waiting')
        for call, expected in [('one', 'waiting'), ('two', 'busy')]:
            self.append_entry(path, {'type': 'response_item', 'payload': {'type': 'function_call_output', 'call_id': call, 'output': '{"answers":{}}'}})
            self.assertEqual(self.session_state()['state'], expected)
        self.append_entry(path, self.question_entry(async_question=True))
        self.assertEqual(self.session_state()['state'], 'waiting')
        self.append_entry(path, {'type': 'response_item', 'payload': {'type': 'function_call_output', 'call_id': 'question', 'output': '{"accepted":false}'}})
        self.assertEqual(self.session_state()['state'], 'busy')

    def test_turn_end_abort_new_turn_and_user_event_clear_questions(self):
        for event, expected in [('task_complete', 'idle'), ('turn_aborted', 'canceled'), ('task_started', 'busy'), ('user_message', 'busy')]:
            with self.subTest(event=event):
                self.rollout('question', 'task_started')
                path = self.day / 'rollout-question.jsonl'
                self.append_entry(path, self.question_entry(async_question=True))
                usage._codex_turns.clear()
                self.assertEqual(self.session_state()['state'], 'waiting')
                self.append_entry(path, {'type': 'event_msg', 'timestamp': '2026-10-02T20:00:00Z', 'payload': {'type': event}})
                self.assertEqual(self.session_state()['state'], expected)

    def test_partial_question_and_answer_are_reread_when_complete(self):
        self.rollout('question', 'task_started')
        path = self.day / 'rollout-question.jsonl'
        for entry, before, after in [
            (self.question_entry(), 'busy', 'waiting'),
            ({'type': 'response_item', 'payload': {'type': 'function_call_output', 'call_id': 'question', 'output': '{"answers":{}}'}}, 'waiting', 'busy'),
        ]:
            self.assertEqual(self.session_state()['state'], before)
            raw = json.dumps(entry) + '\n'
            with path.open('a') as handle:
                handle.write(raw[:30])
            self.assertEqual(self.session_state()['state'], before)
            with path.open('a') as handle:
                handle.write(raw[30:])
            self.assertEqual(self.session_state()['state'], after)

    def test_question_survives_large_outputs_and_collector_restart(self):
        self.rollout('question', 'task_started')
        path = self.day / 'rollout-question.jsonl'
        self.append_entry(path, self.question_entry(async_question=True))
        self.assertEqual(self.session_state()['state'], 'waiting')
        self.append_entry(path, {'type': 'response_item', 'payload': {'type': 'function_call_output', 'call_id': 'work', 'output': 'x' * (usage.SESSION_TAIL_BYTES * 3)}})
        self.assertEqual(self.session_state()['state'], 'waiting')
        usage._codex_turns.clear()
        self.assertEqual(self.session_state()['state'], 'waiting')
        self.append_entry(path, {'type': 'response_item', 'payload': {'type': 'message', 'role': 'user'}})
        self.assertEqual(self.session_state()['state'], 'busy')

    def test_replaced_or_truncated_rollout_does_not_retain_old_questions(self):
        for replace in (False, True):
            with self.subTest(replace=replace):
                self.rollout('question', 'task_started')
                path = self.day / 'rollout-question.jsonl'
                self.append_entry(path, self.question_entry())
                self.assertEqual(self.session_state()['state'], 'waiting')
                if replace:
                    path.unlink()
                self.rollout('question', 'task_started')
                self.assertEqual(self.session_state()['state'], 'busy')

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
    def test_idle_input_requests_remain_waiting_until_the_next_step(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'presence').mkdir()
            transcript = root / 'brain/question/.system_generated/logs/transcript.jsonl'
            transcript.parent.mkdir(parents=True)
            with sqlite3.connect(root / 'conversation_summaries.db') as conn:
                conn.execute('CREATE TABLE conversation_summaries (conversation_id TEXT, title TEXT, status TEXT, not_fully_idle INTEGER, killed INTEGER, last_modified_time TEXT)')
                conn.execute('INSERT INTO conversation_summaries VALUES (?,?,?,?,?,?)',
                             ('question', 'Question', 'CASCADE_RUN_STATUS_RUNNING', 0, 0, '2026-10-02T19:00:00Z'))
                conn.commit()
                with (root / 'presence/question.lock').open('wb') as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    self.assertEqual(usage.antigravity_sessions(root, include_terminal=True)[0]['state'], 'busy')
                    conn.execute("UPDATE conversation_summaries SET status = 'CASCADE_RUN_STATUS_IDLE'")
                    conn.commit()
                    for step in [
                        {'type': 'TOOL', 'status': 'WAITING'},
                        {'type': 'PLANNER_RESPONSE', 'status': 'DONE', 'tool_calls': [{'name': 'ask_question'}]},
                        {'type': 'PLANNER_RESPONSE', 'status': 'DONE', 'tool_calls': [{'name': 'ask_permission'}]},
                    ]:
                        with self.subTest(step=step):
                            transcript.write_text(json.dumps(step) + '\n{"partial":')
                            for include_terminal in (False, True):
                                got = usage.antigravity_sessions(root, include_terminal=include_terminal)
                                self.assertEqual(got[0]['state'], 'waiting')
                                self.assertEqual(got[0]['waitingFor'], 'input needed')
                            # An answer/new step clears the old request; it must
                            # not keep an idle conversation waiting forever.
                            transcript.write_text(json.dumps(step) + '\n' + json.dumps({'type': 'USER_INPUT', 'status': 'DONE'}) + '\n')
                            self.assertEqual(usage.antigravity_sessions(root), [])
                            self.assertEqual(usage.antigravity_sessions(root, include_terminal=True)[0]['state'], 'idle')
                    transcript.unlink()
                    conn.execute("UPDATE conversation_summaries SET status = 'CASCADE_RUN_STATUS_WAITING'")
                    conn.commit()
                    for include_terminal in (False, True):
                        self.assertEqual(usage.antigravity_sessions(root, include_terminal=include_terminal)[0]['state'], 'waiting')

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
