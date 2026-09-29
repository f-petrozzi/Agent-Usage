'use strict';
// Only the narrow compatibility surface used by the adopted Windows pages.
window.__TAURI__ = {
  core: { invoke: (command, args) => window.agentUsage.invoke(command, args) },
  event: { listen: (name, callback) => Promise.resolve(window.agentUsage.on(name, payload => callback({payload}))) },
  window: { getCurrentWindow: () => ({close: () => window.agentUsage.invoke('close_settings')}) },
  app: { getVersion: () => window.agentUsage.invoke('get_version') }
};
