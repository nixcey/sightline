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
