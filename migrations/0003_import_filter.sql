-- Only auto-import customs that are actually scrims: require N players with the
-- team's in-game name prefix on one side.

ALTER TABLE teams ADD COLUMN import_prefix TEXT NOT NULL DEFAULT '';  -- '' -> falls back to the team tag
ALTER TABLE teams ADD COLUMN import_min    INTEGER NOT NULL DEFAULT 3;
