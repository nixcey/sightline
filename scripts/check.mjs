/* CI checks — run before every deploy. No network, no Cloudflare.
   1. `node --check` every .js
   2. render all 9 frontend views against a DOM shim, fail on undefined/NaN in output
   3. exercise the Overwolf payload parser (accept a scrim, reject a non-scrim)
*/
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let failures = 0;
const fail = (m) => { console.error("  ✗ " + m); failures++; };
const ok = (m) => console.log("  ✓ " + m);

/* ---------- 1. syntax ---------- */
console.log("syntax");
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (["node_modules", ".git", ".wrangler", "dist"].includes(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith(".js") || e.endsWith(".mjs")) {
      try { execFileSync(process.execPath, ["--check", p], { stdio: "pipe" }); }
      catch (err) { fail(`${p}\n${err.stderr}`); }
    }
  }
})(root);
if (!failures) ok("all .js / .mjs parse");

/* ---------- 2. frontend views ---------- */
console.log("frontend");
try {
  await renderViews();
} catch (e) {
  fail("render harness: " + (e.stack || e.message));
}

/* ---------- 3. scrim agent — match-details parsing ---------- */
console.log("agent");
try {
  const m = await import("../agent/sightline-agent.mjs");
  m.META.agents["1e58de9c-4950-5125-93e9-a0aee9f98746"] = "Killjoy";
  m.META.maps["/Game/Maps/Ascent/Ascent"] = "Ascent";
  const P = (subj, name, tag, team, k, d, a) => ({
    subject: subj, gameName: name, tagLine: tag, teamId: team,
    characterId: "1e58de9c-4950-5125-93e9-a0aee9f98746",
    stats: { kills: k, deaths: d, assists: a, roundsPlayed: 22 },
  });
  const md = {
    matchInfo: { matchId: "abc", mapId: "/Game/Maps/Ascent/Ascent", provisioningFlowID: "CustomGame", queueID: "", gameStartMillis: 1788000000000, isCompleted: true },
    players: [
      P("me", "XPE nix", "EUW", "Blue", 16, 12, 9), P("p2", "XPE b", "EU", "Blue", 21, 13, 5),
      P("p3", "XPE c", "EU", "Blue", 10, 15, 9), P("p4", "XPE d", "EU", "Blue", 17, 11, 11),
      P("p5", "XPE e", "EU", "Blue", 16, 12, 8), P("e1", "Foe", "EU", "Red", 20, 16, 3),
    ],
    teams: [{ teamId: "Blue", roundsWon: 13 }, { teamId: "Red", roundsWon: 9 }],
    roundResults: [{ playerStats: [{ subject: "me", damage: [{ damage: 150 }] }] }],
  };
  const pl = m.buildPayload(md, "me");
  if (pl.map !== "Ascent" || pl.mode !== "custom") throw new Error("bad matchInfo parse");
  if (pl.us.length !== 5 || pl.them.length !== 1) throw new Error("bad team split");
  if (pl.rounds.won !== 13 || pl.rounds.lost !== 9) throw new Error("bad score");
  if (pl.us[0].riotId !== "XPE nix#EUW" || pl.us[0].agent !== "Killjoy") throw new Error("bad player entry");
  if (!m.looksLikeScrim(pl, { prefix: "XPE", min: 3, modes: ["custom"] })) throw new Error("5-XPE custom should pass the filter");

  // customs often omit gameName/tagLine -> names resolved by puuid via nameMap
  const noNames = { ...md, players: md.players.map((p) => ({ ...p, gameName: "", tagLine: "" })) };
  const nameMap = { me: "XPE nix#EUW", p2: "XPE b#EU", p3: "XPE c#EU", p4: "XPE d#EU", p5: "XPE e#EU", e1: "Foe#EU" };
  const pl2 = m.buildPayload(noNames, "me", nameMap);
  if (pl2.us[0].riotId !== "XPE nix#EUW") throw new Error("name-service fallback not applied");
  if (m.buildPayload(noNames, "me").us[0].riotId !== "") throw new Error("missing name should be empty, not 'undefined#undefined'");
  const rs = m.regionShardFromLog("x https://glz-eu-1.eu.a.pvp.net/y");
  if (!rs || rs.region !== "eu") throw new Error("region parse");
  if (m.versionFromLog("CI server version: release-13.05-shipping-11-5350494\n") !== "release-13.05-shipping-11-5350494") throw new Error("version parse");
  ok("match-details parses; scrim filter + log parsers work");
} catch (e) {
  fail("agent: " + (e.stack || e.message));
}

/* ---------- 4. rank-history despike ---------- */
console.log("rank history");
try {
  const { despikeHistory } = await import("../src/valorant.js");
  const mk = (i, elo, tierId) => ({ matchId: "m" + i, playedAt: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00Z`, tierId, elo });
  // steady Ascendant climb with one HenrikDev glitch row plunging to "Iron 3"
  const raw = [
    mk(0, 1810, 21), mk(1, 1825, 21), mk(2, 1840, 21),
    mk(3, 205, 5),                       // <- the bogus dip
    mk(4, 1852, 21), mk(5, 1868, 21), mk(6, 1880, 22),
  ];
  const { entries, dropped } = despikeHistory(raw);
  if (dropped !== 1) throw new Error(`expected 1 dropped, got ${dropped}`);
  if (entries.some((e) => e.matchId === "m3")) throw new Error("glitch row survived the despike");
  if (entries.length !== 6) throw new Error(`expected 6 kept, got ${entries.length}`);
  // a real climb of ~40/game must NOT be flagged
  const legit = [mk(0, 1800, 21), mk(1, 1840, 21), mk(2, 1880, 21), mk(3, 1920, 22), mk(4, 1960, 22)];
  if (despikeHistory(legit).dropped !== 0) throw new Error("a normal climb was wrongly despiked");
  // rows below Iron 1 / with no elo are always dropped
  if (despikeHistory([mk(0, 0, 0), mk(1, 1800, 21)]).entries.length !== 1) throw new Error("junk row not dropped");
  ok("despike drops HenrikDev glitch rows, keeps real movement");
} catch (e) {
  fail("rank history: " + (e.stack || e.message));
}

/* ---------- 5. fetchMmrHistory falls back to live mmr-history when stored is empty ---------- */
console.log("mmr history fallback");
{
  const realFetch = globalThis.fetch;
  try {
    const val = await import("../src/valorant.js");
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/stored-mmr-history/")) {
        return { ok: true, status: 200, headers: new Map(), json: async () => ({ status: 200, results: { total: 0 }, data: [] }) };
      }
      if (u.includes("/mmr-history/")) {
        return {
          ok: true, status: 200, headers: new Map(),
          json: async () => ({
            status: 200,
            data: [
              { match_id: "live1", tier: { id: 22, name: "Ascendant 2" }, rr: 40, last_change: 10, elo: 1940, date: "2026-09-04T00:00:00Z", map: { name: "Ascent" }, season: { short: "e11a5" } },
              { match_id: "live2", tier: { id: 22, name: "Ascendant 2" }, rr: 30, last_change: -10, elo: 1930, date: "2026-09-04T01:00:00Z", map: { name: "Bind" }, season: { short: "e11a5" } },
            ],
          }),
        };
      }
      throw new Error("unexpected fetch: " + u);
    };
    const r = await val.fetchMmrHistory({ name: "X", tag: "y" }, "eu", "key");
    if (r.source !== "live") throw new Error(`expected source "live", got "${r.source}"`);
    if (r.entries.length !== 2) throw new Error(`expected 2 entries from the live fallback, got ${r.entries.length}`);
    if (r.entries[0].matchId !== "live1" || r.entries[0].map !== "Ascent") throw new Error("live row parsed wrong");
    ok("empty stored-mmr-history falls back to live mmr-history");
  } catch (e) {
    fail("mmr history fallback: " + (e.stack || e.message));
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);

/* ---------------------------------------------------------------- helpers */
async function renderViews() {
  const reg = {};
  const El = () => {
    const e = {
      _html: "", dataset: {}, style: {}, hidden: false, value: "", checked: false, files: [], textContent: "",
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, focus() {},
      append() {}, prepend() {}, remove() {}, appendChild() {}, addEventListener() {}, removeEventListener() {},
      closest() { return El(); }, querySelector() { return El(); }, querySelectorAll() { return []; },
    };
    Object.defineProperty(e, "innerHTML", { get() { return this._html; }, set(v) { this._html = String(v); } });
    Object.defineProperty(e, "firstElementChild", { get() { return El(); } });
    return e;
  };
  const byId = (id) => (reg[id] || (reg[id] = El()));
  const fixture = teamFixture();
  const ctx = {
    console, setTimeout: () => 0, confirm: () => true, FormData: class { entries() { return []; } },
    document: {
      documentElement: { getAttribute: () => null, setAttribute() {}, removeAttribute() {} },
      body: El(), createElement: () => El(),
      querySelector: (s) => (s && s[0] === "#" ? byId(s.slice(1)) : El()),
      querySelectorAll: () => [], addEventListener() {},
    },
    window: { addEventListener() {}, location: { hash: "", origin: "https://ci.test" } },
    location: { hash: "", origin: "https://ci.test" }, history: { replaceState() {} }, navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    API: {
      get: async (p) => {
        if (p === "/api/me") return { user: { id: "u1", email: "ci@test", name: "CI" }, teams: [{ id: "t1", name: "XPE", tag: "XPE", role: "manager" }] };
        if (p === "/api/auth/state") return { needsBootstrap: false };
        if (/^\/api\/teams\/[^/]+$/.test(p)) return JSON.parse(JSON.stringify(fixture));
        if (/rank-history$/.test(p)) return { history: rankHistoryFixture() };
        if (/invites$/.test(p)) return [];
        return {};
      },
      post: async () => ({}), put: async () => ({}), del: async () => ({}), req: async () => ({}),
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(root, "public/app.js"), "utf8") + "\n;globalThis.__t = { VIEWS, state, render, getB: () => BUNDLE };", ctx, { filename: "app.js" });

  for (let i = 0; i < 80; i++) await Promise.resolve(); // let the EOF boot() settle
  if (!ctx.__t || !ctx.__t.getB()) throw new Error("app.js boot() did not load the team bundle");

  ctx.__t.state.rankHist = rankHistoryFixture(); // skip the lazy-load branch in VIEWS_ranks

  let rendered = 0;
  for (const v of Object.keys(ctx.__t.VIEWS)) {
    ctx.__t.state.view = v;
    for (const rv of v === "ranks" ? ["team", "p1"] : [null]) {
      if (rv) ctx.__t.state.rankView = rv;
      ctx.__t.render();
      const html = byId("main")._html;
      const bad = [...new Set(html.match(/undefined|NaN|\[object Object\]/g) || [])];
      if (bad.length) fail(`view "${v}"${rv ? ` (${rv})` : ""}: ${bad.join(", ")} in rendered output`);
    }
    rendered++;
  }
  if (rendered === Object.keys(ctx.__t.VIEWS).length) ok(`all ${rendered} views render clean`);

  /* the shell (masthead, title block, tab strip) lives outside #main, so the
     loop above can't see it — a broken shell would render every view into a
     dead page. Assert the pieces render() is responsible for. */
  ctx.__t.state.view = "overview";
  ctx.__t.render();
  const navHtml = byId("nav")._html;
  const tabs = (navHtml.match(/data-v="/g) || []).length;
  if (tabs !== rendered) fail(`shell: ${tabs} tabs rendered, expected ${rendered}`);
  if (!/class="on"/.test(navHtml)) fail("shell: no active tab marked");
  for (const [id, want] of [["viewTitle", "Overview"], ["teamName", "XPE"], ["teamTag", "XPE"],
                            ["acctName", "CI"], ["acctInit", "C"], ["roleBadge", "manager"]]) {
    const got = byId(id).textContent;
    if (got !== want) fail(`shell: #${id} = "${got}", expected "${want}"`);
  }
  if (byId("topctl").hidden) fail("shell: week controls hidden on Overview");
  ctx.__t.state.view = "roster";
  ctx.__t.render();
  if (!byId("topctl").hidden) fail("shell: week controls shown on Roster, which ignores state.week");
  ok("shell renders: tab strip, team + account identity, per-view week controls");
}

function rankHistoryFixture() {
  const day = 86400000;
  const mk = (pid, i, tierId, rr, chg) => ({
    playerId: pid, matchId: `${pid}-m${i}`,
    playedAt: new Date(Date.now() - (12 - i) * day).toISOString(),
    tierId, tierName: "x", rr, lastChange: chg, elo: (tierId - 3) * 100 + rr, map: "Ascent", season: "e11a5",
  });
  return [
    mk("p1", 1, 24, 10, 20), mk("p1", 2, 24, 30, 20), mk("p1", 3, 0, 0, 0), /* junk row the FE guard must hide */
    mk("p1", 4, 24, 12, -18), mk("p1", 5, 25, 5, 21),
    mk("p2", 1, 23, 80, 15), mk("p2", 2, 24, 4, 19), mk("p2", 3, 24, 25, 21), mk("p2", 4, 24, 8, -17),
  ];
}

function teamFixture() {
  const rk = (tier, div, rr) => ({ tier, div, rr });
  const players = [
    { id: "p1", handle: "nix", name: "R", role: "IGL", roles: ["IGL", "Controller"], status: "Starter", icon: "🧭", joined: "2025-11-02", agents: ["Killjoy"], rank: rk("Immortal", 1, 55), riotId: { name: "XPE nix", tag: "EUW", region: "" }, rankSyncedAt: Date.now(), note: "", perfNotes: [{ id: "n1", at: Date.now(), byId: "u1", by: "CI", text: "entries on Ascent" }] },
    { id: "p2", handle: "Sable", name: "L", role: "Duelist", roles: ["Duelist", "Sentinel"], status: "Starter", icon: "🗡️", joined: "2025-11-02", agents: ["Jett"], rank: rk("Immortal", 2, 25), riotId: { name: "XPE Sable", tag: "EUW", region: "" }, rankSyncedAt: null, note: "", perfNotes: [] },
  ];
  return {
    team: { id: "t1", name: "XPE", tag: "XPE", server: "EU", scrimGoal: { base: 1, tournament: 3 }, tournamentWeeks: ["2026-08-31"], hasRankApiKey: true, hasIngestKey: true, hasDiscord: true, discordRoleId: "1234567890", importPrefix: "XPE", importMin: 3 },
    myRole: "manager", myPlayerId: null,
    schedule: { winStart: "11:00", winEnd: "24:00", includeSubs: false, blocks: [{ id: "b1", pid: "p1", day: 0, start: "13:00", end: "15:00", label: "Class" }] },
    roster: players,
    scrims: [{
      id: "s1", date: "2026-09-02", opp: "Imported scrim", map: "Split", rw: 13, rl: 9, matchId: "M1", source: "overwolf",
      kind: "scrim", vods: ["https://youtu.be/abc123"],
      enemy: [
        { name: "NRG demon1", agent: "Jett", k: 20, d: 14, a: 3, adr: 170 },
        { name: "NRG s0m", agent: "Omen", k: 15, d: 15, a: 8, adr: 140 },
        { name: "NRG FNS", agent: "Fade", k: 9, d: 16, a: 12, adr: 95 },
      ],
      lineup: [
        { pid: null, name: "ghost#x", agent: "Reyna", k: 5, d: 9, a: 1, adr: 80, kast: 40, present: true },
        { pid: "p1", agent: "Cypher", k: 16, d: 12, a: 9, adr: 150, kast: 72, present: true },
        { pid: "p2", agent: "Raze", k: 21, d: 13, a: 5, adr: 190, kast: 74, present: true },
      ],
    }, {
      id: "s2", date: "2026-08-28", opp: "Titans", map: "Ascent", rw: 13, rl: 11, matchId: null, source: null,
      kind: "official", vods: [],
      lineup: [
        { pid: "p1", agent: "Killjoy", k: 18, d: 14, a: 7, adr: 160, kast: 70, present: true },
        { pid: "p2", agent: "Jett", k: 15, d: 16, a: 4, adr: 145, kast: 66, present: true },
      ],
    }],
    tryouts: [{ id: "t1", date: "2026-08-20", handle: "Ares", role: "Duelist", roles: ["Duelist", "Sentinel"], tier: "Immortal", div: 2, agents: ["Jett"], scores: { mech: 9, util: 6, comms: 6, att: 7 }, verdict: "Shortlist", notes: "aim" }],
    activities: { weeks: {}, months: { "2026-09": { theme: "Qualifier prep", goals: [{ text: "3 scrims/wk", done: false }] } } },
    members: [{ userId: "u1", email: "ci@test", name: "CI", role: "manager", playerId: "p1" }],
  };
}
