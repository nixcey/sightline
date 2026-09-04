// Server-side rank lookup via the HenrikDev Valorant API.
// tracker.gg / Riot's own API can't be used (no CORS from the edge either way,
// and Riot has no public "current rank by Riot ID" endpoint). The key lives in
// the team row, never reaches the browser.

const TIERS = ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ascendant", "Immortal", "Radiant"];

export function regionFor(server) {
  return { EU: "eu", NA: "na", APAC: "ap", BR: "br", LATAM: "latam", KR: "kr" }[server] || "eu";
}

// "Immortal 1" / "Radiant" / "Unrated" (+ RR) -> {tier,div,rr} | null
export function parseRankName(s, rr) {
  if (!s || /unrated|unranked/i.test(s)) return null;
  if (/radiant/i.test(s)) return { tier: "Radiant", div: 1, rr: rr || 0 };
  const m = String(s).match(/([A-Za-z]+)\s*([123])/);
  if (!m) return null;
  const tier = TIERS.find((t) => t.toLowerCase() === m[1].toLowerCase());
  return tier ? { tier, div: +m[2], rr: rr || 0 } : null;
}

// GET against HenrikDev with automatic retries on 429 (their Basic key is only
// 30 req/min, and a full team sync bursts past that). Honours Retry-After, but
// never waits more than a minute for one attempt — a full sync stays bounded.
async function hdFetch(url, key, tries = 3) {
  for (let i = 0; ; i++) {
    let res;
    try {
      res = await fetch(url, { headers: key ? { Authorization: key } : {} });
    } catch {
      throw new Error("could not reach rank API");
    }
    if (res.status === 429 && i < tries - 1) {
      const ra = Number(res.headers.get("retry-after")) || Number(res.headers.get("x-ratelimit-reset")) || 5;
      await new Promise((r) => setTimeout(r, Math.min(Math.max(ra, 1), 60) * 1000));
      continue;
    }
    if (res.status === 404) throw new Error("Riot ID not found (renamed? wrong region?)");
    if (res.status === 401 || res.status === 403) throw new Error("API key missing or invalid");
    if (res.status === 429) throw new Error("rate limited by the rank API — try again in a minute");
    if (!res.ok) throw new Error("rank API HTTP " + res.status);
    return res;
  }
}

// One game's elo can't move more than ~50 (placements a bit more). An isolated
// point that sits far below/above BOTH neighbours — which agree with each other —
// is a HenrikDev glitch row (happens around act rollovers / derank protection).
// Drop those, plus anything below Iron 1 or with a non-positive elo.
export function despikeHistory(entries) {
  const sorted = entries.slice().sort((a, b) => (a.playedAt < b.playedAt ? -1 : a.playedAt > b.playedAt ? 1 : 0));
  const valid = sorted.filter((e) => e.tierId >= 3 && e.elo > 0);
  let dropped = sorted.length - valid.length;
  if (valid.length < 4) return { entries: valid, dropped };
  const keep = [];
  for (let i = 0; i < valid.length; i++) {
    const cur = valid[i].elo;
    const prev = keep.length ? keep[keep.length - 1].elo : null;
    const next = valid[i + 1] ? valid[i + 1].elo : null;
    const spike =
      prev != null && next != null &&
      Math.abs(prev - next) <= 120 &&
      Math.min(Math.abs(cur - prev), Math.abs(cur - next)) > 150;
    const headOutlier =
      i === 0 && valid[1] && valid[2] &&
      Math.abs(valid[1].elo - valid[2].elo) <= 120 && Math.abs(cur - valid[1].elo) > 200;
    if (spike || headOutlier) { dropped++; continue; }
    keep.push(valid[i]);
  }
  return { entries: keep, dropped };
}

// One HenrikDev history row (stored or live shape) -> our shape, or null if it
// has no match id. Field names differ a little between the two endpoints
// (rr/ranking_in_tier, last_change/mmr_change_to_last_game) — cover both.
function normHistoryRow(e) {
  const mid = e && e.match_id;
  if (!mid) return null;
  const tierId = (e.tier && e.tier.id) ?? e.currenttier ?? 0;
  const rr = e.rr ?? e.ranking_in_tier ?? 0;
  return {
    matchId: mid,
    playedAt: e.date || e.date_raw || "",
    tierId,
    tierName: (e.tier && e.tier.name) || e.currenttierpatched || "",
    rr,
    lastChange: e.last_change ?? e.mmr_change_to_last_game ?? 0,
    elo: e.elo ?? (tierId >= 3 ? (tierId - 3) * 100 + rr : 0),
    map: (e.map && e.map.name) || "",
    season: (e.season && e.season.short) || "",
  };
}
function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const e of rows) {
    if (!e || seen.has(e.matchId)) continue;
    seen.add(e.matchId);
    out.push(e);
  }
  return out;
}

// Per-match competitive history. HenrikDev's stored-mmr-history is their own
// backfilled log — it only has games for an account once something has asked
// HenrikDev about it before, so it can be empty for a fresh Riot ID even though
// the account has plenty of ranked games. When that comes back empty, fall back
// to the live (non-stored) mmr-history pull, which hits Riot directly and
// always has the last ~20 ranked games with no backfill delay.
export async function fetchMmrHistory({ name, tag }, region, key, { size = 100 } = {}) {
  const enc = `${encodeURIComponent(name)}/${encodeURIComponent(tag)}`;
  const storedUrl = `https://api.henrikdev.xyz/valorant/v2/stored-mmr-history/${region}/pc/${enc}?size=${size}`;
  const res = await hdFetch(storedUrl, key);
  const j = await res.json().catch(() => null);
  const storedRows = (j && j.data) || [];
  let raw = dedupeRows(storedRows.map(normHistoryRow));
  let total = (j && j.results && j.results.total) || raw.length;
  let source = "stored";

  if (!raw.length) {
    const liveUrl = `https://api.henrikdev.xyz/valorant/v2/mmr-history/${region}/pc/${enc}`;
    const lres = await hdFetch(liveUrl, key);
    const lj = await lres.json().catch(() => null);
    const liveRows = Array.isArray(lj && lj.data) ? lj.data : Array.isArray(lj && lj.data && lj.data.history) ? lj.data.history : [];
    raw = dedupeRows(liveRows.map(normHistoryRow));
    total = raw.length;
    source = "live";
  }

  const clean = despikeHistory(raw);
  return { total, entries: clean.entries, dropped: clean.dropped, source };
}

export async function fetchRank({ name, tag }, region, key) {
  const url = `https://api.henrikdev.xyz/valorant/v3/mmr/${region}/pc/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`;
  const res = await hdFetch(url, key);
  const j = await res.json().catch(() => null);
  const cur = (j && j.data && (j.data.current || j.data.current_data)) || {};
  const tierName = (cur.tier && cur.tier.name) || cur.currenttierpatched;
  const rr = (cur.rr != null ? cur.rr : cur.ranking_in_tier) || 0;
  return parseRankName(tierName, rr);
}
