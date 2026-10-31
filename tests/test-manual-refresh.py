"""Synthetic clock checks: explicit refresh is scheduled and never bypasses retry/gap."""
import importlib.machinery
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import agent_usage_service as shared
loader = importlib.machinery.SourceFileLoader('manual_usage', str(ROOT / 'scripts/agent-usage'))
spec = importlib.util.spec_from_loader(loader.name, loader)
usage = importlib.util.module_from_spec(spec)
loader.exec_module(usage)

class ManualRefreshTests(unittest.TestCase):
    def test_request_schedules_checks_without_polling_or_changing_sample(self):
        with tempfile.TemporaryDirectory() as root:
            service = shared.UsageService(usage, [], include_agy=False, root=Path(root))
            service.due['claude'] = 9999
            with patch('time.time', return_value=1000), patch('time.monotonic', return_value=2000):
                service.rows['claude'].update(pollAttemptedAt=900, sampledAt=800)
                receipt = service.publish({'operation':'refresh'})
                self.assertEqual(receipt['checkRequested'], ['claude'])
                self.assertEqual(service.due['claude'], 2000)
                self.assertEqual(service.rows['claude']['sampledAt'], 800)
                service.rows['claude']['pollRetryAt'] = 1800
                service.due['claude'] = 9999
                service.publish({'operation':'refresh'})
                self.assertEqual(service.due['claude'], 2800)
                service.inflight['claude'] = 1000
                self.assertEqual(service.publish({'operation':'refresh'})['checkRequested'], [])
                with self.assertRaises(ValueError):
                    service.publish({'operation':'refresh','force':True})

    def test_active_checks_idle_and_native_suppression(self):
        with tempfile.TemporaryDirectory() as root:
            service = shared.UsageService(usage, [], include_agy=False, root=Path(root))
            with patch('time.time', return_value=1000), patch('time.monotonic', return_value=2000):
                service.rows['claude'].update(pollAttemptedAt=900, sampledAt=900)
                service.due['claude'] = 2300
                service.schedule_active_claude('claude')
                self.assertEqual(service.due['claude'], 2300)
                service.local.states = {'session': 'busy'}
                service.schedule_active_claude('claude')
                self.assertEqual(service.due['claude'], 2000)
                service.due['claude'] = 2300
                service.rows['claude']['sampledAt'] = 990
                service.schedule_active_claude('claude')
                self.assertEqual(service.due['claude'], 2300)
                service.rows['claude'].update(sampledAt=900, pollRetryAt=1800)
                service.due['claude'] = 2800
                service.schedule_active_claude('claude')
                self.assertEqual(service.due['claude'], 2800)

if __name__ == '__main__': unittest.main()
