#!/usr/bin/env python3
"""No network: test a 429 across separate collector invocations."""
import os
import runpy
import tempfile
import urllib.error
from pathlib import Path
from unittest.mock import Mock, patch

module = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/agent-usage'))
query = module['query_claude']
error = urllib.error.HTTPError('https://example.invalid', 429, 'Too Many Requests', {'Retry-After': '900'}, None)
clock = Mock(return_value=1800000000.0)
fetch = Mock(side_effect=error)
cli = Mock(side_effect=AssertionError('429 must not launch Claude CLI'))
with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {'AGENT_USAGE_CACHE_DIR': root}), patch.dict(query.__globals__, {
    '_claude_token': lambda: ('test-token', 'pro', False), '_claude_fetch': fetch, '_claude_cli_usage': cli,
}), patch('time.time', clock):
    first = query(1)
    assert first['retryAt'] == 1800000900
    assert 'rate limited' in first['error']
    assert query(1) == first
    assert fetch.call_count == 1 and cli.call_count == 0
    clock.return_value += 901
    fetch.side_effect = None
    fetch.return_value = {'five_hour': {'utilization': 20}, 'seven_day': {'utilization': 40}}
    success = query(1)
    assert success['error'] is None and success['limits']
    assert query(1) == success and fetch.call_count == 2
    clock.return_value += 301
    fetch.side_effect = error
    stale = query(1)
    assert stale['error'] is None and stale['warning'] and stale['stale']
    assert stale['limits'] == success['limits'] and stale['sampledAt'] == success['sampledAt']
    assert query(1) == stale and fetch.call_count == 3
    assert cli.call_count == 0
    assert module['_retry_seconds']('Tue, 15 Jan 2030 08:00:00 GMT', 0) > 0
    assert module['_retry_seconds']('invalid', 0) == 0
print('PASS: Retry-After, persistent cooldown, cached usage, recovery, no CLI fallback on 429')
