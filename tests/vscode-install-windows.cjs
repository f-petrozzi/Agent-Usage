'use strict';
// Exercise the shipped VSIX and the real installer from Electron, using isolated Code data.
const path = require('node:path'), fs = require('node:fs');
const [executable, helper, temp] = process.argv.slice(2);
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(require('../desktop/node_modules/electron'), [__filename, executable, helper, temp],
    { stdio: 'inherit', timeout: 120000 });
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
const { app } = require('electron');
const { installHelper } = require('../desktop/session-open.cjs');
fs.mkdirSync(temp, { recursive: true });
app.setPath('userData', temp);
app.whenReady().then(async () => {
  const extensions = path.join(temp, 'extensions');
  await installHelper(executable, helper, undefined, {
    env: { ...process.env, VSCODE_DEV: '1' },
    extraArgs: ['--user-data-dir', path.join(temp, 'code-data'), '--extensions-dir', extensions, '--disable-telemetry']
  });
  const installed = fs.readdirSync(extensions).find(n => n.startsWith('f-petrozzi.agent-usage-link-'));
  if (!installed || !fs.existsSync(path.join(extensions, installed, 'extension.js'))) throw new Error('Helper was not installed.');
  console.log('PASS: packaged helper installs through the real Windows Code CLI from Electron');
  app.exit(0);
}).catch(error => { console.error(error.message); app.exit(1); });
