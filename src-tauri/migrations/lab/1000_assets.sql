-- The lab schema for the new model: assets, buckets, places, checklists,
-- pools, decklists, decks and arrangements. The lab's migration 1000
-- (`lab::migrations()`).
--
-- One schema behind library file version 5 (docs/library-format-5.md), whose
-- load and dump are written against it. The model is docs/inventory.md.
-- It sits beside today's tables (001–004), which the lab also runs and the
-- new model ignores.
--
-- Conventions:
--   * `absent` is '' (or '{}' for attributes), never NULL, wherever it is
--     part of a unique key: SQLite treats NULLs as distinct there.
--   * NULL means "not given" only outside keys: notes, timestamps.
--   * Assets refer to each other by id. A dump writes paths and elides ids;
--     a load assigns fresh ones. So a rename or move rewrites nothing.

-- ---------------------------------------------------------------- the tree

CREATE TABLE IF NOT EXISTS assets (
  id         TEXT PRIMARY KEY,
  -- NULL only for the root row, so UNIQUE (parent_id, name) below holds for
  -- every real asset, top level included.
  parent_id  TEXT REFERENCES assets (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  -- A node of the static ontology (src/lib/ontology.ts).
  type       TEXT NOT NULL CHECK (type IN (
               'folder', 'checklist', 'exact checklist', 'place', 'sum',
               'list pool', 'query pool', 'decklist', 'deck', 'arrangement')),
  notes      TEXT,
  created_at TEXT,
  updated_at TEXT,

  -- Per-type fields. A handful, so columns here rather than a table each;
  -- the CHECKs keep each to its type.
  storage    TEXT,                        -- place: binder, box, … (a note)
  query      TEXT,                        -- query pool
  format     TEXT,                        -- decklist

  -- Siblings are told apart by name, and have no order of their own: a
  -- custom order would be a view's, if ever. Also the index on parent_id.
  UNIQUE (parent_id, name),
  CHECK (id = 'root' OR (parent_id IS NOT NULL AND name <> '' AND name NOT IN ('.', '..'))),
  CHECK (storage IS NULL OR type = 'place'),
  CHECK ((query IS NOT NULL) = (type = 'query pool')),
  CHECK (format IS NULL OR type = 'decklist')
);

INSERT OR IGNORE INTO assets (id, parent_id, name, type)
VALUES ('root', NULL, '', 'folder');

-- ---------------------------------------------------------- references
-- One row per reference an asset makes: a checklist's `on`, a decklist's
-- or deck's zones and `shows`, a deck's `list`, an arrangement's `of`. docs/inventory.md → *Naming a set in a
-- query*.
--
--   pinned   (no `&`): target_id, which follows the asset anywhere.
--   by name  (`&`):    path, the text after `&`, resolved each time.
--
-- `rooted` is how the reference was written, which matters even when pinned:
-- a copied decklist's relative zones are the copy's own. A pinned reference whose
-- target is deleted keeps its row with both NULL: broken, shown as such.

CREATE TABLE IF NOT EXISTS asset_refs (
  asset_id  TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN (
              'on', 'shows', 'list', 'of', 'commander', 'main', 'side')),
  target_id TEXT REFERENCES assets (id) ON DELETE SET NULL,
  path      TEXT,
  rooted    INTEGER NOT NULL CHECK (rooted IN (0, 1)),
  facets    TEXT NOT NULL DEFAULT '',     -- 'arranged.by_mana', '' for none
  PRIMARY KEY (asset_id, role),
  CHECK (target_id IS NULL OR path IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_asset_refs_target ON asset_refs (target_id);

-- ---------------------------------------------------------- buckets
-- A bucket is a value, not a row: every table of lines below repeats its
-- four columns, and its identity is those four.
--
--   oracle_id    the card: required, the minimum grain
--   printing_id  Scryfall's printing id, '' when absent. No foreign key to
--                `cards`, which '' would fail; the working copy is filled
--                from the card store on load.
--   finish       '' when absent
--   attrs        user attributes as canonical JSON, keys sorted; '{}' when
--                none. Queried with json_extract.

CREATE TABLE IF NOT EXISTS attributes (
  name TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('condition', 'text', 'number', 'boolean'))
);

-- ---------------------------------------------------------- contents

-- Counted lines: a bucket and a count, which the asset's type reads. A
-- place holds exactly `qty` (copies known exactly this much about); a
-- checklist asks for at least `qty`; an exact checklist for exactly `qty`
-- and nothing unlisted. One table, so converting between them is a change
-- of type alone (docs/inventory.md → *Kinds of checklist*).
CREATE TABLE IF NOT EXISTS lines (
  asset_id    TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  oracle_id   TEXT NOT NULL,
  printing_id TEXT NOT NULL DEFAULT '',
  finish      TEXT NOT NULL DEFAULT '',
  attrs       TEXT NOT NULL DEFAULT '{}',
  qty         INTEGER NOT NULL CHECK (qty >= 1),
  added_at    TEXT,
  PRIMARY KEY (asset_id, oracle_id, printing_id, finish, attrs)
);

-- A list pool's members: membership, no count.
CREATE TABLE IF NOT EXISTS pool_members (
  asset_id    TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  oracle_id   TEXT NOT NULL,
  printing_id TEXT NOT NULL DEFAULT '',
  finish      TEXT NOT NULL DEFAULT '',
  attrs       TEXT NOT NULL DEFAULT '{}',
  added_at    TEXT,
  PRIMARY KEY (asset_id, oracle_id, printing_id, finish, attrs)
);

CREATE INDEX IF NOT EXISTS idx_lines_oracle        ON lines (oracle_id);
CREATE INDEX IF NOT EXISTS idx_pool_members_oracle ON pool_members (oracle_id);

-- ---------------------------------------------------------- arrangements

-- An arrangement's piles, in order: listed members, or a query.
CREATE TABLE IF NOT EXISTS piles (
  id             TEXT PRIMARY KEY,
  arrangement_id TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  name           TEXT NOT NULL,
  query          TEXT,                    -- NULL: the pile lists its members
  UNIQUE (arrangement_id, name)
);

CREATE TABLE IF NOT EXISTS pile_members (
  pile_id     TEXT NOT NULL REFERENCES piles (id) ON DELETE CASCADE,
  oracle_id   TEXT NOT NULL,
  printing_id TEXT NOT NULL DEFAULT '',
  finish      TEXT NOT NULL DEFAULT '',
  attrs       TEXT NOT NULL DEFAULT '{}',
  added_at    TEXT,
  PRIMARY KEY (pile_id, oracle_id, printing_id, finish, attrs)
);
