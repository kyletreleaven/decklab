# Two designs for the pool

Written after a day in which the second was built, hit a run of bugs, and
prompted the first to be reconsidered. They are different models, not
refinements of each other, and the choice decides how much machinery is needed.

## A — one set drawn per pane

| Pane | Draws |
| --- | --- |
| Collection view | that collection |
| Deck-building pool | the collection, **or** All Magic with cards *not* in the collection dimmed — toggleable |
| Collection-building pool | All Magic |

Lit means *in your collection*; dimmed means the rest. The asymmetry between the
two pools is the point: a deck pool can narrow to what you own, because decks are
built from your cards. A collection pool does not, because you are *recording*
what you own, so All Magic is the source.

In every case exactly **one** set is drawn. All Magic contains the collection, so
"with the rest dimmed" is still a single source — no merge, no row provenance, no
membership spread across sources.

This is what the app did before today.

## B — a union of foreground and background

Panes draw `foreground ∪ background` and light the foreground. Two settable
slots, and cards in your set that the drawn set lacks appear too.

It needs, in order:

- a **k-way merge** over two independently paged sources
- a **total sort key**, so ties cannot straddle a page boundary
- **provenance** on every row, since two collections both yield entries
- **cross-source membership**, since "is it lit" and "is it in the destination"
  come apart
- **union-change detection**, so a write does not needlessly re-page — which
  wants `contains(card)` per source and a command layer to carry intent

Each of today's bugs came from that list:

- a card **lit but offering `+`** — two membership sources disagreeing
- `×` addressing an **entry already deleted**, so the click did nothing
- a background collection's entries treated as the **foreground's**, because
  rows recorded what they were but not where they came from
- a write **re-paging the merge**, rebuilding the grid to learn nothing

## What B buys

Only one thing: cards in your set that the drawn set lacks become visible. And
those were already decided to render *indistinguishably* from everything else, so
the gain is their presence, not any information about them.

No journey on file needs it:

- **Trade binder** wants Dave's binder drawn, lit by mine — one set drawn. A
  union would also draw my cards Dave lacks, which is not the question.
- **Chop shop** materialises its union into a collection first, then draws that.
- **Add to Paper from Cube** is Cube in the pool, Paper below.

## Cost of choosing A

Little, and nothing gets deleted. `merge.ts` and its tests stay — correct,
tested, and waiting for set operations, which will need to render a union of two
sets where neither contains the other. `stepper.ts` is unaffected; its two-input
rule holds either way. The `foreground`/`background` pair collapses back to
`activeCollection`.

`docs/pool-model.md` — a command layer with `contains` and intent-carrying
transactions — is a solution to B's invalidation problem. Under A there is
nothing to invalidate across sources, so it stops being necessary. Keep it for
when a model layer is wanted on its own merits, which is likely when the algebra
lands.

## Summary

B is more general, and cost a day of bugs to make visible a region of the display
nobody asked to distinguish. A covers every journey with one drawn set per pane.
Take A now; the union machinery is built and waiting for the case that genuinely
needs it.
