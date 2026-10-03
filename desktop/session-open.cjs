'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { sessionUrl } = require('./alerts.cjs');
const { validHost, validLinuxPath } = require('./collector.cjs');
function resumeUrl(target, reply) {
  if (!target || !['claude', 'codex', 'antigravity'].includes(target.provider) || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(target.sessionId || '')
    || !validLinuxPath(target.cwd) || !validLinuxPath(target.agentHome)) return null;
  const remote = target.source === 'ssh' && validHost(target.sshTarget) ? 'ssh-remote+' + target.sshTarget
    : target.source === 'wsl' && /^[A-Za-z0-9._-]{1,120}$/.test(target.wslDistro || '') ? 'wsl+' + target.wslDistro : '';
  if (!remote) return null;
  const pids = (target.terminalPids || []).filter(n => Number.isInteger(n) && n > 1 && n <= 2147483647).slice(0, 16);
  // VS Code percent-decodes URI.query and reserves `session` for its own chats. An opaque URL-safe payload
  // survives both steps without corrupting '+' SSH authorities or '&'/'%' in paths.
  const payload = { provider: target.provider, sessionId: target.sessionId, cwd: target.cwd, home: target.agentHome, remote, pids,
    ...(reply ? { reply } : {}) };
  return `vscode://f-petrozzi.agent-usage-link/resume?target=${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
}
async function createReceipt({ initialMs = 25000, receivedMs = 120000 } = {}) {
  const token = randomBytes(24).toString('hex');
  let resolve, reject, timer, done = false, received = false;
  const result = new Promise((yes, no) => { resolve = yes; reject = no; });
  result.catch(() => {}); // A launch error can dispose it before the caller starts awaiting it.
  const close = () => { clearTimeout(timer); server.close(); server.closeAllConnections(); };
  const finish = error => { if (done) return; done = true; error ? reject(error) : resolve(true); close(); };
  const arm = ms => { clearTimeout(timer); timer = setTimeout(() => finish(new Error(received
    ? 'VS Code received the session link but did not finish opening it. Check its connection or workspace trust prompt, then try again.'
    : 'VS Code did not respond to the session link. Run Developer: Reload Window in VS Code, then try again. Check that Agent Usage Link is enabled.')), ms); };
  const server = http.createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/' + token || request.headers.origin) { response.writeHead(404).end(); return; }
    let body = '';
    request.on('data', chunk => { body += chunk; if (body.length > 4096) request.destroy(); });
    request.on('end', () => {
      let message; try { message = JSON.parse(body); } catch { response.writeHead(400).end(); return; }
      if (!['received', 'opened', 'error'].includes(message?.status)) { response.writeHead(400).end(); return; }
      response.writeHead(204).end();
      if (message.status === 'received') { if (!received) { received = true; arm(receivedMs); } }
      else if (message.status === 'opened') finish();
      else finish(new Error(String(message.message || 'VS Code could not open the session.').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 600)));
    });
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  arm(initialMs);
  return { reply: { port: server.address().port, token }, result, close: () => { done = true; resolve(false); close(); } };
}
function codeLocations(env = process.env) {
  return [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Microsoft VS Code', 'Code.exe')].filter(Boolean);
}
const installed = new Map();
function codeCli(executable, { exists = fs.existsSync, read = fs.readFileSync } = {}) {
  const root = path.dirname(executable), bin = path.join(root, 'bin');
  // Follow the installed wrapper's entrypoint rather than assuming Code's layout.
  try {
    const match = read(path.join(bin, 'code.cmd'), 'utf8').match(/"%~dp0([^"\r\n]*cli\.js)"/i);
    if (match) {
      const cli = path.resolve(bin, match[1].replace(/\\/g, path.sep));
      if (exists(cli)) return cli;
    }
  } catch {}
  const cli = path.join(root, 'resources', 'app', 'out', 'cli.js');
  if (exists(cli)) return cli;
  throw new Error('VS Code’s command-line installer was not found. Finish updating VS Code, then try again.');
}
function installFailure(error, stdout, stderr) {
  const detail = error.killed ? 'Installation timed out after 60 seconds.'
    : String(stderr || stdout || error.message || '').replace(/\x1b\[[0-9;]*m/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim().slice(0, 600);
  return new Error('The VS Code terminal helper could not be installed. ' + detail);
}
// The bundled helper's identity; tests keep it equal to vscode-link/package.json.
const HELPER = { id: 'f-petrozzi.agent-usage-link', version: '0.2.2' };
// Installed only when VS Code lacks this version. Reinstalling it on every launch (as --force did) replaced the helper
// under a running VS Code window, which then dropped the first link until a new window was opened.
async function installHelper(executable, helper, run = execFile, { exists = fs.existsSync, read = fs.readFileSync, env = process.env, extraArgs = [] } = {}) {
  if (!exists(helper)) throw new Error('The bundled VS Code helper is missing. Reinstall the latest Agent Usage update.');
  const cli = codeCli(executable, { exists, read });
  const key = executable + ':' + helper;
  const first = !installed.has(key);
  if (!installed.has(key)) {
    const options = { windowsHide: true, timeout: 60000, maxBuffer: 1 << 20, env: { ...env, VSCODE_DEV: '', ELECTRON_RUN_AS_NODE: '1' } };
    const code = args => new Promise((resolve, reject) => run(executable, [cli, ...args, ...extraArgs], options,
      (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve(String(stdout || ''))));
    const wanted = `${HELPER.id}@${HELPER.version}`.toLowerCase();
    // A listing that fails only means installing anyway, as before
    const promise = code(['--list-extensions', '--show-versions']).catch(() => '')
      .then(list => list.split(/\r?\n/).some(line => line.trim().toLowerCase() === wanted) ? false
        : code(['--install-extension', helper, '--force']).then(() => true, error => { throw installFailure(error, error.stdout, error.stderr); }));
    installed.set(key, promise); promise.catch(() => installed.delete(key));
  }
  const changed = await installed.get(key);
  return first && changed;
}
async function prepareHelper({locations=codeLocations(),exists=fs.existsSync,ensureHelper=installHelper,
  helper=path.join(process.resourcesPath || path.join(__dirname,'resources'),'agent-usage-link.vsix')}={}){
  const executable=locations.find(exists);
  return executable?ensureHelper(executable,helper):false;
}
async function openSession(target, shell, { locations = codeLocations(), exists = fs.existsSync, launch = spawn,
  protocolName = () => '', helper = path.join(process.resourcesPath || path.join(__dirname, 'resources'), 'agent-usage-link.vsix'), ensureHelper = installHelper, receiptFactory = createReceipt } = {}) {
  let url = target?.resume ? resumeUrl(target) : sessionUrl(target);
  if (!url) return false;
  const executable = locations.find(exists);
  if (executable) {
    if(target.resume || target.terminalPids?.length)await ensureHelper(executable, helper);
    const receipt = target.resume ? await receiptFactory() : null;
    if (receipt) url = resumeUrl(target, receipt.reply);
    // Keep normal routing to the active Code window, including after helper installation. An older running
    // helper may need Reload Window once; forcing _blank here defeated the user's existing-window preference.
    // Fixed executable paths and validated session UUIDs; never pass a shell command or prompt.
    try { await new Promise((resolve, reject) => {
      const child = launch(executable, [...(target.resume?['--reuse-window']:[]),'--open-url', '--', url], { windowsHide: true, detached: true, stdio: 'ignore' });
      child.once('error', () => reject(new Error('VS Code could not be started.')));
      child.once('spawn', () => { child.unref(); resolve(); });
    });
    if (receipt) await receipt.result;
    } finally { receipt?.close(); }
  } else {
    if (target.resume) throw new Error('Install the standard Windows VS Code build so Agent Usage can install its session helper.');
    if (!protocolName(url)) throw new Error('VS Code was not found. Install VS Code or register its vscode: links.');
    await shell.openExternal(url);
  }
  return true;
}
module.exports = { HELPER, codeLocations, codeCli, openSession, installHelper, prepareHelper, resumeUrl, createReceipt };
