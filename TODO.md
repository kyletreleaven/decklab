# DeckLab — roadmap

Legend: ✅ done · 🚧 partial · ⬜ not started

**Stack:** Tauri 2 · React 19 + TypeScript · SQLite (`tauri-plugin-sql`) · Scryfall.
All logic lives in TypeScript; Rust handles file I/O only (image cache, file
read/write). Data lives in `~/Library/Application Support/com.decklab.app/`.

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
| **2. Storage and fetching** | partly done | Mixed-grain storage (004) · Card data fetching · Local query parser ✅ · Printings TTL ✅ · Compact printing rows |
| **3. Card-set algebra** ⭐⭐⭐ | design only | Card-set algebra · Foreground and background · Set operations |
| **4. Formats beyond Commander** ⭐ | not started | Format support |
| **5. Multi-panel workspace** ⭐ | not started | Multi-panel workspace |
| **6. Analytics and intelligence** | sketched | Statistics · Card intelligence · Discovery · Suggestions · Playtesting |
| **7. Gaps and polish** | ongoing | Deck builder gaps · Collection gaps · Deck database · Version control · Polish · Known debt |

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
- ✅ **Flip toggle for double-faced cards**, in the card panel. Keyed on the
      face having its own `image_uris`, read from the raw payload in `data` — so
      no migration and no refetch. Split and aftermath cards keep both halves on
      one image and correctly get no button, as do meld cards, whose back really
      is a separate card and so has no `card_faces` at all.
- ⬜ Flip on grid tiles too, if it turns out to be missed there. Left out on
      purpose: a control on every tile is clutter for something that applies to
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
### Panel state retention ✅

Panels are conditionally rendered, so navigating used to unmount them and lose
everything: search, click a deck to add a card, come back to an empty box.

State moved out of the component instead of the component staying alive.
`src/lib/panelState.ts` is a module-level store keyed by panel identity
(`universe`, `deck-pool:<id>`, `collection:<id>`), with a `useRetained` hook that
behaves like `useState` but seeds from the slot and writes through. Rejected, as
planned: keeping panels mounted and toggling visibility — a grid of DOM per
visited panel, all of them re-querying on every mutation.

The classification held up, with one refinement — the two halves are written
differently:

| | Written | Why |
| --- | --- | --- |
| **Lift** — `filter`, `showFilters`, `scopesOff`, `showOutside`, `sort`, `layout` | field by field | independent of each other |
| **Cache** — `heldItems`, `universeCards`, `shown`, `total`, `nextPage` | one object, with a signature | cards from one query plus another's `nextPage` would page the wrong stream |
| **Leave** — `loading`, `error`, `editingName`, `draftName` | not at all | restoring `loading: true` with no request in flight is a lie the store cannot back |

**Staleness is pulled, not pushed.** The signature is
`[source, includeOutside, filter, sort, refreshKey]` — deliberately identical to
the fetch effect's deps, so a mutation made while a panel is unmounted still
invalidates it on return. Push-invalidation from `App` would be the `bump()` trap
again: a convention with nothing enforcing it. The one thing `App` must push is
`forgetPanel` on delete, which no panel can detect for itself.

- ✅ **A `Clear` in the toolbar**, which retention made necessary: a filter set
      ten minutes ago in another view now survives, and the query text is
      exactly what the *More filters (n)* badge does not count. Clears search +
      facets + scopes; leaves sort and layout, which are view preferences.
      Always present and greyed when there is nothing to clear — a button that
      comes and goes reflows the toolbar under the pointer.
      This also exposed that the facet bar's *Clear all* replaced the whole
      filter object, wiping the search box despite a comment claiming it cleared
      "facets only". Now genuinely facets-only, so the two controls differ.
- ⬜ Scroll position. DOM state, so it dies with the element and this does not
      restore it — needs an explicit capture and a layout effect after the rows
      render. Half of "come back to where I was".
- ⬜ Slots are never evicted, only forgotten on delete. Fine at tens of panels;
      revisit if it ever holds many pages of results each.

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

### Universe as a collection — merge card search into collections ⭐

Make **All Magic** a first-class card source, opening the ordinary collection
view backed by Scryfall instead of SQLite. `CardSearch` then has no reason to
exist.

**Universe stays inside the collections model**, which is what the algebra says
anyway: a collection's contents and `Universe` are both `card → quantity` specs,
differing in value (a finite map versus the constant ∞), not in type. Carving it
out would contradict the model for a presentational reason. Placement in the
sidebar is then display — pinned first, since it is what everything else is drawn
from.

**But `kind` is the wrong hook, because `kind` is doing two jobs.**

Today `kind` is both a user-facing label *and* the thing behaviour is derived
from — `OWNABLE_KINDS` excludes `wishlist` and `loaned`. That conflation cannot
express cases that obviously exist:

- Two paper collections, one of them cards you are **selling** — same kind, but
  the sale binder should not count as playable
- A friend's binder imported for **trade reference** — no kind fits; it is not
  yours at all
- **Loaned out** — you *do* own them, you just cannot sleeve them tonight.
  Whether they count is the user's call, not ours
- **Cube** — we guessed it counts as owned. Plausible, but a guess made on the
  user's behalf

**Only `writable` is first-class. Everything else is metadata.**

The test: *does violating it produce nonsense, or just a number you disagree
with?*

- Writing to Universe → **nonsense**. There is nowhere to put the card; no
  coherent behaviour exists. The app must enforce this.
- "Arena counts toward my paper deck" → a number you would disagree with, fixed
  by changing your mind. The app should not be deciding it.

Three categories, which is one more than "structural vs metadata" — card
attributes are neither:

| Category | Example | Editable |
| --- | --- | --- |
| **Reference data** | card name, set symbol, oracle text, legality | no — cached from Scryfall, not ours |
| **Structural fields** | `collection.name`, `deck.format`, **`writable`** | yes, but required and app-meaningful |
| **User metadata** | tags, notes, colour swatch, counts-as-owned, game | yes, optional, arbitrary |

So on a collection specifically:

| Axis | Status | Notes |
| --- | --- | --- |
| **writable** | structural, enforced | the only *behavioural* fact the app decides |
| `name` | structural | required; it is how you identify the thing |
| counts as owned | metadata | with UI support; ultimately the user's call |
| game (paper / Arena / MTGO) | metadata | with UI support — filters, soft warnings |
| colour / icon | metadata | decoration only |

Note `writable` is *not* simply "is it computed". A **stored** collection can
want it too: locking an imported reference binder — a friend's list, a
tournament decklist — against accidental edits is the same flag.

**`writable` is the only property All Magic needs.** An earlier version of this
section argued for a second axis — "is it a *holding*" — to stop the universe
becoming the pool's dimming scope. That was wrong. Dimming is a **set
difference**: the pool renders a background set and un-dims members of a
comparison set, and any card set can play either role. Choosing All Magic as the
comparison set yields an empty difference — an unhelpful choice, but a
well-defined one, and the user's to make.

Writes are the real constraint, because a write is not a set operation. There is
nowhere to put a card in the universe, so `target` must skip it.

- ✅ `isWritable` / `isUniverse` in `App.tsx`, with `UNIVERSE_ID` in
      `collections.ts`. `target` is now `touched.find(isWritable)` rather than
      `touched[0]`, so viewing a read-only source leaves `+` where it was.
      `activeCollection` needs no predicate.
- ⬜ Derived, not stored. `writable` becomes a column only when a *stored*
      collection wants locking — the reference binder above — which is a
      separate feature and not on this path.

- ⬜ Everything else stays user metadata with good affordances rather than
      app-enforced semantics. Resist adding a `game` enum the app reasons about;
      a deck warning is friendlier than a hard rule, and cheaper to be wrong.
- ⬜ **`OWNABLE_KINDS` does not get replaced by a smarter inference — it gets
      deleted.** Ownership scope becomes the user picking which collections
      count, which is exactly selection-as-shared-context. The current
      wishlist/loaned exclusion is a stopgap standing in for that choice.

**Arbitrary user metadata on decks and collections.** Once everything but
`writable` is metadata, enumerating the keys stops being worthwhile — so allow
any. Well-known keys simply get affordances:

| Key | Affordance |
| --- | --- |
| `game` | filter, and a soft warning when a paper deck draws on Arena cards |
| `counts_as_owned` | checkbox; feeds ownership scope |
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

**Not speculative — `PoolPanel` already does this.** One `CardFilter` drives
both branches, compiled to a Scryfall query string on one and a SQL predicate on
the other. (It *used* to offer the choice as a source dropdown; that became the
"Show not in <collection>" toggle, and then the branches stopped being peers at
all — see the base-set note below.) This proposal is to promote the pattern from
one panel to the whole app.

**It is also the algebra arriving early, and usefully.** `Universe` is already a
node in the card-set model — the constant `∞` at a given grain. Making it a
sidebar entry means the first algebra concept lands as a concrete simplification
rather than as scaffolding.

**What it buys:**
- ✅ **Slice 1 done.** `CardSearch.tsx` deleted; the search view is now
      `PoolPanel`. Its `collections` array prop was replaced by the active
      collection from the selection, the source combo box became an inclusion
      toggle, and the add-button label derives from `target` rather than being
      passed separately.
- ✅ **Removed the "skip the network when the collection fills a page"
      shortcut** — and with it the merge it was guarding. The pool is not a
      union of two sources: **All Magic is the base set**, paged from Scryfall,
      and the active collection only decides which tiles are *un-dimmed*. The
      local query runs only when "Show not in <collection>" is unchecked, which
      is the one case where outside cards are genuinely unwanted. The old
      shortcut made the pool silently collection-only for any query a
      decent-sized collection could satisfy, and the merge it protected also
      handed *ordering* to whichever side happened to be non-empty.
- ⬜ **Release date as a sort.** Both sides can already express it: `released_at`
      has been a column since migration 001 and orders the printings carousel,
      and Scryfall takes `order=released`. Newest-first is the useful default,
      like price. Note it is a *printing* fact, so at oracle grain it dates
      whichever printing the row stands for, not the card's first appearance —
      "newest reprints" and "newest cards" are different questions and only the
      first falls out for free.
- ⬜ **Asc/desc control** — shares the `SORT_SQL` split with step 2 of
      *Foreground and background*, so do them together. Free remotely
      (`dir` is already threaded), but
      `SORT_SQL` hardcodes direction inside each string
      (`"ci.quantity DESC, c.name"`), so it must first split into expression +
      direction + tiebreaker. Worth doing once, with the merge in mind: the
      tiebreaker is what makes the key **total**, so keep it fixed ascending
      rather than flipping it with the primary key. The control flips the
      per-key default (price stays descending on open) rather than forcing asc.
- ⬜ **Merging returns when the sets stop being nested** — step 3 of *Foreground
      and background*, which is what makes it a prerequisite rather than a
      someday item. Today background ⊇
      foreground (All Magic contains every collection), so one page of the
      background is the whole answer and un-dimming is a local membership test.
      For sets in no subset relation — "all red cards" against a collection
      holding blue — a foreground card may be absent from the background
      entirely, so each set needs its own ordered stream, merged k-way by their
      heads. Two constraints: the sort key must be **total** (`(name, id)`, not
      `name`, or ties across a page boundary duplicate or drop), and both sides
      must page in the **same** order — the intersection of Scryfall's `order=`
      and SQL, which is why sort has to be settled first. Costs k page-fetches
      per screen instead of one.

- ✅ **Pool tiles gained a `− N +` stepper**, acting on the pool's
      *destination*: the deck when the pool sits under one (by construction —
      that pool exists to fill it), the current target in the standalone search.
      `onAdd`/`target` collapsed into one `destination` prop, so the panel never
      learns whether it is feeding a deck or a collection. Counts come from one
      whole-container query (`deckQuantitiesByPrinting` /
      `collectionQuantitiesByPrinting`) rather than per-card lookups. The
      inline `onAdjustTarget` closure became named `adjustTarget`/`adjustDeck`
      in `App.tsx`, so fewer places can forget to `bump()`.
- ✅ **Control placement now follows what a control acts on.** Constraints that
      AND onto the search query — facets, deck scopes, format legality — live
      behind "More filters" and count toward its badge. "Show not in
      <collection>" went back to the toolbar and out of that count: it chooses
      shadowed vs. absent, which is the same axis as the dimming, so hiding it
      behind a disclosure separated the switch from its effect.

- ⬜ Split the deck-attached pool into its own lightweight component once
      `compact` grows siblings — three or four "not in the strip" flags means it
      already is a different component wearing the same one. Not yet: the
      two-branch fetch, sort, facets, dimming and paging are genuinely shared.

- 🐛 **Reconcile printings between the pool and the containers.** Now that All
      Magic is the base set, each tile shows whichever printing Scryfall's
      `unique=cards` happened to return, while decks and collections hold
      *specific* printings. The two grains disagree, and three things sit on the
      wrong side of it today:
      - `destination.quantities` is keyed by printing id, so a card you hold in
        another printing shows `0` and a disabled `−` even with copies in the
        deck. **This is live and wrong**, introduced with the tile steppers.
      - ✅ `+` adding an arbitrary printing is fixed *once you have picked one* —
        `activePrintings` substitutes it into the row, so the stepper writes what
        you see. Unpicked cards still use whatever the stream returned.
      - The dimming is *correct* — it is oracle-keyed via `ownedOracleIds` —
        which is why the disagreement is easy to miss on screen.

      Candidate resolutions, cheapest first:
      1. **Roll counts up to oracle grain for display**, keep printing grain for
         writes. Fixes the lying badge immediately; `+` still picks arbitrarily.
      2. **Substitute the owned printing in the tile** when the collection holds
         one — the pool then shows you *your* copy, and `+`/`−` land on it.
         Wants a printing→oracle index over the active collection.
      3. Full mixed-grain storage — see *Migration 004* below, which is the
         principled version and the one the card-set algebra assumes.

      (1) is the piece still outstanding, and it is now the *only* wrong thing
      on screen: the badge and `−` read printing-keyed counts, so a card you hold
      in another printing shows `0` with `−` disabled. Slice 2 shipped without
      it.

- ⬜ **Card mode needs an *active printing*, and a way to pick it.** The above is
      really one question — when a row is a card rather than a printing, which
      printing do `+`/`−` write? Today nobody decides: it is whatever
      `unique=cards` returned.
      1. **Default to the one you own.** Same as resolution (2) above, and it
         makes the badge and `−` correct in the same stroke.
      2. **Hover carousel on the tile as the override**, with hovering a printing
         putting it in the card panel — the existing rule ("what you hover is
         what the panel shows") extended from card grain to printing grain. The
         tile becomes the picker, the panel stays the detail surface, so the two
         are not redundant.
      Cost is fine: printings are cached after the first fetch (migration 003),
      and a hover storm is exactly what the scheduler's keyed eviction is for.

- ✅ **Slice 2 — `PoolPanel` grew the collection view's features.** Wall/list
      layout, sort, totals, item-grain rows, and the collection actions. Two
      things landed differently than planned: totals are *hidden* against the
      universe rather than shown as `∞`/blank (a row of dashes is chrome
      pretending to be data), and capability is expressed by **absence of a
      prop** — no `subject`, no header row — never by a flag saying "you have
      this, hide it". `compact` covers the deck-attached strip, which drops the
      browsing chrome because it is a candidate strip, not a place you browse.
- ✅ **Slice 2b — sort drives both branches.** `src/lib/sort.ts` is the one
      vocabulary, mapping to Scryfall's `order=`/`dir=`. `dir` is always
      explicit: the default varies by key (`cmc` ascends, `usd` descends), which
      a contract test pins. `quantity` carries no remote mapping and drops out
      whenever a Scryfall stream is in the answer.
- ✅ **Slice 3 — `CollectionView` deleted** (316 lines), the collection view is
      `PoolPanel` with a `subject`, and All Magic (Scryfall) is pinned first in
      the sidebar with a divider under it. The bundle *shrank* despite the
      panel absorbing everything.
- ✅ **Card search is gone as a separate view.** It was All Magic with a
      different comparison set, so it is now the All Magic view — which is also
      the default view and the fallback after a delete. Its bespoke "Adding to
      X" bar went with it.
- ✅ **Grain follows the stream.** Local branch → `CollectionItem[]`, printing
      grain, with finishes and a `×` to drop an entry. Scryfall branch → cards,
      oracle grain. `stepperFor(row)` resolves what `±` acts on from the row's
      grain, so a `−` on your foil no longer decrements the nonfoil entry that
      shares its printing id.
- ✅ **Active printing is shared.** `activePrintings` (oracle id → card) lives in
      `App`: the card panel picks, oracle-grain rows render and write it. Row
      keys moved to the oracle id so swapping a printing updates in place rather
      than remounting and dropping hover.
- ✅ **The universe is never the comparison set.** Not a modelled property — the
      sidebar entry simply declines to `touch`, so the model keeps "any set can
      be the comparison set" while the UI offers no gesture for the useless one.
      The All Magic view passes `activeCollection={null}`: nothing dims, and the
      "Show not in …" toggle does not render.
- ✅ **"Show not in <collection>" survives only in the deck pool.** In the
      collection view it was a second route to a view already in the sidebar,
      and it changed grain underfoot. Fixing that surfaced a real bug: the local
      branch read `activeCollection` rather than the collection being
      *presented*, so alt-clicking into Paper with Cube active showed Cube's
      items under Paper's header. `subject` now carries an `id`.

**One input box needs one language — ✅ done.** Recorded here as the real
blocker: the box sent free text to Scryfall but compiled it to
`c.name LIKE '%…%'` for a collection, so `t:creature` silently matched nothing.
The option taken was *Scryfall syntax everywhere*, which is why the deferred
query language came back. `collections.ts:154` now runs `compileQuery` over the
same string the universe branch sends to Scryfall, and unsupported terms raise
`QueryError` rather than quietly matching nothing.

Residual, not blocking: the dialects are not equal. `is:` and friends compile
remotely but not locally, so a collection-only query can fail where All Magic
answers. Wants a *"this term needs All Magic"* affordance eventually.

Options:

| | Cost |
| --- | --- |
| Facets only | Loses full Scryfall syntax in search — `o:"draw a card"`, `is:commander`. A real regression |
| Scryfall syntax everywhere | Needs a local parser and SQL compiler. **This is the deferred query language returning** |
| Asymmetric, as today | The same box means different things by source. Already a silent-failure bug |

**The grammar is confirmed** (contract tests, verified live): juxtaposition means
AND, `and`/`or` work as keywords, `-` negates, and parentheses nest and really
bind — `(c:r or c:w) t:creature` returns strictly more than `c:r t:creature`.
That is what a local parser has to match.

**A useful subset is very achievable**, because most predicates map to columns
that already exist: `t:` → `type_line`, `c:`/`id:` → the canonical colour
strings, `o:` → `oracle_text`, `mv`/`pow`/`tou` → numeric compares, `r:` →
`rarity`, `set:` → `set_code`, `f:` → `json_extract(legalities, …)` (already done
for the pool's format scoping), `kw:` → the keywords JSON. Plus AND/OR/NOT and
parentheses, which is a small parser.

**Most of `is:` is achievable too** — it is Scryfall's catch-all for boolean card
properties, and we already hold what most of them need:

| Predicate | From |
| --- | --- |
| `is:reserved`, `is:digital` | dedicated columns |
| `is:split`, `is:transform`, `is:mdfc` | `layout` column |
| `is:permanent`, `is:spell`, `is:vanilla` | derivable from `type_line` / `oracle_text` |
| `is:borderless`, `is:showcase`, `is:extendedart`, `is:promo` | raw JSON — `variantTraits()` already reads these |
| `is:foil`, `is:etched` | `finishes` in raw JSON |
| `is:commander` | legendary creature or "can be your commander" — `commanderIssues()` already computes it |

The genuinely hard remainder is narrow:

- **Curated cycle lists** — `is:fetchland`, `is:shockland`, `is:dual`,
  `is:triome`. No card property says "I am a fetchland"; these are editorial
  lists Scryfall maintains by hand. Local support means shipping our own list and
  keeping it current.
- **Regex terms** (`o:/…/`) — SQLite has no `REGEXP` operator without
  registering a function in Rust. Post-filtering in JS would work on a bounded
  result set.
- Anything needing data we do not cache.

**Resolution: local language for local sources, passthrough for Universe.**
Implement a good subset locally, and when the source *is* Scryfall, send the raw
string straight through — they parse their own language better than we ever
will, and there is nothing to gain by intercepting it. Local parity is only
needed for what people actually filter collections by, which is a much smaller
set than everything Scryfall accepts.

**`is:` — unsupported locally to start.** Deliberately out of the first cut. It
still works in All Magic, where the string passes straight through to Scryfall;
against a local collection it should simply report *"`is:` is not supported here
yet"* rather than silently matching nothing.

The design when it does arrive — **cached hidden collections** — is worth
keeping, because it dissolves the curated-cycle problem rather than working
around it: resolve `is:fetchland` by asking Scryfall *once*, cache the resulting
card set, and thereafter treat it as a local membership test. That generalises to
**any** predicate we cannot compute locally: "we cannot compute this" becomes "we
can look it up and keep it", which is a far easier problem. It also makes `is:`
just another `ScryfallSearch` collection, per below.

Reasons to defer rather than build now:

- ⬜ Needs a TTL and an invalidation story — new fetchlands get printed
- ⬜ First use is a network round trip, so the predicate is **async on cold
      cache**, which no other local predicate is. That asymmetry is the real
      cost, and it is better paid once the rest of the language is settled.

**`ScryfallSearch(query)` as a collection class ⭐.** A collection whose contents
are *defined by a query* rather than enumerated — saveable from any All Magic
search ("save as collection"), and flattenable into a concrete list.

This is the algebra arriving through the front door: `ScryfallSearch(q)` is
`Filter(Universe, q)`, and flatten is the *bake* operation — applying a modifier,
in Blender terms. Several things then stop being special cases:

| Was | Becomes |
| --- | --- |
| Universe | `ScryfallSearch("")` — the unfiltered case, not a separate kind |
| `is:fetchland` cache (later) | an implicit `ScryfallSearch("is:fetchland")` |
| "saved search" | a collection you can point any panel at |

And `writable` falls out rather than being declared: a query-backed collection
cannot accept cards, because there is nowhere to put them. **Flattening is
exactly the operation that makes it writable** — freeze the query result into
rows, and now it is an ordinary collection. That also gives a natural upgrade
path: search → save as live collection → flatten when you want it to stop moving.

- ⬜ Live versus frozen is a real user-facing distinction, not an implementation
      detail. "All fetchlands" should stay live; "my cube" should not silently
      gain cards when Wizards prints one.
- ⬜ Show which a collection is, and make flattening explicit.

- ⬜ A lexer/parser for the local subset was written and deleted early on, when
      scope was cut back to "manage collections and decks". **Not recoverable** —
      it was never committed, so this is a rewrite. See the plan below.
- ⬜ Interim, if the merge lands before the parser: keep free text as a name
      match locally, but **detect syntax-looking input** (`foo:bar`, comparison
      operators) and say so, rather than returning zero results as though
      nothing matched.

**The rest is mostly presentational.** The query language above is the real work.

**Quantity: Universe holds ∞ of everything, not nothing.** The model stays
uniform — every source is `card → quantity`, and Universe is the constant ∞,
exactly as the algebra already requires (it must be ∞ rather than 1, or
`Min(deck, Universe)` would cap every entry at a single copy). So there is no
set-versus-multiset split to reconcile; only rendering differs.

- ⬜ Show ∞ or show nothing. Steppers, totals and the quantity sort omit or grey
      out, since incrementing ∞ is not a thing.

**Presentational, resolved by omission or greying:**

- ⬜ **Sort** compiles to Scryfall's `order=` for remote sources and `ORDER BY`
      locally, exactly as filters already do. Worth doing rather than skipping:
      sorting a *paged* remote result locally would silently sort only the loaded
      page. `quantity` sort hides for Universe.
- ⬜ **Stats bar** — "Cards / Unique / Est. value" is computed from loaded rows,
      which for a search is a lie (175 of 30,000) or absurd (the value of all
      Magic). Use `total_cards` as a match count; hide est. value.
- ⬜ **Toolbar** — rename, delete, import have no meaning for Universe; export
      arguably does. Affordances derive from `writable` plus source.
- ⬜ **Loading and error states** — `CollectionView` has neither today, because
      local queries never fail visibly. `PoolPanel` already has both; use it as
      the reference.
- ⬜ **Paging benefits local collections too** — a 50k-card binder wants
      virtualisation regardless of source, so this is not purely a Universe
      concern.

**Facets and query text are independent filters, AND-ed together ⭐.**

```
effective = parse(queryText)  AND  facetPredicate
```

Facets keep their own state; the query keeps its own; neither tries to represent
the other. Considered and rejected: making the query the single source of truth
with facets editing terms *in place*. That requires matching a facet to a term
inside an arbitrary boolean expression, which is ambiguous the moment structure
appears — is Red "on" when the query says `(c:r or c:w)`? What about `-c:r`? —
and editing in place is harder still.

**This is already what the code does.** `toScryfallQuery` pushes free text as one
clause and each facet as another, then joins with a space, which is Scryfall's
implicit AND. The change is only that free text becomes a *full query* rather
than a name match, which for local sources is what the parser is for.

Costs, both minor and both about visibility rather than correctness:

- ⬜ Redundancy is possible — typing `c:r` while Red is ticked yields `c:r c:r`.
      Harmless, just untidy.
- ⬜ Contradiction is possible — typing `c:r` with only White ticked asks for
      cards that are red *and* white. Honest AND semantics, but surprising if the
      facets are scrolled out of view.
- ⬜ So the active-facet count must stay visible whenever a query is present.
      The existing `Filters (3)` badge already does this; keep it prominent
      rather than tucked behind a toggle.

**Universe is a variant, not an identical twin.** These differences want to be
*capabilities* on a source rather than `if (source === SCRYFALL)` branches:

| Capability | Collection | Universe |
| --- | --- | --- |
| `writable` — can hold cards | yes | **no** — nothing can be added to it |
| `bounded` — listable without a filter | yes | **no** — an empty filter must say "search", not list 500k cards |
| `paged` | no, returns everything | yes, 175 per page |
| `ownershipOverlay` — dim uncollected | no, everything is owned by definition | yes, Arena-style |
| sort vocabulary | SQL columns | Scryfall's own `order=` |

**Consequence for target semantics.** Clicking All Magic touches it, but it
cannot receive cards — so `target` becomes *the most recent **writable** entry*
rather than simply the first. That is arguably a better definition anyway:
"target" means the last thing you touched that can hold cards.

- ⬜ Virtual, not a stored row — a sentinel id, since a `collections` row that
      can never hold items would be a lie. Revisit if the container model lands,
      where Universe would be a container of kind `universe` whose contents are
      computed rather than stored.
- ⬜ Ownership overlay in Universe needs a scope, which is the same
      selection-as-scope question as everywhere else.

### Local query parser ✅ — wired in

`src/lib/query/` — lex → parse → compile, behind `compileQuery()`. Supports
`t: o: name: c: id: mv: pow: tou: loy: r: set: f: kw: layout: a:` plus
juxtaposition-as-AND, explicit `and`/`or`, `-` negation and nested parens.

**Plan and grammar: [`docs/query-language.md`](docs/query-language.md).**

- ✅ Parameterised throughout; field names come from a fixed map, so nothing
      user-supplied reaches the SQL text
- ✅ `is:` and unknown fields report rather than silently matching nothing;
      `unsupportedTerms()` lists them without throwing
- ✅ `compileQuery()` returns errors instead of throwing — search runs per
      keystroke, so half-typed input is the normal case. A test walks every
      prefix of a realistic query to prove none of it explodes
- ✅ Colour comparisons are **independent of stored order**: "exactly RW" is
      *contains both, and has two colours*, not `colors = 'WR'`. Nothing depends
      on the WUBRG canonicalisation holding
- ✅ `power`/`toughness`/`loyalty` guard against `CAST('*' AS INTEGER)` being 0,
      which would otherwise make `pow<=1` match every `*` creature — 703 rows
      instead of 665 on the current cache
- ✅ Rarity comparisons rank rather than compare strings, so `r>=rare` includes
      mythics (alphabetically `mythic` < `rare`)
- ✅ 115 unit tests, plus 10 **SQL integration tests** (`npm run test:sql`) that
      execute generated SQL against the real database. Those are the ones that
      matter: unit tests only prove we emit the string we intended

**Remaining — wiring:**

- ⬜ `collectionItems()` still builds its own WHERE from `CardFilter`. Give it a
      query string compiled through `compileQuery`, AND-ed with the facets. This
      is the change that stops `t:creature` silently returning nothing against a
      local collection.
- ⬜ Surface parse errors and unsupported terms in the filter UI.
- ⬜ **Make "Deck-legal" work outside the deck view** — it vanishes on
      navigation, exactly when you want it. `activeDeck` is *not* the problem;
      it persists correctly. Two other things are: `deckScope` reads
      `currentDeck` rather than `activeDeck` (and needs that deck's commander
      zone, since `entries` only holds the viewed deck), and `scope` is only
      passed to `PoolPanel` in the deck view. Fixing either alone changes nothing.

- ✅ **Split the bundled scope into independent toggles.** `deckScope` fused
      format legality and colour identity, so a single switch reached only two
      corners of a 2x2 — banned-cards-in-your-colours and
      legal-cards-outside-them were both unaskable. Now `scopes: Scope[]`, each
      toggled separately, identity rendered as mana symbols since the constraint
      is about colours rather than the deck.

- ⬜ **Rename `Scope`.** The word already means something else here —
      selection-as-scope, i.e. which collections count as owned. `ContextFilter`
      is the better name: a constraint whose *value* comes from context, where
      you control only whether it applies. One interface, one prop, two call
      sites.

- ⬜ **App derives the scopes, which sits oddly.** The derivation depends on the
      selection (App's) but is consumed by the panel, so App ends up knowing what
      the pool wants. Resolves under selection-as-shared-context: scopes come
      from the shared store and any panel reads them. Symptom of the missing
      store rather than a problem of its own — leave until then.

- ⬜ More contextual filters of the same shape once they are wanted: not already
      in *deck*, in *collection*.

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
- ✅ **Fixed: eviction was not actually LIFO.** `Map.set` on an existing key
      keeps that key's *original* insertion position, so a replacement job was
      ordered by when its kind first appeared rather than when it was queued —
      a fresh search would wait behind a stale hover, inverting the whole point
      of the lane. `delete` before `set`. Caught while tracing why the pool
      looked unresponsive; pinned by a test that fails without the delete.
- ✅ 10 tests covering the parts that fail silently — that an evicted job really
      does not run, that different keys coexist, that a replacement is ordered by
      when it was *queued*, that interactive preempts background, that background
      work is never dropped, and that spacing holds.
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

### Foreground and background — the pool as two sets ⭐

Today's panel has both already, unnamed:

- **Foreground** — the set you are looking at. Always rendered, always lit.
- **Background** — the wider context behind it. Rendered *only* when
  "Show not in <foreground>" is checked, and dimmed when it is.

**Rendered = foreground ∪ background when the toggle is on, foreground alone
when it is off.** The toggle is therefore a choice of operand, not a visibility
flag — and its existing label already says exactly this.

The one-off behaviours all become instances:

| Panel today | Foreground | Background |
| --- | --- | --- |
| Collection view | that collection | All Magic, toggle off |
| Deck-attached pool | your active collection | All Magic, toggle on |
| All Magic view | All Magic | none |

Letting each be any card set is the whole generalisation. Note it is the
*background* that is currently hardcoded — always All Magic, never chosen.

**Choosing them — promote, do not pick.** Modelled on Photoshop's foreground /
background swatches: two named slots and small buttons between them, rather than
a chooser.

- ⬜ **Copy to bg** — the background is *promoted from the foreground*, never
      selected from a list. Journey B is then: open Paper, copy to bg, navigate
      to Dave's binder. No picker, and it is meaningful from the very first
      state, which a swap alone is not.
- ⬜ **Switch** — swap the two. Viewing his binder against yours becomes yours
      against his in one click: the "what could I offer him" view, which
      otherwise means navigating away and back.
- ⬜ **Clear bg**, back to All Magic. "No particular background" and "everything"
      are the same thing, so unset needs no separate value — and with bg at All
      Magic, switch is correctly dead, since promoting it would light every card
      and say nothing.
- ⬜ Navigation sets the foreground, so no new gesture is needed for that half.
      **Switch therefore navigates** — it moves you to the old background with
      the old foreground behind you — and that is fine rather than a compromise.
- ⬜ The foreground need not be a saved collection. An in-flight search is one
      too: All Magic plus a query is already a page you can be on. So "copy to
      bg" from a search means *compare these results against that set* without
      saving anything, and journey C's "save as collection" is the durable
      version of the same gesture.
- ⬜ The background, by contrast, is **one app-level value**, not per panel:
      journey B copies it in Paper and then navigates to Dave's binder, so panel
      state would reset on arrival and the journey would be impossible.

**Selection and rendering stay separate controls.** *Which* set is behind you and
*whether you are looking at it* are different questions: the collection view
wants "background is All Magic, just do not draw it", which is not the same as
having no background. So the existing show/hide toggle survives alongside the
slot pair rather than being folded into it.

**Lit ⟺ in the foreground.** Nothing else, and no distinction *among* the lit:
whether the background also has a card is not something the grid says. Dimming
answers exactly one question — *is this in my set?* — so the display stays
two-toned however unrelated the two sets are.

| Region | Journey B reading | Treatment |
| --- | --- | --- |
| foreground ∩ background | he has it, I have it | lit |
| foreground ∖ background | I have it, he does not | lit, indistinguishably |
| background ∖ foreground | he has it, I do not | dimmed |

Whether the first two should ever be told apart — "could I offer this in trade"
is a fair question — is left open rather than planned. If it is wanted it has to
be a *positive* mark, since dimming already means the other thing.

**Order of work.** The background's only job is to be drawn beside the
foreground, so there is no cheap slice where it is selectable but the merge is
not needed: with the toggle off it is not drawn and does nothing, and with it on
it must be merged. That puts the visible part last.

1. ✅ **The panel speaks fg/bg**, background still pinned to All Magic.
   `activeCollection` became `foreground`, `subject` split into `foreground` +
   `manage` (identity and editability being different questions — the deck pool
   has a foreground it must not offer to rename), and `includeOutside` became
   `drawingBackground`. No behaviour change.
   The model fits: each call site is now one line naming its foreground, and the
   two `activeCollection={null}` hacks are gone — All Magic passes *itself* as
   the foreground, and nothing recedes because lighting a set that contains
   everything lights the grid.
2. ✅ **The sort key is total** — `<field> <dir> NULLS LAST, c.name ASC,
   c.id ASC`. Name before id so a tie group still reads alphabetically; the
   printing id finishes the job, since printings share a name and that is
   exactly what lets a card land on both sides of a page boundary.
   `SORT_SQL` is gone: sorts live once in `sort.ts` and serve both sides, so
   direction has one source rather than a string on one side and a field on the
   other. `NULLS LAST` is now unconditional — SQLite puts NULL first ascending,
   so priceless cards used to lead an ascending price list. The asc/desc control
   is now mostly wiring.
3. ⬜ **The k-way merge**, over streams ordered by that key.
   **Settle first:** Scryfall will not take our tiebreaker, so its stream is
   total by *its* rules, not `(name, id)`. That cannot drop or duplicate rows —
   each stream is consumed in its own order — but it can misorder within a tie
   group. Decide whether each arriving page is re-sorted locally before merging.
4. ⬜ **The swatch** — copy to bg, switch, clear. First step where anything new
   appears on screen; doing it earlier puts three buttons up that cannot change
   what you see.

**This makes the k-way merge a prerequisite, not a someday item.** It is free
today only because the background is always All Magic, which contains every
foreground — so the union collapses to one stream. The moment a background is a
collection the two are not nested, and rendering their union means merging two
ordered streams by a total key — regardless of how the results are shaded.

- ⬜ `subject` and `includeOutside` largely dissolve: the first becomes
      "foreground = X", the second is the toggle deciding whether the background
      joins in.
- ⬜ Falls out for free: "add to Paper from Cube" — foreground Paper, background
      Cube — which the collection pool cannot express today, since its background
      is hardcoded to All Magic; and chop shop's back half, where a deck pool
      over the union collection is the same gesture as one over All Magic.
- ⬜ Grain still follows the stream: printing grain from a collection, oracle
      grain from Scryfall. With both operands in play a union can mix them, which
      is the same question the merge has to answer anyway.

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

- ✅ **Ownership scope is now consistent.** All three views — card panel counts,
  pool dimming, deck ownership — read the *active collection*, falling back to
  all ownable kinds when none is selected. `wishlist` and `loaned` stay excluded
  from that fallback. The deck view's "check against" chips are gone: they were a
  per-view scope competing with the global one.
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
- **`bump()` is a manual convention with nothing enforcing it.** Every mutation
  has to remember to signal, and five call sites did not — `addToDeck` plus the
  deck row's quantity, remove and zone handlers — so the card panel's counts went
  stale after adding from search. It then recurred in the *other* direction: the
  pool's `ownedOracleIds` effect was keyed on the collection alone, so adding a
  card from search left its tile dimmed. Signalling was never the whole problem;
  every consumer must also *subscribe* to the signal. Fixed case by case, but the
  next mutation — or the next derived set — will have the same trap.
  Two ways out, both already implied elsewhere in this file: have the mutation
  helpers in `decks.ts`/`collections.ts` own the signal, or make the panel
  *subscribe* to its data rather than being told to refetch — the "derived data
  belongs in a cache keyed by its input" rule from *Where state lives*.
- **`touched` is trimmed by hand, same trap.** `forget()` is called from only two
  places — deleting the deck or collection you are viewing — so a future delete
  path that misses it leaves a stale entry that can still be chosen as `target`,
  aiming `+` at a deleted id. Fix by deriving: filter `touched` against the live
  `decks`/`collections` arrays, which makes `forget` redundant for correctness.
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
