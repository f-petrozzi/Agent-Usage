'use strict';
function parseLink(uri) {
  if (uri.path !== '/open') return null;
  const query = new URLSearchParams(uri.query), provider = query.get('provider'), sessionId = query.get('session');
  if (!['claude', 'codex'].includes(provider) || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(sessionId || '')) return null;
  const pids = (query.get('pids') || '').split(',').slice(0, 16).map(Number).filter(n => Number.isInteger(n) && n > 1 && n <= 2147483647);
  return { provider, sessionId, pids, cwd: query.get('cwd') || '' };
}
async function handleLink(vscode, uri) {
  const target = parseLink(uri); if (!target) return;
  const terminals = await Promise.all(vscode.window.terminals.map(async t => ({ terminal: t, pid: await t.processId })));
  for (const pid of target.pids) {
    const match = terminals.find(t => t.pid === pid);
    if (match) { match.terminal.show(false); return; }
  }
  const folders = vscode.workspace.workspaceFolders || [];
  if (target.cwd && !folders.some(f => {
    const root = f.uri.path.replace(/\/$/, ''); return target.cwd === root || target.cwd.startsWith(root + '/');
  })) {
    vscode.window.showInformationMessage('Open the matching workspace to locate this session’s terminal.'); return;
  }
  const fallback = target.provider === 'claude' ? `vscode://anthropic.claude-code/open?session=${target.sessionId}`
    : `vscode://openai.chatgpt/local/${target.sessionId}`;
  await vscode.env.openExternal(vscode.Uri.parse(fallback));
}
function activate(context) {
  const vscode = require('vscode');
  context.subscriptions.push(vscode.window.registerUriHandler({ handleUri: uri => handleLink(vscode, uri) }));
}
module.exports = { activate, parseLink, handleLink };
