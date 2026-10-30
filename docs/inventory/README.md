# Inventory

**In one line:** there are the locations you *have*, the goals you *want*,
and moves plan how to turn the one into the other.

Design only — not built. The campaign is *Data model* in
[`TODO.md`](../../TODO.md). Grew out of the zones question in
[`mixed-grain-storage.md`](../mixed-grain-storage.md), which it partly
supersedes, and uses the vocabulary of
[`card-set-algebra.md`](../card-set-algebra.md) and
[`card-set-types.md`](../card-set-types.md).

This page is the overview: the model in brief, card sets, locations and
collections, decks, and the schema. The rest is by concept:

- [`buckets.md`](buckets.md): what is known about copies, `absent`,
  drawing and querying buckets, attributes.
- [`goals.md`](goals.md): goals and checklists, a collection checking one,
  checking a deck against its decklist.
- [`moves.md`](moves.md): moves, pending moves, plans.
- [`asset-tree.md`](asset-tree.md): the asset tree, references, facets,
  paths, sources and targets.

## The model in brief

- A **bucket** describes some copies: a card, plus what is known about them.
- A **location** maps buckets to counts of physical copies. Locations never
  overlap.
- A **goal** maps buckets to intervals: what a collection should hold.
- Locations and goals are the only stored contents. **Every other collection
  is derived**: unions of locations, filters of All Magic, algebra
  expressions.
- A **move** carries copies between locations. Pending moves sum to a
  **plan**, which can be checked against goals before anything is committed.
- Everything here is an **asset**, organised in one tree.
- Users say **place** for a location, **checklist** for a goal, and **pool**
  for an ω set.

## Card sets: multisets and ω sets

Two kinds, after `cmdr`:

- A **multiset** maps buckets to finite counts: a binder, a deck, Paper.
- An **ω set** says only which cards are in, encoded as `{0, ∞}`.

Both use the same buckets, so an ω set has a grain too: *every foil C21 Sol
Ring* is an ω set at `{printing, finish}`. A single bucket is the **atomic**
ω set, and every ω set is a union of them.

A **filter** is a predicate rather than a set, but applied to All Magic it
gives one: `Filter(AllMagic, p)` is an ω set, and intersecting any collection
with that ω set filters it (`Min(a, ω)`). So in practice they are
interchangeable. What remains is how an ω set is *defined*:

- **Predicate**: by a query, live, so a new printing joins it.
- **Literal**: by its members, written out, so nothing joins it.

Users call any ω set a **pool**, a *live pool* when it is a predicate; All
Magic is the default pool.

**Any predicate ω set can be rendered to a literal one**: evaluate it now
and write out the members. That is what saving a search's results does,
bounded in practice by how many pages one save may fetch. The reverse does
not hold in general. This is the live distinction under *Live saved
searches* in `TODO.md`.

**All Magic is the only ω set that is also a location.** It can be a move's
source or target, because `∞ − n = ∞`, and being disjoint means nothing for a
set that never runs out. It is never summed into a collection, or every total
is `∞`. **Every other ω set is some filter applied to All Magic**, a
literal one included (its predicate is membership in the list). That makes
it a collection, never a location:

- Nothing moves into or out of it. Buying a card from *cards under $1* is a
  move from All Magic.
- `+`/`−` on it change membership, not copies (add/remove rather than a
  stepper, as `card-set-types.md` says).

## Locations and collections

**A location is a collection of copies that cannot be in any other
location.** Binders, boxes and built decks are locations. Being disjoint is
what lets them be summed, and that is a fact about a *group*, an
**inventory**, rather than a property one collection has alone. A card in
your binder cannot also be in Dave's binder. Ordinary collections overlap
freely: a saved search and a cube list can both name the same Sol Ring, and
summing them counts nothing real. A location holds *copies*; other
collections hold *claims about cards*.

**Every location is a collection; not every collection is a location.**

**Locations are stored; every other collection is derived.** Unions sum
locations, ω sets filter All Magic, and algebra expressions combine either.
A declared multiset that is not a location, such as a wishlist or a
decklist, is a **goal**, not a collection. So the stored *contents* are
exactly two things, **locations and goals**.

What derived collections store is a **definition**: a union's members, a
filter's query, an algebra expression.

**An ω set is a special case of goal**, conceptually distinct: a strict
subset. Locations and ω sets are the two extremes of the same shape (see
[`goals.md`](goals.md) → *Goals*):

| | Items | Unlisted cards | Adds |
| --- | --- | --- | --- |
| **goal** | any interval | either | — |
| **location** | `= n`, pinned | — | the counts are physical copies, disjoint from every other location |
| **ω set** | `[0, ∞]`, wide open | excluded | nothing: pure membership |

Since every item of an ω set has the same interval, all it holds is *which*
buckets are in. A literal one is stored as a list of buckets, which is what
today's binary `quantityKind` approximates; a predicate one stores its
query. "My ramp cards" is one: its members have
`hi = ∞`, and everything else `hi = 0`. That is exactly the ω set encoding,
`{0, ∞}`, read off the upper bounds. Other filters
derive from it: applying it to a collection clamps the collection to those
upper bounds, `Min(a, hi)`. Used as a goal on a binder, the same set is a
filing rule, *ramp cards and nothing else*. So the stored contents really are
only locations and goals, with no third kind for literal sets.

**Unions.** Paper is the sum of the locations you put in it:

```
Paper = Sum(Binder 1, Binder 2, Bulk box, Atraxa deck, Cube box, …)
```

So "in collection" means *in one of the locations that sum into it*, the claim
`CLAUDE.md` → *Vocabulary* wants, and which locations count is the user's
choice, the shape *No global ownership* in `TODO.md` asks for. Sum is right
*because* the parts are locations. Unions need not be disjoint from each
other: the Cube box is in Paper and also is the Cube.

**The first kind: a sum of its children.** A sum collection's definition
is its children in the tree, so membership is where things sit and there
is no member list to keep. It sums each child that is a collection; a child
that is itself a sum contributes its own sum, recursively. Anything else
under it — a folder, a checklist, a pool — contributes nothing, so a
folder still only organises: grouping binders inside Paper takes a nested
sum, not a folder. The friend's binder stays out by sitting elsewhere.

- **A deck is a special sum**: of its zones, which are places. A deck under
  Paper counts, and its copies are named by where they are, *Atraxa deck ›
  main*.
- **A sum holds no lines of its own and is not a target.** Copies only go
  into places. Its view is the sum, drawn like a place, with each bucket
  naming the place it is in; a move acts on that place.
- **The cost:** a place counts only toward its ancestors. Overlapping sums,
  the Cube box in both Paper and the Cube, want a later kind with explicit
  members.

**Several inventories.** A friend's binder, tracked for trade reference, is an
ordinary location in *their* inventory. A collection's total changes when a
move crosses from one inventory to another. All Magic is the source outside
them all that never runs out.

### Kinds of storage

No catalogue of physical storage shapes:

- **The atom is a cell**: a place where cards are basically unsorted. *Maybe*
  sequenced, nothing more granular (slots, pages) for now. Cells are the
  locations.
- **Groups of cells** are seen at a higher level, as a binder is a set of
  sheets. A group is a union.
- **The one collection with structure of its own is a deck**, because its
  zones mean something against its decklist.
- **Users name the kind**: binder, box, drawer, deck box, and so on. A
  mnemonic that picks the icon; functionally all equivalent, at least to
  begin with. Where one word must cover them all, users say **place**.

Deferred: positions and slots. Out of scope: sealed product.

## Decks

| | Is |
| --- | --- |
| **Decklist** | zone goals plus formats: what you brew, what format checks read. Not inventory |
| **Physical deck** | a location: the sleeved cards in the box |

You design a decklist **against a collection**, the sum of everything you
have wherever it sits. Two decklists may share a Sol Ring without conflict,
since neither consumes it. The same `+` means different things by
destination:

| `+` into… | Does | Source |
| --- | --- | --- |
| a **decklist** (a goal) | edits the goal: *this deck plays Sol Ring* | any collection: a location, a union, a pool, All Magic. Nothing is consumed |
| a **physical deck** (a location) | a **move**: a copy leaves somewhere and arrives in the box | a location, or a source resolved to one |

**A decklist is zone goals plus formats**, not a raw goal. Its zones
(commander, main, side) are each a goal, found explicitly or conventionally
like a physical deck's zones below, and **format checks run across the
zones**: 100 cards counts commander and main, a sideboard has rules of its
own. The decklist is **legal** when every realization of its zone goals
satisfies the formats' constraints (the *(filter, interval)* shape under
[`goals.md`](goals.md) → *Goals as deck constraints*). Legality is checked, not enforced: a brew is
illegal most of the time and still a decklist. The shape matters here. With
exact items and unlisted cards excluded, realizations differ only in
printing, finish and attributes, so checking the oracle projection nearly
suffices; with `≥` items or unlisted cards unconstrained, some realization
breaks 100 cards or singleton.

**The maybeboard is not part of the deck.** It is a list of ideas, not a
demand on any box: an ordinary goal or ω set that may sit beside the
decklist as a child, which the decklist does not refer to.

A physical deck is tied to a decklist **through its goal**: the decklist
itself, or a refinement of it. In user journeys that refinement is a
**build**, a foil build or a budget build, which grounds the notion of
refinement; it is not a type of its own, only a goal. **A build inherits the
decklist's legality**: `g′ ⇒ g` means every realization of `g′` is one of
`g`.

| Question | Expression |
| --- | --- |
| Still to put in | `Diff(goal, deck)` |
| No longer wanted, take out | `Diff(deck, goal)`; the goal's unlisted cards are excluded |
| Complete | both empty |
| Not in the collection at all, so acquire | `Diff(goal, collection)` |

**Compiling** turns the first two rows into moves: *pull Sol Ring
(C21) from Binder 2*, *return Cultivate to Bulk*. Editing the decklist
changes the goal, the physical deck drifts, and recompiling gives the moves to
catch it up. A goal entry with a printing must be that printing; one with
printing `absent` can take any copy, so which copy is a preference to expose,
not a rule.

**Zones are collections** a deck holds (commander, main, side), the way
a tag in `cmdr` is only a name bound to a set. A decklist's zones are goals;
a physical deck's are locations.

**A deck asset** is a decklist (zone goals) and a physical deck (a location
group whose cells are its zones), tied zone by zone: each physical zone's
goal is the matching decklist zone, or a refinement of it. The links are
written in definitions, not implied by the tree. Either side finds its
zones one of two ways, which are the two kinds of reference in
[`asset-tree.md`](asset-tree.md) → *Naming a set in a query*:

- **Explicit:** it links its zones by path, wherever they sit, and a rename
  or move rewrites the link, so it never breaks.
- **Conventional:** it looks among its children for zones of specific names
  (`commander`, `main`, `side`). Free to set up, and tidying the tree tidies
  the deck; a missing zone shows as an empty slot, so a rename does not drop
  it silently. This is opt-in: the definition says to look, consistent with
  definitions not referring to their children automatically.

Whether one deck asset holds the others as children follows the folder lean
in [`asset-tree.md`](asset-tree.md) → *The asset tree*. Today's `decks` row maps to the decklist.

**Digital games have no physical decks.** An Arena deck consumes nothing from
an Arena account, so it is only a decklist checked against that collection.

**Piles are an arrangement**, another part of a deck asset: an ordered list
of named groups over a decklist's entries, with *Unsorted* as what is left.
It is how the deck is laid out on screen, not what it holds. As an asset of
its own:

- **A deck can have several**: by type while building, by role while
  tuning, a sideboard plan. Today's auto-arrange replaces the one set of
  piles; with arrangements it would make a new one.
- **A pile can be defined by a query** (`:ramp`, `t:creature`) as well as
  by hand, so an automatic arrangement stays live.
- **It names its decklist in its definition**, like any asset, rather than
  through where it sits in the tree.

Today piles live inside the deck (`deck_piles`, `deck_cards.pile_id`), and
the v4 library file keeps them there. From v5 on, an arrangement is an asset
of its own, and v4's piles convert to one per deck.

## What falls out

- **Sum or max** stops being one open question. Locations combine by `Sum`.
  Decklists combine by `Max` for "copies needed to have all of these built at
  once".
- **Bug 002** (a tile shows `0` for a card held in another printing) is a
  population at oracle grain.
- **Import stops fabricating** printings and conditions: what the source did
  not say is `absent`.

## First schema scope

**Assets, locations and goals ship in the first migration**: assets (id,
type, parent, position, name), locations as buckets with residual counts,
and goals, which decklists need from the start. That is enough to try out
the asset tree and its organisation without introducing many new asset
types at once.

**Moves wait.** Every move commits the moment it is made, as every write
does today: `+`/`−` are moves to and from All Magic, and moving a card from a
binder to a deck box is one action doing both halves. No pending moves, no
active move, no history yet. Storing moves later turns the same actions into
pending edges in the active move; the controls stay the same.

## Mapping today's data

**Every existing collection becomes a location**, saved searches included,
and is converted by hand where it should be something else. No inference
from `kind` or `quantity_kind`: this is a prototype, and simple beats
faithful. From then on, saving a search's results makes a literal ω set,
and saving the search itself a predicate one.

**Finish is dropped**: every migrated bucket has finish `absent`. Today's
column cannot tell a stated finish from its `'nonfoil'` default, so none of
it is kept.

That loses real information too: every foil and etched copy entered on
purpose. Accepted for a prototype, but not silently:

- **Back up first**, as the campaign in `TODO.md` already requires. The
  backup is the record of every dropped finish.
- **The migration reports the loss**: how many rows had a finish other than
  `'nonfoil'`, per collection, so the size of it is known before anything is
  re-entered.
- **Recovery is ordinary sorting.** Re-stating a copy's finish moves it to a
  finer bucket, the same action as learning its printing.

**Each deck becomes a decklist**, printings kept as stored, each zone a zone
goal. Its `maybe` zone becomes a child goal of the decklist, which the
decklist does not refer to.

## Open

- **Folders:** any asset acting as one is a lean, not settled. Tags as
  well as folders, and when?
- **Finding every reference on rename:** scan every stored query, keep an
  index of references, or store references by internal id so a rename
  rewrites nothing. Either way it must be complete, or a rename quietly
  breaks something. References outside the app (an exported list, a
  note) are not rewritten, which an identifier would not fix either.
- **Rendering `absent` printings and finishes:** the rule, and its scopes.
- **Loans:** a move with a return due ([`moves.md`](moves.md)). Lending,
  borrowing, and whether a lent copy still counts in my collection.
- **Arrangements:** whether a card may sit in more than one pile of one
  arrangement. That arrangements are assets of their own is settled (see
  *Decks*, and [`library-format-5.md`](../library-format-5.md)).
- **The ontology of asset types.** Every asset's type is a node in a
  static is-a graph, fixed in code; users do not add types. The relations
  this doc states as facts become its edges: a place is a refinement of an
  exact checklist, a pool a special case of a checklist, a list pool and a
  query pool each a pool. A node may have more than one parent, likely
  rarely (a physical deck is a place, and refines a decklist). Binder, box
  and the like are not types but a free-text storage note on a place,
  which picks the icon. The library file names one node per asset and
  never the hierarchy ([`library-format-5.md`](../library-format-5.md)).
