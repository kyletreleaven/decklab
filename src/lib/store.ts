import { writeCards, type Stamped } from "./cards";
import { type CardRow, rowToCard } from "./db";
import type { Sql } from "./sql";
import type { Card } from "./types";

/**
 * The card store's reads and writes: `card-cache.db`, Scryfall's data in a
 * file of its own, shared by every mode. Only `scryfall.ts` calls these,
 * passing `cardStore()`; taking the store as a parameter lets them run on a
 * real SQLite file in tests. See docs/card-fetching.md → *The card store*.
 *
 * Every read is *fresh* only: a card, stamp or default older than the TTL
 * counts as missing, so the caller fetches it again. That is the one
 * freshness rule. The working copy in the user database takes the store's
 * rows as they are and has none of its own.
 */

/** A week. New sets arrive every few weeks; prices are the fastest mover. */
export const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Keys per `IN (…)`, under SQLite's variable ceiling. */
const CHUNK = 400;

function cutoff(now: number): string {
  return new Date(now - TTL_MS).toISOString();
}

function holes(count: number, from: number): string {
  return Array.from({ length: count }, (_, i) => `$${from + i}`).join(", ");
}

function stamped(row: CardRow): Stamped {
  return { card: rowToCard(row), cachedAt: row.cached_at };
}

async function inChunks<K, R>(keys: K[], query: (chunk: K[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let start = 0; start < keys.length; start += CHUNK) {
    out.push(...(await query(keys.slice(start, start + CHUNK))));
  }
  return out;
}

/** Keep what Scryfall sent, stamped `at`. */
export async function storeCards(sql: Sql, cards: Card[], at: string): Promise<Stamped[]> {
  const rows = cards.map((card) => ({ card, cachedAt: at }));
  await writeCards(sql, rows);
  return rows;
}

export async function freshById(sql: Sql, ids: string[], now: number): Promise<Stamped[]> {
  const rows = await inChunks([...new Set(ids)], (chunk) =>
    sql.select<CardRow>(
      `SELECT * FROM cards WHERE cached_at >= $1 AND id IN (${holes(chunk.length, 2)})`,
      [cutoff(now), ...chunk],
    ),
  );
  return rows.map(stamped);
}

/** How a set + collector number lookup is keyed: set codes are lower case. */
export function setNumberKey(set: string, number: string): string {
  return `${set.toLowerCase()}|${number}`;
}

/**
 * English printings by set + collector number, which is what Scryfall's
 * `/cards/collection` answers for that identifier.
 */
export async function freshBySetNumber(
  sql: Sql,
  keys: string[],
  now: number,
): Promise<Stamped[]> {
  const rows = await inChunks([...new Set(keys)], (chunk) => {
    // The set codes alone first, so SQLite can use its index on them.
    const sets = [...new Set(chunk.map((key) => key.split("|")[0]))];
    return sql.select<CardRow>(
      `SELECT * FROM cards
        WHERE set_code IN (${holes(sets.length, 2)})
          AND set_code || '|' || collector_number IN (${holes(chunk.length, 2 + sets.length)})
          AND cached_at >= $1
          AND COALESCE(json_extract(data, '$.lang'), 'en') = 'en'`,
      [cutoff(now), ...sets, ...chunk],
    );
  });
  return rows.map(stamped);
}

/** Every stored printing of a card, newest first, however old. */
export async function storedPrintings(sql: Sql, oracleId: string): Promise<Stamped[]> {
  const rows = await sql.select<CardRow>(
    "SELECT * FROM cards WHERE oracle_id = $1 ORDER BY released_at DESC",
    [oracleId],
  );
  return rows.map(stamped);
}

/**
 * A card's whole print run, if it was fetched complete within the TTL.
 *
 * `cards` holds every printing we have seen, but not the knowledge that we have
 * seen them all; `oracle_fetches` is that knowledge.
 */
export async function completePrintings(
  sql: Sql,
  oracleId: string,
  now: number,
): Promise<Stamped[] | null> {
  const stamps = await sql.select<{ n: number }>(
    `SELECT COUNT(*) AS n FROM oracle_fetches
      WHERE oracle_id = $1 AND printings_fetched_at >= $2`,
    [oracleId, cutoff(now)],
  );
  if (!stamps[0]?.n) return null;

  const rows = await storedPrintings(sql, oracleId);
  return rows.length ? rows : null;
}

/** Stamp a print run complete. Only after its cards are stored. */
export async function markPrintingsFetched(sql: Sql, oracleId: string, at: string): Promise<void> {
  await sql.execute(
    `INSERT INTO oracle_fetches (oracle_id, printings_fetched_at)
     VALUES ($1, $2)
     ON CONFLICT (oracle_id) DO UPDATE SET printings_fetched_at = excluded.printings_fetched_at`,
    [oracleId, at],
  );
}

/** How a bare name is matched: case and surrounding space never matter. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

interface DefaultRow extends CardRow {
  key_full: string;
  key_front: string;
}

/**
 * The default printing for each name that picks out exactly one card.
 *
 * A name matches a card's full name, or failing that its front face ("Delver
 * of Secrets" for "Delver of Secrets // Insectile Aberration"), as Scryfall's
 * name lookup does. Only cards Scryfall has given *as the card* — those with a
 * fresh default — are candidates; a name matching more than one is a miss, so
 * Scryfall decides it. Keyed by `nameKey`.
 */
export async function freshDefaults(
  sql: Sql,
  names: string[],
  now: number,
): Promise<Map<string, Stamped>> {
  const keys = [...new Set(names.map(nameKey))];
  const rows = await inChunks(keys, (chunk) =>
    sql.select<DefaultRow>(
      `WITH named AS (
         SELECT DISTINCT oracle_id,
                lower(name) AS full,
                lower(CASE WHEN instr(name, ' // ') > 0
                           THEN substr(name, 1, instr(name, ' // ') - 1)
                           ELSE name END) AS front
           FROM cards
       )
       SELECT c.*, n.full AS key_full, n.front AS key_front
         FROM named n
         JOIN default_printings d ON d.oracle_id = n.oracle_id
         JOIN cards c ON c.id = d.printing_id
        WHERE d.seen_at >= $1 AND c.cached_at >= $1
          AND (n.full IN (${holes(chunk.length, 2)}) OR n.front IN (${holes(chunk.length, 2)}))`,
      [cutoff(now), ...chunk],
    ),
  );

  const full = new Map<string, Map<string, DefaultRow>>();
  const front = new Map<string, Map<string, DefaultRow>>();
  const add = (index: Map<string, Map<string, DefaultRow>>, key: string, row: DefaultRow) => {
    const byOracle = index.get(key) ?? new Map<string, DefaultRow>();
    byOracle.set(row.oracle_id, row);
    index.set(key, byOracle);
  };
  for (const row of rows) {
    add(full, row.key_full, row);
    if (row.key_front !== row.key_full) add(front, row.key_front, row);
  }

  const found = new Map<string, Stamped>();
  for (const key of keys) {
    const candidates = full.get(key) ?? front.get(key);
    if (candidates?.size === 1) found.set(key, stamped([...candidates.values()][0]));
  }
  return found;
}

/** Record the printing Scryfall gave as each card; a later answer replaces it. */
export async function recordDefaults(sql: Sql, cards: Card[], at: string): Promise<void> {
  const latest = new Map(cards.map((card) => [card.oracleId, card.id]));
  const entries = [...latest];
  for (let start = 0; start < entries.length; start += CHUNK / 2) {
    const chunk = entries.slice(start, start + CHUNK / 2);
    const params: unknown[] = [at];
    const tuples = chunk.map(([oracleId, printingId]) => {
      params.push(oracleId, printingId);
      return `($${params.length - 1}, $${params.length}, $1)`;
    });
    await sql.execute(
      `INSERT INTO default_printings (oracle_id, printing_id, seen_at)
       VALUES ${tuples.join(", ")}
       ON CONFLICT (oracle_id) DO UPDATE
         SET printing_id = excluded.printing_id, seen_at = excluded.seen_at`,
      params,
    );
  }
}
