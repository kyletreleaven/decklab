import { CardRow, execute, rowToCard, select } from "./db";
import type { Sql } from "./sql";
import type { Card } from "./types";

/** A card and when the store last had it from Scryfall. */
export interface Stamped {
  card: Card;
  cachedAt: string;
}

/** Column order shared by the upsert and its placeholder generator. */
const COLUMNS = [
  "id",
  "oracle_id",
  "name",
  "set_code",
  "set_name",
  "collector_number",
  "released_at",
  "rarity",
  "layout",
  "mana_cost",
  "cmc",
  "type_line",
  "oracle_text",
  "power",
  "toughness",
  "loyalty",
  "colors",
  "color_identity",
  "keywords",
  "legalities",
  "prices",
  "image_small",
  "image_normal",
  "image_art_crop",
  "edhrec_rank",
  "reserved",
  "digital",
  "data",
  "cached_at",
] as const;

function cardValues(card: Card, cachedAt: string): unknown[] {
  return [
    card.id,
    card.oracleId,
    card.name,
    card.setCode,
    card.setName,
    card.collectorNumber,
    card.releasedAt,
    card.rarity,
    card.layout,
    card.manaCost,
    card.cmc,
    card.typeLine,
    card.oracleText,
    card.power,
    card.toughness,
    card.loyalty,
    card.colors,
    card.colorIdentity,
    JSON.stringify(card.keywords),
    JSON.stringify(card.legalities),
    JSON.stringify(card.prices),
    card.imageSmall,
    card.imageNormal,
    card.imageArtCrop,
    card.edhrecRank,
    card.reserved ? 1 : 0,
    card.digital ? 1 : 0,
    JSON.stringify(card.data),
    cachedAt,
  ];
}

/**
 * Write cards into a `cards` table: the store's, or the user database's
 * working copy. Both have the same schema.
 *
 * Rows are batched into multi-row INSERTs because each `execute` is an IPC hop,
 * and a Scryfall page can carry 175 cards.
 */
export async function writeCards(sql: Sql, rows: Stamped[]): Promise<void> {
  const perRow = COLUMNS.length;
  // SQLite's default variable ceiling is 999; stay well under it.
  const batchSize = Math.floor(900 / perRow);

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const params: unknown[] = [];
    const tuples = batch.map(({ card, cachedAt }, row) => {
      params.push(...cardValues(card, cachedAt));
      const base = row * perRow;
      const holes = Array.from({ length: perRow }, (_, j) => `$${base + j + 1}`);
      return `(${holes.join(", ")})`;
    });

    await sql.execute(
      `INSERT OR REPLACE INTO cards (${COLUMNS.join(", ")}) VALUES ${tuples.join(", ")}`,
      params,
    );
  }
}

/**
 * Copy cards into the user database's working copy, stamps and all. Anything
 * the app shows passes through here, so user rows can always refer to it.
 */
export async function cacheCards(rows: Stamped[]): Promise<void> {
  await writeCards({ select, execute }, rows);
}

export async function getCard(id: string): Promise<Card | null> {
  const rows = await select<CardRow>("SELECT * FROM cards WHERE id = $1", [id]);
  return rows.length ? rowToCard(rows[0]) : null;
}

export async function getCards(ids: string[]): Promise<Card[]> {
  if (!ids.length) return [];
  const holes = ids.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await select<CardRow>(
    `SELECT * FROM cards WHERE id IN (${holes})`,
    ids,
  );
  return rows.map(rowToCard);
}

export async function cacheSize(): Promise<number> {
  const rows = await select<{ n: number }>("SELECT COUNT(*) AS n FROM cards");
  return rows[0]?.n ?? 0;
}

export async function allTags(): Promise<string[]> {
  const rows = await select<{ tag: string }>(
    "SELECT DISTINCT tag FROM card_tags ORDER BY tag",
  );
  return rows.map((r) => r.tag);
}

export async function addTag(oracleId: string, tag: string): Promise<void> {
  await execute(
    "INSERT OR IGNORE INTO card_tags (oracle_id, tag) VALUES ($1, $2)",
    [oracleId, tag.trim().toLowerCase()],
  );
}

export async function removeTag(oracleId: string, tag: string): Promise<void> {
  await execute("DELETE FROM card_tags WHERE oracle_id = $1 AND tag = $2", [
    oracleId,
    tag.trim().toLowerCase(),
  ]);
}

export async function tagsFor(oracleId: string): Promise<string[]> {
  const rows = await select<{ tag: string }>(
    "SELECT tag FROM card_tags WHERE oracle_id = $1 ORDER BY tag",
    [oracleId],
  );
  return rows.map((r) => r.tag);
}
