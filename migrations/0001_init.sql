-- Sightline schema (Cloudflare D1 / SQLite)

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  pw_hash     TEXT NOT NULL,
  pw_salt     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,        -- sha256(token)
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE teams (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  tag               TEXT NOT NULL,
  server            TEXT NOT NULL DEFAULT 'EU',
  rank_api_key      TEXT NOT NULL DEFAULT '',
  scrim_goal        TEXT NOT NULL DEFAULT '{"base":1,"tournament":3}',
  tournament_weeks  TEXT NOT NULL DEFAULT '[]',
  schedule          TEXT NOT NULL DEFAULT '{"winStart":"11:00","winEnd":"24:00","includeSubs":false,"blocks":[]}',
  created_at        INTEGER NOT NULL
);

CREATE TABLE team_members (
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('manager','igl','player')),
  player_id   TEXT,                    -- optional link to a players row
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX idx_tm_user ON team_members(user_id);

CREATE TABLE invites (
  code        TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('manager','igl','player')),
  email       TEXT,
  player_id   TEXT,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_by     TEXT
);
CREATE INDEX idx_invites_team ON invites(team_id);

CREATE TABLE players (
  id              TEXT PRIMARY KEY,
  team_id         TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  handle          TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  role            TEXT NOT NULL DEFAULT 'Flex',
  status          TEXT NOT NULL DEFAULT 'Trial',
  icon            TEXT NOT NULL DEFAULT '',
  joined          TEXT NOT NULL DEFAULT '',
  agents          TEXT NOT NULL DEFAULT '[]',
  rank            TEXT,                -- json {tier,div,rr}
  riot_id         TEXT,                -- json {name,tag,region}
  rank_synced_at  INTEGER,
  note            TEXT NOT NULL DEFAULT '',
  sort            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_players_team ON players(team_id);

CREATE TABLE scrims (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  opp         TEXT NOT NULL DEFAULT 'TBD',
  map         TEXT NOT NULL,
  rw          INTEGER NOT NULL DEFAULT 0,
  rl          INTEGER NOT NULL DEFAULT 0,
  lineup      TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_scrims_team ON scrims(team_id);

CREATE TABLE rank_snapshots (
  id        TEXT PRIMARY KEY,
  team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  date      TEXT NOT NULL,
  note      TEXT NOT NULL DEFAULT '',
  ranks     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_snap_team ON rank_snapshots(team_id);

CREATE TABLE tryouts (
  id        TEXT PRIMARY KEY,
  team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  date      TEXT NOT NULL,
  handle    TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT 'Flex',
  tier      TEXT NOT NULL DEFAULT 'Immortal',
  div       INTEGER NOT NULL DEFAULT 1,
  agents    TEXT NOT NULL DEFAULT '[]',
  scores    TEXT NOT NULL DEFAULT '{}',
  verdict   TEXT NOT NULL DEFAULT 'Hold',
  notes     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_tryouts_team ON tryouts(team_id);

CREATE TABLE activities_weeks (
  team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  week_key  TEXT NOT NULL,
  data      TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (team_id, week_key)
);

CREATE TABLE activities_months (
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  month_key  TEXT NOT NULL,
  theme      TEXT NOT NULL DEFAULT '',
  goals      TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (team_id, month_key)
);
