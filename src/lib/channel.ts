import { BASE_INTERVAL_MS, MAX_INTERVAL_MS, type Channel } from "./scheduler";
import type { Sql } from "./sql";

/**
 * The channel to Scryfall, kept in the card store so every DeckLab process
 * shares it: the app, the lab, anything else that opens `card-cache.db`.
 * See docs/card-fetching.md → *One channel across processes*.
 *
 * Each claim is one `UPDATE … RETURNING`, a single statement, so it is atomic
 * across processes (SQLite's file lock) and across the SQL plugin's pooled
 * connections alike. No two claims ever get the same slot.
 *
 * A 429 is recorded in `rate_limits` with the rate at the time, and halves
 * the pace: half of the *slower* of the configured pace and the actual gap
 * before the request that drew it. The pace recovers slowly: each hour
 * without a 429 takes a tenth off the interval, never below the base pace.
 */

/** How long the pace must go without a 429 before each easing step. */
export const EASE_AFTER_MS = 60 * 60 * 1000;

/**
 * A gap longer than this means the request went out on its own, so the gap
 * says nothing about the rate that drew the 429; only the pace counts.
 */
export const PRESENT_RATE_WINDOW_MS = 1000;

export type ProcessKind = "app" | "lab";

export function storeChannel(
  store: () => Promise<Sql>,
  process: () => Promise<ProcessKind>,
): Channel {
  return {
    async claim() {
      const now = Date.now();
      const rows = await (await store()).select<{ slot: number }>(
        `UPDATE channel SET
           prev_slot_at = last_slot_at,
           last_slot_at = max(last_slot_at + interval_ms, $1, paused_until),
           interval_ms = CASE
             WHEN interval_ms > $2 AND $1 - last_change_at >= $3
             THEN max($2, CAST(interval_ms * 9 / 10 AS INTEGER))
             ELSE interval_ms END,
           last_change_at = CASE
             WHEN interval_ms > $2 AND $1 - last_change_at >= $3
             THEN $1 ELSE last_change_at END
         WHERE id = 1
         RETURNING last_slot_at AS slot`,
        [now, BASE_INTERVAL_MS, EASE_AFTER_MS],
      );
      if (!rows.length) throw new Error("the card store has no channel row");
      return Number(rows[0].slot);
    },

    async pausedUntil() {
      const rows = await (await store()).select<{ until: number }>(
        "SELECT paused_until AS until FROM channel WHERE id = 1",
      );
      if (!rows.length) throw new Error("the card store has no channel row");
      return Number(rows[0].until);
    },

    async rateLimited(until, drawnBy) {
      const sql = await store();
      const now = Date.now();
      // The record first, from the channel as it stood when the 429 came.
      await sql.execute(
        `INSERT INTO rate_limits (at, process, lane, endpoint, retry_after, interval_ms, gap_ms)
         SELECT $1, $2, $3, $4, $5, interval_ms, last_slot_at - prev_slot_at
           FROM channel WHERE id = 1`,
        [now, await process(), drawnBy.lane, drawnBy.endpoint, drawnBy.retryAfter],
      );
      await sql.execute(
        `UPDATE channel SET
           paused_until = max(paused_until, $1),
           interval_ms = min($2, 2 * CASE
             WHEN prev_slot_at > 0 AND last_slot_at - prev_slot_at <= $4
             THEN max(interval_ms, last_slot_at - prev_slot_at)
             ELSE interval_ms END),
           last_change_at = $3
         WHERE id = 1`,
        [until, MAX_INTERVAL_MS, now, PRESENT_RATE_WINDOW_MS],
      );
    },
  };
}
