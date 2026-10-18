# 004 — A legendary Spacecraft commander is flagged "cannot be a commander"

**Status:** open · cause found
**Reproduced:** not yet — derived from reading code, and from the fix already
made in `cmdr`'s copy of `deckstats.ts`

## Symptom

Setting a legendary non-creature card with printed power and toughness as
commander — *Inspirit, Flagship Vessel*, a Spacecraft — shows the error
"Inspirit, Flagship Vessel cannot be a commander." Commander rules allow it.

## Repro

1. Create a Commander deck.
2. Add *Inspirit, Flagship Vessel* and set it as commander.

**Observed (expected from the code):** the deck's issues list says it cannot be
a commander. **Expected:** no issue.

## Proof

Testable in `src/lib/deckstats.test.ts`: `commanderIssues()` over a single
commander entry whose `typeLine` is legendary but not a creature and whose
`power`/`toughness` are set, expecting no "cannot be a commander" issue.

## Cause

`src/lib/deckstats.ts:157` — `isLegendaryCreature` requires `Creature` in the
type line, and the only other way through is "can be your commander" in the
oracle text. A Spacecraft is neither.

`cmdr` (`../commander/ts/src/lib/deckstats.ts`) has the fix: a legendary card
qualifies if it is a creature *or* has printed power and toughness. Its copy of
this file is meant to be verbatim, so the fix should have flowed back — see
[`docs/cmdr.md`](../docs/cmdr.md) → *Shared logic, not copies*.

## Fix

Blank until fixed.
