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
- ⬜ Shared selection — clicking a card anywhere updates linked detail panels
- ⬜ Per-panel "follow" toggle, so a panel can be pinned instead of following
- ⬜ Drag payloads that work across panels (cards, and later whole lists)
- ⬜ Panel parameterisation — a pool panel scoped *by* a deck panel is the
      mechanism behind the colour-identity filter above

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

### Set operations across decks and collections
The next conversation. Sketch:
- ⬜ Difference — "what does this deck need that I don't own" (partly covered by
      ownership today, but not as a first-class, exportable result)
- ⬜ Intersection — "what do these two decks share"
- ⬜ Union — merge collections, or build a "cards I can actually field" view
- ⬜ Operate on decks, collections, and search results interchangeably
- ⬜ Results are themselves lists: exportable, saveable as a new collection

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
