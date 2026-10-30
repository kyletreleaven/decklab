# Card sources

How All Magic and your collections became one kind of thing, shown by one
panel. The open work that follows from it is in `TODO.md` → *Universe as a
collection*.

## All Magic is a collection

All Magic is an ordinary sidebar entry, pinned first, and opens the same
`PoolPanel` as any collection, backed by Scryfall instead of SQLite. The
separate `CardSearch` and `CollectionView` are gone. Search was All Magic with
a different comparison set, so it is now the All Magic view, which is also the
default view and the fallback after a delete.

This is what the algebra says anyway. A collection's contents and `Universe`
are both `card → quantity` specs, differing in value (a finite map versus the
constant ∞), not in type. Universe must be ∞ rather than 1, or `Min(deck,
Universe)` would cap every entry at one copy. So there is no set-versus-multiset
split to reconcile, only rendering: totals and the quantity sort are not shown
against All Magic. A row of dashes would be chrome pretending to be data.

Universe is virtual: a sentinel `UNIVERSE_ID` in `collections.ts`, not a stored
row, since a `collections` row that can never hold items would be a lie.

## `writable`, not `kind`

*Superseded by [`inventory/README.md`](inventory/README.md).* Which collections count is now a
union of the locations you choose (*Locations and collections*), and
writability follows from what an asset is: locations and goals are stored and
writable, derived collections are not until flattened. Kept as the reasoning
that got there.

`kind` used to do two jobs: user-facing label *and* the thing behaviour was
derived from. That conflation cannot express cases that obviously exist:

- Two paper collections, one of them cards you are **selling**. Same kind, but
  the sale binder should not count as playable.
- A friend's binder imported for **trade reference**. No kind fits; it is not
  yours at all.
- **Loaned out**: you do have them, you just cannot sleeve them tonight.
  Whether they count is the user's call.
- **Cube**: we guessed it counts. Plausible, but a guess made on the user's
  behalf.

The test for what the app may enforce: *does violating it produce nonsense, or
just a number you disagree with?* Writing to Universe is nonsense: there is
nowhere to put the card. "Arena counts toward my paper deck" is a number you
would disagree with, fixed by changing your mind.

So **only `writable` is first-class**; everything else is user metadata.

| Category | Example | Editable |
| --- | --- | --- |
| **Reference data** | card name, set symbol, oracle text, legality | no, cached from Scryfall |
| **Structural fields** | `collection.name`, `deck.format`, `writable` | yes, but required and app-meaningful |
| **User metadata** | tags, notes, colour swatch, game | yes, optional, arbitrary |

`writable` is derived today (`isWritable` in `App.tsx`). `target` is
`touched.find(isWritable)` rather than `touched[0]`, so viewing a read-only
source leaves `+` where it was: "target" means the last thing you touched that
can hold cards.

## Arbitrary user metadata

*Superseded by [`inventory/README.md`](inventory/README.md).* `game` is answered by which
locations a deck is designed against, sidebar `colour` and `icon` belong to
*The asset tree*, and yes/no properties of an asset (archived, favourite) are
total membership, so labels rather than metadata (*Open → Folders*). What
survives is free-form properties on an asset that the app does not reason
about, such as notes.

Everything but `writable` stays user metadata with good affordances rather than
app-enforced semantics. Resist adding a `game` enum the app reasons about: a deck
warning is friendlier than a hard rule, and cheaper to be wrong.

Once everything but `writable` is metadata, enumerating the keys stops being
worthwhile, so allow any. Well-known keys simply get affordances:

| Key | Affordance |
| --- | --- |
| `game` | filter, and a soft warning when a paper deck draws on Arena cards |
| `colour`, `icon` | sidebar styling |
| anything else | shown and editable, no special behaviour |

This dissolves the structured-versus-freeform choice rather than settling it:
structured keys are conventions with UI, not a separate mechanism.

Storage is either a `(entity_type, entity_id, key, value)` table or a JSON column
per entity. The table is filterable ("every collection where game=paper"), which
matters if collections themselves become selectable inputs to the algebra. JSON
is simpler and fine at tens of entities.

## Card annotations are not entity metadata

Your annotations on reference data are yours, but they do not reuse the
entity-metadata mechanism above. "Card annotations" was once one bucket, with
the dead `card_tags` table as its storage; it splits three ways:

| Annotation | Example | Is |
| --- | --- | --- |
| **Tag** | `ramp` | a named ω set: total, so untagged means no |
| **Copy fact** | signed, altered, condition | a user attribute on a bucket: partial, `absent` means unknown |
| **Value on a card** | a note, a rating | not decided |

The first two are settled in [`inventory/buckets.md`](inventory/buckets.md) → *Attributes*, which
also gives the test between them. Scryfall's `oracle_tags` then becomes a
filter-defined ω set, the same pattern as the cached `is:` collections, rather
than half-imported user data. The third is partial like an attribute but at
card grain rather than copy grain, and is often scoped to a deck or collection
("why it is in *this* cube"), a shape the model does not have yet.

## All Magic is the base set

The pool is not a union of two sources. The universe is paged from Scryfall, and
the lit collection only decides which tiles are *un-dimmed*. Dimming is a **set
difference**, so any card set could be the comparison set; there is no "is it a
holding" property. An earlier design argued for one, to stop the universe
becoming the comparison set. That was wrong: All Magic as the comparison set
yields an empty difference, an unhelpful choice but a well-defined one. The UI
simply offers no gesture for it. The All Magic entry declines to `touch`, so it
never becomes the active collection, and nothing dims in the All Magic view.

The local query runs in exactly one case: the deck pool with "Show not in
<collection>" unchecked, where outside cards are genuinely unwanted. That toggle
survives only there. In the collection view it was a second route to a view
already in the sidebar, and it changed grain underfoot.

An earlier shortcut skipped the network when the collection filled a page,
which made the pool silently collection-only for any query a decent-sized
collection could satisfy, and handed *ordering* to whichever side happened to
be non-empty. It was removed.

## Grain follows the stream

The local branch yields `CollectionItem[]`: printing grain, one row per printing
and finish, with a `×` to drop an entry. The Scryfall branch yields cards:
oracle grain. `stepperFor(row)` resolves what `±` acts on from the row's grain,
so a `−` on your foil does not decrement the nonfoil entry that shares its
printing id.

`activePrintings` (oracle id → card) lives in `App`: the card panel picks a
printing, and oracle-grain rows render and write it. Row keys are oracle ids, so
swapping a printing updates a tile in place rather than remounting it and
dropping hover.

## Capability by absence

Universe differs from a collection in what it can do, and those differences are
props that are present or absent, not `if (source === SCRYFALL)` branches or
flags saying "you have this, hide it".

| Capability | Collection | Universe |
| --- | --- | --- |
| writable | yes | no |
| bounded (listable without a filter) | yes | no |
| paged | no, returns everything | yes, 175 per page |
| sort vocabulary | SQL columns | Scryfall's `order=` |

- No `destination`, no stepper. A pool's `±` acts on its destination: the deck
  for a deck-attached pool, by construction, and the current target otherwise.
  The panel never learns whether it is feeding a deck or a collection. Counts
  come from one whole-container query (`deckQuantitiesByPrinting` /
  `collectionQuantitiesByPrinting`), not per-card lookups.
- No `subject`, no collection actions and no header row.
- `compact` is the deck-attached strip, which drops the browsing chrome because
  it is a candidate strip, not a place you browse.

## One box, one language

The search box used to send free text to Scryfall but compile it to
`c.name LIKE '%…%'` for a collection, so `t:creature` silently matched nothing
locally. The options were facets only (losing full Scryfall syntax), Scryfall
syntax everywhere (needing a local parser), or leaving it asymmetric (a silent
failure). The second was taken: the same string goes to Scryfall for All Magic
and through `compileQuery` for a collection, and unsupported terms raise
`QueryError` instead of quietly matching nothing. Facets stay a separate filter
AND-ed with the query. See [`query-language.md`](query-language.md).

## Sort

`src/lib/sort.ts` is one vocabulary for both branches, mapping to Scryfall's
`order=`/`dir=`. `dir` is always explicit, because the default varies by key
(`cmc` ascends, `usd` descends), which a contract test pins. `quantity` has no
remote mapping and drops out whenever a Scryfall stream is in the answer.

The direction arrow shows the direction the sort is *in*, not the one clicking
would give; a control that displays its own outcome reads as a prediction. It
**inverts each sort's useful default** rather than forcing ascending, so "Price"
still opens most-expensive-first and the flip means the same for every key. Only
the primary key reverses; the tiebreaker stays ascending, since paging depends on
one fixed total order. See [`merging-sorted-sources.md`](merging-sorted-sources.md).

## Where controls go

Placement follows what a control acts on. Constraints that AND onto the query
(facets, deck scopes, format legality) live behind "More filters" and count
toward its badge. "Show not in <collection>" stays in the toolbar and out of
that count: it chooses shadowed versus absent, the same axis as the dimming, so
hiding it behind a disclosure would separate the switch from its effect.
