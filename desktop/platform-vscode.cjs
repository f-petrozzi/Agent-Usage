'use strict';
const fs = require('node:fs');
const path = require('node:path');
// Native discovery and invocation layout live here; session identity/routing is shared.
function codeLocations(env = process.env, platform = process.platform) {
  if (platform === 'darwin') return ['/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
    env.HOME && path.join(env.HOME, 'Applications/Visual Studio Code.app/Contents/MacOS/Electron')].filter(Boolean);
  return [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Microsoft VS Code', 'Code.exe')].filter(Boolean);
}
function codeCli(executable, { exists = fs.existsSync, read = fs.readFileSync } = {}) {
  const root = path.dirname(executable), bin = path.join(root, 'bin');
  try {
    const match = read(path.join(bin, 'code.cmd'), 'utf8').match(/"%~dp0([^"\r\n]*cli\.js)"/i);
    if (match) { const cli = path.resolve(bin, match[1].replace(/\\/g, path.sep)); if (exists(cli)) return cli; }
  } catch {}
  for (const cli of [path.join(root, 'resources', 'app', 'out', 'cli.js'), path.join(root, '..', 'Resources', 'app', 'out', 'cli.js')]) {
    if (exists(cli)) return cli;
  }
  throw new Error('VS Code’s command-line installer was not found. Finish updating VS Code, then try again.');
}
module.exports = { codeLocations, codeCli };
