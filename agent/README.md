# Sightline scrim agent

Reads Valorant's **local client API** and imports finished **custom games** into
Sightline. One instance is enough — the local API exposes the whole match, so
whoever runs it captures every player. **Several teammates can run it at once**
too: Sightline de-dupes on the match id, so concurrent imports of the same game
collapse to one scrim (the extras get `{imported:false, reason:"already
imported"}`). No Overwolf, no Riot developer approval, no npm dependencies.

Two ways to run it:
- **Standalone** — this folder + `config.json`, `node sightline-agent.mjs`.
- **Sightline desktop app** (`../desktop/`) — Windows only; a Start/Stop toggle
  and live log inside the app, no Node install. See `../desktop/README.md`.

## What it does

1. Reads `%LOCALAPPDATA%\Riot Games\Riot Client\Config\lockfile` for the local
   API port + password (only exists while Valorant is running).
2. `GET https://127.0.0.1:<port>/entitlements/v1/token` → your access token,
   entitlement token and puuid. **It never asks for your Riot password.**
3. Region + client version come from `ShooterGame.log` (fallback:
   valorant-api.com, which also supplies map/agent names — so a game patch
   doesn't need a code change here).
4. Polls `core-game/v1/players/<puuid>` for the live match id. When the match
   ends it fetches `match-details/v1/matches/<id>`. Custom games often come back
   with blank `gameName`/`tagLine`, so it resolves any missing names by puuid via
   `PUT name-service/v2/players`, normalises, and `POST`s to
   `<sightlineUrl>/api/import/match` with your ingest key.

Sightline de-dupes on the match id (a match can't import twice) and only keeps
customs with `N`+ prefix-tagged players on one team — set both on the website
(**Scrims → Scrim importer**). The agent applies the same filter locally so it
doesn't spam the server with pistol-round 1v1s.

## Is this allowed?

These endpoints are unofficial and read-only. Riot has, for years, publicly
tolerated read-only tools that give no in-game advantage and don't automate
anything — this is the tamest possible case (your own finished match, low poll
rate, no overlay). It is **not** a formal guarantee; there's no documented ban
for this class of tool, but you run it on your own accounts at your own call.
It is *not* detected by Vanguard (no memory reading, no injection).

## Setup (Windows)

1. Install **Node.js 20+** (https://nodejs.org — the LTS installer).
2. Copy this `agent\` folder anywhere on the machine that runs during scrims.
3. On the website: **Scrims → Scrim importer → Generate ingest key**, copy it.
   Check the prefix (`XPE`) and min players (`3`).
4. Copy `config.example.json` → `config.json` and fill it in:
   ```json
   {
     "sightlineUrl": "https://sightline.nixcey.com",
     "ingestKey": "sk_...paste here...",
     "pollSeconds": 20
   }
   ```
5. Double-click **`run.bat`** (it does steps 1–4's checks for you and starts the
   agent), or from a terminal in this folder:
   ```
   node sightline-agent.mjs --test      # should print: OK — connected to "XPE" ...
   node sightline-agent.mjs             # watch mode — leave it running
   ```

Keep the window open while you scrim. The log tells you everything:

```
[19:41:02] connected to "XPE" — scrims need 3+ "XPE" players
[20:15:33] in a game — 3f9c1a2e-...
[20:52:10] game over — 3f9c1a2e-...
[20:52:41] ✔ imported Ascent 13-9 (5 matched)
```

To start it automatically: put a shortcut to `run.bat` in
`shell:startup` (Win+R → `shell:startup`).

## Roster linking

Players are matched to your Sightline roster by **Riot ID**. Set each roster
player's Riot ID to their *exact* in-game name **including the `XPE ` prefix**
(e.g. `XPE nix` / `EUW`). Anyone not matched still imports — as an "unlinked"
row you attach later by editing the scrim.

## Other commands

```
node sightline-agent.mjs --test              # check the Sightline connection
node sightline-agent.mjs --once <matchId>    # import one specific match and exit
```

`--once` is handy if a scrim happened before you started the agent and you can
get the match id (e.g. from a teammate who ran it, or a tracker).

## If a match imports wrong

`state.json` (next to the agent) keeps the list of handled match ids and a retry
queue. Delete it to re-process everything (the server still de-dupes, so this is
safe). For a genuine parsing bug, the fix is in `sightline-agent.mjs` →
`buildPayload()` only — the server contract doesn't change. Grab the raw match
with:

```
node -e "fetch('https://pd.eu.a.pvp.net/match-details/v1/matches/<id>',{headers:{...}})"
```

or just run `--once <id>` and note what the log says vs. what actually happened.

## Files

| file | role |
|---|---|
| `sightline-agent.mjs` | the whole agent — auth, poll, fetch, normalise, send |
| `config.json` | your `sightlineUrl` + `ingestKey` (git-ignored) |
| `state.json` | handled match ids + retry queue (auto-created) |
| `run.bat` | Windows launcher |
