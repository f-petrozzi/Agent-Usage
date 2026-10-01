'use strict';
function parseLink(uri) {
  if (uri.path !== '/open') return null;
  const query = new URLSearchParams(uri.query), provider = query.get('provider'), sessionId = query.get('session');
  if (!['claude', 'codex'].includes(provider) || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(sessionId || '')) return null;
  const pids = (query.get('pids') || '').split(',').slice(0, 16).map(Number).filter(n => Number.isInteger(n) && n > 1 && n <= 2147483647);
  return { provider, sessionId, pids, cwd: query.get('cwd') || '' };
}
// A link can arrive while VS Code is still starting (the link itself may have launched it), before a restored remote
// workspace has reconnected and brought its terminals back. Until STARTUP_MS after the helper woke, a link with no
// matching terminal yet waits for terminals to arrive rather than falling straight back to the conversation.
const STARTUP_MS = 15000;
let activatedAt = 0;
const settle = (promise, ms) => { let timer; return Promise.race([promise, new Promise(resolve => { timer = setTimeout(resolve, ms); })]).finally(() => clearTimeout(timer)); };
async function matchTerminal(vscode, pids) {
  const terminals = await Promise.all(vscode.window.terminals.map(async t => ({ terminal: t, pid: await settle(t.processId, 1000) })));
  for (const pid of pids) {
    const match = terminals.find(t => t.pid === pid);
    if (match) return match.terminal;
  }
  return null;
}
async function findTerminal(vscode, pids, until) {
  for (;;) {
    const terminal = await matchTerminal(vscode, pids), left = until - Date.now();
    if (terminal || !pids.length || left <= 0) return terminal;
    await new Promise(resolve => {
      const done = () => { clearTimeout(timer); opened.dispose(); resolve(); };
      const timer = setTimeout(done, Math.min(left, 1000)), opened = vscode.window.onDidOpenTerminal(done);
    });
  }
}
async function handleLink(vscode, uri, until = activatedAt + STARTUP_MS) {
  const target = parseLink(uri); if (!target) return;
  const terminal = await findTerminal(vscode, target.pids, until);
  if (terminal) { terminal.show(false); return; }
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
  activatedAt = Date.now();
  const vscode = require('vscode');
  context.subscriptions.push(vscode.window.registerUriHandler({ handleUri: uri => handleLink(vscode, uri) }));
}
module.exports = { activate, parseLink, handleLink };
