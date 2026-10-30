# Mixed-grain storage

**Partly superseded by [`inventory/README.md`](inventory/README.md):** `absent` is a real
value rather than a nullable `card_id`, `condition` becomes a user attribute,
and zones are collections. This was called migration 004, but
`004_quantity_kind.sql` took that number. Kept for the reasoning.

Design only — not built. Open work is in [`TODO.md`](../TODO.md) →
*Mixed-grain storage*. Why collections are mixed-grain at all, and the
`known`/`unsorted` split, is in [`card-set-algebra.md`](card-set-algebra.md) →
*Collections are mixed-grain*.

## The problem

Both `collection_items` and `deck_cards` require a printing
(`card_id NOT NULL REFERENCES cards(id)`), so neither *"two more copies, printing
unknown"* nor *"one Sol Ring, any art"* is expressible. Decks need this at least
as much as collections: most decklists are oracle-level, and pinning a printing
is the exception.

## Changes, both tables

- Add `oracle_id TEXT NOT NULL`
- Relax `card_id` to nullable, where NULL means *printing unknown / any*
- Replace the UNIQUE constraint with an expression index (see the trap below)

## The trap: SQLite treats NULLs as distinct in UNIQUE

The moment `card_id`
becomes nullable, `UNIQUE (collection_id, card_id, finish, condition)` stops
constraining unsorted rows at all — every add would silently insert a *new*
"unknown printing" row instead of folding into the existing one. So:

```sql
CREATE UNIQUE INDEX idx_items_identity ON collection_items
  (collection_id, oracle_id, COALESCE(card_id, ''), finish, condition);

CREATE UNIQUE INDEX idx_deck_cards_identity ON deck_cards
  (deck_id, oracle_id, COALESCE(card_id, ''), zone);
```

This also permits `1 Sol Ring (C21)` and `1 Sol Ring (any)` to coexist in one
deck, which is meaningful: *"I own one specific art and still need another."*

## Decisions taken

- **One table, not two.** `known` and `unsorted` are a logical split; in
  storage it is one table with a nullable `card_id`. Two tables would double
  every query for no gain.
- **Storing `oracle_id` removes a join.** Collection queries currently join
  `cards` solely to reach it.
- **A representative printing is a display choice, not stored data.** An
  oracle-grained row still needs an image: pick the newest cached printing
  for that `oracle_id`. Safe because we only ever record cards we have
  fetched, so one printing is always cached.

## Migration shape

SQLite cannot relax `NOT NULL` or swap a table constraint in
place, so this is a create-copy-drop-rename rebuild of both tables rather than an
`ALTER`. `oracle_id` backfills from `cards` through the existing `card_id`, so no
data is lost.

## A deck's zones *are* collections — one primitive, not two

`deck_cards` and
`collection_items` are both "container holds N of card X", and the duplication
has already produced four pairs of near-identical functions (`addCardTo…`,
`adjust…Quantity`, `printingQuantitiesIn…`, plus the row types). The unification
is structural rather than cosmetic:

| Layer | What it is |
| --- | --- |
| **Container** | the primitive — `card → quantity`. A collection's contents; a deck's commander zone; a deck's maindeck |
| **Entity** | owns containers. A `Collection` owns one (plus `unsorted`, below); a `Deck` owns several named zones, one of them default |

Two ways to express that. **Leaning A** (below). In one sense they are the
same thing, since either can be read as the other, but `cmdr` suggests that
making zones *be* collections is the simplest choice. There, a tag is not a
third kind of set but a name bound to an ω set, and the same principle applies
here: a zone is not a new kind of thing, it is a collection a deck happens to
own. One primitive, and everything that works on a collection (panels, set
operations, import, export) works on a zone with no extra code. See
[`cmdr.md`](cmdr.md) → *What cmdr settled that DeckLab has open*.

**A — zones *are* containers.** A deck owns several named containers, one
default. `zone` stops being a column and becomes a container's identity.
- One items table keyed by `container_id`, plus a `containers` table naming them
  and pointing at a parent entity
- Containers are addressable: a panel or a set operation can point at "the
  sideboard" as a first-class thing
- Piles may fall out of the same model — they partition a zone the way zones
  partition a deck
- Costs indirection: "the whole deck" becomes a join across its containers, and
  creating a deck creates four rows before it holds anything

**B — a deck *is* a collection, and rows carry annotations.** Closer to what
exists now, since `deck_cards.zone` is already exactly that.
- One container per entity; `zone` sits beside `finish` and `condition` as an
  annotation on the entry
- Annotations generalise for free — tags, acquisition price, "loaned to Dave",
  and arguably the known/unknown printing distinction from mixed-grain storage are all the same
  shape
- Costs addressability: a zone is not a thing you can point at, only a value you
  filter by

**Possible synthesis:** store as **B**, address as **A**. A zone is then
`Filter(container, zone = main)` — which the card-set algebra already gives us,
since a filter over a spec is itself a spec. The touch list would hold *specs*
rather than containers, and "the sideboard" is addressable without existing as a
row. Worth checking whether that collapses the trade-off or just moves it.

Open either way: which discriminators are universal. `finish` plausibly matters
in a deck (you want your foil copy sleeved); `condition` almost certainly does
not.

**Note:** the deck-vs-collection dispatch written for the carousel `±` is a
**stopgap** this model deletes. Behaviour is identical either way, so it was
safe to build and collapse later.
