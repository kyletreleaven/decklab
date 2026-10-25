-- Every 429 Scryfall has sent us, with the rate at the time: the evidence the
-- pace learns from, and what a bug report about one should quote
-- (docs/card-fetching.md → *One channel across processes*).

-- The slot before the last, so the gap between them — the present rate — is
-- known when a 429 arrives.
ALTER TABLE channel ADD COLUMN prev_slot_at INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS rate_limits (
  at          INTEGER NOT NULL, -- ms since the epoch
  process     TEXT NOT NULL,    -- 'app' or 'lab'
  lane        TEXT NOT NULL,    -- 'interactive' or 'background'
  endpoint    TEXT NOT NULL,    -- host and path, no query: api.scryfall.com/cards/collection
  retry_after TEXT,             -- the header as sent
  interval_ms INTEGER NOT NULL, -- the pace configured at the time
  gap_ms      INTEGER NOT NULL  -- the actual gap before the request that drew it
);
