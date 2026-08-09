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
- ✅ Versioned migrations (001 schema, 002 piles)
- ✅ Test suite — 48 tests over the parser, serialisers and deck analysis
- ✅ `npm run tauri build` produces a 7.5MB DMG

---

## Next up

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

Original vision, preserved and annotated.

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
