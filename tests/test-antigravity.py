"""AGY structured quota parsing and bounded CLI reads."""
import importlib.machinery
import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader('usage', str(pathlib.Path(__file__).parents[1] / 'scripts/agent-usage'))
spec = importlib.util.spec_from_loader(loader.name, loader)
usage = importlib.util.module_from_spec(spec)
loader.exec_module(usage)

def report(buckets):
    return {'status': 'SUCCESS', 'command': {'name': 'usage', 'data': {'groups': [{'name': 'Gemini Models', 'buckets': buckets}]}}}

class AntigravityTests(unittest.TestCase):
    def test_measured_remaining_becomes_consumed(self):
        a = usage.normalize_antigravity(report([
            {'id': 'gemini-weekly', 'window': 'weekly', 'remaining_fraction': .25, 'reset_time': '2026-10-07T00:00:00Z'},
            {'id': 'gemini-5h', 'window': '5h', 'remaining_fraction': 1, 'reset_time': None},
        ]))
        self.assertEqual(a['provider'], 'antigravity')
        self.assertEqual([l['usedPercent'] for l in a['limits']], [75, 0])
        self.assertEqual([l['windowMins'] for l in a['limits']], [10080, 300])
        self.assertIsNotNone(a['limits'][0]['resetsAt'])
        self.assertIsNone(a['limits'][1]['resetsAt'])
        self.assertNotIn('plan', a)

    def test_unmeasured_disabled_and_invalid_buckets_are_not_zero_usage(self):
        for bucket in [{}, {'window': 'weekly', 'remaining_fraction': True},
                       {'window': 'weekly', 'remaining_fraction': -1},
                       {'window': 'weekly', 'remaining_fraction': float('nan')},
                       {'window': 'weekly', 'remaining_fraction': 1, 'enabled': False}]:
            with self.subTest(bucket=bucket), self.assertRaises(usage.UsageError):
                usage.normalize_antigravity(report([bucket]))
        with self.assertRaises(usage.UsageError):
            usage.normalize_antigravity({'status': 'SUCCESS', 'command': {'name': 'chat'}})

    def test_ssh_path_finds_local_install(self):
        with tempfile.TemporaryDirectory() as work:
            home = pathlib.Path(work)
            executable = home / '.local/bin/agy'
            executable.parent.mkdir(parents=True)
            executable.write_text('#!/bin/sh\nexit 0\n')
            executable.chmod(0o755)
            with patch.object(usage.shutil, 'which', return_value=None), patch.object(usage.Path, 'home', return_value=home):
                self.assertEqual(usage.antigravity_executable(), str(executable))
                executable.chmod(0o644)
                self.assertIsNone(usage.antigravity_executable())

    def test_timeout_returns_safe_error(self):
        with tempfile.TemporaryDirectory() as work:
            executable = pathlib.Path(work) / 'agy'
            executable.write_text('#!/usr/bin/env python3\nimport sys,time\nif "--version" in sys.argv: print("1.2.13")\nelse: time.sleep(10)\n')
            executable.chmod(0o755)
            with patch.object(usage.shutil, 'which', return_value=str(executable)):
                a = usage.query_antigravity(.2)
            self.assertEqual(a['error'], 'Antigravity usage timed out.')
            self.assertEqual(a['limits'], [])

if __name__ == '__main__':
    unittest.main()
