# Fetching many cards

What it costs to pull a large set of cards out of Scryfall, why the obvious
optimisations do not help, and which design that leaves.

## The budget is requests, not bytes

Scryfall's limit is a request rate — roughly 10/second, one client-wide, which
`scheduler.ts` spaces at ~100ms and shuts entirely on a 429. Bandwidth is not
the scarce resource. Any trade that spends requests to save bytes is pointed the
wrong way.

Search pages hold **175 rows regardless of format**. Paging is a property of the
endpoint, not the payload, so a cheaper representation buys smaller pages, never
fewer of them.

## Why the obvious optimisations fail

Let *P* be pages of results and *M* the cards whose details we lack.

| Approach | Requests | Notes |
| --- | --- | --- |
| Walk `/cards/search` as JSON | `P` | 175 full cards per request |
| Walk as CSV, then fill via `/cards/collection` | `P + ⌈M/75⌉` | never fewer, usually more |
| `/bulk-data` dump | `1` | whole corpus, one download |

**CSV first, bulk fill after** looks efficient and is not. It cannot reduce `P`,
and `/cards/collection` accepts 75 identifiers where search already returned 175
cards — so refetching details is *less* efficient per request than never having
discarded them. For a 2,000-card search held locally at 0%, 12 requests becomes
39.

Its one winning case is degenerate: you already hold every card, so `M = 0` and
the CSV walk costs `P` requests at a twentieth of the bytes. But then the bulk
step does nothing, and what won was CSV alone.

**CSV cannot back a searchable collection anyway.** It omits `oracle_text`,
`colors`, `color_identity`, `keywords`, `power`, `toughness` and `released_at`
— pinned by a contract test. `compileQuery` filters on most of those, so a
CSV-backed cache identifies and displays cards without letting you search them.
The 20× saving is not "the same data minus URLs"; it is most of the card
removed. CSV belongs where only identity is needed — a printings index, an
ownership check — not where a set must later be filtered.

**Stub rows** (store ids now, fetch details on demand) fail similarly, and
worse: `collection_items.card_id` references `cards(id)`, so a stub is a card
row that exists but is not filled in, and every surface that renders one needs a
"not fetched yet" state. The failure is quiet — a tile with no image and no
explanation — and the collection cannot be filtered until something backfills
it.

## What that leaves

Two designs, and the API's shape picks between them.

**Modest walks.** Cap a save-a-search at ~10 pages (about 1,750 cards) and
refuse above it. Full JSON, cached as it arrives, so the walk is paid once and
everything after — filtering, sorting, rendering — is local. Card *details* are
economised separately: `printingsFetchedAt` serves a print run from disk inside
its TTL (migration 003).

**Bulk ingest, someday.** `/bulk-data` publishes whole-corpus dumps refreshed
daily. One request instead of `P`, after which All Magic is local, save-a-search
is a local query, and merging two paginated remote streams stops being a problem
because one of them is no longer remote. Costs are a large first download and a
refresh story, and it is the point at which DuckDB's bulk-ingest argument
returns.

The 175-row cap reads as a limitation only if you expect the search endpoint to
serve corpus-scale work. It is more likely a funnel: small queries through
search, everything large through the dumps. Read that way, a modest
save-a-search is the honest feature, and anything bigger is waiting for bulk
ingest rather than working around the API.
