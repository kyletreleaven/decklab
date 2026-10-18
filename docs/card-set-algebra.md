# Card-set algebra — the document model

The thing panels are views *of*. Maya and Blender give you many viewports onto one
shared model; here the model is not a mesh but a **graph of card-set
specifications**. Design only — nothing here is built. Open work is in
[`TODO.md`](../TODO.md) → *Card-set algebra*.

Quantity kinds and how operations combine them —
[`card-set-types.md`](card-set-types.md). A model layer for the pool,
taking commands and returning view state —
[`pool-model.md`](pool-model.md).

## Prior art next door

`cmdr`'s `.decklab` language (`../commander`) reached
much of this independently — ω sets are binary-as-∞, `min` filters, determinacy
is laziness, per-branch pushdown — and is built and tested. It also answers two
of the open questions below (multisets throughout; `max` as union) and adds
what this design lacks: card-first tags in general and deck scopes, candidates
versus decisions. It is entirely oracle grain, so the richer grains are ours —
and every DeckLab collection must coerce to oracle grain, which is what makes
`cmdr`'s vocabulary apply to our data. Its open definitions are *not* wanted
here: DeckLab has mutable, lockable collections of basic types (explicit,
filter application, …) plus combinators, and "a query topped up by hand" is
just a union of the first two. Read [`cmdr.md`](cmdr.md) before
designing further.

## Nodes

A node denotes a (multi)set of cards:

**A spec is a function `card → quantity`,** with quantities in ℕ ∪ {∞}. Every
combining operation is then *pointwise arithmetic* on those functions, which is
why the operator list is open-ended rather than fixed at the usual four.

Sources:

| Node | Meaning |
| --- | --- |
| `Literal` | an enumerated list with quantities — a decklist, a collection, an import result. **Editable.** |
| `Empty` | constant `0`. Identity for `Sum` and `Max` |
| `Universe@g` | constant `∞` at grain `g` — every oracle card, or every printing. Identity for `Min`. Never materialised |

Pointwise binary operators:

| Node | Value | Reads as |
| --- | --- | --- |
| `Max(a, b)` | `max(a, b)` | copies needed to field both **at once** (cards shared between decks) |
| `Sum(a, b)` | `a + b` | total copies consumed building both **separately** |
| `Min(a, b)` | `min(a, b)` | overlap — what two lists have in common |
| `Diff(a, b)` | `max(0, a − b)` | still needed / not in the collection |
| `Sub(a, b)` | `a − b` | signed change — the deck-diff representation (see types below) |

Pointwise unary operators:

| Node | Value | Reads as |
| --- | --- | --- |
| `Clamp(a, n)` | `min(a, n)` | copy limits — `n=1` singleton, `n=4` constructed |
| `Scale(a, k)` | `a × k` | k copies of a whole list |
| `Mul(a, b)` | `a × b` | **this is filtering** — when `b` is binary it masks `a` |
| `Project(a, grain)` | regroup | collapse printings to oracle cards, or expand back out |

## Types

**Node types: `{grain, quantity}`**, i.e. `{oracle, printing} × {binary, natural, integer}`.

A spec is a function `element → quantity`, so the two axes are just its input and
output sides. (Avoid "domain" for the second axis — the grain *is* the domain;
`binary`/`natural`/`integer` is the codomain. "Quantity" says it plainly.)

`grain` — what counts as one element:

| Grain | Element |
| --- | --- |
| `oracle` | the card, printing-agnostic. What legality and deck rules care about |
| `printing` | a specific printing. What a binder cares about |

`quantity` — what a card can map to:

| Quantity | Values | Used for |
| --- | --- | --- |
| `binary` | `{0, 1}` | membership: predicates, legality masks, search results as sets |
| `natural` | `ℕ ∪ {∞}` | inventories: decks, collections |
| `integer` | `ℤ` | signed change: `+2 Fatal Push / −2 Cut Down` |

**Boolean algebra is just the binary case** — at `binary`, `Max` is OR, `Min` is
AND, `Diff` is AND-NOT, and complement is `1 − a`. So we get set operations for
free rather than as a separate feature.

Operator typing:

| Operator | Signature |
| --- | --- |
| `Max`, `Min` | `T × T → T` at any quantity |
| `Sum` | `binary × binary → natural` (1+1 escapes binary); otherwise `T × T → T` |
| `Diff` (monus) | `natural × natural → natural` |
| `Sub` | `natural × natural → integer` |
| `Clamp(a, n)` | `natural → natural`; `Clamp(a, 1)` is the coercion to `binary` |
| `Scale(a, k)` | preserves quantity for `k ∈ ℕ`; widens to `integer` for `k < 0` |
| `Not(a)` | `binary → binary` |
| `Mul(a, p)` | `p` must be `binary`; result keeps `a`'s quantity |

## Predicates have a grain

**Predicates have a grain as well**, because card properties do:

| Grain | Properties |
| --- | --- |
| `oracle` | type line, oracle text, mana cost, mana value, colour identity, legality |
| `printing` | set, collector number, rarity, artist, frame, border, promo type, finish, language, price |

So "is a red creature" is oracle-level, while "is mythic in MH2" is
printing-level — and moving a predicate between grains **changes which set you
get**. Grain conversion therefore carries an *aggregation*, not just a target:

- `ToOracle(a, agg)` — printing → oracle.
  At `binary`, `agg` is a quantifier and the choice is load-bearing:
  - `any` (∃) — "has **a** mythic printing"
  - `all` (∀) — "**every** printing is mythic"

  At `natural`, `agg` is `sum` (total copies across printings), or `max` / `min`
  where that reads better.

- `ToPrintings(a)` — oracle → printing. Unambiguous at `binary`: all printings of
  each matching card. At `natural` there is no principled way to distribute *n*
  copies across printings, so it stays a type error rather than a guess.

**Round-tripping is not the identity.** `ToPrintings(ToOracle(a, any)) ⊇ a` — the
trip out and back widens a specific set of printings into *all* printings of
those cards. Useful (it is exactly "show me every version of what I own"), but it
must not be mistaken for a no-op, and the UI should not offer it as one.

## Collections are mixed-grain, and that is fine

Real collections know some
cards exactly and others only vaguely: *"I have this specific foil printing of X,
plus two more copies from bulk that I have not sorted."* Both facts are true and
both are worth storing.

Do **not** model this as a mixed-grain spec — that would break the typing.
Instead, a `Collection` *entity* holds **two** specs:

| Spec | Grain | Holds |
| --- | --- | --- |
| `known` | `printing` | copies whose printing is identified |
| `unsorted` | `oracle` | copies known only by card |

Then the questions have clean answers:

- *How many X do I own?* → `Sum(ToOracle(known, sum), unsorted)` at oracle grain
- *Do I own this exact printing?* → read `known` alone
- *What is my collection worth?* → priceable only over `known`; `unsorted` needs a
  cheapest-printing or average assumption, and should say which

This is why entities are a layer above specs rather than being specs themselves:
one collection, several specs.

What this needs in storage — a nullable `card_id`, import that stops
fabricating printings, an "unknown printing" slot in the carousel — is
the bucket schema, under *Data model* in [`TODO.md`](../TODO.md), and
[`inventory.md`](inventory.md).

## Grain polymorphism, and inferring it

A predicate is not tied to one grain; it
is valid at whichever grains its *properties* support, and that is inferable from
how it was built:

| Built from | Valid at | Why |
| --- | --- | --- |
| oracle properties only | `{oracle, printing}` | oracle properties are constant across a card's printings, so they lift **down** for free |
| any printing property | `{printing}` | printing properties vary between printings, so they cannot lift **up** without a quantifier |

Composition takes the intersection:

- `t:creature c:r` → valid at `{oracle, printing}`
- `set:mh2` → valid at `{printing}`
- `t:creature set:mh2` → valid at `{printing}` only

The payoff is that **the grain is usually invisible**. The app picks it, and only
has to ask the user anything when a printing-level predicate is used where an
oracle-level answer is wanted — at which point the question is a real one
("*any* mythic printing, or *every* printing mythic?") rather than bookkeeping.

This also means a saved predicate stays usable in both worlds where it can be:
"within my commander's colour identity" is oracle-built, so it filters a decklist
and a binder alike without being written twice.

**What the types buy.** You cannot intersect a printing-grained binder with an
oracle-grained decklist without saying which you meant — the type error surfaces
exactly the any-printing-or-this-printing ambiguity that would otherwise silently produce a
wrong number. And because `Filter` predicates are themselves binary nodes,
"legal in Commander" or "within my commander's identity" become reusable,
storable, composable specs rather than hardcoded checks.

## Derived values, and predicates parameterised by them

`colorIdentity(commander(deck))`
is not a spec — it is a *scalar* read out of one, then used to build a predicate.
So two kinds of value flow through the graph:

1. **Specs** — `card → quantity`, everything above
2. **Values** — scalars read out of specs: colour sets, counts, formats, prices

with three kinds of edge between them:

| Kind | Signature | Examples |
| --- | --- | --- |
| Zone / sub-selection | `spec → spec` | `commander(deck)`, `zone(deck, main)` |
| Reduction | `spec → value` | `colorIdentity`, `count`, `format`, `totalPrice` |
| Predicate constructor | `value → binary spec` | `withinIdentity(cs)`, `legalIn(fmt)`, `mvAtMost(n)` |

This is what makes the Arena-style pool a *definition* rather than special-cased
code:

```
pool = Selected
     × legalIn(format(deck))
     × withinIdentity(colorIdentity(commander(deck)))
```

Change the commander and the pool re-filters, because the dependency is in the
graph. The same machinery gives "cards that fit any of my decks", "under £5 and
legal here", and so on.

**This is now a small language, and that is the risk.** The mitigation is to keep
the vocabulary **closed** for v1 — a fixed set of reductions and predicate
constructors, each surfaced as a UI affordance ("scope pool to this deck" is a
checkbox that builds the expression above) rather than something typed by hand.
A general expression language stays possible later; designing the value types now
means it can be layered on rather than retrofitted.

Two consequences to design for:

- **Dependency tracking.** A pool derived from a deck must invalidate when the
  deck changes. Same propagation the panels need, one level deeper.
- **Cycles must be forbidden** in the spec graph. A pool derived from a deck that
  the user then edits *from* that pool is fine — an edit is a user action, not a
  dataflow edge — but a spec depending on itself is not.

Two more things fall out that are worth keeping:

- **`Universe` must be `∞`, not `1`.** Otherwise `Min(deck, Universe)` would cap
  every entry at one copy instead of leaving the deck untouched. So `natural`
  needs ∞, and `Mul(Universe, p)` is `∞` wherever the predicate holds.
- **Filtering and combining are the same kind of operation**, so the compiler has
  one thing to optimise rather than two.

## Three decisions determine everything downstream

These need answering before any code:

1. **Multiset or set?** Decks and collections carry quantities. "What am I
   missing" is only `deck − collection` under *multiset* semantics
   (`max(0, a−b)`), with intersection as `min(a, b)`. Proposal: multisets
   throughout, with an explicit `dedupe` when plain set semantics is wanted.

2. ~~What is an element — a printing or a card?~~ **Resolved:** grain is part of
   the node's *type*, not a per-operation parameter, and conversion between
   grains is an explicit node. See the type table above.

3. **Laziness.** `Universe` is ~500k printings and conceptually open-ended; it
   cannot be materialised. Nodes stay symbolic and compile to a query,
   materialising only what a view needs to draw. The compiler decides per
   expression whether it is answerable from local SQLite or needs Scryfall:
   `Filter(Universe, q)` is a Scryfall query; `Intersect(Filter(Universe), Collection)`
   pushes down into SQL over the local cache.

## Editing

`Literal` nodes are editable — dragging a card into a deck panel
edits that node. Derived nodes are read-only but can be **baked** into a literal,
the way Blender applies a modifier. Edits propagate to every view of a node; two
panels showing one deck must never drift.

## Re-backing the features we like

The point of the algebra is that the quality-of-life behaviour of Arena,
Scryfall and Moxfield falls out as presets rather than being reimplemented:

| Feature elsewhere | Expression here |
| --- | --- |
| Scryfall search | `Filter(Universe, q)` |
| Arena's card pool | `Filter(Universe ∩ Selected, format + colour identity)` |
| Moxfield "missing cards" | `Deck − Collection` (multiset, oracle grain) |
| "Collected but never played" | `Collection − Union(all decks)` |
| Binder / cube triage | `Collection ∩ Filter(…)` |
| Deck diff (TODO §4) | `SymmetricDifference(v1, v2)` |

## Open questions

- How is the graph persisted, and are nodes nameable/reusable across workspaces?
- Union of multisets — sum the quantities, or take the max? ("all my decks
  combined" wants different answers for "total copies used" vs "copies needed at
  once")
- How far should the compiler push down before giving up and materialising?
- Cycles: forbid outright, presumably.
- Do derived nodes cache their materialisation, and how is that invalidated?
