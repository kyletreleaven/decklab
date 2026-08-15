# DeckLab — roadmap

Legend: ✅ done · 🚧 partial · ⬜ not started

**Stack:** Tauri 2 · React 19 + TypeScript · SQLite (`tauri-plugin-sql`) · Scryfall.
All logic lives in TypeScript; Rust handles file I/O only (image cache, file
read/write). Data lives in `~/Library/Application Support/com.decklab.app/`.

**Storage note:** DuckDB was deferred, not rejected. When §7 Discovery arrives with
corpus-scale data, DuckDB can `ATTACH` the existing SQLite file in place — no
migration. See the reasoning in git history.

---

## Shipped

### Deck builder
- ✅ Card search against Scryfall (full Scryfall syntax passes straight through)
- ✅ Visual card grid with locally cached images
- ✅ Click to inspect, double-click / `+` to add
- ✅ Card detail rail: oracle text, legality, prices, colour identity, owned copies
- ✅ Decks: create / rename / delete, commander + 99, quantities, zones
      (commander / main / side / maybe)
- ✅ Grouped list view by card type
- ✅ **Piles view** with drag-and-drop between columns, persisted per deck;
      auto-arrange by type or mana value
- ✅ Deck stats bar: card count, average MV, curve, colour identity, estimated value
- ✅ Commander rules checks (singleton, colour identity, banned, 100 cards) —
      advisory only, never blocks an edit
- ✅ Autosave (every edit writes through to SQLite immediately)

### Collections
- ✅ Multiple collections with kinds (paper / Arena / MTGO / cube / loaned / wishlist)
- ✅ **Card wall** and list views
- ✅ Facet filtering: colour, type, rarity, mana value range, name — all pushed
      into SQL, so it scales past tens of thousands of rows
- ✅ Sort by name / MV / quantity / price
- ✅ Smart ownership: deck-vs-collections with exact-printing *and* playable
      (any-printing) counts, plus per-printing breakdown
- ✅ Missing-card summary per deck

### Import / export
- ✅ Import from paste, file, or URL — all through one parser
- ✅ Formats: Arena, MTGO, Moxfield, Archidekt, plain lists, CSV
      (Moxfield / ManaBox / Deckbox / Archidekt header dialects)
- ✅ Preview with matched / unmatched counts before committing
- ✅ Two-pass resolution: exact printing first (Scryfall id, or set + collector
      number), then name fallback
- ✅ URL import: Archidekt via their API
- ✅ Export: plain text, Arena, CSV — copy to clipboard or save to file
- ✅ Moxfield binder workaround (`scripts/moxfield_binder_to_csv.py` +
      `docs/importing-moxfield.md`) — Moxfield blocks automated fetching

### Infrastructure
- ✅ Incremental card cache — anything seen is searchable offline afterwards
- ✅ Image cache on disk via Rust, served through Tauri's asset protocol
- ✅ Versioned migrations (001 schema, 002 piles, 003 oracle fetch stamps)
- ✅ Test suite — 48 tests over the parser, serialisers and deck analysis
- ✅ `npm run tauri build` produces a 7.5MB DMG

---

## Next up

### Card panel layout

The rail used to read image → name → oracle → details → legality → owned →
actions, burying the two things deckbuilding needs behind two screenfuls of
reference data.

**Done (bite 1):**
1. ✅ **Ops** — add to deck / collection plus a compact owned count, *sticky* at
      the top so it stays reachable however far you scroll.
2. ✅ Owned count scoped to *ownable* kinds — `wishlist` and `loaned` excluded.
      (Real answer is still selection-as-scope, below.)

**Done (bite 2): the printings carousel, and details split by grain.** ✅

The details block conflates two grains, which is why it wants splitting:

| Oracle-level — stable across printings | Printing-level — varies |
| --- | --- |
| type line, mana cost, oracle text | set name + code, collector number |
| mana value, P/T, loyalty | rarity |
| colour identity | price (usd / foil) |
| legality | artist, frame, promo type |
| EDHREC rank | finish availability |

**The carousel wraps the image rather than sitting beside it**, and drives the
printing-level fields around it. So it is not a picker bolted on — it is the
panel's mode control.

- ✅ Prev/next around the image; the image *is* the carousel viewport
- ✅ A combo box to jump straight to a printing, as an alternative to stepping
- ✅ A toggle for **owned printings only** vs **all printings**
- ✅ Printing-level fields update with the selection
- ✅ Per-printing counts, which subsume the standalone copies block
- ✅ Labels carry the collector number and variant traits. Set name alone was not
      enough: Sol Ring has 30 Secret Lair printings, so without it the list
      looked like it was repeating itself.
- ✅ Loads from the local cache first so it draws instantly, then refreshes from
      Scryfall behind it.

**The printless state waits for the mixed-grain migration.** A "clear" control
returning to oracle grain is the right idea, but its whole point is to change
what the ops row *writes* — cleared means "add any printing" — and storage cannot
represent that yet. Shipping it earlier would put a button on screen that changes
only which fields you are reading, which is worse than not having it.

- ⬜ The cleared state still has to show *an* image. Use the newest cached
      printing, and label it so it is not mistaken for a selection.

### Active slots and hover — selection, narrowed

The smallest useful slice of *Selection as shared context* (below), and the piece
that unblocks the carousel's `+/-`.

**One ordered touch list, not separate slots.** Every deck or collection you
click goes to the front of a single most-recent-first list. Everything else is
derived:

| Wanted | Derived as |
| --- | --- |
| active deck | first deck in the list |
| active collection | first collection in the list |
| target (where a bare `+` sends) | first entry, whichever kind |

- ✅ Ordering matters precisely because we need "last deck **or** collection
      touched" — a pair of independent slots cannot answer that without an extra
      discriminator, and the list answers it by construction.
- ✅ Deleting a deck or collection removes it from the list.
- ✅ Opening a deck no longer evicts the active collection, which the single
      `target` used to do — and browsing printings *while* building a deck is
      exactly when recording ownership matters.
- ✅ Sidebar shows both levels: a ring for active-of-its-kind, a filled dot for
      the overall most recent (where a bare `+` lands).
- ⬜ `activeCard` as a durable slot of its own. Hover currently overlays the
      *selected* card, which is the same thing in practice; a separate slot only
      matters once selection grows to hold cards alongside decks and collections.

**Hover overlays the active card:**

```
panel shows  =  hoveredCard ?? activeCard ?? empty
```

- ✅ **The panel updates immediately.** The card object is already in hand from
      the grid, so re-rendering costs nothing and card-to-card feels instant.
- ✅ **No debounce.** The eviction scheduler below made it unnecessary — and
      better, since eviction adds no latency where a debounce would delay even a
      cached card. Wired at all six render sites: search grid, pool, collection
      wall and list, deck rows, piles.
- ✅ Clearing hover is deferred ~80ms. Moving between adjacent cards fires
      leave-then-enter as two separate events, which React does not batch, so an
      immediate clear flashed the selected card in between.
- ✅ Cards already fetched are free regardless, since printings are memoised.
- ✅ Hover drives the **whole** panel, ops and carousel included. An earlier
      worry that controls would shift under the cursor was unfounded: the cursor
      can only be in one place, so reaching the rail ends the hover and reverts
      to the active card before any click is possible.
- ✅ **Hover is non-destructive.** The chosen printing is remembered per oracle
      id, so sweeping across a grid and back does not discard a printing you
      picked. Without this, hover silently undid a deliberate choice.
- ⬜ Verify the 80ms grace period feels seamless in practice. If a flicker of the
      selected card shows while sweeping, that is the dial.

**Where state lives.** Three categories, and the category decides the home:

| Kind | Lives in | Survives | Examples |
| --- | --- | --- | --- |
| **Preference** | durable app state | everything | wall/list, sort, pool source, list/piles, **owned-only** |
| **Object-bound** | the component | nothing — resets with its object | selected printing, a collection's facet filters |
| **Derived / expensive** | a cache keyed by its input | as long as the key is valid | search results, printings, ownership counts |

The test for the first two: *if the object changes, does this setting still mean
the same thing?* Wall-vs-list means the same for any collection; a selected
printing is meaningless for a different card.

The third row is not state at all, which is why lifting it would be the wrong
shape. Search results should be cached **by query** — returning to a search then
re-renders instantly from cache and can refresh behind you — following the
pattern printings already use.

The rule matters because it says *which* state needs rescuing. Two concrete jobs:

- ✅ **Moved `ownedOnly` out of the per-card reset.** It sat in the same effect
      that resets the selected printing, so switching it on and then changing
      card silently switched it off.
- ⬜ **Panels are conditionally rendered, so navigating unmounts them and
      destroys every preference.** Audited:

  | Panel | Lost on navigation |
  | --- | --- |
  | CardSearch | **query and results** — search, go add something, come back to an empty box |
  | PoolPanel | source, filters, deck-scope toggle |
  | CollectionView | wall/list, sort, filters |
  | DeckView | list/piles |

  **Decided: lift preferences, cache derived, leave object-bound local.**
  Each piece of the state above gets classified by the table and moved to its
  home. CardSearch's `query` lifts as a preference; its *results* do not — they
  become a cache keyed by query.

  Rejected: keeping panels mounted and toggling visibility. It is nearly free and
  would preserve scroll position too, but every hidden panel's effects keep
  running — the pool would go on querying behind a deck view — and it preserves
  state indiscriminately rather than forcing the classification, which is the
  part that actually stops these bugs recurring.

**Carousel `+/-`.** ✅ Adjusts the quantity of the *shown printing* in the
current target, with the count between the buttons.

- ✅ Targets whichever deck **or** collection was touched most recently, not just
      collections. For a deck this means the maindeck — the default zone, which
      is the one answer that does not depend on how zones get modelled, so it
      does not prejudge the container question below.
- ✅ `adjustCollectionQuantity` / `adjustDeckQuantity`: fold into an existing row,
      delete at zero, return the new count. Needed because the add-only paths
      required an item id the carousel does not have.
- ✅ Disabled with a hint when nothing has been touched yet.
- ✅ Did **not** need the mixed-grain migration — adding a specific printing is what the
      current schema stores well. Only the printless case needs the mixed-grain migration.
- ✅ **Counts are stated against one named scope.** `2 in Paper` rather than a
      vague `7 owned`, falling back to all ownable collections when none is
      active, with the wider total shown alongside when copies live elsewhere.
      Also dropped the unlabelled `3×` badge on the artwork: it sat inches from
      the stepper meaning something different.
- ⬜ Choosing *which* zone the `±` writes to. Needs zones to be addressable,
      which is exactly the open container question.

**Panel state retention** — deck, collection and search panels keeping their
internal state across navigation — is a larger, separable piece spread across
four components. The carousel needs none of it: it is never navigated away from,
so its state is purely object-bound.

### Persist the printings TTL — migration 003 ✅

**The gap it closed.** Card rows always persisted — `fetchPrintings` writes every
printing through `cacheCards`. What did not was the knowledge that a print run is
**complete**, so after a restart we could not tell "3 printings cached because
that is all there are" from "3 because that is all we happened to meet", and
refetched to be safe.

```sql
CREATE TABLE oracle_fetches (
  oracle_id            TEXT PRIMARY KEY,
  printings_fetched_at TEXT NOT NULL
);
```

- ✅ Stamped on a successful full fetch, and read before going to network.
      Lookup order is now memo → disk → network.
- ✅ Stamp written *after* `cacheCards` succeeds, so a part-way failure leaves
      the run marked incomplete and it gets refetched rather than trusted.
- ✅ TTL of a week. New sets arrive every few weeks and nothing else about an
      existing print run moves, so this is generous rather than aggressive.
- ✅ The in-memory memo stays in front — it saves even the SQLite round trip
      within a session; the table is what survives restarts.
- ✅ Numbered 003, not 004: sqlx applies migrations in version order, so adding a
      lower-numbered one afterwards invites trouble. Mixed-grain storage moved
      to 004 since it ships second.
- ⬜ Prices ride on the same card rows but move daily, unlike print runs, so they
      want their own short TTL rather than inheriting the week. **Deferred** —
      stale prices are a cosmetic problem, not a correctness one.

**Not a gap today: `/sets`.** `set_name` comes free on every card object, so
nothing fetches `/sets` at all. It only becomes necessary alongside the CSV path,
which is deferred to the backlog — see *Compact printing rows and the CSV path*.

**Not verified:** the actual absence of network calls, which needs the devtools
Network tab. What is verified is that the migration applied, stamps are being
written, and the disk-first branch exists.

### Card data fetching — two tiers, one throttled queue

The goal is **responsiveness**, which means minimising *round-trips* on the path
the user is waiting on — not minimising bytes, and not pre-downloading
everything.

**Tier 1 — fast, on demand.** ✅ One JSON request populates a card's whole
carousel, cached for a week.

```
/cards/search?q=oracleid:X&unique=prints
```

- ✅ Per-oracle TTL, persisted — migration 003 above. Lookup is memo → disk →
      network, so a print run seen last week costs no request today.
- ⬜ Store as **compact printing rows** rather than the raw payload. A card
      object is ~5 KB of which only ~5% is card text and stats; the rest is
      affiliate links, API self-references and eleven image URLs. Compact rows
      are ~700 bytes. Currently ~5,800 printings × 5 KB ≈ 27 MB on disk.
      See the CSV section below — the two are the same piece of work.

**Tier 2 — robust, background.** Everything heavier, none of it blocking:

- ⬜ Image *downloads*, strictly for the printing on screen. Sol Ring's full
- ⬜ Image *downloads*, strictly for the printing on screen. Sol Ring's full
      print run would be **11 MB of art** if fetched eagerly.
- ⬜ Optional idle backfill scoped to cards in collections and decks

**One queue, two priority lanes.** ✅ Built — `src/lib/scheduler.ts`. Scryfall's
rate limit is per *client*, not per connection, so extra connections buy nothing
and risk a 429. What is needed is preemption, not parallelism:

- ✅ A single scheduler holding the ~100 ms spacing, measured from the last
      request *start* so a slow response does not add its own latency to the gap
- ✅ **Interactive lane** — hover, click, search — preempts background work
- ✅ **Interactive is LIFO and evicting.** Depth 1, so a stream of hovers
      collapses to the newest; the abandoned ones never run.
- ✅ **Eviction is keyed, per kind of request.** This was the one real
      correction to the spec: depth-1 across *all* interactive work would have a
      search and a printings lookup silently kill each other. Each kind gets its
      own slot.
- ✅ **Background lane stays FIFO and is never evicted.** Import batches live
      here — each 75-card chunk carries distinct cards, so dropping one loses
      data outright.
- ✅ Superseded requests reject with a distinct error that every call site
      ignores, rather than surfacing as a failure.
- ✅ **No debounce needed.** Eviction subsumes it and is better: it adds no
      latency, where a debounce would delay even an already-cached card.
- ✅ 9 tests covering the parts that fail silently — that an evicted job really
      does not run, that different keys coexist, that interactive preempts
      background, that background work is never dropped, and that spacing holds.
- ⬜ **Background lane stays FIFO**, where fairness beats recency: a backfill
      should finish, not restart at the newest item forever.
- ⬜ The UI renders whatever is cached *now* and never awaits the scheduler;
      rows pop in as responses land

**Batching is an optimisation, not the main path.** `(oracleid:A or oracleid:B …)`
works and is useful for prefetching a page of results, but a page caps at **175
rows**, and popular cards average ~19 printings each — so a batch of 12 silently
returned only 9 of them in testing. Size batches against expected printings
(~6–8 cards) or follow `has_more`.

**Bulk data, deliberately not chosen.** `default_cards` is 74 MB compressed and
would make everything offline and instant — but waiting on a 74 MB download
before the first card renders is the opposite of responsive. Worth keeping as an
opt-in "prefetch everything" action, not as the default path. Note that if it is
ever adopted, the bulk-ingest argument for DuckDB comes back.

### Mixed-grain storage — migration 004

Both `collection_items` and `deck_cards` require a printing
(`card_id NOT NULL REFERENCES cards(id)`), so neither *"two more copies, printing
unknown"* nor *"one Sol Ring, any art"* is expressible. Decks need this at least
as much as collections: most decklists are oracle-level, and pinning a printing
is the exception.

**Changes, both tables:**
- ⬜ Add `oracle_id TEXT NOT NULL`
- ⬜ Relax `card_id` to nullable, where NULL means *printing unknown / any*
- ⬜ Replace the UNIQUE constraint with an expression index (see the trap below)

**The trap: SQLite treats NULLs as distinct in UNIQUE.** The moment `card_id`
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

**Decisions taken:**
- ⬜ **One table, not two.** `known` and `unsorted` are a logical split; in
      storage it is one table with a nullable `card_id`. Two tables would double
      every query for no gain.
- ⬜ **Storing `oracle_id` removes a join.** Ownership queries currently join
      `cards` solely to reach it.
- ⬜ **A representative printing is a display choice, not stored data.** An
      oracle-grained row still needs an image: pick the newest cached printing
      for that `oracle_id`. Safe because we only ever record cards we have
      fetched, so one printing is always cached.

**Migration shape.** SQLite cannot relax `NOT NULL` or swap a table constraint in
place, so this is a create-copy-drop-rename rebuild of both tables rather than an
`ALTER`. `oracle_id` backfills from `cards` through the existing `card_id`, so no
data is lost.

**A deck's zones *are* collections — one primitive, not two.** `deck_cards` and
`collection_items` are both "container holds N of card X", and the duplication
has already produced four pairs of near-identical functions (`addCardTo…`,
`adjust…Quantity`, `printingQuantitiesIn…`, plus the row types). The unification
is structural rather than cosmetic:

| Layer | What it is |
| --- | --- |
| **Container** | the primitive — `card → quantity`. A collection's contents; a deck's commander zone; a deck's maindeck |
| **Entity** | owns containers. A `Collection` owns one (plus `unsorted`, below); a `Deck` owns several named zones, one of them default |

**Two ways to express that, both worth considering. Undecided.**

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

**Note:** the deck-vs-collection dispatch being written for the carousel `±`
right now is a **stopgap** this model deletes. Behaviour is identical either way,
so it is safe to build now and collapse later.

**Code that follows:**
- ⬜ **Import stops fabricating printings.** A bare `4 Lightning Bolt` currently
      resolves to whichever printing Scryfall returns first and records *that* as
      owned — inventing information the source never gave. Bare names should land
      with `card_id` NULL.
- ⬜ Printings carousel gains an "unknown printing ×N" slot, and a way to promote
      copies into a specific printing as they are sorted.
- ⬜ Adding to a deck offers both grains: this printing, or any.

### Card-set algebra — the document model ⭐⭐⭐

The thing panels are views *of*. Maya and Blender give you many viewports onto one
shared model; here the model is not a mesh but a **graph of card-set
specifications**. Everything else in this section depends on getting this right.

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
| `Diff(a, b)` | `max(0, a − b)` | still needed / not owned |
| `Sub(a, b)` | `a − b` | signed change — the deck-diff representation (see types below) |

Pointwise unary operators:

| Node | Value | Reads as |
| --- | --- | --- |
| `Clamp(a, n)` | `min(a, n)` | copy limits — `n=1` singleton, `n=4` constructed |
| `Scale(a, k)` | `a × k` | k copies of a whole list |
| `Mul(a, b)` | `a × b` | **this is filtering** — when `b` is binary it masks `a` |
| `Project(a, grain)` | regroup | collapse printings to oracle cards, or expand back out |

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

  At `natural`, `agg` is `sum` (total owned across printings), or `max` / `min`
  where that reads better.

- `ToPrintings(a)` — oracle → printing. Unambiguous at `binary`: all printings of
  each matching card. At `natural` there is no principled way to distribute *n*
  copies across printings, so it stays a type error rather than a guess.

**Round-tripping is not the identity.** `ToPrintings(ToOracle(a, any)) ⊇ a` — the
trip out and back widens a specific set of printings into *all* printings of
those cards. Useful (it is exactly "show me every version of what I own"), but it
must not be mistaken for a no-op, and the UI should not offer it as one.

**Collections are mixed-grain, and that is fine.** Real collections know some
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

Consequences to design for:

- ⬜ **Schema.** `collection_items.card_id` currently points at a printing and is
      required. It needs to become nullable alongside a required `oracle_id`,
      with a null `card_id` meaning "printing unknown".
- ⬜ **Import currently fabricates printings.** A pasted line of bare `4 Lightning
      Bolt` resolves to whichever printing Scryfall returns first and records
      *that* as owned. That is inventing information the source never gave. Bare
      names should land in `unsorted`.
- ⬜ **The printings carousel** needs an "unknown printing ×N" slot, and a way to
      promote copies from `unsorted` into a specific printing as you sort them.

**Grain polymorphism, and inferring it.** A predicate is not tied to one grain; it
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
exactly the smart-ownership ambiguity that would otherwise silently produce a
wrong number. And because `Filter` predicates are themselves binary nodes,
"legal in Commander" or "within my commander's identity" become reusable,
storable, composable specs rather than hardcoded checks.

**Derived values, and predicates parameterised by them.** `colorIdentity(commander(deck))`
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
pool = Owned
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

**Three decisions determine everything downstream.** These need answering before
any code:

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

**Editing.** `Literal` nodes are editable — dragging a card into a deck panel
edits that node. Derived nodes are read-only but can be **baked** into a literal,
the way Blender applies a modifier. Edits propagate to every view of a node; two
panels showing one deck must never drift.

**Re-backing the features we like.** The point of the algebra is that the quality
-of-life behaviour of Arena, Scryfall and Moxfield falls out as presets rather
than being reimplemented:

| Feature elsewhere | Expression here |
| --- | --- |
| Scryfall search | `Filter(Universe, q)` |
| Arena's card pool | `Filter(Universe ∩ Owned, format + colour identity)` |
| Moxfield "missing cards" | `Deck − Collection` (multiset, oracle grain) |
| "Own but never play" | `Collection − Union(all decks)` |
| Binder / cube triage | `Collection ∩ Filter(…)` |
| Deck diff (§4) | `SymmetricDifference(v1, v2)` |

**Open questions.**
- How is the graph persisted, and are nodes nameable/reusable across workspaces?
- Union of multisets — sum the quantities, or take the max? ("all my decks
  combined" wants different answers for "total copies used" vs "copies needed at
  once")
- How far should the compiler push down before giving up and materialising?
- Cycles: forbid outright, presumably.
- Do derived nodes cache their materialisation, and how is that invalidated?

### Multi-panel workspace ⭐

Move from one fixed layout to a reconfigurable workspace, so the app can be
arranged around the activity rather than around a single "current view".

**First milestone — mimic the Arena deckbuilder.** Two panels stacked: the
filtered pool of candidate cards **on top**, the deck under construction
**below**. This is the smallest arrangement that proves the model, and it is the
one that gets used most.

- ⬜ Pool panel above, deck panel below, draggable horizontal divider
- ⬜ Pool panel sources: Scryfall search **or** a collection, same panel type
- ⬜ Facet filters on the pool (extract the ones collections already have)
- ⬜ Double-click or drag a card from pool → deck
- ⬜ Pool auto-scopes to the deck's format constraints, with a toggle —
      format legality everywhere, plus commander colour identity in Commander
- ⬜ Ownership badges in the pool ("you own 3") when a collection is selected

**Panel types.** Each is a self-contained view over one source:
- ⬜ Deck (list / piles / curve)
- ⬜ Pool (search results or collection, filtered)
- ⬜ Card detail
- ⬜ Deck stats
- ⬜ Ownership / missing
- ⬜ Set-operation result (see below — results become just another pool source)

**Layout model.**
- ⬜ Nested binary splits with ratios, à la VS Code / tmux — arbitrary
      arrangements without a fixed slot grid
- ⬜ Tabbed panel groups, so a slot can hold several panels
- ⬜ Persisted per workspace (new migration: `workspaces`, `panels`)

**Cross-panel wiring.** The hard part, and what makes it a workspace rather than
just split views:
- ⬜ Drag payloads that work across panels (cards, and later whole lists)
- ⬜ Panel parameterisation — a pool panel scoped *by* a deck panel is the
      mechanism behind the colour-identity filter above

#### Selection as shared context ⭐

Borrowed from Maya, where selection is global and every viewport respects it.
This is the single mechanism behind "what is in scope", and it replaces the
ad-hoc scoping each view currently invents for itself.

- ⬜ **One ordered selection**, with the last-selected being *active* — Maya's
      model, and it cleanly separates the two roles: the **set** defines scope,
      the **active** member is what the main panel opens.
- ⬜ **Heterogeneous.** Cards, decks and collections live in one list; each
      consumer filters by the type it cares about. "Ownership uses the
      collections in the selection" is then a rule statable in one sentence.
- ⬜ **Less ephemeral than Maya's.** Maya evicts on every click because a scene
      holds thousands of objects. Our views show one or a few at a time, so
      selection is better treated as a *working set* — built up deliberately,
      cleared explicitly, and not thrown away merely because focus moved. That
      alone defuses the obvious failure mode, where a count silently changes
      because you clicked elsewhere.
      Whether it also survives restarts is open: plausible, and it would sit
      naturally alongside per-workspace layout persistence, but nothing else
      here depends on it.
- ⬜ **Scope is always shown in words** — `owned across: Paper, Cube` — so a
      count is never mysterious.
- ⬜ **Panels may pin instead of follow**, the same toggle as for card selection.
- ⬜ Sidebar needs a selection affordance distinct from "open", plus an explicit
      clear.

**What it fixes immediately.** Ownership scope has three different answers today
(see Known debt): everything, everything again, and hand-ticked chips. With a
selection it has one — the union of the selected collections, or all *ownable*
collections when none are selected.

**How it meets the algebra.** `Owned` stops being a hardcoded query and becomes
`Union(selected collections)` — the selection is literally an input to the
expression graph, which is a good sign the two designs belong together.

**Presets ("activities").** Named layouts to switch between:
- ⬜ Brewing — deck + pool + stats
- ⬜ Collection triage — collection wall + card detail + "decks using this"
- ⬜ Deck diff — two deck panels + a difference panel
- ⬜ Playtest — hand + battlefield + library stats

**What this costs.** `App.tsx` hardcodes a three-column grid and a `view` union;
`DeckView` and `CollectionView` own their toolbars and their own data loading.
Turning them into panels means extracting the toolbars, lifting data loading to
a workspace store, and pulling the collection facet filters out into a component
the pool panel can reuse. Best done before more views exist, not after.

**Open questions.**
- Does a panel own its data, or subscribe to a workspace store? (Leaning store —
  two panels showing the same deck must not drift.)
- One database, many windows? Multiple windows is a natural extension of panels
  but SQLite writes would need coordinating.
- How much layout state is worth persisting — exact ratios, or just structure?

### Format support ⭐

The app is **Commander-first but must not be Commander-only**. Today the
`decks.format` column exists and nothing reads it: every rule, count and label is
hardcoded to Commander. Generalising this is a prerequisite for the panel work,
since the pool panel scopes itself by format.

- ⬜ Format registry — deck size, sideboard size, copies allowed, whether a
      commander zone exists, whether colour identity constrains the deck
- ⬜ Replace `commanderIssues()` with per-format rule sets sharing one
      `LegalityIssue` shape (keep the advisory-not-blocking behaviour)
- ⬜ Format picker on deck creation, and changeable afterwards
- ⬜ Zones per format — Commander's commander + 99 vs a 60-card main + 15-card
      sideboard; `maybe` stays universal
- ⬜ Stats that adapt: the toolbar hardcodes `/100`
- ⬜ Legality checks read `legalities[format]` rather than always `commander`
- ⬜ Card detail legality list ordered by the current deck's format
- ⬜ Target formats: Commander, Standard, Pioneer, Modern, Legacy, Vintage,
      Pauper, Brawl, and a Limited/sealed pool mode

### Set operations — surfacing the algebra

Subsumed by the card-set algebra above; what remains here is the UI over it.
- ⬜ Build expressions without writing them — drag nodes together, pick an operator
- ⬜ A graph//node editor panel, or a simpler expression bar to start with
- ⬜ Results are first-class: viewable in any panel, exportable, bakeable into a
      new collection or deck
- ⬜ Common operations as one-click presets, so the algebra stays optional

### Deck builder gaps
- ⬜ Undo / redo
- ⬜ Multiple deck tabs
- ⬜ Deck folders and tags
- ⬜ Drag between zones (piles handles within-deck; zone moves are still buttons)
- ⬜ Curve view as a first-class layout
- ⬜ Fast keyboard search / focus shortcuts
- 🚧 Rich filtering — done for collections, not yet for card search
      (search currently delegates filtering to Scryfall)

### Collection gaps
- ⬜ Set finish and condition from the UI (schema supports it; import populates
      it; only manual editing is missing)
- ⬜ Printings picker — search returns one printing per card (`unique=cards`),
      so you cannot yet choose *which* printing you own
- ⬜ Estimated cost per vendor (TCGPlayer / Card Kingdom) — prices are stored,
      the breakdown UI is not built

---

## Backlog

### Compact printing rows and the CSV path — deferred

A storage-and-bandwidth optimisation, not a correctness fix. Recorded because the
measurements were expensive to gather and the trade-offs are not obvious.

**The measurements.** Scryfall serves the same query as CSV for a twentieth of
the bytes:

```
oracleid:X&unique=prints             664 KB   (Sol Ring, 137 printings)
oracleid:X&unique=prints&format=csv   34 KB
```

And a card object is mostly not card data — 24% image URLs, 20% affiliate and
purchase links, 12% API self-references, against **4.7%** actual text and stats.
We store the raw payload in `cards.data`, so ~5,800 printings is ~27 MB where
compact rows would be ~4 MB.

**Why it was deferred.** Migration 003 undercut the bandwidth argument: a print
run is now fetched once per card per week, so twenty-times-less of an already
rare request buys little. And CSV cannot populate `cards` as it stands — it
carries no `oracle_text`, `legalities`, `colors`, `color_identity` or `keywords`.
Those are not cosmetic: `color_identity` drives the pool's identity filter and
`legalities` drives format scoping, so a CSV-sourced row would **silently break
filtering**. It also drops `border_color`, `frame_effects` and `finishes`, which
is what stops Sol Ring's 30 Secret Lairs rendering as identical duplicates.

**So it is one piece of work, not two.** CSV only makes sense alongside a
separate lightweight printings table — promoting the columns we query, keeping
`data` nullable for rows we have only indexed. Doing either alone is worse than
doing neither.

- ⬜ Promote queried fields to real columns, `data` nullable, index-only rows
- ⬜ CSV as the fetch format once rows no longer need the full payload
- ⬜ `/sets` for `set_name`, which CSV omits — one request, all 1,047 sets,
      long TTL plus refresh-on-evidence
- ⬜ Where CSV still clearly wins regardless: **bulk prefetch** of a whole
      collection's print runs, where a cheap index over thousands of cards is
      exactly what is wanted and full detail is not.

### 3. Deck database
One local library. ⬜
- ⬜ Favourites, format grouping (Commander / Modern / Pioneer / Legacy)
- ⬜ Brews / Competitive / Archived states
- ⬜ Per-deck notes, tags, history, statistics, playtest notes
      (`decks.notes` column exists; no UI)

### 4. Version control ⭐ ⬜
Git for decks. Branch a list, then diff two versions:
```
+2 Fatal Push   -2 Cut Down
Average MV      2.13 → 2.05
Black sources   17 → 18
Opening hand    +3.2%
```
Worth designing before decks accumulate history.

### 5. Statistics ⭐⭐⭐ 🚧
The main event. Curve, pips and colour identity ship today; everything below is open.
- 🚧 Mana: curve ✅, pips ✅ · ⬜ coloured/untapped source counts, land-spell
      ratio, MDFCs, fetch interactions
- ⬜ Opening hand: P(1/2/3/4 lands), turn-1 black source, turn-2 UU,
      three lands by turn three, five mana by turn five
- ⬜ Draw probabilities inline on every card — "Bolt: 39% opening, 63% by turn 3"
      rather than a separate hypergeometric calculator
- ⬜ Combo analysis — P(A and B and C by turn N)
- ⬜ Archetype profile (aggression / removal / card advantage / ramp /
      interaction / consistency), computed automatically
- ⬜ Mana base diagnostics as IDE-style warnings:
      "⚠ only 73% to cast UU on turn two — suggest +2 Islands, −1 utility land"

### 6. Card intelligence 🚧
- ✅ Oracle text, legality, prices, owned copies
- ⬜ Rulings, printings list, price history
- ⬜ Decks containing it, common replacements, common pairings

### 7. Discovery ⬜
Needs a public decklist corpus. **This is where DuckDB earns its place.**
- ⬜ "Appears in 37% of Dimir Midrange, average 3.8 copies"
- ⬜ Often paired with…
- ⬜ Similar decks, scored

### 8. Suggestions ⬜
Statistical, not necessarily AI.
- ⬜ "Your deck: 1.6 white sources. Average competitive deck: 2.9"
- ⬜ "91% of decks playing A also play B"

### 9. Playtesting ⬜
- ⬜ Draw seven, mulligan, goldfish, play turns, undo, reshuffle
- ⬜ Monte Carlo thousands of games in the background
      (the natural moment to push compute into Rust)

### 10. Polish 🚧
- ✅ Dark mode
- ✅ Offline-first, local SQLite
- ✅ Instant search (debounced, cached)
- ⬜ Command palette (⌘K / ⌘⇧P)
- ⬜ Global search
- ⬜ Split panes
- ⬜ Keyboard-first navigation
- ⬜ Plugin support

---

## Known debt

Small, known, and cheap to fix — listed so they don't get rediscovered.

- **Ownership scope is still inconsistent between views** — though no longer
  *wrong*. `OWNABLE_KINDS` now excludes `wishlist` and `loaned`, so a wishlist
  card no longer reads as owned and a loaned card no longer reads as available.
  What remains: the card panel scopes to the active collection, `deckOwnership()`
  makes you tick collections by hand, and the pool dims against all ownable
  collections. Three scopes for one question. Selection-as-shared-context is the
  real fix.
- **Digital and paper still mix.** Arena and MTGO copies count toward a paper
  deck, because separating them needs a notion of a deck's *game* that does not
  exist yet.
- **`card_tags` table is dead.** Left over from a query language that was cut.
  Nothing reads or writes it. Either wire up user tags or drop it in a migration.
- **CSP is `null`.** Fine for local dev; tighten before shipping signed builds.
- **Bundle identifier ends in `.app`.** `com.decklab.app` triggers a build warning
  and conflicts with the macOS bundle extension. Changing it moves the database
  directory, so it gets more expensive the longer it waits.
- **Builds are unsigned and Apple Silicon only.** Gatekeeper blocks them on other
  machines. Needs an Apple Developer ID + notarization; universal builds need
  `rustup target add x86_64-apple-darwin`.
- **`CI=true` required for `tauri build` from a non-interactive shell** — otherwise
  `bundle_dmg.sh` dies on the Finder AppleScript step and leaves a volume mounted.
- **Piles are main-zone only**, and pile columns cannot be reordered by drag
  (`reorderPiles` exists in the data layer, unused).
- **Moxfield JSON needs the Python script.** An in-app "Open file → .json" path
  would remove that step; the conversion logic would need porting to TypeScript.
- **Test coverage is parser and analysis only.** Nothing covers the SQL layer or
  React components.
