"""Provider-free checks that the shared service reads Claude through Claude Code's /usage."""
import importlib.machinery
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import agent_usage_service as shared

loader = importlib.machinery.SourceFileLoader('usage_cli_fallback', str(ROOT / 'scripts/agent-usage'))
spec = importlib.util.spec_from_loader(loader.name, loader)
usage = importlib.util.module_from_spec(spec)
loader.exec_module(usage)

# Shape of `claude -p /usage` result text from Claude Code 2.1.x (2026-10-26).
USAGE_TEXT = (
    'You are currently using your subscription to power your Claude Code usage\n\n'
    'Current session: 40% used · resets Oct 26, 10:29pm (America/New_York)\n'
    'Current week (all models): 73% used · resets Oct 26, 11:59pm (America/New_York)\n\n'
    "What's contributing to your limits usage?\n"
    '  83%  Start fresh when you switch tasks · run /clear\n')


class ClaudeCliFallbackTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        env = patch.dict(os.environ, {
            'HOME': str(self.root), 'CLAUDE_CONFIG_DIR': str(self.root / '.claude'),
            'AGENT_USAGE_STATE_DIR': str(self.root), 'AGENT_USAGE_CACHE_DIR': str(self.root / 'cache'),
            'CLAUDE_BIN': str(self.root / 'missing-claude'), 'CODEX_BIN': str(self.root / 'missing-codex')})
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop('AGENT_USAGE_CLAUDE_DIRECT', None)

    def query(self, prefer_cli):
        fetch = Mock(side_effect=AssertionError('endpoint must not be called'))
        with patch.object(usage, '_claude_token', return_value=('token', 'pro', False)), \
                patch.object(usage, '_claude_fetch', fetch), \
                patch.object(usage, '_claude_cli_usage', return_value=USAGE_TEXT) as cli:
            try:
                return usage._query_claude_uncached(20, allow_cli=True, prefer_cli=prefer_cli), fetch, cli
            except AssertionError:
                return None, fetch, cli

    def test_prefer_cli_reads_both_windows_without_the_endpoint(self):
        account, fetch, cli = self.query(prefer_cli=True)
        fetch.assert_not_called()
        cli.assert_called_once()
        self.assertEqual([(w['label'], w['usedPercent'], w['windowMins']) for w in account['limits']],
                         [('5 hours', 40, 300), ('Weekly', 73, 10080)])
        self.assertTrue(all(w['resetsAt'] for w in account['limits']))

    def test_default_query_still_tries_the_endpoint_first(self):
        _, fetch, _ = self.query(prefer_cli=False)
        fetch.assert_called()

    def test_service_prefers_cli_unless_direct_is_opted_in(self):
        with patch.object(usage, 'query_claude', return_value={}) as query:
            shared.UsageService(usage, [], include_agy=False, root=self.root).queries['claude']()
            self.assertEqual((query.call_args.kwargs['allow_cli'], query.call_args.kwargs['prefer_cli']), (True, True))
            with patch.dict(os.environ, {'AGENT_USAGE_CLAUDE_DIRECT': '1'}):
                shared.UsageService(usage, [], include_agy=False, root=self.root).queries['claude']()
            self.assertEqual((query.call_args.kwargs['allow_cli'], query.call_args.kwargs['prefer_cli']), (False, False))

    def test_cli_runs_with_local_bin_on_path(self):
        # Claude's sandbox needs socat from ~/.local/bin, which a systemd PATH lacks.
        binary = self.root / 'bin' / 'claude'
        done = Mock(returncode=0, stdout='{"result": "usage"}', stderr='')
        with patch.dict(os.environ, {'PATH': '/usr/bin:/bin'}), \
                patch.object(usage, '_claude_cli', return_value=(str(binary), (2, 1, 311))), \
                patch.object(usage.subprocess, 'run', return_value=done) as run:
            usage._claude_cli_usage(30)
        path = run.call_args.kwargs['env']['PATH'].split(os.pathsep)
        self.assertEqual(path[:2], [str(binary.parent), str(self.root / '.local' / 'bin')])
        self.assertIn('/usr/bin', path)


if __name__ == '__main__':
    unittest.main()
