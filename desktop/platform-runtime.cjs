'use strict';
// Native executable names, available transports and install capabilities are not UI rules.
function collectorCommand(cfg, flags, sshOptions = [], platform = process.platform) {
  if (cfg.source === 'ssh') return [platform === 'win32' ? 'ssh.exe' : 'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new', ...sshOptions,
      cfg.sshTarget, `~/.local/bin/agent-usage ${flags}`]];
  if (platform === 'darwin') return null; // The first Mac implementation will use SSH, not WSL.
  return ['wsl.exe', ['--exec', 'sh', '-lc', `exec "$HOME/.local/bin/agent-usage" ${flags}`]];
}
function canInstallUpdates({ platform = process.platform, packaged, exists, resource }) {
  return platform === 'win32' && packaged && exists(resource('installer-managed'));
}
module.exports = { collectorCommand, canInstallUpdates };
