/* Sightline desktop wrapper.
 * - Loads the live web app in a native window (Windows + Linux).
 * - On Windows, can spawn the scrim agent (agent/sightline-agent.mjs) as a child
 *   process using Electron's bundled Node — no separate Node install needed.
 * The web app shows the Start/Stop controls only when window.sightlineDesktop
 * is present (see preload.js).
 */
const { app, BrowserWindow, ipcMain, shell, Menu } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const SITE_URL = process.env.SIGHTLINE_SITE || "https://sightline.nixcey.com";

const userData = () => app.getPath("userData");
const agentCfgPath = () => path.join(userData(), "agent.json");
const agentStatePath = () => path.join(userData(), "agent-state.json");
const agentScript = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "agent", "sightline-agent.mjs")
    : path.join(__dirname, "..", "agent", "sightline-agent.mjs");

let win = null;
let agentProc = null;

const readCfg = () => { try { return JSON.parse(fs.readFileSync(agentCfgPath(), "utf8")); } catch { return {}; } };
const writeCfg = (c) => { try { fs.mkdirSync(userData(), { recursive: true }); fs.writeFileSync(agentCfgPath(), JSON.stringify(c, null, 2)); } catch {} };

function toRenderer(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function startAgent({ ingestKey, pollSeconds } = {}) {
  if (process.platform !== "win32") return { error: "the agent only runs on Windows" };
  if (agentProc) return { running: true };
  const cfg = readCfg();
  if (ingestKey) cfg.ingestKey = String(ingestKey).trim();
  if (pollSeconds) cfg.pollSeconds = Number(pollSeconds) || 20;
  writeCfg(cfg);
  if (!cfg.ingestKey) return { error: "no ingest key set" };

  agentProc = spawn(process.execPath, [agentScript()], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      SIGHTLINE_URL: SITE_URL,
      SIGHTLINE_INGEST_KEY: cfg.ingestKey,
      SIGHTLINE_POLL_SECONDS: String(cfg.pollSeconds || 20),
      SIGHTLINE_STATE: agentStatePath(),
    },
    windowsHide: true,
  });
  const pipe = (stream) => (chunk) =>
    String(chunk).split(/\r?\n/).filter(Boolean).forEach((line) => toRenderer("agent:log", { stream, line }));
  agentProc.stdout.on("data", pipe("out"));
  agentProc.stderr.on("data", pipe("err"));
  agentProc.on("error", (e) => { toRenderer("agent:log", { stream: "err", line: "spawn error: " + e.message }); agentProc = null; toRenderer("agent:status", { running: false }); });
  agentProc.on("exit", (code) => { agentProc = null; toRenderer("agent:status", { running: false, code }); });
  toRenderer("agent:status", { running: true });
  return { running: true };
}

function stopAgent() {
  if (agentProc) { agentProc.kill(); agentProc = null; }
  toRenderer("agent:status", { running: false });
  return { running: false };
}

ipcMain.handle("agent:start", (_e, opts) => startAgent(opts || {}));
ipcMain.handle("agent:stop", () => stopAgent());
ipcMain.handle("agent:status", () => ({
  platform: process.platform,
  running: !!agentProc,
  hasKey: !!readCfg().ingestKey,
  pollSeconds: readCfg().pollSeconds || 20,
}));

function createWindow() {
  win = new BrowserWindow({
    width: 1220,
    height: 840,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: "#14171b",
    autoHideMenuBar: true,
    title: "Sightline",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(SITE_URL);
  // external links open in the real browser, not a new Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(SITE_URL)) { shell.openExternal(url); return { action: "deny" }; }
    return { action: "allow" };
  });
}

Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    {
      label: "Sightline",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => win && win.reload() },
        { label: "Toggle DevTools", accelerator: "F12", click: () => win && win.webContents.toggleDevTools() },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
  ]),
);

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { stopAgent(); if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", stopAgent);
