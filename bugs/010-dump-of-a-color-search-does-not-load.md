# 010 — A dump with a saved color search does not load

**Status:** fixed, not yet committed
**Reproduced:** yes, 2026-10-31

## Symptom

`decklab dump` of the lab writes a file that `loadV5` refuses as not valid
TOML, so the lab cannot be reseeded from it. Expected: every dump loads.

## Repro

1. In the lab, save a search as a query pool with *More filters* → color
   identity set (any colors).
2. `npm run cli -- dump --db …/lab.db out.toml`.
3. Load `out.toml` (a seed, or `loadV5`).

**Observed:** `Not valid TOML: Invalid TOML document: invalid value`, at
`filters = { colors = ["B", "G"], colorField = identity, colorOp = containedBy }`.
**Expected:** `colorField = "identity", colorOp = "containedBy"`.

Seen in `data/lab-2026-10-31.toml`, lines 3508 and 3544: two searches
saved at 01:36 that day, the first with a `colorField`.

## Proof

`src/lib/library/labdb.test.ts` — `round-trips: dump(read(write(file))) is
the file` now also loads the dump it wrote. Before the fix it failed with
the error above; the fixture's `/pools/cheap` has `colorField` and
`colorOp`.

## Cause

`filtersInline` in `src/lib/library/v5.ts` wrote a non-list value with
`String(v)`: right for numbers and booleans (`mvMax = 3`, `paperOnly =
true`), wrong for the two string keys, `colorField` and `colorOp`.

The round-trip test missed it because it compared one dump with another,
`dumpV5(readLab(…))` against `dumpV5(loadV5(FILE))`, and never parsed
either, so both carried the same bad text.

## Fix

Strings are quoted (`str`). The round-trip test parses its own dump.
