-- Scrim import (Overwolf), per-player performance notes, team ingest key.

ALTER TABLE scrims ADD COLUMN match_id     TEXT;
ALTER TABLE scrims ADD COLUMN source       TEXT NOT NULL DEFAULT 'manual';   -- 'manual' | 'overwolf'
ALTER TABLE scrims ADD COLUMN imported_at  INTEGER;
ALTER TABLE scrims ADD COLUMN enemy        TEXT NOT NULL DEFAULT '[]';       -- opponent scoreboard, for future comp analysis

-- a given match can only be imported once per team
CREATE UNIQUE INDEX idx_scrims_matchid ON scrims(team_id, match_id) WHERE match_id IS NOT NULL;

ALTER TABLE players ADD COLUMN perf_notes  TEXT NOT NULL DEFAULT '[]';       -- [{id, at, byId, by, text}]

ALTER TABLE teams   ADD COLUMN ingest_key  TEXT NOT NULL DEFAULT '';         -- bearer token for the Overwolf importer
