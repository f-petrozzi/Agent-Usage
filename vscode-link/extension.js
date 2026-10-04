'use strict';
function linkPayload(query) {
  const parameters = new URLSearchParams(query);
  const encoded = parameters.get('target');
  if (encoded !== null) {
    if (encoded.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
    try {
      const buffer = Buffer.from(encoded, 'base64url');
      if (buffer.toString('base64url') !== encoded) return null;
      const payload = JSON.parse(buffer.toString('utf8'));
      return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    } catch { return null; }
  }
  // Legacy links remain readable where VS Code has not consumed their session parameter.
  return { provider: parameters.get('provider'), sessionId: parameters.get('session'), pids: (parameters.get('pids') || '').split(',').map(Number),
    cwd: parameters.get('cwd'), home: parameters.get('home'), remote: parameters.get('remote') };
}
function parseLink(uri, providers = ['claude', 'codex']) {
  if (uri.path !== '/open') return null;
  const payload = linkPayload(uri.query); if (!payload) return null;
  const { provider, sessionId } = payload;
  if (!providers.includes(provider) || typeof sessionId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(sessionId)) return null;
  const pids = (Array.isArray(payload.pids) ? payload.pids : []).slice(0, 16).filter(n => Number.isInteger(n) && n > 1 && n <= 2147483647);
  return { provider, sessionId, pids, cwd: payload.cwd || '' };
}
// A link can arrive while VS Code is still starting (the link itself may have launched it), before a restored remote
// workspace has reconnected and brought its terminals back. Until STARTUP_MS after the helper woke, a link with no
// matching terminal yet waits for terminals to arrive rather than falling straight back to the conversation.
const STARTUP_MS = 15000;
let activatedAt = 0;
const settle = (promise, ms) => { let timer; return Promise.race([promise, new Promise(resolve => { timer = setTimeout(resolve, ms); })]).finally(() => clearTimeout(timer)); };
async function matchTerminal(vscode, pids) {
  if (!pids.length) return null;
  const terminals = await Promise.all(vscode.window.terminals.filter(t => t.exitStatus === undefined)
    .map(async t => ({ terminal: t, pid: await settle(t.processId, 1000) })));
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
const validPath = value => typeof value === 'string' && value.startsWith('/') && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value);
function parseResume(uri) {
  if (uri.path !== '/resume') return null;
  const payload = linkPayload(uri.query), link = parseLink({ path: '/open', query: uri.query }, ['claude', 'codex', 'antigravity']);
  const home = payload?.home, remote = payload?.remote;
  if (!link || !validPath(link.cwd) || !validPath(home)
    || !/^(?:ssh-remote\+[A-Za-z0-9_][A-Za-z0-9._-]*(?:@[A-Za-z0-9_][A-Za-z0-9._-]*)?|wsl\+[A-Za-z0-9._-]{1,120})$/.test(remote || '')) return null;
  const reply = payload.reply;
  if (reply && (!Number.isInteger(reply.port) || reply.port < 1024 || reply.port > 65535 || !/^[a-f0-9]{48}$/.test(reply.token || ''))) return null;
  return { ...link, home, remote, live: payload.live === true, title: cleanTitle(payload.title), ...(reply ? { reply: { port: reply.port, token: reply.token } } : {}) };
}
async function sendReceipt(reply, status, message) {
  if (!reply) return;
  const body = JSON.stringify({ status, ...(message ? { message: String(message).slice(0, 600) } : {}) });
  await new Promise(resolve => {
    const request = require('node:http').request({ hostname: '127.0.0.1', port: reply.port, path: '/' + reply.token, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => { response.resume(); resolve(); });
    request.on('error', () => resolve()); request.setTimeout(2000, () => { request.destroy(); resolve(); }); request.end(body);
  });
}
// Terminal labels are display metadata only; they never enter a shell command.
const cleanTitle = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
function terminalName(target) {
  const agent = {codex:'Codex',claude:'Claude',antigravity:'AGY'}[target.provider];
  const title = cleanTitle(target.title) || cleanTitle(target.cwd?.split('/').filter(Boolean).at(-1)) || target.sessionId.slice(0, 8);
  return `${agent} · ${title}`;
}
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
function resumeCommand(target) {
  if (target.provider === 'antigravity') return `exec agy --conversation ${quote(target.sessionId)}`;
  // Every argument is quoted; only these two fixed CLI invocations can be launched. No prompt or permission override.
  if (target.provider === 'codex') return `exec env CODEX_HOME=${quote(target.home)} codex resume ${quote(target.sessionId)}`;
  // The default directory has a sibling ~/.claude.json. Setting CLAUDE_CONFIG_DIR even
  // to ~/.claude relocates that onboarding file. Compare on the remote host, not Windows.
  return `if [ ${quote(target.home.replace(/\/+$/, ''))} = "$HOME/.claude" ]; then exec env -u CLAUDE_CONFIG_DIR claude --resume ${quote(target.sessionId)}; else exec env CLAUDE_CONFIG_DIR=${quote(target.home)} claude --resume ${quote(target.sessionId)}; fi`;
}
const resumed = new Map();
function localResumeOptions(vscode, target, host) {
  // This is a UI extension, so the Windows home is local even in an SSH window. A file URI explicitly
  // selects Code's local terminal backend instead of executing ssh.exe on the workspace's remote host.
  if(host.platform!=='win32')return null;
  const cwd=vscode.Uri.file(host.home);
  if(target.remote.startsWith('wsl+'))return {cwd,shellPath:'wsl.exe',
    shellArgs:['--distribution',target.remote.slice(4),'--cd',target.cwd,'--exec','/bin/bash','-ilc',resumeCommand(target)]};
  const command=`cd -- ${quote(target.cwd)} && ${resumeCommand(target)}`;
  return {cwd,shellPath:'ssh.exe',shellArgs:['-t',target.remote.slice('ssh-remote+'.length),`exec /bin/bash -ilc ${quote(command)}`]};
}
const localHost=()=>({platform:process.platform,home:require('node:os').homedir()});
// SSH authorities are aliases, not host identities: "homelab" and "fab@homelab" may
// describe the same connection. Ask the user's SSH client for effective configuration;
// do not drop the username or match terminals by title/path alone. -G does not connect.
async function sshConnection(alias, platform, run = require('node:child_process').execFile) {
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]*(?:@[A-Za-z0-9_][A-Za-z0-9._-]*)?$/.test(alias)) return null;
  return new Promise(resolve => run(platform === 'win32' ? 'ssh.exe' : 'ssh', ['-G', alias],
    { windowsHide: true, timeout: 3000, maxBuffer: 1 << 20 }, (error, stdout) => {
      if (error) { resolve(null); return; }
      const config = new Map(String(stdout).split(/\r?\n/).map(line => {
        const at = line.indexOf(' '); return [line.slice(0, at), line.slice(at + 1).trim()];
      }));
      const hostname = config.get('hostname'), user = config.get('user'), port = config.get('port');
      if (!hostname || !user || !/^\d+$/.test(port || '') || +port < 1 || +port > 65535) { resolve(null); return; }
      resolve(JSON.stringify([hostname.toLowerCase().replace(/\.$/, ''), user, +port,
        config.get('proxyjump') || 'none', config.get('proxycommand') || 'none']));
    }));
}
async function matchingRemote(folders, target, host, resolveSsh) {
  const authorities = [...new Set(folders.filter(f => f.uri.scheme === 'vscode-remote').map(f => f.uri.authority))];
  if (authorities.includes(target.remote)) return target.remote;
  if (!target.remote.startsWith('ssh-remote+')) return null;
  const ssh = authorities.filter(authority => authority.startsWith('ssh-remote+'));
  if (!ssh.length) return null;
  const keys = await Promise.all([target.remote, ...ssh].map(authority => resolveSsh(authority.slice('ssh-remote+'.length), host.platform)));
  const index = ssh.findIndex((_, i) => keys[0] && keys[i + 1] === keys[0]);
  return index < 0 ? null : ssh[index];
}
async function handleResume(vscode, context, uri, until = activatedAt + STARTUP_MS, host = localHost(), resolveSsh = sshConnection) {
  const target = parseResume(uri); if (!target) throw new Error('The session link is invalid. Update Agent Usage and its VS Code helper, then try again.');
  const folders = vscode.workspace.workspaceFolders || [];
  const remote = await matchingRemote(folders, target, host, resolveSsh);
  const key = JSON.stringify([target.provider,target.remote,target.home,target.sessionId]);
  // Fresh writer ancestry takes precedence over a helper-created tab: an earlier
  // failed duplicate resume can still have the correct scope label after reload.
  if (remote) {
    const terminal = await findTerminal(vscode, target.pids, until);
    if (terminal) { terminal.show(false); return true; }
  }
  const restored = vscode.window.terminals.find(t=>t.exitStatus===undefined&&t.creationOptions?.env?.AGENT_USAGE_SESSION_SCOPE===key);
  const previous = restored || resumed.get(key);
  if (previous && previous.exitStatus===undefined && vscode.window.terminals.includes(previous)) { previous.show(false); return true; }
  if (target.live) throw new Error('This session is already running, but its terminal was not found in this VS Code window. Switch to its SSH/WSL window and try again. No duplicate session was started.');
  // A terminal may start anywhere on this host; the open editor folder does not have to contain the session.
  // If the window uses another host or a local folder, connect from a local terminal in this window.
  const options = remote ? {
    cwd: vscode.Uri.from({ scheme: 'vscode-remote', authority: remote, path: target.cwd }),
    shellPath: '/bin/bash', shellArgs: ['-ilc', resumeCommand(target)]
  } : localResumeOptions(vscode,target,host);
  if(options){
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace in VS Code before resuming its agent session.');
    const created = vscode.window.createTerminal({
      name: terminalName(target),
      location: vscode.TerminalLocation?.Panel ?? 1, ...options, env:{AGENT_USAGE_SESSION_SCOPE:key} });
    resumed.set(key, created); created.show(false); return true;
  }
  // A UI extension persists the validated request locally; the new remote window consumes it after reconnecting.
  await context.globalState.update('pendingResume', { query: uri.query, at: Date.now() });
  try {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.from({ scheme: 'vscode-remote', authority: target.remote, path: target.cwd }), { forceNewWindow: true });
  } catch (error) {
    await context.globalState.update('pendingResume', undefined); throw error;
  }
  return false;
}
async function dispatchResume(vscode, context, uri, until = activatedAt + STARTUP_MS, host = localHost(), resolveSsh = sshConnection) {
  const target = parseResume(uri);
  if (!target) throw new Error('The session link is invalid. Update Agent Usage and its VS Code helper, then try again.');
  await sendReceipt(target.reply, 'received');
  try {
    const opened = await handleResume(vscode, context, uri, until, host, resolveSsh);
    if (opened) await sendReceipt(target.reply, 'opened');
    return opened;
  } catch (error) { await sendReceipt(target.reply, 'error', error.message); throw error; }
}
async function restoreResume(vscode, context) {
  const pending = context.globalState.get('pendingResume');
  if (!pending) return;
  const uri = { path: '/resume', query: pending.query }, target = parseResume(uri);
  if (!target || Date.now() - pending.at > 300000) { await context.globalState.update('pendingResume', undefined); return; }
  if (!(vscode.workspace.workspaceFolders || []).some(f => f.uri.scheme === 'vscode-remote' && f.uri.authority === target.remote && f.uri.path.replace(/\/$/, '') === target.cwd.replace(/\/$/, ''))) return;
  await context.globalState.update('pendingResume', undefined);
  await dispatchResume(vscode, context, uri);
}
function activate(context) {
  activatedAt = Date.now();
  const vscode = require('vscode');
  const report = error => vscode.window.showErrorMessage('Agent Usage could not resume this session: ' + error.message);
  context.subscriptions.push(vscode.window.registerUriHandler({ handleUri: uri =>
    (uri.path === '/resume' ? dispatchResume(vscode, context, uri) : handleLink(vscode, uri)).catch(report) }));
  restoreResume(vscode, context).catch(report);
}
module.exports = { activate, parseLink, handleLink, parseResume, resumeCommand, localResumeOptions, handleResume, restoreResume, dispatchResume, sendReceipt, terminalName, sshConnection };
