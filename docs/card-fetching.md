# Card fetching and caching

How card data gets from Scryfall into the local cache, and when it is fetched
again. For the request budget of large walks, see
[`fetching-many-cards.md`](fetching-many-cards.md).

## Printings TTL (migration 003)

Card rows always persisted: `fetchPrintings` writes every printing through
`cacheCards`. What did not persist was the knowledge that a print run is
**complete**. After a restart we could not tell "3 printings cached because that
is all there are" from "3 because that is all we happened to meet", so we
refetched to be safe.

```sql
CREATE TABLE oracle_fetches (
  oracle_id            TEXT PRIMARY KEY,
  printings_fetched_at TEXT NOT NULL
);
```

- Lookup order is memo → disk → network. The in-memory memo stays in front,
  saving even the SQLite round trip within a session; the table is what
  survives restarts.
- The stamp is written *after* `cacheCards` succeeds, so a part-way failure
  leaves the run marked incomplete, and it is refetched rather than trusted.
- The TTL is a week. New sets arrive every few weeks and nothing else about an
  existing print run moves, so this is generous rather than aggressive.
- Numbered 003, not 004: sqlx applies migrations in version order, so adding a
  lower-numbered one afterwards invites trouble. Mixed-grain storage moved to
  004 since it ships second.

**Not verified:** the actual absence of network calls, which needs the devtools
Network tab. What is verified is that the migration applied, stamps are being
written, and the disk-first branch exists.

**`/sets` is never fetched.** `set_name` comes free on every card object. It only
becomes necessary alongside the CSV path, which is deferred; see `TODO.md` →
*Compact printing rows and the CSV path*.

## Two tiers, one queue

The goal is **responsiveness**: minimising *round trips* on the path the user is
waiting on, not minimising bytes, and not pre-downloading everything.

**Tier 1, fast and on demand.** One request populates a card's whole carousel:

```
/cards/search?q=oracleid:X&unique=prints
```

cached per oracle id for a week (above).

**Tier 2, background.** Everything heavier, none of it blocking. Images are
downloaded by the Rust side only when a tile or the card panel renders them
(`CardImage` → `ensureCached`), and `imageUrl` returns the remote URL until the
local copy exists, so the grid never waits on a download. Fetching eagerly would
be expensive: Sol Ring's full print run is **11 MB of art**.

## The scheduler

`src/lib/scheduler.ts`, and the only sanctioned way to make a request.
Scryfall's rate limit is per *client*, not per connection, so extra connections
buy nothing and risk a 429. What is needed is preemption, not parallelism.

- One queue holds the ~100 ms spacing, measured from the last request's *start*,
  so a slow response does not add its own latency to the gap.
- The **interactive lane** (hover, click, search) preempts background work.
- **Interactive is LIFO and evicting**, depth 1, so a stream of hovers collapses
  to the newest and the abandoned ones never run. That also makes a debounce
  unnecessary, and eviction is better: it adds no latency, where a debounce
  would delay even an already-cached card.
- **Eviction is keyed by kind of request.** This was the one real correction to
  the original spec: depth 1 across *all* interactive work would have a search
  and a printings lookup silently kill each other. Each kind gets its own slot.
- The **background lane is FIFO and never evicted.** Import batches live here,
  and each 75-card chunk carries distinct cards, so dropping one loses data.
  Fairness beats recency there: a backfill should finish, not restart at the
  newest item forever.
- Superseded requests reject with a distinct error that every call site
  ignores, rather than surfacing as a failure.

**A bug worth remembering: eviction was not actually LIFO.** `Map.set` on an
existing key keeps that key's *original* insertion position, so a replacement
job was ordered by when its kind first appeared rather than when it was queued.
A fresh search would wait behind a stale hover, inverting the point of the lane.
The fix is `delete` before `set`, pinned by a test that fails without it. It was
found while tracing why the pool looked unresponsive.

The tests cover the parts that fail silently: that an evicted job really does
not run, that different keys coexist, that a replacement is ordered by when it
was *queued*, that interactive preempts background, that background work is
never dropped, and that spacing holds.

## Batching

Batching is an optimisation, not the main path. `(oracleid:A or oracleid:B …)`
works and is useful for prefetching a page of results, but a page caps at **175
rows**, and popular cards average ~19 printings each, so a batch of 12 silently
returned only 9 of them in testing. Size batches against expected printings
(~6–8 cards) or follow `has_more`.

## Bulk data, deliberately not the default

`default_cards` is 74 MB compressed and would make everything offline and
instant, but waiting on a 74 MB download before the first card renders is the
opposite of responsive. If it is ever adopted, the bulk-ingest argument for
DuckDB comes back.
