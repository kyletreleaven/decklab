# 009 — A card named on several lines is asked of Scryfall once a line

**Status:** fixed, not yet committed
**Reproduced:** yes, 2026-10-30, in a unit test, with a stand-in for the channel; not against Scryfall

## Symptom
A library load, or an agent API `PUT`, that names a card the store has never
had on several lines — "Mana Crypt" in two zones, or spelt two ways — sends
that name to `/cards/collection` once for each line. Expected: once.

No more requests than necessary at most chunk sizes, since 75 identifiers go
in one request, but a list with many repeats sends more chunks than it needs,
and every repeat counts towards the API's 150-card cap.

## Repro
`PUT /lab/assets/P` as text, `1 Sol Ring\n1 Mana Crypt\n1 mana crypt`, with
Mana Crypt not in the store.

**Observed:** the fetch is asked for `["Mana Crypt", "mana crypt"]`.
**Expected:** `["Mana Crypt"]`.

Found while writing the cap's test: 151 copies of one unknown name were
refused as 151 cards.

## Proof
`src/api/lab.test.ts` → *fetching what the store has never had* → `fetches
only the unknown cards, once, then writes`.

## Cause
`src/lib/library/labdb.ts`, `resolveBuckets`: the names to fetch were
mapped from the lines naming them, not from the names. Printings were
already deduplicated (`new Set(printed.map(keyOf))`).

## Fix
One identifier a name (folded, as `oraclesByName` compares them), spelt as
its first line spells it. Fixed before this report was written, against the
process in `README.md`; the order is noted here rather than hidden.
