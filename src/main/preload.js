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

contextBridge.exposeInMainWorld('inform', {
  run: () => ipcRenderer.invoke('inform:run'),
  exportText: (data) => ipcRenderer.invoke('inform:export', data),
  onProgress: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('inform:progress', handler);
    return () => ipcRenderer.removeListener('inform:progress', handler);
  },
});

contextBridge.exposeInMainWorld('sys', {
  open: (token) => ipcRenderer.invoke('action:open', token),
  openUrl: (url) => ipcRenderer.invoke('action:openUrl', url),
});

contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  save: (payload) => ipcRenderer.invoke('settings:save', payload),
  test: (payload) => ipcRenderer.invoke('settings:test', payload),
});

contextBridge.exposeInMainWorld('syncro', {
  lookup: (args) => ipcRenderer.invoke('syncro:lookup', args),
  postScan: (args) => ipcRenderer.invoke('syncro:postScan', args),
  assetTypes: () => ipcRenderer.invoke('syncro:assetTypes'),
  createAsset: (args) => ipcRenderer.invoke('syncro:createAsset', args),
});
