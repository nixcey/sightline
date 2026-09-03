import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import * as auth from "./auth.js";
import * as val from "./valorant.js";
import { seedTeam } from "./seed.js";

const ROLE = { player: 1, igl: 2, manager: 3 };
const now = () => Date.now();
const nid = auth.uid;

const J = (s, d) => {
  try {
    return s == null ? d : JSON.parse(s);
  } catch {
    return d;
  }
};
const readJson = async (c) => {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
};
const bad = (c, msg, code = 400) => c.json({ error: msg }, code);

// ---------------------------------------------------------------- Discord notifications
const DISCORD_RE = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/;
const COLOR = { good: 0x3ad1bf, bad: 0xf0656e, gold: 0xe7a343, accent: 0xff4655, grey: 0x767c86 };
// role mention has to sit in `content` (embeds never ping); allowed_mentions lets a
// webhook ping a role even when it isn't set "mentionable" in Discord.
function withRolePing(payload, roleId) {
  if (!roleId) return payload;
  return {
    ...payload,
    content: `<@&${roleId}>${payload.content ? " " + payload.content : ""}`,
    allowed_mentions: { parse: [], roles: [roleId] },
  };
}
async function discordSend(webhook, payload) {
  if (!webhook || !DISCORD_RE.test(webhook)) return false;
  try {
    const r = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    return r.ok;
  } catch { return false; }
}
async function notifyTeam(c, teamRowOrId, payload) {
  let webhook, roleId;
  if (teamRowOrId && typeof teamRowOrId === "object") {
    webhook = teamRowOrId.discord_webhook;
    roleId = teamRowOrId.discord_role_id;
  }
  if (webhook == null) {
    const t = await c.env.DB.prepare("SELECT discord_webhook, discord_role_id FROM teams WHERE id = ?").bind(teamRowOrId).first();
    webhook = t && t.discord_webhook;
    roleId = t && t.discord_role_id;
  }
  if (!webhook) return;
  const p = discordSend(webhook, withRolePing(payload, roleId));
  if (c.executionCtx && c.executionCtx.waitUntil) c.executionCtx.waitUntil(p);
  else await p;
}

// ---------------------------------------------------------------- row mappers
const rowPlayer = (p) => ({
  id: p.id,
  handle: p.handle,
  name: p.name,
  role: p.role,
  status: p.status,
  icon: p.icon,
  joined: p.joined,
  agents: J(p.agents, []),
  rank: J(p.rank, null),
  riotId: J(p.riot_id, null),
  rankSyncedAt: p.rank_synced_at,
  note: p.note,
  perfNotes: J(p.perf_notes, []),
});
const rowScrim = (s) => ({
  id: s.id,
  date: s.date,
  opp: s.opp,
  map: s.map,
  rw: s.rw,
  rl: s.rl,
  lineup: J(s.lineup, []),
  matchId: s.match_id || null,
  source: s.source || "manual",
  kind: s.kind || "scrim",
  vods: J(s.vods, []),
  enemy: J(s.enemy, []),
});
const rowTryout = (t) => ({
  id: t.id,
  date: t.date,
  handle: t.handle,
  role: t.role,
  roles: (() => { const r = J(t.roles, []); return r.length ? r : t.role ? [t.role] : []; })(),
  tier: t.tier,
  div: t.div,
  agents: J(t.agents, []),
  scores: J(t.scores, {}),
  verdict: t.verdict,
  notes: t.notes,
});

// ---------------------------------------------------------------- app + auth mw
const app = new Hono();

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "server error" }, 500);
});

app.use("/api/*", async (c, next) => {
  c.set("user", await auth.getSessionUser(c.env.DB, getCookie(c, auth.cookieName)));
  await next();
});

const requireUser = async (c, next) => {
  if (!c.get("user")) return c.json({ error: "sign in required" }, 401);
  await next();
};

// team membership guard, minimum role
const team = (min) => async (c, next) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "sign in required" }, 401);
  const m = await c.env.DB.prepare("SELECT role, player_id FROM team_members WHERE team_id = ? AND user_id = ?")
    .bind(c.req.param("id"), u.id)
    .first();
  if (!m) return c.json({ error: "not a member of this team" }, 403);
  if (ROLE[m.role] < ROLE[min]) return c.json({ error: "your role can't do that" }, 403);
  c.set("member", m);
  await next();
};

async function setSession(c, userId) {
  const token = await auth.createSession(c.env.DB, userId);
  setCookie(c, auth.cookieName, token, {
    ...auth.cookieBase,
    secure: new URL(c.req.url).protocol === "https:",
  });
}

// ================================================================ auth
app.get("/api/auth/state", async (c) => {
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
  return c.json({ needsBootstrap: n.n === 0 });
});

app.post("/api/auth/bootstrap", async (c) => {
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
  if (n.n > 0) return bad(c, "the first account already exists — sign in", 403);
  const b = await readJson(c);
  const email = (b.email || "").toLowerCase().trim();
  if (!email || !b.password || !b.name) return bad(c, "name, email and password are required");
  if (b.password.length < 8) return bad(c, "password must be at least 8 characters");
  const { hash, salt } = await auth.hashPassword(b.password);
  const id = nid(8);
  await c.env.DB.prepare("INSERT INTO users (id,email,name,pw_hash,pw_salt,created_at) VALUES (?,?,?,?,?,?)")
    .bind(id, email, b.name.trim(), hash, salt, now())
    .run();
  await setSession(c, id);
  return c.json({ ok: true });
});

app.post("/api/auth/login", async (c) => {
  const b = await readJson(c);
  const u = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?")
    .bind((b.email || "").toLowerCase().trim())
    .first();
  if (!u || !(await auth.verifyPassword(b.password || "", u.pw_hash, u.pw_salt)))
    return bad(c, "wrong email or password", 401);
  await setSession(c, u.id);
  return c.json({ ok: true });
});

app.post("/api/auth/logout", async (c) => {
  await auth.destroySession(c.env.DB, getCookie(c, auth.cookieName));
  deleteCookie(c, auth.cookieName, { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/me", requireUser, async (c) => {
  const u = c.get("user");
  const teams = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.tag, tm.role
       FROM team_members tm JOIN teams t ON t.id = tm.team_id
      WHERE tm.user_id = ? ORDER BY t.name`,
  )
    .bind(u.id)
    .all();
  return c.json({ user: { id: u.id, email: u.email, name: u.name }, teams: teams.results });
});

app.put("/api/me", requireUser, async (c) => {
  const u = c.get("user");
  const b = await readJson(c);
  const name = (b.name ?? u.name).trim();
  const email = (b.email ?? u.email).toLowerCase().trim();
  if (!name) return bad(c, "name can't be empty");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(c, "that doesn't look like a valid email");
  if (email !== u.email) {
    const taken = await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ? AND id != ?").bind(email, u.id).first();
    if (taken) return bad(c, "another account already uses that email", 409);
  }
  await c.env.DB.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").bind(name, email, u.id).run();
  return c.json({ ok: true });
});

app.post("/api/me/password", requireUser, async (c) => {
  const u = c.get("user");
  const b = await readJson(c);
  if (!b.newPassword || b.newPassword.length < 8) return bad(c, "new password must be at least 8 characters");
  const row = await c.env.DB.prepare("SELECT pw_hash, pw_salt FROM users WHERE id = ?").bind(u.id).first();
  if (!(await auth.verifyPassword(b.currentPassword || "", row.pw_hash, row.pw_salt)))
    return bad(c, "current password is wrong", 401);
  const { hash, salt } = await auth.hashPassword(b.newPassword);
  const keep = await auth.sha256hex(getCookie(c, auth.cookieName) || "");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?").bind(hash, salt, u.id),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(u.id, keep),
  ]);
  return c.json({ ok: true });
});

// ================================================================ invites (public)
app.get("/api/invites/:code", async (c) => {
  const iv = await c.env.DB.prepare(
    "SELECT i.*, t.name AS teamName FROM invites i JOIN teams t ON t.id = i.team_id WHERE i.code = ?",
  )
    .bind(c.req.param("code"))
    .first();
  if (!iv) return bad(c, "invite not found", 404);
  if (iv.used_by) return bad(c, "invite already used", 410);
  if (iv.expires_at < now()) return bad(c, "invite expired", 410);
  return c.json({ teamName: iv.teamName, role: iv.role, email: iv.email || null });
});

app.post("/api/invites/:code/accept", async (c) => {
  const b = await readJson(c);
  const code = c.req.param("code");
  const iv = await c.env.DB.prepare("SELECT * FROM invites WHERE code = ?").bind(code).first();
  if (!iv || iv.used_by || iv.expires_at < now()) return bad(c, "invite is invalid or already used", 410);
  const email = (iv.email || b.email || "").toLowerCase().trim();
  if (!email || !b.password || !b.name) return bad(c, "name, email and password are required");
  if (b.password.length < 8) return bad(c, "password must be at least 8 characters");
  if (await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first())
    return bad(c, "an account with that email already exists", 409);
  const { hash, salt } = await auth.hashPassword(b.password);
  const uid = nid(8);
  await c.env.DB.prepare("INSERT INTO users (id,email,name,pw_hash,pw_salt,created_at) VALUES (?,?,?,?,?,?)")
    .bind(uid, email, b.name.trim(), hash, salt, now())
    .run();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO team_members (team_id,user_id,role,player_id,created_at) VALUES (?,?,?,?,?)").bind(
      iv.team_id,
      uid,
      iv.role,
      iv.player_id,
      now(),
    ),
    c.env.DB.prepare("UPDATE invites SET used_by = ? WHERE code = ?").bind(uid, code),
  ]);
  await setSession(c, uid);
  return c.json({ ok: true, teamId: iv.team_id });
});

app.post("/api/teams/join", requireUser, async (c) => {
  const b = await readJson(c);
  const iv = await c.env.DB.prepare("SELECT * FROM invites WHERE code = ?").bind(b.code || "").first();
  if (!iv || iv.used_by || iv.expires_at < now()) return bad(c, "invite is invalid or already used", 410);
  const u = c.get("user");
  if (await c.env.DB.prepare("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?").bind(iv.team_id, u.id).first())
    return bad(c, "you're already on this team", 409);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO team_members (team_id,user_id,role,player_id,created_at) VALUES (?,?,?,?,?)").bind(
      iv.team_id,
      u.id,
      iv.role,
      iv.player_id,
      now(),
    ),
    c.env.DB.prepare("UPDATE invites SET used_by = ? WHERE code = ?").bind(u.id, iv.code),
  ]);
  return c.json({ ok: true, teamId: iv.team_id });
});

// ================================================================ teams
app.post("/api/teams", requireUser, async (c) => {
  const b = await readJson(c);
  if (!b.name) return bad(c, "team name is required");
  const id = nid(8);
  await c.env.DB.prepare("INSERT INTO teams (id,name,tag,server,created_at) VALUES (?,?,?,?,?)")
    .bind(id, b.name.trim(), (b.tag || b.name.slice(0, 4).toUpperCase()).trim(), b.server || "EU", now())
    .run();
  await c.env.DB.prepare("INSERT INTO team_members (team_id,user_id,role,created_at) VALUES (?,?,?,?)")
    .bind(id, c.get("user").id, "manager", now())
    .run();
  if (b.demo) await seedTeam(c.env.DB, id).catch((e) => console.error("seed failed", e));
  return c.json({ id });
});

app.get("/api/teams/:id", team("player"), async (c) => {
  const id = c.req.param("id");
  const db = c.env.DB;
  const [t, players, scrims, snaps, tryouts, weeks, months, members] = await Promise.all([
    db.prepare("SELECT * FROM teams WHERE id = ?").bind(id).first(),
    db.prepare("SELECT * FROM players WHERE team_id = ? ORDER BY sort, handle").bind(id).all(),
    db.prepare("SELECT * FROM scrims WHERE team_id = ? ORDER BY date").bind(id).all(),
    db.prepare("SELECT * FROM rank_snapshots WHERE team_id = ? ORDER BY date").bind(id).all(),
    db.prepare("SELECT * FROM tryouts WHERE team_id = ? ORDER BY date DESC").bind(id).all(),
    db.prepare("SELECT * FROM activities_weeks WHERE team_id = ?").bind(id).all(),
    db.prepare("SELECT * FROM activities_months WHERE team_id = ?").bind(id).all(),
    db
      .prepare(
        `SELECT tm.user_id, tm.role, tm.player_id, u.email, u.name
           FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ? ORDER BY u.name`,
      )
      .bind(id)
      .all(),
  ]);
  const m = c.get("member");
  return c.json({
    team: {
      id: t.id,
      name: t.name,
      tag: t.tag,
      server: t.server,
      scrimGoal: J(t.scrim_goal, { base: 1, tournament: 3 }),
      tournamentWeeks: J(t.tournament_weeks, []),
      hasRankApiKey: !!t.rank_api_key,
      hasIngestKey: !!t.ingest_key,
      hasDiscord: !!t.discord_webhook,
      discordRoleId: t.discord_role_id || "",
      importPrefix: t.import_prefix || t.tag,
      importMin: t.import_min ?? 3,
    },
    myRole: m.role,
    myPlayerId: m.player_id,
    schedule: J(t.schedule, { winStart: "11:00", winEnd: "24:00", includeSubs: false, blocks: [] }),
    roster: players.results.map(rowPlayer),
    scrims: scrims.results.map(rowScrim),
    rankSnapshots: snaps.results.map((s) => ({ id: s.id, date: s.date, note: s.note, ranks: J(s.ranks, {}) })),
    tryouts: tryouts.results.map(rowTryout),
    activities: {
      weeks: Object.fromEntries(weeks.results.map((w) => [w.week_key, J(w.data, {})])),
      months: Object.fromEntries(months.results.map((mo) => [mo.month_key, { theme: mo.theme, goals: J(mo.goals, []) }])),
    },
    members: members.results.map((x) => ({
      userId: x.user_id,
      email: x.email,
      name: x.name,
      role: x.role,
      playerId: x.player_id,
    })),
  });
});

app.put("/api/teams/:id", team("igl"), async (c) => {
  const b = await readJson(c);
  const sets = [], vals = [];
  const put = (col, v) => { sets.push(`${col}=?`); vals.push(v); };
  if ("name" in b) put("name", String(b.name).trim());
  if ("tag" in b) put("tag", String(b.tag).trim());
  if ("server" in b) put("server", b.server);
  if ("scrimGoal" in b) put("scrim_goal", JSON.stringify(b.scrimGoal || { base: 1, tournament: 3 }));
  if ("tournamentWeeks" in b) put("tournament_weeks", JSON.stringify(b.tournamentWeeks || []));
  if ("importPrefix" in b) put("import_prefix", String(b.importPrefix || "").trim());
  if ("importMin" in b) put("import_min", Math.max(1, Math.min(5, Math.round(Number(b.importMin) || 3))));
  if (!sets.length) return c.json({ ok: true });
  const id = c.req.param("id");

  let newTournyWeeks = null;
  if ("tournamentWeeks" in b) {
    const prev = await c.env.DB.prepare("SELECT tournament_weeks FROM teams WHERE id = ?").bind(id).first();
    const before = new Set(J(prev.tournament_weeks, []));
    newTournyWeeks = (b.tournamentWeeks || []).filter((w) => !before.has(w));
  }

  vals.push(id);
  await c.env.DB.prepare(`UPDATE teams SET ${sets.join(", ")} WHERE id=?`).bind(...vals).run();

  for (const w of newTournyWeeks || []) {
    await notifyTeam(c, id, { embeds: [{ title: "◆ Tournament week", description: `The week of **${w}** is now a tournament week.`, color: COLOR.gold }] });
  }
  return c.json({ ok: true });
});

app.put("/api/teams/:id/secrets", team("igl"), async (c) => {
  const b = await readJson(c);
  await c.env.DB.prepare("UPDATE teams SET rank_api_key=? WHERE id=?")
    .bind((b.rankApiKey || "").trim(), c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

// team deletion stays manager-only — it's the one "ownership" action
app.delete("/api/teams/:id", team("manager"), async (c) => {
  const id = c.req.param("id");
  const kids = ["players", "scrims", "rank_snapshots", "tryouts", "activities_weeks", "activities_months", "invites", "team_members"];
  await c.env.DB.batch([
    ...kids.map((k) => c.env.DB.prepare(`DELETE FROM ${k} WHERE team_id = ?`).bind(id)),
    c.env.DB.prepare("DELETE FROM teams WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});

app.post("/api/teams/:id/seed-demo", team("igl"), async (c) => {
  const id = c.req.param("id");
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM players WHERE team_id = ?").bind(id).first();
  if (n.n > 0) return bad(c, "team already has players");
  await seedTeam(c.env.DB, id);
  return c.json({ ok: true });
});

// ---- Overwolf scrim-importer ingest key (manager rotates it; shown once) ----
app.post("/api/teams/:id/ingest-key", team("igl"), async (c) => {
  const key = "sk_" + nid(24);
  await c.env.DB.prepare("UPDATE teams SET ingest_key = ? WHERE id = ?").bind(key, c.req.param("id")).run();
  return c.json({ key });
});
app.delete("/api/teams/:id/ingest-key", team("igl"), async (c) => {
  await c.env.DB.prepare("UPDATE teams SET ingest_key = '' WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ---- Discord webhook for team notifications ----
app.put("/api/teams/:id/discord", team("igl"), async (c) => {
  const b = await readJson(c);
  const sets = [], vals = [];
  if ("webhook" in b) {
    const webhook = String(b.webhook || "").trim();
    if (webhook && !DISCORD_RE.test(webhook)) return bad(c, "that isn't a Discord webhook URL");
    sets.push("discord_webhook = ?"); vals.push(webhook);
  }
  if ("roleId" in b) {
    sets.push("discord_role_id = ?");
    vals.push(String(b.roleId || "").replace(/\D/g, "").slice(0, 24));
  }
  if (sets.length) {
    vals.push(c.req.param("id"));
    await c.env.DB.prepare(`UPDATE teams SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  }
  const t = await c.env.DB.prepare("SELECT discord_webhook FROM teams WHERE id = ?").bind(c.req.param("id")).first();
  return c.json({ ok: true, connected: !!t.discord_webhook });
});
app.post("/api/teams/:id/discord/test", team("igl"), async (c) => {
  const t = await c.env.DB.prepare("SELECT discord_webhook, discord_role_id, name FROM teams WHERE id = ?").bind(c.req.param("id")).first();
  if (!t.discord_webhook) return bad(c, "no webhook set — save one first");
  const ok = await discordSend(t.discord_webhook, withRolePing({
    embeds: [{ title: "✅ Sightline connected", description: `Notifications for **${t.name}** will post here${t.discord_role_id ? ", pinging this role" : ""}.`, color: COLOR.good }],
  }, t.discord_role_id));
  return ok ? c.json({ ok: true }) : bad(c, "Discord rejected the webhook (deleted or wrong URL?)");
});

// ================================================================ members + invites
app.post("/api/teams/:id/invites", team("igl"), async (c) => {
  const b = await readJson(c);
  const role = ["manager", "igl", "player"].includes(b.role) ? b.role : "player";
  const code = nid(9);
  await c.env.DB.prepare(
    "INSERT INTO invites (code,team_id,role,email,player_id,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)",
  )
    .bind(code, c.req.param("id"), role, (b.email || "").toLowerCase().trim() || null, b.playerId || null, c.get("user").id, now(), now() + 14 * 86_400_000)
    .run();
  return c.json({ code });
});

app.get("/api/teams/:id/invites", team("igl"), async (c) => {
  const r = await c.env.DB.prepare(
    "SELECT code, role, email, player_id, created_at, expires_at, used_by FROM invites WHERE team_id = ? AND used_by IS NULL AND expires_at > ? ORDER BY created_at DESC",
  )
    .bind(c.req.param("id"), now())
    .all();
  return c.json(r.results);
});

app.delete("/api/teams/:id/invites/:code", team("igl"), async (c) => {
  await c.env.DB.prepare("DELETE FROM invites WHERE team_id = ? AND code = ?")
    .bind(c.req.param("id"), c.req.param("code"))
    .run();
  return c.json({ ok: true });
});

async function guardLastManager(db, teamId, userId) {
  const cur = await db.prepare("SELECT role FROM team_members WHERE team_id = ? AND user_id = ?").bind(teamId, userId).first();
  if (cur && cur.role === "manager") {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id = ? AND role = 'manager'").bind(teamId).first();
    if (n.n <= 1) return false;
  }
  return true;
}

app.put("/api/teams/:id/members/:userId", team("igl"), async (c) => {
  const b = await readJson(c);
  const { id, userId } = c.req.param();
  if (b.role && b.role !== "manager" && !(await guardLastManager(c.env.DB, id, userId)))
    return bad(c, "the team needs at least one manager");
  await c.env.DB.prepare("UPDATE team_members SET role = COALESCE(?, role), player_id = ? WHERE team_id = ? AND user_id = ?")
    .bind(["manager", "igl", "player"].includes(b.role) ? b.role : null, b.playerId ?? null, id, userId)
    .run();
  return c.json({ ok: true });
});

app.delete("/api/teams/:id/members/:userId", team("igl"), async (c) => {
  const { id, userId } = c.req.param();
  if (!(await guardLastManager(c.env.DB, id, userId))) return bad(c, "the team needs at least one manager");
  await c.env.DB.prepare("DELETE FROM team_members WHERE team_id = ? AND user_id = ?").bind(id, userId).run();
  return c.json({ ok: true });
});

// ================================================================ players
app.post("/api/teams/:id/players", team("igl"), async (c) => {
  const b = await readJson(c);
  const id = c.req.param("id");
  const pid = nid(8);
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM players WHERE team_id = ?").bind(id).first();
  await c.env.DB.prepare(
    `INSERT INTO players (id,team_id,handle,name,role,status,icon,joined,agents,rank,riot_id,note,sort)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      pid,
      id,
      b.handle || "New player",
      b.name || "",
      b.role || "Flex",
      b.status || "Trial",
      b.icon || "🎯",
      b.joined || "",
      JSON.stringify(b.agents || []),
      b.rank ? JSON.stringify(b.rank) : null,
      b.riotId ? JSON.stringify(b.riotId) : null,
      b.note || "",
      n.n,
    )
    .run();
  return c.json({ id: pid });
});

const PLAYER_COL = {
  handle: "handle",
  name: "name",
  role: "role",
  status: "status",
  icon: "icon",
  joined: "joined",
  agents: "agents",
  rank: "rank",
  riotId: "riot_id",
  note: "note",
};

app.put("/api/teams/:id/players/:pid", team("player"), async (c) => {
  const b = await readJson(c);
  const { id, pid } = c.req.param();
  const m = c.get("member");
  const isAdmin = ROLE[m.role] >= ROLE.igl;
  if (!isAdmin && m.player_id !== pid) return bad(c, "you can only edit your own profile", 403);
  // players manage their own identity + gameplay prefs; roster decisions (status, joined) stay admin-only
  const allowed = isAdmin ? Object.keys(PLAYER_COL) : ["handle", "name", "role", "icon", "agents", "riotId", "rank", "note"];
  const sets = [];
  const vals = [];
  for (const f of allowed) {
    if (!(f in b)) continue;
    sets.push(`${PLAYER_COL[f]} = ?`);
    vals.push(["agents", "rank", "riotId"].includes(f) ? (b[f] == null ? null : JSON.stringify(b[f])) : b[f]);
  }
  if (!sets.length) return c.json({ ok: true });
  vals.push(id, pid);
  await c.env.DB.prepare(`UPDATE players SET ${sets.join(", ")} WHERE team_id = ? AND id = ?`).bind(...vals).run();
  return c.json({ ok: true });
});

app.delete("/api/teams/:id/players/:pid", team("igl"), async (c) => {
  const { id, pid } = c.req.param();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM players WHERE team_id = ? AND id = ?").bind(id, pid),
    c.env.DB.prepare("UPDATE team_members SET player_id = NULL WHERE team_id = ? AND player_id = ?").bind(id, pid),
  ]);
  return c.json({ ok: true });
});

// ---- per-player performance notes (a player can post on their own; admins on anyone) ----
app.post("/api/teams/:id/players/:pid/notes", team("player"), async (c) => {
  const { id, pid } = c.req.param();
  const m = c.get("member");
  const u = c.get("user");
  const isAdmin = ROLE[m.role] >= ROLE.igl;
  if (!isAdmin && m.player_id !== pid) return bad(c, "you can only add notes on your own performance", 403);
  const b = await readJson(c);
  const text = (b.text || "").trim();
  if (!text) return bad(c, "note is empty");
  const p = await c.env.DB.prepare("SELECT perf_notes FROM players WHERE team_id = ? AND id = ?").bind(id, pid).first();
  if (!p) return bad(c, "player not found", 404);
  const notes = J(p.perf_notes, []);
  notes.unshift({ id: nid(6), at: now(), byId: u.id, by: u.name, text: text.slice(0, 2000) });
  await c.env.DB.prepare("UPDATE players SET perf_notes = ? WHERE team_id = ? AND id = ?")
    .bind(JSON.stringify(notes.slice(0, 100)), id, pid)
    .run();
  return c.json({ ok: true });
});

app.delete("/api/teams/:id/players/:pid/notes/:noteId", team("player"), async (c) => {
  const { id, pid, noteId } = c.req.param();
  const m = c.get("member");
  const u = c.get("user");
  const isAdmin = ROLE[m.role] >= ROLE.igl;
  const p = await c.env.DB.prepare("SELECT perf_notes FROM players WHERE team_id = ? AND id = ?").bind(id, pid).first();
  if (!p) return bad(c, "player not found", 404);
  const notes = J(p.perf_notes, []);
  const target = notes.find((n) => n.id === noteId);
  if (!target) return c.json({ ok: true });
  if (!isAdmin && target.byId !== u.id) return bad(c, "you can only delete your own notes", 403);
  await c.env.DB.prepare("UPDATE players SET perf_notes = ? WHERE team_id = ? AND id = ?")
    .bind(JSON.stringify(notes.filter((n) => n.id !== noteId)), id, pid)
    .run();
  return c.json({ ok: true });
});

// ================================================================ scrims
const scrimKind = (v) => (v === "official" ? "official" : "scrim");
const cleanVods = (v) => (Array.isArray(v) ? v.map((u) => String(u || "").trim()).filter(Boolean).slice(0, 8) : []);

app.post("/api/teams/:id/scrims", team("igl"), async (c) => {
  const b = await readJson(c);
  const id = c.req.param("id");
  const sid = nid(8);
  const kind = scrimKind(b.kind);
  const rw = +b.rw || 0, rl = +b.rl || 0;
  await c.env.DB.prepare("INSERT INTO scrims (id,team_id,date,opp,map,rw,rl,lineup,kind,vods,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(sid, id, b.date, b.opp || "TBD", b.map, rw, rl, JSON.stringify(b.lineup || []), kind, JSON.stringify(cleanVods(b.vods)), now())
    .run();
  await notifyTeam(c, id, {
    embeds: [{
      title: `${kind === "official" ? "🏆 Official" : "⚔️ Scrim"} · ${b.map} vs ${b.opp || "TBD"}`,
      description: `**${rw}–${rl}** ${rw > rl ? "win" : rw < rl ? "loss" : "draw"}`,
      color: rw > rl ? COLOR.good : rw < rl ? COLOR.bad : COLOR.grey,
    }],
  });
  return c.json({ id: sid });
});

app.put("/api/teams/:id/scrims/:sid", team("igl"), async (c) => {
  const b = await readJson(c);
  const { id, sid } = c.req.param();
  await c.env.DB.prepare("UPDATE scrims SET date=?, opp=?, map=?, rw=?, rl=?, lineup=?, kind=?, vods=? WHERE team_id=? AND id=?")
    .bind(b.date, b.opp || "TBD", b.map, +b.rw || 0, +b.rl || 0, JSON.stringify(b.lineup || []), scrimKind(b.kind), JSON.stringify(cleanVods(b.vods)), id, sid)
    .run();
  return c.json({ ok: true });
});

app.delete("/api/teams/:id/scrims/:sid", team("igl"), async (c) => {
  const { id, sid } = c.req.param();
  await c.env.DB.prepare("DELETE FROM scrims WHERE team_id=? AND id=?").bind(id, sid).run();
  return c.json({ ok: true });
});

// ================================================================ rank snapshots
app.post("/api/teams/:id/snapshots", team("igl"), async (c) => {
  const b = await readJson(c);
  const sid = nid(8);
  await c.env.DB.prepare("INSERT INTO rank_snapshots (id,team_id,date,note,ranks) VALUES (?,?,?,?,?)")
    .bind(sid, c.req.param("id"), b.date, b.note || "", JSON.stringify(b.ranks || {}))
    .run();
  return c.json({ id: sid });
});

app.put("/api/teams/:id/snapshots/:sid", team("igl"), async (c) => {
  const b = await readJson(c);
  const { id, sid } = c.req.param();
  await c.env.DB.prepare("UPDATE rank_snapshots SET date=?, note=?, ranks=? WHERE team_id=? AND id=?")
    .bind(b.date, b.note || "", JSON.stringify(b.ranks || {}), id, sid)
    .run();
  return c.json({ ok: true });
});

app.delete("/api/teams/:id/snapshots/:sid", team("igl"), async (c) => {
  const { id, sid } = c.req.param();
  await c.env.DB.prepare("DELETE FROM rank_snapshots WHERE team_id=? AND id=?").bind(id, sid).run();
  return c.json({ ok: true });
});

app.post("/api/teams/:id/sync-ranks", team("igl"), async (c) => {
  const id = c.req.param("id");
  const b = await readJson(c);
  const t = await c.env.DB.prepare("SELECT rank_api_key, server FROM teams WHERE id = ?").bind(id).first();
  const key = (t.rank_api_key || "").trim();
  if (!key) return bad(c, "no rank API key set — add one in Team settings");
  const rows = await c.env.DB.prepare("SELECT id, riot_id FROM players WHERE team_id = ?").bind(id).all();
  let targets = rows.results
    .map((r) => ({ id: r.id, riot: J(r.riot_id, null) }))
    .filter((x) => x.riot && x.riot.name && x.riot.tag);
  if (b.only) targets = targets.filter((x) => x.id === b.only);
  if (!targets.length) return c.json({ done: 0, total: 0, fail: 0, err: "no Riot IDs on the roster" });

  let done = 0,
    fail = 0,
    err = "";
  for (const x of targets) {
    const region = x.riot.region || val.regionFor(t.server);
    try {
      const r = await val.fetchRank(x.riot, region, key);
      if (r) {
        await c.env.DB.prepare("UPDATE players SET rank = ?, rank_synced_at = ? WHERE id = ?")
          .bind(JSON.stringify(r), now(), x.id)
          .run();
        done++;
      } else {
        fail++;
        err = "unrated";
      }
    } catch (e) {
      fail++;
      err = e.message;
    }
    await new Promise((res) => setTimeout(res, 320));
  }
  return c.json({ done, total: targets.length, fail, err });
});

// ================================================================ tryouts
const tryoutRoles = (b) => {
  const r = Array.isArray(b.roles) ? b.roles.filter(Boolean) : b.role ? [b.role] : [];
  return { roles: JSON.stringify(r), role: r[0] || "Flex" };
};

app.post("/api/teams/:id/tryouts", team("igl"), async (c) => {
  const b = await readJson(c);
  const tid = nid(8);
  const { roles, role } = tryoutRoles(b);
  await c.env.DB.prepare(
    "INSERT INTO tryouts (id,team_id,date,handle,role,roles,tier,div,agents,scores,verdict,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(tid, c.req.param("id"), b.date, b.handle || "", role, roles, b.tier || "Immortal", +b.div || 1,
      JSON.stringify(b.agents || []), JSON.stringify(b.scores || {}), b.verdict || "Hold", b.notes || "")
    .run();
  return c.json({ id: tid });
});

app.put("/api/teams/:id/tryouts/:tid", team("igl"), async (c) => {
  const b = await readJson(c);
  const { id, tid } = c.req.param();
  const { roles, role } = tryoutRoles(b);
  await c.env.DB.prepare(
    "UPDATE tryouts SET date=?, handle=?, role=?, roles=?, tier=?, div=?, agents=?, scores=?, verdict=?, notes=? WHERE team_id=? AND id=?",
  )
    .bind(b.date, b.handle || "", role, roles, b.tier || "Immortal", +b.div || 1,
      JSON.stringify(b.agents || []), JSON.stringify(b.scores || {}), b.verdict || "Hold", b.notes || "", id, tid)
    .run();
  return c.json({ ok: true });
});

app.delete("/api/teams/:id/tryouts/:tid", team("igl"), async (c) => {
  const { id, tid } = c.req.param();
  await c.env.DB.prepare("DELETE FROM tryouts WHERE team_id=? AND id=?").bind(id, tid).run();
  return c.json({ ok: true });
});

// ================================================================ schedule
app.put("/api/teams/:id/schedule", team("igl"), async (c) => {
  const b = await readJson(c);
  const sch = {
    winStart: b.winStart || "11:00",
    winEnd: b.winEnd || "24:00",
    includeSubs: !!b.includeSubs,
    blocks: Array.isArray(b.blocks) ? b.blocks : [],
  };
  await c.env.DB.prepare("UPDATE teams SET schedule = ? WHERE id = ?").bind(JSON.stringify(sch), c.req.param("id")).run();
  return c.json({ ok: true });
});

app.put("/api/teams/:id/schedule/mine", team("player"), async (c) => {
  const b = await readJson(c);
  const id = c.req.param("id");
  const m = c.get("member");
  if (!m.player_id) return bad(c, "your account isn't linked to a roster player");
  const t = await c.env.DB.prepare("SELECT schedule FROM teams WHERE id = ?").bind(id).first();
  const sch = J(t.schedule, { blocks: [] });
  sch.blocks = (sch.blocks || [])
    .filter((x) => x.pid !== m.player_id)
    .concat((b.blocks || []).map((x) => ({ ...x, pid: m.player_id })));
  await c.env.DB.prepare("UPDATE teams SET schedule = ? WHERE id = ?").bind(JSON.stringify(sch), id).run();
  return c.json({ ok: true });
});

// ================================================================ activities
app.put("/api/teams/:id/activities/weeks/:wk", team("igl"), async (c) => {
  const b = await readJson(c);
  const { id, wk } = c.req.param();
  const data = b.data || {};

  // notify Discord for any newly-added items (compare item ids against the stored week)
  const prev = await c.env.DB.prepare("SELECT data FROM activities_weeks WHERE team_id = ? AND week_key = ?").bind(id, wk).first();
  const oldIds = new Set(Object.values(J(prev && prev.data, {})).flat().map((x) => x && x.id));
  const added = [];
  for (const [day, items] of Object.entries(data)) for (const it of items || []) if (it && it.id && !oldIds.has(it.id)) added.push({ day, ...it });

  await c.env.DB.prepare(
    "INSERT INTO activities_weeks (team_id,week_key,data) VALUES (?,?,?) ON CONFLICT(team_id,week_key) DO UPDATE SET data = excluded.data",
  )
    .bind(id, wk, JSON.stringify(data))
    .run();

  for (const it of added) {
    await notifyTeam(c, id, {
      embeds: [{ title: `📅 ${it.day} ${it.time || ""} · ${it.title}`.trim(), description: it.type || "", color: COLOR.accent }],
    });
  }
  return c.json({ ok: true });
});

app.put("/api/teams/:id/activities/months/:mk", team("igl"), async (c) => {
  const b = await readJson(c);
  await c.env.DB.prepare(
    "INSERT INTO activities_months (team_id,month_key,theme,goals) VALUES (?,?,?,?) ON CONFLICT(team_id,month_key) DO UPDATE SET theme = excluded.theme, goals = excluded.goals",
  )
    .bind(c.req.param("id"), c.req.param("mk"), b.theme || "", JSON.stringify(b.goals || []))
    .run();
  return c.json({ ok: true });
});

// ================================================================ scrim import (Overwolf)
// Authenticated by the team's ingest key (Authorization: Bearer sk_...), not a user session.
async function bearerTeam(c) {
  const h = c.req.header("authorization") || "";
  const key = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!key || !key.startsWith("sk_")) return null;
  return (await c.env.DB.prepare("SELECT * FROM teams WHERE ingest_key = ?").bind(key).first()) || null;
}
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
const AGENT_ALIAS = { kayo: "KAY/O", "kay/o": "KAY/O", "kay-o": "KAY/O" };
function normAgent(a) {
  if (!a) return "";
  const s = String(a).trim();
  return AGENT_ALIAS[s.toLowerCase()] || s.charAt(0).toUpperCase() + s.slice(1);
}
const normId = (r) => String(r || "").trim().toLowerCase();
const nameOf = (rid) => String(rid || "").split("#")[0].trim();
const importPrefix = (t) => (t.import_prefix || t.tag || "").trim();
const importMin = (t) => (t.import_min == null ? 3 : t.import_min);

app.get("/api/import/ping", async (c) => {
  const t = await bearerTeam(c);
  if (!t) return c.json({ error: "invalid ingest key" }, 401);
  return c.json({ ok: true, team: t.name, tag: t.tag, prefix: importPrefix(t), min: importMin(t) });
});

app.post("/api/import/match", async (c) => {
  const t = await bearerTeam(c);
  if (!t) return c.json({ error: "invalid ingest key" }, 401);
  const b = await readJson(c);

  const matchId = (b.matchId || b.match_id || "").toString().trim();
  if (!matchId) return c.json({ error: "matchId is required (needed to prevent duplicate imports)" }, 400);

  const dup = await c.env.DB.prepare("SELECT id FROM scrims WHERE team_id = ? AND match_id = ?").bind(t.id, matchId).first();
  if (dup) return c.json({ imported: false, reason: "already imported", scrimId: dup.id });

  const sideA = Array.isArray(b.us) ? b.us : [];
  const sideB = Array.isArray(b.them) ? b.them : [];
  if (!sideA.length) return c.json({ error: "no players in `us`" }, 400);
  if (!b.map) return c.json({ error: "map is required" }, 400);

  // roster Riot IDs
  const roster = await c.env.DB.prepare("SELECT id, riot_id FROM players WHERE team_id = ?").bind(t.id).all();
  const byRiot = {};
  for (const p of roster.results) {
    const ri = J(p.riot_id, null);
    if (ri && ri.name && ri.tag) byRiot[normId(`${ri.name}#${ri.tag}`)] = p.id;
  }

  // "is this one of ours?" — roster-matched, or the in-game name carries our prefix
  const prefix = importPrefix(t);
  const min = importMin(t);
  const preRe = prefix ? new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s._-]?", "i") : null;
  const isOurs = (e) => {
    const rid = e.riotId || e.riot_id || e.name || "";
    if (byRiot[normId(rid)]) return true;
    return preRe ? preRe.test(nameOf(rid)) : false;
  };
  const aX = sideA.filter(isOurs).length;
  const bX = sideB.filter(isOurs).length;

  // not a scrim unless one team has >= min of our players
  if (aX < min && bX < min) {
    return c.json({
      imported: false,
      reason: `not a scrim — need ${min}+ "${prefix}" players on one team (found ${Math.max(aX, bX)})`,
    });
  }

  // pick our side; swap (and flip score) if Overwolf labelled the enemy team as ours
  let ours = sideA, theirs = sideB, swapped = false;
  if (aX < min && bX >= min) { ours = sideB; theirs = sideA; swapped = true; }

  const unmatched = [];
  const lineup = ours.map((e) => {
    const rid = e.riotId || e.riot_id || e.name || "";
    const pid = byRiot[normId(rid)] || null;
    if (!pid && rid) unmatched.push(rid);
    return {
      pid,
      name: pid ? undefined : rid || undefined,
      agent: normAgent(e.agent),
      k: clampInt(e.k, 0, 200),
      d: clampInt(e.d, 0, 200),
      a: clampInt(e.a, 0, 200),
      adr: e.adr == null ? null : clampInt(e.adr, 0, 400),
      kast: e.kast == null ? null : clampInt(e.kast, 0, 100),
      present: true,
    };
  });
  const enemy = theirs.map((e) => ({
    name: e.riotId || e.riot_id || e.name || "",
    agent: normAgent(e.agent),
    k: clampInt(e.k, 0, 200),
    d: clampInt(e.d, 0, 200),
    a: clampInt(e.a, 0, 200),
    adr: e.adr == null ? null : clampInt(e.adr, 0, 400),
  }));

  const rounds = b.rounds || {};
  let rw = clampInt(rounds.won ?? rounds.rw, 0, 40);
  let rl = clampInt(rounds.lost ?? rounds.rl, 0, 40);
  if (swapped) [rw, rl] = [rl, rw];
  const date = b.startedAt ? new Date(Number(b.startedAt)).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const opp = (b.opponentName || "").toString().trim() || "Imported scrim";
  const sid = nid(8);

  try {
    await c.env.DB.prepare(
      "INSERT INTO scrims (id,team_id,date,opp,map,rw,rl,lineup,enemy,match_id,source,imported_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(sid, t.id, date, opp, String(b.map), rw, rl, JSON.stringify(lineup), JSON.stringify(enemy), matchId, "overwolf", now(), now())
      .run();
  } catch (e) {
    // several teammates run the agent -> concurrent imports of the same match id.
    // the unique index (team_id, match_id) rejects the loser; treat it as a no-op.
    if (/UNIQUE|constraint/i.test(String(e && e.message))) {
      const existing = await c.env.DB.prepare("SELECT id FROM scrims WHERE team_id = ? AND match_id = ?").bind(t.id, matchId).first();
      return c.json({ imported: false, reason: "already imported", scrimId: existing ? existing.id : null });
    }
    throw e;
  }

  const matched = lineup.length - unmatched.length;
  await notifyTeam(c, t, {
    embeds: [{
      title: `⚔️ Scrim imported · ${String(b.map)} vs ${opp}`,
      description: `**${rw}–${rl}** ${rw > rl ? "win" : rw < rl ? "loss" : "draw"} · ${matched} player${matched === 1 ? "" : "s"} matched`,
      color: rw > rl ? COLOR.good : rw < rl ? COLOR.bad : COLOR.grey,
    }],
  });
  return c.json({ imported: true, scrimId: sid, matched, unmatched, swapped });
});

app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

// ---------------------------------------------------------------- entry
export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return app.fetch(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
};
