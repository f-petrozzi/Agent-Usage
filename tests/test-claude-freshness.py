#!/usr/bin/env python3
"""Exercise real Claude cache and collector scheduling with virtual time, never providers."""
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import agent_usage_service as shared
loader = importlib.machinery.SourceFileLoader('freshness_usage', str(ROOT / 'scripts/agent-usage'))
spec = importlib.util.spec_from_loader(loader.name, loader)
usage = importlib.util.module_from_spec(spec)
loader.exec_module(usage)


def scenario(latency, cycles=8):
    clock = [1800000000.0]
    upstream, samples = [], []
    delays = iter((latency if isinstance(latency, list) else [latency]) * cycles)
    with tempfile.TemporaryDirectory() as root:
        root = Path(root)
        (root/'shared').mkdir()
        def provider(*args, **kwargs):
            upstream.append(clock[0])
            clock[0] += next(delays)
            return dict(id='claude', provider='claude', label='Claude', error=None, limits=[
                dict(label='5 hours', usedPercent=20, windowMins=300, resetsAt=clock[0]+7200),
                dict(label='Weekly', usedPercent=30, windowMins=10080, resetsAt=clock[0]+86400)])
        with patch.dict(os.environ, {'AGENT_USAGE_CACHE_DIR': str(root/'cache')}), \
                patch('time.time', side_effect=lambda: clock[0]), \
                patch('time.monotonic', side_effect=lambda: clock[0]), \
                patch.object(usage, '_claude_token', return_value=('synthetic', 'pro', False)), \
                patch.object(usage, '_query_claude_uncached', side_effect=provider):
            service = shared.UsageService(usage, [], include_agy=False, root=root/'shared')
            dispatch = iter([.03, .001, .01, .005] * cycles)
            def query():
                clock[0] += next(dispatch)  # Dispatch crosses the cache's independent request clock.
                return usage.query_claude(60, strict=True, prefer_cli=True)
            service.queries['claude'] = query
            for _ in range(cycles):
                previous = service.rows['claude'].get('sampledAt')
                service.poll('claude')
                if previous is not None:
                    samples.append(dict(ageAtCompletion=clock[0]-previous,
                                        staleSeconds=max(0,clock[0]-previous-600)))
                # A completed SDK turn requests the earliest permitted check.
                service.request_check('claude')
                clock[0] = service.due['claude']
    return dict(latency=latency, polls=cycles, providerRequests=len(upstream),
                minProviderGap=min((b-a for a,b in zip(upstream,upstream[1:])), default=0),
                lateRefreshes=sum(r['staleSeconds']>0 for r in samples), samples=samples)


class FreshnessTests(unittest.TestCase):
    def test_completed_turn_checks_do_not_replay_a_nearly_expired_cached_poll(self):
        for latency in (1, 10, 20, 40, [1, 20, 10, 40]):
            with self.subTest(latency=latency):
                result = scenario(latency)
                self.assertEqual(result['lateRefreshes'], 0, json.dumps(result))
                self.assertGreaterEqual(result['minProviderGap'], 300)
                self.assertLessEqual(result['providerRequests'], result['polls'])

    def test_native_claude_reading_starts_fallback_before_expiry(self):
        with tempfile.TemporaryDirectory() as root:
            service = shared.UsageService(usage, [], include_agy=False, root=Path(root))
            now = 1800000000.0
            value = dict(id='claude', provider='claude', limits=[dict(label='5 hours', usedPercent=20,
                windowMins=300, resetsAt=now+7200)])
            with patch('time.time', return_value=now), patch('time.monotonic', return_value=now):
                service.accept('claude', value, sampled=now, source='live', origin='claude-runtime')
                self.assertEqual(service.due['claude'], now+540)
                with patch('time.time', return_value=now+599):
                    service.save()  # Collector remains alive while the unchanged sample ages.
                self.assertFalse(shared.read_snapshot(Path(root)/'shared.json', now=now+599)['accounts'][0]['stale'])
                self.assertTrue(shared.read_snapshot(Path(root)/'shared.json', now=now+601)['accounts'][0]['stale'])


if __name__ == '__main__':
    if '--measure' in sys.argv:
        print(json.dumps([scenario(latency) for latency in (1,10,20,40,[1,20,10,40])], indent=2))
    else:
        unittest.main()
