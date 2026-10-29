# 007 — The detail's image flashes while moving through the printing picker

**Status:** open · the jump fix applied, awaiting in-app repro; flash and requests not yet
**Reproduced:** reported by the user, 2026-10-29 ("the card pane flashes
occasionally while using the printing combo box", the one under the
carousel); not reproduced here. Request volume not yet measured.

## Symptom
In the card detail, with the printing picker (▾ under the carousel) open,
moving the highlight through printings now and then blanks the image to
the card's name for a moment before the printing's image appears. The pane's
geometry changes with it: what is below the image jumps up, then back
(user, 2026-10-29: "geometry changes also"; "it's very fast so it's hard to
say" — fast fits an image already on disk).
Expected: the image changes from one printing to the next without a gap.

## Repro
1. Select a card with many printings (Sol Ring, Lightning Bolt).
2. Open ▾ under the carousel; move the highlight down the list, by pointer
   or arrow keys.
**Observed:** the image blanks to the name on some printings. **Expected:**
no blank.

## Proof
No test: the flash is one render of the placeholder between two images,
and the components have no tests. A unit test could assert `CardImage`
keeps drawing the previous image until the new one resolves.

## Cause
From reading code; not confirmed in the app.

- **The flash.** `CardDetail.tsx` previews the highlighted printing
  (`onFocus` → `setPreviewId`), and draws it with `<CardImage key={shown.id}>`:
  a new image per printing. `CardImage` starts from `imageUrl()`, which only
  knows images resolved *this session*; anything else — on disk or not —
  draws the name placeholder until `ensureCached` resolves (a disk lookup,
  or a download). So a printing not yet seen this session blanks.
- **The jump.** The placeholder is `<div className="placeholder">`: it does
  not take `className` (`art`), so `.detail img.art`'s `aspect-ratio: 488 /
  680` does not hold it open, and `.placeholder` is styled only inside a
  `.card-tile`. In the detail it collapses to a line of text.
- **The requests.** Every highlight calls `ensureCached`, which downloads an
  image not on disk — through `scheduledCall`, background lane, so rate
  limited, but nothing is cancelled when the highlight moves on. Running
  down 30 printings queues up to 30 image downloads: one gesture sending
  far more than a handful (*Traps* → *Request volume nobody counted*).

## Fix
Applied, not yet committed:
- **The jump.** `CardImage`'s placeholder takes `className`; `.detail .art`
  (was `.detail img.art`) holds the card's aspect ratio for both, so the
  box is card-sized whatever is in it.

Proposed, not applied:
- `CardImage` keeps drawing the image it has until the new one resolves,
  instead of falling back to the placeholder; the placeholder only when
  it has never had one.
- The picker previews a printing only once the highlight rests on it
  (~250 ms); passing over one sends nothing.
- Then count, on real data: requests sent by running down a long list.
