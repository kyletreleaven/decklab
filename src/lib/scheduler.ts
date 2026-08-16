/**
 * Request scheduler for Scryfall.
 *
 * Scryfall's rate limit is per *client*, not per connection, so extra
 * connections buy nothing and risk a 429. What is needed is preemption:
 * everything shares one ~100ms-spaced pipe, and interactive work jumps the
 * queue ahead of background work.
 *
 * The interactive lane evicts rather than accumulating. A hover storm should
 * cost one request, not one per card — but note this is *not* a debounce: the
 * first request goes out immediately, and only requests still waiting are
 * replaced. Nothing is ever made to wait on a timer.
 */

const MIN_INTERVAL_MS = 100;

/**
 * How long the pipe stays shut after a 429.
 *
 * Scryfall is a free service that asks for 50-100ms spacing. If we are ever
 * told we have exceeded that, the correct response is to stop entirely for a
 * while — not to retry, and certainly not to keep the queue draining at the
 * usual rate. Overridden by `Retry-After` when the server sends one.
 */
const RATE_LIMIT_BACKOFF_MS = 60_000;

/** When set, nothing runs until this timestamp. */
let pausedUntil = 0;

/** Shut the pipe. Private: only `scheduleFetch` decides when we have overrun. */
function pauseFor(ms: number): void {
  pausedUntil = Math.max(pausedUntil, Date.now() + ms);
}

/** Remaining pause in ms, 0 when running normally. */
export function pausedRemaining(): number {
  return Math.max(0, pausedUntil - Date.now());
}

/** Test hook — the pause is module state and would leak between cases. */
export function resetRateLimit(): void {
  pausedUntil = 0;
}

export type Lane = "interactive" | "background";

/**
 * Rejection for a request replaced before it ran. Nothing was waiting on it —
 * the card moved on — so callers should treat this as a non-event.
 */
export class Superseded extends Error {
  constructor(key: string) {
    super(`request superseded: ${key}`);
    this.name = "Superseded";
  }
}

export function isSuperseded(error: unknown): boolean {
  return error instanceof Superseded;
}

interface Job {
  run: () => Promise<unknown>;
  resolve: (value: never) => void;
  reject: (error: unknown) => void;
}

/**
 * Interactive jobs, keyed. A new request evicts a pending one with the same
 * key, so a stream of hovers collapses to the newest — but a search and a
 * printings lookup do not evict each other, which depth-1-across-everything
 * would wrongly do.
 *
 * Map iteration is insertion-ordered, so taking the last entry is LIFO: the
 * most recent interactive request is by definition the one on screen.
 */
const interactive = new Map<string, Job>();

/** Background work is FIFO: a backfill should finish, not restart forever. */
const background: Job[] = [];

let inFlight = false;
let lastStartedAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function takeNext(): Job | null {
  if (interactive.size) {
    const key = [...interactive.keys()][interactive.size - 1];
    const job = interactive.get(key)!;
    interactive.delete(key);
    return job;
  }
  return background.shift() ?? null;
}

async function pump(): Promise<void> {
  if (inFlight) return;

  const job = takeNext();
  if (!job) return;

  inFlight = true;
  try {
    // A 429 shuts everything, not just the request that drew it.
    const paused = pausedRemaining();
    if (paused > 0) await sleep(paused);

    // Space requests from the last *start*, so a slow response does not add
    // its own latency to the gap.
    const wait = MIN_INTERVAL_MS - (Date.now() - lastStartedAt);
    if (wait > 0) await sleep(wait);
    lastStartedAt = Date.now();

    job.resolve((await job.run()) as never);
  } catch (error) {
    job.reject(error);
  } finally {
    inFlight = false;
    // Re-check rather than recursing into an awaited call, so the stack stays
    // flat under sustained load.
    void pump();
  }
}

/**
 * Queue a request.
 *
 * `key` scopes eviction within the interactive lane — pass something stable per
 * kind of request ("search", "printings"), not per argument, or nothing will
 * ever evict anything.
 */
export function schedule<T>(
  run: () => Promise<T>,
  options: { lane?: Lane; key?: string } = {},
): Promise<T> {
  const { lane = "interactive", key = "default" } = options;

  return new Promise<T>((resolve, reject) => {
    const job: Job = {
      run,
      resolve: resolve as (value: never) => void,
      reject,
    };

    if (lane === "interactive") {
      const displaced = interactive.get(key);
      if (displaced) {
        displaced.reject(new Superseded(key));
        // `set` on an existing key keeps its original insertion position, so
        // without this the map would still order this job by when its *key*
        // first appeared — a fresh search would queue behind a stale hover
        // instead of preempting it, which is the opposite of the LIFO that
        // `takeNext` is relying on.
        interactive.delete(key);
      }
      interactive.set(key, job);
    } else {
      background.push(job);
    }

    void pump();
  });
}

/** Pending counts, for tests and diagnostics. */
export function pendingCounts(): { interactive: number; background: number } {
  return { interactive: interactive.size, background: background.length };
}

/** Whatever `fetch` the caller runs on — Tauri's in the app, the global in Node. */
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Bind a fetch implementation to the shared queue. The result is the only
 * sanctioned way to make an HTTP request.
 *
 * Spacing and backoff are one concern, so they live in one place. An earlier
 * version exported `pauseFor` and had each caller notice its own 429, which is
 * a convention rather than a mechanism: the contract-test suite bypassed it
 * simply by calling `schedule(() => fetch(...))` and went on draining its
 * backlog into a limit that had already told us to stop. Going through here,
 * that is not expressible.
 *
 * The implementation is a parameter rather than an import because the app runs
 * on `@tauri-apps/plugin-http` (which is what gets past the webview's CORS) and
 * the tests run on Node's global. The *queue* is module state, so every binding
 * shares one pipe — which is the whole point, since the limit is per client.
 */
export function scheduledFetch(fetchImpl: FetchLike) {
  return async (
    url: string,
    init?: RequestInit,
    options: { lane?: Lane; key?: string } = {},
  ): Promise<Response> =>
    schedule(async () => {
      const response = await fetchImpl(url, init);

      if (response.status === 429) {
        // `Retry-After` is seconds when numeric. Anything unparseable falls
        // back to the fixed backoff rather than to zero — never treat a
        // rate-limit response as permission to continue.
        const retryAfter = Number(response.headers.get("Retry-After"));
        pauseFor(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : RATE_LIMIT_BACKOFF_MS,
        );
      }

      return response;
    }, options);
}
