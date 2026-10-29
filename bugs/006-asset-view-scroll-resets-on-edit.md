# 006 — An asset view jumps back to the top when a tile's button is pressed

**Status:** fix applied, awaiting in-app repro
**Reproduced:** reported by the user, 2026-10-29; not reproduced here — cause derived from reading code

## Symptom
In the lab, with an asset open and a target set, pressing a tile's button
(`+`, `−`, `×`, `→`, `←`) scrolls the view back to the top. Expected: the
view stays where it was, the counts change in place.

## Repro
1. `npm run lab`. Right-click a checklist or place → *Set as target*.
2. Open the same asset (or another one), scroll down past the first screen.
3. Hover a tile, press `+`.
**Observed:** the view is back at the top. **Expected:** it stays put.

## Proof
No test: the view has no component tests, and the loss is of scroll
position, which jsdom does not lay out. What would make it testable: a
component test asserting `sections` is never null between two loads of the
same asset.

## Cause
Hypothesis, from `src/components/AssetView.tsx`, the load effect: it ran on
`refreshKey` (bumped by every edit to the target) exactly as on opening a new
asset — `setSections(null)` and `setShown({})` first. `null` draws
*Loading…* in place of the tiles, so the scroll area empties and its scroll
position is lost; `setShown({})` also folds any *Show more* back to the
first page.

A trap of its own: **a refresh is not a reopen.** Reset what is about the
asset when the asset changes; when only the data changes, keep drawing the
old until the new arrives.

## Fix
The effect resets (sections, error, *Show more*) only when the asset itself
changes — its id or type — and otherwise swaps the new sections in over the
old. Not yet committed.
