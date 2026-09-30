'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { sessionUrl } = require('./alerts.cjs');
function codeLocations(env = process.env) {
  return [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Microsoft VS Code', 'Code.exe')].filter(Boolean);
}
const installed = new Map();
async function installHelper(executable, helper, run = execFile) {
  const cli = path.join(path.dirname(executable), 'resources', 'app', 'out', 'cli.js');
  const key = executable + ':' + helper;
  if (!installed.has(key)) {
    const promise = new Promise((resolve, reject) => run(executable, [cli, '--install-extension', helper, '--force'],
      { windowsHide: true, timeout: 30000, maxBuffer: 65536, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
      error => error ? reject(new Error('The VS Code terminal helper could not be installed. Open VS Code and try again.')) : resolve()));
    installed.set(key, promise); promise.catch(() => installed.delete(key));
  }
  return installed.get(key);
}
async function openSession(target, shell, { locations = codeLocations(), exists = fs.existsSync, launch = spawn,
  protocolName = () => '', helper = path.join(process.resourcesPath || path.join(__dirname, 'resources'), 'agent-usage-link.vsix'), ensureHelper = installHelper } = {}) {
  const url = sessionUrl(target);
  if (!url) return false;
  const executable = locations.find(exists);
  if (executable) {
    if (target.terminalPids?.length) await ensureHelper(executable, helper);
    // Fixed executable paths and validated session UUIDs; never pass a shell command or prompt.
    await new Promise((resolve, reject) => {
      const child = launch(executable, ['--open-url', '--', url], { windowsHide: true, detached: true, stdio: 'ignore' });
      child.once('error', () => reject(new Error('VS Code could not be started.')));
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  } else {
    if (!protocolName(url)) throw new Error('VS Code was not found. Install VS Code or register its vscode: links.');
    await shell.openExternal(url);
  }
  return true;
}
module.exports = { codeLocations, openSession, installHelper };
