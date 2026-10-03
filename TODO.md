# DeckLab — roadmap

Legend: ✅ done · 🚧 partial · ⬜ not started

**Stack:** Tauri 2 · React 19 + TypeScript · SQLite (`tauri-plugin-sql`) · Scryfall.
All logic lives in TypeScript; Rust handles file I/O only (image cache, file
read/write). Data lives in `~/Library/Application Support/dev.treleaven.decklab/`.

**Storage note:** DuckDB was deferred, not rejected. When §7 Discovery arrives with
corpus-scale data, DuckDB can `ATTACH` the existing SQLite file in place — no
migration. See the reasoning in git history.

---

## Campaigns

The `###` sections below are the breakdowns. Open-item counts are rough.
What the work is *for* lives in **[`JOURNEYS.md`](JOURNEYS.md)**.

| Campaign | State | Sections |
| --- | --- | --- |
| **1. One panel for every card source** | ~done | Universe as a collection · Card panel layout · Active slots and hover · Panel state retention |
| **2. Storage and fetching** | partly done | Mixed-grain storage (004) · Card data fetching · Compact printing rows |
| **3. Card-set algebra** ⭐⭐⭐ | design only | Card-set algebra · A union of two sets · Set operations |
| **4. Formats beyond Commander** ⭐ | not started | Format support |
| **5. Multi-panel workspace** ⭐ | not started | Multi-panel workspace |
| **6. Analytics and intelligence** | sketched | Statistics · Card intelligence · Discovery · Suggestions · Playtesting |
| **7. Organising decks and collections** ⭐ | not started | Organising decks and collections |
| **8. Gaps and polish** | ongoing | Contextual filters · Deck builder gaps · Collection gaps · Deck database · Version control · Polish · Known debt |

**Campaign 1 is the one just finished.** What is left of it is small and named:
roll counts up to oracle grain (the last wrong thing on screen), the
active-printing carousel, and scroll restoration.

**Campaigns 3 and 5 are the big bets**, and both are still prose rather than
tasks. Campaign 2's migration 004 is the one piece of work that touches real
user data and wants a backup first.

---

## Shipped

Moved to **[`FEATURES.md`](FEATURES.md)** — a current description of what the
app does, kept out of here so this file stays about what is left.

---

## Next up

### Card panel layout — mostly done

Ops sticky at the top, then the picture, then details **split by grain** —
oracle-level facts stay put while printing-level ones follow the carousel. See
[`FEATURES.md`](FEATURES.md).

**The printless state waits for the mixed-grain migration.** A "clear" control
returning to oracle grain is the right idea, but its whole point is to change
what the ops row *writes* — cleared means "add any printing" — and storage cannot
represent that yet. Shipping it earlier would put a button on screen that changes
only which fields you are reading, which is worse than not having it.

- ⬜ The cleared state still has to show *an* image. Use the newest cached
      printing, and label it so it is not mistaken for a selection.
- ⬜ Choosing *which* zone the carousel's `±` writes to. Today it is always a
      deck's main zone. Needs zones to be addressable, which is exactly the open
      container question.
- ⬜ Flip on grid tiles too, if it turns out to be missed there. The card panel
      has it (see `backUrl` in `images.ts`). Left out of tiles on purpose: a control on every tile is clutter for something that applies to
      a small fraction of cards.

### Active slots and hover — mostly done

One ordered most-recent-first list of touched decks and collections; active deck,
active collection and target all derived from it. Hover previews any card without
disturbing the selection. See [`FEATURES.md`](FEATURES.md).

- ⬜ `activeCard` as a durable slot of its own. Hover currently overlays the
      *selected* card, which is the same thing in practice; a separate slot only
      matters once selection grows to hold cards alongside decks and collections.
- ⬜ Verify the 80ms hover-clear grace period feels seamless. If a flicker of the
      selected card shows while sweeping, that is the dial.

### Panel state retention — two items left

Each panel's search, filters, sort and results survive navigation. How it
works, and where each kind of state lives, is in
[`docs/panel-state.md`](docs/panel-state.md).

- ⬜ Scroll position. DOM state, so it dies with the element and retention does
      not restore it. Needs an explicit capture and a layout effect after the
      rows render. Half of "come back to where I was".
- ⬜ Slots are never evicted, only forgotten on delete. Fine at tens of panels;
      revisit if it ever holds many pages of results each.

### Universe as a collection — what is left

All Magic is a sidebar entry, and one `PoolPanel` shows it and every
collection. What was built and why is in
[`docs/card-sources.md`](docs/card-sources.md).

**The pool**

- ⬜ **Release date as a sort.** Both sides can already express it: `released_at`
      has been a column since migration 001 and orders the printings carousel,
      and Scryfall takes `order=released`. Newest-first is the useful default,
      like price. Note it is a *printing* fact, so at oracle grain it dates
      whichever printing the row stands for, not the card's first appearance —
      "newest reprints" and "newest cards" are different questions and only the
      first falls out for free.
- 🐛 **A tile shows `0` for a card held in another printing.** The pool is at
      oracle grain and the destination's counts at printing grain. Repro, cause
      and candidate fixes are in
      [`bugs/002`](bugs/002-stepper-counts-printing-grain.md). Rolling counts
      up to oracle grain is the cheapest fix, and the last wrong thing on screen
      from Campaign 1.
- ⬜ **Card mode needs an *active printing*, and a way to pick it.** Bug 002 is
      really this question: when a row is a card rather than a printing, which
      printing do `+`/`−` write? Today nobody decides: it is whatever
      `unique=cards` returned.
      1. **Default to the one in the destination.** Bug 002's fix (2), which
         makes the badge and `−` correct in the same stroke.
      2. **Hover carousel on the tile as the override**, with hovering a printing
         putting it in the card panel — the existing rule ("what you hover is
         what the panel shows") extended from card grain to printing grain. The
         tile becomes the picker, the panel stays the detail surface, so the two
         are not redundant.
      Cost is fine: printings are cached after the first fetch (migration 003),
      and a hover storm is exactly what the scheduler's keyed eviction is for.

- ⬜ Split the deck-attached pool into its own lightweight component once
      `compact` grows siblings — three or four "not in the strip" flags means it
      already is a different component wearing the same one. Not yet: the
      two-branch fetch, sort, facets, dimming and paging are genuinely shared.
- ⬜ Dimming is lit against the active collection only. With a
      multi-collection selection it would be lit against the selection, the
      same selection-as-scope question as everywhere else.
- ⬜ Virtualise long grids. A 50k-card binder wants it whatever the source.

**The query box**

- ⬜ **Local and remote dialects are not equal.** `is:` and friends work in All
      Magic but not against a collection. Wants a *"this term needs All Magic"*
      affordance.
- ⬜ **`is:` locally, via cached hidden collections**: resolve `is:fetchland`
      from Scryfall once and keep the card set. Needs a TTL (new fetchlands get
      printed) and makes the predicate async on a cold cache. See
      [`docs/query-language.md`](docs/query-language.md) → *Out of scope for v1*.
- ⬜ **One-step "Save as…" from a search**, with a choice of where it goes: a
      new collection (what saving does today), an existing collection, a file
      or the clipboard. Today exporting a search takes two steps: save as a
      collection, then export it.
      An existing collection means **augment** or **overwrite**. Both are clean
      for a binary target. For a natural one, augment adds through the usual
      path (1 of each unless asked for N), and overwrite discards real counts,
      so it confirms first, as `setQuantityKind` does. The export formats already exist (plain text,
      Arena, CSV), and the page budget in `saveSearch.ts` applies to every
      destination, since they all fetch the same search.
- ⬜ **Live saved searches.** Saving a search makes a static snapshot today
      (`saveSearch.ts`). A collection *defined by* a query would be
      `Filter(Universe, q)`: not writable, since there is nowhere to put cards,
      until you flatten it into rows. Live versus frozen is a real user-facing
      distinction: "all fetchlands" should stay live, and "my cube" should not
      gain cards when Wizards prints one. Show which a collection is, and make
      flattening explicit. Universe is then `ScryfallSearch("")`, and the `is:`
      cache above an implicit `ScryfallSearch("is:fetchland")`.

**Collections and their metadata**

- ⬜ `writable` is derived. It becomes a stored column only when a *stored*
      collection wants locking, such as an imported reference binder (a
      friend's list, a tournament decklist). A separate feature.
- ⬜ **`OWNABLE_KINDS` does not get replaced by a smarter inference — it gets
      deleted.** See *No global ownership* below.
- ⬜ Everything but `writable` stays user metadata with good affordances rather
      than app-enforced semantics. Resist adding a `game` enum the app reasons
      about; a deck warning is friendlier than a hard rule, and cheaper to be
      wrong.

**Arbitrary user metadata on decks and collections.** Once everything but
`writable` is metadata, enumerating the keys stops being worthwhile — so allow
any. Well-known keys simply get affordances:

| Key | Affordance |
| --- | --- |
| `game` | filter, and a soft warning when a paper deck draws on Arena cards |
| `colour`, `icon` | sidebar styling |
| anything else | shown and editable, no special behaviour |

This dissolves the structured-versus-freeform choice rather than settling it:
structured keys are conventions with UI, not a separate mechanism.

- ⬜ Storage: either a `(entity_type, entity_id, key, value)` table, or a JSON
      column per entity. The table is filterable — "every collection where
      game=paper" — which matters if collections themselves become selectable
      inputs to the algebra. JSON is simpler and fine at tens of entities. Not
      decided.

**Card annotations are a separate problem — deliberately not folded in here.**
Tagging Sol Ring as `ramp` is legitimate (reference data is not editable, but
your annotations on it are yours), and the dead `card_tags` table was exactly
that. But it should *not* reuse the entity-metadata mechanism, for four reasons:

- **Scale.** Tens of decks and collections versus ~110k oracle cards and ~500k
  printings. Different storage and indexing problem entirely.
- **It is a query input, not display.** Card tags feed predicates — `tag:ramp` —
  so they must be indexed and joinable. Entity metadata is mostly shown, not
  filtered on.
- **Grain, again.** `ramp` is oracle-level, `signed by the artist` is
  printing-level, and *this particular sleeved copy* is a third grain we do not
  model at all.
- **Mixed provenance.** Scryfall publishes an `oracle_tags` bulk file, so card
  tags would be part imported reference data, part user data — a lifecycle
  entity metadata never has.

- ⬜ Deferred. Leave `card_tags` in place rather than half-reviving it — the
      query language it was built for was postponed, not cancelled, and the
      algebra is that idea in stronger form. Decide its shape when one of them
      actually needs it.
- ⬜ Subsumes several backlog items that are each "metadata on a thing": deck
      notes, tags, favourites, archived/competitive status.

### Contextual filters — what is left

The local query parser is built and wired in; see
[`docs/query-language.md`](docs/query-language.md). What remains here is the
deck-legal toggles (`Scope` in `PoolPanel`): constraints whose *value* comes
from context, where you control only whether they apply.

- ⬜ **Rename `Scope`.** The word already means something else here —
      selection-as-scope, i.e. which collections are in scope. `ContextFilter`
      is the better name. One interface, one prop, two call sites.
- ⬜ **App derives the scopes, which sits oddly.** The derivation depends on the
      selection (App's) but is consumed by the panel, so App ends up knowing what
      the pool wants. Resolves under selection-as-shared-context: scopes come
      from the shared store and any panel reads them. Symptom of the missing
      store rather than a problem of its own — leave until then.
- ⬜ More contextual filters of the same shape once they are wanted: not already
      in *deck*, in *collection*.

### Card data fetching — what is left

How fetching and caching work today, including the scheduler, is in
[`docs/card-fetching.md`](docs/card-fetching.md).

- ⬜ Prices ride on the same card rows but move daily, unlike print runs, so they
      want their own short TTL rather than inheriting the week. **Deferred** —
      stale prices are a cosmetic problem, not a correctness one.
- ⬜ Store as **compact printing rows** rather than the raw payload. A card
      object is ~5 KB of which only ~5% is card text and stats; the rest is
      affiliate links, API self-references and eleven image URLs. Compact rows
      are ~700 bytes. Currently ~5,800 printings × 5 KB ≈ 27 MB on disk.
      See *Compact printing rows and the CSV path* — the two are the same
      piece of work.
- ⬜ Optional idle backfill, scoped to cards in collections and decks. Goes on
      the background lane.
- ⬜ The UI renders whatever is cached *now* and never awaits the scheduler;
      rows pop in as responses land. Images already work this way.
- ⬜ An opt-in "prefetch everything" action using bulk data (`default_cards`,
      74 MB compressed), for offline use. Not the default path.

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
- ⬜ **Storing `oracle_id` removes a join.** Collection queries currently join
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
      resolves to whichever printing Scryfall returns first and records *that*
      printing — inventing information the source never gave. Bare names should land
      with `card_id` NULL.
- ⬜ Printings carousel gains an "unknown printing ×N" slot, and a way to promote
      copies into a specific printing as they are sorted.
- ⬜ Adding to a deck offers both grains: this printing, or any.

### Card-set algebra — the document model ⭐⭐⭐

The thing panels are views *of*. Maya and Blender give you many viewports onto one
shared model; here the model is not a mesh but a **graph of card-set
specifications**. Everything else in this section depends on getting this right.

Quantity kinds and how operations combine them —
[`docs/card-set-types.md`](docs/card-set-types.md). A model layer for the pool,
taking commands and returning view state —
[`docs/pool-model.md`](docs/pool-model.md).

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

  At `natural`, `agg` is `sum` (total copies across printings), or `max` / `min`
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
      *that* printing. That is inventing information the source never gave. Bare
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
exactly the any-printing-or-this-printing ambiguity that would otherwise silently produce a
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
| Arena's card pool | `Filter(Universe ∩ Selected, format + colour identity)` |
| Moxfield "missing cards" | `Deck − Collection` (multiset, oracle grain) |
| "Collected but never played" | `Collection − Union(all decks)` |
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
- ⬜ Collection badges in the pool ("3 in Paper") when a collection is selected

**Panel types.** Each is a self-contained view over one source:
- ⬜ Deck (list / piles / curve)
- ⬜ Pool (search results or collection, filtered)
- ⬜ Card detail
- ⬜ Deck stats
- ⬜ Missing (deck − selected collections)
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
      consumer filters by the type it cares about. "Counts use the
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
- ⬜ **Scope is always shown in words** — `in Paper, Cube` — so a
      count is never mysterious.
- ⬜ **Panels may pin instead of follow**, the same toggle as for card selection.
- ⬜ Sidebar needs a selection affordance distinct from "open", plus an explicit
      clear.

**What it fixes immediately.** Scope is single-valued today: the active
collection, or nothing when none is active (see Known debt). With a selection it
is the union of the selected collections. With none selected there is no scope,
and nothing claims a count.

**How it meets the algebra.** `Selected` is `Union(selected collections)`, not a
hardcoded query — the selection is literally an input to the
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

The app is **Commander-first but must not be Commander-only**. `decks.format`
is read by the pool's format scope and the commander-zone affordance; rule
checks, counts, zones and labels are all still hardcoded to Commander.

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

**Once the registry exists, feed its copy limit back into the UI.** Today `+` is
always enabled, so a singleton deck accepts a second copy and then complains
about it in the advisory checks.

Two ways, and the second is the more useful one:

- ⬜ **Make the issues actionable** — the better fit. `commanderIssues()` already
      returns a list the deck view renders; give an issue an optional *fix* and
      surface it as a button. "Reset all to one" then handles the case that
      actually produces duplicates: pasting a 60-card list into a Commander deck
      gives 4-ofs everywhere, which no amount of disabling `+` would have
      prevented. It also keeps the advisory-not-blocking stance — do not stop the
      edit, make undoing it one click.
- ⬜ **Disable `+` at the limit** — one in Commander, four elsewhere, unlimited
      for basic lands and cards reading `A deck can have any number of cards
      named…`. Both exemptions already live in `commanderIssues()` and want
      lifting into the registry rather than being re-derived. Say *why* in the
      tooltip; a dead control with no explanation is worse than a visible
      mistake.
- ⬜ Deliberately **not** a hard block on import or paste — brewing and fixing up
      pass through illegal states constantly, which is the whole reason the
      checks are advisory.

**First define "one of what" — the rule is ambiguous across zones.** A card can
sit in `main` *and* the commander zone, or `main` and `maybe`. `commanderIssues()`
currently inspects `main` alone, so the maybeboard is already exempt (right — it
is a scratch list), but cross-zone duplicates go unnoticed entirely.

- ⬜ Proposed: the singleton constraint covers **commander + main together** —
      the deck proper — and ignores `maybe` and `side`. A card in both the
      command zone and the 99 is a genuine violation that nothing currently
      flags.
- ⬜ "Reset all to one" then means one copy across that union, keeping the
      commander-zone copy when there is one. `setCommander()` already moves
      rather than duplicates, so new data cannot get into this state — but
      existing decks and imports can.

### A union of two sets in the pool — built, then reverted

Drawing `foreground ∪ background` with the foreground lit was built, and then
removed in `cae2f53`. It took a day of bugs to show a region of the grid nobody
had asked to tell apart. The app draws one set per pane instead. The reasoning
is in [`docs/two-designs.md`](docs/two-designs.md), and the parts that stayed
(total sort key, `merge.ts`) are in
[`docs/merging-sorted-sources.md`](docs/merging-sorted-sources.md).

- ⬜ **The union comes back with set operations**, the first case where two
      drawn sets are not nested ("all red cards" against a collection holding
      blue). The merge is ready. Still missing: provenance on rows,
      membership across sources, and invalidating on a write without
      re-paging. [`docs/pool-model.md`](docs/pool-model.md) is the design on
      file for the last of these.
- ⬜ **Choosing what the grid is lit against.** Today `lit` is always the
      active collection. Journey B, Dave's binder lit by mine, needs it to be
      something else. The swatch's gestures (copy, switch, clear) are one
      design for this. Under one-set-per-pane they would set the lit set
      rather than a background.

**Paging the local side** is separate from all of this and only about
performance. `collectionItems` is `SELECT c.* … ORDER BY …` with no `LIMIT`, and
`c.*` carries the raw Scryfall payload in `data`, so a thousand-entry binder
ships a few MB over the IPC bridge per refetch. Fine at today's sizes.

- ⬜ Drop `data` from list queries. This doesn't depend on paging and is probably
      the bigger win. Tiles need name, image URLs, quantity and finish, all real
      columns. `data` is read only by `hasBack` and `variantTraits`, both
      card-panel concerns. See *Compact printing rows*, which measured it at
      ~27 MB against ~4 MB compact.
- ⬜ Swap the generator interface for explicit per-source cursors, so retention
      can resume mid-scroll and a refetch is targeted rather than a replay. See
      the end of [`docs/merging-sorted-sources.md`](docs/merging-sorted-sources.md).
- ⬜ When paging does arrive, the total sort key makes it **keyset** rather than
      OFFSET: exact, and correct precisely because ties cannot straddle a page
      boundary. Price would need its sort value stored rather than computed
      from JSON.

### Set operations — surfacing the algebra

Subsumed by the card-set algebra above; what remains here is the UI over it.
- ⬜ Build expressions without writing them — drag nodes together, pick an operator
- ⬜ A graph//node editor panel, or a simpler expression bar to start with
- ⬜ Results are first-class: viewable in any panel, exportable, bakeable into a
      new collection or deck
- ⬜ Common operations as one-click presets, so the algebra stays optional

### Organising decks and collections ⭐

The sidebar is a flat list ordered `updated_at DESC`, which rearranges itself as
you work. Fine at five decks, useless at fifty — and there is nowhere to say
*this one is retired* or *these three are the Commander pod*.

Every item below is the same mechanism applied to both kinds, so they want doing
together rather than once for decks and again for collections.

**The decision that gates the rest:** recency ordering and manual ordering
conflict. Today the deck you just touched jumps to the top, which is genuinely
useful; the moment you can arrange the list by hand, that has to stop, or the
layout you chose rearranges itself underneath you. Probably: manual order when
set, recency as the fallback — but it is a choice, not a detail.

- ⬜ **Drag to reorder.** A `position` column, the same shape `deck_piles`
      already has, and `ORDER BY position, updated_at DESC` so unpositioned rows
      still land sensibly. `PilesView` already demonstrates the drag handlers,
      including the Firefox quirk of needing `setData` or the drag never starts.
- ⬜ **Folders**, or tags, or both — one grouping mechanism for decks and
      collections. Tags compose and nest badly; folders nest and compose badly.
      Worth picking deliberately rather than growing whichever is easier first.
- ⬜ **Favourites** and **states** (brewing / built / retired). Already sketched
      under *Deck database* as deck-only; they are the same thing for a
      collection you have stopped adding to.
- ⬜ These are all **user metadata**, which the Universe section already argues
      should be arbitrary keys with affordances for well-known ones rather than
      a column per idea. Building folders as a bespoke table would contradict
      that; building them as metadata gets ordering and favourites for free.
- ⬜ **Collapse and hide.** Fifty decks needs sections that fold, and a way to
      keep a retired deck without it taking a row.
- ⬜ **Are card sets a separate user-facing type?** Underneath, a collection
      is natural (a multiset, a shelf) or binary (a set: a saved search, a
      list), and that is one flag, `quantityKind`, on one table. Users may
      perceive them as different things: a sidebar section for collections and
      another for card sets, say, with different actions on each. Decide before
      folders or tags, since it may be the first grouping the sidebar needs.

### Deck builder gaps
- ⬜ Undo / redo
- ⬜ Multiple deck tabs
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

**And it cannot back a searchable collection.** CSV omits `oracle_text`,
`colors`, `color_identity`, `keywords`, `power`, `toughness` and `released_at` —
pinned by a contract test. `compileQuery` filters on most of those, so a
CSV-backed cache identifies and displays cards but cannot search them. The 20x
saving is not "the same data without the URLs": it is most of the card removed.
That rules CSV out for *save a search as a collection*, where the whole point is
a set you can then filter.

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
- ⬜ Format grouping (Commander / Modern / Pioneer / Legacy). Favourites and
      brewing/built/retired states moved to *Organising decks and collections*,
      since they apply to collections too.
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
The main event. What ships today (curve, colour identity) is in
[`FEATURES.md`](FEATURES.md) → *Decks*.
- ⬜ **Show pip counts.** `deckStats()` already computes them per colour,
      hybrid counted toward both, and tests pin it, but nothing displays them.
- ⬜ Mana: coloured/untapped source counts, land-spell ratio, MDFCs, fetch
      interactions
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
What the card panel shows today is in [`FEATURES.md`](FEATURES.md) → *Card
detail panel*.
- ⬜ Rulings, printings list, price history
- ⬜ Decks containing it, common replacements, common pairings
- ⬜ **Where is this card?** From the card panel, list your collections and
      decks that hold it, either this printing or any printing of the card.
      Local data, so no corpus needed, unlike the item above. Also the natural
      answer for the card panel when no collection is active (see *No global
      ownership*).

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
- ⬜ Command palette (⌘K / ⌘⇧P)
- ⬜ Global search
- ⬜ Search-bar suggestions that know card names — WebKit autocorrect is off on
  the pool search (`PoolPanel.tsx`) because it mangled names and query syntax.
  Replace it with completion against Scryfall's `/cards/autocomplete` (via
  `scheduledFetch`) or the loaded pool, not the OS dictionary.
- ⬜ Split panes
- ⬜ Keyboard-first navigation
- ⬜ Plugin support

---

## No global ownership

The app makes no claim about what you *own*, only about what is *in* a named
collection (see `CLAUDE.md` → *Vocabulary*). One live path still breaks that.

- ⬜ **Card panel with no active collection.** Its per-printing counts fall back
      to `collectionCountsByPrinting`, which sums the "ownable" kinds (Paper,
      Arena, MTGO, Cube, not Wishlist or Loaned) into one number. Replace it with
      no count: a hint to pick a collection, or a short list of the collections
      that hold the card. The full version is *Where is this card?* under
      *Card intelligence*.
- ⬜ **Delete `OWNABLE_KINDS` and `ownableClause`**, with the no-argument branch
      of `collectionOracleIds` (nothing calls it). Delete the dead code with
      them: `ownedCopies`/`OwnedCopy` in `collections.ts` (no callers) and
      `ownershipMode`/`showOwned`/`showUnowned` in `filters.ts` (tests only).
- ⬜ **Rename what is left:** `ownedQty` in `CardDetail.tsx`,
      `deckOwnership`/`ownership`/`own` in `DeckView.tsx`, the `.owned*` CSS
      classes, and comments saying "owned copies".
- ⬜ Then drop "the surviving exception" from `CLAUDE.md` → *Vocabulary*.

## Known debt

Small, known, and cheap to fix — listed so they don't get rediscovered.

- ⬜ **Scope is single-valued.** Removing the chips lost checking a deck against
  several collections at once. That should come back as *multi-select in the
  selection model* — once, globally — rather than as a control on one view. See
  selection-as-shared-context.
- **Digital and paper still mix.** Arena and MTGO copies count toward a paper
  deck, because separating them needs a notion of a deck's *game* that does not
  exist yet.
- **`card_tags` is unused — table *and* code — but not abandoned.** Built for the
  query language, where `tag:ramp` was to be a predicate. The table and its index
  exist with 0 rows, and `src/lib/cards.ts` exports four functions against it —
  `allTags`, `addTag`, `removeTag`, `tagsFor` — with zero call sites; no
  component imports them.
  **Leave it.** The query language was deferred, not cancelled, and the card-set
  algebra is that idea in a more principled form — `tag:ramp` becomes a binary
  spec. So this is a stub ahead of a planned feature rather than debt behind a
  dropped one. Revisit its *shape* when the algebra lands (see *Card
  annotations*, which argues card tags want different storage from entity
  metadata), not before.
- ⬜ **`bump()` is a manual convention with nothing enforcing it.** Every
  mutation has to remember to signal, and every consumer has to remember to
  subscribe. Both have been forgotten, three times so far:
  1. Five mutations never signalled (`addToDeck` and the deck row's quantity,
     remove and zone handlers), so the card panel's counts went stale after
     adding from search.
  2. The pool's dimming effect (`collectionOracleIds`) was keyed on the
     collection alone, so adding a card from search left its tile dimmed.
  3. The pool's fetch effect left out `refreshKey`, so a grid showing a
     collection ignored writes to it. See [`bugs/001`](bugs/001-local-grid-ignores-writes.md).

  Each was fixed on its own, so the next mutation or derived set can fall into
  the same trap. Two ways out: have the mutation helpers in
  `decks.ts`/`collections.ts` own the signal, or make the panel *subscribe* to
  its data rather than being told to refetch, i.e. derived data in a cache keyed
  by its input (see [`docs/panel-state.md`](docs/panel-state.md)).
- ⬜ **The row `−` in a collection grid writes an absolute quantity from a
  stale row.** `PoolPanel.tsx:593` calls `onSetItemQuantity(entry,
  entry.quantity - 1)`, and `entry` is frozen until the refetch after a write
  lands. Two quick clicks on a 4-copy item can both write 3. Inferred from
  reading the code, not reproduced; left open by
  [`bugs/001`](bugs/001-local-grid-ignores-writes.md). Fix: send a change
  rather than a total. `adjustCollectionQuantity` already exists for the tile
  steppers.
- **`touched` is trimmed by hand, same trap.** `forget()` is called from only two
  places — deleting the deck or collection you are viewing — so a future delete
  path that misses it leaves a stale entry that can still be chosen as `target`,
  aiming `+` at a deleted id. Fix by deriving: filter `touched` against the live
  `decks`/`collections` arrays, which makes `forget` redundant for correctness.
- **CSP is `null`.** Fine for local dev; tighten before shipping signed builds.
- **Builds are unsigned and Apple Silicon only.** Gatekeeper blocks them on other
  machines. Needs an Apple Developer ID + notarization; universal builds need
  `rustup target add x86_64-apple-darwin`.
- **`CI=true` required for `tauri build` from a non-interactive shell** — otherwise
  `bundle_dmg.sh` dies on the Finder AppleScript step and leaves a volume mounted.
- **Piles are main-zone only**, and pile columns cannot be reordered by drag
  (`reorderPiles` exists in the data layer, unused).
- **Moxfield JSON needs the Python script.** An in-app "Open file → .json" path
  would remove that step; the conversion logic would need porting to TypeScript.
- ⬜ **No component tests.** Bugs that live in React wiring can only be proven by
  extracting a pure function and testing that: `bugs/001` tested
  `fetchSignature` because nothing could test the rendered grid, and
  `bugs/002`'s proof is "none yet" for the same reason. The `bump()` trap is
  exactly this kind of bug. Vitest is already in place; adding
  `@testing-library/react` with jsdom, and a stub for the `db.ts` layer, would
  let a test press `+` and check the grid. Start with the repros in `bugs/`.
- **The SQL layer is mostly untested.** Only the query compiler's output runs
  against a real database (`npm run test:sql`). `collections.ts` and
  `decks.ts` are not covered.
