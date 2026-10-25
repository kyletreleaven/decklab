import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import type { Sql } from "./sql";
import type { Card } from "./types";

/**
 * Two SQLite files, which the `sql:` plugin resolves against the app config
 * directory. Migrations run on first load, so everything below can assume the
 * schema exists.
 *
 * - `db()`: the user's data, plus `cards` as a working copy. `decklab.db`, or
 *   in lab mode `lab.db`, deleted at every launch (`src-tauri/src/lab.rs`).
 * - `cardStore()`: `card-cache.db`, Scryfall's data, shared by every mode and
 *   used only by `scryfall.ts` (docs/card-fetching.md → *The card store*).
 */
let handle: Promise<Database> | null = null;
let store: Promise<Sql> | null = null;
let lab: Promise<boolean> | null = null;

export function db(): Promise<Database> {
  handle ??= labMode().then((on) => Database.load(on ? "sqlite:lab.db" : "sqlite:decklab.db"));
  return handle;
}

export function cardStore(): Promise<Sql> {
  store ??= openStore().then(sqlOf);
  return store;
}

/** Asked once: in lab mode the answer also deletes the last `lab.db`. */
function labMode(): Promise<boolean> {
  lab ??= invoke<boolean>("prepare_lab_db");
  return lab;
}

function sqlOf(conn: Database): Sql {
  return {
    select: <T>(sql: string, params: unknown[] = []) => conn.select<T[]>(sql, params),
    execute: async (sql, params = []) => {
      await conn.execute(sql, params);
    },
  };
}

async function openStore(): Promise<Database> {
  const staging = await invoke<string | null>("prepare_card_store");
  if (staging !== null) await startStore(staging);
  return Database.load("sqlite:card-cache.db");
}

/**
 * The user database's tables, children first so foreign keys never object.
 * Anything not listed here or kept by the store is swept up afterwards.
 */
const USER_TABLES = [
  "deck_cards",
  "deck_piles",
  "decks",
  "collection_items",
  "collections",
  "card_tags",
];
const STORE_TABLES = ["cards", "oracle_fetches"];

/**
 * Start the store from the cards `decklab.db` already holds, so nothing is
 * fetched twice. `VACUUM INTO` copies the whole file and only reads the
 * source; the copy then loses the user's tables and its migration records, so
 * the store's own migrations run on it as on a new database. It is opened
 * under the staging name, which has no migrations registered, and moved into
 * place only once clean.
 */
async function startStore(staging: string): Promise<void> {
  const real = (await labMode()) ? await Database.load("sqlite:decklab.db") : await db();
  try {
    await real.execute("VACUUM INTO $1", [staging]);
  } finally {
    if (await labMode()) await real.close();
  }

  const copy = await Database.load("sqlite:card-cache.staging.db");
  try {
    for (const table of USER_TABLES) await copy.execute(`DROP TABLE IF EXISTS ${table}`);
    const rest = await copy.select<{ name: string }[]>(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          AND name NOT IN (${STORE_TABLES.map((_, i) => `$${i + 1}`).join(", ")})`,
      STORE_TABLES,
    );
    for (const { name } of rest) await copy.execute(`DROP TABLE IF EXISTS "${name}"`);
  } finally {
    await copy.close();
  }
  await invoke("finish_card_store");
}

export async function select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conn = await db();
  return conn.select<T[]>(sql, params);
}

export async function execute(sql: string, params: unknown[] = []): Promise<void> {
  const conn = await db();
  await conn.execute(sql, params);
}

export function newId(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

/** Shape of a row from the `cards` table, before JSON columns are parsed. */
export interface CardRow {
  id: string;
  oracle_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  released_at: string | null;
  rarity: string;
  layout: string;
  mana_cost: string | null;
  cmc: number;
  type_line: string;
  oracle_text: string;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  colors: string;
  color_identity: string;
  keywords: string;
  legalities: string;
  prices: string;
  image_small: string | null;
  image_normal: string | null;
  image_art_crop: string | null;
  edhrec_rank: number | null;
  reserved: number;
  digital: number;
  data: string;
  cached_at: string;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function rowToCard(row: CardRow): Card {
  return {
    id: row.id,
    oracleId: row.oracle_id,
    name: row.name,
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
    releasedAt: row.released_at,
    rarity: row.rarity,
    layout: row.layout,
    manaCost: row.mana_cost,
    cmc: row.cmc ?? 0,
    typeLine: row.type_line ?? "",
    oracleText: row.oracle_text ?? "",
    power: row.power,
    toughness: row.toughness,
    loyalty: row.loyalty,
    colors: row.colors ?? "",
    colorIdentity: row.color_identity ?? "",
    keywords: parseJson<string[]>(row.keywords, []),
    legalities: parseJson<Record<string, string>>(row.legalities, {}),
    prices: parseJson(row.prices, {}),
    imageSmall: row.image_small,
    imageNormal: row.image_normal,
    imageArtCrop: row.image_art_crop,
    edhrecRank: row.edhrec_rank,
    reserved: !!row.reserved,
    digital: !!row.digital,
    data: parseJson<Record<string, unknown>>(row.data, {}),
  };
}

/** Columns selected wherever a full card is needed, aliased for `rowToCard`. */
export const CARD_COLUMNS = "c.*";
