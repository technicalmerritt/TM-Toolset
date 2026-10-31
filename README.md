# MBTS Launcher

A lightweight Windows desktop launcher for the MBTS toolset. Add your tools
once, then launch any of them from a single window. Tool definitions are stored
in a local JSON file, so nothing is hard-coded and you can edit the list at any
time from the UI.

Built with [Electron](https://www.electronjs.org/). This is original source you
own and can change freely — add your Technical Merit branding, more features,
auto-update, whatever you like.

## Features

- Tool cards with name, description, category and target path
- One-click **Launch** (spawns the executable with optional arguments and
  working directory)
- Add / edit / remove tools from the UI, with a native file picker
- Search and category filtering
- Config persisted to your Windows user profile (survives app updates)
- Hardened Electron setup: context isolation on, Node integration off, sandboxed
  renderer, strict Content-Security-Policy

## Prerequisites

- [Node.js](https://nodejs.org/) `>= 22.23.4` (or 24.x / 26.x) and npm
- Windows 10/11 for the packaged build (you can develop on any OS)

## Run in development

```bash
cd mbts-launcher
npm install
npm start
```

## Build a Windows installer

```bash
npm run dist
```

Output lands in `release/`:

- `MBTS Launcher Setup <version>.exe` — NSIS installer
- `MBTS Launcher <version>.exe` — portable single-file build

To produce an unpacked folder without an installer (faster for testing):

```bash
npm run dist:dir
```

> Packaging a Windows `.exe` is most reliable **on Windows**. Cross-building from
> Linux/macOS works for many cases via electron-builder but can need extra setup
> (e.g. Wine) for installer signing and icons.

## Where your tool list lives

```
%APPDATA%\mbts-launcher\tools.json
```

Click **Config** in the app to open that folder. The file looks like:

```json
{
  "tools": [
    {
      "id": "…",
      "name": "Map Editor",
      "description": "Edit campaign maps",
      "category": "Editors",
      "path": "C:\\MBTS\\tools\\MapEditor.exe",
      "args": "--profile \"default\"",
      "cwd": "C:\\MBTS\\tools"
    }
  ]
}
```

## Project layout

```
src/
  main/
    main.js      Electron main process: window, config I/O, launching, dialogs
    preload.js   Secure contextBridge API exposed to the UI
  renderer/
    index.html   App markup
    styles.css   Dark theme (swap in your branding here)
    renderer.js  UI logic
```

## Branding (when you're ready)

- Colors live as CSS variables at the top of `src/renderer/styles.css`
  (`--accent`, `--bg`, etc.).
- The placeholder logo is the `.brand__mark` element in `index.html`; drop in
  an `<img>` pointing at your logo instead.
- App/installer icon: add `icon` entries under the `build` block in
  `package.json` (a 256×256 `.ico`).
