// Inserts a sample roster + scrims + snapshots + tryouts + schedule + activities
// into an (empty) team, so a new team is immediately explorable.
import { uid } from "./auth.js";

const estADR = (kpr) => Math.round(Math.max(45, Math.min(260, 40 + kpr * 145)));
const estKAST = (kpr, dpr) => Math.round(Math.max(35, Math.min(95, 100 * (0.55 + kpr * 0.32 - dpr * 0.24))));

export async function seedTeam(db, teamId) {
  const now = Date.now();
  const R = (tier, div, rr) => ({ tier, div, rr });
  const roster = [
    ["nix", "Ravi Okafor", "IGL", "Killjoy,Cypher,Chamber", "Starter", "🧭", "2025-11-02", R("Immortal", 1, 55), { name: "nix", tag: "EUW", region: "" }],
    ["Sable", "Lea Novak", "Duelist", "Jett,Raze,Neon", "Starter", "🗡️", "2025-11-02", R("Immortal", 2, 25), { name: "Sable", tag: "EUW", region: "" }],
    ["Koda", "Marc Delgado", "Controller", "Omen,Brimstone,Astra", "Starter", "🌫️", "2025-12-10", R("Immortal", 1, 8), { name: "Koda", tag: "EU1", region: "" }],
    ["Riven", "Amara Sy", "Initiator", "Sova,Fade,Gekko", "Starter", "📡", "2025-11-20", R("Immortal", 1, 68), { name: "Riven", tag: "EUW", region: "" }],
    ["Tython", "Jonas Pell", "Flex", "Chamber,KAY/O,Skye", "Starter", "♻️", "2026-01-15", R("Ascendant", 3, 78), { name: "Tython", tag: "EU2", region: "" }],
    ["Mireu", "Sun-woo Park", "Duelist", "Reyna,Phoenix,Jett", "Sub", "🔁", "2026-02-01", R("Immortal", 1, 5), { name: "Mireu", tag: "KR1", region: "kr" }],
  ];
  const pid = {};
  const stmts = [];
  roster.forEach(([handle, name, role, agents, status, icon, joined, rank, riot], i) => {
    const id = uid(8);
    pid[handle] = id;
    stmts.push(
      db
        .prepare(
          `INSERT INTO players (id,team_id,handle,name,role,roles,status,icon,joined,agents,rank,riot_id,note,sort)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(id, teamId, handle, name, role, JSON.stringify([role]), status, icon, joined, JSON.stringify(agents.split(",")), JSON.stringify(rank), JSON.stringify(riot), "", i),
    );
  });

  const S = (date, opp, map, rw, rl, lineup) => {
    const rounds = rw + rl;
    const id = uid(8);
    const rows = lineup.map(([h, agent, k, d, a]) => {
      const kpr = k / rounds,
        dpr = d / rounds;
      return { pid: pid[h], agent, k, d, a, adr: estADR(kpr), kast: estKAST(kpr, dpr), present: true };
    });
    stmts.push(
      db
        .prepare("INSERT INTO scrims (id,team_id,date,opp,map,rw,rl,lineup,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(id, teamId, date, opp, map, rw, rl, JSON.stringify(rows), now),
    );
  };
  S("2026-07-28", "Onyx", "Ascent", 13, 9, [["nix", "Killjoy", 14, 13, 9], ["Sable", "Jett", 22, 15, 4], ["Koda", "Omen", 16, 14, 7], ["Riven", "Sova", 13, 12, 11], ["Tython", "KAY/O", 15, 13, 8]]);
  S("2026-07-31", "DustWolves", "Lotus", 11, 13, [["nix", "Cypher", 12, 16, 7], ["Sable", "Raze", 19, 17, 5], ["Koda", "Astra", 11, 17, 9], ["Riven", "Fade", 14, 15, 8], ["Tython", "Skye", 13, 16, 10]]);
  S("2026-08-05", "Meridian", "Sunset", 13, 7, [["nix", "Chamber", 17, 10, 6], ["Sable", "Jett", 24, 11, 3], ["Koda", "Omen", 15, 10, 9], ["Riven", "Sova", 14, 9, 12], ["Tython", "KAY/O", 16, 11, 7]]);
  S("2026-08-09", "Kestrel", "Bind", 13, 11, [["nix", "Cypher", 15, 14, 8], ["Sable", "Raze", 21, 16, 5], ["Koda", "Brimstone", 12, 15, 10], ["Riven", "Gekko", 16, 13, 9], ["Tython", "Skye", 14, 14, 9]]);
  S("2026-08-14", "Onyx", "Haven", 8, 13, [["nix", "Killjoy", 11, 17, 6], ["Sable", "Jett", 18, 18, 3], ["Koda", "Omen", 9, 18, 7], ["Riven", "Fade", 12, 16, 8], ["Tython", "KAY/O", 13, 17, 6]]);
  S("2026-08-19", "Vantage", "Ascent", 13, 10, [["nix", "Killjoy", 16, 13, 10], ["Sable", "Neon", 23, 14, 4], ["Koda", "Omen", 13, 14, 8], ["Riven", "Sova", 15, 12, 13], ["Tython", "Chamber", 17, 12, 6]]);
  S("2026-08-25", "Meridian", "Lotus", 13, 6, [["nix", "Cypher", 18, 8, 7], ["Sable", "Raze", 22, 9, 6], ["Koda", "Astra", 14, 9, 11], ["Riven", "Fade", 16, 8, 12], ["Tython", "Skye", 15, 10, 9]]);
  S("2026-08-29", "Kestrel", "Sunset", 10, 13, [["nix", "Chamber", 13, 16, 5], ["Sable", "Jett", 20, 17, 3], ["Koda", "Omen", 8, 17, 6], ["Riven", "Sova", 13, 15, 9], ["Tython", "KAY/O", 12, 16, 7]]);
  S("2026-09-02", "Vantage", "Split", 13, 9, [["nix", "Cypher", 16, 12, 9], ["Sable", "Raze", 21, 13, 5], ["Koda", "Brimstone", 10, 15, 9], ["Riven", "Fade", 17, 11, 11], ["Tython", "KAY/O", 16, 12, 8]]);

  /* Per-match ranked history for the Rank Tracking tab. Walks each player from
     a start rank to an end rank over N games in realistic ±RR steps, so the
     demo team has a trajectory to chart. Mirrors what a HenrikDev sync writes:
     elo is absolute ((tier_id-3)*100 + rr) and tier/rr derive back out of it. */
  const RANK_TIERS = ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ascendant", "Immortal", "Radiant"];
  const eloOf = (r) => (RANK_TIERS.indexOf(r.tier) * 3 + ((r.div || 1) - 1)) * 100 + (r.rr || 0);
  const HIST_MAPS = ["Ascent", "Bind", "Haven", "Lotus", "Split", "Sunset", "Icebox", "Breeze"];
  const CHOP = [18, -15, 22, -12, 16, -20, 24, -14]; // deterministic, so a reseed looks the same
  const HIST_T0 = Date.parse("2026-07-06T18:00:00Z");
  const HIST_T1 = Date.parse("2026-09-02T22:00:00Z");
  const rankHistory = (handle, from, to, games) => {
    const a = eloOf(from), b = eloOf(to);
    let elo = a;
    for (let i = 1; i <= games; i++) {
      const target = a + ((b - a) * i) / games;
      let change = Math.round(target + CHOP[i % CHOP.length] * 0.6) - elo;
      if (!change) change = CHOP[i % CHOP.length] > 0 ? 17 : -16;
      elo = Math.max(1800, elo + change);
      const units = Math.floor(elo / 100);
      stmts.push(
        db
          .prepare(
            "INSERT INTO rank_history (team_id,player_id,match_id,played_at,tier_id,tier_name,rr,last_change,elo,map,season,synced_at) " +
              "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            teamId, pid[handle], `demo-${handle}-${i}`,
            new Date(HIST_T0 + ((HIST_T1 - HIST_T0) * i) / games).toISOString(),
            units + 3,
            `${RANK_TIERS[Math.floor(units / 3)]} ${(units % 3) + 1}`,
            elo % 100, change, elo,
            HIST_MAPS[i % HIST_MAPS.length], "e11a3", Date.now(),
          ),
      );
    }
  };
  rankHistory("nix", R("Ascendant", 3, 35), R("Immortal", 1, 55), 26);
  rankHistory("Sable", R("Immortal", 1, 5), R("Immortal", 2, 25), 24);
  rankHistory("Koda", R("Ascendant", 3, 50), R("Immortal", 1, 8), 22);
  rankHistory("Riven", R("Ascendant", 3, 60), R("Immortal", 1, 68), 25);
  rankHistory("Tython", R("Ascendant", 2, 55), R("Ascendant", 3, 78), 20);
  rankHistory("Mireu", R("Ascendant", 3, 15), R("Immortal", 1, 5), 18);

  const T = (handle, role, tier, div, agents, mech, util, comms, att, verdict, notes) => {
    stmts.push(
      db
        .prepare("INSERT INTO tryouts (id,team_id,date,handle,role,tier,div,agents,scores,verdict,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .bind(uid(8), teamId, "2026-08-20", handle, role, tier, div, JSON.stringify(agents.split(",")), JSON.stringify({ mech, util, comms, att }), verdict, notes),
    );
  };
  T("Ares", "Duelist", "Immortal", 2, "Jett,Raze", 9, 6, 6, 7, "Shortlist", "Elite aim, wide peeks. Tilts after a lost round, comms drop off. Coachable ego.");
  T("Nova", "Controller", "Immortal", 1, "Omen,Astra,Harbor", 6, 9, 9, 9, "Shortlist", "Smoke timings are pro-level, positive energy, great VOD notes. Slightly passive in retakes.");
  T("Kestrel", "Sentinel", "Ascendant", 3, "Killjoy,Cypher", 6, 7, 6, 5, "Pass", "Reliable anchor but low mechanical ceiling and pushed back on feedback twice.");
  T("Juno", "Initiator", "Immortal", 2, "Sova,Fade,Gekko", 8, 8, 7, 8, "Hold", "Fast recon reads, flexes roles well. Uni schedule conflicts Tue/Thu evenings.");
  T("Rell", "Flex", "Immortal", 3, "Omen,KAY/O,Chamber,Killjoy", 8, 8, 8, 9, "Shortlist", "Best all-round tryout so far. Wants shot-calling reps.");

  const blk = (h, day, start, end, label) => ({ id: uid(6), pid: pid[h], day, start, end, label });
  const schedule = {
    winStart: "11:00",
    winEnd: "24:00",
    includeSubs: false,
    blocks: [
      blk("nix", 0, "13:00", "15:00", "Lecture"), blk("nix", 2, "13:00", "15:00", "Lecture"), blk("nix", 3, "18:00", "19:30", "Gym"),
      blk("Sable", 1, "09:00", "12:00", "Class"), blk("Sable", 3, "09:00", "12:00", "Class"), blk("Sable", 4, "16:00", "18:00", "Work"),
      blk("Koda", 0, "17:00", "20:00", "Work shift"), blk("Koda", 2, "17:00", "20:00", "Work shift"), blk("Koda", 5, "12:00", "16:00", "Work shift"),
      blk("Riven", 1, "14:00", "17:00", "Lab"), blk("Riven", 4, "14:00", "16:00", "Seminar"),
      blk("Tython", 0, "09:00", "11:00", "Class"), blk("Tython", 2, "09:00", "11:00", "Class"), blk("Tython", 4, "09:00", "11:00", "Class"), blk("Tython", 3, "20:00", "21:30", "Family"),
    ],
  };

  const wk = { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [] };
  const it = (t, title, type) => ({ id: uid(6), time: t, title, type });
  wk.Mon = [it("19:00", "VOD review — Kestrel losses", "Review"), it("20:30", "Scrim vs Vantage (BO2)", "Scrim")];
  wk.Tue = [it("19:00", "Individual role practice", "Practice")];
  wk.Wed = [it("20:00", "Scrim vs Onyx (BO2)", "Scrim")];
  wk.Thu = [it("19:00", "Comp theory — Split defense", "Theory")];
  wk.Fri = [it("20:00", "Scrim vs Meridian (BO3)", "Scrim")];
  wk.Sat = [it("15:00", "Watch party — Champions groups", "Team")];
  wk.Sun = [it("18:00", "Week debrief + set next targets", "Review")];

  stmts.push(db.prepare("UPDATE teams SET schedule = ?, tournament_weeks = ? WHERE id = ?").bind(JSON.stringify(schedule), JSON.stringify(["2026-08-31"]), teamId));
  stmts.push(db.prepare("INSERT INTO activities_weeks (team_id,week_key,data) VALUES (?,?,?)").bind(teamId, "2026-09-01", JSON.stringify(wk)));
  stmts.push(
    db.prepare("INSERT INTO activities_months (team_id,month_key,theme,goals) VALUES (?,?,?,?)").bind(
      teamId, "2026-09", "Qualifier prep — lock Ascent + Split, fix Haven",
      JSON.stringify([
        { text: "3 scrim blocks/week, 2 map pool focus", done: false },
        { text: "Haven win rate above 45% in scrims", done: false },
        { text: "Sign one flex/initiator sub from tryouts", done: false },
        { text: "Reach Immortal 2 team rank", done: false },
      ]),
    ),
  );
  stmts.push(
    db.prepare("INSERT INTO activities_months (team_id,month_key,theme,goals) VALUES (?,?,?,?)").bind(
      teamId, "2026-10", "Open Qualifier — peak and stabilize rotations",
      JSON.stringify([
        { text: "Reduce mid-round deaths (deaths in first 15s)", done: false },
        { text: "Full 7-map pool tournament-ready", done: false },
      ]),
    ),
  );

  await db.batch(stmts);
}
