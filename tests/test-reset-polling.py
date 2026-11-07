"""Exercise Claude's real cache and shared scheduler across a delayed quota reset."""
import copy
import importlib.machinery
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
import urllib.error
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import agent_usage_service as shared

loader = importlib.machinery.SourceFileLoader('reset_usage', str(ROOT / 'scripts/agent-usage'))
spec = importlib.util.spec_from_loader(loader.name, loader)
usage = importlib.util.module_from_spec(spec)
loader.exec_module(usage)


class ResetPollingTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.clock = 1800000000.0
        self.value = dict(id='claude', provider='claude', label='Claude', error=None, limits=[
            dict(label='5 hours', usedPercent=90, windowMins=300, resetsAt=self.clock + 100),
            dict(label='Weekly', usedPercent=27, windowMins=10080, resetsAt=self.clock + 86400)])
        for context in (
            patch.dict(os.environ, {'AGENT_USAGE_CACHE_DIR': str(self.root / 'cache')}),
            patch('time.time', side_effect=lambda: self.clock),
            patch('time.monotonic', side_effect=lambda: self.clock),
            patch.object(usage, '_claude_token', return_value=('synthetic', 'pro', False)),
            patch.object(usage, '_claude_cli', return_value=('synthetic', (2, 1, 318))),
        ):
            context.start()
            self.addCleanup(context.stop)
        self.provider = Mock(side_effect=lambda *args, **kwargs: copy.deepcopy(self.value))
        context = patch.object(usage, '_query_claude_uncached', self.provider)
        context.start()
        self.addCleanup(context.stop)
        self.service = shared.UsageService(usage, [], include_agy=False, root=self.root)
        self.service.poll('claude')
        self.clock += 116  # The reset grace and successful cache have expired.

    def snapshot(self):
        return shared.read_snapshot(self.root / 'shared.json')['accounts'][0]

    def test_expired_provider_window_retries_then_recovers_without_parse_pause(self):
        # Claude can still return the previous window for a short time after reset.
        self.service.poll('claude')
        row = self.snapshot()
        self.assertEqual(self.provider.call_count, 2)
        self.assertEqual(row['refresh']['state'], 'ok')
        self.assertEqual(row['pollFailures'], 0)
        self.assertNotIn('pollPauseKey', row)
        self.assertEqual(self.service.due['claude'], self.clock + shared.RESET_GAP)
        self.assertTrue(row['stale'])
        self.assertEqual([w['usedPercent'] for w in row['limits']], [90, 27])

        # A repeated cache read cannot renew the measurement or call the provider.
        sampled = row['sampledAt']
        self.clock += 10
        self.service.poll('claude')
        self.assertEqual(self.snapshot()['sampledAt'], sampled)
        self.assertEqual(self.provider.call_count, 2)

        self.clock = self.service.due['claude']
        self.value['limits'][0].update(usedPercent=1, resetsAt=self.clock + 18000)
        self.value['limits'][1]['usedPercent'] = 28
        self.service.poll('claude')
        row = self.snapshot()
        self.assertEqual(self.provider.call_count, 3)
        self.assertFalse(row['stale'])
        self.assertNotIn('warning', row)
        self.assertEqual([w['usedPercent'] for w in row['limits']], [1, 28])
        self.assertEqual(row['sampledAt'], self.clock)

    def test_zero_after_reset_stays_pending_until_a_measured_new_window_arrives(self):
        self.value['limits'][0]['usedPercent'] = 0
        self.service.poll('claude')
        row = self.snapshot()
        self.assertTrue(row['stale'])
        self.assertEqual(row['limits'][0]['usedPercent'], 0)
        self.assertEqual(self.service.due['claude'], self.clock + 60)
        self.assertEqual(self.provider.call_count, 2)
        self.clock = self.service.due['claude']
        self.value['limits'][0].update(usedPercent=2, resetsAt=self.clock + 18000)
        self.service.poll('claude')
        row = self.snapshot()
        self.assertFalse(row['stale'])
        self.assertEqual(row['limits'][0]['usedPercent'], 2)
        self.assertEqual(self.provider.call_count, 3)

    def test_expired_windows_keep_the_normal_gap_after_reset_retry_period(self):
        self.clock += shared.RESET_RETRY_FOR
        self.service.poll('claude')
        self.assertEqual(self.snapshot()['refresh']['state'], 'ok')
        self.assertTrue(self.snapshot()['stale'])
        self.assertEqual(self.service.due['claude'], self.clock + 300)

    def test_provider_rate_limit_after_reset_keeps_its_cooldown(self):
        self.service.poll('claude')
        self.clock = self.service.due['claude']
        self.provider.side_effect = urllib.error.HTTPError(
            'https://example.invalid', 429, 'Too Many Requests', {'Retry-After': '900'}, None)
        self.service.poll('claude')
        row = self.snapshot()
        self.assertEqual(row['refresh']['state'], 'rate_limited')
        self.assertGreaterEqual(row['pollRetryAt'], self.clock + 900)
        self.service.request_check('claude')
        self.assertGreaterEqual(self.service.due['claude'], self.clock + 900)
        self.assertEqual(row['limits'][0]['usedPercent'], 90)
        self.assertTrue(row['stale'])

    def test_other_stale_readings_remain_rejected(self):
        value = copy.deepcopy(self.value)
        value['stale'] = True
        for source, sampled, reset in (
            ('live', self.clock, self.clock - 1),
            ('poll', self.clock - 601, self.clock - 1),
            ('poll', self.clock, self.clock + 100),
        ):
            value['limits'][0]['resetsAt'] = reset
            with self.subTest(source=source, sampled=sampled, reset=reset):
                with self.assertRaises(ValueError):
                    self.service.accept('claude', value, sampled=sampled, source=source)


if __name__ == '__main__':
    unittest.main()
