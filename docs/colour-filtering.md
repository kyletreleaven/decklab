# Colour filtering

Colour looks like one filter. It is two fields, two operators, a count, and one
asymmetry that is easy to get backwards — and getting it backwards is silent,
because a wrong colour filter still returns cards.

Everything below was verified against the live API. Counts are from 2026-09-07
and drift as sets are printed; the *relationships* between them are the point,
not the absolute numbers.

---

## Colour is not mana cost

The two are close enough to be conflated and different often enough to matter.
Scryfall's `c:` reads the card's **colour**, which is not derived from what you
pay:

| Card | Mana cost | Colour |
| --- | --- | --- |
| Ancestral Vision | *(none)* | blue |
| a `{W/U}` hybrid card | `{W/U}` | white **and** blue |
| a colour-indicator DFC face | *(none)* | whatever the indicator says |
| Sol Ring | `{1}` | colourless |

So the control is named **Colour**, never "casting cost". A filter built from
the mana cost string would disagree with Scryfall on every row above.

What the colour fields genuinely *cannot* express is anything about pip
multiplicity — `colors` is a set, so "two or more red pips" is invisible to it.
That question is `devotion:{r}{r}` (1,055 cards), which needs `mana_cost`
parsing and is not implemented locally.

---

## Two fields

| Field | Column | Question |
| --- | --- | --- |
| `c:` `color:` `colour:` | `colors` | what colour *is* this card |
| `id:` `identity:` | `color_identity` | what colours does it *commit you to* |

Both are stored WUBRG-canonical, one letter per colour (`001_init.sql:25-28`),
so `LENGTH()` is the colour count and nothing depends on letter order.

The facet bar picks between them explicitly. It used to pick neither: the
Scryfall path emitted `c:` while `collectionItems()` filtered `color_identity`,
so the same pips asked two different questions depending on which pane you were
looking at.

---

## Two operators, not three

| UI | Scryfall | Local SQL |
| --- | --- | --- |
| contains | `c>=wu` (`c:wu` is a synonym) | `colors LIKE '%W%' AND colors LIKE '%U%'` |
| contained by | `c<=wu` | `colors NOT LIKE '%B%' AND …` (one per unchosen colour) |

**"Exactly" is deliberately not an operator.** It is *contains* with both count
bounds pinned to the size of the selection, so promoting it would give two
spellings of one filter and let them disagree. Scryfall's `c=wu` (408 cards)
still parses in free text; the facet bar just does not need it.

Strict subset and superset (`c<`, `c>`) are likewise omitted: *contains WU* with
a minimum of 3 is `c>wu` (310 cards), reached through the count.

---

## Counting colours

Scryfall accepts a bare number where a colour goes, and it is a distinct axis
from *which* colours:

| Query | Count | Means |
| --- | --- | --- |
| `c=1` | 24,833 | mono-coloured, any colour |
| `c>=2` | 4,609 | multicoloured |
| `c:m` | 4,609 | identical to `c>=2` |
| `c>=3` | 796 | three or more |

Neither "any gold card" nor "mono-coloured, any colour" is expressible as
field × operator × colours, which is why the count earns its own control. It
also subsumes several filters that would otherwise each need one: **0** is
colourless, **1/1** mono, **min 2** multicoloured, and both bounds pinned to the
selection size is *exactly*.

`c>=2` used to error locally (`'2' is not a colour`) while working against All
Magic — the exact divergence class `query-language.md` exists to prevent. The
digits are now checked before the letter loop.

---

## The empty selection is asymmetric

This is the part that is easy to get wrong, and it was wrong here:

- **contains ∅** is vacuously true — every card contains no colours — so an
  empty selection means *no filter*.
- **contained by ∅** is a real restriction: the only cards whose colours are a
  subset of nothing are the colourless ones.

Treating both as "no filter" silently widens a contained-by search to the entire
universe. Verified equivalence, with the local compiler agreeing:

```
c<=c   4,300      c:c   4,300      LENGTH(colors) = 0
```

Scryfall has no empty colour literal, so the empty set is spelled `c` — the same
move `withinIdentity` already makes for a colourless commander (`id<=c`).

Because contained-by-nothing filters while no pips are lit, it has to count
toward the active-filter badge, or it narrows the pool with no visible cause and
no `Clear all` to undo it.

---

## Colourless is not a colour

It is not a sixth pip. "Contains colourless" is not a question, and under
*contained by* a `C` pip would be indistinguishable from selecting nothing.
Colourless is `max 0` on the count, or contained-by with an empty selection.

Subset searches include colourless, because ∅ is a subset of everything:

```
c<=w        9,357
c<=w -c:c   5,057
c:c         4,300      5,057 + 4,300 = 9,357
```

That is usually what you want — "what can I play in my mono-white deck" should
offer you Sol Ring, and `c<=w` does return it. When it is not what you want,
`min 1` excludes the colourless cards.

Colour identity behaves the same way: `id<=w` is 7,994, of which 2,959 are
colourless (`id<=c`).

---

## Unresolved

`c=w` returns **5,072** but `c<=w -c:c` returns **5,057** — a 15-card gap where
set logic says the two are the same query. Not chased down. Anything built on
`c=` should pin the behaviour with a contract test rather than assume the
identity holds.

---

## Supported by Scryfall, not yet locally

| Query | Count | Blocker |
| --- | --- | --- |
| `produces:g` | 1,274 | no `produced_mana` column; it is in the `data` JSON, so a migration |
| `devotion:{r}{r}` | 1,055 | needs `mana_cost` parsing |
| `is:hybrid` | 604 | `is:` is rejected wholesale by the compiler |
| `is:phyrexian` | 73 | as above |
| `c:azorius` `id:bant` `c:jeskai` | 718 / 19,334 / 144 | `COLOUR_NAMES` holds single colours only; the guild, shard, wedge and quad nicknames are a data change, not a code change |

`produces:` is worth distinguishing from identity rather than assuming it is
covered: mana abilities feed colour identity, so a Forest is already `id:g`, but
Command Tower produces every colour while its identity is colourless.

**Not supported by Scryfall at all:** `is:colorless` and `is:multicolored` are
rejected with *"All of your terms were ignored"*. The spellings are `c:c` and
`c:m`.
