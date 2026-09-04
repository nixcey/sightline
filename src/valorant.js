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

// GET against HenrikDev with one automatic retry on 429 (their Basic key is only
// 30 req/min, and a full team sync bursts past that). Honours Retry-After.
async function hdFetch(url, key, tries = 3) {
  for (let i = 0; ; i++) {
    let res;
    try {
      res = await fetch(url, { headers: key ? { Authorization: key } : {} });
    } catch {
      throw new Error("could not reach rank API");
    }
    if (res.status === 429 && i < tries - 1) {
      const ra = Number(res.headers.get("retry-after")) || Number(res.headers.get("x-ratelimit-reset")) || 3;
      await new Promise((r) => setTimeout(r, Math.min(Math.max(ra, 1), 12) * 1000));
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

// Per-match competitive history from HenrikDev's stored-mmr-history.
// Only contains games played *after* the account was first queried through their
// API, so it can be empty/short for accounts they've never seen. The v2 endpoint
// takes only `size` (cursor pagination, not page numbers), so one call is enough.
export async function fetchMmrHistory({ name, tag }, region, key, { size = 100 } = {}) {
  const url = `https://api.henrikdev.xyz/valorant/v2/stored-mmr-history/${region}/pc/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?size=${size}`;
  const res = await hdFetch(url, key);
  const j = await res.json().catch(() => null);
  const rows = (j && j.data) || [];
  const total = (j && j.results && j.results.total) || rows.length;
  const seen = new Set();
  const raw = [];
  for (const e of rows) {
    const mid = e.match_id;
    if (!mid || seen.has(mid)) continue;
    seen.add(mid);
    const tierId = (e.tier && e.tier.id) || 0;
    raw.push({
      matchId: mid,
      playedAt: e.date || e.date_raw || "",
      tierId,
      tierName: (e.tier && e.tier.name) || "",
      rr: e.rr ?? e.ranking_in_tier ?? 0,
      lastChange: e.last_change ?? e.mmr_change_to_last_game ?? 0,
      elo: e.elo ?? (tierId >= 3 ? (tierId - 3) * 100 + (e.rr ?? 0) : 0),
      map: (e.map && e.map.name) || "",
      season: (e.season && e.season.short) || "",
    });
  }
  const clean = despikeHistory(raw);
  return { total, entries: clean.entries, dropped: clean.dropped };
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
