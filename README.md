# Sightline

A Valorant esports team operations tracker — roster & ranks, unified free-time
scheduling, activity planning, scrim performance (HLTV Rating 2.0), comp analysis,
tryout ranking. Multi-team, multi-user, role-based.

- **Frontend** — vanilla JS (`public/`), no build step
- **API** — Cloudflare Worker + [Hono](https://hono.dev) (`src/`)
- **Database** — Cloudflare D1 (SQLite)
- **Auth** — cookie sessions (PBKDF2 via Web Crypto), invite-only membership

One Worker serves both the static frontend and the `/api/*` JSON API.

## Roles

**manager** and **igl** are both full admins. The only difference: only a
manager can **delete the team**. A team always keeps at least one manager.

| Area | admin (manager / igl) | player |
|---|:-:|:-:|
| Team settings, rank API key, scrim-import key & filter | ✅ | — |
| Members, invites | ✅ | — |
| Delete the team | manager only | — |
| Roster: add/remove, status, joined date | ✅ | — |
| Roster: own handle, name, role, icon, agents, Riot ID, rank, notes | ✅ | own only |
| Scrims, rank snapshots, tryouts, rank sync, activities, tournament weeks | ✅ | — |
| Schedule: active window, other players' blocks | ✅ | — |
| Schedule: **own** availability blocks | ✅ | ✅ |
| Performance notes on a player | ✅ | own only |
| Own account (name, email, password) | ✅ | ✅ |
| View everything on the team | ✅ | ✅ |

Server enforces every write by role; the UI just hides what you can't do.

Membership is **invite-only**. A manager creates invite links (Roster → Invite
member, or Account → Members); the invitee opens the link, sets a password, and
lands on the team. New visitors with just a code can redeem it from the sign-in
screen.

## Local development

```bash
npm install
npx wrangler login                 # one-time, opens browser
npm run db:create                  # prints a database_id
# paste that id into wrangler.toml -> [[d1_databases]] database_id
npm run db:local                   # apply migrations to the local SQLite db
npm run dev                        # http://localhost:8787
```

First run: the app shows a **"create the owner account"** screen (only available
while the users table is empty). After that it's the normal sign-in screen.
New team → optionally seeded with a sample roster (team XPE).

## Deploy to Cloudflare

```bash
npm run db:remote                  # apply migrations to the production D1 db
npm run deploy                     # publishes the Worker + assets
```

The Worker is served at `https://sightline.<your-subdomain>.workers.dev` (or a
custom route you configure in `wrangler.toml`). Everything is on Cloudflare's
free tier at this scale.

## Rank sync

Team settings → **Rank sync API key**. Sightline calls the community
[HenrikDev Valorant API](https://docs.henrikdev.xyz/) server-side (the key stays
in the D1 `teams` row, never reaches the browser). Get a free key from their
Discord. tracker.gg's API and Riot's official API can't be used — no CORS, bot
protection, and no public "current rank by Riot ID" endpoint.

Each player has a **Riot ID** (name + tag, optional per-player region). "⟳ Sync
ranks" on the Roster tab fills in every player's current tier + RR; manual entry
is the fallback.

## Rating 2.0

Player form uses the HLTV-style **Rating 2.0** formula (community coefficients),
recentred for Valorant's ADR scale so a league-average game ≈ 1.00:

```
R      = 0.0073·KAST + 0.3591·KPR − 0.5329·DPR + 0.2372·Impact + 0.0032·ADR + 0.1587 − 0.27
Impact = 2.13·KPR + 0.42·APR − 0.41
```

Per-round rates come from the scrim's total rounds. Log ADR + KAST per player for
an exact number; leave them blank and the rating falls back to an estimate.

## Data model

`teams` → each has `players`, `scrims`, `rank_snapshots`, `tryouts`,
`activities_weeks`, `activities_months`, a JSON `schedule` column, and
`team_members` (user ↔ role ↔ optional linked player). Nested structures
(lineups, agent pools, score breakdowns, schedule blocks) are JSON columns.
See `migrations/0001_init.sql`.

## Project layout

```
public/           static frontend (index.html, app.js, app.css, api.js)
src/index.js      Hono app: all API routes + static fallthrough
src/auth.js       password hashing, sessions, cookies
src/valorant.js   HenrikDev rank lookup
src/seed.js       sample-data generator for new teams
migrations/       D1 schema
overwolf/         Overwolf companion app — auto-imports Valorant custom games
legacy/           the original single-file localStorage version (v1)
```

## Scrim import (Overwolf)

The IGL runs the `overwolf/` companion app. When a Valorant **custom game** ends
it sends the whole scoreboard to `POST /api/import/match`, authenticated by a
per-team **ingest key** (Scrims → Scrim importer → generate).

- **Not every custom is a scrim.** A game is only imported when at least
  `import_min` (default 3) players whose in-game name starts with the team's
  `import_prefix` (default = tag, e.g. `XPE`) are on one team. If that team is the
  one Overwolf labelled as the enemy, sides and score are swapped.
- Players are matched to the roster by **Riot ID** — set each roster player's
  Riot ID to their *full* in-game name including the prefix (`XPE nix#EUW`).
  Unmatched players import as "unlinked" rows you attach later.
- The match's `pseudo_match_id` is stored, so the same match is **never imported
  twice** — a repeat returns `{imported:false, reason:"already imported"}`.

See `overwolf/README.md`.

## Roadmap

- Manual "import by match ID" for scrims that *are* in match history (HenrikDev
  by-ID endpoint) — complements the Overwolf path for non-hidden games.
- Email delivery for invites and a password-reset flow.
- Rate-limiting on auth + import endpoints.
