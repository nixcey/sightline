-- Optional Discord role to @mention on every notification (snowflake id, digits only).

ALTER TABLE teams ADD COLUMN discord_role_id TEXT NOT NULL DEFAULT '';
