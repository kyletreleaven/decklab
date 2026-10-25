import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EASE_AFTER_MS, PRESENT_RATE_WINDOW_MS, storeChannel } from "./channel";
import { BASE_INTERVAL_MS, MAX_INTERVAL_MS } from "./scheduler";
import { sqlOver } from "./sqlOver";

const MIGRATIONS = join(__dirname, "../../src-tauri/migrations/cache");
const T0 = Date.parse("2026-10-25T12:00:00.000Z");

let dir: string;
let file: string;
const open: DatabaseSync[] = [];

/** A connection of its own to the shared store file: one per "process". */
function process_() {
  const db = new DatabaseSync(file);
  open.push(db);
  const sql = sqlOver(db);
  return { db, channel: storeChannel(async () => sql, async () => "lab") };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  dir = mkdtempSync(join(tmpdir(), "decklab-channel-"));
  file = join(dir, "card-cache.db");
  const db = new DatabaseSync(file);
  for (const name of ["001_store.sql", "002_channel.sql", "003_rate_limits.sql"]) {
    db.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  }
  db.close();
});

afterEach(() => {
  for (const db of open.splice(0)) db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

const interval = (db: DatabaseSync) =>
  (db.prepare("SELECT interval_ms AS n FROM channel").get() as { n: number }).n;

const DRAWN = {
  endpoint: "api.scryfall.com/cards/collection",
  lane: "background",
  retryAfter: "60",
} as const;

describe("the shared channel", () => {
  it("spaces claims by the pace, from the first one now", async () => {
    const { channel } = process_();
    const slots = [await channel.claim(), await channel.claim(), await channel.claim()];
    expect(slots).toEqual([T0, T0 + BASE_INTERVAL_MS, T0 + 2 * BASE_INTERVAL_MS]);
  });

  it("never gives two processes the same slot", async () => {
    const a = process_();
    const b = process_();
    const slots = [
      await a.channel.claim(),
      await b.channel.claim(),
      await a.channel.claim(),
      await b.channel.claim(),
    ];
    expect(slots).toEqual([0, 1, 2, 3].map((i) => T0 + i * BASE_INTERVAL_MS));
  });

  it("pauses every process on a 429 in one, and halves the pace for all", async () => {
    const a = process_();
    const b = process_();
    await a.channel.claim();

    const until = T0 + 60_000;
    await a.channel.rateLimited(until, DRAWN);

    expect(await b.channel.pausedUntil()).toBe(until);
    const first = await b.channel.claim();
    const second = await b.channel.claim();
    expect(first).toBe(until);
    expect(second - first).toBe(2 * BASE_INTERVAL_MS);
  });

  it("keeps the slower pace across a restart", async () => {
    const a = process_();
    await a.channel.rateLimited(T0 + 1_000, DRAWN);
    a.db.close();
    open.splice(open.indexOf(a.db), 1);

    const restarted = process_();
    expect(interval(restarted.db)).toBe(2 * BASE_INTERVAL_MS);
    expect(await restarted.channel.pausedUntil()).toBe(T0 + 1_000);
  });

  it("eases a tenth per quiet hour, never below the base pace", async () => {
    const { db, channel } = process_();
    await channel.rateLimited(T0, DRAWN);
    await channel.rateLimited(T0, DRAWN);
    expect(interval(db)).toBe(4 * BASE_INTERVAL_MS);

    await channel.claim();
    expect(interval(db)).toBe(4 * BASE_INTERVAL_MS);

    vi.setSystemTime(T0 + EASE_AFTER_MS);
    await channel.claim();
    expect(interval(db)).toBe(360);

    for (let hour = 2; hour < 40; hour++) {
      vi.setSystemTime(T0 + hour * EASE_AFTER_MS);
      await channel.claim();
    }
    expect(interval(db)).toBe(BASE_INTERVAL_MS);
  });

  it("slows to a ceiling, never past it", async () => {
    const { db, channel } = process_();
    for (let i = 0; i < 20; i++) await channel.rateLimited(T0, DRAWN);
    expect(interval(db)).toBe(MAX_INTERVAL_MS);
  });
});

describe("what a 429 teaches", () => {
  it("records every 429 with the pace and the actual gap at the time", async () => {
    const a = process_();
    const b = process_();
    await a.channel.claim();
    await b.channel.claim();
    await a.channel.rateLimited(T0 + 60_000, DRAWN);

    expect(a.db.prepare("SELECT * FROM rate_limits").all()).toEqual([
      {
        at: T0,
        process: "lab",
        lane: "background",
        endpoint: "api.scryfall.com/cards/collection",
        retry_after: "60",
        interval_ms: BASE_INTERVAL_MS,
        gap_ms: BASE_INTERVAL_MS,
      },
    ]);
  });

  it("halves the present rate when it was slower than the pace", async () => {
    const { db, channel } = process_();
    await channel.claim();
    vi.setSystemTime(T0 + 300);
    await channel.claim(); // nothing was waiting: an actual gap of 300ms
    await channel.rateLimited(T0 + 60_000, DRAWN);

    expect(interval(db)).toBe(600);
  });

  it("goes by the pace alone when the request went out on its own", async () => {
    const { db, channel } = process_();
    await channel.claim();
    vi.setSystemTime(T0 + PRESENT_RATE_WINDOW_MS + 1);
    await channel.claim();
    await channel.rateLimited(T0 + 60_000, DRAWN);

    expect(interval(db)).toBe(2 * BASE_INTERVAL_MS);
  });
});
