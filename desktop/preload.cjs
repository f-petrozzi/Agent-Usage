'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Fixed channels only; main validates the command and sender for every invocation.
contextBridge.exposeInMainWorld('agentUsage', {
  invoke: (command, args = {}) => ipcRenderer.invoke('command', command, args),
  on: (name, callback) => {
    const listener = (_event, eventName, payload) => { if (eventName === name) callback(payload); };
    ipcRenderer.on('event', listener);
    return () => ipcRenderer.removeListener('event', listener);
  }
});
