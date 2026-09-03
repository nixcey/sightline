/* Sightline Scrim Importer — background window.
   - registers Valorant Game Events
   - accumulates the live info snapshot
   - on match end, builds the normalized payload and POSTs it to Sightline
   - retries failed sends from a local queue
*/

const VALORANT_ID = 21640;

// broad request set; Overwolf ignores/greys-out any this GEP version doesn't support
const FEATURES = [
  "me", "game_info", "match_info", "match_state", "game_mode",
  "kill", "death", "assist", "spike", "round_start", "round_end",
  "match_start", "match_end", "roster", "scoreboard", "map",
];

let snapshot = {};        // merged live info
let matchOpen = false;
let matchStartedAt = 0;
let sentThisMatch = new Set(); // matchIds already handled this session (belt-and-suspenders)

function log(status, text, extra) { Store.addLog(status, text, extra); console.log(`[sightline] ${status}: ${text}`); }

/* -------- deep-merge Overwolf info fragments -------- */
function merge(target, src) {
  for (const k of Object.keys(src || {})) {
    const v = src[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      target[k] = merge(target[k] && typeof target[k] === "object" ? target[k] : {}, v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

/* -------- send -------- */
async function postMatch(payload) {
  const url = Store.url, key = Store.key;
  if (!url || !key) throw new Error("Sightline URL / ingest key not set (open the app window)");
  const res = await fetch(url + "/api/import/match", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function sendOrQueue(payload, reason) {
  try {
    const r = await postMatch(payload);
    if (r.imported) log("ok", `Imported ${payload.map} ${payload.rounds.won}-${payload.rounds.lost} (${r.matched} players matched${r.unmatched && r.unmatched.length ? `, ${r.unmatched.length} unlinked` : ""})`, { matchId: payload.matchId });
    else log("skip", `${payload.map}: ${r.reason || "not imported"}`, { matchId: payload.matchId });
    Store.opponent = ""; // consume the one-shot opponent name
    flushQueue();
    return true;
  } catch (e) {
    log("queued", `${reason || "send failed"} — ${e.message}. Will retry.`, { matchId: payload.matchId });
    Store.enqueue(payload);
    return false;
  }
}

async function flushQueue() {
  const q = Store.queue;
  if (!q.length || !Store.url || !Store.key) return;
  const keep = [];
  for (const item of q) {
    try {
      const r = await postMatch(item.payload);
      if (r.imported) log("ok", `Imported (from queue) ${item.payload.map}`, { matchId: item.payload.matchId });
      else log("skip", `Queue: ${item.payload.map} ${r.reason || ""}`.trim(), { matchId: item.payload.matchId });
    } catch (e) {
      keep.push(item);
    }
  }
  Store.queue = keep;
}
setInterval(flushQueue, 60_000);

/* -------- capture -------- */
function captureAndSend(trigger) {
  overwolf.games.events.getInfo((res) => {
    let info = structuredCloneSafe(snapshot);
    const raw = res && res.success && (res.res || res.info);
    if (raw) info = merge(info, raw);
    Store.lastSnapshot = info;

    const built = buildPayload(info, {
      modes: Store.modes,
      opponentName: Store.opponent || undefined,
      startedAt: matchStartedAt || Date.now(),
      prefix: Store.prefix,
      min: Store.minTeam,
    });
    if (built.skip) { log("info", `Not importing (${trigger}): ${built.skip}`); return; }

    const id = built.payload.matchId;
    if (sentThisMatch.has(id)) { log("info", `Already handled ${id} this session`); return; }
    sentThisMatch.add(id);

    if (!Store.auto) { log("info", `Auto-import off — captured ${built.payload.map}, use "Re-scan last match" to send`); return; }
    sendOrQueue(built.payload, `match end (${trigger})`);
  });
}

function structuredCloneSafe(o) { try { return JSON.parse(JSON.stringify(o)); } catch { return {}; } }

/* -------- Game Events wiring -------- */
function setFeatures(tries = 0) {
  overwolf.games.events.setRequiredFeatures(FEATURES, (info) => {
    if (info && info.success) {
      log("info", "Game events registered");
    } else if (tries < 12) {
      setTimeout(() => setFeatures(tries + 1), 2000);
    } else {
      log("error", "Could not register Valorant game events: " + (info && info.error));
    }
  });
}

function onInfo(payload) {
  if (!payload) return;
  if (payload.info) merge(snapshot, payload.info);
  // some builds send {feature, info:{...}} or the info directly
  else merge(snapshot, payload);
}

function onEvents(payload) {
  const events = (payload && payload.events) || [];
  for (const ev of events) {
    if (ev.name === "match_start" || ev.name === "matchStart") {
      matchOpen = true;
      matchStartedAt = Date.now();
      sentThisMatch = new Set();
      snapshot = {};
      log("info", "Match started");
      if (Store.url && Store.key) pingServer().catch(() => {}); // refresh scrim filter
    } else if (ev.name === "match_end" || ev.name === "matchEnd") {
      log("info", "Match ended — capturing scoreboard");
      // scoreboard sometimes lands a beat after match_end; retry a few times
      let n = 0;
      const t = setInterval(() => {
        captureAndSend("match_end");
        if (++n >= 4) clearInterval(t);
      }, 2500);
      matchOpen = false;
    }
  }
}

function hookGame() {
  overwolf.games.events.onInfoUpdates2.removeListener(onInfo);
  overwolf.games.events.onNewEvents.removeListener(onEvents);
  overwolf.games.events.onInfoUpdates2.addListener(onInfo);
  overwolf.games.events.onNewEvents.addListener(onEvents);
  setFeatures();
}

function checkGameRunning() {
  overwolf.games.getRunningGameInfo((g) => {
    if (g && g.isRunning && Math.floor(g.id / 10) === VALORANT_ID) hookGame();
  });
}

overwolf.games.onGameInfoUpdated.addListener((res) => {
  const id = res && res.gameInfo && Math.floor(res.gameInfo.id / 10);
  if (id === VALORANT_ID && res.gameInfo.isRunning) hookGame();
});

// also react to game-state transitions as a fallback for missed match_end events
overwolf.games.events.onInfoUpdates2.addListener((p) => {
  const st = p && p.info && (p.info.game_info || {});
  if (st.state && /menu|lobby/i.test(st.state) && matchOpen) {
    matchOpen = false;
    log("info", "Returned to menu — capturing last match");
    captureAndSend("menu-transition");
  }
});

log("info", "Sightline Scrim Importer running");
checkGameRunning();
flushQueue();

/* expose for the desktop window's "Re-scan last match" button */
window.rescanLast = function () {
  const info = Store.lastSnapshot;
  if (!info) { log("error", "No captured match to re-scan yet"); return; }
  const built = buildPayload(info, { modes: Store.modes, opponentName: Store.opponent || undefined, startedAt: matchStartedAt || Date.now() });
  if (built.skip) { log("error", "Re-scan: " + built.skip); return; }
  sentThisMatch.delete(built.payload.matchId);
  sendOrQueue(built.payload, "manual re-scan");
};
async function pingServer() {
  const res = await fetch(Store.url + "/api/import/ping", { headers: { authorization: "Bearer " + Store.key } });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "HTTP " + res.status);
  if (d.prefix != null || d.min != null) Store.setFilter(d.prefix, d.min);
  return d;
}
window.testConnection = async function () {
  try {
    const d = await pingServer();
    log("ok", `Connected to "${d.team}" — importing customs with ${d.min}+ "${d.prefix}" players`);
    return { ok: true, team: d.team, prefix: d.prefix, min: d.min };
  } catch (e) {
    log("error", "Connection failed: " + e.message);
    return { ok: false, error: e.message };
  }
};
