'use strict';
// The updater owns its network session. Renderers remain local and network-blocked.
function createUpdates({ app, updater, installed, onChange, beforeInstall = () => {} }) {
  let state = { status: installed ? 'idle' : 'unavailable', currentVersion: app.getVersion(), version: null, percent: 0 };
  let timer, interval, operation;
  const set = patch => { state = { ...state, ...patch }; onChange({ ...state }); };
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  updater.allowPrerelease = false;
  updater.disableWebInstaller = true;
  const fail = () => set({ status: 'error', percent: 0 });
  updater.on('error', fail);
  updater.on('checking-for-update', () => set({ status: 'checking' }));
  updater.on('update-available', info => set({ status: 'available', version: info.version, percent: 0 }));
  updater.on('update-not-available', () => set({ status: 'current', version: null, percent: 0 }));
  updater.on('download-progress', progress => {
    const percent = Math.max(0, Math.min(100, Math.floor(progress.percent || 0)));
    if (percent !== state.percent) set({ status: 'downloading', percent });
  });
  updater.on('update-downloaded', info => set({ status: 'ready', version: info.version, percent: 100 }));
  updater.on('update-cancelled', () => set({ status: 'available', percent: 0 }));
  async function check() {
    if (!installed || operation || ['ready', 'installing', 'available'].includes(state.status)) return;
    operation = 'check';
    try { await updater.checkForUpdates(); } catch { fail(); } finally { operation = null; }
  }
  async function download() {
    if (!installed || operation || state.status !== 'available') return;
    operation = 'download';set({ status: 'downloading', percent: 0 });
    try { await updater.downloadUpdate(); } catch { fail(); } finally { operation = null; }
  }
  function install() {
    if (!installed || operation || state.status !== 'ready') return;
    set({ status: 'installing' });
    try { beforeInstall(); updater.quitAndInstall(true, true); } catch { fail(); }
  }
  function start() {
    if (!installed) return;
    timer = setTimeout(() => { void check(); }, 30000);
    interval = setInterval(() => { if (['idle', 'current', 'error'].includes(state.status)) void check(); }, 6 * 60 * 60 * 1000);
    timer.unref?.();interval.unref?.();
  }
  return { get: () => ({ ...state }), check, download, install, start,
    close: () => { clearTimeout(timer);clearInterval(interval); } };
}
module.exports = { createUpdates };
