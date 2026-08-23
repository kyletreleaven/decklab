# Merging sorted sources

Why the card pool can merge a local collection with Scryfall results without
re-sorting anything, and what ordering the result is actually entitled to claim.

## The problem

Two paginated sources, each sorted — but not by the same key. The local side
orders by `<field> <dir>, name, id`, which is total. Scryfall orders by
`order=<field>&dir=<dir>`, breaking ties by rules of its own that we cannot set.

A textbook merge needs both inputs non-decreasing in the *comparison* key. These
are not.

## The result

> Let S1, S2 be sorted by their own total keys k1, k2. Merge them greedily by any
> total key k. If k1, k2 and k all refine a common coarsening k', the merged
> output is sorted by k'.

*Proof.* "k refines k'" means `k'(a) < k'(b) ⟹ k(a) < k(b)`; contrapositive,
`k(a) ≤ k(b) ⟹ k'(a) ≤ k'(b)`. Each stream sorted by its own ki is therefore
also sorted by k'.

Suppose the merge emits x, then later y, with `k'(y) < k'(x)`.

- **y from the same stream as x.** That stream is k'-sorted, so y coming after x
  gives `k'(y) ≥ k'(x)`. Contradiction.
- **y from the other stream.** When x was emitted, y's stream had some head h,
  and y sits at or after h, so `k'(h) ≤ k'(y)`. The merge chose x over h, so
  `k(x) ≤ k(h)`, hence `k'(x) ≤ k'(h)`. Chaining gives `k'(x) ≤ k'(y)`.
  Contradiction. ∎

## What follows

**No page re-sorting.** Merge greedily by the full local key and the output is
correctly ordered by whatever the two sides genuinely share.

**No duplicates, no drops** — but for a structural reason, not this theorem:
each element is emitted exactly once from its own stream.

**The merged stream needs no cursor.** It is re-derivable by paging each source
from *its* cursor and replaying the merge. Just as well, since k' is not total
and so could not carry one.

**The output may claim only k'.** Within a k' tie the order is whatever the merge
produced. That is not a guarantee we lost — Scryfall's tie order was never ours
to predict.

## How coarse is k' in practice?

The sort field alone is always safe: both sides sort by it by construction.

`(field, name)` would be much better — tie groups would read alphabetically
rather than scrambled — but it holds only if both sides agree on what
alphabetical *means*, and they do not. Sorting creatures by `cmc`, Scryfall
returns:

```
Aegis Turtle   then   A-Eiganjo Exemplar
```

which is out of order under `localeCompare`, out of order under SQLite's
byte-order default, and out of order under a naive punctuation-folding rule.
Scryfall is tiebreaking by name under a collation we have not identified.

So formally k' is the sort field alone, and equal-valued cards are entitled to
arrive in any order.

**The decision: merge greedily anyway, until the collation is reverse
engineered.** The formal guarantee
understates what actually happens. Scryfall *does* tiebreak by name — the two
sides simply disagree on collation — so within a tie group both streams are
already near-identically ordered, and merging them yields near-alphabetical
output. The defect is not scrambling; it is bounded by the collation
disagreement, which is punctuation. A handful of cards with apostrophes or
hyphens sit a position or two out of place, at the same magnitude as the plain
name sort's existing cross-source disagreement.

**Reverse engineering it is the real fix**, not a fallback. Adopting Scryfall's
alphabetical order raises k' to `(field, name)` *and* repairs the plain name
sort, which disagrees across sources for exactly this reason — so it is worth
doing on its own, not only when the tie order starts to grate.

The shape: a stored `sort_name` column ordered on directly, since SQLite cannot
be handed a collation from TypeScript. Getting there needs the rule identified
first, which is a focused exercise rather than guesswork — pull one page of a
tie-heavy sort, diff it against candidate normalisations, and keep the one that
survives. Known so far: it is not `localeCompare`, not SQLite byte order, and
not naive punctuation folding. `Aegis Turtle` before `A-Eiganjo Exemplar` says
the hyphen is not simply dropped either, since dropping it would sort `AEiganjo`
before `Aegis`.

## Later: explicit cursors instead of a generator

`mergeSorted` returns an `AsyncGenerator`, which is the clearest way to express
the greedy pick but the wrong thing to hand out as an interface. A generator
cannot be serialised or inspected, so panel retention — which restores rows but
not closures — has nothing to resume from, and re-entering a panel means
replaying the merge from the start.

The fix, when it matters:

```ts
interface MergeCursor<T> {
  sources: { nextPage: number | null; buffer: T[] }[];
}
```

`advance(cursor, n)` returns rows plus a new cursor. Per source you can see
which page is next and what is buffered, so a refetch is targeted rather than a
replay, and retention can store `{ rows, cursor }` and resume mid-scroll. The
generator stays as the algorithm underneath.

