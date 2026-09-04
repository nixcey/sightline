# Sightline

A Valorant esports team operations tracker — roster & ranks, unified free-time
scheduling, activity planning, scrim & official-match performance (HLTV Rating
2.0), comp analysis, tryout ranking, optional Discord notifications. Multi-team,
multi-user, role-based.

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
| Team settings, rank API key, scrim-import key & filter, Discord webhook | ✅ | — |
| Members, invites | ✅ | — |
| Delete the team | manager only | — |
| Roster: add/remove, status, joined date | ✅ | — |
| Roster: own handle, name, role, icon, agents, Riot ID, rank, notes | ✅ | own only |
| Scrims, officials, tryouts, rank sync, activities, tournament weeks | ✅ | — |
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

## Deploy

**Automatic** — pushing to `main` runs `.github/workflows/deploy.yml`: it runs
`npm run check` (syntax + view render + parser), then applies D1 migrations, then
`wrangler deploy`. Pull requests run `check` only. Nothing else is automatic —
GitHub is otherwise unconnected to Cloudflare.

**Manual** (from a machine with wrangler auth):

```bash
npm run check
npm run db:remote                  # apply migrations to production D1
npm run deploy                     # publish the Worker + assets
```

Live at `https://sightline.nixcey.com` (Workers Custom Domain; `wrangler.toml`
has the `account_id`, `database_id` and route). Cloudflare free tier covers this.

### CI secret

The Action needs one repo secret — **`CLOUDFLARE_API_TOKEN`**
(GitHub repo → Settings → Secrets and variables → Actions → New repository
secret). Create it as a **Custom Token** at
[dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens):

| Type | Resource | Permission |
|---|---|---|
| Account | Workers Scripts | Edit |
| Account | Cloudflare D1 | Edit |
| Zone | Zone | Read |
| Zone | Workers Routes | Edit |
| Zone | DNS | Edit |

Account Resources → your account · Zone Resources → **only** `nixcey.com`.
(Or use Cloudflare's *"Edit Cloudflare Workers"* template and scope its zone to
`nixcey.com`.) The account ID is not secret and is already in `wrangler.toml`.

## Rank sync

Team settings → **Rank sync API key**. Sightline calls the community
[HenrikDev Valorant API](https://docs.henrikdev.xyz/) server-side (the key stays
in the D1 `teams` row, never reaches the browser). Get a free key from their
Discord. tracker.gg's API and Riot's official API can't be used — no CORS, bot
protection, and no public "current rank by Riot ID" endpoint.

Each player has a **Riot ID** (name + tag, optional per-player region). One sync
button does two things per rostered player:

1. **current rank** — `/valorant/v3/mmr` → tier + RR onto `players.rank` (works
   even for accounts HenrikDev has never seen).
2. **match history** — `/valorant/v2/stored-mmr-history` → every stored ranked
   game into `rank_history`, deduped on `match_id` so re-running only adds new
   games. That endpoint is HenrikDev's own backfilled log, not a live Riot pull —
   it can come back empty for an account they haven't tracked yet even though
   the account has a rank, so an empty result falls back to the live (non-stored)
   `/valorant/v2/mmr-history` — the last ~20 games straight from Riot, no
   backfill delay. 429s from HenrikDev's rate limit are retried automatically
   (honouring `Retry-After`, capped at 60s).

**Rank Tracking** tab: a team-average elo trajectory plus a per-player view
(elo-per-game chart, W–L from RR deltas, peak, recent games). Manual tier entry
on the Roster tab is still the fallback when there's no Riot ID / API key.

## Rating 2.0

Player form uses the HLTV-style **Rating 2.0** formula (community coefficients),
recentred for Valorant's ADR scale so a league-average game ≈ 1.00:

```
R      = 0.0073·KAST + 0.3591·KPR − 0.5329·DPR + 0.2372·Impact + 0.0032·ADR + 0.1587 − 0.27
Impact = 2.13·KPR + 0.42·APR − 0.41
```

Per-round rates come from the match's total rounds. Log ADR + KAST per player for
an exact number; leave them blank and the rating falls back to an estimate.

The **Performance** tab shows a rolling scrim window (5 / 10 / 15 / lifetime)
side by side with each player's **officials** average, so you can see who steps
up in tournament matches. Matches carry a `kind` (`scrim` | `official`);
officials get their own tab and never count toward the weekly scrim goal.

## Discord notifications

Each team can set an incoming-webhook URL (Account → Discord notifications).
When set, the Worker posts an embed on: a scrim/official logged or imported, a
new activity added to the week, and a week marked as a tournament week. Webhook
delivery is fire-and-forget (`c.executionCtx.waitUntil`); the URL lives in the
`teams` row and is never sent to the browser (`hasDiscord` boolean only).

Optionally set a **role ID** to `@mention` on every notification
(`teams.discord_role_id`). The mention goes in the message `content` (embeds
never ping) with `allowed_mentions.roles`, so a webhook can ping the role even
when it isn't set "mentionable" in Discord.

## Data model

`teams` → each has `players`, `scrims`, `rank_history`, `tryouts`,
`activities_weeks`, `activities_months`, a JSON `schedule` column, and
`team_members` (user ↔ role ↔ optional linked player). Nested structures
(lineups, agent pools, score breakdowns, schedule blocks, scrim VOD links,
tryout roles) are JSON columns. `scrims.kind` separates officials from scrims;
`teams.discord_webhook` holds the notification URL. See `migrations/`.

## Project layout

```
public/           static frontend (index.html, app.js, app.css, api.js)
src/index.js      Hono app: all API routes + static fallthrough
src/auth.js       password hashing, sessions, cookies
src/valorant.js   HenrikDev rank lookup
src/seed.js       sample-data generator for new teams
migrations/       D1 schema
agent/            scrim agent — reads Valorant's local client API, imports customs
desktop/          Electron wrapper (Windows/Linux); runs the agent on Windows
legacy/           v1 single-file app, and the shelved Overwolf importer
```

## Scrim import (`agent/`)

`agent/sightline-agent.mjs` — a zero-dependency Node script that reads Valorant's
**local client API** (`127.0.0.1` lockfile → entitlement token → `core-game` /
`match-details`). No Riot password, no Overwolf, no Riot developer approval. When
a custom game ends it `POST`s the scoreboard to `/api/import/match`. See
`agent/README.md`.

Two auth modes:
- **Desktop app** (any team member) — the agent rides your **logged-in session**
  (`sid` cookie + `?team=<id>`). Nothing to paste; no shared secret ever reaches
  a player's machine. Scrims → **Run scrim agent** → Start.
- **Standalone / headless** — a per-team **ingest key** (`Bearer sk_…`), managed
  by a manager under Scrims → Scrim importer. For running the agent on a box
  that isn't signed in.

- **Not every custom is a scrim.** A game is only imported when at least
  `import_min` (default 3) players whose in-game name starts with the team's
  `import_prefix` (default = tag, e.g. `XPE`) are on one team. If Overwolf/Riot
  labelled the wrong team as "us", the server swaps sides and flips the score.
- Players link to the roster by **Riot ID** — set each roster player's Riot ID to
  their full in-game name including the prefix (`XPE nix` / `EUW`). Unmatched
  players import as "unlinked" rows you attach later.
- The Riot match id is stored, so the same match is **never imported twice** — a
  repeat returns `{imported:false, reason:"already imported"}`.

The shelved Overwolf version is in `legacy/overwolf/` (Valorant apps need Riot
approval to distribute — see its README).

## Desktop app (`desktop/`)

An Electron wrapper for **Windows and Linux** — the same web app in a native
window, and on Windows a **Scrims → Scrim importer** panel that runs the agent
for you (no terminal, no Node install — it uses Electron's bundled Node).
Installers are built by CI on a `desktop-v*` tag and attached to a GitHub
Release. `cd desktop && npm start` to run it against the live site. See
`desktop/README.md`.

## Security

- **Auth** — cookie sessions (256-bit token, stored as `sha256(token)`),
  `HttpOnly` + `SameSite=Lax` + `Secure` (prod). PBKDF2 (100k) password hashing;
  the login route spends the same PBKDF2 time on unknown emails (no timing
  oracle).
- **Rate limits** (D1 fixed-window, `rate_limits` table): login (40/10min per IP,
  10/15min per email — cleared on a correct password), bootstrap, invite lookup +
  accept, and `/api/import/match` (120/10min per team).
- **CSP** — `public/_headers` ships `script-src 'self'` (no `unsafe-inline`), so
  stored markup can't execute; plus `X-Frame-Options`, `nosniff`, HSTS,
  `Referrer-Policy`. The Worker adds the same headers to `/api/*` responses.
- **Input** — every stored free-text field is length-capped and control-char
  stripped server-side; `handle`/`icon`/team name also drop `<>`. Enums (server,
  region, status, role) are allow-listed.
- **Tenancy** — a `player`-role account belongs to exactly one team (staff may be
  multi-team). Every `/api/teams/:id/*` route is guarded by team membership + a
  minimum role; sub-resource writes are always scoped `WHERE team_id = ?`.

## Roadmap

- Email delivery for invites and a password-reset flow.
- Code-sign the desktop installers (Windows SmartScreen / Linux).
