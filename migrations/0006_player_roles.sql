-- Roster players get multi-role (tick all that apply), like tryouts.
-- `role` stays as roles[0] for old callers / sorting.

ALTER TABLE players ADD COLUMN roles TEXT NOT NULL DEFAULT '[]';
UPDATE players SET roles = json_array(role) WHERE role IS NOT NULL AND role <> '' AND roles = '[]';
