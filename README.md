# TM Toolset

A Windows diagnostic and repair suite for PC technicians, by **Technical
Merritt Computer Services**. Built with [Electron](https://www.electronjs.org/).

TM Toolset pulls the everyday jobs of a repair bench into one window:
hardware and drive health, issue scanning, repairs, debloat, driver packs,
backup & imaging, BIOS/UEFI inspection, board-level repair references, a
Microsoft 365 "what's new + training" feed, a technician tools library, and
Syncro ticket integration — with white-label theming and an offline licensing
system so it can be resold.

> This is original source. The UI, workflows and tooling are our own; where the
> app drives third-party utilities it does so as separate, clearly-credited
> programs, and it never redistributes commercial software.

## Run from source (development)

```bash
npm install
npm start
```

Node `>= 20` and Windows 10/11 for the full feature set (many collectors are
PowerShell and Windows-only).

## Bundled tool binaries

Some tabs drive small third-party command-line tools (e.g. aria2, 7-Zip CLI,
UEFITool, OpenBoardView, SumatraPDF). Those executables are **not** stored in
this repository — they live under `src/main/**/bin/` in the packaged build and
ship inside the release zips. A plain `git clone` gives you all of our source;
drop the binaries into the matching `bin/` folders to run every feature
locally.

## Updates

Packaged builds update themselves from this repo's
[Releases](../../releases): the app checks the latest release, and — while
licensed or on trial — downloads the code-only update asset, applies it over
its own source (leaving the bundled binaries and your settings untouched), and
restarts. The first install is the full portable zip from the latest release.

## Licensing

The app runs a 14-day trial, then requires a per-user licence (e-mail + signed
key) that works across all of a technician's machines. Licences are verified
offline with an embedded public key; the private signing key is kept entirely
outside this repository.

## Data & config

Per-install settings live in the portable data folder next to the executable
(or in `%APPDATA%` for an installed build). Use **Settings → Config** / the
**Activity Log → Data folder** button to open it.
