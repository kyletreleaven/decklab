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
| **2. Data model: buckets, locations, assets** ⭐⭐⭐ | **next** | Data model, including the asset tree's UI · [`docs/inventory.md`](docs/inventory.md) |
| **3. Card-set algebra** ⭐⭐ | concepts settled; mechanics to do | Card-set algebra · Set operations |
| **4. Formats beyond Commander** ⭐ | not started | Format support |
| **5. Multi-panel workspace** ⭐ | not started | Multi-panel workspace |
| **6. Analytics and intelligence** | sketched | Statistics · Card intelligence · Discovery · Suggestions · Playtesting |
| **7. Card data fetching** | backlog | Card data fetching · Compact printing rows |
| **8. Gaps and polish** | ongoing | Contextual filters · Deck builder gaps · Collection gaps · Deck database · Version control · Polish · Known debt |
| **9. A backend an agent can use** | ongoing, as `cmdr` needs it | Backend factoring and a companion CLI |

**Campaign 2 is next.** The inventory model — buckets with `absent` as a
value, sparse attributes, locations and goals, one tree of assets — settles
the concepts the algebra left open, and its schema is one rebuild of real user
data rather than two. Back up first. It also fixes Campaign 1's last wrong
thing on screen, since a tile's count is a population at oracle grain
(bug 002).

**Campaign 3's operations are now well defined; their mechanics are not** —
laziness, pushdown, invalidation. Start from `cmdr`'s split of local and
Scryfall terms and its eager pushdown.

**Campaign 9 has what `cmdr` needs to grow against**: the plumbing and one
route. Further routes come as `cmdr` asks for them, ideally over the new data
model.

---

## Shipped

Moved to **[`FEATURES.md`](FEATURES.md)** — a current description of what the
app does, kept out of here so this file stays about what is left.

---

## Next up

### Backend factoring and a companion CLI ⭐ — next

An agent should be able to do what the app does — search the card cache, read
and edit decks and collections, import and export — through an HTTP API and a
`decklab` CLI over it, without driving the UI. Design, the option-1/option-2
reasoning and how the bridge works are in
[`docs/agent-api.md`](docs/agent-api.md); what is built is in
[`FEATURES.md`](FEATURES.md) → *Agent API*.

**Where it stands.** The plumbing is done and proven by `curl`: Rust → webview
→ Hono → back, token-checked, switched on from Tools → Agent API. One route
exists (`GET /decks`). What is left is mostly breadth, plus two things that
have to be right before the first write.

- 🐛 **Times out when backgrounded.** Confirmed by hand.
      [`bugs/003`](bugs/003-agent-api-times-out-when-backgrounded.md):
      `backgroundThrottling: disabled` applied, awaiting the repro; App Nap is
      the next suspect if it still fails.
- ⬜ **Try the menu in the app.** Built and compiles, not yet clicked: enable,
      copy, new token (old one → 401), disable (→ connection refused).
- ⬜ **Writes must refresh the UI.** `bump()` is a React callback in
      `App.tsx` that components call after a write; `decks.ts` and
      `collections.ts` do not signal, so an API write would leave the screen
      stale. Cheap fix: after any non-`GET` request the bridge dispatches a
      page event and `App.tsx` bumps on it — one place, every write route.
      The real fix is the `bump()` item under *Known debt*. Needed before the
      first write route.
- ⬜ **A CLI lane in the scheduler, last.** Below `background`: the UI's
      responsiveness comes first, and an agent can wait. Needed before the
      first route that reaches Scryfall.
- ⬜ **Routes**, JSON, each a few lines over existing `src/lib/` code:
      - decks: `GET /decks/:id` (with entries), add, remove, import, export
      - collections: list, show, add, remove, import, export
      - cards, local cache only: search via `compileQuery`, show, printings
      - `diff` — what a deck needs that is not in a collection (a set
        difference, as in the pool)
- ⬜ **Serve `cmdr`** (the CLI in `../commander`). It is a second Scryfall
      client with its own scheduler and cache today. Reasoning in
      [`docs/cmdr.md`](docs/cmdr.md). This also orders the routes above:
      - card lookup by name, cache-first, misses batched through the CLI lane
        — then `cmdr cards` and `cmdr search` route through DeckLab when the
        API is on, and fall back when it is off
      - deck export as a decklist, which `cmdr analyze`, `curve`, `mana`,
        `hands` and `grep` already read
      - collection membership for a list of names, replacing `cmdr`'s
        hand-kept owned list with the real Paper collection
- ⬜ **Share logic with `cmdr` instead of copying it.** Four files are copied
      "verbatim" and two have already drifted; there are also two local
      Scryfall evaluators (`src/lib/query/` and `cmdr`'s
      `lang/scryfall-local.ts`). A module both import — a workspace package,
      or `cmdr` depending on a path into this repo — once the import-extension
      difference (`./types` vs `./types.ts`) is settled. First casualty:
      [`bugs/004`](bugs/004-spacecraft-commander-flagged-illegal.md).
- ⬜ **Grain is explicit in every card result.** Oracle- or printing-grain
      rows say which they are (see *Grain* in `CLAUDE.md`); an agent cannot
      infer it from which branch ran the way the UI does.
- ⬜ **Vocabulary carries over.** Fields and flags say `inCollection`, never
      `owned` — an agent will read the API's words as claims.
- ⬜ **An OpenAPI spec** via `@hono/zod-openapi`, so an agent can discover the
      routes rather than be told them.
- ⬜ **The `decklab` CLI**, a thin client of the routes: JSON by default,
      `--text` for humans, token from `--token` or `DECKLAB_TOKEN`. An
      `npm run cli` entry first; a shipped binary once the surface settles.
- ⬜ The CLI cannot find the port without being told. A port file in the data
      dir, written on enable, if the env var proves not enough.
- ⬜ Remember *Enable* across launches, if re-enabling gets tedious.
- ⬜ Compile the Linux branch of the menu (Tools only, no default menu).
- ⬜ *Later, if wanted:* GraphQL beside REST; an MCP server over the same
      routes; option (2), a headless backend, if the CLI must work with the
      app closed. Each is in `docs/agent-api.md`.

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

**Paging the local side**, only about performance. `collectionItems` is
`SELECT c.* … ORDER BY …` with no `LIMIT`, and `c.*` carries the raw Scryfall
payload in `data`, so a thousand-entry binder ships a few MB over the IPC bridge
per refetch. Fine at today's sizes.

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

- ⬜ **`OWNABLE_KINDS` does not get replaced by a smarter inference — it gets
      deleted.** See *No global ownership* below.
- ⬜ **Free-form properties on an asset** (notes and the like) that the app
      does not reason about.
- ⬜ **Card tags as named ω sets** (`:ramp`, pinned by default — see
      [`docs/inventory.md`](docs/inventory.md) → *Naming a set in a query*),
      then delete `card_tags` (0 rows)
      and its four uncalled functions in `cards.ts` (`allTags`, `addTag`,
      `removeTag`, `tagsFor`). See
      [`docs/card-sources.md`](docs/card-sources.md) → *Card annotations are
      not entity metadata*.
- ⬜ **Values on a card** (notes, ratings): decide whether they belong to the
      card or to the deck or collection holding it.

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
- ⬜ Optional idle backfill, scoped to cards in collections and decks. Goes on
      the background lane.
- ⬜ The UI renders whatever is cached *now* and never awaits the scheduler;
      rows pop in as responses land. Images already work this way.
- ⬜ An opt-in "prefetch everything" action using bulk data (`default_cards`,
      74 MB compressed), for offline use. Not the default path.

### Data model — buckets, locations, assets ⭐⭐⭐ — next

Both `collection_items` and `deck_cards` require a printing, so neither *"two
more copies, printing unknown"* nor *"one Sol Ring, any art"* is expressible.
The model that fixes it — buckets with `absent` as a value, sparse
attributes, locations and goals, one tree of assets — is in
[`docs/inventory.md`](docs/inventory.md). Earlier design, partly superseded
(nullable `card_id`, migration "004", which is now `004_quantity_kind`), is in
[`docs/mixed-grain-storage.md`](docs/mixed-grain-storage.md). One schema, one
rebuild of real user data — back up first.

**Schema** — one migration (005 or later), a create-copy-drop-rename rebuild:
- ⬜ Buckets: `oracle_id` required, printing and finish first-class with
      `absent` as a real value (not `NULL`), user attributes sparse, and a
      canonical bucket key in place of today's
      `UNIQUE (collection_id, card_id, finish, condition)`
- ⬜ `condition` demoted to a user attribute of the built-in condition type.
      Today's `'NM'` is mostly a default (schema, `importer.ts`,
      `addCard`): map it to `absent`, keep other values. Finish is dropped:
      every migrated bucket has finish `absent`
- ⬜ Assets: ids, types, a parent for the tree. Every collection becomes a
      location; every deck a decklist whose zones are zone goals, with
      `maybe` a child goal it does not refer to
- ⬜ Locations and goals, per inventory.md → *First schema scope*: both
      ship; moves commit immediately and are not stored yet

**Code that follows:**
- ⬜ **Import stops fabricating printings** (and conditions). A bare
      `4 Lightning Bolt` lands as *printing unknown*.
- ⬜ Counts are populations: a tile's count at oracle grain sums every
      bucket of the card. Fixes [`bugs/002`](bugs/002-stepper-counts-printing-grain.md).
- ⬜ Printings carousel gains an "unknown printing ×N" slot, and a way to
      move copies to a finer bucket as they are sorted.
- ⬜ Adding to a deck offers both grains: this printing, or any.
- ⬜ Zones as collections deletes the deck-vs-collection dispatch behind the
      carousel `±` and the four pairs of duplicate functions.

**The asset tree's UI.** The model has many kinds of entity (binders, decks,
goals, moves, plans), and a flat sidebar of decks and collections cannot hold
them. One tree of assets does; see [`docs/inventory.md`](docs/inventory.md) →
*The asset tree*.

The sidebar today is a flat list ordered `updated_at DESC`, which rearranges
itself as you work. Fine at five decks, useless at fifty, and there is nowhere
to say *this one is retired* or *these three are the Commander pod*. Every item
below is one mechanism for decks and collections alike, so they want doing
together rather than once for each.

Recency and manual order conflict when they share a list: the deck you just
touched jumping to the top is useful, but once you can arrange the list by hand,
your layout would rearrange itself underneath you. So they get separate lists.
The tree keeps the order you give it, and recency moves to a Recent list.

- ⬜ **Drag to reorder and re-parent.** A `position` column, the same shape
      `deck_piles` already has. `PilesView` already demonstrates the drag
      handlers, including the Firefox quirk of needing `setData` or the drag
      never starts.
- ⬜ **Folders.** A folder only organises: it sums nothing. Whether any asset
      can act as one, as a deck holding its decklist and builds would, is
      open in inventory.md → *Open → Folders*.
- ⬜ **Tags** for favourite, brewing / built / retired, competitive. Each is
      yes or no for every asset, which makes it a tag rather than a
      property. Tags as well as folders, or instead, is the same open
      question. Journey G in [`JOURNEYS.md`](JOURNEYS.md).
- ⬜ **Collapse and hide.** Fifty decks needs folders that fold, and a way to
      keep a retired deck without it taking a row.
- ⬜ **Card sets are their own type**, not a kind of collection: a saved
      search or a list is a set, a binder is a multiset. `cmdr` keeps exactly
      these two and never infers one from the other
      ([`docs/cmdr.md`](docs/cmdr.md)). In the tree that means per-type
      *Create* actions and `t:` search.
- ⬜ **Recent assets**, eventually: the recency ordering the sidebar has today,
      as its own list beside the tree.

**Later in the campaign:** moves and plans, the active move, goals beyond
the empty one.

### Lab and the library file

Try layouts and data shapes in the real app before committing to them.
Design in [`docs/lab.md`](docs/lab.md).

- ✅ **First: (v4, dump₄, load₄)** for today's schema, with the round-trip
      test `load₄(dump₄(db)) = db`. A restorable backup before Campaign 2,
      and the lab's first seed. Agree the format on real examples first: a
      collection, a deck with zones and piles, a saved search.
- ⬜ **Flags:** a *Lab* menu (built like *Tools → Agent API*), a `useFlag`
      hook, and a `flags.ts` registry naming each flag's journey. First flag:
      journey F's *Where it is*, read-only, on real data.
- ⬜ **Lab mode:** a separate database, rebuilt every launch, running the
      real migrations plus an experimental `lab/` list; **LAB** in the
      window.
- ⬜ **Card store:** a local stand-in for Scryfall under `scheduledFetch`,
      keeping every card in its own `card-cache.db`, shared by every mode.
      Hits answer at once; only misses join the queue. `cards` in the user
      database becomes a working copy with the same schema, filled from the
      store; `oracle_fetches` moves to the store. Started by copying the
      cards out of `decklab.db`. Then a lab session starts empty and loads its
      seed, with no copy of the real database. Design in
      [`docs/card-fetching.md`](docs/card-fetching.md) → *The card store*.
- ⬜ **Two freshness limits in the card store:** card data (name, text, set,
      images) refreshed on a long limit, say 90 days; prices and print-run
      completeness stay on 7. Today one 7-day limit makes a load or import
      refetch cards it already has, just to learn which card a set and
      number are ([bug 005](bugs/005-lab-load-rate-limited.md)). Count the
      requests a load of the real library sends, before and after.
- ⬜ **Rate channels:** one channel per group of endpoints, groups that
      overlap, a request needing a slot on every channel it falls in.
      Proposal in [`docs/rate-channels.md`](docs/rate-channels.md).
- 🚧 **The `decklab` CLI:** the app's TypeScript compiled into a standalone
      executable (Bun first), read-only. `dump` and `convert` (v4 → 5)
      built, not yet checked by you. Design in [`docs/cli.md`](docs/cli.md).
- 🚧 **The lab on library file version 5**
      ([`docs/library-format-5.md`](docs/library-format-5.md)): the lab
      schema (`lab/1000_assets.sql`), its load and dump (`labdb.ts`), and
      the lab keeping its data between runs, a seed replacing it. Built and
      round-tripped on the real library; not yet run in the app.
- 🚧 **Today's UI on the new model's tables.** The lab's sidebar is the
      asset tree, with All Magic built in at the top, always first and never
      moved; Decks and Collections are not shown in the lab. Opening a place
      or deck shows a placeholder until the place and deck views exist.
- 🚧 **A right-click menu on the asset tree**, where editing the tree
      starts. **Built (lab):** new child (folder, place, checklist, pool,
      decklist, deck; `+` on the header for the top), rename in place, delete with a
      confirm. Delete is refused while an asset outside pins something
      inside; a by-name reference just keeps its path. All Magic has no
      menu. **Not yet:** move (needs drag or a destination picker),
      duplicate, and which items each type offers.
- ⬜ **Compress the library file with identifiers of its own.** Every line
      repeats the card's name and 36-character oracle id; the real library's
      version 5 file is 4,000 lines, most of them that. A file-local key per
      card (a `[cards]` table defining it once, lines referring to it) would
      shrink it without putting ids in the model: the identifiers exist only
      in the file, and a load resolves them away. Weigh against readability
      and `git diff`, which a line naming its card in full does well. See
      [`docs/library-format-5.md`](docs/library-format-5.md) → *Open*.
- ⬜ **Interned keys in the schema, only once a measurement asks.** The same
      idea in the database: store each distinct value once, refer to it by a
      small integer, give it no meaning. A table of card keys (oracle and
      printing ids to integers), and above all a `buckets` table (integer id,
      unique over oracle, printing, finish, attributes), so lines become
      `(asset, bucket, qty)`: two-column keys instead of five, "every place
      holding this bucket" an integer index lookup, and how many copies each
      bucket holds grouped on one integer instead of four text columns. Still
      "a bucket is a value": the id is never dumped, never referenced, never
      shown, and a load interns afresh. Costs a join on read, interning on
      write, and unused buckets to sweep or leave. Not at today's ~2,700
      lines; try it in the lab when the 50k-card binder (*Virtualise long
      grids*) makes it measurable. The format does not change.
- ⬜ **Lab loads a file at launch:** `DECKLAB_LAB_SEED=path`, loaded into the
      empty `lab.db` before the UI starts. Design in
      [`docs/lab.md`](docs/lab.md) → *Lab mode*.
- ⬜ **Card-level table, after the card store:** one row per oracle id for
      text, stats, colours and legalities, instead of repeating them on every
      printing. A `cards` view over the two keeps reads unchanged. Check
      first whether any oracle id's rows disagree; faces need a list.
- ⬜ **The library file:** a lossless text dump/load, property-identified,
      card data left in the cache, possibly an extension of the DeckLab
      language. Seeds lab mode from a scenario or a dump;
      also backup and, with autosave, maybe the record.

### Card-set algebra — the document model ⭐⭐⭐

The thing panels are views *of*: a **graph of card-set specifications**, where a
spec is a function `card → quantity` and every operation is pointwise arithmetic
on those functions. Typed by `{grain, quantity}`. Everything else in Campaigns 3
and 5 depends on getting this right. The design — nodes, types, grain
conversion, derived values, presets — is in
[`docs/card-set-algebra.md`](docs/card-set-algebra.md). Read
[`docs/cmdr.md`](docs/cmdr.md) first: `cmdr`'s `.decklab` language reached
much of it independently and is built.

Decide before any code:

- ⬜ **Multiset or set?** Proposal: multisets throughout, with an explicit
      `dedupe`. `cmdr` already answers this way.
- ⬜ **Union of multisets: sum or max?** "Total copies used" against "copies
      needed at once". `cmdr` takes `max`.
- ⬜ **Laziness and pushdown.** How far the compiler pushes down to SQLite or
      Scryfall before it materialises.
- ⬜ **Persistence.** How the graph is stored; whether nodes are nameable and
      reusable across workspaces; whether derived nodes cache, and how that
      invalidates.

### Multi-panel workspace ⭐

Move from one fixed layout to a reconfigurable workspace, so the app can be
arranged around the activity rather than around a single "current view".

**First milestone — mimic the Arena deckbuilder.** Pool above, deck below: the
smallest arrangement that proves the model, and the one that gets used most.
Shipped; see [`FEATURES.md`](FEATURES.md) → *Deck builder pool*. Left from it:

- ⬜ Double-click a pool tile to add it to the deck. Implement, then evaluate
      whether it earns its place beside the `±` stepper.
- ⬜ **How many copies you have, on each pool tile.** A tile is bright or dim
      (is the card in Paper at all?) and its stepper counts the *deck*. A label
      such as "3 in Paper" would say whether a fourth copy can come from what
      you have, without hovering each card. Sums every printing of the card,
      so it waits on *Data model* (counts are populations; see
      [`bugs/002`](bugs/002-stepper-counts-printing-grain.md)).

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

### Set operations — surfacing the algebra

Subsumed by the card-set algebra above; what remains here is the UI over it.
- ⬜ Build expressions without writing them — drag nodes together, pick an operator
- ⬜ A graph//node editor panel, or a simpler expression bar to start with
- ⬜ Results are first-class: viewable in any panel, exportable, bakeable into a
      new collection or deck
- ⬜ Common operations as one-click presets, so the algebra stays optional
- ⬜ **A union of two drawn sets in one pane**, for the first case where they
      are not nested ("all red cards" against a collection holding blue). Built
      once and reverted in `cae2f53`; see
      [`docs/two-designs.md`](docs/two-designs.md). The merge is ready
      ([`docs/merging-sorted-sources.md`](docs/merging-sorted-sources.md)).
      Still missing: provenance on rows, membership across sources, and
      invalidating on a write without re-paging.
      [`docs/pool-model.md`](docs/pool-model.md) is the design on file for the
      last of these.
- ⬜ **Choosing what the grid is lit against.** Today `lit` is always the
      active collection. Journey B, Dave's binder lit by mine, needs it to be
      something else. The swatch's gestures (copy, switch, clear) are one
      design for this, setting the lit set rather than a background.

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

Store compact printing rows (~4 MB) rather than raw payloads (~27 MB), and
fetch CSV once rows no longer need the full payload. One piece of work: either
alone is worse than neither, and CSV alone would silently break filtering.
Measurements and reasoning are in
[`docs/card-fetching.md`](docs/card-fetching.md) → *Compact printing rows and
the CSV path*.

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
      brewing/built/retired states are asset tags, under *Data model → The
      asset tree's UI*, since they apply to collections too.
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
[`FEATURES.md`](FEATURES.md) → *Decks*. Much of the list below is built and
tested in `cmdr` — the hypergeometric, joint constraints, solved gaps, and
which constraint binds. Port rather than rewrite; see
[`docs/cmdr.md`](docs/cmdr.md) → *Statistics, eventually*.
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
      ownership*). Journey F in [`JOURNEYS.md`](JOURNEYS.md).

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
- ⬜ **Copy and paste cards and decks.** ⌘C with a card focused copies its
  decklist line (`1 Sol Ring (C21) 263`); ⌘V with a deck active pastes a
  decklist into it. Listen for the DOM `copy`/`paste` events, which the native
  Edit menu fires, and step aside when a text field has focus — so the Edit
  menu stays, and with it undo, dictation and the rest of native text editing.
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
- ⬜ **Digital and paper still mix.** Arena and MTGO copies count toward a paper
  deck. Falls out of the data model: a deck is designed against the locations
  you choose to sum ([`docs/inventory.md`](docs/inventory.md) → *Decks*).
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
- ⬜ **`touched` is trimmed by hand, same trap.** `forget()` is called from only two
  places — deleting the deck or collection you are viewing — so a future delete
  path that misses it leaves a stale entry that can still be chosen as `target`,
  aiming `+` at a deleted id. Fix by deriving: filter `touched` against the live
  `decks`/`collections` arrays, which makes `forget` redundant for correctness.
- ⬜ **Signed, universal builds** with a tightened CSP, before handing the app
  out. What each needs is in [`README.md`](README.md) → *Building a DMG*.
- ⬜ **Piles are main-zone only**, and pile columns cannot be reordered by drag
  (`reorderPiles` exists in the data layer, unused).
- ⬜ **Moxfield JSON needs the Python script.** An in-app "Open file → .json" path
  would remove that step; the conversion logic would need porting to TypeScript.
- ⬜ **No component tests.** Bugs that live in React wiring can only be proven by
  extracting a pure function and testing that: `bugs/001` tested
  `fetchSignature` because nothing could test the rendered grid, and
  `bugs/002`'s proof is "none yet" for the same reason. The `bump()` trap is
  exactly this kind of bug. Vitest is already in place; adding
  `@testing-library/react` with jsdom, and a stub for the `db.ts` layer, would
  let a test press `+` and check the grid. Start with the repros in `bugs/`.
- ⬜ **The SQL layer is mostly untested.** Only the query compiler's output runs
  against a real database (`npm run test:sql`). `collections.ts` and
  `decks.ts` are not covered.
