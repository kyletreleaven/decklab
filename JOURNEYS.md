# DeckLab — journeys

End-to-end walkthroughs of experiences we want to work. They exist to motivate
the roadmap: [`TODO.md`](TODO.md) says what to build, this says what for.

Each step is marked with whether it works *today*, so a journey doubles as a
click-through.

Legend: ✅ works · 🐛 broken · ⬜ not built

---

## A. Chop shop — three decks become a pool

> I own three built Commander decks. I want to take them apart and brew
> something new from the parts.

1. ⬜ Make a collection from the union of the three decks. **Sum, not max**: two
   decks each holding a Sol Ring means two physical Sol Rings, and losing a card
   you own is the one unacceptable error here. Printing grain — these are the
   actual sleeved cards. Commander + main zones; `maybe` is not in the box.
2. ⬜ Materialised, not live. This records "these cards are now loose in a pile",
   and must not shift underneath me if I later edit one of the old decklists.
3. ✅ Open a new Commander deck; make the pool collection the comparison set.
4. ✅ Uncheck "Show not in …" in the deck-attached pool — candidates are now
   only those cards, at printing grain.
5. ✅ Build with `+`, which fills the deck rather than the collection.

**Gap:** steps 1–2 only, and they do not need the full card-set algebra. "New
collection from decks…" is a dialog, a sum, and a write.

---

## B. Trade binder — browsing someone else's cards against mine

> My friend's binder and my own are both in the app. Mine is incomplete. I want
> to find interesting cards in his, knowing what I already hold.

1. ✅ Alt-click into his binder: it opens without retargeting, so **my** binder
   stays both the comparison set and the target.
2. ⬜ Each row of his binder shows **how many I hold**, at *oracle* grain — his
   Ravnica Sol Ring must tell me about the one in my Commander deck. Today the
   comparison set only dims: it says "some" rather than a number.

   Our printings will usually differ, and that is fine rather than a problem to
   solve: the question is "do I already have this card", so the answer sums
   across printings. A printing-grain count would answer "none" and be worse
   than useless. Printing still matters for what a trade is *worth* — a
   different question, and not this one.
3. ✅ Clicking a card states my counts in the card panel, scoped to my binder.
4. ✅ Adding a copy **to mine** works from the *card panel's* `±`, which follows
   the target — alt-click left that pointed at my binder.

   Not from the grid: a row of his binder is a printing-grain entry, and its
   `±` edits that entry, so `+` there adds to *his*. That is right — the grid
   edits what you are looking at, the card panel edits your target — but the two
   controls mean different things on one screen, which is worth watching.
5. ✅ The view updates immediately.
6. ✅ "Mine is partial" is fine — nothing blocks recording a card that was never
   entered.

**Gap:** step 2 is the same *roll counts up to oracle grain* primitive that is
the last open piece of the unified-panel campaign. Two unrelated journeys wanting
it is good evidence it is the right primitive.

---

## C. Save a search as a pool — live, or as it stands

> I have refined a Scryfall search until it is exactly the pool I want to brew
> from. I want to keep it.

1. ✅ Search in All Magic until the results are right — query, facets and sort
   all already work, and the panel remembers them if I navigate away.
2. Choose what to keep:
   - ⬜ **Save as live pool** — the query itself. It stays up to date: a new
     printing that matches joins it.
   - ✅ **Save as pool** — today's **Save as collection…** — the cards that
     match right now, defaulting the name to the query text.
3. ⬜ Saving a pool takes *all* matches, not the page in hand — but **capped
   at ~10 pages (about 1,750 cards)**, refusing above that with "narrow your
   search first".

   The budget is requests, not bytes, and no arrangement of the API makes a
   big walk cheap — see
   [`docs/fetching-many-cards.md`](docs/fetching-many-cards.md).
4. ✅ **A saved pool is static.** A snapshot: it must not shift when Scryfall
   reprints something. That is the difference from a live pool, and naming
   both is what keeps it explicit rather than accidental.
5. ✅ Afterwards either is an ordinary pool — browsable, usable as a deck
   pool's comparison set, exportable. Adding from it to a deck*list* takes
   nothing from anywhere; only putting cards into a physical deck does.

**Settled:** full JSON, cached as it arrives, so the walk is paid once and
everything after is local. CSV and stub-row shortcuts were both ruled out; a
whole-corpus bulk ingest would remove the walk entirely but is a someday option,
not a prerequisite. Reasoning in
[`docs/fetching-many-cards.md`](docs/fetching-many-cards.md).

**Type:** a pool is membership, not counts — cards to brew from, not copies
in a collection. Storing quantity 1 would be a false claim and, worse, would
cap real counts to 1 the first time anything intersected with it. See
[`docs/card-set-types.md`](docs/card-set-types.md). In
[`docs/inventory.md`](docs/inventory.md) terms a pool is an ω set: a live
pool a *predicate* one, a saved pool a *literal* one, and saving renders the
first to the second. Today a saved pool is stored as a **binary**
collection.

**Open:** which printing. `unique=cards` returns one per card and that is the
row you were looking at, so it is the natural default.

**Note the family.** This and journey A are the same shape: a collection built
from something else — a union of decks there, a query here. Both materialised,
both wanting a "New collection from…" entry point rather than two unrelated
buttons.

---

## D. Build it — from a decklist to a sleeved deck

> I have brewed a Commander list and I am happy with it. Now I want it in a
> deck box: the foil Sol Ring from my binder, any Island at all, and a clear
> list of what I still have to buy.

1. ⬜ Pin printings only where I care — *this* Sol Ring, the C21 foil — and
   leave the rest as "any printing". Pinning art never makes the list illegal.
2. ⬜ Ask what to pull, and get it grouped by where the cards are: *Binder 2:
   Sol Ring (C21 foil), Cultivate…*, *Bulk box: 30 Forest*. Cards I have
   nowhere are a separate shopping list.
3. ⬜ **Fill a slot from a collection.** From one missing slot in the deck, I
   choose a collection to look in — Paper, say — and the card panel lists
   that collection's copies of the card: *Binder 2: Sol Ring (C21 foil) ×1*.
   `←` on one moves it into the deck. The choice is required: nothing is
   guessed for me.

   Step 2 one slot at a time, and not journey F: F asks where a card is
   anywhere, with no collection chosen; this asks whether *this* collection
   can fill the slot. Needs journey E step 3 first: Paper is a sum of
   places.
4. ⬜ Walk the shelves with that list and tick off each binder as I finish it.
   Stopping halfway is fine: the deck shows what has arrived and what is still
   to come.
5. ⬜ If another deck is counting on the same Sol Ring, I am told *before* I
   pull it, not when the other deck comes up short.
6. ⬜ Weeks later I swap Cultivate for Kodama's Reach in the list. The deck box
   shows it is out of date: Kodama's Reach to put in, Cultivate to take out,
   and which binder it goes back to.

**Gap:** all of it — the *Data model* campaign in `TODO.md`. Step 1's "any
printing" is the first wall: today a deck entry must name a printing.

---

## E. Collecting — mirror my shelves, chase a set

> My cards are spread over binders, a bulk box and deck boxes. I want the app
> to show where each card actually is, and I want to chase all of MH3,
> foils included.

1. ⬜ Set up places that match my shelves: Binder 1, Binder 2, the bulk box,
   each deck box. A card is in one place, as on the shelf.
2. ⬜ Enter cards as loosely as I know them — "4 Lightning Bolt", printing
   unknown — and fill in the detail later, as I sort.
3. ⬜ "My collection" is those places added up, and I pick which ones count:
   the friend's binder I track for trades does not.

   First piece: a **sum collection** that sums its children in the tree,
   recursively, a deck counting as the sum of its zones. Picking is placing:
   the friend's binder sits outside it. Design in
   [`docs/inventory.md`](docs/inventory.md) → *Unions*.
4. ⬜ Put a checklist on my collection: all of MH3, foils included. I see progress
   as a number, and the missing cards as a shopping list.
5. ⬜ Moving a card from a binder into a deck box changes nothing about my
   progress — it is still in my collection. Trading it away does.

**Gap:** all of it, as with D. Step 5 is the point of mirroring the shelves:
moving cards around is free, and only cards coming in or going out change
what I have.

Design for both: [`docs/inventory.md`](docs/inventory.md).

---

## F. Where is it? — finding every place a card lives

> I want my Sol Ring for a new deck. I know I have a few, somewhere. Which
> binder, which deck box, and is one of them the foil?

1. ✅ Find the card from anywhere — a grid, a decklist, a search — and the card
   panel opens on it.
2. ✅ The panel gives counts, but only against one scope: the target collection
   and the active deck, this printing and across all printings. It answers "how
   many here", not "where".
3. ⬜ The panel lists **every place that holds it**, with counts: *Binder 2: 1
   (C21 foil)*, *Bulk box: 2*, *Atraxa deck box: 1*. Any printing by default,
   since the question is "where is a Sol Ring"; narrowing to *this* printing is
   one click, for when the foil is what I want.

   Counts are honest at the grain asked. Narrowed to the C21 foil, a bulk
   box of Sol Rings with no printing recorded counts 0, not "maybe 2". That
   count leads. Under it, a hint lists what else of the card is there, by
   bucket, only where there is some: *also here: printing not recorded ×
   2*. Sugar, and a nudge to sort them.
4. ⬜ Places I track but do not hold from are listed and labelled as what they
   are — the friend's binder, the wishlist, a card on loan — rather than summed
   into one number. That number would be a claim about ownership the app does
   not make.
5. ⬜ Decklists that name the card are a separate group: a list wanting a Sol
   Ring is not a place a Sol Ring is.
6. ⬜ Clicking a place opens it with the card selected, so I can take it out
   and record the move.
7. ⬜ It works with no collection active. Today that case falls back to summing
   the "ownable" kinds, and this list is what should replace it.

**Gap:** steps 3–7, which are *Where is this card?* under *Card intelligence*
in `TODO.md`. Local data only — no corpus, no Scryfall. Steps 4 and 7 also
close out *No global ownership*.

**Not just one card.** The same question works for any filter: "where are
my foil Islands", "which binders hold anything from `:ramp`". Journey D
step 2 is it with a decklist as the filter, grouped by place. One card is
the simplest case and a good first piece. The model is in
[`docs/inventory.md`](docs/inventory.md) → *Where is it: a population per
place*.

---

## G. Tidy the library — group, tag, retire

> I have forty decks and a dozen collections. I want them in an order that
> makes sense, the ones I am not playing out of the way, and to find "my
> brewing Commander decks" without scrolling.

1. ⬜ Put decks and collections in folders I choose, and drag to reorder them.
   A folder only organises: moving a binder into one changes nothing about
   what it holds.
2. ⬜ Tag assets: brewing / built / retired, favourite, competitive. Any asset
   takes tags, not just decks.
3. ⬜ Retire a deck without deleting it. It leaves the list but stays
   findable, history intact.
4. ⬜ Find assets by tag, format or folder.
5. ⬜ Folders fold, so fifty decks still fit on a screen.

**Gap:** all of it — *The asset tree's UI* in `TODO.md`. Tags as well as
folders, or instead of them, is open in
[`docs/inventory.md`](docs/inventory.md) → *Open*; this journey is where
to settle it.

**Not card tags.** A tag is on an *asset*. Grouping *cards* — "my ramp
package" — is an ω set, searched as `:ramp`.

