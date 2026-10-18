# What cmdr teaches

`cmdr` is a Commander deckbuilding CLI in the sibling `commander` repo
(`../commander`, see its `AGENTS.md` and `docs/design/lang.md`). It is text- and
file-first where DeckLab is visual, and it has been used in earnest on half a
dozen decks. Two things follow for DeckLab:

1. **DeckLab can serve it** — card data, decks, collections — through the
   agent API, and the two can share logic instead of copying it.
2. **Its design is evidence for ours.** Its `.decklab` language arrived at most
   of the card-set algebra in `TODO.md` independently, settled some of the
   questions the algebra leaves open, and was corrected by use in ways worth
   inheriting.

Open work is in [`TODO.md`](../TODO.md); this file is the reasoning.

---

## Serving cmdr

### One Scryfall client, one cache

`cmdr` has its own copy of `scheduler.ts` and its own cache
(`data/cards.json`, ~2,000 printings). Run alongside DeckLab, that is two
clients to Scryfall, each believing it has the pipe — the problem the agent
API's *one owner* design exists to prevent. With the API enabled, `cmdr search`
and `cmdr cards` can go through DeckLab instead: cache-first, misses batched
through DeckLab's queue in the CLI lane, results landing in DeckLab's SQLite. One
client and one cache across both tools; `cmdr` falls back to its own path when
the API is off.

### Decks and collections as inputs

- `analyze`, `curve`, `mana`, `hands` and `grep` already take a decklist file,
  so a deck export route lets them run on a DeckLab deck as-is.
- `docs/owned.md` and `roles/owned.decklab` are a hand-kept list of cards in
  hand, maintained because it changes evaluation (Contagion Engine was cut on
  price and became a keystone once it turned out to be free). A
  collection-membership route sources that from the actual Paper collection.
  In DeckLab's vocabulary it is `inCollection` — which is also more honest than
  `[owned?]`.

### Shared logic, not copies

`types.ts`, `deckstats.ts`, `decklist.ts` and `scheduler.ts` are copied into
`cmdr` "verbatim, so fixes move in either direction". On 2026-10-18 two of the
four had drifted:

| File | State |
|---|---|
| `types.ts`, `scheduler.ts` | identical |
| `deckstats.ts` | `cmdr` has a commander-legality fix DeckLab lacks — see [`bugs/004`](../bugs/004-spacecraft-commander-flagged-illegal.md) |
| `decklist.ts` | `cmdr` adds `deckQuantities()` |

Part of the drift is import extensions alone (`./types.ts` against `./types`),
which is why "verbatim" cannot hold: the two toolchains resolve modules
differently. Copying is the mechanism that fails; a shared module both import is
the fix.

There is a second, uncounted duplicate: **two local Scryfall evaluators.**
DeckLab's `src/lib/query/` compiles Scryfall syntax to SQL over the cache;
`cmdr`'s `lang/scryfall-local.ts` compiles it to a predicate over cached JSON.
Same grammar, same job, written twice.

---

## The language, read against the algebra

### Where they agree, independently

| `cmdr` (`lang.md`) | DeckLab (`TODO.md` → card-set algebra, `card-set-types.md`) |
|---|---|
| **ω set** — a Scryfall term denotes ω copies of every match | **binary** quantity, stored as ∞ |
| ω, not 1, is what makes `min` a *filter* rather than a cap | "`Universe` must be ∞, not 1", and quantity-1 is the wrong encoding for a saved search |
| **multiset** — real counts | **natural** quantity |
| juxtaposition = `min`, `-` = complement preserving multiplicity | `Min`, `Diff` |
| **determinacy** — `t:land` can be counted against a deck, never listed | **laziness** — `Universe` is never materialised |
| evaluation plan per branch: push Scryfall terms, post-filter locally | the compiler decides per expression: SQLite or Scryfall |
| tag cycles must be detected | cycles forbidden in the spec graph |
| zones: `.library` is what is drawn and counted, `.commanders` always in hand | zones as `spec → spec` edges: `commander(deck)`, `zone(deck, main)` |

Two designs arriving at ω/∞ from opposite directions — one from a text
language, one from a UI — is good evidence it is the right encoding.

### What cmdr settled that DeckLab has open

- **Multiset or set** (algebra decision 1). `cmdr` runs on multisets plus
  ω sets and nothing else, and has not needed a third kind. Supports the
  proposal as written.
- **Union** (`card-set-types.md` → *Union is not settled*). `cmdr`'s `|` is
  `max`, chosen because "sum would double-count a card matching both sides".
  That is evidence for `max` as *the* union, with `sum` a separately named
  operation for when physical copies add up — not for dropping `sum`: `cmdr`
  never models chop-shop inventory, which is where `sum` is wanted.
- **Card sets and collections are different kinds** (`TODO.md` → *Data model →
  The asset tree's UI* makes them separate types in the tree). `cmdr` keeps
  exactly two — multisets and ω sets — and makes them impossible to confuse:
  the delimiter carries the kind (`#{ }` against `{ }`), nothing is inferred,
  and its one open item is making `:name` *refuse* a multiset where a set is
  asserted. They support different operations: a multiset has counts that can
  be summed; an ω set says which cards qualify, so it filters and cannot be
  counted as copies. A *tag* is not a third kind, only a name bound to one of
  the two. So the distinction is real at the type level, whatever the storage
  — which is where `card-set-types.md` already leans (unique counts only,
  add/remove rather than a stepper, conversion as a destructive edit).

### Not carried over: open definitions

`cmdr` distinguishes `=` (closed) from `<<` (open, repeatable), so
`proliferate << o:proliferate` plus `Deepglow Skate [proliferate]` is a query
topped up by hand. That exists because `cmdr` loads its concepts from files:
several files assert into one tag, and openness is how their contributions
merge.

DeckLab does not load concepts from files, so it does not need the mechanism.
Its model instead:

- **Collections are mutable, and lockable**, so one can be frozen against
  edits.
- **Each has a basic type** saying how its contents arise — **explicit** (an
  enumerated list, edited directly), **filter application** (a filter applied
  to a source), and so on.
- **Combinators** build collections from collections.

The query-topped-up-by-hand case is then a combinator: the union of a
filter-application collection and an explicit one. Nothing new is needed for
it.

### What cmdr has that DeckLab has not designed

- **Tags as card-first assertions.** 59% of cards in one deck carry two or
  more tags, so `Card [a, b]` beats one list per tag for writing, while
  `role: [cards]` reads better — store one, display either.
- **Two scopes for tags.** General roles (`ramp`, `draw`, `removal`) compound
  across decks — tag Mind Stone once and every deck inherits it. Deck roles
  live and die with the deck. This is a concrete answer to how *Card
  annotations* (in `TODO.md`) should be scoped.
- **Candidate and decision.** A deck's pool is its candidates; the decklist is
  the decision. Cut cards keep their tags, because tags are facts about cards,
  not about the deck. And membership comes from the deck's own pool only — the
  general tag library and the owned list *decorate* cards, they never make one
  a candidate, or every card tagged for any deck leaks into every other.
  DeckLab's deck-attached pool and `maybe` zone are halfway to this.

### Where DeckLab must go further

**Grain.** `cmdr` is entirely oracle grain: a card is a name, and even its
multisets — a decklist's `7 Island` — count abstract cards, not copies held.
DeckLab is richer: collections hold printings and finishes, and some are mixed
(`known` at printing grain, `unsorted` at oracle). So `Project` / `ToOracle`
with its `any`/`all` quantifier has no counterpart in `cmdr`, and anything
borrowed from it is the oracle-grain case of something DeckLab must
generalise.

**Every DeckLab collection is coercible to oracle grain.** The coercion is
total in that direction — `ToOracle` with `sum` for multisets, `any` for sets —
which is exactly what makes `cmdr`'s whole vocabulary applicable to DeckLab
data: coerce, then evaluate. It is also what the agent API should hand `cmdr`
— an oracle-grain view of any deck or collection. The reverse, `ToPrintings`,
stays partial: there is no principled way to spread *n* copies across
printings.

---

## Statistics, eventually

`cmdr`'s language extends the algebra with randomness: `Dk` (the cards seen
after the opening hand plus k draws) makes a collection random, and `P`, `E`
turn it back into a number. A target like `:land >= 37` is the case with no
`Dk`. That is DeckLab's *Statistics* section — opening-hand odds, P(A and B by
turn N), mana diagnostics as IDE-style warnings — already specified, built and
tested (`hyper.ts`, joint constraints by inclusion–exclusion, solved gaps).

Worth carrying over when Statistics comes up, beyond the maths:

- **Results are trees, not Bools**: `have`, `need`, `gap`, and which of several
  constraints *binds*. That is what lets a report say "+2 in `land-early`" —
  which is exactly DeckLab's "⚠ only 73% to cast UU on turn two — suggest
  +2 Islands".
- **Same-shuffle sampling.** Every `Dk` with the same `k` is one shuffle, so
  joint availability is negatively correlated; treating draws as independent
  overestimates it.
- **`kind` did not survive** — labels like *stacking* were measurably wrong and
  were protecting cards from cuts. Constraints say what they mean instead.

---

## Lessons from how cmdr went wrong

`cmdr`'s docs record each tool with the mistake that justified it. The pattern
across them is **plausible wrong numbers rather than errors**: a collapsed regex
read as a deep card pool, entries written outside a code fence, unique names
counted as copies. Its responses carry over directly:

- An unrecognised query term **throws** rather than matching nothing — an empty
  tag is a plausible zero.
- `P` requires a draw and `%` forbids one, so neither can absorb the other's
  typo.
- One phrasing of a search is not a count: unions of several phrasings found
  2–6× more, and reading the cards then cut ~80%.
