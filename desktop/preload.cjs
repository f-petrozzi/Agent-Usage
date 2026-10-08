'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
// Fixed channels only; main validates the command and sender for every invocation.
contextBridge.exposeInMainWorld('agentUsage', {
  filePath: file => webUtils.getPathForFile(file),
  invoke: (command, args = {}) => ipcRenderer.invoke('command', command, args),
  on: (name, callback) => {
    const listener = (_event, eventName, payload) => { if (eventName === name) callback(payload); };
    ipcRenderer.on('event', listener);
    return () => ipcRenderer.removeListener('event', listener);
  }
});
