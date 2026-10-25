# Rate channels — proposal

**Status: proposal, not built.** Today there is one channel to Scryfall
([`card-fetching.md`](card-fetching.md) → *One channel across processes*).
This generalises it to **many channels, each governing a group of endpoints,
with groups that may overlap**.

## Why

One channel fits one limit. The limits we actually face are more varied:

- **Scryfall's image servers** (`*.scryfall.io`) may not be under the API's
  limit; I believe the API docs say so, but it has not been checked. Either
  way they are a different group from `api.scryfall.com`, and should be able
  to have a different pace without leaving the channel discipline.
- **Expensive endpoints inside a host.** `/cards/collection` resolves 75
  cards per request; Scryfall could reasonably limit it more tightly than
  `/cards/named`. A host-wide pace cannot express "and this path, slower
  still".
- **Other services.** Archidekt deck import fetches today with no pacing at
  all. It deserves the same politeness without sharing Scryfall's pace.

## The model

**A channel** is what the current one already is: a pace, a pause, the
record of 429s, and the rule for learning from them. Nothing about it is
Scryfall-specific.

**A group** is a set of endpoints, matched on host and path:

```
scryfall-api      api.scryfall.com/*
scryfall-collect  api.scryfall.com/cards/collection
scryfall-images   cards.scryfall.io/*  svgs.scryfall.io/*
archidekt         archidekt.com/api/*
```

Each group has one channel. **Groups overlap**: a request to
`/cards/collection` is in both `scryfall-api` and `scryfall-collect`.

**A request needs a slot on every channel it falls in.** Its start time is
the latest of their next slots, and it uses that slot on all of them at once.
That is how overlapping limits compose: the collection request respects
the host's pace *and* its own; a `/cards/named` request respects only the
host's.

**An endpoint in no group is refused.** Not "unpaced": refused. This is the
current rule (`channel-only.test.ts`) made general: there is no way out that
is not a channel.

**Lanes stay as they are**: priority within one process's queue, and nothing
to do with pace.

## Shared state

The `channel` table becomes one row per group (`name` as the key, the
columns unchanged), still in `card-cache.db`, so every DeckLab process shares
every channel. The claim stays a single atomic step: one transaction that
reads the groups' rows, takes the latest next slot, and writes it to all of
them.

Group definitions are code, not data: a channel's limits are a fact about
the service, not a user setting. The pace each channel has *learned* is data,
kept in its row as now.

## Learning from a 429

A 429 says the request was too much for *some* channel it was in, not which
one. The proposal:

- **Pause**: every channel the request was in. Over-cautious by design; a
  pause is cheap and a block is not.
- **Slow**: the narrowest group the request was in, as now: half the slower
  of its pace and the actual gap. If the narrowest group is already at its
  ceiling, slow the next one out.
- **Record**: as now, plus the groups the request was in. The record is what
  later tells us whether a limit really is per-path: if `/cards/collection`
  draws 429s at rates `/cards/named` never does, that is the evidence.

## How this relates to option B

Option B (a configurable upstream: a thin facade over Scryfall, a local
daemon, a shared server) is about *who* holds the channels. This is about
*what* a channel is. They compose: a daemon or a shared server would hold
exactly these channels, for every client behind it.

## Open questions

- Should the images group be faster, once the docs have been checked? Or
  stay on the API's pace and simply be its own group, for the record?
- Does a pause on a *broad* group (a 429 on `/cards/collection` pausing all of
  `api.scryfall.com`) cost too much? It is the safe default; per-path pauses
  would want evidence from the record first.
- Is a group without a 429 history allowed to speed up beyond its starting
  pace? Proposed: no. Starting paces come from the service's own documentation,
  and the pace only ever learns downward, then eases back to that start.

## Appendix: related work

Written from memory, not from a search: versions and maintenance status
are worth checking before anything is adopted.

**Bottleneck** (npm) is the closest match. One limiter per group, with
spacing (`minTime`), concurrency and reservoirs. `limiter.chain(other)`
makes a job pass through every limiter in the chain, which is this
proposal's composition rule for overlapping groups. It has groups of
limiters keyed by name, and job priorities, roughly our lanes. Clustering
across processes is through Redis only. It does not learn from 429s; its
retry-on-failure is the opposite of what we want. As far as I know it has
had no release in years.

**p-queue / p-throttle** (npm): simple in-process queues and throttles. No
sharing across processes, no overlap.

**rate-limiter-flexible** (npm): many storage backends (memory, Redis,
several databases), and several limiters can be combined on one key. Built
mostly for servers limiting their clients, not for being a polite client.

**governor** (Rust) and **tower**'s rate-limit layers: in-process only.
tower's layers stack, which composes overlapping limits.

**nginx `limit_req`**: the classic example of overlapping zones. Several
limits apply to the same request at once, keyed by host, path or anything
else. The same composition rule, on the server side.

### The ideas, by name

- **GCRA** (generic cell rate algorithm), used by governor, redis-cell and
  others. The channel's claim,
  `last_slot_at = max(last_slot_at + interval_ms, now, paused_until)`, is
  GCRA with no burst allowance: its "theoretical arrival time" is our
  `last_slot_at`.
- **AIMD** (additive increase, multiplicative decrease), from TCP congestion
  control: cut sharply on a signal, recover gradually. Halving on a 429 is
  the multiplicative decrease. Our recovery, a tenth per quiet hour, is
  multiplicative rather than additive, but the same family.
- **Client-side adaptive throttling** (Google's *Site Reliability
  Engineering*, the chapter on handling overload): a client that learns
  from rejections and holds itself back before the server has to.

### What none of them gives us

1. **Sharing through SQLite.** Every cross-process option assumes Redis or
   a server; we already have a shared file in `card-cache.db`.
2. **Learning the pace from 429s.** Libraries take their limits as fixed
   configuration.
3. **Refusing unknown endpoints.** A library limits what is passed through
   it; it cannot stop a caller going around it. `channel-only.test.ts` does.

So the proposal is to keep our own implementation, which is small, and take
from these the names and the precedent: GCRA and AIMD for the mechanics,
Bottleneck's `chain` and nginx's overlapping zones for the composition rule.
