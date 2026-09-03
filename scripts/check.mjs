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
    if (e === "node_modules" || e === ".git" || e === ".wrangler") continue;
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

/* ---------- 3. overwolf parser ---------- */
console.log("overwolf");
try {
  const { buildPayload } = require("../overwolf/valorant.js");
  const R = (n, t, ch, tm) => JSON.stringify({ name: n, tagline: t, character: ch, teammate: tm });
  const scrim = {
    me: { name: "XPE nix" },
    match_info: {
      pseudo_match_id: "S1", map: "Ascent", custom_game: true, score: { won: 13, lost: 9 },
      roster_0: R("XPE nix", "EUW", "Cypher", true), roster_1: R("XPE Sable", "EUW", "Raze", true),
      roster_2: R("XPE Koda", "EU1", "Omen", true), roster_3: R("XPE Riven", "EUW", "Fade", true),
      roster_4: R("XPE Tython", "EU2", "KAYO", true), roster_5: R("Enemy1", "EU", "Jett", false),
    },
  };
  const a = buildPayload(scrim, { modes: ["custom"], prefix: "XPE", min: 3 });
  if (!a.payload || a.payload.us.length !== 5) throw new Error("scrim should be accepted with 5 on our side");
  if (a.payload.us[4].agent !== "KAY/O") throw new Error("agent alias KAYO -> KAY/O failed");

  const pug = {
    me: { name: "XPE nix" },
    match_info: {
      pseudo_match_id: "P1", map: "Bind", custom_game: true,
      roster_0: R("XPE nix", "EUW", "Cypher", true), roster_1: R("rando", "EU", "Raze", true),
      roster_5: R("r2", "EU", "Jett", false),
    },
  };
  if (!buildPayload(pug, { modes: ["custom"], prefix: "XPE", min: 3 }).skip) {
    throw new Error("1-XPE pug should be rejected");
  }
  ok("parser accepts scrims, rejects non-scrims");
} catch (e) {
  fail("parser: " + e.message);
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

  let rendered = 0;
  for (const v of Object.keys(ctx.__t.VIEWS)) {
    ctx.__t.state.view = v;
    ctx.__t.render();
    const html = byId("main")._html;
    const bad = [...new Set(html.match(/undefined|NaN|\[object Object\]/g) || [])];
    if (bad.length) fail(`view "${v}": ${bad.join(", ")} in rendered output`);
    else rendered++;
  }
  if (rendered === Object.keys(ctx.__t.VIEWS).length) ok(`all ${rendered} views render clean`);
}

function teamFixture() {
  const rk = (tier, div, rr) => ({ tier, div, rr });
  const players = [
    { id: "p1", handle: "nix", name: "R", role: "IGL", status: "Starter", icon: "🧭", joined: "2025-11-02", agents: ["Killjoy"], rank: rk("Immortal", 1, 55), riotId: { name: "XPE nix", tag: "EUW", region: "" }, rankSyncedAt: Date.now(), note: "", perfNotes: [{ id: "n1", at: Date.now(), byId: "u1", by: "CI", text: "entries on Ascent" }] },
    { id: "p2", handle: "Sable", name: "L", role: "Duelist", status: "Starter", icon: "🗡️", joined: "2025-11-02", agents: ["Jett"], rank: rk("Immortal", 2, 25), riotId: { name: "XPE Sable", tag: "EUW", region: "" }, rankSyncedAt: null, note: "", perfNotes: [] },
  ];
  return {
    team: { id: "t1", name: "XPE", tag: "XPE", server: "EU", scrimGoal: { base: 1, tournament: 3 }, tournamentWeeks: ["2026-08-31"], hasRankApiKey: true, hasIngestKey: true, importPrefix: "XPE", importMin: 3 },
    myRole: "manager", myPlayerId: null,
    schedule: { winStart: "11:00", winEnd: "24:00", includeSubs: false, blocks: [{ id: "b1", pid: "p1", day: 0, start: "13:00", end: "15:00", label: "Class" }] },
    roster: players,
    scrims: [{
      id: "s1", date: "2026-09-02", opp: "Onyx", map: "Split", rw: 13, rl: 9, matchId: "M1", source: "overwolf",
      lineup: [
        { pid: null, name: "ghost#x", agent: "Reyna", k: 5, d: 9, a: 1, adr: 80, kast: 40, present: true },
        { pid: "p1", agent: "Cypher", k: 16, d: 12, a: 9, adr: 150, kast: 72, present: true },
        { pid: "p2", agent: "Raze", k: 21, d: 13, a: 5, adr: 190, kast: 74, present: true },
      ],
    }],
    rankSnapshots: [{ id: "sn1", date: "2026-08-31", note: "x", ranks: { p1: rk("Immortal", 1, 50), p2: rk("Immortal", 2, 15) } }],
    tryouts: [{ id: "t1", date: "2026-08-20", handle: "Ares", role: "Duelist", tier: "Immortal", div: 2, agents: ["Jett"], scores: { mech: 9, util: 6, comms: 6, att: 7 }, verdict: "Shortlist", notes: "aim" }],
    activities: { weeks: {}, months: { "2026-09": { theme: "Qualifier prep", goals: [{ text: "3 scrims/wk", done: false }] } } },
    members: [{ userId: "u1", email: "ci@test", name: "CI", role: "manager", playerId: "p1" }],
  };
}
