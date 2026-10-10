'use strict';
const {contextBridge,ipcRenderer} = require('electron');
const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('minuteDesktop', {
  updates: {
    status: () => ipcRenderer.invoke('minute:updates-status'),
    check: () => ipcRenderer.invoke('minute:updates-check'),
    download: () => ipcRenderer.invoke('minute:updates-download'),
    install: () => ipcRenderer.invoke('minute:updates-install'),
    onStatus: callback => subscribe('minute:updates', callback),
    onPrepare: callback => subscribe('minute:update-prepare', callback),
    onCancel: callback => subscribe('minute:update-cancel', callback),
    checkpoint: payload => ipcRenderer.invoke('minute:update-checkpoint', payload)
  },
  getSummary: () => ipcRenderer.invoke('minute:summary'),
  setEnabled: enabled => ipcRenderer.invoke('minute:set-enabled',enabled),
  setIdleThreshold: seconds => ipcRenderer.invoke('minute:set-idle',seconds),
  setOtherApps: enabled => ipcRenderer.invoke('minute:set-other-apps',enabled),
  clearActivity: () => ipcRenderer.invoke('minute:clear'),
  exportCsv: () => ipcRenderer.invoke('minute:export-csv'),
  onSummary: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('minute:update',listener);
    return () => ipcRenderer.removeListener('minute:update',listener);
  }
});
