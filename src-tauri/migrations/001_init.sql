-- DeckLab initial schema.
--
-- `cards` is an incrementally-populated cache: rows land here whenever a card is
-- fetched from Scryfall, so local search only ever sees cards the user has met.
-- Scalar columns are denormalised out of the Scryfall payload so the query
-- compiler can filter on them; `data` keeps the untouched JSON for everything else.

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

-- Collections: paper, Arena, cube, loaned out, wishlist, ...
CREATE TABLE IF NOT EXISTS collections (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'paper',
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One row per (collection, printing, finish) so "2x Alpha, 1x Secret Lair"
-- stays representable rather than collapsing to a single count.
CREATE TABLE IF NOT EXISTS collection_items (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  card_id       TEXT NOT NULL REFERENCES cards (id),
  quantity      INTEGER NOT NULL DEFAULT 1,
  finish        TEXT NOT NULL DEFAULT 'nonfoil',
  condition     TEXT NOT NULL DEFAULT 'NM',
  notes         TEXT NOT NULL DEFAULT '',
  added_at      TEXT NOT NULL,
  UNIQUE (collection_id, card_id, finish, condition)
);

CREATE INDEX IF NOT EXISTS idx_items_collection ON collection_items (collection_id);
CREATE INDEX IF NOT EXISTS idx_items_card       ON collection_items (card_id);

CREATE TABLE IF NOT EXISTS decks (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  format     TEXT NOT NULL DEFAULT 'commander',
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- zone: 'commander' | 'main' | 'side' | 'maybe'
CREATE TABLE IF NOT EXISTS deck_cards (
  id       TEXT PRIMARY KEY,
  deck_id  TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  card_id  TEXT NOT NULL REFERENCES cards (id),
  quantity INTEGER NOT NULL DEFAULT 1,
  zone     TEXT NOT NULL DEFAULT 'main',
  added_at TEXT NOT NULL,
  UNIQUE (deck_id, card_id, zone)
);

CREATE INDEX IF NOT EXISTS idx_deck_cards_deck ON deck_cards (deck_id);
CREATE INDEX IF NOT EXISTS idx_deck_cards_card ON deck_cards (card_id);

-- User-defined tags, addressable from the query language as `tag:ramp`.
-- Keyed by oracle_id so a tag follows a card across every printing.
CREATE TABLE IF NOT EXISTS card_tags (
  oracle_id TEXT NOT NULL,
  tag       TEXT NOT NULL,
  PRIMARY KEY (oracle_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_card_tags_tag ON card_tags (tag);
