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
 *
 * Lanes are priority only. Every lane shares one channel — one pace, one
 * pause — and in the app that channel is shared by every DeckLab process,
 * through the card store (`shareChannel`, docs/card-fetching.md → *One channel
 * across processes*).
 */

/** The starting pace: Scryfall asks for 50-100ms between requests. */
export const BASE_INTERVAL_MS = 100;

/** The slowest a 429 can push the pace. */
export const MAX_INTERVAL_MS = 10_000;

/**
 * How long the pipe stays shut after a 429.
 *
 * Scryfall is a free service that asks for 50-100ms spacing. If we are ever
 * told we have exceeded that, the correct response is to stop entirely for a
 * while — not to retry, and certainly not to keep the queue draining at the
 * usual rate. Overridden by `Retry-After` when the server sends one.
 */
const RATE_LIMIT_BACKOFF_MS = 60_000;

/**
 * Permission to send: the pace and the pause.
 *
 * A 429 pauses the channel *and* halves its pace, and the slower pace stays:
 * a 429 is never the plan, but when one comes it is the best information
 * there is about what Scryfall allows. How the pace recovers is the
 * channel's business.
 */
export interface Channel {
  /** Claim the next slot; resolves with when (ms since epoch) it starts. */
  claim(): Promise<number>;
  /** When the pause ends (ms since epoch); in the past when there is none. */
  pausedUntil(): Promise<number>;
  /** A 429 arrived: pause until `until`, slow down, and record it. */
  rateLimited(until: number, drawnBy: RateLimited): Promise<void>;
}

/** What drew a 429, for the record. */
export interface RateLimited {
  /** Host and path, no query: `api.scryfall.com/cards/collection`. */
  endpoint: string;
  lane: Lane;
  /** The `Retry-After` header as sent. */
  retryAfter: string | null;
}

/** Host and path of a URL, without its query. */
export function endpointOf(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname}`;
  } catch {
    return url.split("?")[0];
  }
}

/** What this process knows of the pause, for diagnostics and tests. */
let pausedUntil = 0;
let lastSlotAt = 0;
let intervalMs = BASE_INTERVAL_MS;

/**
 * This process alone: the default, and what the tests and the contract suite
 * run on. Its pace never recovers within the process.
 */
const memoryChannel: Channel = {
  async claim() {
    lastSlotAt = Math.max(lastSlotAt + intervalMs, Date.now(), pausedUntil);
    return lastSlotAt;
  },
  async pausedUntil() {
    return pausedUntil;
  },
  async rateLimited(until) {
    // No record outside the store: this channel is for tests and the
    // contract suite.
    intervalMs = Math.min(MAX_INTERVAL_MS, intervalMs * 2);
    pausedUntil = Math.max(pausedUntil, until);
  },
};

let channel: Channel = memoryChannel;

/** Share the channel beyond this process. The app calls this at startup. */
export function shareChannel(shared: Channel): void {
  channel = shared;
}

/** Remaining pause in ms, as this process knows it; 0 when running normally. */
export function pausedRemaining(): number {
  return Math.max(0, pausedUntil - Date.now());
}

/** Test hook — the channel's state is module state and would leak between cases. */
export function resetRateLimit(): void {
  pausedUntil = 0;
  lastSlotAt = 0;
  intervalMs = BASE_INTERVAL_MS;
  channel = memoryChannel;
}

/**
 * When a 429 says to resume: `Retry-After` as seconds or as an HTTP date.
 * Anything unparseable, or a date already past, gets the fixed backoff —
 * never zero, since a rate-limit response is never permission to continue.
 */
export function resumeAt(retryAfter: string | null, now = Date.now()): number {
  const seconds = Number(retryAfter);
  if (retryAfter !== null && retryAfter.trim() !== "" && Number.isFinite(seconds) && seconds > 0) {
    return now + seconds * 1000;
  }
  const date = retryAfter === null ? NaN : Date.parse(retryAfter);
  if (Number.isFinite(date) && date > now) return date;
  return now + RATE_LIMIT_BACKOFF_MS;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a slot on the channel, then check the pause: another process may
 * have drawn a 429 while this one waited. A slot lost to a pause is simply
 * not used. Spacing runs from each request's *start*, so a slow response does
 * not add its own latency to the gap. If the channel itself fails, this
 * throws and the request is not sent.
 */
async function permission(): Promise<void> {
  for (;;) {
    const slot = await channel.claim();
    if (slot > Date.now()) await sleep(slot - Date.now());
    const resume = await channel.pausedUntil();
    if (resume <= Date.now()) return;
    pausedUntil = Math.max(pausedUntil, resume);
    await sleep(resume - Date.now());
  }
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
    await permission();
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
        const retryAfter = response.headers.get("Retry-After");
        const until = resumeAt(retryAfter);
        pausedUntil = Math.max(pausedUntil, until);
        console.error(
          `Scryfall rate-limited us (429): paused until ${new Date(until).toISOString()}, pace halved. ` +
            "This is a bug: see bugs/005.",
        );
        await channel.rateLimited(until, {
          endpoint: endpointOf(url),
          lane: options.lane ?? "interactive",
          retryAfter,
        });
      }

      return response;
    }, options);
}
