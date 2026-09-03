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

// Per-match competitive history from HenrikDev's stored-mmr-history.
// Only contains games played *after* the account was first queried through their
// API, so it can be empty/short for accounts they've never seen.
export async function fetchMmrHistory({ name, tag }, region, key, { pages = 8, size = 100 } = {}) {
  const base = `https://api.henrikdev.xyz/valorant/v2/stored-mmr-history/${region}/pc/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`;
  const seen = new Set();
  const out = [];
  let total = 0;
  for (let page = 1; page <= pages; page++) {
    let res;
    try {
      res = await fetch(`${base}?size=${size}&page=${page}`, { headers: key ? { Authorization: key } : {} });
    } catch {
      throw new Error("could not reach rank API");
    }
    if (res.status === 404) throw new Error("Riot ID not found");
    if (res.status === 401 || res.status === 403) throw new Error("API key missing or invalid");
    if (res.status === 429) throw new Error("rate limited by rank API");
    if (!res.ok) throw new Error("rank API HTTP " + res.status);
    const j = await res.json().catch(() => null);
    const rows = (j && j.data) || [];
    total = (j && j.results && j.results.total) || total;
    let fresh = 0;
    for (const e of rows) {
      const mid = e.match_id;
      if (!mid || seen.has(mid)) continue;
      seen.add(mid);
      fresh++;
      const tierId = (e.tier && e.tier.id) || 0;
      out.push({
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
    if (fresh === 0 || out.length >= total || rows.length < size) break;
  }
  return { total: total || out.length, entries: out };
}

export async function fetchRank({ name, tag }, region, key) {
  const url = `https://api.henrikdev.xyz/valorant/v3/mmr/${region}/pc/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`;
  let res;
  try {
    res = await fetch(url, { headers: key ? { Authorization: key } : {} });
  } catch {
    throw new Error("could not reach rank API");
  }
  if (res.status === 404) throw new Error("Riot ID not found");
  if (res.status === 401 || res.status === 403) throw new Error("API key missing or invalid");
  if (res.status === 429) throw new Error("rate limited by rank API");
  if (!res.ok) throw new Error("rank API HTTP " + res.status);
  const j = await res.json().catch(() => null);
  const cur = (j && j.data && (j.data.current || j.data.current_data)) || {};
  const tierName = (cur.tier && cur.tier.name) || cur.currenttierpatched;
  const rr = (cur.rr != null ? cur.rr : cur.ranking_in_tier) || 0;
  return parseRankName(tierName, rr);
}
