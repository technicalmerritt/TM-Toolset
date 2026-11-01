'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  list: () => ipcRenderer.invoke('tools:list'),
  save: (tool) => ipcRenderer.invoke('tools:save', tool),
  remove: (id) => ipcRenderer.invoke('tools:delete', id),
  launch: (id) => ipcRenderer.invoke('tools:launch', id),
  pickExe: () => ipcRenderer.invoke('dialog:pickExe'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  revealConfig: () => ipcRenderer.invoke('config:reveal'),
  onLaunchError: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('tools:launch-error', handler);
    return () => ipcRenderer.removeListener('tools:launch-error', handler);
  },
});

contextBridge.exposeInMainWorld('scanner', {
  run: () => ipcRenderer.invoke('scan:run'),
  cancel: () => ipcRenderer.invoke('scan:cancel'),
  exportReport: (result) => ipcRenderer.invoke('scan:export', result),
  onProgress: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('scan:progress', handler);
    return () => ipcRenderer.removeListener('scan:progress', handler);
  },
});
