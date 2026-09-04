-- Fixed-window rate-limit counters (login brute-force, import flood, invite abuse).
-- Not team-scoped; rows are disposable and pruned opportunistically.

CREATE TABLE rate_limits (
  bucket     TEXT PRIMARY KEY,   -- "<action>:<ip-or-key>"
  count      INTEGER NOT NULL,
  window_at  INTEGER NOT NULL    -- window start (epoch ms)
);
CREATE INDEX idx_rate_limits_window ON rate_limits(window_at);
