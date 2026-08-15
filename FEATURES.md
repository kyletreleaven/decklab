# DeckLab — what it does today

Shipped and working. For what is planned, see [`TODO.md`](TODO.md); for how to
run it, [`README.md`](README.md).

Commander-first but not Commander-only — though format support is currently
hardcoded to Commander in practice.

---

## Card search

- Search against Scryfall with **full Scryfall syntax** — `t:creature c:rw mv<=3`
  works, because the query is passed through untouched rather than reinterpreted
- Visual card grid, paged with **Load more**
- Every card seen is **cached locally**, so the offline catalogue builds itself
  as you browse
- Card images downloaded to disk and served from there, so a card you have looked
  at renders instantly and works offline

## Card detail panel

- **Operations first**, sticky at the top of the rail — add to deck, add to
  collection, and a `±` stepper — so they stay reachable however far you scroll
- **Printings carousel wrapping the card image**: prev/next arrows, a combo box
  listing every printing, and an owned-only toggle. Labels carry the collector
  number and variant traits (borderless, showcase, etched, promo, foil-only),
  because set name alone made Sol Ring's 30 Secret Lairs look like duplicates
- Details **split by grain** — oracle-level facts (type, cost, text, mana value,
  P/T, identity, legality, EDHREC rank) stay put, while printing-level ones (set,
  collector number, rarity, release, price) follow the carousel
- **Counts named against a scope**: `2 in Paper` rather than a vague `7 owned`,
  with the wider total shown alongside when copies live elsewhere
- **Hover to preview** any card from any grid or list; the panel updates
  instantly and reverts to your selection when you move away. Choosing a printing
  survives hovering elsewhere and back
- Official **Scryfall mana symbols**, all 84, bundled for offline use — including
  hybrid, Phyrexian, and twobrid

## Decks

- Create, rename, delete; commander plus the 99; quantities; zones (commander,
  main, side, maybe)
- **Grouped list view** by card type, with per-row quantity steppers, a ★ to
  promote a card to commander, and a ↓ to send it to the maybeboard
- **Piles view** with drag-and-drop between columns, persisted per deck.
  Auto-arrange by type or mana value as a starting point. Deleting a pile returns
  its cards to Unsorted rather than losing them
- **Stats bar**: card count against 100, average mana value, curve, colour
  identity, estimated value
- **Commander rules checks** — singleton, colour identity, banned cards, deck
  size — reported as advisory warnings that never block an edit, because brewing
  passes through illegal states constantly

## Deck builder pool

- Pool above, deck below, with a draggable divider whose ratio persists
- Pool source is **Scryfall or any collection**, with the same filters driving
  both — compiled to a Scryfall query string in one case, SQL in the other
- **Deck-legal scoping**: format legality, plus commander colour identity once a
  commander is set
- **Arena-style ownership toggles** — Collected and Not collected. Both on shows
  everything with uncollected cards dimmed rather than hidden

## Collections

- Multiple collections with kinds (paper, Arena, MTGO, cube, loaned, wishlist)
- **Card wall** and list views
- **Facet filtering** — colour, type, rarity, mana value range, name — pushed
  into SQL rather than filtered in JavaScript, so it scales past tens of
  thousands of rows
- Sort by name, mana value, quantity or price
- **Ownership that respects reality**: wishlist and loaned-out collections are
  excluded from "owned", since a wishlist is by definition what you do *not* have
- **Smart ownership** against decks: exact-printing *and* playable
  (any-printing) counts, with a per-printing breakdown, plus a missing-card
  summary

## Active slots

- A single most-recent-first list of the decks and collections you have touched
- The active deck and active collection are derived from it, so **opening a deck
  no longer evicts your active collection** — which is what makes recording
  ownership while deckbuilding work
- The sidebar marks both: a ring for active-of-its-kind, a filled dot for the
  overall most recent (where a bare `+` lands)

## Import and export

- Import from **paste, file, or URL**, all through one parser
- Formats: Arena, MTGO, Moxfield, Archidekt, plain lists, and CSV in the
  Moxfield / ManaBox / Deckbox / Archidekt header dialects
- **Preview before committing**, with matched and unmatched counts; unmatched
  lines are skipped rather than blocking the import
- **Two-pass resolution** — exact printing first (Scryfall id, or set plus
  collector number), then a name fallback, so one stale set code does not silently
  drop a card
- URL import for **Archidekt** via their API
- Export as plain text, Arena format, or CSV — to clipboard or file
- **Moxfield binder workaround** — Moxfield blocks automated fetching, so
  `scripts/moxfield_binder_to_csv.py` plus
  [`docs/importing-moxfield.md`](docs/importing-moxfield.md) cover binders you do
  not own

## Under the hood

- **Request scheduler** with two lanes over one rate-limited pipe. Interactive
  work (hover, click, search) preempts background work, and the interactive lane
  *evicts* rather than queueing — a stream of hovers collapses to the newest, so
  no debounce is needed and nothing is made to wait on a timer. Background work
  is FIFO and never evicted, because import chunks each carry distinct cards
- **Printings cached for a week**, in memory *and* on disk. The disk stamp is
  what stops a restart refetching print runs it already holds
- Versioned SQL migrations, applied on startup
- All data in one SQLite file under
  `~/Library/Application Support/com.decklab.app/`
- **83 unit tests** over the parser, serialisers, deck analysis, filter
  translation and the scheduler; **25 Scryfall contract tests** run on demand as
  executable documentation of the API behaviour we depend on
- `npm run tauri build` produces a **7.5 MB DMG**

---

## Known limitations

- Unsigned and Apple Silicon only, so Gatekeeper blocks it on other machines
- Format support is Commander in practice; `decks.format` exists but little reads
  it
- Search cannot run offline — the local cache is searchable by name only
- No undo/redo, deck tabs, or folders
- Nothing covers the SQL layer or React components in tests
