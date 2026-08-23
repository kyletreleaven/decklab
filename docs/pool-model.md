# A model layer for the pool

> **Superseded in part.** This solves the invalidation problem created by
> rendering a *union* of two sets. See
> [`two-designs.md`](two-designs.md) — under the one-set-per-pane design there is
> nothing to invalidate across sources, so none of this is required. Kept for
> when a model layer is wanted on its own merits, which the card-set algebra
> will likely want.

Panels are viewports onto a shared model — the framing this project started
with. Today they are not: each panel holds the model in `useState`, and the
afternoon that produced this note was spent on bugs where three copies of one
fact disagreed.

## What went wrong without one

The panel answered "what does the foreground hold" from three places: a row's
frozen `item.quantity`, an oracle-id set used for dimming, and a printing-keyed
quantity map used by the controls. Each write desynchronised them differently:

- a card could be **lit but offering `+`** — oracle set updated, printing map not;
- `×` could address an **entry already deleted**, so the click did nothing;
- a background collection's entries were treated as the **foreground's**, because
  rows recorded what they were but not where they came from.

Each was fixed in isolation, which is the signature of a modelling error rather
than a collection of bugs.

## The shape

A layer owning the domain, taking commands and returning view state:

```
commands   addCard(setId, card) · removeCard(setId, card)
           move(card, fromSetId, toSetId)
           setForeground(id) · setBackground(id) · setQuery(q) · setSort(k)

query      poolView(panelId) → { rows, controls, dimming, totals, loading }
```

Components render `rows` and call commands. Nothing in React holds a fact the
database also holds.

## Why commands rather than deltas

A command carries **intent**, and intent is what tells you the blast radius.
`move(card, fg, bg)` is union-preserving *by construction* — no membership test
needed, because moving a card between two sets that are both drawn cannot change
their union. By the time that reaches the database it is two writes and the
knowledge is gone; by the time it reaches a `bump()` counter there is nothing
left but a number.

| Command | Invalidates |
| --- | --- |
| `move` between two drawn sets | dimming only — union unchanged by construction |
| `addCard` / `removeCard` | dimming; **and** rows iff no other source contains it |
| query, sort or source change | rows — re-page |

Only the middle row needs a test, and only when the answer is not already known.

## `contains`, and why it is not a special case

Each source gains one operation beside its stream:

```ts
contains(card): boolean | undefined   // undefined = cannot say cheaply
```

- **All Magic** → always `true`.
- **A collection** (or a saved static search) → a map lookup.
- **A live query** → `undefined`; answering means asking Scryfall, so refetch.

Union-change detection is then one rule with no cases: *adding or removing a
card changes the union iff no other source contains it, and an `undefined`
answer means refetch.* All Magic stops being special — it is simply the source
whose `contains` is trivially true.

This also completes the source abstraction that `merge.ts` half-built: a source
can be paged, or asked about a card. The merge wants both.

## Why not a caching library

TanStack Query and friends are key-based caches with explicit invalidation, not
event systems — components see snapshots, never events. `invalidateQueries` is
per-entity versioning, which is too coarse here: it says *this collection
changed*, not *your union changed*, so the `contains` test would still be ours
to write.

They would retire `panelState.ts` (a hand-rolled query cache) and bring
stale-while-revalidate for free. They would not touch the paged merge over two
differently-ordered sources, nor the scheduler, which knows about a client-wide
rate limit a generic cache does not. Worth revisiting if `panelState` starts
growing subscriptions or staleness — that is the signal we are finishing a
reimplementation.

## Doing it incrementally

Not in one pass. The pool's view state first: it is where the pain is,
it is self-contained, and most of the pieces are already outside React —
`merge.ts` (paging and ordering), `stepper.ts` (the control decision),
`panelState.ts` (retention). Assembling those behind one API is a smaller step
than it looks.

The test that matters: today the *decision* is covered and the *binding* is not,
and every bug this afternoon was in the binding. A model layer is testable
without rendering anything.
