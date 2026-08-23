# Card set types

A collection is a map from card to quantity. Which *kind* of quantity is not
decoration — it decides what the totals mean, whether a stepper makes sense, and
what an operation on two sets returns.

## The two kinds in play

| Kind | Quantity | Example |
| --- | --- | --- |
| **Natural** | ℕ — how many copies you hold | Paper, Cube, a deck |
| **Binary** | membership — matches or does not | a saved Scryfall search, All Magic |

The type follows the **source**, not the operation. A search over All Magic has
no counts to preserve, so it saves as binary. Filtering an existing natural
collection preserves its counts, so it stays natural.

## Encode binary as {0, ∞}, not {0, 1}

Present means *no constraint on how many*, absent means none. That single choice
makes the operation rules fall out instead of needing cases.

**Intersection is `min`, always:**

| | Result |
| --- | --- |
| natural ∩ natural | `min(m, n)` |
| binary ∩ natural | `min(∞, n)` = `n` — the natural one's type |
| binary ∩ binary | `∞` — still binary |

So a binary set acts as a **mask**: it filters without capping.

This is why quantity-1 is the wrong encoding for a saved search. Under `min`,
storing 1 would silently cut "I have three Sol Rings" down to one the first time
anyone intersected with it — a wrong number, arrived at quietly, from a value
that was only ever a placeholder.

It also makes All Magic ordinary rather than special: it is simply the maximal
binary set, the constant ∞, which is what the roadmap already assumed when it
called `Universe` a node in the model.

## Union is not settled

Both `max` and `sum` are wanted — `sum` for chop shop, where two decks each
holding a Sol Ring means two physical cards, and `max` for "what could I field",
where the same card in two decks is one card.

Neither extends cleanly to binary, because `max(∞, n)` and `sum(∞, n)` are both
∞: a union with a binary set discards counts.

That may well be right — the result of "cards matching this search, plus my
collection" is a candidate pool, not an inventory, and a pool has no business
claiming quantities. But unlike intersection it is a **decision**, not a
consequence of the encoding. Worth taking deliberately when a union of mixed
kinds is first needed.

## What it changes in the app

A binary collection should:

- report **unique** only — "1,750 cards, est. $4,000" is a claim about ownership
  that a search result cannot make;
- offer **add/remove**, not `− n +` — membership has one state, not many;
- behave identically for dimming and merging, which are membership questions
  already.

## Converting is destructive; interpreting is a derived set

A collection's type is a fact about it, not a lens over it. So **make binary**
discards quantities and says so — a confirmation naming what is lost, like any
other destructive edit. Going the other way is also a claim rather than a
recovery: every member becomes one copy, which is an assertion about ownership
the search never made.

The alternative — a flag that leaves quantities in place and merely stops
meaning them — was tempting because it makes the toggle reversible. It is worse.
It creates rows whose stored quantity *is not their quantity*, so every
operation has to consult the flag rather than the number, and the first one that
forgets caps real counts at a placeholder. A type that has to be remembered
everywhere is not a type.

The genuine want behind reversibility — *treat this collection as binary without
altering it* — is a *derived* set: a node that reads the collection and yields
membership. That composes with everything else in the algebra, leaves the
original untouched, and needs no flag at all. It belongs with the other derived
sets rather than as a special case here.

## Implementation

A `quantity_kind` column on `collections` (`'natural'` | `'binary'`), the panel
hiding quantity affordances when it is binary, and a confirmed conversion each
way. Quantities normalise to 1 on becoming binary — nothing is left lying around
to be misread later. The principled version is the
`{oracle, printing} × {binary, natural, integer}` typing in the roadmap's
card-set algebra, which needs the mixed-grain migration. The flag is worth having
first: writing 1 and calling it "unknown" is the kind of pretence that hardens,
and `min` is where it would first do damage.
