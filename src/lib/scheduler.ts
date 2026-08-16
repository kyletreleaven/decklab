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
