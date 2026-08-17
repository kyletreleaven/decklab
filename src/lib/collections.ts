import { CardRow, execute, newId, now, rowToCard, select } from "./db";
import type { CardFilter } from "./filters";
import { compileQuery } from "./query";
import type { SortKey } from "./sort";

/**
 * A free-text query that could not be compiled — a syntax error, or a term we
 * do not support locally such as `is:`.
 *
 * Thrown rather than returned empty so a caller can keep the previous results
 * on screen and show a hint, instead of appearing to match nothing.
 */
export class QueryError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
    this.name = "QueryError";
  }
}
import type {
  Card,
  Collection,
  CollectionItem,
  CollectionKind,
  OwnershipRow,
} from "./types";

interface CollectionRow {
  id: string;
  name: string;
  kind: CollectionKind;
  notes: string;
  created_at: string;
  updated_at: string;
}

function rowToCollection(row: CollectionRow): Collection {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * All Magic — every card that exists, backed by Scryfall rather than a row in
 * `collections`. Its id is a constant because it is synthetic: nothing creates
 * or deletes it, and it must be recognisable wherever a collection id is passed
 * around. Namespaced so it can never collide with a generated one.
 */
export const UNIVERSE_ID = "decklab:universe";

export const UNIVERSE_NAME = "All Magic (Scryfall)";

export const COLLECTION_KINDS: { value: CollectionKind; label: string }[] = [
  { value: "paper", label: "Paper" },
  { value: "arena", label: "Arena" },
  { value: "mtgo", label: "MTGO" },
  { value: "cube", label: "Cube" },
  { value: "loaned", label: "Loaned out" },
  { value: "wishlist", label: "Wishlist" },
];

export async function listCollections(): Promise<Collection[]> {
  const rows = await select<CollectionRow>(
    "SELECT * FROM collections ORDER BY name",
  );
  return rows.map(rowToCollection);
}

export async function createCollection(
  name: string,
  kind: CollectionKind = "paper",
): Promise<Collection> {
  const collection: Collection = {
    id: newId(),
    name: name.trim() || "Untitled collection",
    kind,
    notes: "",
    createdAt: now(),
    updatedAt: now(),
  };

  await execute(
    `INSERT INTO collections (id, name, kind, notes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      collection.id,
      collection.name,
      collection.kind,
      collection.notes,
      collection.createdAt,
      collection.updatedAt,
    ],
  );

  return collection;
}

export async function renameCollection(id: string, name: string): Promise<void> {
  await execute("UPDATE collections SET name = $1, updated_at = $2 WHERE id = $3", [
    name.trim() || "Untitled collection",
    now(),
    id,
  ]);
}

export async function deleteCollection(id: string): Promise<void> {
  await execute("DELETE FROM collection_items WHERE collection_id = $1", [id]);
  await execute("DELETE FROM collections WHERE id = $1", [id]);
}

type CollectionItemRow = CardRow & {
  item_id: string;
  collection_id: string;
  item_quantity: number;
  finish: string;
  condition: string;
  item_notes: string;
};

/**
 * Collections share the filter model with the deck-builder pool, so the same
 * facet selection can drive either a local query or a Scryfall search.
 * See `filters.ts`.
 */
export type CollectionFilter = CardFilter;

/** Kept as an alias so existing call sites read naturally. */
export type CollectionSort = SortKey;

const SORT_SQL: Record<CollectionSort, string> = {
  name: "c.name",
  mv: "c.cmc, c.name",
  quantity: "ci.quantity DESC, c.name",
  value: "CAST(json_extract(c.prices, '$.usd') AS REAL) DESC NULLS LAST, c.name",
};

/**
 * Items in a collection, filtered and sorted.
 *
 * Every predicate is pushed into SQL rather than filtered in JS: a paper
 * collection can run to tens of thousands of rows, and this keeps the work in
 * the index rather than shipping the whole table over the IPC bridge. All of it
 * runs against the local cache — no network involved.
 */
export async function collectionItems(
  collectionId: string,
  filter: CollectionFilter = {},
  sort: CollectionSort = "name",
): Promise<CollectionItem[]> {
  const params: unknown[] = [collectionId];
  const clauses: string[] = [];
  const hole = () => `$${params.length}`;

  // Free text is a full query, not a name match — the same syntax that works
  // against All Magic. Compiled here rather than passed through, since Scryfall
  // is not involved for a local collection.
  const query = filter.query?.trim();
  if (query) {
    const compiled = compileQuery(query, { alias: "c", paramOffset: params.length });
    if (compiled.error) {
      throw new QueryError(compiled.error.message, compiled.error.at);
    }
    if (compiled.sql) {
      params.push(...compiled.params);
      clauses.push(compiled.sql);
    }
  }

  if (filter.colors?.length) {
    const parts: string[] = [];
    for (const color of filter.colors) {
      if (color === "C") {
        parts.push(`c.color_identity = ''`);
      } else {
        params.push(`%${color}%`);
        parts.push(`c.color_identity LIKE ${hole()}`);
      }
    }
    clauses.push(`(${parts.join(" OR ")})`);
  }

  if (filter.types?.length) {
    const parts = filter.types.map((type) => {
      params.push(`%${type}%`);
      return `c.type_line LIKE ${hole()}`;
    });
    clauses.push(`(${parts.join(" OR ")})`);
  }

  if (filter.rarities?.length) {
    const parts = filter.rarities.map((rarity) => {
      params.push(rarity);
      return hole();
    });
    clauses.push(`c.rarity IN (${parts.join(", ")})`);
  }

  if (typeof filter.mvMin === "number") {
    params.push(filter.mvMin);
    clauses.push(`c.cmc >= ${hole()}`);
  }

  if (typeof filter.mvMax === "number") {
    params.push(filter.mvMax);
    clauses.push(`c.cmc <= ${hole()}`);
  }

  if (filter.withinIdentity !== undefined) {
    // Subset test: the card's identity may not contain any colour outside the
    // allowed set. Expressed as the absence of each disallowed letter, which is
    // five cheap comparisons rather than a set operation SQLite lacks.
    const allowed = new Set(filter.withinIdentity.toUpperCase());
    for (const color of ["W", "U", "B", "R", "G"]) {
      if (!allowed.has(color)) {
        params.push(`%${color}%`);
        clauses.push(`c.color_identity NOT LIKE ${hole()}`);
      }
    }
  }

  if (filter.legalIn) {
    params.push(filter.legalIn);
    clauses.push(`json_extract(c.legalities, '$.' || ${hole()}) IN ('legal', 'restricted')`);
  }

  const where = clauses.length ? ` AND ${clauses.join(" AND ")}` : "";

  const rows = await select<CollectionItemRow>(
    `SELECT c.*,
            ci.id            AS item_id,
            ci.collection_id AS collection_id,
            ci.quantity      AS item_quantity,
            ci.finish        AS finish,
            ci.condition     AS condition,
            ci.notes         AS item_notes
       FROM collection_items ci
       JOIN cards c ON c.id = ci.card_id
      WHERE ci.collection_id = $1${where}
      ORDER BY ${SORT_SQL[sort]}`,
    params,
  );

  return rows.map((row) => ({
    id: row.item_id,
    collectionId: row.collection_id,
    cardId: row.id,
    quantity: row.item_quantity,
    finish: row.finish,
    condition: row.condition,
    notes: row.item_notes,
    card: rowToCard(row),
  }));
}

export async function addCardToCollection(
  collectionId: string,
  card: Card,
  quantity = 1,
  finish = "nonfoil",
  condition = "NM",
): Promise<void> {
  const existing = await select<{ id: string; quantity: number }>(
    `SELECT id, quantity FROM collection_items
      WHERE collection_id = $1 AND card_id = $2 AND finish = $3 AND condition = $4`,
    [collectionId, card.id, finish, condition],
  );

  if (existing.length) {
    await execute("UPDATE collection_items SET quantity = $1 WHERE id = $2", [
      existing[0].quantity + quantity,
      existing[0].id,
    ]);
  } else {
    await execute(
      `INSERT INTO collection_items
         (id, collection_id, card_id, quantity, finish, condition, notes, added_at)
       VALUES ($1, $2, $3, $4, $5, $6, '', $7)`,
      [newId(), collectionId, card.id, quantity, finish, condition, now()],
    );
  }

  await execute("UPDATE collections SET updated_at = $1 WHERE id = $2", [
    now(),
    collectionId,
  ]);
}

/**
 * Move a printing's quantity in a collection by `delta`, returning the new
 * count.
 *
 * The carousel needs this because it knows a *card*, not a collection-item id —
 * and `addCardToCollection` can only ever add. Reaching zero deletes the row
 * rather than leaving a 0× entry behind.
 */
export async function adjustCollectionQuantity(
  collectionId: string,
  card: Card,
  delta: number,
  finish = "nonfoil",
  condition = "NM",
): Promise<number> {
  const existing = await select<{ id: string; quantity: number }>(
    `SELECT id, quantity FROM collection_items
      WHERE collection_id = $1 AND card_id = $2 AND finish = $3 AND condition = $4`,
    [collectionId, card.id, finish, condition],
  );

  const current = existing[0]?.quantity ?? 0;
  const next = Math.max(0, current + delta);

  if (next === current) return current;

  if (!existing.length) {
    await execute(
      `INSERT INTO collection_items
         (id, collection_id, card_id, quantity, finish, condition, notes, added_at)
       VALUES ($1, $2, $3, $4, $5, $6, '', $7)`,
      [newId(), collectionId, card.id, next, finish, condition, now()],
    );
  } else if (next === 0) {
    await execute("DELETE FROM collection_items WHERE id = $1", [existing[0].id]);
  } else {
    await execute("UPDATE collection_items SET quantity = $1 WHERE id = $2", [
      next,
      existing[0].id,
    ]);
  }

  await execute("UPDATE collections SET updated_at = $1 WHERE id = $2", [
    now(),
    collectionId,
  ]);

  return next;
}

export async function setCollectionItemQuantity(
  itemId: string,
  quantity: number,
): Promise<void> {
  if (quantity <= 0) {
    await execute("DELETE FROM collection_items WHERE id = $1", [itemId]);
  } else {
    await execute("UPDATE collection_items SET quantity = $1 WHERE id = $2", [
      quantity,
      itemId,
    ]);
  }
}

export async function removeCollectionItem(itemId: string): Promise<void> {
  await execute("DELETE FROM collection_items WHERE id = $1", [itemId]);
}

/**
 * Collection kinds that count as cards you actually have available.
 *
 * A wishlist is by definition what you do *not* own, and cards loaned out are
 * owned but unavailable, so counting either as "playable" is simply wrong.
 * Digital kinds stay in for now — separating paper from Arena/MTGO needs a
 * notion of a deck's game that does not exist yet.
 *
 * This is the interim answer. The real one is selection-as-scope; see TODO.md.
 */
export const OWNABLE_KINDS: CollectionKind[] = ["paper", "arena", "mtgo", "cube"];

/** SQL fragment restricting to ownable collections. No user input involved. */
function ownableClause(alias: string): string {
  return `${alias}.kind IN (${OWNABLE_KINDS.map((k) => `'${k}'`).join(", ")})`;
}

/**
 * Oracle ids of every card present in the given collections, or in all *ownable*
 * collections when none are named.
 *
 * Keyed by oracle id so any printing counts as "collected", and returned as a
 * Set because the caller checks it once per rendered card. Even a large paper
 * collection is only a few thousand ids, so this is cheap to hold in memory.
 */
export async function collectionOracleIds(
  collectionIds?: string[],
): Promise<Set<string>> {
  const scoped = !!collectionIds?.length;
  const holes = scoped
    ? collectionIds!.map((_, i) => `$${i + 1}`).join(", ")
    : "";

  const rows = await select<{ oracle_id: string }>(
    `SELECT DISTINCT c.oracle_id
       FROM collection_items ci
       JOIN cards c         ON c.id = ci.card_id
       JOIN collections col ON col.id = ci.collection_id
      WHERE ${scoped ? `ci.collection_id IN (${holes})` : ownableClause("col")}`,
    scoped ? collectionIds! : [],
  );

  return new Set(rows.map((r) => r.oracle_id));
}

/**
 * Copies held of each *printing* of a card, across ownable collections.
 * Keyed by printing id, for the carousel's per-printing badges.
 *
 * Finishes and conditions are summed together — the badge answers "how many of
 * this printing do I have", and the finish breakdown lives elsewhere.
 */
export async function collectionCountsByPrinting(
  oracleId: string,
): Promise<Record<string, number>> {
  const rows = await select<{ card_id: string; quantity: number }>(
    `SELECT ci.card_id, SUM(ci.quantity) AS quantity
       FROM collection_items ci
       JOIN cards c         ON c.id = ci.card_id
       JOIN collections col ON col.id = ci.collection_id
      WHERE c.oracle_id = $1 AND ${ownableClause("col")}
      GROUP BY ci.card_id`,
    [oracleId],
  );

  const byPrinting: Record<string, number> = {};
  for (const row of rows) byPrinting[row.card_id] = row.quantity;
  return byPrinting;
}

/** Every printing the collection holds, keyed by printing id. One query. */
export async function collectionQuantitiesByPrinting(
  collectionId: string,
): Promise<Record<string, number>> {
  const rows = await select<{ card_id: string; quantity: number }>(
    `SELECT card_id, SUM(quantity) AS quantity
       FROM collection_items WHERE collection_id = $1 GROUP BY card_id`,
    [collectionId],
  );
  const byPrinting: Record<string, number> = {};
  for (const row of rows) byPrinting[row.card_id] = row.quantity;
  return byPrinting;
}

/** Copies of each printing of a card held in one collection, by printing id. */
export async function printingQuantitiesInCollection(
  collectionId: string,
  oracleId: string,
): Promise<Record<string, number>> {
  const rows = await select<{ card_id: string; quantity: number }>(
    `SELECT ci.card_id, SUM(ci.quantity) AS quantity
       FROM collection_items ci
       JOIN cards c ON c.id = ci.card_id
      WHERE ci.collection_id = $1 AND c.oracle_id = $2
      GROUP BY ci.card_id`,
    [collectionId, oracleId],
  );

  const byPrinting: Record<string, number> = {};
  for (const row of rows) byPrinting[row.card_id] = row.quantity;
  return byPrinting;
}

export interface OwnedCopy {
  collectionId: string;
  collectionName: string;
  setCode: string;
  setName: string;
  finish: string;
  quantity: number;
}

/**
 * Every copy of a card actually available, across ownable collections and every
 * printing. Keyed by oracle id so "2x Alpha, 1x Secret Lair, 4x M11" stays
 * visible rather than collapsing into a single number.
 *
 * Wishlist and loaned-out collections are excluded — see `OWNABLE_KINDS`.
 */
export async function ownedCopies(oracleId: string): Promise<OwnedCopy[]> {
  const rows = await select<{
    collection_id: string;
    collection_name: string;
    set_code: string;
    set_name: string;
    finish: string;
    quantity: number;
  }>(
    `SELECT ci.collection_id,
            col.name AS collection_name,
            c.set_code,
            c.set_name,
            ci.finish,
            SUM(ci.quantity) AS quantity
       FROM collection_items ci
       JOIN cards c        ON c.id = ci.card_id
       JOIN collections col ON col.id = ci.collection_id
      WHERE c.oracle_id = $1 AND ${ownableClause("col")}
      GROUP BY ci.collection_id, col.name, c.set_code, c.set_name, ci.finish
      ORDER BY col.name, c.released_at DESC`,
    [oracleId],
  );

  return rows.map((r) => ({
    collectionId: r.collection_id,
    collectionName: r.collection_name,
    setCode: r.set_code,
    setName: r.set_name,
    finish: r.finish,
    quantity: r.quantity,
  }));
}

/**
 * Resolve a deck against one or more collections.
 *
 * `exact` counts the specific printing the deck references; `playable` counts
 * every printing sharing an oracle id, which is what actually matters when you
 * sit down to play. Both are reported so the user can decide whether printings
 * matter to them.
 */
export async function deckOwnership(
  deckId: string,
  collectionIds: string[],
): Promise<OwnershipRow[]> {
  const entries = await select<{
    card_id: string;
    oracle_id: string;
    name: string;
    required: number;
  }>(
    `SELECT dc.card_id, c.oracle_id, c.name, SUM(dc.quantity) AS required
       FROM deck_cards dc
       JOIN cards c ON c.id = dc.card_id
      WHERE dc.deck_id = $1 AND dc.zone IN ('main', 'commander')
      GROUP BY dc.card_id, c.oracle_id, c.name
      ORDER BY c.name`,
    [deckId],
  );

  if (!entries.length || !collectionIds.length) {
    return entries.map((e) => ({
      cardId: e.card_id,
      name: e.name,
      required: e.required,
      exact: 0,
      playable: 0,
      printings: [],
    }));
  }

  // One pass over the selected collections, grouped by oracle id, rather than
  // a query per deck slot.
  const holes = collectionIds.map((_, i) => `$${i + 1}`).join(", ");
  const owned = await select<{
    oracle_id: string;
    card_id: string;
    set_code: string;
    set_name: string;
    quantity: number;
  }>(
    `SELECT c.oracle_id, c.id AS card_id, c.set_code, c.set_name,
            SUM(ci.quantity) AS quantity
       FROM collection_items ci
       JOIN cards c ON c.id = ci.card_id
      WHERE ci.collection_id IN (${holes})
      GROUP BY c.oracle_id, c.id, c.set_code, c.set_name`,
    collectionIds,
  );

  const byOracle = new Map<string, typeof owned>();
  for (const row of owned) {
    const bucket = byOracle.get(row.oracle_id);
    if (bucket) bucket.push(row);
    else byOracle.set(row.oracle_id, [row]);
  }

  return entries.map((entry) => {
    const rows = byOracle.get(entry.oracle_id) ?? [];
    const playable = rows.reduce((sum, r) => sum + r.quantity, 0);
    const exact = rows
      .filter((r) => r.card_id === entry.card_id)
      .reduce((sum, r) => sum + r.quantity, 0);

    return {
      cardId: entry.card_id,
      name: entry.name,
      required: entry.required,
      exact,
      playable,
      printings: rows
        .map((r) => ({
          setCode: r.set_code,
          setName: r.set_name,
          quantity: r.quantity,
        }))
        .sort((a, b) => b.quantity - a.quantity),
    };
  });
}
