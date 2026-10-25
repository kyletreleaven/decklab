-- The card store: `card-cache.db`, one file shared by every mode.
--
-- Scryfall's data, kept apart from the user's (docs/card-fetching.md → *The
-- card store*). `cards` and `oracle_fetches` are copied verbatim from the user
-- schema (001, 003), so a store started from a copy of `decklab.db` already
-- has them and only gains `default_printings`.

CREATE TABLE IF NOT EXISTS cards (
  id               TEXT PRIMARY KEY,          -- Scryfall printing id (uuid)
  oracle_id        TEXT NOT NULL,             -- stable across printings
  name             TEXT NOT NULL,
  set_code         TEXT NOT NULL,
  set_name         TEXT NOT NULL,
  collector_number TEXT NOT NULL,
  released_at      TEXT,
  rarity           TEXT NOT NULL,
  layout           TEXT NOT NULL,
  mana_cost        TEXT,
  cmc              REAL NOT NULL DEFAULT 0,
  type_line        TEXT NOT NULL DEFAULT '',
  oracle_text      TEXT NOT NULL DEFAULT '',
  power            TEXT,
  toughness        TEXT,
  loyalty          TEXT,
  -- Colour sets are stored as sorted letters ('BG', 'WUBRG') for cheap
  -- subset/superset matching in the query compiler.
  colors           TEXT NOT NULL DEFAULT '',
  color_identity   TEXT NOT NULL DEFAULT '',
  keywords         TEXT NOT NULL DEFAULT '',  -- JSON array
  legalities       TEXT NOT NULL DEFAULT '{}',-- JSON object
  prices           TEXT NOT NULL DEFAULT '{}',-- JSON object
  image_small      TEXT,
  image_normal     TEXT,
  image_art_crop   TEXT,
  edhrec_rank      INTEGER,
  reserved         INTEGER NOT NULL DEFAULT 0,
  digital          INTEGER NOT NULL DEFAULT 0,
  data             TEXT NOT NULL,             -- full Scryfall JSON
  cached_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_name        ON cards (name);
CREATE INDEX IF NOT EXISTS idx_cards_oracle_id   ON cards (oracle_id);
CREATE INDEX IF NOT EXISTS idx_cards_cmc         ON cards (cmc);
CREATE INDEX IF NOT EXISTS idx_cards_set         ON cards (set_code);
CREATE INDEX IF NOT EXISTS idx_cards_color_ident ON cards (color_identity);

-- That a card's *complete* print run has been fetched, and when.
CREATE TABLE IF NOT EXISTS oracle_fetches (
  oracle_id            TEXT PRIMARY KEY,
  printings_fetched_at TEXT NOT NULL
);

-- The printing Scryfall last gave *as the card*, when asked for it without
-- naming a printing: a name lookup, or a `unique=cards` search. A bare name
-- never named a printing, so this is what answers one from the store.
CREATE TABLE IF NOT EXISTS default_printings (
  oracle_id   TEXT PRIMARY KEY,
  printing_id TEXT NOT NULL,
  seen_at     TEXT NOT NULL
);
