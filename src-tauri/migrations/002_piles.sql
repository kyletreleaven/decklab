-- User-arranged piles for the deck piles view.
--
-- Piles are per-deck columns the user drags cards between. A deck_card with a
-- NULL pile_id has not been sorted yet and shows up in the "Unsorted" column,
-- which is virtual rather than a real row so a fresh deck needs no setup.

CREATE TABLE IF NOT EXISTS deck_piles (
  id       TEXT PRIMARY KEY,
  deck_id  TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_deck_piles_deck ON deck_piles (deck_id, position);

ALTER TABLE deck_cards ADD COLUMN pile_id TEXT;

CREATE INDEX IF NOT EXISTS idx_deck_cards_pile ON deck_cards (pile_id);
