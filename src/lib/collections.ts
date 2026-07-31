import { CardRow, execute, newId, now, rowToCard, select } from "./db";
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
 * Items in a collection. `nameFilter` is a plain substring match on the card
 * name and runs entirely against the local cache — no network involved.
 */
export async function collectionItems(
  collectionId: string,
  nameFilter = "",
): Promise<CollectionItem[]> {
  const filter = nameFilter.trim();
  const params: unknown[] = [collectionId];
  let clause = "";

  if (filter) {
    // Escape LIKE wildcards so a literal % or _ in a card name behaves.
    const escaped = filter.replace(/[\\%_]/g, (m) => `\\${m}`);
    params.push(`%${escaped}%`);
    clause = ` AND c.name LIKE $2 ESCAPE '\\'`;
  }

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
      WHERE ci.collection_id = $1${clause}
      ORDER BY c.name`,
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

export interface OwnedCopy {
  collectionId: string;
  collectionName: string;
  setCode: string;
  setName: string;
  finish: string;
  quantity: number;
}

/**
 * Every copy of a card the user owns, across all collections and printings.
 * Keyed by oracle id so "2x Alpha, 1x Secret Lair, 4x M11" stays visible
 * rather than collapsing into a single number.
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
      WHERE c.oracle_id = $1
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
