-- Records that a card's *complete* print run has been fetched.
--
-- The `cards` table already persists every printing we have seen, but not the
-- knowledge that we have seen them all. Without that, a restart cannot tell
-- "three printings because that is all there are" from "three printings because
-- that is all we happened to meet", and has to refetch to be sure.
--
-- Separate from `cards` because it is a fact about a *fetch*, not about a card:
-- it applies to an oracle id that may have any number of rows, including none.

CREATE TABLE IF NOT EXISTS oracle_fetches (
  oracle_id            TEXT PRIMARY KEY,
  printings_fetched_at TEXT NOT NULL
);
