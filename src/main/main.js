'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const scanner = require('./scanner/scan');

let mainWindow = null;

function getConfigPath() {
  return path.join(app.getPath('userData'), 'tools.json');
}

async function readConfig() {
  try {
    const raw = await fsp.readFile(getConfigPath(), 'utf8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.tools)) return { tools: [] };
    return data;
  } catch (err) {
    if (err.code === 'ENOENT') return { tools: [] };
    throw err;
  }
}

async function writeConfig(config) {
  const file = getConfigPath();
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(config, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

function sanitizeTool(input) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    id: str(input.id) || crypto.randomUUID(),
    name: str(input.name),
    description: str(input.description),
    path: str(input.path),
    args: str(input.args),
    cwd: str(input.cwd),
    category: str(input.category),
  };
}

// Split an argument string into argv, honouring double quotes.
function parseArgs(argString) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(argString)) !== null) {
    out.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return out;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 820,
    minHeight: 540,
    backgroundColor: '#13151a',
    show: false,
    title: 'MBTS Launcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open any target=_blank / external links in the system browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function registerIpc() {
  ipcMain.handle('tools:list', async () => {
    const config = await readConfig();
    return config.tools;
  });

  ipcMain.handle('tools:save', async (_evt, toolInput) => {
    const tool = sanitizeTool(toolInput || {});
    if (!tool.name) throw new Error('Tool name is required.');
    if (!tool.path) throw new Error('Executable path is required.');
    const config = await readConfig();
    const idx = config.tools.findIndex((t) => t.id === tool.id);
    if (idx >= 0) config.tools[idx] = tool;
    else config.tools.push(tool);
    await writeConfig(config);
    return tool;
  });

  ipcMain.handle('tools:delete', async (_evt, id) => {
    const config = await readConfig();
    config.tools = config.tools.filter((t) => t.id !== id);
    await writeConfig(config);
    return true;
  });

  ipcMain.handle('tools:launch', async (_evt, id) => {
    const config = await readConfig();
    const tool = config.tools.find((t) => t.id === id);
    if (!tool) throw new Error('Tool not found.');
    if (!tool.path || !fs.existsSync(tool.path)) {
      throw new Error(`Executable not found:\n${tool.path}`);
    }
    const cwd = tool.cwd && fs.existsSync(tool.cwd) ? tool.cwd : path.dirname(tool.path);
    const child = spawn(tool.path, parseArgs(tool.args), {
      cwd,
      detached: true,
      stdio: 'ignore',
      shell: false,
    });
    child.on('error', (err) => {
      if (mainWindow) {
        mainWindow.webContents.send('tools:launch-error', { id, message: err.message });
      }
    });
    child.unref();
    return true;
  });

  ipcMain.handle('dialog:pickExe', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select tool executable',
      properties: ['openFile'],
      filters: [
        { name: 'Executables', extensions: ['exe', 'bat', 'cmd', 'com'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select working directory',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('config:reveal', async () => {
    const file = getConfigPath();
    // Ensure the file exists so the OS can highlight it.
    if (!fs.existsSync(file)) await writeConfig(await readConfig());
    shell.showItemInFolder(file);
    return true;
  });

  // ---- Issue Scanner ----
  ipcMain.handle('scan:run', async () => {
    return scanner.runScan();
  });

  ipcMain.handle('scan:export', async (_evt, result) => {
    const stamp = new Date().toISOString().slice(0, 10);
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Save health report',
      defaultPath: `TM-Toolset-Health-Report-${stamp}.html`,
      filters: [{ name: 'HTML report', extensions: ['html'] }],
    });
    if (res.canceled || !res.filePath) return null;
    await fsp.writeFile(res.filePath, scanner.buildHtmlReport(result), 'utf8');
    return res.filePath;
  });
}

// Single-instance: focus the existing window instead of opening a second one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
