import Database from "@tauri-apps/plugin-sql";
import type { Card } from "./types";

/**
 * The SQLite file lives in the Tauri app data directory; the `sql:` plugin
 * resolves the bare filename against it. Migrations run on first load, so
 * everything below can assume the schema exists.
 */
let handle: Promise<Database> | null = null;

export function db(): Promise<Database> {
  handle ??= Database.load("sqlite:decklab.db");
  return handle;
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
