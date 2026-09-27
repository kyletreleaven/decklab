# 001 — Adding or removing a card doesn't update the collection grid

**Status:** open · cause found
**Reproduced:** symptom reported by user; steps below derived from reading code,
not yet run step by step

## Symptom

When the grid is showing a collection's own contents, writes to that collection
are not reflected in it. A newly added card does not appear. A card whose last
copy is removed does not disappear. Dimming elsewhere *does* update, which makes
the grid look like it's the odd one out.

## Repro

**A. Add (collection view)**
1. Open a collection, with the pool shown above it.
2. In the pool (All Magic), find a card that is not in the collection. Its tile is dimmed.
3. Press `+`.

**Observed:** the pool tile lights up, but the collection grid below does not
gain the card. **Expected:** the card appears in the grid.

**B. Remove last copy (collection view)**
1. Open a collection and find a card held as 1 copy.
2. Press `−` (or drop) on its tile in the collection grid.

**Observed:** the tile stays. **Expected:** it disappears.

**C. Deck pool narrowed to collection**
1. Open a deck, with the pool shown. Uncheck "Show not in <collection>".
2. Add a card to the active collection from elsewhere (search, card panel).

**Observed:** the pool does not gain it. **Expected:** it appears.

Any view change that refetches (edit the query, change sort, toggle) makes the
grid correct again. That is a quick check that it's this bug and not a failed write.

## Proof

No test yet: nothing covers React components (see `TODO.md` → *Known debt*).
To make it testable, move the fetch trigger (what re-runs the query, given
`drawn` and `refreshKey`) into a pure function in `src/lib/` and assert it
changes when `refreshKey` does and `drawn === "collection"`.

## Cause

`src/components/PoolPanel.tsx:483-492`. The fetch effect's deps omit
`refreshKey`, so a local (`drawn === "collection"`) grid is never re-queried after
a write. The comment calls this deliberate: "a write changes what you *hold*, not
which cards match". That held for the fg/bg pool, where the grid was the union
of both sides and a write only moved a card between them. `cae2f53` removed fg/bg
and wrote that comment at the same time. It is false for a local grid, whose
rows *are* what you hold. The comment just above it (line 480) still states the
original intent: "the mutation counter matters only while the list itself is local".

**Consequence, hypothesis:** the row `−` calls
`onSetItemQuantity(entry, entry.quantity - 1)` (`PoolPanel.tsx:595`) with the
frozen `entry`. Pressing `−` twice on a 4-copy item would write 3 both times,
leaving 3 rather than 2. The badge wouldn't show this because it reads
`destination.quantities`, which is fresh. Worth confirming during the repro.

## Fix

Not yet applied. Without fg/bg, the drawn set is only ever one of two things,
so the rule reduces to one case split:

| Drawn | Can a write change the rows? | So |
|---|---|---|
| All Magic, which contains every collection | no, only which are lit | no refetch; the dimming effect already subscribes |
| a collection | yes, the rows *are* its contents | refetch |

**Refetch on write iff `drawn === "collection"`.** In code, a single term
`drawn === "collection" ? refreshKey : 0` goes in both the effect deps and
`signature`. The remote branch sees a constant `0`, so it never re-searches.

It has to be in `signature` too, not just the deps: if a write happens while
the panel is unmounted, a remount would otherwise treat the retained rows as
current and skip the fetch. That would be the same bug on a different path
(hypothesis, follows from `restored` at line 399).

Scroll: a local refetch is cheap, so it can take `shown` rows rather than
`PAGE`. That keeps the grid the same length instead of snapping back to page one.
