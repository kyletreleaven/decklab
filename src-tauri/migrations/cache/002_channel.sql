-- The channel to Scryfall, shared by every DeckLab process that opens the
-- store: one pace, one pause (docs/card-fetching.md → *One channel across
-- processes*). One row. Times are milliseconds since the epoch.

CREATE TABLE IF NOT EXISTS channel (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  last_slot_at   INTEGER NOT NULL DEFAULT 0,   -- when the last claimed request may start
  paused_until   INTEGER NOT NULL DEFAULT 0,   -- set from Retry-After by a 429
  interval_ms    INTEGER NOT NULL DEFAULT 100, -- the pace; a 429 doubles it
  last_change_at INTEGER NOT NULL DEFAULT 0    -- the last 429, or the last easing step
);

INSERT OR IGNORE INTO channel (id) VALUES (1);
