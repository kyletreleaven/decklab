# 001 — Adding or removing a card doesn't update the collection grid

**Status:** fix applied, awaiting in-app repro
**Reproduced:** B confirmed fixed in app 2026-09-27, with no visible delay after
the debounce change; A and C not yet run

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

`src/lib/poolFetch.test.ts`, test "refetches a local grid, whose rows are the
collection's contents". This checks the trigger, not the rendered grid: nothing
covers React components yet. It fails when `fetchSignature` is given the old
rule (writes never refetch) and passes with the fix.

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

Applied, uncommitted. **Needs the repro above run in the app** before this can
be marked fixed.

Without fg/bg, the drawn set is only ever one of two things:

| Drawn | Can a write change the rows? | So |
|---|---|---|
| All Magic, which contains every collection | no, only which are lit | no refetch; the dimming effect already subscribes |
| a collection | yes, the rows *are* its contents | refetch |

- `src/lib/poolFetch.ts`: `fetchSignature` folds in
  `drawn === "collection" ? refreshKey : 0`. It is now both the retention
  signature and the fetch effect's **only** dependency, so the two can no
  longer drift apart. That also covers a write made while the panel is
  unmounted: the retained signature no longer matches, so it refetches.
- `PoolPanel.tsx`: the 350ms debounce now applies only when the filter
  changed, meaning typing. A write-triggered refetch ran through it too, which
  showed up as the delay on B.
- `PoolPanel.tsx`: a local refetch takes `max(shown, PAGE)` rows, so the grid
  keeps its length instead of snapping back to page one.

**Still open:** the row `−` computes from `entry.quantity`, which is stale
between a write and the refetch (the query round trip). Two quick
clicks can still write the same number twice. A proper fix would have the
stepper send a delta rather than an absolute quantity.
