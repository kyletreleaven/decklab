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

## The card store

Scryfall's data and the user's data live in **separate files**. Card data is
not the user's, its schema is stable, and it can always be fetched again; the
user's data is none of those. Split, every mode shares one cache, and a lab
session can start from an empty database without fetching anything twice
([`lab.md`](lab.md) → *Lab mode*).

```
app ──> scryfall.ts ──> stand-in ──hit──> card-cache.db   one, shared by every mode
                           └──miss──> scheduledFetch ──> api.scryfall.com

decklab.db / lab.db: the user's data, plus `cards` as a working copy
```

**Two databases, two handles, no `ATTACH`.** `db()` opens the user database as
now; a second handle, `store()`, opens `card-cache.db`, and only the stand-in
uses it. SQL never joins across the two, so nothing needs attaching. That
matters because `tauri-plugin-sql` keeps a pool of up to ten connections with
no per-connection setup hook, and `ATTACH` holds for one connection only.
Cards move between the files through JavaScript.

**The working copy has the same schema.** `cards` in the user database stays
exactly as it is, so the foreign keys from `collection_items` and
`deck_cards`, and every query that joins `cards`, are untouched. Every
`scryfall.ts` function still passes what it returns through `cacheCards`,
whether the answer came from the store or from Scryfall, so *anything the
app has shown is in `cards`* still holds. Lab starts with that table empty.

**The stand-in sits inside `scryfall.ts`**, between the exported functions and
the private `request()`. A hit is answered at once; only misses join the
queue, so the rule that every request to Scryfall goes through
`scheduledFetch` is kept, and hits do not wait on its spacing.

| Function | From the store when |
| --- | --- |
| `printings` | the oracle id's `oracle_fetches` stamp is fresh (as today, against the store) |
| `resolveIdentifiers` by id, or set + number | the printing is stored and fresh; a batch splits into hits and misses |
| `named` exact, `resolveNames` | the name's card has a fresh default printing (below) |
| `named` fuzzy, `search`, `autocomplete` | never: results move, and paging is Scryfall's. The cards returned are stored |

**One freshness rule, in the store.** A stored row older than the TTL — a
week, as for print runs — is a miss and is fetched again. The working copy
takes the store's row verbatim, `cached_at` included, and has no rule of its
own.

**The store's tables:**

- `cards`, the same definition as the working copy's.
- `oracle_fetches`, moved here: that a print run is complete is a fact about
  the store.
- **Default printings**: per oracle id, the printing Scryfall last gave *as
  the card* and when. Name lookups and `unique=cards` search results record
  it; print runs and lookups by id or set + number do not, since they asked
  for an exact printing. A later answer replaces an earlier one. A bare name
  never named a printing, so whichever one Scryfall last offered is a fair
  answer, and recording search results fills the table as you browse.

A name lookup goes: name → oracle id through the store's `cards` → a fresh
default printing is a hit; otherwise the batched name lookup (75 per
request) as today, recording each answer.

**Order of writes: the store first.** A card reaches the store before any user
row refers to it. A crash in between leaves an unused stored card, which is
harmless. No transaction ever writes both files, so their journals never
need to agree, whatever the journal mode. Foreign keys do not reach across
files, so a user row can point at a card the store has lost; the answer is
to fetch it again, not to fail.

**Starting the store** from an existing `decklab.db`, once, when there is no
`card-cache.db`: `VACUUM INTO` a staging file (reading `decklab.db` only),
drop the user's tables *and its migration records* from the copy, then move
it into place. Without the records gone, the store's own migration list
would meet `decklab.db`'s versions 1–4 and refuse to run. The staging file is
opened under a name with no migrations registered, so nothing runs on it
early. On the real database (37,691 printings, 290 MB) the copy takes about
half a second; the store migration then only adds `default_printings`.

**Built:** `src-tauri/src/card_store.rs` (the migration list, staging, the
move into place), `migrations/cache/001_store.sql`, `cardStore()` in `db.ts`,
the queries in `store.ts` (tested on SQLite in `store.test.ts`), and the
stand-in in `scryfall.ts`. Left as they were:

- `decklab.db` keeps its own `oracle_fetches`, now unread. Dropping it is a
  real migration, for when the schema next changes anyway.
- Loading a library still refuses a non-English printing missing from the
  working copy: `/cards/collection` cannot ask for a language. The store can
  answer by language; `v4db.ts` does not ask it yet.
- **Wrong, and the cause of a 429:** the TTL applies to identity lookups
  too, so a card the store has, but fetched over a week ago, is fetched again
  just to answer *which card is set C21, number 263*, which never changes.
  Loading the library into the lab sent ~25 back-to-back requests and drew a
  429 ([`bugs/005`](../bugs/005-lab-load-rate-limited.md)).

**Images are already split this way**: `cache_card_image` keeps them in an
`images/` folder beside the databases, named by printing id.

**Considered and rejected:** moving `cards` into an attached file and replacing
`tauri-plugin-sql` with our own commands, so that a pool hook could `ATTACH`
on every connection. It works, but costs a rewrite of the database layer for
joins the two-handle design never needs.

**Later:** a card-level table, one row per oracle id for text, stats and
legalities, instead of repeating them on every printing. A separate change,
in both files at once; see `TODO.md`.

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

## One channel across processes

**The gap.** The queue, its spacing and its 429 pause are module state: one
per app process. Run the app and the lab together and there are two queues,
each pacing itself, both sending; a 429 in one leaves the other sending, and
a relaunch forgets the pause. Scryfall sees one client either way. Lanes
are not the problem: within a process they share the one channel and differ
only in priority, which stays so.

**A — shared through the card store (built).** Each process
keeps its own stand-in and does its own HTTP; only the *permission to send*
is shared, as state in `card-cache.db`:

| | |
| --- | --- |
| `next_slot_at` | the earliest a request may start |
| `paused_until` | set from `Retry-After` by any 429, in any process |
| `interval_ms` | the pace: today's 100 ms to start with, lowered by a 429 and kept lowered |

Before each request a process claims a slot in one short write transaction:
read the state, wait out any pause, take `next_slot_at`, push it on by
`interval_ms`, commit, and sleep until the slot. SQLite's file lock makes the
claim atomic across processes. A 429 is never the plan, but when one comes it
is the best information there is, so the pace learns from it and stays
learned across restarts, recovering slowly and never past the starting pace.
The store moves to WAL mode so these writes do not hold up readers. What A
does not do: two processes asking for the same card at once both fetch it.

Built as: `migrations/cache/002_channel.sql` (the one row), `channel.ts`
(the claim is a single `UPDATE … RETURNING`, so it is atomic through the
plugin's pooled connections as well as across processes), and the
`Channel` interface in `scheduler.ts`, which waits for a slot, then
re-checks the pause another process may have set meanwhile. The app shares
it at startup (`main.tsx`); tests and the contract suite run on the
in-memory channel. If the store cannot be reached, nothing is sent.

**Every 429 is recorded** in `rate_limits` (`migrations/cache/003`): when,
which process and lane, the endpoint, `Retry-After` as sent, the pace, and
the actual gap before the request that drew it. With every process claiming
slots through the one row, the gap between the last two slots *is* the
present rate, so nothing else needs logging. The new pace is half the slower
of the pace and that gap — unless the gap is over a second, when the request
went out alone and its gap says nothing about the rate. `Retry-After` sets
the pause and nothing else: it says how long to stop, not what pace is
allowed. A bug report about a 429 quotes this table.

**B — a configurable upstream (an option; where this may lead).** The app
reads card data from an *upstream* that speaks the stand-in's protocol, and
the stand-in is a client of whichever is configured:

- **Scryfall itself**, with A's rules: today's behaviour. As an upstream it
  is a thin facade — requests passed through to `api.scryfall.com` under the
  channel's pace and pause, with no logic of its own.
- **A local daemon** that owns `card-cache.db` and the channel, shared by the
  app, the lab and a CLI. Truly one client: identical requests from different
  processes are merged, one writer, nothing to coordinate. The card-data
  counterpart of the agent API's *one owner* ([`agent-api.md`](agent-api.md)).
- **A shared server** — a machine on the network, a mirror — so several
  installs draw on one cache, and Scryfall sees one client for all of them.

The price is lifecycle: who starts the daemon, what happens when it crashes
or is older than the app, how the app finds it, and a round trip to another
process for every card read. A's state rows carry over into it unchanged, so
A is a step towards B, not a detour.

**A probe for the pace, later and carefully.** A CLI command could measure
what Scryfall allows — response headers, timings — at the normal pace. It
must never find the limit by tripping 429s.

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

## Compact printing rows and the CSV path

A storage-and-bandwidth optimisation, not a correctness fix, and deferred.
Recorded because the measurements were expensive to gather and the trade-offs
are not obvious.

**The measurements.** Scryfall serves the same query as CSV for a twentieth of
the bytes:

```
oracleid:X&unique=prints             664 KB   (Sol Ring, 137 printings)
oracleid:X&unique=prints&format=csv   34 KB
```

And a card object is mostly not card data — 24% image URLs, 20% affiliate and
purchase links, 12% API self-references, against **4.7%** actual text and stats.
We store the raw payload in `cards.data`, so ~5,800 printings is ~27 MB where
compact rows would be ~4 MB.

**And it cannot back a searchable collection.** CSV omits `oracle_text`,
`colors`, `color_identity`, `keywords`, `power`, `toughness` and `released_at` —
pinned by a contract test. `compileQuery` filters on most of those, so a
CSV-backed cache identifies and displays cards but cannot search them. The 20x
saving is not "the same data without the URLs": it is most of the card removed.
That rules CSV out for *save a search as a collection*, where the whole point is
a set you can then filter.

**Why it was deferred.** Migration 003 undercut the bandwidth argument: a print
run is now fetched once per card per week, so twenty-times-less of an already
rare request buys little. And CSV cannot populate `cards` as it stands — it
carries no `oracle_text`, `legalities`, `colors`, `color_identity` or `keywords`.
Those are not cosmetic: `color_identity` drives the pool's identity filter and
`legalities` drives format scoping, so a CSV-sourced row would **silently break
filtering**. It also drops `border_color`, `frame_effects` and `finishes`, which
is what stops Sol Ring's 30 Secret Lairs rendering as identical duplicates.

**So it is one piece of work, not two.** CSV only makes sense alongside a
separate lightweight printings table — promoting the columns we query, keeping
`data` nullable for rows we have only indexed. Doing either alone is worse than
doing neither.
