import { resolveIdentifiers, type Identifier } from "../scryfall";
import type { Sql } from "../sql";
import type { Card } from "../types";
import {
  LibraryFormatError,
  printingKey,
  printingsOf,
  type V4Collection,
  type V4Deck,
  type V4Library,
  type V4Printing,
  type V4Zone,
} from "./v4";

/**
 * Reading and writing a schema-4 database as a `V4Library`.
 *
 * Takes its SQL as a parameter rather than importing `db.ts`, so the round trip
 * can be tested against a real SQLite file outside the app.
 */
export type { Sql };

const ZONES: readonly string[] = ["commander", "main", "side", "maybe"];

/** The printing columns every card-bearing read joins in from the cache. */
const PRINTING = `
  c.name AS card_name, c.set_code, c.collector_number,
  COALESCE(json_extract(c.data, '$.lang'), 'en') AS lang`;

interface PrintingRow {
  card_id: string;
  card_name: string | null;
  set_code: string;
  collector_number: string;
  lang: string;
}

function printingOf(row: PrintingRow): V4Printing {
  return {
    name: row.card_name!,
    set: row.set_code,
    number: row.collector_number,
    lang: row.lang,
  };
}

/** Lossless or nothing: a row the file cannot carry stops the dump. */
function refuse(problems: string[]): void {
  if (!problems.length) return;
  const shown = problems.slice(0, 10).join("\n");
  const more = problems.length > 10 ? `\n…and ${problems.length - 10} more` : "";
  throw new LibraryFormatError(`Cannot dump this library:\n${shown}${more}`);
}

export async function readV4(sql: Sql): Promise<V4Library> {
  const problems: string[] = [];

  const collectionRows = await sql.select<{
    id: string;
    name: string;
    kind: string;
    quantity_kind: string;
    notes: string;
    created_at: string;
    updated_at: string;
  }>("SELECT * FROM collections");

  const itemRows = await sql.select<
    PrintingRow & {
      collection_id: string;
      quantity: number;
      finish: string;
      condition: string;
      notes: string;
      added_at: string;
    }
  >(
    `SELECT i.collection_id, i.card_id, i.quantity, i.finish, i.condition,
            i.notes, i.added_at, ${PRINTING}
       FROM collection_items i LEFT JOIN cards c ON c.id = i.card_id`,
  );

  const collections = new Map<string, V4Collection>();
  for (const row of collectionRows) {
    collections.set(row.id, {
      name: row.name,
      kind: row.kind,
      quantityKind: row.quantity_kind,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items: [],
    });
  }
  for (const row of itemRows) {
    const collection = collections.get(row.collection_id);
    if (!collection) {
      problems.push(`an item belongs to missing collection ${row.collection_id}`);
      continue;
    }
    if (row.card_name === null) {
      problems.push(`"${collection.name}" holds card ${row.card_id}, which is not in the cache`);
      continue;
    }
    collection.items.push({
      ...printingOf(row),
      quantity: row.quantity,
      finish: row.finish,
      condition: row.condition,
      notes: row.notes,
      addedAt: row.added_at,
    });
  }

  const deckRows = await sql.select<{
    id: string;
    name: string;
    format: string;
    notes: string;
    created_at: string;
    updated_at: string;
  }>("SELECT * FROM decks");

  const pileRows = await sql.select<{
    id: string;
    deck_id: string;
    name: string;
    position: number;
  }>("SELECT * FROM deck_piles");

  const cardRows = await sql.select<
    PrintingRow & {
      deck_id: string;
      quantity: number;
      zone: string;
      pile_id: string | null;
      added_at: string;
    }
  >(
    `SELECT d.deck_id, d.card_id, d.quantity, d.zone, d.pile_id, d.added_at,
            ${PRINTING}
       FROM deck_cards d LEFT JOIN cards c ON c.id = d.card_id`,
  );

  const decks = new Map<string, V4Deck>();
  for (const row of deckRows) {
    decks.set(row.id, {
      name: row.name,
      format: row.format,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      piles: [],
      cards: [],
    });
  }

  const pileNames = new Map<string, { deckId: string; name: string }>();
  for (const row of pileRows) {
    const deck = decks.get(row.deck_id);
    if (!deck) {
      problems.push(`pile "${row.name}" belongs to missing deck ${row.deck_id}`);
      continue;
    }
    deck.piles.push({ name: row.name, position: row.position });
    pileNames.set(row.id, { deckId: row.deck_id, name: row.name });
  }

  for (const row of cardRows) {
    const deck = decks.get(row.deck_id);
    if (!deck) {
      problems.push(`a deck card belongs to missing deck ${row.deck_id}`);
      continue;
    }
    if (row.card_name === null) {
      problems.push(`"${deck.name}" holds card ${row.card_id}, which is not in the cache`);
      continue;
    }
    if (!ZONES.includes(row.zone)) {
      problems.push(`"${deck.name}" has a card in unknown zone "${row.zone}"`);
      continue;
    }
    let pile: string | null = null;
    if (row.pile_id !== null) {
      const found = pileNames.get(row.pile_id);
      if (!found || found.deckId !== row.deck_id) {
        problems.push(`"${deck.name}" has a card in missing pile ${row.pile_id}`);
        continue;
      }
      pile = found.name;
    }
    deck.cards.push({
      ...printingOf(row),
      quantity: row.quantity,
      zone: row.zone as V4Zone,
      pile,
      addedAt: row.added_at,
    });
  }

  const tags = await sql.select<{ oracle_id: string; tag: string }>(
    "SELECT oracle_id, tag FROM card_tags",
  );

  refuse(problems);
  return {
    collections: [...collections.values()],
    decks: [...decks.values()],
    tags: tags.map((t) => ({ oracleId: t.oracle_id, tag: t.tag })),
  };
}

/* ---------- write ---------- */

export interface WriteOptions {
  /** Fetch printings the cache lacks. Defaults to Scryfall, via the scheduler. */
  fetchPrintings?: (identifiers: Identifier[]) => Promise<{ found: Card[] }>;
}

export interface WriteSummary {
  collections: number;
  items: number;
  decks: number;
  deckCards: number;
  piles: number;
  tags: number;
  fetched: number;
}

const USER_TABLES = [
  "collections",
  "collection_items",
  "decks",
  "deck_cards",
  "deck_piles",
  "card_tags",
];

export async function isEmpty(sql: Sql): Promise<boolean> {
  const counts = USER_TABLES.map((t) => `(SELECT COUNT(*) FROM ${t})`).join(" + ");
  const rows = await sql.select<{ n: number }>(`SELECT ${counts} AS n`);
  return rows[0].n === 0;
}

/** Normalised for matching: case and surrounding space vary in hand-written files. */
const fold = (name: string) => name.trim().toLowerCase();

/**
 * Whether a line's name fits the printing it resolved to. A hand-written line
 * may name only the front face of a double-faced card.
 */
function nameFits(lineName: string, cardName: string): boolean {
  const line = fold(lineName);
  const card = fold(cardName);
  return line === card || line === card.split("//")[0].trim();
}

interface CachedPrinting {
  id: string;
  name: string;
  set_code: string;
  collector_number: string;
  lang: string;
}

const LOOKUP_CHUNK = 400;

/**
 * The card id for every printing the library names: from the cache, else
 * fetched. Checks each line's name against the printing it found.
 */
async function resolvePrintings(
  sql: Sql,
  lib: V4Library,
  fetchPrintings: NonNullable<WriteOptions["fetchPrintings"]>,
): Promise<{ ids: Map<string, string>; fetched: number }> {
  const wanted = printingsOf(lib);
  const ids = new Map<string, string>();
  const names = new Map<string, string>();

  for (let start = 0; start < wanted.length; start += LOOKUP_CHUNK) {
    const chunk = wanted.slice(start, start + LOOKUP_CHUNK);
    const holes = chunk.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await sql.select<CachedPrinting>(
      `SELECT id, name, set_code, collector_number,
              COALESCE(json_extract(data, '$.lang'), 'en') AS lang
         FROM cards
        WHERE set_code || '|' || collector_number IN (${holes})`,
      chunk.map((p) => `${p.set}|${p.number}`),
    );
    for (const row of rows) {
      const key = `${row.set_code}|${row.collector_number}|${row.lang}`;
      ids.set(key, row.id);
      names.set(key, row.name);
    }
  }

  const missing = wanted.filter((p) => !ids.has(printingKey(p)));
  const foreign = missing.filter((p) => p.lang !== "en");
  if (foreign.length) {
    throw new LibraryFormatError(
      `Not in the cache, and only English printings can be fetched yet:\n` +
        foreign.map((p) => `${p.name} (${p.set}) ${p.number} [${p.lang}]`).join("\n"),
    );
  }

  let fetched = 0;
  if (missing.length) {
    const { found } = await fetchPrintings(
      missing.map((p) => ({ set: p.set, collector_number: p.number })),
    );
    for (const card of found) {
      const key = `${card.setCode}|${card.collectorNumber}|en`;
      ids.set(key, card.id);
      names.set(key, card.name);
      fetched++;
    }
  }

  const problems: string[] = [];
  for (const p of wanted) {
    const key = printingKey(p);
    const name = names.get(key);
    if (name === undefined) {
      problems.push(`${p.name} (${p.set}) ${p.number}: no such printing`);
    } else if (!nameFits(p.name, name)) {
      problems.push(`${p.name} (${p.set}) ${p.number}: that printing is ${name}`);
    }
  }
  if (problems.length) {
    const shown = problems.slice(0, 10).join("\n");
    const more = problems.length > 10 ? `\n…and ${problems.length - 10} more` : "";
    throw new LibraryFormatError(`Some cards do not match their printing:\n${shown}${more}`);
  }

  return { ids, fetched };
}

/** Multi-row INSERTs, chunked under SQLite's variable limit. */
async function insertRows(
  sql: Sql,
  table: string,
  columns: string[],
  rows: unknown[][],
): Promise<void> {
  const perChunk = Math.floor(900 / columns.length);
  for (let start = 0; start < rows.length; start += perChunk) {
    const chunk = rows.slice(start, start + perChunk);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const base = params.length;
      params.push(...row);
      return `(${row.map((_, j) => `$${base + j + 1}`).join(", ")})`;
    });
    await sql.execute(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}`,
      params,
    );
  }
}

/**
 * Write a library into an **empty** database.
 *
 * Everything that could fail — an unknown printing, a name that does not fit —
 * is checked before the first write, because the SQL plugin cannot hold a
 * transaction across calls. What remains are plain inserts of rows already
 * known to be valid.
 */
export async function writeV4(
  sql: Sql,
  lib: V4Library,
  options: WriteOptions = {},
): Promise<WriteSummary> {
  if (!(await isEmpty(sql))) {
    throw new LibraryFormatError(
      "This database already holds collections or decks. A library loads only into an empty one.",
    );
  }

  const { ids, fetched } = await resolvePrintings(
    sql,
    lib,
    options.fetchPrintings ?? resolveIdentifiers,
  );
  const cardId = (p: V4Printing) => ids.get(printingKey(p))!;
  const newId = () => crypto.randomUUID();

  const collections: unknown[][] = [];
  const items: unknown[][] = [];
  for (const c of lib.collections) {
    const id = newId();
    collections.push([id, c.name, c.kind, c.quantityKind, c.notes, c.createdAt, c.updatedAt]);
    for (const item of c.items) {
      items.push([
        newId(), id, cardId(item), item.quantity, item.finish, item.condition, item.notes, item.addedAt,
      ]);
    }
  }

  const decks: unknown[][] = [];
  const piles: unknown[][] = [];
  const deckCards: unknown[][] = [];
  for (const d of lib.decks) {
    const id = newId();
    decks.push([id, d.name, d.format, d.notes, d.createdAt, d.updatedAt]);
    const pileIds = new Map<string, string>();
    for (const pile of d.piles) {
      const pileId = newId();
      pileIds.set(pile.name, pileId);
      piles.push([pileId, id, pile.name, pile.position]);
    }
    for (const card of d.cards) {
      deckCards.push([
        newId(),
        id,
        cardId(card),
        card.quantity,
        card.zone,
        card.pile === null ? null : pileIds.get(card.pile)!,
        card.addedAt,
      ]);
    }
  }

  await insertRows(
    sql,
    "collections",
    ["id", "name", "kind", "quantity_kind", "notes", "created_at", "updated_at"],
    collections,
  );
  await insertRows(
    sql,
    "collection_items",
    ["id", "collection_id", "card_id", "quantity", "finish", "condition", "notes", "added_at"],
    items,
  );
  await insertRows(
    sql,
    "decks",
    ["id", "name", "format", "notes", "created_at", "updated_at"],
    decks,
  );
  await insertRows(sql, "deck_piles", ["id", "deck_id", "name", "position"], piles);
  await insertRows(
    sql,
    "deck_cards",
    ["id", "deck_id", "card_id", "quantity", "zone", "pile_id", "added_at"],
    deckCards,
  );
  await insertRows(
    sql,
    "card_tags",
    ["oracle_id", "tag"],
    lib.tags.map((t) => [t.oracleId, t.tag]),
  );

  return {
    collections: collections.length,
    items: items.length,
    decks: decks.length,
    deckCards: deckCards.length,
    piles: piles.length,
    tags: lib.tags.length,
    fetched,
  };
}
