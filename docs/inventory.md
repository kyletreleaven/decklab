# Inventory

**In one line:** there are the locations you *have*, the goals you *want*,
and moves plan how to turn the one into the other.

Design only — not built. The campaign is *Data model* in
[`TODO.md`](../TODO.md). Grew out of the zones question in
[`mixed-grain-storage.md`](mixed-grain-storage.md), which it partly
supersedes, and uses the vocabulary of
[`card-set-algebra.md`](card-set-algebra.md) and
[`card-set-types.md`](card-set-types.md).

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

## Buckets

A **bucket** is:

- **an oracle card**: required. Oracle is the minimum grain.
- **printing**: first-class, a value or `absent`
- **finish**: first-class, a value or `absent`. It can be known when the
  printing is not: *a foil Sol Ring, printing unknown*.
- **user attributes**: key-value pairs, sparse, `absent` when not given

A bucket is a **value**, a description, not a stored thing of its own. The
same bucket can appear in many locations.

**`absent`** is either a missing key or a special assignable value; which is
an implementation detail. What matters is that it is one value, and that it
is never SQL `NULL` in a unique key, because SQL treats `NULL`s as distinct
there. That is the trap the mixed-grain design works around with
`COALESCE(card_id, '')`. *Known not to be signed* is a real value
(`signed=no`), not `absent`.

**Grain is per card.** Every bucket of one card shares the same set of
attributes in play, while different cards can have different sets: Sol Ring
tracked by printing and finish, Island by nothing at all. Values within that
set can still be `absent`, so 2 × *Sol Ring, printing absent* and 1 × *Sol
Ring, C21, foil* share one grain and differ only in what is known.

**Sparse.** An attribute that is `absent` in every bucket of a set can be left
out of the set entirely. A binder that never records `signed` carries no
`signed` anywhere, a view shows only the attributes its buckets use, and a new
attribute needs no migration. A bucket's identity is its card plus its
non-`absent` assignments, which needs a canonical form (sorted keys, say).

### Residual and population

Coarse and fine buckets coexist, and the fine count also counts toward the
coarse one. So a bucket has two counts:

- **Residual**, stored: copies known *exactly this much* about. Each copy is
  in one bucket, the finest description known for it.
- **Population**, derived: copies known *at least this much* about.
  `absent` sits above every value of its attribute, so `r ≤ b` when, for
  every attribute, `b` is `absent` or `r` matches it, and
  `population(b) = Σ residual(r) for r ≤ b`.

| Bucket | Residual | Population |
| --- | --- | --- |
| *Sol Ring* (all absent) | 2 | 3: those 2 and the C21 foil |
| *Sol Ring, C21* | 0 | 1 |
| *Sol Ring, C21, foil* | 1 | 1 |
| *Sol Ring, C21, foil, near mint* | 0 | 0: the foil's condition is not known to be near mint |

The order is implication, the same order as refining goals. The algebra doc's
`Sum(ToOracle(known, sum), unsorted)` is this at two grains.

**It is SQL.** Residuals are a table with a count column. A population is
`SUM(count) WHERE` each of the bucket's non-`absent` attributes matches.
Every population at once is what `GROUP BY ROLLUP` or `CUBE` computes, with
`absent` playing the rolled-up "all", but SQLite has neither: write it as one
`GROUP BY` per grain joined with `UNION ALL`, or sum residuals in TypeScript.
In practice a view needs one or two grains (oracle, and printing), not every
combination.

**Learning more moves a copy to a finer bucket** in the same location: 2 ×
*Sol Ring, printing absent* becomes 1 × absent + 1 × C21. Populations of the
coarser buckets do not change. This is the "promote copies from unsorted"
item in `TODO.md`.

### Where is it: a population per place

A bucket is an **atomic ω set** (see *Card sets* below): the cards its
description could be. So "where is this card" generalises from one card to
any filter `f`, asked of every place:

- **The count is containment.** A copy counts when its bucket lies wholly
  inside `f`: `Σ residual(r) for r ⊆ f`, which is the population when `f`
  is a bucket. Honest at the grain asked: for *C21 foil Sol Ring*, a bulk
  box's two Sol Rings of unknown printing count 0, as the near-mint row
  above does.
- **The count is the result**, shown first, for the query as asked.
- **Everything else is a hint, never added in**, and only when `f` refines
  one card (a bucket under a single oracle). The card's copies that fell
  outside `f`, partitioned into their residual buckets, listing only the
  buckets that hold any: "also here: C21 × 1, printing not recorded × 2".
  A query spanning many cards gets no hint. That covers copies known to be
  another printing and copies that *might* match (their bucket overlaps `f`
  without lying inside it); the second kind is also a to-do list for
  sorting, since learning more is what settles them.
- **The places shown** are those with a non-zero count (and, if the hint is
  on, those with only a hint, marked as such).

`f` can be one card, a pattern, a query, a pool (`:ramp`) or a decklist,
which makes journey D's "what to pull, by place" the same question as
journey F's "where is it".

### Two readings of `absent`

In a **location**, a bucket is a *description* and `absent` reads as
**unknown**: printing not recorded. In a **goal**, a bucket is a *pattern*
and `absent` reads as **any**: any printing will do. A bucket is always used
one way or the other, so the readings never mix, and one bucket type serves
both.

- **A goal cannot ask for a card *of unknown printing*.** There is no way to
  say it: in a goal, `absent` only means any.
- The UI labels by context: "printing not recorded" in a location, "any
  printing" in a goal.
- Two distinct values, `unknown` and `unconstrained`, were considered. They
  make the readings explicit but split the bucket into two types, for no
  guarantee the context does not already give.

A pattern is the simplest filter: attribute equalities joined by *and*, with
`absent` as a wildcard. General queries — Scryfall syntax, inequalities,
*or* — are filters with richer predicates, and a pattern is the narrow case.

### Rendering an `absent` printing or finish

A display choice, never stored, and **not decided**. Factors that could go
into it:

- a printing the bucket's goal pins (a refined decklist)
- the most common known printing of this card in the same collection
- a per-card preference ("my art for Sol Ring")
- a default: Scryfall's own default printing, or the newest
- the newest cached printing, which always exists
- for finish: nonfoil if the printing has it, otherwise its first finish

How it is configured is just as open: anything from a hardcoded rule set, to
rules scoped per project or per asset, to **rulesets as assets** of their
own. So implement for flexibility: one place resolves a stand-in, given the
bucket and its context, and whatever configures it can change behind it.

**The lean: printing selectors, layered.** A **selector** is an asset type
that maps a bucket to a printing, or abstains. Selectors stack, and the
first that answers wins:

- **Scryfall's pick is the bottom layer**, built in as All Magic is, and
  always answers, so a tile always has something to show.
- **Layers above it** are a list (*my art for Sol Ring: the C21 foil*), a
  rule (*newest*, *oldest*, *prefer foil*), or contextual (*the most common
  printing among my copies in this place*).
- **Display only.** A selector never changes a bucket.

```toml
[[asset]]
path = '/Preferences/my art'
type = "selector"
over = '/Preferences/newest'      # the layer below; left out, Scryfall's pick
cards = [ { card = "Sol Ring", set = "c21", number = "263" } ]
```

How a view finds its selector is open. The lean is an **active selector**,
chosen in the UI as the active collection is, and later an **explicit
reference** for an asset that wants its own (`printings = '/Preferences/my
art'`, as a deck says `shows`). *Not* by the folder a selector sits in:
that would make containment mean something, which *The asset tree* rules
out. Until selectors exist, the resolver is the chain with Scryfall's layer
alone.

Whatever the rule, the tile must say it is a stand-in, so it is not read as
a known printing. This is the same question as the *active printing* in
`TODO.md` (bug 002), seen from storage.

### Drawing a pattern at printing grain

**Grain in a view is only a way of drawing a set.** Toggling it changes no
bucket and stores nothing. A pattern — a pool or a checklist, where a key
left out means *any* — can mix grains: some lines name a printing, some
only the card. Holdings, where left out means *not recorded*, mix grains
the same way, and project the same way; only the label differs (*Two
readings of `absent`*).

**A view's grain is a ceiling, not a target.** Each bucket projects *down*
to it, never up: keys finer than the grain are dropped, and a bucket
already coarser stays as it is, its missing key shown as missing. Rows are
the distinct results, counts added. Nothing is invented or expanded.

| View | Drops | "Sol Ring", no printing named |
| --- | --- | --- |
| **Cards** | printing, finish, attributes | one row with every other Sol Ring line |
| **Printings** | finish, attributes | its own row: *Sol Ring, any printing* |

So at printing grain, "Sol Ring, any" and "Sol Ring, C21" are two rows:
slightly redundant, true to the lines. Listing every printing an "any" row
could be would be a separate action, not the view, and may cost a request
per card whose printings the store lacks. **Full detail**, a third value
that drops nothing and shows buckets as written, is for later.

**All Magic holds ∞ in every bucket at both grains**: ∞ of "Sol Ring" and ∞
of each printing. Each printing projects into its card, and ∞ onto ∞, so
either view draws the same set. By the ceiling rule its printing view
includes one *any printing* row per card beside the printings — and that row
is useful: adding it to a pattern adds a card-only line, where adding a
printing's row adds that printing.

**Built:** the All Magic view's *Cards | Printings* toggle, which asks
Scryfall for one row per printing (`unique=prints`). **Not yet:** the *any
printing* rows. Scryfall returns printings only, so they would be drawn
client-side, one per card; sorted by name a card's printings arrive together
and its row can lead them, but under another sort they scatter, and where
the row goes is open. Where else to offer the toggle, or not, is open too:
query pools and the deck builder's pool are candidates.

### Drawing an asset against All Magic

An asset's view can draw All Magic behind it, as a collection's view does
in the current app (*Show not in <asset>*). It is one set, drawn by the
rules above, not two sources merged:

1. **Union** All Magic's buckets, as the search narrows them, with the
   asset's.
2. **Project** to the view's grain.
3. **Evict** All Magic wherever the asset has presence: its tile takes All
   Magic's place, in All Magic's order. Everything else is All Magic,
   dimmed.
4. **Draw** by the asset's own display rules (*Sources and targets*).

At the Printings grain, an asset's *any printing* line has presence on its
card's *any printing* row, not on a printing: it takes that row's place,
and the card's printings stay All Magic's, each still something to add.

**Off, the asset alone, and nothing is requested.** All Magic is paged from
Scryfall only when it is drawn. The search is then answered locally: every
card an asset holds is in the card store, with Scryfall's data. Searching
with All Magic drawn goes to Scryfall, and an asset's tile appears wherever
its card does.

### Querying a bucket that leaves a key out

A bucket with no printing cannot be tested against a printing's
properties. **A printing-level term is unverifiable against it, and an
unverifiable term matches neither way**: `s:m10` does not match an
unrecorded Bolt, and neither does `-s:m10`. A card-level term is answered
as for any printing of the card — they all agree.

Not the stand-in: the printing a tile is drawn with is Scryfall's choice
(*Rendering an `absent` printing or finish*), display only, and testing it
would answer a question about a printing nobody named.

It is three-valued logic, and SQL's `NULL` is exactly it: on a line with
no printing, each printing-level term is `NULL` (the term, not the column —
a column default such as a missing flavour text read as empty would
otherwise answer for it), and `NULL` carries through `and`, `or` and `not` as it should — `s:m10 or t:creature`
still matches a creature, `s:m10 t:creature` matches nothing. Which fields
are printing-level is listed in
[`query-language.md`](query-language.md) → *Field mapping*. The finish and
user attributes, when queries reach them, follow the same rule: `absent`
is unknown (*Attributes*).

## Attributes

Signed by the artist, graded, altered, misprinted: distinctions finer than a
printing. Rather than a grain of individual copies, an **attribute system**.

- **First-class attributes are only what Scryfall understands**, because they
  are what queries are built from: the **printing** (one Scryfall card object,
  fixing set, collector number and language) and the **finish** (one of that
  printing's `finishes`). These are also exactly what can be pushed down to
  Scryfall; user attributes are evaluated locally, the same split as `cmdr`'s
  local and Scryfall terms.
- **User attributes** are user-defined, probably at project scope, and
  **typed**, with conveniences per type: text, number, yes/no, a list of
  choices, and **condition**, a built-in type with the standard ordered levels
  (M, NM, LP, MP, HP, DMG). A new project can start with one attribute named
  `condition` of that type.
- **`condition` is demoted** from a column in today's unique key to a user
  attribute. Today's `'NM'` is mostly a default (schema, `importer.ts`,
  `addCard`), so it maps to `absent`; other values were stated and are kept.
- **No uniqueness is enforced.** A unique copy is a bucket of one, made by a
  user attribute such as a certificate number; keeping it to one copy is the
  user's job, and All Magic's `∞` (below) never gives way.
- **An attribute is not a tag.** A tag such as `ramp` is *total*: every card
  is in it or not, so untagged means no, and it can be evaluated over All
  Magic. That makes it a named ω set (below), at printing grain or coarser. An
  attribute is *partial*: `absent` means unknown, not no, and it describes
  copies, so it has nothing to say about a card nobody holds. The test: if not
  knowing must mean no, it is a tag; if it must mean unknown, an attribute.
- *Considered and set aside:* attributes with an enforced singleton-per-value
  arity, and **identified cards** as a built-in copy grain (in effect one
  first-class singleton `copy_id`). Either buys guarantees, such as a move
  history per copy, at the cost of special logic everywhere cards are counted
  or listed. Revisit if collectors need it.

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
*Goals*):

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
the sum of its zones (*Unions*), but it is defined against the decklist it
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
*Goals as deck constraints*). Legality is checked, not enforced: a brew is
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
zones one of two ways, which are the two kinds of reference in *Naming a
set in a query*:

- **Explicit:** it links its zones by path, wherever they sit, and a rename
  or move rewrites the link, so it never breaks.
- **Conventional:** it looks among its children for zones of specific names
  (`commander`, `main`, `side`). Free to set up, and tidying the tree tidies
  the deck; a missing zone shows as an empty slot, so a rename does not drop
  it silently. This is opt-in: the definition says to look, consistent with
  definitions not referring to their children automatically.

Whether one deck asset holds the others as children follows the folder lean
in *The asset tree*. Today's `decks` row maps to the decklist.

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

## Moves and plans

A **move** is a set of edges, `source —(n copies of a bucket)→ target`. It is
a value of its own, not just a write: it describes the state before and the
state after.

- **An edge carries one bucket**, what is known about the copies. Moving
  loses no information, so a C21 foil landing beside *Sol Ring, printing
  absent* stays its own bucket.
- **A move is a signed spec per location**: at the algebra's `integer`
  quantity, each edge is `−n` at its source and `+n` at its target, summing
  to zero. That zero is the conservation law that keeps collections
  unchanged.
- **Add and remove are moves to and from All Magic.** Then every write is a
  move, and a collection's total changes exactly when a move crosses an
  inventory's boundary. Today every write is the boundary kind.

**Acquisition list and trades.** The edges of a plan whose source is outside
your inventory are the cards to get, grouped by where from: *ask Dave* for
edges from his binder, *buy* for edges from All Magic. A move with edges both
ways between your inventory and Dave's is a **trade** proposal. When `+` picks
a source, the natural default order is your own locations, then tracked
binders, then All Magic. `Diff(goal, collection)` then appears as edges.

**Temporary locations** are real piles that exist for a while, so a half-done
job is an honest state:

- **A pull pile.** One pass through the binders for three decks, sorted into
  the decks later.
- **A to-file pile.** A teardown or a purchase lands here before filing.
- **A trade pile.** Cards set aside for Dave, so they stop counting as
  available to your own plans.

**Sources may be unresolved; targets may not.** A planned edge can take from
a collection that is not a location — *a Sol Ring from somewhere in Paper* —
and be resolved to a real location before it is committed. Its target is
always a location.

- **Demand is specific, supply is fungible.** Goals sit on targets, so where a
  card goes is the point. Copies in a bucket are interchangeable, so where one
  comes from matters to nobody's goal.
- **Physically**, you know where you are putting a card; you go and find it.
- **Into a non-location** is a move into a temporary location, planned onward
  later.
- An ω set as a source is All Magic with a constraint on the bucket. A goal
  is never a source: no copies live there.

So a move's targets are always resolved, while its sources can be resolved
one edge at a time. "Resolved" is not "committed": committing is carrying the
edge out.

### Pending moves: the active move

**A move is an asset that you make *active***, the way a deck or collection
is active. **`+`/`−` write into the active move** rather than committing,
which fits *Destination* in `CLAUDE.md`: the move is just another
destination. Viewing through it is viewing the hypothetical inventory, like
checking out a branch.

**A location's pending edges are a view, not storage.** Every view of a
location can show what its pending edges would do to it, across every move,
whether or not the location is active. That need not be a list of arrows; it
is a visual language on the tiles themselves: which cards *stay*, which are
*leaving*, which are *arriving*, and which copies are *contested*. The
location's goal informs the same language: a card *missing* from the goal, a
card in *excess* of it, and whether the pending edges would close the gap.

*Considered and set aside:* an **attached** move, one pending move stored on
each location and holding its inbound edges. Any set of edges already splits
by target, so it would store nothing the moves do not; what it offered, *what
is planned into this deck*, is the view above.

Working with pending moves:

- **Commit or stash.** Commit when done; stash until you have time.
- **Commit edge by edge.** Ticking off *done with Binder 2* commits those
  edges and leaves the rest pending.
- **Pending moves compete for copies.** Two decks can each plan to take the
  one Sol Ring in Binder 2, so validity is checked across every pending move,
  and contested copies show as such.

### Plans

**A plan is not a separate kind of asset.** A move can already carry any
number of edges across any locations, and moves sum: each is a signed spec
summing to zero, so their sum is too. *Plan A versus plan B* is two moves,
one active.

**The plan** is the sum of every pending move. Applying it gives a
hypothetical inventory that every question can be asked against: *which
decks become complete, which binder runs out*.

- A plan is valid when no location goes below zero.
- A plan can go stale when the inventory changes underneath it; recheck
  before committing.
- A plan counting on learning more ("needs a C21 among your Sol Rings of
  absent printing") is speculative and should say so.
- Committed moves are a history: *where did my Sol Ring go*, and undo. The
  same idea as *Version control* in `TODO.md`, applied to inventory.

*Possibly later:* a **derived move**, stored as a definition the way a union
is: *Commander night* as the sum of three decks' pull moves, made active as
one.

**Surplus is the natural source to plan against.** A location's surplus is
what it holds beyond its goal's lower bound, `Diff(actual, lo)`. A union's
surplus is the sum of its parts' surpluses, each against its own goal — not
`Diff(Paper, goal(Paper))`, since a deck short of a Sol Ring does not cancel a
binder's spare one.

- **Goals double as protection.** All of a plain binder is surplus; none of a
  built deck is; "keep whole" makes a binder's surplus zero.
- **Excess** goes further: copies above `hi` should leave, `Diff(actual, hi)`.
- **Available** is surplus less what other pending moves already take.
- **Grain.** Surplus is exact at the goal's grain; *which* copy is spare is a
  source choice.
- A trade binder's "my duplicates" is the surplus of everything else.

**Plans can be derived from goals**: the moves that would satisfy them. That
is a flow problem with sources, sinks and finite copies. Goals can compete for
one copy, so not every combination is satisfiable, and "which decks can I
complete at once?" is the feasibility question.

## The asset tree

The model has many kinds of entity, and a flat sidebar of decks and
collections cannot hold them. What ties them together is **one tree of
assets**, after Unity's Project window. Its open work is in `TODO.md` →
*The asset tree, in the lab*.

**What is an asset.** Anything the DeckLab language defines — collections,
filters, decklists — and everything in this doc: locations (cells, and groups
such as a binder), goals, moves. A friend's binder is an ordinary
location asset. **All Magic is the only special one**: built in, `∞`, never
summed into a collection.

**Any asset can act as a folder** — a lean, not a decision. Every asset has
a parent, so a deck can hold its decklist, goals and moves the way Unity
nests sub-assets, and a pure folder is an asset with no type.

**A folder only organises.** Containing means nothing: a folder sums nothing,
and whether a binder holds a card never depends on which folder it sits in.
That holds for an asset acting as a folder too: **a definition does not refer
to its children**, at least not automatically. A binder holding three sheets
is not their union unless its definition says so — a sum collection's
does, and is nothing else (*Unions*); a deck holding a decklist
is not thereby built from it. References go by path, and renaming or moving
an asset rewrites every reference to it in the same transaction, so a
reference follows its target rather than staying with the old position.
**No identifiers where properties or a path will do** — in the model and
in the library file. Inside the database, asset ids are fine wherever they
make that transaction simpler (store a reference by id, render it as the
current path); a dump writes paths and elides the ids, and a load assigns
fresh ones.

**Siblings have no order.** A hand-made order is a viewing preference, not a
fact about the collection, so the tree stores none: it shows siblings by
name, and a file writes them in a canonical order. A custom order could come
back someday, as a view's. So moving an asset is only ever *into* another,
never *between* two. (An arrangement's piles do keep their order: that is
order inside one asset, and it means something.)

| Unity | Here |
| --- | --- |
| Every asset has a GUID; references go by GUID | a goal names its decklist, a move its locations, by path; renaming or moving rewrites those references in one transaction, so it never breaks a link, with no GUID needed |
| Asset types, a per-type *Create* menu, search by type | `t:deck`, `t:move`, `t:filter`; *Create* offers what fits where you are |
| The Inspector shows whatever is selected | the card panel, generalised to any asset |
| Labels across folders | tags on assets, possibly as an alternative or complement to the tree |

**Naming a set in a query.** Card search extends Scryfall's syntax the way
`cmdr` does: `:ramp` means "in the ω set named `ramp`". A typed name has to
become a reference. Two marks, each answering one question, the way Excel
marks `$`:

- **`&`: does it follow the target?** Without it, **pinned**: it follows
  the set. With it, **by name**: whatever is at that path when the query
  runs.
- **A leading `/`: anchored where?** With it, **rooted**. Without it,
  **relative** to where the query lives, and downward only.

| | The target moves or is renamed | The query's owner moves | The owner is copied | Another set takes the target's old path |
| --- | --- | --- | --- | --- |
| `:/staples/ramp` pinned, rooted | followed: rewritten | unaffected | the copy points at the *original's* set | ignored |
| `:ramp` pinned, relative | followed while it stays below the owner; if it leaves, becomes rooted | still its own | the copy points at *its own* | ignored |
| `:&/staples/ramp` by name, rooted | not followed: means whatever is there | unaffected | same path | picked up |
| `:&ramp` by name, relative | not followed | still its own | the copy's own: a template checklist's `:&ramp` finds each deck's own ramp | picked up |

**Typing a bare name searches.** `:ramp` as typed is looked up by name, then
stored as a pinned reference: relative when the set is below the query's
owner, rooted otherwise. The same tables, for the library file, are in
[`library-format-5.md`](library-format-5.md) → *References*.

- **Pinned is the default** because most queries become saved state — live
  pools, checklists, deck pools — and saved state should not break when a set
  is renamed. It is also the path rule above. A `cmdr` file pasted in means the
  same, since within one file binding early and binding late agree.
- **Pinning happens as you type.** No set by that name is an error, or an
  offer to create one. Two sets by that name: take the nearest or ask, then
  render enough path to tell them apart. A pinned set later deleted shows as
  broken, like Excel's `#REF!`, rather than matching nothing.
- **`&` is for what pinning cannot do**: a set that does not exist yet, and
  `cmdr`'s open definitions (`<<`), where several definitions add to one name.
- **The token says which references a rename rewrites**: pinned ones are
  rewritten, `&` ones never are. None needs an identifier.

**Facets: implicit assets.** Some assets come with every asset of a type:
derived, never stored, never made by hand. They are **facets** of their
asset, written as a suffix: `/` is *contains*, `.` is *derived from*.

| Facet | Is |
| --- | --- |
| `MyDeck.arranged.by_mana`, `.by_type`, `.by_colour` | automatic arrangements of a decklist |
| `MyDeck.oracle` | the decklist's oracle projection (*Every decklist has an oracle projection*) |
| perhaps `Binder.surplus`, `Wishlist.missing` | derived from goals and contents (*Plans*) |

- **The ontology declares them.** Each type says which facets its assets
  have; facet names are identifiers from code (`by_mana`), not user names.
- **A facet holds nothing.** It is not a place in the tree, so nothing sits
  under it. The tree may show an asset's facets, set apart.
- **Facets chain** where the facet's own type declares facets:
  `MyDeck.oracle.arranged.by_type` arranges the oracle projection.
- **Referenced like any asset.** Relative to its owner, a facet starts with
  the dot: a deck's `shows = ".arranged.by_mana"` is its own, and a copied
  deck's is the copy's. A facet never moves or is renamed on its own, so
  pinned and by-name references to one differ only as relative and rooted
  do.
- **Materialise to edit.** A facet cannot be edited; copying it makes an
  ordinary asset that starts as an exact snapshot, as rendering a live pool
  to a literal one does.
- **Never in a library file.** A dump skips facets, so adding one needs no
  new version.

All Magic stays a built-in asset of its own, not a facet.

**Quoting in paths.** A path segment containing anything special — `.`,
`/`, `&`, `:`, a quote, or a space where the context needs one — is wrapped
in quotes, as Windows quotes a path with spaces; a quote inside a name is
doubled. An unquoted `.` always starts a facet.

```
/Decks/"Atraxa v1.2".arranged.by_mana
/Binders/"St. Louis"/"Trade/Keep"
```

So names can hold any character, and the text alone says what a path
means: reading one never depends on the asset's type. Queries needed a rule
for names with spaces anyway (`:"Atraxa v1.2"`), and it is the one Scryfall
syntax already uses for values (`o:"draw a card"`).

## Sources and targets

How a view's cards reach another asset. Two roles, and one operation
between them.

**The source is the view you are in.** A tile hands over the bucket it
stands for, whole: printing, finish, attributes, as the source has them.
From All Magic or a query pool that is what the grain says — the card at
Cards, the printing at Printings; from an asset, the line itself. The
target never guesses what a tile meant.

**The target is set in the tree** (*Set as target*), and is what a tile's
buttons act on. Its type decides what they do:

| Target | `+` | `−` |
| --- | --- | --- |
| list pool | the bucket becomes a member (`+`) | it stops being one (`×`) |
| checklist, exact checklist | the line asks for one more, made at 1 | one fewer, gone at 0 |
| place | one more copy in that bucket | one fewer, gone at 0 |
| place, from another place | one copy **moves** to the target (`→`) | one moves back (`←`) |

A copy is in one place at a time, so place to place is never *add*. A
step is one; copying a whole line or asset is an action of its own. Viewing
the target itself is editing it. A decklist is not a target: its zones are.

**How an asset is drawn**, so a tile can always say which bucket it is:

- **A checklist, a tile per line.** Its lines can overlap — at least four
  Bolts, at least one of them M10 — so a card's total is a number nobody
  asked for (*Checking a deck against its decklist*). No grain toggle.
- **A place or a pool, a tile per card.** A place's lines are disjoint, so
  its total means something. A tile standing for one bucket has its
  buttons; one standing for several has them greyed, and the bucket is
  chosen where the card's buckets are listed — the detail, beside the
  wall.

**Changing a bucket is one operation: move n of B to B′.** B loses n, and
is gone at 0; n of B′ join any B′ already there. It covers setting,
changing or clearing a printing, finish or attribute — clearing is how a
guess is taken back — for all of a line or a split of it; and, between
two places, a copy moving. B′ is the same card; a printing must be of it,
and a finish one it comes in. A pool has no counts: its member is B or
B′, whole.

**Attributes start as a fixed set** — condition, signed, altered, note —
declared on first use, so keys do not drift. Language is not one: it is
part of the printing.

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
- **Arrangements:** whether a card may sit in more than one pile of one
  arrangement. That arrangements are assets of their own is settled (see
  *Decks*, and [`library-format-5.md`](library-format-5.md)).
- **The ontology of asset types.** Every asset's type is a node in a
  static is-a graph, fixed in code; users do not add types. The relations
  this doc states as facts become its edges: a place is a refinement of an
  exact checklist, a pool a special case of a checklist, a list pool and a
  query pool each a pool. A node may have more than one parent, likely
  rarely (a physical deck is a place, and refines a decklist). Binder, box
  and the like are not types but a free-text storage note on a place,
  which picks the icon. The library file names one node per asset and
  never the hierarchy ([`library-format-5.md`](library-format-5.md)).
