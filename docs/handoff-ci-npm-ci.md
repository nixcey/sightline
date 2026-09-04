# Handoff notes — CI `npm ci` slowness (2026-09-04)

Written on the Windows box, to pick up on Linux (`~/xpe-proj`).

> **Resolved 2026-09-04** — the `deploy.yml` change below is applied: `check`
> runs `node scripts/check.mjs` with no install, `deploy` caches `node_modules`
> keyed on `package-lock.json`. The analysis + Windows-box quirks are kept below
> for reference.

## Where things stand

- **Rank-sync fixes are done, committed, and pushed** as `98148c6`
  ("Rank sync: surface per-player failures, backoff on 429, despike glitch rows").
  CI ran on that push. `npm run check` passes locally. Nothing outstanding there —
  see the commit body / `CLAUDE.md` rank-tracking section for what changed.
  After it deploys: run a sync, read the new "Last sync result" panel, hit
  "Rebuild from scratch" for the player with the Iron 3 dip.

- **Open item: `npm ci` in GitHub Actions takes 5+ min on a normal push to main.**
  Not fixed yet. Analysis + proposed patch below.

## Why `npm ci` is slow

The only devDependency is `wrangler` (4.128.0). It pulls in **`workerd`** —
Cloudflare's Workers runtime, a ~100 MB prebuilt V8 binary — plus `esbuild` and
`miniflare`. `npm ci` deletes `node_modules` and re-downloads/extracts all of it
every run. Tree is small (92 packages) so 5+ min means something is degraded:
npm's cache not restoring, a stalled/retrying binary download from the registry
(npm retries 3× with backoff ≈ up to ~2 min of dead wait), or GH's cache service
being slow. Often transient, but the structure makes every run pay full price.

Contributing: `deploy.yml` runs `npm ci` **twice** — once in `check`, once in
`deploy` — on two separate runners that don't share `node_modules`.

## The fix (not yet applied)

`npm run check` is just `node scripts/check.mjs`. That script imports **only Node
builtins + the zero-dep `agent/sightline-agent.mjs` and `src/valorant.js`**. It
never imports `hono` or `wrangler`. The syntax pass is `node --check` (parse
only). **So the `check` job needs no `npm ci` at all.**

Proposed `.github/workflows/deploy.yml`:

```yaml
name: CI / Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # scripts/check.mjs imports only node builtins + zero-dep source files.
      # No hono, no wrangler -> no install needed. Keep it that way.
      - run: node scripts/check.mjs

  deploy:
    needs: check
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Cache node_modules
        id: nm
        uses: actions/cache@v4
        with:
          path: node_modules
          key: nm-${{ runner.os }}-node22-${{ hashFiles('package-lock.json') }}
      - if: steps.nm.outputs.cache-hit != 'true'
        run: npm ci --no-audit --no-fund --prefer-offline
      - name: Apply D1 migrations
        run: npx wrangler d1 migrations apply sightline --remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      - name: Deploy Worker
        run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

Effect:
- `check` (also runs on every PR): ~15 s, zero install.
- `deploy`: `npm ci` only on a `package-lock.json` change; otherwise a few-second
  `node_modules` restore. Steady-state deploy no longer waits on workerd.

Caveats:
- Caching `node_modules` directly (not `~/.npm`) means a corrupt cache entry
  needs a manual bump of the `key` prefix (`nm-` -> `nm2-`) or clearing caches in
  the Actions UI. Acceptable for a 1-package-deep tree.
- If a future check ever imports `hono` (e.g. testing `src/index.js` routes),
  restore an install step in `check` — a comment in the file flags this.
- `desktop.yml` is untouched; its `npm ci` in `desktop/` (electron, ~200 MB) is
  genuinely heavy and only runs on `desktop-v*` tags.

## Windows box quirks (FYI, don't need fixing)

- `node_modules/` was empty here — never installed. `npx wrangler ...` hangs
  because it silently tries to install first.
- Local `git` had no identity; set it per-repo:
  `git config user.name nixcey && git config user.email notnixcey@gmail.com`
- `gh` CLI not installed here.
- Windows Defender scanning `node_modules` on extract roughly 3-5x's any
  `npm ci` locally — add a Defender exclusion for the repo folder.
