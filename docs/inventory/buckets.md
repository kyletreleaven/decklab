# Buckets

Part of the inventory model; the overview is [`README.md`](README.md).

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
that would make containment mean something, which [`asset-tree.md`](asset-tree.md) → *The asset tree* rules
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
4. **Draw** by the asset's own display rules ([`asset-tree.md`](asset-tree.md) → *Sources and targets*).

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
[`query-language.md`](../query-language.md) → *Field mapping*. The finish and
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

