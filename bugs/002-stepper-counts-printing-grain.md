# 002 — Pool tile shows 0 for a card held in another printing

**Status:** open · known (moved here from `TODO.md` → *Reconcile printings*)
**Reproduced:** per TODO.md; not re-run for this report

## Symptom

A pool tile's badge and `−` read `0` / disabled for a card that is in the
destination, whenever the destination holds a different printing from the one
Scryfall's `unique=cards` returned for the tile. Dimming is correct, since it's
oracle-keyed, which is why the disagreement is easy to miss.

## Repro

1. Put a specific printing of a card into a deck, e.g. via import, choosing a
   printing that is not Scryfall's default.
2. Open that deck with the pool shown (All Magic).
3. Find the card in the pool, without picking a printing for it in the card panel.

**Observed:** badge `0`, `−` disabled. **Expected:** the deck's count, with `−` enabled.

## Proof

None yet. `stepper.ts` is tested, but the lookup that feeds it is not. A pure
"count for this card at oracle grain" helper would be testable directly.

## Cause

`src/components/PoolPanel.tsx:578`, where `destination.quantities[row.card.id]`
does its lookup. `quantities` is keyed by printing id, and an oracle-grain row
carries whatever printing the stream returned.

## Fix

Not started. TODO.md's resolution (1): roll counts up to oracle grain for
display, keep printing grain for writes. Resolution (2), substituting the held
printing into the tile, also fixes which printing `+` writes.
