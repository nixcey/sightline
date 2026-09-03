const { contextBridge, ipcRenderer } = require("electron");

// Exposed to the loaded Sightline page. The web app checks for this object and,
// when present on Windows, shows in-app "run the agent" controls + log.
contextBridge.exposeInMainWorld("sightlineDesktop", {
  platform: process.platform,
  agent: {
    start: (opts) => ipcRenderer.invoke("agent:start", opts || {}),
    stop: () => ipcRenderer.invoke("agent:stop"),
    status: () => ipcRenderer.invoke("agent:status"),
    logHistory: () => ipcRenderer.invoke("agent:logHistory"),
    setAutostart: (on) => ipcRenderer.invoke("agent:setAutostart", !!on),
    onLog: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on("agent:log", h);
      return () => ipcRenderer.removeListener("agent:log", h);
    },
    onStatus: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on("agent:status", h);
      return () => ipcRenderer.removeListener("agent:status", h);
    },
  },
});
