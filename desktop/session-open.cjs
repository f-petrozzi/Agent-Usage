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
const HELPER = { id: 'f-petrozzi.agent-usage-link', version: '0.1.1' };
// Installed only when VS Code lacks this version. Reinstalling it on every launch (as --force did) replaced the helper
// under a running VS Code window, which then dropped the first link until a new window was opened.
async function installHelper(executable, helper, run = execFile, { exists = fs.existsSync, read = fs.readFileSync, env = process.env, extraArgs = [] } = {}) {
  if (!exists(helper)) throw new Error('The bundled VS Code helper is missing. Reinstall the latest Agent Usage update.');
  const cli = codeCli(executable, { exists, read });
  const key = executable + ':' + helper;
  if (!installed.has(key)) {
    const options = { windowsHide: true, timeout: 60000, maxBuffer: 1 << 20, env: { ...env, VSCODE_DEV: '', ELECTRON_RUN_AS_NODE: '1' } };
    const code = args => new Promise((resolve, reject) => run(executable, [cli, ...args, ...extraArgs], options,
      (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve(String(stdout || ''))));
    const wanted = `${HELPER.id}@${HELPER.version}`.toLowerCase();
    // A listing that fails only means installing anyway, as before
    const promise = code(['--list-extensions', '--show-versions']).catch(() => '')
      .then(list => list.split(/\r?\n/).some(line => line.trim().toLowerCase() === wanted) ? undefined
        : code(['--install-extension', helper, '--force']).then(() => undefined, error => { throw installFailure(error, error.stdout, error.stderr); }));
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
module.exports = { HELPER, codeLocations, codeCli, openSession, installHelper };
