# Library file, version 5 — proposal

**Status: proposal, not built.** The library file for the new model
([`inventory.md`](inventory.md)), to replace v4 ([`lab.md`](lab.md) → *The
library file*) as the format the lab loads and dumps.

## Why a version of its own

v4 is a picture of schema 4: one file version per database schema. This
version is meant to **outlive many schemas**. It describes the user's data —
cards in places, decks, checklists, pools — not how the tables lay them out.
So:

- **The lab schema can change freely.** After a schema edit the lab reloads
  from a file; nothing is migrated. A seed replaces the lab's data; without
  one, the lab keeps what it had from the last run.
- **Each schema has its own load and dump**, against this one format.
  `load(dump(db)) = db` stays the test of both.
- **The format changes rarely, and only by one-shot conversion**, file to
  file: `decklab convert`. The first is v4 → 5, below.

The key changes from `schema` to `version`, to say which it is:

```toml
format = "decklab-library"
version = 5
```

**What changes the version.** An addition (a new asset type, a new optional
key) does not: old files still load. A change of meaning does, and comes
with a conversion. A loader refuses keys it does not know, so a typo in a
hand-written file is an error, not something silently ignored.

## Assets

Every asset is one `[[asset]]` table, in tree order: a parent before its
children, siblings in the order they sit. One array rather than one per
type (`[[place]]`, `[[deck]]`), because TOML parses separate arrays
separately and the order across them would be lost.

```toml
[[asset]]
path = "/Paper/Binder 2"
type = "place"
storage = "binder"
notes = "Blue rares"
created = 2026-03-01T14:02:11.000Z
updated = 2026-10-20T09:15:40.000Z
```

- **`path`** is the identity: no ids in the file (`inventory.md` → *The
  asset tree*). Load assigns fresh ones. A segment with a special character
  is quoted (`inventory.md` → *Quoting in paths*), so paths are written as
  TOML literal strings, in single quotes, and nothing needs escaping:
  `path = '/Decks/"Atraxa v1.2"'`.
- **Facets are never written** (`inventory.md` → *Facets*): a dump skips
  them, and a facet can be referenced but not defined.
- **Folders are implied.** A segment of a path with no asset of its own is a
  folder. An explicit `type = "folder"` is needed only for an empty folder,
  or one with notes.
- **`type` names one node of a static ontology**, in users' words: `place`
  (a location), `checklist` (a goal), `pool`, `list pool` and `query pool`
  (ω sets), `deck`, `arrangement`, `folder`. Later, without a version change: `union`,
  `move`. The ontology is an is-a graph fixed in code and described in
  [`inventory.md`](inventory.md); a node may have more than one parent,
  though that should be rare. The file never encodes the hierarchy: it names
  one node, so the graph can be reshaped without changing the format. Users
  do not add types.
- **A general node is allowed where the structure decides.** `type =
  "pool"` with a `query` key loads as a query pool. The keys must be valid
  for the named type or one of its descendants; a mismatch is refused.
- **`created` and `updated`** are optional. Dumps write them; a hand-written
  scenario leaves them out, and load uses the time of the load. This settles
  the *timestamps in scenarios* question in `lab.md`.

## Card lines

A card line is a **bucket and a count**. One rule replaces v4's defaults:
**a key left out is `absent`.** v4 left out `finish = "nonfoil"` because
it was the default; in v5, leaving out the finish means *finish not
recorded*. Nothing is filled in on load.

```toml
{ card = "Sol Ring", oracle = "6ad8011d-3471-4369-9d68-b264cc027487", qty = 2 }
{ card = "Sol Ring", oracle = "6ad8011d-…", qty = 1, set = "c21", number = "263", finish = "foil" }
{ card = "Sol Ring", oracle = "6ad8011d-…", qty = 1, set = "cmr", number = "472", attrs = { condition = "LP" } }
```

| Key | Is |
| --- | --- |
| `card` | the name: for reading, and a check |
| `oracle` | Scryfall's oracle id: the card. Names change; this does not |
| `set`, `number`, `lang` | the printing: all or none. `lang` only when not English |
| `finish` | `nonfoil`, `foil`, `etched`, … Can be known without the printing |
| `attrs` | user attributes, sparse |
| `qty` | the count; what it means depends on the asset (below) |
| `added` | when, optional, as for assets |

- **`oracle` is written by every dump.** A scenario may leave it out, and
  load finds the card by its exact name; a name that matches no card, or
  more than one, is refused. That lookup goes through the card store, so it
  may cost a request, once.
- **The name is checked** against the oracle id, and against the printing
  when there is one, as v4 does.
- **User attributes go under `attrs`**, never beside the reserved keys, so
  a user attribute named `set` or `qty` cannot collide with them.
  They are declared once, per file:

```toml
[attributes]
condition = "condition"   # the built-in ordered type: M, NM, LP, MP, HP, DMG
note = "text"
```

## Per asset type

**A place** holds residual counts: `qty` is how many copies are known
exactly this much about.

```toml
[[asset]]
path = "/Bulk box"
type = "place"
storage = "box"
cards = [
  { card = "Sol Ring", oracle = "6ad8011d-…", qty = 2 },
]
```

`storage` is a free-text note, the user's word for it (binder, box, drawer,
deck box). It picks the icon and means nothing else: a description like
`notes`, not a type, so there is no second tier of classification.

**A checklist** holds intervals. `qty = n` is exactly *n*; `min` and `max`
give the others, and either may be left out. A bucket here is a pattern:
left out means *any*, not *unknown*.

```toml
[[asset]]
path = "/Wishlist"
type = "checklist"
on = "/Paper"            # checked against this collection
unlisted = "any"         # or "excluded"
cards = [
  { card = "Mana Crypt", oracle = "…", min = 1 },
]
```

**`unlisted` is the background the items sit on**, not a property of the
checklist: `"any"` is All Magic (`[0, ∞]` for every card), `"excluded"`
the empty pool (`[0, 0]`). Listed items override the background card by
card. Later, without a version change, it can take a reference to any pool:
*blue rares and nothing else* is a checklist with no items over the pool
`c:u r:rare`, which is the filing rule in `inventory.md` → *Goals*.

**A pool** is membership only, so its lines have no count. It is a **list
pool**, with `cards`, or a **query pool**, with `query`: two types in the
ontology. Written `type = "pool"`, the key decides which; a pool with both
keys, or neither, is refused.

```toml
[[asset]]
path = "/pools/ramp"
type = "pool"
cards = [ { card = "Cultivate", oracle = "…" } ]

[[asset]]
path = "/pools/cheap blue"
type = "pool"
query = "c:u usd<1"
```

**A deck** is a decklist: zones and a format. Piles are not part of it but
an *arrangement*, an asset of its own (below). Zones are a deck's
concept, and only a deck's: it maps each zone name (`commander`, `main`,
`side`) to the checklist that fills it, and format checks run across them.
**Every zone is a checklist asset**, and the deck always refers to it.
*Inline* is only how the file writes the common case: a list of lines in
place of a reference.

```toml
main = [ { card = "Sol Ring", oracle = "6ad8011d-…", qty = 1 } ]
```

means a child checklist at `<deck>/main`, with `qty` exact and unlisted
cards excluded (which is what a decklist is, so neither is written), and
the deck's zone `main` a pinned relative reference to it.

```toml
[[asset]]
path = "/Decks/Atraxa Superfriends"
type = "deck"
format = "commander"

[asset.zones]
commander = [
  { card = "Atraxa, Praetors' Voice", oracle = "…", qty = 1, set = "2xm", number = "190" },
]
main = [
  { card = "Sol Ring", oracle = "6ad8011d-…", qty = 1 },
]

[[asset]]
path = "/Decks/Atraxa Superfriends/maybe"
type = "checklist"
unlisted = "any"
cards = [ { card = "Doubling Season", oracle = "…", min = 1 } ]

[[asset]]
path = "/Decks/Atraxa Superfriends/piles"
type = "arrangement"
of = "/Decks/Atraxa Superfriends"
piles = [
  { name = "Ramp", cards = [ { card = "Sol Ring", oracle = "6ad8011d-…" } ] },
  { name = "Draw", query = ":draw" },
]
```

So the tree under the deck holds `commander`, `main`, `maybe` and `piles`.

**An arrangement** lays a decklist out on screen: an ordered list of named
piles over the decklist's cards, with *Unsorted* for what is left. It is how
the deck is shown, not what it holds, so one decklist can have several: by
type while building, by role while tuning, a sideboard plan.

- **`of` names the decklist**, as the model says an arrangement does
  (`inventory.md` → *Decks*). It points up, which a relative reference
  cannot, so a dump writes it rooted; pinned, it follows the deck anyway.
- **A pile lists buckets without counts**, like a list pool, so every copy
  in one bucket sits in the same pile (two printings of a card can sit in
  two piles, as `deck_cards.pile_id` allows today); or it has a `query`
  instead, so an automatic arrangement stays live.
- **Which arrangement a deck shows** is the first one under it, unless the
  deck says `shows = "by role"`, a pinned relative reference. It can name a
  facet as well: `shows = ".arranged.by_mana"`. Whether a deck with no
  arrangement of its own shows a facet by default is open.

**The maybeboard is not a zone.** It is an ordinary checklist (unlisted
cards allowed, `min` counts) that happens to sit under the deck, which does
not refer to it (`inventory.md` → *Decks*). Being its child is only
tidiness: a folder sums nothing. Anything else beside a deck, a sideboard
plan for a later build, say, is the same.

A physical deck, a place tied to the decklist, is left until the model
needs it; it would be a `place` with `builds = "/Decks/Atraxa Superfriends"`,
and zones of its own that are places.

**When a zone is written inline.** For a dump to be lossless, exactly when
all of these hold:

- the zone's checklist is a direct child of the deck, named after the zone;
- the deck refers to it pinned and relative (`main`);
- it has a decklist's defaults (exact counts, unlisted excluded) and nothing
  of its own: no notes, no children.

Otherwise the checklist is written as its own `[[asset]]` and the zone as a
reference. Renaming the child (`main` → `core`) is followed by the pinned
reference, so the deck keeps working, and the next dump writes
`main = "core"` with the checklist as a block. Moving it out from under the
deck is the same: it was always its own asset, the reference becomes rooted
(*References*), and the deck plays the same cards. Only the file layout
changes.

A deck with **referenced zones**, one shared core and its own commander:

```toml
[[asset]]
path = "/Decks/Atraxa Superfriends"
type = "deck"
format = "commander"

[asset.zones]
commander = "&commander"                    # whichever child is called that
main = "/Cores/Superfriends core"           # pinned: follows the core if it moves
side = "&/Sideboards/current"               # whatever sits at that path
```

A deck whose zones are all `&` references to its children is the
*conventional* deck of `inventory.md` → *Decks*: it needs no type of its
own. No *extract zone* action is needed either: an inline zone is already a
checklist in the tree, and another deck can refer to it as it is.

## References

An asset names another by path. Two marks, each answering one question, the
same as in a query (`inventory.md` → *Naming a set in a query*):

- **`&`: does it follow the target?** Without it, a reference is
  **pinned**: it follows the asset. With it, **by name**: it means whatever
  is at that path when used.
- **A leading `/`: anchored where?** With it, **rooted**. Without it,
  **relative** to the referrer, and downward only: its children and their
  descendants, never `..`.

So four spellings, and what each does, by who moves:

| | The target moves or is renamed | The referrer moves (its children with it) | The referrer is copied | Another asset takes the target's old path |
| --- | --- | --- | --- | --- |
| `/x` pinned, rooted | followed: rewritten | unaffected | the copy points at the *original's* target | ignored |
| `x` pinned, relative | followed while it stays below the referrer; if it leaves, becomes `/x` | still its own child | the copy points at *its own* child | ignored |
| `&/x` by name, rooted | not followed: means whatever is there, maybe nothing | unaffected | same path as the original | picked up |
| `&x` by name, relative | not followed | still its own child | the copy's own child | picked up |

Pinned against by name matters only when the target moves or is replaced;
rooted against relative, only when the referrer is copied, or a pinned
target leaves its subtree.

- **Pinned references are resolved once**, after load has read every
  asset, since a reference may name an asset further down the file. A
  pinned path to nothing is refused. A dump writes each as the target's
  current path: relative while it is below the referrer, rooted otherwise.
- **By-name references are kept as text**, resolved each time they are
  used, and may name nothing yet.
- **Facets** are referenced the same way. A relative reference starting
  with `.` is a facet of the referrer (`.arranged.by_mana`), a rooted one a
  facet of the asset it names (`/Decks/"Atraxa v1.2".arranged.by_mana`).
- **Upward relative paths** could be allowed later: an addition, not a
  change of meaning. `.` and `..` are reserved as names, so `..` can never
  be read as a facet.

## v4 → 5: `decklab convert`

Pure, file to file, testable on a real dump. It applies the mapping in
`inventory.md` → *Mapping today's data*, and **reports every loss** rather
than burying it.

| v4 | v5 |
| --- | --- |
| a collection | a `place` at `/<name>`; no inference from `kind` |
| `kind` | dropped: it is not storage (`paper`, `wishlist`, `loaned`, …). Anything other than `paper` is listed in the report, for converting by hand (a wishlist wants to become a checklist) |
| `quantity_kind = "binary"` | a `place`, and listed in the report (it probably wants to become a pool) |
| `finish` | **dropped**: `absent` everywhere. The report counts rows with a finish other than `nonfoil`, per collection |
| `condition = "NM"` | `absent` |
| any other condition | `attrs = { condition = … }`, with the attribute declared |
| an item's `notes` | `attrs = { note = … }`. A distinct note makes a distinct bucket, as it made a distinct row in v4 |
| a deck | a `deck` at `/<name>`, printings kept; `commander`, `main` and `side` as inline zones |
| the `maybe` zone | not a zone: a child checklist, `/<deck>/maybe`, unlisted cards allowed, each line `min = qty` |
| piles | one arrangement per deck, `/<deck>/piles`, `of` the deck, piles in their order, each listing its cards; a card's `pile` moves off its line |
| tags (`card_tags`) | one literal pool per tag, at `/pools/<tag>` |

- **Oracle ids come from the card store**, read-only, by printing. Convert
  sends **no requests**: a printing missing from the store is reported and
  its line written without `oracle`, for load to resolve by name.
- **Names are kept as they are.** One with a `/`, a `.` or a quote is
  quoted in its path, not renamed. Only a name that is exactly `.` or `..`
  is renamed, and reported.
- **Duplicates.** Two v4 rows that become one bucket (the same printing in
  two finishes, now both `absent`) are merged into one line with the counts
  summed, and the report says so.

## Open

- **Ids for cards beyond the oracle.** The printing is set, number and
  language, as in v4; Scryfall's printing id would be shorter, but it is an
  identifier where properties do.
- **Unions** (Paper as the sum of its places): which shape `of = [paths]`
  takes, once the model needs them. v4 has none to convert.
- **Assets defined from other assets** (a checklist over a pool, a deck over
  its zones, a union over places). When backgrounds other than the two
  extremes exist, "override card by card" needs care where buckets overlap
  (*Sol Ring ≥ 3* beside *Sol Ring C21 ≥ 1*). The ontology itself is open
  in [`inventory.md`](inventory.md) → *Open*.
- **Whether one file holds several inventories** (yours, and a friend's
  binder) or each is its own file.
- **The record.** As in `lab.md` → *Open*: with this format stable, the file
  could become the record and SQLite a cache rebuilt from it.
