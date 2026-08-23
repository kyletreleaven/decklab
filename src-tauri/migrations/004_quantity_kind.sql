-- Whether a collection's quantities mean anything.
--
-- 'natural' — quantities are counts of copies you hold. Paper, a cube, a binder.
-- 'binary'  — membership only. A saved search says "this card matched", not
--             "you own one of each", and its rows carry 1 as a placeholder.
--
-- The distinction is load-bearing rather than cosmetic: intersection is `min`,
-- so treating a binary set's placeholder as a real count would silently cap
-- "three Sol Rings" at one. See docs/card-set-types.md.
--
-- Additive with a default, so nothing is rewritten. Existing collections are
-- natural, which is what they already are.
--
-- Note this is *independent* of grain (oracle vs printing), which is a property
-- of an item rather than of a collection and arrives with mixed-grain storage.

ALTER TABLE collections
  ADD COLUMN quantity_kind TEXT NOT NULL DEFAULT 'natural';
