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
  dataInfo: () => ipcRenderer.invoke('tools:dataInfo'),
  toolsFeed: () => ipcRenderer.invoke('tools:feed'),
  toolsMarkSeen: (ids) => ipcRenderer.invoke('tools:markSeen', { ids }),
  toolsGetFeedUrl: () => ipcRenderer.invoke('tools:getFeedUrl'),
  toolsSetFeedUrl: (url) => ipcRenderer.invoke('tools:setFeedUrl', { url }),
  download: (args) => ipcRenderer.invoke('tools:download', args),
  importFile: (args) => ipcRenderer.invoke('tools:importFile', args),
  onDownloadProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('tools:download-progress', handler);
    return () => ipcRenderer.removeListener('tools:download-progress', handler);
  },
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

contextBridge.exposeInMainWorld('license', {
  status: () => ipcRenderer.invoke('license:status'),
  machineId: () => ipcRenderer.invoke('license:machineId'),
  activate: (key, email) => ipcRenderer.invoke('license:activate', { key, email }),
  deactivate: () => ipcRenderer.invoke('license:deactivate'),
});

contextBridge.exposeInMainWorld('updates', {
  check: () => ipcRenderer.invoke('updates:check'),
  apply: () => ipcRenderer.invoke('updates:apply'),
  repo: () => ipcRenderer.invoke('updates:repo'),
  onProgress: (cb) => ipcRenderer.on('update:progress', (_e, p) => cb(p)),
});

contextBridge.exposeInMainWorld('theme', {
  get: () => ipcRenderer.invoke('theme:get'),
  set: (theme) => ipcRenderer.invoke('theme:set', { theme }),
  pickLogo: () => ipcRenderer.invoke('theme:pickLogo'),
  setAppIcon: (value) => ipcRenderer.invoke('theme:appIcon', { value }),
  pickAppIcon: () => ipcRenderer.invoke('theme:pickAppIcon'),
});

contextBridge.exposeInMainWorld('appInfo', {
  version: () => ipcRenderer.invoke('app:version'),
  isElevated: () => ipcRenderer.invoke('app:isElevated'),
  relaunchElevated: () => ipcRenderer.invoke('app:relaunchElevated'),
});

contextBridge.exposeInMainWorld('startupItems', {
  list: () => ipcRenderer.invoke('startup:list'),
  toggle: (item, enable) => ipcRenderer.invoke('startup:toggle', { item, enable }),
});

contextBridge.exposeInMainWorld('drives', {
  list: () => ipcRenderer.invoke('drives:list'),
  surfaceTest: (disk) => ipcRenderer.invoke('drives:surface', { disk }),
  speedTest: (disk) => ipcRenderer.invoke('drives:speed', { disk }),
  capacityTest: (args) => ipcRenderer.invoke('drives:capacity', args),
  capacityCancel: () => ipcRenderer.invoke('drives:capacityCancel'),
  onTestProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('drives:test-progress', handler);
    return () => ipcRenderer.removeListener('drives:test-progress', handler);
  },
});

contextBridge.exposeInMainWorld('crash', {
  list: () => ipcRenderer.invoke('crash:list'),
});

contextBridge.exposeInMainWorld('news', {
  fetch: () => ipcRenderer.invoke('news:fetch'),
});

contextBridge.exposeInMainWorld('report', {
  saveHtml: (args) => ipcRenderer.invoke('report:saveHtml', args),
});

contextBridge.exposeInMainWorld('battery', {
  list: () => ipcRenderer.invoke('battery:list'),
});

contextBridge.exposeInMainWorld('devices', {
  list: () => ipcRenderer.invoke('devices:list'),
});

contextBridge.exposeInMainWorld('surface', {
  run: () => ipcRenderer.invoke('scan:surface'),
  onProgress: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('scan:surface-progress', handler);
    return () => ipcRenderer.removeListener('scan:surface-progress', handler);
  },
});

contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  save: (payload) => ipcRenderer.invoke('settings:save', payload),
  test: (payload) => ipcRenderer.invoke('settings:test', payload),
});

contextBridge.exposeInMainWorld('syncro', {
  lookup: (args) => ipcRenderer.invoke('syncro:lookup', args),
  postScan: (args) => ipcRenderer.invoke('syncro:postScan', args),
  postNote: (args) => ipcRenderer.invoke('syncro:postNote', args),
  assetTypes: () => ipcRenderer.invoke('syncro:assetTypes'),
  createAsset: (args) => ipcRenderer.invoke('syncro:createAsset', args),
});

contextBridge.exposeInMainWorld('repairs', {
  run: (action) => ipcRenderer.invoke('repairs:run', { action }),
  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('repairs:progress', handler);
    return () => ipcRenderer.removeListener('repairs:progress', handler);
  },
});

contextBridge.exposeInMainWorld('backup', {
  map: () => ipcRenderer.invoke('backup:map'),
  image: (args) => ipcRenderer.invoke('backup:image', args),
  mount: (args) => ipcRenderer.invoke('backup:mount', args),
  partition: (args) => ipcRenderer.invoke('backup:partition', args),
  pickImage: () => ipcRenderer.invoke('backup:pickImage'),
  pickSaveWim: (args) => ipcRenderer.invoke('backup:pickSaveWim', args),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  openPath: (p) => ipcRenderer.invoke('backup:openPath', p),
  bootRecovery: () => ipcRenderer.invoke('backup:bootRecovery'),
  onProgress: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('backup:progress', handler);
    return () => ipcRenderer.removeListener('backup:progress', handler);
  },
});

contextBridge.exposeInMainWorld('bios', {
  info: () => ipcRenderer.invoke('bios:info'),
  pickDump: () => ipcRenderer.invoke('bios:pickDump'),
  parse: (path) => ipcRenderer.invoke('bios:parse', { path }),
  analyze: (path) => ipcRenderer.invoke('bios:analyze', { path }),
  diff: (a, b) => ipcRenderer.invoke('bios:diff', { a, b }),
  preflight: (target, candidate) => ipcRenderer.invoke('bios:preflight', { target, candidate }),
  bitlocker: () => ipcRenderer.invoke('bios:bitlocker'),
  saveText: (name, text) => ipcRenderer.invoke('bios:saveText', { name, text }),
  cleanME: (args) => ipcRenderer.invoke('bios:cleanME', args),
  uefiReport: (path) => ipcRenderer.invoke('bios:uefiReport', { path }),
  openUefiTool: (path) => ipcRenderer.invoke('bios:openUefiTool', { path }),
  importFirmware: () => ipcRenderer.invoke('bios:importFirmware'),
  openFirmwareDir: () => ipcRenderer.invoke('bios:openFirmwareDir'),
  extractPackage: () => ipcRenderer.invoke('bios:extractPackage'),
  identityCapture: (note) => ipcRenderer.invoke('bios:identityCapture', { note }),
  identitySave: (card, note) => ipcRenderer.invoke('bios:identitySave', { card, note }),
  identityList: () => ipcRenderer.invoke('bios:identityList'),
  identityDelete: (file) => ipcRenderer.invoke('bios:identityDelete', { file }),
  identityOpenDir: () => ipcRenderer.invoke('bios:identityOpenDir'),
  getXgpro: () => ipcRenderer.invoke('bios:getXgpro'),
  pickXgpro: () => ipcRenderer.invoke('bios:pickXgpro'),
  launchXgpro: () => ipcRenderer.invoke('bios:launchXgpro'),
  onProgress: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('bios:progress', handler);
    return () => ipcRenderer.removeListener('bios:progress', handler);
  },
});

contextBridge.exposeInMainWorld('logs', {
  read: () => ipcRenderer.invoke('logs:read'),
  clear: () => ipcRenderer.invoke('logs:clear'),
  openDir: () => ipcRenderer.invoke('logs:openDir'),
});

contextBridge.exposeInMainWorld('m365', {
  feed: () => ipcRenderer.invoke('m365:feed'),
  markSeen: (ids) => ipcRenderer.invoke('m365:markSeen', { ids }),
  roadmap: () => ipcRenderer.invoke('m365:roadmap'),
  getFeedUrl: () => ipcRenderer.invoke('m365:getFeedUrl'),
  setFeedUrl: (url) => ipcRenderer.invoke('m365:setFeedUrl', { url }),
});

contextBridge.exposeInMainWorld('feedback', {
  list: () => ipcRenderer.invoke('feedback:list'),
  add: (item) => ipcRenderer.invoke('feedback:add', item),
  update: (patch) => ipcRenderer.invoke('feedback:update', patch),
  remove: (args) => ipcRenderer.invoke('feedback:remove', args),
  saveAudio: (data) => ipcRenderer.invoke('feedback:saveAudio', { data }),
  playAudio: (path) => ipcRenderer.invoke('feedback:playAudio', { path }),
  openDir: () => ipcRenderer.invoke('feedback:openDir'),
});

contextBridge.exposeInMainWorld('board', {
  openBoardview: (path) => ipcRenderer.invoke('board:openBoardview', { path }),
  openPdf: (path) => ipcRenderer.invoke('board:openPdf', { path }),
  pick: (kind) => ipcRenderer.invoke('board:pick', { kind }),
  importRef: (model) => ipcRenderer.invoke('board:import', { model }),
  importFolder: (model) => ipcRenderer.invoke('board:importFolder', { model }),
  list: () => ipcRenderer.invoke('board:list'),
  openLibDir: () => ipcRenderer.invoke('board:openLibDir'),
});

contextBridge.exposeInMainWorld('diag', {
  authenticity: () => ipcRenderer.invoke('diag:authenticity'),
  events: () => ipcRenderer.invoke('diag:events'),
});

contextBridge.exposeInMainWorld('debloat', {
  list: () => ipcRenderer.invoke('debloat:list'),
  uninstall: (kind, key) => ipcRenderer.invoke('debloat:uninstall', { kind, key }),
  onProgress: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('debloat:progress', handler);
    return () => ipcRenderer.removeListener('debloat:progress', handler);
  },
});

contextBridge.exposeInMainWorld('net', {
  info: () => ipcRenderer.invoke('net:info'),
  ping: (target) => ipcRenderer.invoke('net:ping', { target }),
  discover: () => ipcRenderer.invoke('net:discover'),
  setPrivate: () => ipcRenderer.invoke('net:setprivate'),
  speed: () => ipcRenderer.invoke('net:speed'),
  onProgress: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('net:progress', handler);
    return () => ipcRenderer.removeListener('net:progress', handler);
  },
});

contextBridge.exposeInMainWorld('drivers', {
  getLibrary: () => ipcRenderer.invoke('drivers:getLibrary'),
  setLibrary: (path) => ipcRenderer.invoke('drivers:setLibrary', { path }),
  scan: () => ipcRenderer.invoke('drivers:scan'),
  library: (args) => ipcRenderer.invoke('drivers:library', args),
  wu: (mode) => ipcRenderer.invoke('drivers:wu', { mode }),
  catalogSearch: (query) => ipcRenderer.invoke('drivers:catalogSearch', { query }),
  catalogDownload: (args) => ipcRenderer.invoke('drivers:catalogDownload', args),
  openLibrary: () => ipcRenderer.invoke('drivers:openLibrary'),
  pickFolder: () => ipcRenderer.invoke('drivers:pickFolder'),
  getSdi: () => ipcRenderer.invoke('drivers:getSdi'),
  setSdi: (args) => ipcRenderer.invoke('drivers:setSdi', args),
  pickSdiExe: () => ipcRenderer.invoke('drivers:pickSdiExe'),
  launchSdi: (args) => ipcRenderer.invoke('drivers:launchSdi', args),
  packsList: () => ipcRenderer.invoke('drivers:packsList'),
  packsFetch: (scope) => ipcRenderer.invoke('drivers:packsFetch', { scope }),
  packsDownload: (names) => ipcRenderer.invoke('drivers:packsDownload', { names }),
  packsUpdate: () => ipcRenderer.invoke('drivers:packsUpdate'),
  getPacksAuto: () => ipcRenderer.invoke('drivers:getPacksAuto'),
  setPacksAuto: (auto) => ipcRenderer.invoke('drivers:setPacksAuto', { auto }),
  packsCancel: () => ipcRenderer.invoke('drivers:packsCancel'),
  onAutoDone: (cb) => {
    const handler = (_e, r) => cb(r);
    ipcRenderer.on('drivers:autoDone', handler);
    return () => ipcRenderer.removeListener('drivers:autoDone', handler);
  },
  onProgress: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('drivers:progress', handler);
    return () => ipcRenderer.removeListener('drivers:progress', handler);
  },
});

contextBridge.exposeInMainWorld('disktools', {
  cleanupScan: () => ipcRenderer.invoke('cleanup:scan'),
  cleanupClean: (ids) => ipcRenderer.invoke('cleanup:clean', { ids }),
  volumes: () => ipcRenderer.invoke('disktools:volumes'),
  usageScan: (path) => ipcRenderer.invoke('diskusage:scan', { path }),
  usbSpeed: (path, sizeMB) => ipcRenderer.invoke('disktools:usbspeed', { path, sizeMB }),
  usbSpeedCancel: () => ipcRenderer.invoke('disktools:usbspeedCancel'),
  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('disktools:progress', handler);
    return () => ipcRenderer.removeListener('disktools:progress', handler);
  },
});
