# Sightline Desktop

A thin native wrapper around `https://sightline.nixcey.com` for **Windows and
Linux**. Same app as the website — plus, on Windows, it can run the scrim
`agent/` for you (no terminal, no separate Node install).

## Use it

Grab an installer from the repo's **Releases** page (built by CI on every
`desktop-v*` tag):

- **Windows** — `Sightline-Setup-x.y.z.exe`
- **Linux** — `Sightline-x.y.z.AppImage` (or the `.deb`)

Sign in as usual. On Windows, **Scrims → Scrim importer** now has a *"Run the
agent on this PC"* section: paste your ingest key once, hit **Start**, leave the
window open while you scrim. The agent's log shows inline; the key is saved to
the OS user-data folder (not the app bundle).

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
needs nothing installed. Config is passed by environment
(`SIGHTLINE_URL`, `SIGHTLINE_INGEST_KEY`, `SIGHTLINE_POLL_SECONDS`,
`SIGHTLINE_STATE`) — the agent falls back to these when there's no `config.json`.
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
