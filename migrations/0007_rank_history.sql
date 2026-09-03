-- Per-match competitive rank history (HenrikDev stored-mmr-history), replacing
-- the manual fortnightly rank_snapshots feature.

DROP TABLE IF EXISTS rank_snapshots;

CREATE TABLE rank_history (
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id   TEXT NOT NULL,
  match_id    TEXT NOT NULL,
  played_at   TEXT NOT NULL,           -- ISO 8601, e.g. 2026-08-27T20:10:58Z
  tier_id     INTEGER NOT NULL DEFAULT 0,   -- HenrikDev tier id (3=Iron1 … 27=Radiant)
  tier_name   TEXT NOT NULL DEFAULT '',
  rr          INTEGER NOT NULL DEFAULT 0,   -- ranking in tier, 0-100
  last_change INTEGER NOT NULL DEFAULT 0,   -- RR gained/lost this game
  elo         INTEGER NOT NULL DEFAULT 0,   -- absolute: (tier_id-3)*100 + rr
  map         TEXT NOT NULL DEFAULT '',
  season      TEXT NOT NULL DEFAULT '',
  synced_at   INTEGER NOT NULL,
  PRIMARY KEY (team_id, player_id, match_id)
);
CREATE INDEX idx_rankhist ON rank_history(team_id, player_id, played_at);
