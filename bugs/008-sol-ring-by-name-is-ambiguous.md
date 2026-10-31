# 008 — "Sol Ring" by name is refused as naming more than one card

**Status:** fixed, not yet committed
**Reproduced:** yes, 2026-10-30, through the agent API against the real card store

## Symptom
A line naming a card only by name is refused when another card's front face
has that name. Expected: the card whose whole name it is.

## Repro
1. `npm run lab`, Tools → Agent API → Enable, Copy Token.
2. `curl -X PUT -H "Authorization: Bearer …" -H "Content-Type: text/plain"
   --data-binary $'1 Sol Ring' localhost:47474/lab/assets/API%20test/ramp`

**Observed:** `400 {"error":"Some lines do not say which card consistently:\nSol
Ring: more than one card has that name"}`. **Expected:** a pool holding Sol
Ring.

The same holds for a library file's line `card = "Sol Ring"` with no `oracle`
or printing: a load refuses it. A dump always writes the oracle id, so a
reseed from a dump never met it.

## Proof
`src/lib/library/labdb.test.ts` — `takes a whole name over
a front face`: a store holding Sol Ring and the reversible *Sol Ring // Sol
Ring*, and a line `card = "Sol Ring"`.

## Cause
`src/lib/library/labdb.ts`, `oraclesByName`: a name fits a card when it is the
card's whole name **or its front face**, so double-faced cards can be named
the way people say them. The card store holds Secret Lair's reversible *Sol
Ring // Sol Ring* (`layout: reversible_card`, an oracle id of its own) beside
Sol Ring, and "Sol Ring" is the front face of the one and the whole name of
the other. Two cards, so refused as ambiguous. Confirmed by querying the
store.

## Fix
A whole-name match wins: the front face counts only when no card has the
name whole. Guarded by the test above, and confirmed with the repro's `PUT`
the same day: `201`, Sol Ring a member. Not yet committed.
