/* Turn an Overwolf Valorant Game-Events snapshot into Sightline's normalized
   import payload. Overwolf's exact field shapes have drifted between GEP
   versions, so this is written defensively with fallbacks. If a future patch
   changes the format, adjust here and reload the unpacked app — the server
   contract (`/api/import/match`) doesn't change.

   Normalized payload:
   {
     matchId, map, mode, startedAt, opponentName?,
     rounds: { won, lost },
     us:  [ { riotId, agent, k, d, a, adr?, kast? } ],
     them:[ { riotId, agent, k, d, a, adr? } ]
   }
*/

const MAPS = {
  ascent: "Ascent", bind: "Bind", breeze: "Breeze", fracture: "Fracture", haven: "Haven",
  icebox: "Icebox", lotus: "Lotus", pearl: "Pearl", split: "Split", sunset: "Sunset", abyss: "Abyss",
  // internal codenames Riot/Overwolf sometimes emit
  triad: "Haven", duality: "Bind", bonsai: "Split", port: "Icebox", ascent_ct: "Ascent",
  canyon: "Fracture", foxtrot: "Breeze", pitt: "Pearl", jam: "Lotus", juliett: "Sunset", infinity: "Abyss",
};
const AGENTS = {
  kayo: "KAY/O", "kay/o": "KAY/O", "kay-o": "KAY/O", grenadier: "KAY/O",
  clay: "Raze", wraith: "Omen", pandemic: "Viper", hunter: "Sova", thorne: "Sage",
  wushu: "Phoenix", sarge: "Brimstone", breach: "Breach", vampire: "Reyna", killjoy: "Killjoy",
  gumshoe: "Cypher", guide: "Skye", stealth: "Yoru", deadeye: "Chamber", rift: "Fade",
  bounty: "Gekko", sprinter: "Neon", nox: "Harbor", cable: "Deadlock", aggrobot: "Iso",
  smonk: "Clove", sky: "Skye", mage: "Harbor", terra: "Deadlock",
};

const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "");
const normMap = (m) => MAPS[String(m || "").toLowerCase()] || titleCase(m);
const normAgent = (a) => AGENTS[String(a || "").toLowerCase()] || titleCase(a);

function parseMaybeJSON(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}

/* full "Name#TAG" — Overwolf sometimes gives only the game name */
function riotId(name, tagline) {
  const n = String(name || "").trim();
  if (n.includes("#")) return n;
  const t = String(tagline || "").trim().replace(/^#/, "");
  return t ? `${n}#${t}` : n;
}

/* collect roster_0..roster_9 into identity records */
function readRoster(mi) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const r = parseMaybeJSON(mi["roster_" + i] ?? mi["player_" + i]);
    if (!r) continue;
    out.push({
      key: String(r.name || r.player_name || "").toLowerCase(),
      name: r.name || r.player_name || "",
      tagline: r.tagline || r.tag_line || r.tag || "",
      puuid: r.player_id || r.puuid || r.playerId || "",
      agent: normAgent(r.character || r.agent || r.agent_internal),
      teammate: r.teammate === true || r.teammate === "true",
      local: r.local === true || r.local === "true",
      // stats sometimes ride along on the roster entry
      k: num(r.kills), d: num(r.deaths), a: num(r.assists),
      adr: num(r.damage_per_round ?? r.adr),
    });
  }
  return out;
}

/* scoreboard: array or object of per-player stat rows */
function readScoreboard(mi) {
  const sb = parseMaybeJSON(mi.scoreboard);
  const rows = [];
  const push = (r) => {
    if (!r) return;
    rows.push({
      key: String(r.name || r.player_name || "").toLowerCase(),
      name: r.name || r.player_name || "",
      tagline: r.tagline || r.tag_line || "",
      agent: normAgent(r.character || r.agent),
      teammate: r.teammate === true || r.teammate === "true",
      k: num(r.kills ?? r.kill), d: num(r.deaths ?? r.death), a: num(r.assists ?? r.assist),
      adr: num(r.damage_per_round ?? r.adr ?? (r.damage != null && r.rounds ? r.damage / r.rounds : null)),
      kast: num(r.kast),
    });
  };
  if (Array.isArray(sb)) sb.forEach(push);
  else if (sb && typeof sb === "object") Object.values(sb).forEach(push);
  // some GEP versions expose per-player scoreboard as scoreboard_0..scoreboard_9
  for (let i = 0; i < 12; i++) push(parseMaybeJSON(mi["scoreboard_" + i]));
  return rows;
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function readScore(mi) {
  const s = mi.score ?? mi.round_report ?? mi.rounds;
  const o = parseMaybeJSON(s);
  if (o && (o.won != null || o.lost != null)) return { won: num(o.won) || 0, lost: num(o.lost) || 0 };
  if (typeof s === "string") {
    const m = s.match(/(\d+)\s*[-/:]\s*(\d+)/);
    if (m) return { won: +m[1], lost: +m[2] };
  }
  if (mi.team_score != null && mi.enemy_score != null) return { won: num(mi.team_score) || 0, lost: num(mi.enemy_score) || 0 };
  return { won: num(mi.won) || 0, lost: num(mi.lost) || 0 };
}

/* main entry — returns { payload } | { skip: reason } */
function buildPayload(info, opts = {}) {
  const mi = (info && (info.match_info || info.matchInfo)) || {};
  const gi = (info && (info.game_info || info.gameInfo)) || {};
  const me = (info && info.me) || {};

  const matchId = mi.pseudo_match_id || mi.match_id || mi.matchId || info.pseudo_match_id;
  if (!matchId) return { skip: "no match id yet" };

  const modeRaw = String(mi.game_mode || mi.mode || gi.game_mode || gi.mode || "").toLowerCase();
  const isCustom = mi.custom_game === true || mi.custom_game === "true" || /custom/.test(modeRaw);
  const mode = isCustom ? "custom" : (modeRaw || "unknown");

  const allowed = opts.modes || ["custom"];
  if (!allowed.includes(mode) && !(allowed.includes("custom") && isCustom)) {
    return { skip: `mode "${mode}" not enabled for import` };
  }

  const roster = readRoster(mi);
  const sb = readScoreboard(mi);

  // identity + team come from the roster; stats come from the scoreboard; joined by name
  const rec = {};
  const keyFor = (r) => r.key || String(r.name || "").toLowerCase();
  roster.forEach((r) => {
    const k = keyFor(r);
    if (k) rec[k] = { ...r, key: k };
  });
  sb.forEach((s) => {
    const k = keyFor(s);
    if (!k) return;
    const p = (rec[k] = rec[k] || { key: k, name: s.name, tagline: s.tagline, teammate: s.teammate });
    if (s.agent && !p.agent) p.agent = s.agent;
    for (const f of ["k", "d", "a", "adr", "kast"]) if (s[f] != null) p[f] = s[f];
    if (p.teammate == null && s.teammate != null) p.teammate = s.teammate;
  });

  const players = Object.values(rec);
  if (players.length < 2) return { skip: "scoreboard not ready" };

  // which side is ours? explicit teammate flag first, then the local player's team
  const localName = String(me.name || me.player_name || "").toLowerCase();
  const localRec = players.find((p) => p.key === localName) || players.find((p) => p.local === true);
  const hasTeammateFlags = players.some((p) => p.teammate === true);

  const isOurs = (p) => {
    if (hasTeammateFlags) return p.teammate === true;
    if (localRec && p.team != null && localRec.team != null) return p.team === localRec.team;
    return p === localRec; // last resort — solo; user links the rest in Sightline
  };

  const toEntry = (p, withKast) => ({
    riotId: riotId(p.name, p.tagline),
    agent: p.agent || "",
    k: p.k || 0, d: p.d || 0, a: p.a || 0,
    ...(p.adr != null ? { adr: Math.round(p.adr) } : {}),
    ...(withKast && p.kast != null ? { kast: Math.round(p.kast) } : {}),
  });

  const us = players.filter(isOurs).map((p) => toEntry(p, true));
  const them = players.filter((p) => !isOurs(p)).map((p) => toEntry(p, false));

  if (!us.length) return { skip: "could not identify our team" };

  // pre-filter: not every custom is a scrim. Require `min` players with our name
  // prefix on one team. (The server re-checks with the roster too.)
  const prefix = opts.prefix || "";
  const min = opts.min || 3;
  if (prefix) {
    const preRe = new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s._-]?", "i");
    const nameOf = (rid) => String(rid || "").split("#")[0].trim();
    const usX = us.filter((p) => preRe.test(nameOf(p.riotId))).length;
    const themX = them.filter((p) => preRe.test(nameOf(p.riotId))).length;
    if (usX < min && themX < min) {
      return { skip: `not a scrim — ${Math.max(usX, themX)} "${prefix}" player(s) on a team (need ${min})` };
    }
  }

  return {
    payload: {
      matchId: String(matchId),
      map: normMap(mi.map || gi.map || me.map),
      mode,
      startedAt: opts.startedAt || Date.now(),
      opponentName: opts.opponentName || undefined,
      rounds: readScore(mi),
      us,
      them,
    },
  };
}

if (typeof module !== "undefined") module.exports = { buildPayload, normMap, normAgent };
