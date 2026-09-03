# Working on Sightline

Valorant esports team ops tracker. **Cloudflare Worker + D1 + Hono**, vanilla-JS
frontend. See `README.md` for the full picture and `agent/README.md` for the
companion app.

## Layout
- `src/index.js` — the whole API (Hono routes) + static-asset fallthrough
- `src/auth.js` — PBKDF2 password hashing, sessions, cookies
- `src/valorant.js` — HenrikDev lookups (server-side): `fetchRank` (current
  tier/RR via v3/mmr) + `fetchMmrHistory` (per-match ranked history via
  v2/stored-mmr-history, paginated)
- `src/seed.js` — sample data for new teams
- `public/` — frontend: `index.html`, `app.js` (all views), `app.css`, `api.js`
- `migrations/` — D1 schema, applied in order
- `agent/` — scrim agent: zero-dep Node script, reads Valorant's local client
  API and POSTs finished customs to `/api/import/match`. **Not** part of the
  Worker build. `buildPayload()` + `resolvePlayerNames()` are the only spots that
  change if Riot's match-details / name-service shapes drift. Customs routinely
  omit `gameName`/`tagLine`, so names are resolved by puuid via
  `PUT name-service/v2/players`. Config from `config.json` or env
  (`SIGHTLINE_URL` / `SIGHTLINE_INGEST_KEY` / `SIGHTLINE_STATE`).
- `desktop/` — Electron wrapper (Win/Linux). Loads the live site; on Windows,
  spawns `agent/sightline-agent.mjs` via Electron's bundled Node
  (`ELECTRON_RUN_AS_NODE=1`). `preload.js` → `window.sightlineDesktop`; web app
  shows the agent controls (`wireDesktopAgent`) only when that's present.
  Own npm project; installers built by `.github/workflows/desktop.yml` on a
  `desktop-v*` tag.
- `legacy/` — v1 single-file localStorage app + the shelved Overwolf importer
  (Overwolf needs Riot approval to distribute Valorant apps)

## Conventions
- **Roles:** `manager` and `igl` are both full admins (`canEdit()` / `canManage()`
  are equal); only `manager` can delete the team (`isOwner()`). `player` is
  read-only except: own roster-player identity/prefs, own schedule blocks, own
  account, own performance notes. The server's `team(minRole)` middleware and the
  per-field `allowed` lists are the real gate; UI helpers just hide controls.
- **Persistence** is only D1. The frontend never touches storage directly — every
  mutation goes through `act(API.…)` then refetches `GET /api/teams/:id` (the
  bundle mirrors the old `team()` object).
- **Rank sync**, **scrim import** and **Discord notifications** run server-side;
  their secrets live in the `teams` row, never in the bundle (`hasRankApiKey` /
  `hasIngestKey` / `hasDiscord` booleans).
- Scrim import (`POST /api/import/match`, bearer = `teams.ingest_key`) dedupes on
  `(team_id, match_id)` and only accepts customs with `import_min`+ players whose
  in-game name matches `import_prefix`.
- **Rank tracking:** `POST /api/teams/:id/sync-ranks` refreshes each rostered
  player's `players.rank` *and* backfills `rank_history` (one row per ranked
  match, PK `(team_id, player_id, match_id)` → incremental). The Rank Tracking
  tab lazy-loads `GET /api/teams/:id/rank-history` into `state.rankHist` (not the
  bundle — it can grow large); `syncRanks()` nulls that cache. `tierRank(id,rr)`
  maps a HenrikDev tier id to the app's `{tier,div,rr}` (RR is `%100` for
  Immortal+). The old manual `rank_snapshots` feature is gone (dropped in 0007).
- **Matches:** `scrims` rows carry `kind` (`'scrim'` | `'official'`) + a `vods`
  JSON array. `matchesOf(kind)` in `app.js` filters the bundle; the Scrims and
  Officials tabs are one `matchListView(kind)`. Officials never count toward the
  weekly scrim goal; Performance compares the rolling scrim window
  (`state.perfWindow` = 5/10/15/0-for-lifetime) to the all-time officials average.
- **Tryouts:** `roles` is a JSON array (multi-select — e.g. Duelist + Sentinel);
  `role` is kept as `roles[0]` for old callers.
- **Discord:** `notifyTeam(c, teamRowOrId, payload)` POSTs an embed to
  `teams.discord_webhook` via `c.executionCtx.waitUntil` (fire-and-forget). Fires
  on scrim/official logged or imported, activity added, tournament week set.
  `DISCORD_RE` validates the URL on save. `teams.discord_role_id` (optional,
  digits only) is prepended as `<@&id>` in `content` by `withRolePing()` with
  `allowed_mentions.roles` so the webhook can ping a non-mentionable role.
  `PUT /api/teams/:id/discord` patches `webhook` and/or `roleId` field-wise.

## Local dev / deploy
```
npm install
npx wrangler login                    # or set CLOUDFLARE_API_TOKEN
npm run db:local && npm run dev        # http://localhost:8787
npm run check                         # syntax + view render + parser (CI runs this)
npm run db:remote && npm run deploy    # production
```
D1 `database_id` and the custom-domain route are in `wrangler.toml`.
**Push to `main` auto-deploys** via `.github/workflows/deploy.yml`
(check → migrate → deploy). Needs the `CLOUDFLARE_API_TOKEN` repo secret.
Keep `npm run check` green — add cases to `scripts/check.mjs` when you add views
or change the import parser.

## Testing without Cloudflare
- `node --check` every changed `.js`.
- Frontend views: `vm.runInContext` the `public/app.js` with stubbed
  `document` / `API` / `localStorage`; wait for the EOF `boot()` to settle by
  flushing microtasks (don't call `boot()` again — the `_booting` guard no-ops it).
- API + import + permissions: `wrangler dev --local` against a wiped local D1.
- Overwolf: `valorant.js` parser is plain CommonJS — `require()` it and feed
  synthetic GEP snapshots. The live app can't be tested without Valorant.
