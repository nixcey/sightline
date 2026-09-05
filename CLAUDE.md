# Working on Sightline

Valorant esports team ops tracker. **Cloudflare Worker + D1 + Hono**, vanilla-JS
frontend. See `README.md` for the full picture and `agent/README.md` for the
companion app.

## Layout
- `src/index.js` — the whole API (Hono routes) + static-asset fallthrough
- `src/auth.js` — PBKDF2 password hashing, sessions, cookies
- `src/valorant.js` — HenrikDev lookups (server-side): `fetchRank` (current
  tier/RR via v3/mmr) + `fetchMmrHistory` (per-match ranked history via
  v2/stored-mmr-history — one call, `size` only; no `page`). `stored-mmr-history`
  is HenrikDev's own backfilled log and can be empty for an account they haven't
  tracked yet even with a valid rank, so an empty result falls back to the live
  v2/mmr-history pull (last ~20 games straight from Riot, `source:"live"` on the
  return). `hdFetch()` retries on 429, honouring Retry-After up to a 60s cap
  (Basic key = 30 req/min). `despikeHistory()` drops HenrikDev glitch rows
  (isolated elo spikes, sub-Iron-1, no elo).
- `src/seed.js` — sample data for new teams (roster, scrims, tryouts, schedule,
  activities, and a generated per-match `rank_history` trajectory so the Rank
  Tracking tab has something to chart)
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
- **Shell / theming:** there is no sidebar. `index.html` is a 60px masthead
  (brand · theme toggle · account), a **title block** (team-switcher popover +
  `<h1>` + the controls *that view* owns), then one horizontal tab strip
  (`#nav`, all 10 views, scrollable on a phone — `keepTabVisible()` keeps the
  active one on screen). `render()` owns every part of it. The week picker +
  tournament toggle (`#topctl`) only appear for `WEEK_VIEWS` (overview /
  activities / scrims); the other seven ignore `state.week`, so showing it
  there was just noise. Team backup moved off the old rail into the Account
  dialog (`exportTeam()`); Team settings is reachable from both Roster and
  Account.
  Colours come **only** from the token block at the top of `app.css` — light
  on `:root`, dark redefined under both `prefers-color-scheme` and
  `[data-theme="dark"]` so the in-app toggle wins either way. One sans family
  end to end — `--sans`/`--disp` (Inter) is headings *and* UI, no serif split
  — `--mono` (Roboto Mono) numerics, `--brand` (Chakra Petch) the SIGHTLINE
  mark only.
  `[hidden]{display:none!important}` near the top is load-bearing: several
  shell elements are toggled by the attribute against author `display` rules
  that would otherwise win on equal specificity.
- **Roles:** `manager` and `igl` are both full admins (`canEdit()` / `canManage()`
  are equal); only `manager` can delete the team (`isOwner()`). `player` is
  read-only except: own roster-player identity/prefs, own schedule blocks, own
  account, own performance notes. The server's `team(minRole)` middleware and the
  per-field `allowed` lists are the real gate; UI helpers just hide controls.
  A `player`-role account is single-team (`multiTeamBlock()` on join/create);
  staff may be multi-team.
- **Security:** `clampStr` / `noTags` / `cleanPlayerVal` sanitise every stored
  free-text field — do this for any new user-writable column. Render user data
  through `esc()` on the frontend (CSP `script-src 'self'` from `public/_headers`
  is the backstop; no inline `on*=` handlers — use `data-*` + a delegated
  listener on `M`). `rateLimit(db, key, max, windowMs)` (D1 `rate_limits`) guards
  login / bootstrap / invites / import. Login spends equal PBKDF2 time on unknown
  emails. Security headers: `public/_headers` for assets, `harden()` for `/api/*`.
- **Persistence** is only D1. The frontend never touches storage directly — every
  mutation goes through `act(API.…)` then refetches `GET /api/teams/:id` (the
  bundle mirrors the old `team()` object).
- **Rank sync**, **scrim import** and **Discord notifications** run server-side;
  their secrets live in the `teams` row, never in the bundle (`hasRankApiKey` /
  `hasIngestKey` / `hasDiscord` booleans).
- Scrim import (`POST /api/import/match`) dedupes on `(team_id, match_id)` and
  only accepts customs with `import_min`+ players whose in-game name matches
  `import_prefix`. Auth is either `Bearer sk_…` (`teams.ingest_key`, headless) or
  a signed-in session + `?team=<id>` (`resolveImportTeam()`) — the desktop agent
  uses the latter so no key reaches a player. `agent/` reads `SIGHTLINE_SESSION`
  + `SIGHTLINE_TEAM` (desktop passes the `sid` cookie) or `SIGHTLINE_INGEST_KEY`.
- **Rank tracking:** `POST /api/teams/:id/sync-ranks` refreshes each rostered
  player's `players.rank` *and* backfills `rank_history` (one row per ranked
  match, PK `(team_id, player_id, match_id)` → incremental, `INSERT OR IGNORE`).
  Because of that PK a bad stored row never gets overwritten — pass `{rebuild:1}`
  (whole team) or `{only,rebuild:1}` to wipe + re-pull, or
  `DELETE /rank-history/:pid/:mid` to drop one row. The response's `players[]`
  carries a per-player `status` (`ok`/`unrated`/`error`) + `err` + `dropped`;
  the Rank tab renders it as a "Last sync result" panel (`state.rankSync`) so
  failures aren't just a toast. The tab lazy-loads
  `GET /api/teams/:id/rank-history` into `state.rankHist` (not the bundle — it
  can grow large); `syncRanks()` nulls that cache and also filters
  `tierId>=3 && elo>0` client-side as a backstop. `tierRank(id,rr)` maps a
  HenrikDev tier id to the app's `{tier,div,rr}` (RR is `%100` for Immortal+).
  The old manual `rank_snapshots` feature is gone (dropped in 0007).
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
