# Working on Sightline

Valorant esports team ops tracker. **Cloudflare Worker + D1 + Hono**, vanilla-JS
frontend. See `README.md` for the full picture and `overwolf/README.md` for the
companion app.

## Layout
- `src/index.js` — the whole API (Hono routes) + static-asset fallthrough
- `src/auth.js` — PBKDF2 password hashing, sessions, cookies
- `src/valorant.js` — HenrikDev rank lookup (server-side)
- `src/seed.js` — sample data for new teams
- `public/` — frontend: `index.html`, `app.js` (all views), `app.css`, `api.js`
- `migrations/` — D1 schema, applied in order
- `overwolf/` — Overwolf app; **not** part of the Worker build, loaded by Overwolf
- `legacy/` — the original single-file localStorage version

## Conventions
- **Roles:** `manager` and `igl` are both full admins (`canEdit()` / `canManage()`
  are equal); only `manager` can delete the team (`isOwner()`). `player` is
  read-only except: own roster-player identity/prefs, own schedule blocks, own
  account, own performance notes. The server's `team(minRole)` middleware and the
  per-field `allowed` lists are the real gate; UI helpers just hide controls.
- **Persistence** is only D1. The frontend never touches storage directly — every
  mutation goes through `act(API.…)` then refetches `GET /api/teams/:id` (the
  bundle mirrors the old `team()` object).
- **Rank sync** and **scrim import** run server-side; their keys live in the
  `teams` row, never in the bundle (`hasRankApiKey` / `hasIngestKey` booleans).
- Scrim import (`POST /api/import/match`, bearer = `teams.ingest_key`) dedupes on
  `(team_id, match_id)` and only accepts customs with `import_min`+ players whose
  in-game name matches `import_prefix`.

## Local dev / deploy
```
npm install
npx wrangler login                    # or set CLOUDFLARE_API_TOKEN
npm run db:local && npm run dev        # http://localhost:8787
npm run db:remote && npm run deploy    # production
```
D1 `database_id` and the custom-domain route are in `wrangler.toml`.

## Testing without Cloudflare
- `node --check` every changed `.js`.
- Frontend views: `vm.runInContext` the `public/app.js` with stubbed
  `document` / `API` / `localStorage`; wait for the EOF `boot()` to settle by
  flushing microtasks (don't call `boot()` again — the `_booting` guard no-ops it).
- API + import + permissions: `wrangler dev --local` against a wiped local D1.
- Overwolf: `valorant.js` parser is plain CommonJS — `require()` it and feed
  synthetic GEP snapshots. The live app can't be tested without Valorant.
