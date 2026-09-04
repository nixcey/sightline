# Sightline Desktop

A thin native wrapper around `https://sightline.nixcey.com` for **Windows and
Linux**. Same app as the website — plus, on Windows, it can run the scrim
`agent/` for you (no terminal, no separate Node install).

## Use it

Grab a build from the repo's **[Releases](https://github.com/nixcey/sightline/releases)**
page:

- **Windows** — `Sightline-Setup-x.y.z.exe` (installer) or
  `Sightline-x.y.z-x64.zip` (no installer: unzip, run `Sightline.exe`).
- **Linux** — `Sightline-x.y.z.AppImage` (right-click → Properties → *Allow
  executing*, double-click) or `Sightline-x.y.z.deb`.

**The builds are unsigned**, which trips two gates on Windows:

1. **Chrome blocks the `.exe` download.** Fixes, easiest first:
   - `chrome://downloads` → the blocked item → **Keep dangerous file**
   - download the **`.zip`** instead — rarely blocked
   - use **Edge** or **Firefox**
   - PowerShell: `irm <asset URL> -OutFile Sightline.exe`
2. **SmartScreen** on first run: *"Windows protected your PC"* →
   **More info → Run anyway** (once per version).

Both go away with a code-signing certificate — see the repo README roadmap.

Sign in as usual. On Windows, **Scrims → Run scrim agent** (any team member) has:

- **Start / Stop** toggle — the agent is **off** until you start it
- optional *"Start automatically when this app opens"*
- a live **log** that survives closing/reopening the dialog (Clear to wipe it)

No ingest key to paste — the agent imports **as you**, using your Sightline
login (the main process reads the `sid` cookie from the signed-in window and
passes it to the agent along with the active team id). Nothing secret lands on
the machine.

Leave the window open while you scrim. More than one teammate can run it — the
server de-dupes on match id, so nothing imports twice.

Linux users just get the web app in a window — Valorant doesn't run on Linux, so
there's nothing for the agent to read.

## Develop / build locally

```bash
cd desktop
npm install
npm start              # run against the live site
npm run dist:win       # -> desktop/dist/Sightline-Setup-*.exe   (build on Windows, or Linux+wine)
npm run dist:linux     # -> desktop/dist/Sightline-*.AppImage / *.deb
```

Point at a local Sightline while developing:

```bash
SIGHTLINE_SITE=http://localhost:8787 npm start
```

## How the agent runs

`main.js` spawns `agent/sightline-agent.mjs` as a child process using Electron's
**bundled Node** (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`), so the user
needs nothing installed. Config is passed by environment: `SIGHTLINE_URL`,
`SIGHTLINE_POLL_SECONDS`, `SIGHTLINE_STATE`, and for auth either
`SIGHTLINE_SESSION` + `SIGHTLINE_TEAM` (the `sid` cookie read from the signed-in
window + the active team id — the default) or `SIGHTLINE_INGEST_KEY` (only if a
key was explicitly saved). The agent falls back to these when there's no
`config.json`.
The agent script is bundled via electron-builder `extraResources`, so a game
patch that needs an `agent/` fix ships in the next desktop release (or the user
runs the standalone `agent/` folder in the meantime).

`preload.js` exposes `window.sightlineDesktop` to the page; the web app
(`public/app.js` → `wireDesktopAgent`) shows the controls only when it's there
and `platform === "win32"`.

## Files

| file | role |
|---|---|
| `main.js` | Electron main — window, menu, agent child-process management, IPC |
| `preload.js` | `contextBridge` → `window.sightlineDesktop` |
| `icon.png` | 512×512 app icon (electron-builder derives `.ico` / resized PNGs) |
| `package.json` | electron + electron-builder, build config |
