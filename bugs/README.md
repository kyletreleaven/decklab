# Bugs

One file per bug. A report is a **claim someone else can check**: here is the
symptom, here is how to make it happen. Everything else — cause, fix — hangs off
that, and is worth only as much as the repro under it.

Start here when something looks wrong: scan the index for the symptom before
digging, then read *Traps* for the patterns that have produced bugs before.

## Index

| # | Status | Symptom |
|---|---|---|
| [001](001-local-grid-ignores-writes.md) | fix applied, awaiting in-app repro | Adding a card to a collection, or removing its last copy, does not add/remove it in the grid |
| [002](002-stepper-counts-printing-grain.md) | open · known | Pool tile shows `0` and a disabled `−` for a card held in another printing |

## Writing a report

Copy the template, take the next number, add a row above. Keep the file after
the fix — flip the status and fill in *Fix*; a closed report is how a regression
gets recognised.

```markdown
# NNN — <symptom, in the words a user would use>

**Status:** open | open · cause found | fixed in <commit>
**Reproduced:** yes, <date> | not yet — derived from reading code

## Symptom
What you see, and what you expected instead.

## Repro
1. Numbered steps from a fresh launch. Name the view, the panel, the toggle state.
2. ...
**Observed:** ... **Expected:** ...

## Proof
A failing test, if one can be written: `path/to/file.test.ts` — `test name`.
Otherwise say why not, and what would make it testable.

## Cause
`file.ts:line` and why. Mark anything not yet confirmed as a hypothesis.

## Fix
Blank until fixed. Then: the commit, and the test that now guards it.
```

**Separate what is proven from what is inferred.** "Reproduced: not yet" is a
fine thing to write; an inferred cause stated as fact is how a wrong fix ships.

## Traps

Patterns that have produced more than one bug. Check these first.

- **Subscribing to writes.** Mutations call `bump()` in `App.tsx`, which
  increments `refreshKey`; every effect that shows stored data must list
  `refreshKey` in its deps. Signalling and subscribing are separate, and both
  have been forgotten (see `TODO.md` → *Known debt* → `bump()`). → 001
- **Rows frozen at fetch time.** A `Row` in `PoolPanel` is a snapshot. Anything
  read off `row.item` after a write — quantity, presence — is stale unless the
  rows were refetched. Read live counts from `destination.quantities`. → 001
- **Grain.** Oracle-grain rows (Scryfall) and printing-grain data (collections,
  decks) keyed by different ids; a lookup by `card.id` against printing-keyed
  counts misses other printings. See `CLAUDE.md` → *Grain*. → 002
- **Comments that outlive their model.** Rationale written for the fg/bg pool
  (removed in `cae2f53`) survived into code where it no longer holds. When a
  comment says something is "deliberately absent", check the premise still
  holds. → 001
