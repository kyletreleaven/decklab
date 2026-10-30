# Goals

Part of the inventory model; the overview is [`README.md`](README.md).

## Goals

A location has its contents **as they are**. A goal is a collection **as you
want it to be**. (Not "target": that word is already taken by the destination
slot.) **Users call a goal a checklist**, on a deck or a location alike; a
goal that is an ω set they call a pool. A goal can sit on any collection,
location or not: a wishlist is a goal on Paper, checked against Paper's
populations, and does not care which binder its cards end up in.

**Shape.** A goal item is a bucket, read as a pattern, plus an interval on its
population: `lo ≤ population(bucket) ≤ hi`.

| Shape | Per item | Example |
| --- | --- | --- |
| **Exact** | `= n` | a physical deck's build |
| **Lower bound** | `≥ n` | a wishlist: at least these, more is fine |
| **Upper bound** | `≤ n`, often by filter | a filing rule: Binder 2 holds blue rares and nothing else |

- **Needs in:** `Diff(lo, actual)`
- **Must go out:** `Diff(actual, hi)`
- **Satisfied:** both empty

**The default item is `bucket ≥ k`**: no upper bound, so adding more never
violates it. Decks are the case that needs `= k`.

**Unlisted cards: excluded or unconstrained.** Every goal has one bit
saying what holds for cards it does not list. (As built, the kind decides
it, and only a cap will store it: *Kinds of checklist*.)

| Unlisted cards are… | Interval | Examples |
| --- | --- | --- |
| **excluded** | `[0, 0]`: must not be there | a decklist or deck build, a filing rule, a literal ω set |
| **unconstrained** | `[0, ∞]`: anything is fine | a wishlist, "keep whole", a collector goal, the empty goal |

A deck build must exclude: *take out what is no longer in the list* only
works if a card the goal does not mention should leave. A wishlist on Paper
must not: Paper holds thousands of cards the wishlist never names.

(Not to be confused with `cmdr`'s open and closed definitions, which are about
several files adding to one set. In DeckLab, union covers that.)

**"No goal" is the empty goal.** It has no items, constrains nothing, and
every state satisfies it. Every collection then has a goal, usually that one.

| Collection | Goal | Contents |
| --- | --- | --- |
| a binder | empty | its cards |
| a binder kept whole | its contents, as `≥ k` items | its cards |
| a wishlist (on Paper) | `≥ k`, printing usually absent | Paper's |
| a decklist | `= k` per zone, any grain | none of its own |
| a deck's build | `= k`, mixed grain | the physical deck |

**"Keep whole" adopts the contents as the goal**, a one-step action that
copies the buckets and relaxes `=` to `≥`. With the empty goal, a card leaving
through a move leaves nothing behind. With an adopted goal, the binder
reports it missing (*Sol Ring is in the Atraxa deck*), which also covers
lending: a lent card shows as missing until it comes back.

**Live goals.** A goal set by a filter (`hi` is `Filter(AllMagic, q)`) is a
live rule, like a live pool. **Collector goals** need nothing more:
*all of MH3 including foils* is a lower bound by filter at printing grain.
Progress is `count(Min(actual, lo)) / count(lo)`, and the missing cards are
an acquisition list like any other.

**Locations and goals are one shape.** A location is a semantic refinement of
an *equality* goal, `lo = hi = n`, adding two claims: the counts are physical
copies, and they are disjoint from every other location's. A location is the
"is", a goal the "ought". One subtlety: a location's counts are residuals and
a goal reads populations, so a location read as a goal means the population
equalities its residuals imply (*Sol Ring = 3*, *Sol Ring C21 foil = 1*), not
*Sol Ring, printing absent, = 2*.

### Kinds of checklist

The interval above is the general shape. What is built splits it into
kinds, **each with one meaning**, so a line is only ever a bucket and a
count, and the kind says how to read the count:

| Kind | A line means | Unlisted cards |
| --- | --- | --- |
| **place** (a collection) | `n` held | — |
| **checklist** | at least `n` | anything: `≥ 0` says nothing |
| **exact checklist** | exactly `n` | excluded: *exactly these* leaves no other reading |
| **cap** (later) | at most `n` | a real choice: free, or excluded |

- **An exact checklist is a checklist**: whatever meets *exactly n* meets *at
  least n*, so it refines the checklist with the same lines. To the eye they
  are one thing, *checklist*, with *At least | Exactly* in its view.
- **A decklist's commander and main are exact**; its sideboard is either.
  A deck's zones are places. Other kinds are refused there.
- **The unlisted bit is a cap's alone.** For a checklist it could only say
  *any*, which is what unlisted already means; for an exact one, only
  *excluded*, which is what exact already means. With caps it comes back as
  theirs: *at most one Sol Ring* leaves everything else free; *these and
  nothing else, at most this many each* is a whitelist with limits.
- **Compounds, later: min, max, intersect.** Exact is then not a primitive
  but `intersect(checklist, cap with unlisted excluded)` over the same
  lines. Per bucket, *max* of two checklists is the stronger of each line
  and *min* the weaker; *intersect* is both holding, which equals
  per-bucket max only when no two lines' patterns overlap — one C21 Sol
  Ring meets both *≥ 1 Sol Ring, any* and *≥ 1 Sol Ring, C21*. That is the
  matching in *Checking a deck against its decklist*.
- **General constraints stay separate.** *Exactly 100 cards*, singleton,
  colour identity and *≥ 10 ramp* are filters with counts (*Goals as deck
  constraints*), not lines of a checklist.

**Converting: collection → checklist, checklist → place.** A collection
becomes the strongest checklist with only minimums that it meets: its lines,
read as *at least*. A checklist, exact or not, becomes the smallest place
that meets it: its lines, read as held. Both keep the lines as they are —
a card-only line means *printing not recorded* in a place and *any
printing* in a checklist — so converting is a change of type alone, and the
lab keeps every kind's lines in one table for that reason. Asymmetric on
purpose: a place is a collection, so is a filtered collection (later), and
any of them can become a checklist; a checklist only ever becomes a place.
**A deck does not convert**, nor does a decklist. A deck is a collection,
the sum of its zones ([`README.md`](README.md) → *Unions*), but it is defined against the decklist it
builds, so every deck has one. A
conversion is refused when it would leave a zone of the wrong kind.

### Every decklist has an oracle projection

A decklist can be any grain: a Moxfield import or a hand-picked list often
names printings. **Its oracle projection**, `ToOracle` of each zone with
every printing `absent`, is always implied: derived, never stored, and what
format checks and *what the deck plays* read. **Refining** pins entries to
printings, and a refinement satisfies whatever it was refined from, so a
decklist with printings is already a refinement of its own projection:

```
oracle projection  (printing absent)   what the deck plays
   ↓ refine: pin printings, where you care
decklist / build   (mixed grain)       what the box should hold
   ↓ plan moves
physical deck                          what the box does hold
```

**`g′` refines `g` when `g′ ⇒ g`**: every set of contents that satisfies `g′`
also satisfies `g`. Pinning a printing is one way; narrowing a bound is
another (`≥ 2` to `= 3`); adding a constraint `g` was silent on is a third.
One decklist can have several refinements, such as a foil build and a budget
build. The empty goal is the top of this order: every goal implies it.

**A way of thinking, not a feature.** Refinement explains how a decklist, a
build and a box relate; no tools for chains of goals are promised. Probably
nothing more than a goal remembering the decklist it came from.

### Checking a deck against its decklist

**At card grain, nothing needs matching.** Both sides project to the card
and are summed: the list asks for 7 Islands, the deck holds 3. This is how a
deck builds its decklist today (`builtContents`): each card's copies split
into runs — held, missing, extra — and a tile is never partly there.

**Finer than that, copies must be matched to lines**, because one held copy
can satisfy more than one line. The list asks *Sol Ring, any* and *Sol Ring,
C21*; the deck holds a C21 and a CMR. Right: C21 to the C21 line, CMR to
*any*. A pass that hands C21 to *any* first reports the C21 line missing
when nothing is.

**Most specific line first** fixes that while patterns nest — *C21* inside
*any* — but they can cross. The list asks *Sol Ring, foil* and *Sol Ring,
C21*; the deck holds a C21 foil and a CMR foil. The C21 foil fits both, the
CMR foil only the first, and neither line is narrower than the other.

**So the general form is matching with counts — max flow, per card**: lines
on one side with what they ask, held buckets on the other with what they
hold, an edge where a bucket fits a line. A card has a handful of each, so
it costs nothing at decklist size, and it says *which* lines are unmet —
*missing: Sol Ring, C21*, not *one Sol Ring short*. **Lean:** stay at card
grain until a view wants *right card, wrong printing*, then match by flow
rather than by a greedy rule that is right only while patterns nest.

### A collection checks a checklist

**The collection points at the goal**, as a deck builds its decklist:
Paper `checks` the MH3 checklist, and the checklist names no collection.
So one checklist serves any number of collections, each with its own
progress: my Paper and a friend's binder can both check *All of MH3*. In
the library file, `checks` on a place or sum replaces a checklist's `on`,
which pointed the other way.

**One checklist per collection**, without loss of generality:

- **Several goals at once** are one compound checklist (*Kinds of
  checklist*: min, max, intersect).
- **Switching between goals** is repointing the one reference, or an
  **identity clone**: a collection with a single reference to another,
  `same = "/Paper"`, whose contents are exactly Paper's and which checks a
  checklist of its own. *Paper: MH3* and *Paper: Old border* side by side.
  Not built.

**Drawn as its checklist**, as a deck is drawn as its decklist: each card
held, missing or, for an exact checklist, extra, with progress
`count(Min(actual, lo)) / count(lo)` (*Goals*). At card grain until a
checklist pins printings; a collector goal does, so it waits on the
matching in *Checking a deck against its decklist*. A deck is the case
built first: its `list` is this reference, zone by zone.

**Filling a missing slot** takes two choices:

- **From:** a collection to look in, chosen, never guessed. Not the
  collection being filled, nor anything that counts toward it: a copy
  already there is not missing.
- **Into:** a place to move the copy to. **A placement is valid when the
  copy, in that place, would count in the collection afterwards.** For a
  place, or a deck's zone, that is the place itself, and there is nothing
  to choose. For a sum, any place it sums; for an identity clone, a place
  of what it clones.

The rule is about the copy as much as the place. Today it reduces to *a
place the collection sums*, because nothing filters. A filtered collection
is where it bites: *Paper, foils only* takes a foil into any of its binders
and a nonfoil into none, so a copy that would count nowhere is offered
greyed, saying why; *Paper minus the bulk box* rules a place out whatever
the copy. One question, *where would this copy count?*, which filters
extend rather than special-case.

### Goals as deck constraints

Goals are a simplified class of deck constraints, and a sensible one: the
subset a planner can satisfy by moving cards. Deck constraints in general
have a *(filter, interval)* shape, with more kinds of filter and quantifier:

| Constraint | Shape |
| --- | --- |
| a goal item | one bucket, `lo ≤ n ≤ hi` |
| 100 cards | everything, `= 100` |
| colour identity | cards outside the commander's identity, `= 0` |
| singleton | *every* card except basics, `≤ 1` |
| `cmdr`'s role targets | `:ramp`, `≥ 10` |

So the format registry (*Format support* in `TODO.md`) and goals share one
shape, but not one scope. **Goal items are buckets, to start.** What a goal
is for is the visual language: viewing a collection as a partially complete
location with respect to it, card by card. A bucket supports that directly.

The languages nest, each a special case of the next (not a *refinement*,
which relates goals, not languages):

| Item language | Is | Status |
| --- | --- | --- |
| **bucket** | every attribute pinned to a point, `absent` the full range | goal items now |
| **range pattern** | *and*-ed intervals on ordered attributes (*condition ≥ LP*, *grade ≥ 9*) | move the goal post here if it proves useful |
| **any filter** | *(filter, interval)* in general: *ramp ≥ 10*, singleton | out of scope for goals: a more general, `cmdr`-like kind of asset, checked against goals |

Keep the nesting in mind for asset polymorphism: wherever a filter is
accepted, a range pattern or a bucket should be too. Overlap exists at every
level: *Sol Ring ≥ 3* and *Sol Ring C21 ≥ 1* share copies.

