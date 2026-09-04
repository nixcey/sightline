/* Sightline desktop wrapper.
 * - Loads the live web app in a native window (Windows + Linux).
 * - On Windows, can spawn the scrim agent (agent/sightline-agent.mjs) as a child
 *   process using Electron's bundled Node — no separate Node install needed.
 * The web app shows the Start/Stop controls + log only when window.sightlineDesktop
 * is present (see preload.js). The agent is OFF until the user starts it (or
 * "start with the app" is enabled).
 */
const { app, BrowserWindow, ipcMain, shell, Menu, session } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const SITE_URL = process.env.SIGHTLINE_SITE || "https://sightline.nixcey.com";

const userData = () => app.getPath("userData");
const cfgPath = () => path.join(userData(), "agent.json");
const statePath = () => path.join(userData(), "agent-state.json");
const agentScript = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "agent", "sightline-agent.mjs")
    : path.join(__dirname, "..", "agent", "sightline-agent.mjs");

let win = null;
let agentProc = null;
const logBuf = []; // ring buffer of recent agent output, survives dialog opens
const LOG_MAX = 400;

const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgPath(), "utf8")); } catch { return {}; } };
const writeCfg = (patch) => {
  const c = { ...readCfg(), ...patch };
  try { fs.mkdirSync(userData(), { recursive: true }); fs.writeFileSync(cfgPath(), JSON.stringify(c, null, 2)); } catch {}
  return c;
};

function toRenderer(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
function pushLog(stream, line) {
  const rec = { stream, line, at: Date.now() };
  logBuf.push(rec);
  if (logBuf.length > LOG_MAX) logBuf.splice(0, logBuf.length - LOG_MAX);
  toRenderer("agent:log", rec);
}
function statusPayload() {
  const c = readCfg();
  return {
    platform: process.platform,
    running: !!agentProc,
    hasKey: !!c.ingestKey,
    autostart: !!c.autostart,
    pollSeconds: c.pollSeconds || 20,
  };
}

// the sid cookie from the logged-in web view — lets the agent import as the
// current user with no shared ingest key
async function sessionCookie() {
  try {
    const jar = await session.defaultSession.cookies.get({ url: SITE_URL, name: "sid" });
    return jar && jar[0] ? jar[0].value : "";
  } catch { return ""; }
}

async function startAgent({ ingestKey, pollSeconds, teamId } = {}) {
  if (process.platform !== "win32") return { error: "the agent only runs on Windows" };
  if (agentProc) return statusPayload();
  const patch = {};
  if (ingestKey) patch.ingestKey = String(ingestKey).trim();
  if (pollSeconds) patch.pollSeconds = Number(pollSeconds) || 20;
  if (teamId) patch.teamId = String(teamId).trim();
  const c = Object.keys(patch).length ? writeCfg(patch) : readCfg();

  // prefer a real ingest key if one was pasted; otherwise ride the login session
  const sid = c.ingestKey ? "" : await sessionCookie();
  if (!c.ingestKey && !(sid && c.teamId)) {
    return { error: "sign in on the Sightline tab first (the agent uses your session)" };
  }

  pushLog("out", c.ingestKey ? "— starting agent (ingest key) —" : "— starting agent (signed-in session) —");
  agentProc = spawn(process.execPath, [agentScript()], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      SIGHTLINE_URL: SITE_URL,
      ...(c.ingestKey
        ? { SIGHTLINE_INGEST_KEY: c.ingestKey }
        : { SIGHTLINE_SESSION: sid, SIGHTLINE_TEAM: c.teamId }),
      SIGHTLINE_POLL_SECONDS: String(c.pollSeconds || 20),
      SIGHTLINE_STATE: statePath(),
    },
    windowsHide: true,
  });
  const pipe = (stream) => (chunk) =>
    String(chunk).split(/\r?\n/).filter(Boolean).forEach((line) => pushLog(stream, line));
  agentProc.stdout.on("data", pipe("out"));
  agentProc.stderr.on("data", pipe("err"));
  agentProc.on("error", (e) => { pushLog("err", "spawn error: " + e.message); agentProc = null; toRenderer("agent:status", statusPayload()); });
  agentProc.on("exit", (code) => { agentProc = null; pushLog("out", `— agent stopped${code ? ` (exit ${code})` : ""} —`); toRenderer("agent:status", statusPayload()); });
  toRenderer("agent:status", statusPayload());
  return statusPayload();
}

function stopAgent() {
  if (agentProc) { agentProc.kill(); agentProc = null; }
  toRenderer("agent:status", statusPayload());
  return statusPayload();
}

ipcMain.handle("agent:start", (_e, opts) => startAgent(opts || {}));
ipcMain.handle("agent:stop", () => stopAgent());
ipcMain.handle("agent:status", () => statusPayload());
ipcMain.handle("agent:logHistory", () => logBuf.slice());
ipcMain.handle("agent:setAutostart", (_e, on) => { writeCfg({ autostart: !!on }); return statusPayload(); });

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
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(SITE_URL)) { shell.openExternal(url); return { action: "deny" }; }
    return { action: "allow" };
  });
  win.webContents.on("did-finish-load", () => {
    const c = readCfg();
    if (process.platform === "win32" && c.autostart && !agentProc && (c.ingestKey || c.teamId)) {
      startAgent().catch(() => {});
    }
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
