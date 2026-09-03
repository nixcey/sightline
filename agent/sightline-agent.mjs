#!/usr/bin/env node
/*
 * Sightline scrim agent — reads Valorant's local client API and imports finished
 * custom games into Sightline. Runs on ONE machine (the IGL's). Zero npm deps.
 *
 *   node sightline-agent.mjs            # watch mode (default)
 *   node sightline-agent.mjs --test     # check the Sightline connection and exit
 *   node sightline-agent.mjs --once <matchId>   # import one match by id and exit
 *
 * How it works, briefly:
 *   1. read %LOCALAPPDATA%\Riot Games\Riot Client\Config\lockfile  -> local port + password
 *   2. GET https://127.0.0.1:<port>/entitlements/v1/token  (Basic riot:<pw>)
 *        -> access token, entitlement token, your puuid   (no Riot password needed)
 *   3. region/shard + client version from ShooterGame.log (fallback: valorant-api.com)
 *   4. poll  glz .../core-game/v1/players/<puuid>  for the live match id
 *   5. when the match ends, GET  pd .../match-details/v1/matches/<id>
 *   6. match-details often omits gameName/tagLine on customs, so resolve any
 *        missing names by puuid via  PUT pd .../name-service/v2/players
 *   7. normalise -> POST <sightline>/api/import/match   (Bearer <ingest key>)
 *
 * These endpoints are unofficial but stable and read-only. Map/agent names and the
 * client version are pulled live from valorant-api.com so a game patch doesn't
 * need a code change here.
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CFG_PATH = path.join(DIR, "config.json");
// state.json lives next to the agent by default; the desktop wrapper points it
// at a writable dir because a packaged app's resources are read-only.
const STATE_PATH = process.env.SIGHTLINE_STATE || path.join(DIR, "state.json");

// static, universally-used client-platform blob (decoded: PC / Windows / 10.0.19042 / Unknown)
const CLIENT_PLATFORM =
  "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9";

const REGION_TO_SHARD = { latam: "na", br: "na", na: "na", eu: "eu", ap: "ap", kr: "kr" };

/* ------------------------------------------------------------------ logging */
const ts = () => new Date().toLocaleTimeString();
const log = (...a) => console.log(`[${ts()}]`, ...a);
const warn = (...a) => console.warn(`[${ts()}]`, ...a);

/* ------------------------------------------------------------------ config + state */
// Config comes from config.json next to the agent, OR from the environment
// (SIGHTLINE_URL / SIGHTLINE_INGEST_KEY / SIGHTLINE_POLL_SECONDS) — the desktop
// wrapper uses the env path so it doesn't need to write into the app bundle.
function loadConfig() {
  let c = {};
  if (fs.existsSync(CFG_PATH)) {
    try { c = JSON.parse(fs.readFileSync(CFG_PATH, "utf8")); }
    catch { console.error(`config.json is not valid JSON (${CFG_PATH})`); process.exit(1); }
  }
  c.sightlineUrl = String(process.env.SIGHTLINE_URL || c.sightlineUrl || "").replace(/\/+$/, "");
  c.ingestKey = String(process.env.SIGHTLINE_INGEST_KEY || c.ingestKey || "").trim();
  c.pollSeconds = Math.max(10, Number(process.env.SIGHTLINE_POLL_SECONDS || c.pollSeconds) || 20);
  if (!c.sightlineUrl || !c.ingestKey) {
    console.error(
      `\nMissing config. Either create ${CFG_PATH} :\n\n` +
        `  {\n    "sightlineUrl": "https://sightline.nixcey.com",\n    "ingestKey": "sk_...",\n    "pollSeconds": 20\n  }\n\n` +
        `or set SIGHTLINE_URL and SIGHTLINE_INGEST_KEY in the environment.\n` +
        `Get the ingest key from Sightline -> Scrims -> Scrim importer.\n`,
    );
    process.exit(1);
  }
  return c;
}
const readState = () => {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { return {}; }
};
const writeState = (s) => { try { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); } catch {} };

/* ------------------------------------------------------------------ local Riot client API */
function localAppData() {
  return process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local");
}
function readLockfile() {
  const p = path.join(localAppData(), "Riot Games", "Riot Client", "Config", "lockfile");
  if (!fs.existsSync(p)) return null;
  const m = fs.readFileSync(p, "utf8").trim().match(/^(.+?):(\d+):(\d+):(.+?):(.+)$/);
  if (!m) return null;
  return { pid: m[2], port: m[3], password: m[4], protocol: m[5] };
}
// only the 127.0.0.1 endpoint uses a self-signed cert, so it's the only place we skip TLS verify
function localGet(port, path_, auth) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: "127.0.0.1", port, path: path_, method: "GET", rejectUnauthorized: false,
        headers: { Authorization: `Basic ${auth}` } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, json: j }); });
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("local API timeout")));
    req.end();
  });
}

/* ------------------------------------------------------------------ log parsing (region + version) */
function readShooterLog() {
  const p = path.join(localAppData(), "VALORANT", "Saved", "Logs", "ShooterGame.log");
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}
function regionShardFromLog(logText) {
  let m = logText.match(/https?:\/\/glz-(.+?)-1\.(.+?)\.a\.pvp\.net/);
  if (m) return { region: m[1], shard: m[2] };
  m = logText.match(/https?:\/\/pd\.(.+?)\.a\.pvp\.net/);
  if (m) return { region: m[1], shard: m[1] };
  return null;
}
function versionFromLog(logText) {
  const lines = logText.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/CI server version:\s*(\S+)/);
    if (m) return m[1].trim();
  }
  return null;
}

/* ------------------------------------------------------------------ valorant-api.com (names + version) */
let META = { agents: {}, maps: {}, version: null, fetchedAt: 0 };
async function loadMeta() {
  if (Date.now() - META.fetchedAt < 6 * 3600e3 && META.version) return META;
  try {
    const [ver, agents, maps] = await Promise.all([
      fetch("https://valorant-api.com/v1/version").then((r) => r.json()),
      fetch("https://valorant-api.com/v1/agents?isPlayableCharacter=true").then((r) => r.json()),
      fetch("https://valorant-api.com/v1/maps").then((r) => r.json()),
    ]);
    META.version = ver?.data?.riotClientVersion || META.version;
    for (const a of agents?.data || []) META.agents[a.uuid.toLowerCase()] = a.displayName;
    for (const mp of maps?.data || []) if (mp.mapUrl) META.maps[mp.mapUrl] = mp.displayName;
    META.fetchedAt = Date.now();
  } catch (e) {
    warn("valorant-api.com unreachable, using cached/fallback names:", e.message);
  }
  return META;
}
const agentName = (uuid) => META.agents[String(uuid || "").toLowerCase()] || "";
const mapName = (mapUrl) => META.maps[mapUrl] || String(mapUrl || "").split("/").filter(Boolean).pop() || "Unknown";

/* ------------------------------------------------------------------ remote PVP endpoints */
function pvpHeaders(auth) {
  return {
    Authorization: `Bearer ${auth.accessToken}`,
    "X-Riot-Entitlements-JWT": auth.entitlement,
    "X-Riot-ClientVersion": auth.version,
    "X-Riot-ClientPlatform": CLIENT_PLATFORM,
  };
}
async function getAuth() {
  const lock = readLockfile();
  if (!lock) return { error: "Valorant not running (no lockfile)" };
  const basic = Buffer.from(`riot:${lock.password}`).toString("base64");

  let ent;
  try { ent = await localGet(lock.port, "/entitlements/v1/token", basic); }
  catch (e) { return { error: "local API not reachable: " + e.message }; }
  if (ent.status === 404 || !ent.json?.accessToken) return { error: "not logged in yet (retrying)" };

  const logText = readShooterLog();
  const rs = regionShardFromLog(logText);
  if (!rs) return { error: "could not determine region from ShooterGame.log" };

  await loadMeta();
  const version = META.version || versionFromLog(logText);
  if (!version) return { error: "could not determine client version" };

  return {
    accessToken: ent.json.accessToken,
    entitlement: ent.json.token,
    puuid: ent.json.subject,
    region: rs.region,
    shard: rs.shard || REGION_TO_SHARD[rs.region] || rs.region,
    version,
  };
}
async function coreGameMatchId(auth) {
  const url = `https://glz-${auth.region}-1.${auth.shard}.a.pvp.net/core-game/v1/players/${auth.puuid}`;
  const r = await fetch(url, { headers: pvpHeaders(auth) });
  if (r.status === 404) return null; // not in a game
  if (!r.ok) throw new Error(`core-game HTTP ${r.status}`);
  const j = await r.json();
  return j.MatchID || null;
}
async function matchDetails(auth, matchId) {
  const url = `https://pd.${auth.shard}.a.pvp.net/match-details/v1/matches/${matchId}`;
  const r = await fetch(url, { headers: pvpHeaders(auth) });
  if (!r.ok) throw new Error(`match-details HTTP ${r.status}`);
  return r.json();
}
// match-details frequently returns empty gameName/tagLine for custom games;
// this resolves current names for any puuid. Body is a JSON array of puuids.
async function resolvePlayerNames(auth, puuids) {
  const ids = [...new Set((puuids || []).filter(Boolean))];
  if (!ids.length) return {};
  try {
    const r = await fetch(`https://pd.${auth.shard}.a.pvp.net/name-service/v2/players`, {
      method: "PUT",
      headers: { ...pvpHeaders(auth), "content-type": "application/json" },
      body: JSON.stringify(ids),
    });
    if (!r.ok) { warn(`name-service HTTP ${r.status}`); return {}; }
    const map = {};
    for (const p of (await r.json()) || []) {
      if (p.Subject && p.GameName) map[p.Subject] = `${p.GameName}#${p.TagLine}`;
    }
    return map;
  } catch (e) {
    warn("name-service unreachable: " + e.message);
    return {};
  }
}

/* ------------------------------------------------------------------ normalise -> Sightline payload */
function buildPayload(md, myPuuid, nameMap = {}) {
  const mi = md.matchInfo || {};
  const players = md.players || [];
  const me = players.find((p) => p.subject === myPuuid);
  const myTeam = me?.teamId;

  const teams = md.teams || [];
  const myT = teams.find((t) => t.teamId === myTeam);
  const oppT = teams.find((t) => t.teamId !== myTeam);
  const totalRounds =
    (myT?.roundsWon || 0) + (oppT?.roundsWon || 0) ||
    Math.max(...players.map((p) => p.stats?.roundsPlayed || 0), 1);

  // ADR from round-by-round damage
  const dmg = {};
  for (const r of md.roundResults || []) {
    for (const ps of r.playerStats || []) {
      for (const d of ps.damage || []) dmg[ps.subject] = (dmg[ps.subject] || 0) + (d.damage || 0);
    }
  }
  const entry = (p) => {
    const rounds = p.stats?.roundsPlayed || totalRounds || 1;
    const direct = p.gameName && p.tagLine ? `${p.gameName}#${p.tagLine}` : "";
    return {
      riotId: direct || nameMap[p.subject] || "",
      agent: agentName(p.characterId),
      k: p.stats?.kills || 0,
      d: p.stats?.deaths || 0,
      a: p.stats?.assists || 0,
      adr: Math.round((dmg[p.subject] || 0) / rounds) || null,
    };
  };

  const isCustom = mi.provisioningFlowID === "CustomGame" || mi.queueID === "";
  return {
    matchId: mi.matchId || md.matchInfo?.matchId,
    map: mapName(mi.mapId),
    mode: isCustom ? "custom" : mi.queueID || "unrated",
    startedAt: mi.gameStartMillis || Date.now(),
    rounds: { won: myT?.roundsWon || 0, lost: oppT?.roundsWon || 0 },
    us: players.filter((p) => p.teamId === myTeam).map(entry),
    them: players.filter((p) => p.teamId !== myTeam).map(entry),
  };
}

/* ------------------------------------------------------------------ Sightline */
async function slPing(cfg) {
  const r = await fetch(cfg.sightlineUrl + "/api/import/ping", {
    headers: { Authorization: "Bearer " + cfg.ingestKey },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
  return d; // { team, tag, prefix, min }
}
async function slImport(cfg, payload) {
  const r = await fetch(cfg.sightlineUrl + "/api/import/match", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: "Bearer " + cfg.ingestKey },
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
  return d;
}

/* client-side pre-filter mirroring the server: only bother with games that look like scrims.
   The server re-checks with the roster and is authoritative — this just cuts noise. */
function looksLikeScrim(payload, filter) {
  const modes = (filter?.modes?.length ? filter.modes : ["custom"]).map((m) => String(m).toLowerCase());
  if (!modes.includes(String(payload.mode || "").toLowerCase())) return false;
  const prefix = filter?.prefix || "";
  if (!prefix) return true;
  const re = new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s._-]?", "i");
  const nameOf = (rid) => String(rid || "").split("#")[0].trim();
  const min = filter?.min ?? 3;
  const us = payload.us.filter((p) => re.test(nameOf(p.riotId))).length;
  const them = payload.them.filter((p) => re.test(nameOf(p.riotId))).length;
  return us >= min || them >= min;
}

/* ------------------------------------------------------------------ main loop */
async function processMatch(cfg, auth, matchId, filter) {
  const state = readState();
  state.imported = state.imported || [];
  if (state.imported.includes(matchId)) { log(`already handled ${matchId}`); return; }

  let md = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      md = await matchDetails(auth, matchId);
      if (md?.matchInfo?.isCompleted) break;
    } catch (e) {
      log(`match-details not ready (try ${attempt}/6): ${e.message}`);
    }
    md = null;
    await sleep(15000);
  }
  if (!md) {
    warn(`gave up fetching match ${matchId} — queued for retry`);
    state.queue = [...new Set([...(state.queue || []), matchId])];
    writeState(state);
    return;
  }

  const nameMap = await resolvePlayerNames(auth, (md.players || []).map((p) => p.subject));
  const payload = buildPayload(md, auth.puuid, nameMap);
  if (!payload.us.length) { warn(`could not place you on a team in ${matchId}, skipping`); return; }
  const missing = [...payload.us, ...payload.them].filter((p) => !p.riotId).length;
  if (missing) warn(`${missing} player name(s) could not be resolved — they'll import as unlinked`);

  if (!looksLikeScrim(payload, filter)) {
    log(`skip ${payload.map} — not a scrim (< ${filter.min} "${filter.prefix}" on a team)`);
    state.imported.push(matchId); writeState(state);
    return;
  }

  try {
    const res = await slImport(cfg, payload);
    if (res.imported)
      log(`✔ imported ${payload.map} ${payload.rounds.won}-${payload.rounds.lost} ` +
          `(${res.matched} matched${res.unmatched?.length ? `, ${res.unmatched.length} unlinked` : ""}${res.swapped ? ", sides swapped" : ""})`);
    else log(`· ${payload.map}: ${res.reason || "not imported"}`);
    state.imported.push(matchId);
    state.queue = (state.queue || []).filter((m) => m !== matchId);
    writeState(state);
  } catch (e) {
    warn(`send failed for ${matchId} (${e.message}) — queued`);
    state.queue = [...new Set([...(state.queue || []), matchId])];
    writeState(state);
  }
}

async function flushQueue(cfg, auth, filter) {
  const state = readState();
  for (const m of state.queue || []) await processMatch(cfg, auth, m, filter);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function watch(cfg) {
  log(`Sightline scrim agent — watching for custom games`);
  let filter = { prefix: "", min: 3, modes: ["custom"] };
  let current = null; // match id we're currently in
  let lastConnOk = 0;

  for (;;) {
    try {
      const auth = await getAuth();
      if (auth.error) { log(auth.error); await sleep(cfg.pollSeconds * 1000); continue; }

      if (Date.now() - lastConnOk > 5 * 60e3) {
        try {
          const p = await slPing(cfg);
          filter = { prefix: p.prefix || "", min: p.min || 3, modes: ["custom"] };
          log(`connected to "${p.team}" — scrims need ${filter.min}+ "${filter.prefix}" players`);
          lastConnOk = Date.now();
          await flushQueue(cfg, auth, filter);
        } catch (e) { warn("Sightline unreachable: " + e.message); }
      }

      const mid = await coreGameMatchId(auth);
      if (mid) {
        if (mid !== current) { current = mid; log(`in a game — ${mid}`); }
      } else if (current) {
        const ended = current;
        current = null;
        log(`game over — ${ended}`);
        await processMatch(cfg, auth, ended, filter);
      }
    } catch (e) {
      warn("loop error: " + e.message);
    }
    await sleep(cfg.pollSeconds * 1000);
  }
}

/* ------------------------------------------------------------------ entry */
function main() {
  const args = process.argv.slice(2);
  const cfg = loadConfig();

  if (args[0] === "--test") {
    slPing(cfg)
      .then((p) => { log(`OK — connected to "${p.team}" (${p.tag}); import filter: ${p.min}+ "${p.prefix}"`); process.exit(0); })
      .catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
  } else if (args[0] === "--once") {
    const matchId = args[1];
    if (!matchId) { console.error("usage: --once <matchId>"); process.exit(1); }
    (async () => {
      const auth = await getAuth();
      if (auth.error) { console.error(auth.error); process.exit(1); }
      const p = await slPing(cfg).catch(() => ({}));
      await processMatch(cfg, auth, matchId, { prefix: p.prefix || "", min: p.min || 3, modes: ["custom", "unrated", "competitive"] });
      process.exit(0);
    })();
  } else {
    watch(cfg).catch((e) => { console.error(e); process.exit(1); });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

export { buildPayload, looksLikeScrim, regionShardFromLog, versionFromLog, mapName, agentName, META };
