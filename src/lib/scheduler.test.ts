import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Channel,
  type RateLimited,
  isSuperseded,
  pausedRemaining,
  pendingCounts,
  resetRateLimit,
  resumeAt,
  schedule,
  scheduledFetch,
  shareChannel,
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

  it("reads Retry-After as seconds or a future date, and never as zero", () => {
    const now = Date.parse("2026-10-25T12:00:00Z");
    expect(resumeAt("30", now)).toBe(now + 30_000);
    expect(resumeAt("Sun, 25 Oct 2026 12:02:00 GMT", now)).toBe(now + 120_000);
    for (const junk of [null, "", "0", "-5", "soon", "Wed, 21 Oct 2015 07:28:00 GMT"]) {
      expect(resumeAt(junk, now)).toBeGreaterThan(now + 1_000);
    }
  });
});

describe("a shared channel", () => {
  const reply = (status: number, headers: Record<string, string> = {}) =>
    new Response(null, { status, headers });

  /** A channel as another process would see it, with its state in plain view. */
  function sharedChannel() {
    const state = { slot: 0, pausedUntil: 0, limited: [] as number[], drawnBy: [] as RateLimited[] };
    const channel: Channel = {
      async claim() {
        state.slot = Math.max(state.slot + 100, Date.now(), state.pausedUntil);
        return state.slot;
      },
      async pausedUntil() {
        return state.pausedUntil;
      },
      async rateLimited(until, drawnBy) {
        state.limited.push(until);
        state.drawnBy.push(drawnBy);
        state.pausedUntil = Math.max(state.pausedUntil, until);
      },
    };
    return { state, channel };
  }

  beforeEach(() => resetRateLimit());
  afterEach(() => {
    resetRateLimit();
    vi.useRealTimers();
  });

  it("tells the shared channel about a 429", async () => {
    const { state, channel } = sharedChannel();
    shareChannel(channel);
    await scheduledFetch(async () => reply(429, { "Retry-After": "30" }))(
      "https://example.test/cards/collection?q=ignored",
      undefined,
      { lane: "background" },
    );
    expect(state.limited).toHaveLength(1);
    expect(state.limited[0]).toBeGreaterThan(Date.now() + 25_000);
    expect(state.drawnBy).toEqual([
      { endpoint: "example.test/cards/collection", lane: "background", retryAfter: "30" },
    ]);
  });

  it("holds a request while another process's pause lasts", async () => {
    vi.useFakeTimers();
    const { state, channel } = sharedChannel();
    shareChannel(channel);
    state.pausedUntil = Date.now() + 5_000;

    const sent = vi.fn(async () => reply(200));
    const done = scheduledFetch(sent)("https://example.test/a");

    await vi.advanceTimersByTimeAsync(4_900);
    expect(sent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    await done;
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("re-checks the pause after waiting for its slot", async () => {
    vi.useFakeTimers();
    const { state, channel } = sharedChannel();
    shareChannel(channel);
    state.slot = Date.now() + 900; // the next slot is a second away

    const sent = vi.fn(async () => reply(200));
    const done = scheduledFetch(sent)("https://example.test/a");

    // Meanwhile another process draws a 429.
    await vi.advanceTimersByTimeAsync(500);
    state.pausedUntil = Date.now() + 10_000;

    await vi.advanceTimersByTimeAsync(9_000);
    expect(sent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    await done;
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the channel cannot be reached", async () => {
    shareChannel({
      claim: async () => {
        throw new Error("store unavailable");
      },
      pausedUntil: async () => 0,
      rateLimited: async () => {},
    });
    const sent = vi.fn(async () => reply(200));
    await expect(scheduledFetch(sent)("https://example.test/a")).rejects.toThrow("store unavailable");
    expect(sent).not.toHaveBeenCalled();
  });
});

