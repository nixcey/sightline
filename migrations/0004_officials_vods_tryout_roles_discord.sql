-- Officials (tournament matches) vs scrims, VOD links, multi-role tryouts,
-- Discord webhook notifications.

ALTER TABLE scrims  ADD COLUMN kind TEXT NOT NULL DEFAULT 'scrim';   -- 'scrim' | 'official'
ALTER TABLE scrims  ADD COLUMN vods TEXT NOT NULL DEFAULT '[]';      -- [url, ...]

ALTER TABLE tryouts ADD COLUMN roles TEXT NOT NULL DEFAULT '[]';     -- ["Duelist","Sentinel", ...]
UPDATE tryouts SET roles = json_array(role) WHERE role IS NOT NULL AND role <> '' AND roles = '[]';

ALTER TABLE teams   ADD COLUMN discord_webhook TEXT NOT NULL DEFAULT '';
