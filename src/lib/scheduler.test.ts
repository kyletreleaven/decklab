import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSuperseded,
  pausedRemaining,
  pendingCounts,
  resetRateLimit,
  schedule,
  scheduledFetch,
  Superseded,
} from "./scheduler";

/** Resolves after `n` turns of the microtask queue plus any pending timers. */
async function settle(): Promise<void> {
  await vi.runAllTimersAsync();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("scheduler", () => {
  it("runs a single job and returns its value", async () => {
    vi.useFakeTimers();
    const result = schedule(async () => 42, { key: "a" });
    await settle();
    await expect(result).resolves.toBe(42);
    vi.useRealTimers();
  });

  it("propagates failures to the caller", async () => {
    vi.useFakeTimers();
    const boom = new Error("boom");
    // Attach the handler before draining, or the rejection is briefly
    // unhandled and the runner flags it.
    const outcome = schedule(async () => {
      throw boom;
    }).catch((e) => e);
    await settle();
    await expect(outcome).resolves.toBe(boom);
    vi.useRealTimers();
  });

  it("evicts a pending interactive job with the same key", async () => {
    vi.useFakeTimers();
    const gate = deferred<string>();
    const order: string[] = [];

    // Occupies the pipe so the next two have to wait.
    const first = schedule(() => gate.promise, { key: "blocker" });

    const stale = schedule(async () => {
      order.push("stale");
      return "stale";
    }, { key: "printings" });

    const fresh = schedule(async () => {
      order.push("fresh");
      return "fresh";
    }, { key: "printings" });

    const staleOutcome = stale.catch((e) => e);

    gate.resolve("done");
    await settle();

    await expect(first).resolves.toBe("done");
    await expect(fresh).resolves.toBe("fresh");
    expect(isSuperseded(await staleOutcome)).toBe(true);
    // The whole point: the abandoned job never ran.
    expect(order).toEqual(["fresh"]);

    vi.useRealTimers();
  });

  it("does NOT evict across different keys", async () => {
    vi.useFakeTimers();
    const gate = deferred<string>();
    const ran: string[] = [];

    const first = schedule(() => gate.promise, { key: "blocker" });
    const search = schedule(async () => {
      ran.push("search");
      return "search";
    }, { key: "search" });
    const printings = schedule(async () => {
      ran.push("printings");
      return "printings";
    }, { key: "printings" });

    gate.resolve("done");
    await settle();

    // A search and a printings lookup must coexist — depth-1 across *all*
    // interactive work would have one silently kill the other.
    await expect(first).resolves.toBe("done");
    await expect(search).resolves.toBe("search");
    await expect(printings).resolves.toBe("printings");
    expect(ran).toHaveLength(2);

    vi.useRealTimers();
  });

  it("orders a replacement job by when it was queued, not when its key first appeared", async () => {
    vi.useFakeTimers();
    const gate = deferred<string>();
    const ran: string[] = [];

    const blocker = schedule(() => gate.promise, { key: "blocker" });
    // "search" enters the map first, then "printings" — so a naive `set` would
    // leave the *replacement* search pinned at search's original position and
    // serve the older hover first.
    const stale = schedule(async () => {
      ran.push("stale-search");
      return "stale";
    }, { key: "search" });
    schedule(async () => {
      ran.push("printings");
      return "printings";
    }, { key: "printings" });
    const fresh = schedule(async () => {
      ran.push("fresh-search");
      return "fresh";
    }, { key: "search" });

    // Attached before the rejection lands, or it surfaces as unhandled.
    const staleOutcome = stale.catch((e) => e);

    gate.resolve("done");
    await settle();

    await expect(blocker).resolves.toBe("done");
    expect(isSuperseded(await staleOutcome)).toBe(true);
    await expect(fresh).resolves.toBe("fresh");
    // The newest interactive request is the one on screen, so it goes first.
    expect(ran).toEqual(["fresh-search", "printings"]);

    vi.useRealTimers();
  });

  it("serves interactive work before background work", async () => {
    vi.useFakeTimers();
    const gate = deferred<string>();
    const ran: string[] = [];

    const blocker = schedule(() => gate.promise, { key: "blocker" });

    const bg = schedule(
      async () => {
        ran.push("background");
        return "bg";
      },
      { lane: "background" },
    );
    const fg = schedule(
      async () => {
        ran.push("interactive");
        return "fg";
      },
      { key: "fg" },
    );

    gate.resolve("done");
    await settle();

    await expect(blocker).resolves.toBe("done");
    await expect(bg).resolves.toBe("bg");
    await expect(fg).resolves.toBe("fg");
    // Enqueued first, but preempted.
    expect(ran).toEqual(["interactive", "background"]);

    vi.useRealTimers();
  });

  it("keeps every background job — they are never evicted", async () => {
    vi.useFakeTimers();
    const ran: number[] = [];

    // Import chunks each carry distinct cards, so dropping one loses data.
    const jobs = [1, 2, 3].map((n) =>
      schedule(
        async () => {
          ran.push(n);
          return n;
        },
        { lane: "background" },
      ),
    );

    await settle();
    await expect(Promise.all(jobs)).resolves.toEqual([1, 2, 3]);
    expect(ran).toEqual([1, 2, 3]);

    vi.useRealTimers();
  });

  it("drains fully, leaving nothing pending", async () => {
    vi.useFakeTimers();
    const jobs = [
      schedule(async () => 1, { key: "a" }),
      schedule(async () => 2, { key: "b" }),
      schedule(async () => 3, { lane: "background" }),
    ];

    await settle();
    await Promise.all(jobs);
    expect(pendingCounts()).toEqual({ interactive: 0, background: 0 });

    vi.useRealTimers();
  });

  it("spaces requests to respect the rate limit", async () => {
    vi.useFakeTimers();
    const startedAt: number[] = [];

    const jobs = [1, 2, 3].map(() =>
      schedule(
        async () => {
          startedAt.push(Date.now());
        },
        { lane: "background" },
      ),
    );

    await settle();
    await Promise.all(jobs);

    // Scryfall asks for 50-100ms between requests.
    for (let i = 1; i < startedAt.length; i++) {
      expect(startedAt[i] - startedAt[i - 1]).toBeGreaterThanOrEqual(100);
    }

    vi.useRealTimers();
  });

  it("identifies superseded rejections", () => {
    expect(isSuperseded(new Superseded("printings"))).toBe(true);
    expect(isSuperseded(new Error("network down"))).toBe(false);
    expect(isSuperseded(null)).toBe(false);
  });
});

describe("rate limiting", () => {
  const reply = (status: number, headers: Record<string, string> = {}) =>
    new Response(null, { status, headers });

  beforeEach(() => resetRateLimit());
  afterEach(() => resetRateLimit());

  it("shuts the pipe on a 429, honouring Retry-After", async () => {
    const send = scheduledFetch(async () => reply(429, { "Retry-After": "30" }));
    await send("https://example.test/a");

    // Seconds, not milliseconds — reading it as ms would back off for 30ms and
    // carry straight on.
    expect(pausedRemaining()).toBeGreaterThan(25_000);
    expect(pausedRemaining()).toBeLessThanOrEqual(30_000);
  });

  it("falls back to a fixed backoff when Retry-After is missing or junk", async () => {
    const cases: Record<string, string>[] = [
      {},
      { "Retry-After": "Wed, 21 Oct 2015 07:28:00 GMT" },
    ];
    for (const headers of cases) {
      resetRateLimit();
      const send = scheduledFetch(async () => reply(429, headers));
      await send("https://example.test/a");
      // Never zero: an unparseable header is not permission to continue.
      expect(pausedRemaining()).toBeGreaterThan(1_000);
    }
  });

  it("pauses the whole client, not just the binding that drew the 429", async () => {
    // Two bindings — the app's Tauri fetch and the tests' Node fetch are
    // exactly this shape — must share one pause, since the limit is per client.
    const limited = scheduledFetch(async () => reply(429));
    scheduledFetch(async () => reply(200));

    await limited("https://example.test/a");

    // The pause is module state, so it is not the caller's to opt out of.
    // Deliberately no second request here: it would correctly park the pipe for
    // the whole backoff and starve everything queued behind it.
    expect(pausedRemaining()).toBeGreaterThan(1_000);
  });

  it("leaves the pipe open on an ordinary response", async () => {
    const send = scheduledFetch(async () => reply(200));
    await send("https://example.test/a");
    expect(pausedRemaining()).toBe(0);
  });
});

