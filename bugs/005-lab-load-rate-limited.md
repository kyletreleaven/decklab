# 005 — Loading the library into the lab drew a 429 from Scryfall

**Status:** open · cause found
**Reproduced:** yes, 2026-10-25, by the user — not to be reproduced again

## Symptom

Launching the lab with the real library as its seed failed with Scryfall's
rate-limit response: *"You are being rate-limited, try again after 60 seconds.
DO NOT IGNORE THIS WARNING, FAILURE TO ACT WILL RESULT IN A NETWORK BLOCK."*
Expected: the load answered from the card store, which already held every
printing the library names, with no requests at all.

## Repro

Do not run this. It is the request burst.

1. `npm run tauri dev`, left running.
2. `decklab dump` the real library to a file.
3. `DECKLAB_LAB_SEED=<that file> npm run lab`, beside it.

**Observed:** ~25 `/cards/collection` requests back to back, then a 429; the
lab opens empty. **Expected:** zero requests.

## Proof

Measured from the card store afterwards: the dump names 2,091 printings; all
were in the store before the load, but only ~140 were within the 7-day TTL.
1,813 rows carry a `cached_at` from the load itself — ~1,950 misses at 75 per
request, ≈ 26 requests. No test yet: the guard is a test that a library load
whose printings are all stored, however old, sends no request.

## Cause

Four things, the first two sufficient on their own:

1. **Identity refetched for freshness.** `freshById` and `freshBySetNumber`
   (`src/lib/store.ts`) apply the TTL to *which card is this*, which never
   changes; only prices go stale. So nearly the whole store counted as
   missing. Introduced with the card store, the same day.
2. **A long bulk job runs at the channel's full pace.** `resolveIdentifiers`
   sends its chunks one after another, and the scheduler releases each 100 ms
   after the last began: ~10 a second for as long as the job lasts. Whether
   that pace is within Scryfall's limit for `/cards/collection` is
   unverified; the 429 says it was not, at least with (3).
3. **Two processes, two channels.** The scheduler's queue, spacing and pause
   are per process (`src/lib/scheduler.ts`). The app and the lab ran side by
   side, each pacing only itself; a 429 in one does not pause the other, and
   a relaunch forgets the pause.
4. **Not counted before it shipped.** The request count of a lab load was
   never worked out on real data before the command was handed over, and was
   described as "roughly 40 requests, a few seconds", as if acceptable.

What worked: the 429 paused the channel for `Retry-After` and nothing was
retried; the load stopped at the first 429.

Found in the same audit, not involved here but against the same rule:
`cache_card_image` (`src-tauri/src/lib.rs`) downloads card images from
Scryfall's servers outside the scheduler, any number at once, and
`src/lib/images.ts` hands the webview the remote image URL until the local
copy exists. Neither is rate limited.

## Fix

In progress, per [`docs/card-fetching.md`](../docs/card-fetching.md) → *One
channel across processes*:

- ✅ one channel across every process (A), with a shared, persistent pause
  and a pace that learns from a 429 (`channel.ts`, `channel.test.ts`; the
  scheduler's side in `scheduler.test.ts` → *a shared channel*). Fixes (3).
- ✅ every 429 recorded with the pace and the actual gap at the time
  (`rate_limits`, `migrations/cache/003`).
- ✅ image downloads through the channel (`scheduledCall` in `images.ts`;
  Rust's `download_card_image` makes one request and reports its status), and
  no remote image URL ever reaches the webview. A pasted Scryfall link in URL
  import is refused. `channel-only.test.ts` reads the source and fails on any
  new way out to Scryfall.
- identity data refreshed on a long limit of its own, prices and print-run
  completeness on the 7-day one;
- the request count of each change measured on real data.
