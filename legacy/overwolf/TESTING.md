# Testing the Overwolf app on Windows

> **Superseded.** The Overwolf route is shelved (Valorant apps need Riot approval
> to distribute). Use `agent/` — see `agent/README.md`. Kept for reference only.


Everything you need to test `overwolf/` against the live Sightline
(`https://sightline.nixcey.com`), offline from any chat.

---

## 0. Get the files onto Windows

```powershell
git clone https://github.com/nixcey/sightline.git
```

The app is the whole **`sightline\overwolf\`** folder. You only need that folder —
it talks to the deployed API, not the rest of the repo. (Cloning the whole repo
is easiest so you can `git pull` updates and `git commit` any parser fixes.)

Nothing to `npm install` for the app itself. Node is only needed if you want to
run the parser unit test (`node overwolf-parse-test` style — see step 6).

---

## 1. Prep on the website (do this first, in a browser)

Sign in to `https://sightline.nixcey.com` as **manager or IGL**.

1. **Scrims tab → "⬇ Scrim importer"**
   - Click **Generate ingest key** → it's shown once, **copy it** (starts `sk_`).
   - Under "What counts as a scrim": prefix should be `XPE`, min `3`. Adjust if
     your in-game prefix is different, then **Save filter**.
2. **Roster tab** — for every XPE player, set their **Riot ID** to their *exact*
   in-game name **including the `XPE ` prefix** and the correct tagline, e.g.
   `XPE nix` / `EUW`. If the Riot ID doesn't match what Valorant reports, that
   player still imports but as an **"unlinked"** row (you attach them later by
   editing the scrim). The 3-player scrim filter works off the name prefix
   regardless, so a mismatch there won't block the import — it just won't link.

---

## 2. Install the app in Overwolf

1. Install **Overwolf** (https://www.overwolf.com/) and make sure **Valorant** +
   the Riot client are installed.
2. Overwolf dock → **Settings** (gear icon) → **About** tab → scroll to
   **Development options** → toggle it on.
3. Click **Load unpacked extension** → select `sightline\overwolf\` (the folder
   that contains `manifest.json`).
4. "Sightline Scrim Importer" now appears in the Overwolf dock. Open it.

> If dev options aren't under **About**, check the **Support** tab — Overwolf has
> moved it between versions.

---

## 3. Connect

In the Sightline Scrim Importer window:

- **Sightline URL:** `https://sightline.nixcey.com`
- **Ingest key:** paste the `sk_…` key from step 1
- Click **Save**, then **Test connection**

Expect: `connected · XPE · 3+ "XPE"` in green.

If it fails:
- `invalid ingest key` → wrong key, or it was revoked/rotated on the website.
- network error → check the URL (no trailing slash, `https://`).

Leave **"Auto-import matches as they finish"** checked. "Import modes" = Custom
games only (default).

---

## 4. Smoke test (no scrim needed)

1. Launch **Valorant**. The importer's background process starts with the game.
2. Play *any* quick custom — a deathmatch, a 1v1, whatever.
3. Watch the **Activity** panel in the importer window. You want to see, in order:
   - `Game events registered`
   - `Match started`
   - `Match ended — capturing scoreboard`
   - then either an import line **or** `Not importing: not a scrim — N "XPE"
     player(s) on a team (need 3)` — **this is correct** for a non-scrim custom.

Seeing that sequence means the whole pipeline works. If you never see
`Game events registered`, the game-events hook didn't attach — restart Valorant
with the importer already open, or reload the app (step 7).

---

## 5. Real test (an actual scrim)

Run a 5v5 custom with **3+ XPE-tagged players on one team**. When the match ends:

- **Activity** log should show
  `Imported <Map> <score> (<N> players matched…)` — or `skip: already imported`
  if you re-scan the same match.
- On the website, **Scrims tab** → a new card tagged **⬇ imported** with the
  scoreboard. Players not matched to the roster show an **"unlinked"** chip —
  edit the scrim to link them, or fix their Riot ID in the roster and the *next*
  import will link automatically.
- If the score is backwards or the wrong team is "us", the server auto-swaps
  based on where the XPE players are — but if it still looks wrong, that's a data
  issue worth capturing (step 8).

Buttons that help:
- **Re-scan last match** — re-sends the last captured match (e.g. if you set the
  opponent name after the game, or the scoreboard was slow).
- **Opponent name for the next imported match** — fill it in *before* the scrim
  ends; it's applied once then cleared. (Or just rename the opponent on the
  website afterwards.)

---

## 6. Parser unit test (optional, needs Node 22+)

```powershell
cd sightline
node -e "const {buildPayload}=require('./overwolf/valorant.js'); console.log(buildPayload({me:{name:'XPE nix'},match_info:{pseudo_match_id:'T',map:'Ascent',custom_game:true,score:{won:13,lost:9},roster_0:JSON.stringify({name:'XPE nix',tagline:'EUW',character:'Cypher',teammate:true}),roster_1:JSON.stringify({name:'XPE a',tagline:'EU',character:'Jett',teammate:true}),roster_2:JSON.stringify({name:'XPE b',tagline:'EU',character:'Omen',teammate:true}),roster_5:JSON.stringify({name:'foe',tagline:'EU',character:'Sova',teammate:false})}},{modes:['custom'],prefix:'XPE',min:3}))"
```

Should print a `{ payload: … }` with `us` length 3.

---

## 7. Editing / reloading the app

The app files are plain JS/HTML — edit them in `overwolf\` directly.

- **Reload after an edit:** Overwolf Settings → About → Development options → find
  the app → **Reload** (or remove + Load unpacked again). `background.js` changes
  need a full reload; `desktop.*` changes just need the window reopened.
- All parsing lives in **`valorant.js`**. The server contract
  (`POST /api/import/match`) never changes, so a Valorant patch that breaks
  capture is a `valorant.js`-only fix.

---

## 8. If a real scrim won't import correctly — capture the raw data

This is the one thing that lets the parser get fixed. After the problem match:

1. Open the importer window's **dev tools**: Overwolf Settings → About → Dev
   options → the app → **Open dev tools** (or right-click the app → Developer
   Tools).
2. **Console** tab, run:
   ```js
   copy(localStorage.getItem("sl_lastraw"))
   ```
   That copies the exact Overwolf snapshot to your clipboard.
3. Paste it into a file (`raw-match-1.json`) and keep it. Also note: what the
   Activity log said, what the real score/map/lineup was, and which team was
   actually yours.

With that JSON, `valorant.js` can be adjusted to match whatever Overwolf's
Valorant GEP actually emits on your build.

Also useful from the same console:
```js
JSON.parse(localStorage.getItem("sl_log"))      // full activity log
localStorage.getItem("sl_prefix"), localStorage.getItem("sl_min")  // filter it pulled
JSON.parse(localStorage.getItem("sl_queue"))    // matches that failed to send
```

---

## Quick reference — what a healthy run looks like

| Activity log line | meaning |
|---|---|
| `Sightline Scrim Importer running` | app background started |
| `Game events registered` | hooked into Valorant's GEP ✓ |
| `Connected to "XPE" — importing customs with 3+ "XPE" players` | Test connection OK |
| `Match started` | a match began |
| `Match ended — capturing scoreboard` | grabbing final stats |
| `Imported Ascent 13-9 (5 players matched)` | ✅ scrim landed on the website |
| `skip: Ascent already imported` | dedupe working — safe |
| `Not importing: not a scrim — 1 "XPE" player…` | correctly ignored a pug |
| `queued: send failed — … Will retry.` | network blip; retries every 60s |
