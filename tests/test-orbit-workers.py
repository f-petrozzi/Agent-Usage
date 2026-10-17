"""Ephemeral Orbit workers contribute activity without inventing resumable chats."""
import importlib.machinery
import importlib.util
import os
from pathlib import Path
import time
import unittest
from unittest.mock import patch
import uuid

loader = importlib.machinery.SourceFileLoader('usage', str(Path(__file__).parents[1] / 'scripts/agent-usage'))
spec = importlib.util.spec_from_loader(loader.name, loader)
usage = importlib.util.module_from_spec(spec)
loader.exec_module(usage)


class OrbitWorkerTests(unittest.TestCase):
    def setUp(self):
        self.now = time.time()
        self.row = dict(id=str(uuid.uuid4()), account='a', state='running', started=self.now-120,
                        worker_pid=os.getpid(), worker_identity='boot:' + Path('/proc/self/stat').read_text().split(')')[-1].split()[19])
        usage._orbit_worker_cache = (0, [])

    def sessions(self, rows, terminal=False):
        usage._orbit_worker_cache = (0, [])
        with patch.object(usage, '_read_orbit_workers', return_value=rows):
            return usage.orbit_worker_sessions([('a', Path('/synthetic/a'))], self.now, terminal)

    def test_running_ephemeral_worker_is_busy_and_not_resumable(self):
        sessions = self.sessions([self.row])
        self.assertEqual(len(sessions), 1)
        self.assertEqual((sessions[0]['account'], sessions[0]['state']), ('codex:a', 'busy'))
        self.assertEqual((sessions[0]['sessionId'], sessions[0]['terminalPids']), ('', []))
        self.assertEqual(sessions[0]['since'], self.row['started'])
        self.assertNotIn('prompt_file', sessions[0])

    def test_queue_quota_wait_other_account_dead_or_reused_pid_do_not_spin(self):
        for changed in (dict(state='queued'), dict(state='waiting_for_usage'), dict(account='b'),
                        dict(worker_pid=2**30), dict(worker_identity='boot:1'), dict(worker_identity=None)):
            with self.subTest(changed=changed):
                self.assertEqual(self.sessions([dict(self.row, **changed)]), [])

    def test_terminal_transitions_are_explicit_and_cancellation_is_not_completion(self):
        for state in ('completed', 'failed', 'stopped', 'stalled'):
            row = dict(self.row, state=state, finished=self.now-1)
            self.assertEqual(self.sessions([row]), [])
            got = self.sessions([row], terminal=True)[0]
            self.assertEqual(got['state'], 'idle' if state == 'completed' else 'canceled')
        self.assertEqual(self.sessions([dict(self.row, state='completed', finished=self.now-90000)], True), [])

    def test_reads_are_cached_and_disappearance_does_not_fabricate_completion(self):
        with patch.object(usage, '_read_orbit_workers', return_value=[self.row]) as read:
            for _ in range(4):
                self.assertEqual(len(usage.orbit_worker_sessions([('a', Path('/synthetic/a'))], self.now)), 1)
            read.assert_called_once()
        self.assertEqual(self.sessions([], True), [])

    def test_unavailable_service_is_optional(self):
        with patch.object(usage.socket.socket, 'connect', side_effect=PermissionError()):
            self.assertEqual(usage._read_orbit_workers(), [])


if __name__ == '__main__':
    unittest.main()
