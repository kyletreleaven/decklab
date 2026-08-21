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
