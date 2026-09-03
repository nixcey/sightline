/* Shared config + log, persisted in localStorage (shared across this app's windows). */
const Store = {
  get url()      { return localStorage.getItem("sl_url") || ""; },
  set url(v)     { localStorage.setItem("sl_url", (v || "").trim().replace(/\/+$/, "")); },
  get key()      { return localStorage.getItem("sl_key") || ""; },
  set key(v)     { localStorage.setItem("sl_key", (v || "").trim()); },
  get auto()     { return localStorage.getItem("sl_auto") !== "0"; },
  set auto(v)    { localStorage.setItem("sl_auto", v ? "1" : "0"); },
  get modes()    { try { return JSON.parse(localStorage.getItem("sl_modes")) || ["custom"]; } catch { return ["custom"]; } },
  set modes(v)   { localStorage.setItem("sl_modes", JSON.stringify(v || ["custom"])); },
  get opponent() { return localStorage.getItem("sl_opponent") || ""; },
  set opponent(v){ localStorage.setItem("sl_opponent", (v || "").trim()); },

  // scrim filter — pulled from the server on connect (Sightline → Scrim importer)
  get prefix()   { return localStorage.getItem("sl_prefix") || ""; },
  get minTeam()  { return Number(localStorage.getItem("sl_min")) || 3; },
  setFilter(prefix, min) {
    if (prefix != null) localStorage.setItem("sl_prefix", String(prefix));
    if (min != null) localStorage.setItem("sl_min", String(min));
    try { window.dispatchEvent(new Event("sl-log")); } catch {}
  },

  get log() { try { return JSON.parse(localStorage.getItem("sl_log")) || []; } catch { return []; } },
  addLog(status, text, extra) {
    const log = Store.log;
    log.unshift({ at: Date.now(), status, text, ...(extra || {}) });
    localStorage.setItem("sl_log", JSON.stringify(log.slice(0, 40)));
    try { window.dispatchEvent(new Event("sl-log")); } catch {}
  },
  clearLog() { localStorage.removeItem("sl_log"); },

  get queue() { try { return JSON.parse(localStorage.getItem("sl_queue")) || []; } catch { return []; } },
  set queue(v){ localStorage.setItem("sl_queue", JSON.stringify(v || [])); },
  enqueue(payload) { const q = Store.queue; q.push({ id: Math.random().toString(36).slice(2), payload }); Store.queue = q; },

  get lastSnapshot() { try { return JSON.parse(localStorage.getItem("sl_lastraw")) || null; } catch { return null; } },
  set lastSnapshot(v){ localStorage.setItem("sl_lastraw", JSON.stringify(v)); },
};
