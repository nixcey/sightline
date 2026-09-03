# Sightline Scrim Importer (Overwolf) — SHELVED

> **Not the recommended path.** Overwolf apps that target Valorant require Riot
> Games approval to distribute, and dev-loading an unpacked app isn't a real
> distribution route. Use **`agent/`** instead — a standalone Node script that
> reads Valorant's local client API, no Overwolf and no Riot review. This folder
> is kept only as a reference for the GEP scoreboard-parsing logic
> (`valorant.js`) in case Overwolf approval ever happens.

Desktop companion that watches Valorant and, when a **custom game** finishes,
sends the full scoreboard to Sightline as a scrim — no manual entry.

- Run it on **one** machine only (usually the IGL's). Overwolf reads the whole
  match's scoreboard, so one instance captures every player.
- Every match carries a unique `pseudo_match_id`. Sightline rejects a second
  import of the same id, so **a match can never be imported twice** — safe to run
  it on more than one PC if you want redundancy.
- **Not every custom is a scrim.** Only customs with at least *N* players whose
  in-game name starts with your prefix (e.g. `XPE`) on one team are imported. Set
  *N* and the prefix in Sightline → Scrims → Scrim importer; the app pulls them
  on connect. If Overwolf mislabels which team is yours, Sightline swaps sides
  and flips the score automatically.
- Players are matched to your roster by **Riot ID** (`Name#TAG`) — set each roster
  player's Riot ID to their *full* in-game name **including the prefix**
  (`XPE nix#EUW`). Anyone unmatched imports as an "unlinked" row you attach later
  by editing the scrim.

## Install (development / unpacked)

1. Install [Overwolf](https://www.overwolf.com/).
2. Overwolf **Settings → About → Development Options → Load unpacked extension**.
3. Select this `overwolf/` folder. The app appears in the Overwolf dock.
4. Open it, fill in:
   - **Sightline URL** — e.g. `https://sightline.nixcey.com`
   - **Ingest key** — Sightline → **Scrims → Scrim importer → Generate ingest key**
     (managers only; copy it, it's shown once)
5. Click **Test connection** — it should say `connected · <team name>`.
6. Leave **Auto-import** on. That's it — play a custom game, it imports when the
   match ends.

To package for distribution: Overwolf dev options → **Package unpacked extension**
→ produces an `.opk` you can share or submit to the Overwolf store.

## Using it

- **Auto-import matches as they finish** — on by default.
- **Import modes** — Custom games only by default. Tick Unrated / Competitive if
  you also want those.
- **Opponent name for the next imported match** — optional; Valorant custom lobbies
  have no team names, so imports are labelled "Imported scrim" unless you set this.
  It's applied once, then cleared. (You can also just rename the opponent in
  Sightline afterwards.)
- **Re-scan last match** — re-sends the last captured match (e.g. if the scoreboard
  wasn't ready the first time, or you set an opponent name late).
- **Activity** log shows every import / skip / retry. Failed sends are queued and
  retried every 60 s and on next launch.

## How it works

```
Valorant  ──GEP──▶  background.js  ──normalize (valorant.js)──▶  POST /api/import/match
                                                                  Authorization: Bearer sk_…
```

`background.js` registers Valorant Game Events (game id `21640`), accumulates the
live info snapshot, and on `match_end` (with a menu-transition fallback) calls
`overwolf.games.events.getInfo()` and hands it to `valorant.js`, which builds:

```json
{
  "matchId": "…", "map": "Ascent", "mode": "custom", "startedAt": 0,
  "opponentName": "optional",
  "rounds": { "won": 13, "lost": 7 },
  "us":   [ { "riotId": "nix#EUW", "agent": "Cypher", "k": 16, "d": 12, "a": 9, "adr": 150, "kast": 72 } ],
  "them": [ { "riotId": "Foo#BAR", "agent": "Jett", "k": 20, "d": 14, "a": 4, "adr": 190 } ]
}
```

The server maps `us` to roster players, stores it as a scrim with
`source: "overwolf"`, and de-dupes on `(team, matchId)`.

Overwolf's GEP field names for Valorant have shifted between versions. If a game
patch breaks parsing, the fix is in **`valorant.js`** only (the server contract
doesn't change) — edit it and reload the unpacked app. The last raw snapshot is
kept in `localStorage` under `sl_lastraw` for inspection; **Re-scan last match**
re-runs the parser on it.

## Files

| file | role |
|---|---|
| `manifest.json` | Overwolf app manifest (targets Valorant, background + desktop windows) |
| `background.js` | GEP capture, normalize, send, retry queue |
| `valorant.js` | GEP snapshot → normalized payload (all the parsing) |
| `desktop.html/.css/.js` | settings + status window |
| `store.js` | config + log + queue, in `localStorage` (shared across windows) |
| `icons/` | dock icons |

## Manual test (no Valorant needed)

```bash
KEY=sk_...              # from Sightline → Scrims → Scrim importer
curl -s -H "Authorization: Bearer $KEY" https://sightline.nixcey.com/api/import/ping
curl -s -X POST -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  https://sightline.nixcey.com/api/import/match -d '{
    "matchId":"TEST-1","map":"Ascent","mode":"custom","rounds":{"won":13,"lost":7},
    "us":[{"riotId":"nix#EUW","agent":"Cypher","k":16,"d":12,"a":9}]
  }'
# run it twice — the second returns {"imported":false,"reason":"already imported"}
```
