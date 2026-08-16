import { CardRow, execute, newId, now, rowToCard, select } from "./db";
import { CATEGORY_ORDER, categoryOf } from "./deckstats";
import {
  canonicalColors,
  type Card,
  type Deck,
  type DeckEntry,
  type DeckPile,
  type DeckZone,
} from "./types";

interface DeckRow {
  id: string;
  name: string;
  format: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

function rowToDeck(row: DeckRow): Deck {
  return {
    id: row.id,
    name: row.name,
    format: row.format,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDecks(): Promise<Deck[]> {
  const rows = await select<DeckRow>("SELECT * FROM decks ORDER BY updated_at DESC");
  return rows.map(rowToDeck);
}

export async function getDeck(id: string): Promise<Deck | null> {
  const rows = await select<DeckRow>("SELECT * FROM decks WHERE id = $1", [id]);
  return rows.length ? rowToDeck(rows[0]) : null;
}

export async function createDeck(name: string, format = "commander"): Promise<Deck> {
  const deck: Deck = {
    id: newId(),
    name: name.trim() || "Untitled deck",
    format,
    notes: "",
    createdAt: now(),
    updatedAt: now(),
  };

  await execute(
    `INSERT INTO decks (id, name, format, notes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [deck.id, deck.name, deck.format, deck.notes, deck.createdAt, deck.updatedAt],
  );

  return deck;
}

export async function renameDeck(id: string, name: string): Promise<void> {
  await execute("UPDATE decks SET name = $1, updated_at = $2 WHERE id = $3", [
    name.trim() || "Untitled deck",
    now(),
    id,
  ]);
}

export async function setDeckNotes(id: string, notes: string): Promise<void> {
  await execute("UPDATE decks SET notes = $1, updated_at = $2 WHERE id = $3", [
    notes,
    now(),
    id,
  ]);
}

export async function deleteDeck(id: string): Promise<void> {
  // ON DELETE CASCADE only fires when foreign keys are enabled, which is not
  // guaranteed per-connection, so clear children explicitly.
  await execute("DELETE FROM deck_cards WHERE deck_id = $1", [id]);
  await execute("DELETE FROM decks WHERE id = $1", [id]);
}

type DeckCardRow = CardRow & {
  entry_id: string;
  deck_id: string;
  entry_quantity: number;
  zone: DeckZone;
  pile_id: string | null;
};

export async function deckEntries(deckId: string): Promise<DeckEntry[]> {
  const rows = await select<DeckCardRow>(
    `SELECT c.*,
            dc.id       AS entry_id,
            dc.deck_id  AS deck_id,
            dc.quantity AS entry_quantity,
            dc.zone     AS zone,
            dc.pile_id  AS pile_id
       FROM deck_cards dc
       JOIN cards c ON c.id = dc.card_id
      WHERE dc.deck_id = $1
      ORDER BY c.name`,
    [deckId],
  );

  return rows.map((row) => ({
    id: row.entry_id,
    deckId: row.deck_id,
    cardId: row.id,
    quantity: row.entry_quantity,
    zone: row.zone,
    pileId: row.pile_id,
    card: rowToCard(row),
  }));
}

async function touch(deckId: string): Promise<void> {
  await execute("UPDATE decks SET updated_at = $1 WHERE id = $2", [now(), deckId]);
}

/** Add copies of a card, folding into an existing row for the same zone. */
export async function addCardToDeck(
  deckId: string,
  card: Card,
  quantity = 1,
  zone: DeckZone = "main",
): Promise<void> {
  const existing = await select<{ id: string; quantity: number }>(
    "SELECT id, quantity FROM deck_cards WHERE deck_id = $1 AND card_id = $2 AND zone = $3",
    [deckId, card.id, zone],
  );

  if (existing.length) {
    await execute("UPDATE deck_cards SET quantity = $1 WHERE id = $2", [
      existing[0].quantity + quantity,
      existing[0].id,
    ]);
  } else {
    await execute(
      `INSERT INTO deck_cards (id, deck_id, card_id, quantity, zone, added_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [newId(), deckId, card.id, quantity, zone, now()],
    );
  }

  await touch(deckId);
}

/**
 * Move a printing's quantity in a deck by `delta`, returning the new count.
 *
 * Mirrors `adjustCollectionQuantity`: the carousel knows a card, not an entry
 * id, and reaching zero removes the row rather than leaving a 0× entry.
 */
export async function adjustDeckQuantity(
  deckId: string,
  card: Card,
  delta: number,
  zone: DeckZone = "main",
): Promise<number> {
  const existing = await select<{ id: string; quantity: number }>(
    "SELECT id, quantity FROM deck_cards WHERE deck_id = $1 AND card_id = $2 AND zone = $3",
    [deckId, card.id, zone],
  );

  const current = existing[0]?.quantity ?? 0;
  const next = Math.max(0, current + delta);
  if (next === current) return current;

  if (!existing.length) {
    await execute(
      `INSERT INTO deck_cards (id, deck_id, card_id, quantity, zone, added_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [newId(), deckId, card.id, next, zone, now()],
    );
  } else if (next === 0) {
    await execute("DELETE FROM deck_cards WHERE id = $1", [existing[0].id]);
  } else {
    await execute("UPDATE deck_cards SET quantity = $1 WHERE id = $2", [
      next,
      existing[0].id,
    ]);
  }

  await touch(deckId);
  return next;
}

/**
 * The combined colour identity of a deck's commander zone, or **null when the
 * zone is empty**.
 *
 * Null rather than an empty string because those mean opposite things: no
 * commander should impose no restriction, while a colourless commander restricts
 * to colourless only. Collapsing them would hide nearly every card.
 *
 * Needed because `entries` is only ever loaded for the deck on screen, and the
 * pool scopes itself by the *active* deck, which may not be the one displayed.
 */
export async function commanderIdentity(deckId: string): Promise<string | null> {
  const rows = await select<{ color_identity: string }>(
    `SELECT c.color_identity
       FROM deck_cards dc
       JOIN cards c ON c.id = dc.card_id
      WHERE dc.deck_id = $1 AND dc.zone = 'commander'`,
    [deckId],
  );
  if (!rows.length) return null;
  return canonicalColors(rows.flatMap((row) => [...row.color_identity]));
}

/** Copies of each printing of a card held in one deck, keyed by printing id. */
export async function printingQuantitiesInDeck(
  deckId: string,
  oracleId: string,
): Promise<Record<string, number>> {
  const rows = await select<{ card_id: string; quantity: number }>(
    `SELECT dc.card_id, SUM(dc.quantity) AS quantity
       FROM deck_cards dc
       JOIN cards c ON c.id = dc.card_id
      WHERE dc.deck_id = $1 AND c.oracle_id = $2
      GROUP BY dc.card_id`,
    [deckId, oracleId],
  );

  const byPrinting: Record<string, number> = {};
  for (const row of rows) byPrinting[row.card_id] = row.quantity;
  return byPrinting;
}

export async function setDeckCardQuantity(
  entryId: string,
  deckId: string,
  quantity: number,
): Promise<void> {
  if (quantity <= 0) {
    await execute("DELETE FROM deck_cards WHERE id = $1", [entryId]);
  } else {
    await execute("UPDATE deck_cards SET quantity = $1 WHERE id = $2", [
      quantity,
      entryId,
    ]);
  }
  await touch(deckId);
}

export async function removeDeckEntry(entryId: string, deckId: string): Promise<void> {
  await execute("DELETE FROM deck_cards WHERE id = $1", [entryId]);
  await touch(deckId);
}

export async function moveDeckEntry(
  entryId: string,
  deckId: string,
  zone: DeckZone,
): Promise<void> {
  await execute("UPDATE deck_cards SET zone = $1 WHERE id = $2", [zone, entryId]);
  await touch(deckId);
}

/* ---------- piles ---------- */

interface DeckPileRow {
  id: string;
  deck_id: string;
  name: string;
  position: number;
}

export async function listPiles(deckId: string): Promise<DeckPile[]> {
  const rows = await select<DeckPileRow>(
    "SELECT * FROM deck_piles WHERE deck_id = $1 ORDER BY position, name",
    [deckId],
  );
  return rows.map((row) => ({
    id: row.id,
    deckId: row.deck_id,
    name: row.name,
    position: row.position,
  }));
}

export async function createPile(deckId: string, name: string): Promise<DeckPile> {
  const rows = await select<{ next: number | null }>(
    "SELECT MAX(position) + 1 AS next FROM deck_piles WHERE deck_id = $1",
    [deckId],
  );
  const position = rows[0]?.next ?? 0;

  const pile: DeckPile = {
    id: newId(),
    deckId,
    name: name.trim() || "New pile",
    position,
  };

  await execute(
    "INSERT INTO deck_piles (id, deck_id, name, position) VALUES ($1, $2, $3, $4)",
    [pile.id, pile.deckId, pile.name, pile.position],
  );

  return pile;
}

export async function renamePile(pileId: string, name: string): Promise<void> {
  await execute("UPDATE deck_piles SET name = $1 WHERE id = $2", [
    name.trim() || "New pile",
    pileId,
  ]);
}

/** Delete a pile; its cards fall back to Unsorted rather than being removed. */
export async function deletePile(pileId: string, deckId: string): Promise<void> {
  await execute("UPDATE deck_cards SET pile_id = NULL WHERE pile_id = $1", [pileId]);
  await execute("DELETE FROM deck_piles WHERE id = $1", [pileId]);
  await touch(deckId);
}

export async function setEntryPile(
  entryId: string,
  deckId: string,
  pileId: string | null,
): Promise<void> {
  await execute("UPDATE deck_cards SET pile_id = $1 WHERE id = $2", [pileId, entryId]);
  await touch(deckId);
}

export async function reorderPiles(orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await execute("UPDATE deck_piles SET position = $1 WHERE id = $2", [
      i,
      orderedIds[i],
    ]);
  }
}

export type AutoArrange = "type" | "mv";

/**
 * Replace the current piles with an automatic arrangement.
 *
 * This is destructive to existing piles by design: it is offered as a starting
 * point ("give me type columns, then I'll rearrange"), not as a live grouping
 * mode, so hand-made piles are not silently reshuffled on every edit.
 */
export async function autoArrangePiles(
  deckId: string,
  mode: AutoArrange,
  entries: DeckEntry[],
): Promise<void> {
  const existing = await listPiles(deckId);
  for (const pile of existing) {
    await execute("UPDATE deck_cards SET pile_id = NULL WHERE pile_id = $1", [pile.id]);
    await execute("DELETE FROM deck_piles WHERE id = $1", [pile.id]);
  }

  const sorted = entries.filter((e) => e.zone === "main");

  const labelFor = (entry: DeckEntry): string =>
    mode === "type"
      ? categoryOf(entry.card)
      : categoryOf(entry.card) === "Land"
        ? "Lands"
        : `MV ${Math.min(7, Math.floor(entry.card.cmc))}${
            Math.floor(entry.card.cmc) >= 7 ? "+" : ""
          }`;

  // Build the column order first so piles read left-to-right in a sensible
  // order rather than in whatever order cards happen to appear.
  const labels = [...new Set(sorted.map(labelFor))].sort((a, b) => {
    if (mode === "type") {
      return (
        CATEGORY_ORDER.indexOf(a as (typeof CATEGORY_ORDER)[number]) -
        CATEGORY_ORDER.indexOf(b as (typeof CATEGORY_ORDER)[number])
      );
    }
    if (a === "Lands") return 1;
    if (b === "Lands") return -1;
    return Number.parseInt(a.slice(3), 10) - Number.parseInt(b.slice(3), 10);
  });

  const byLabel = new Map<string, string>();
  for (const label of labels) {
    const pile = await createPile(deckId, label);
    byLabel.set(label, pile.id);
  }

  for (const entry of sorted) {
    const pileId = byLabel.get(labelFor(entry));
    if (pileId) {
      await execute("UPDATE deck_cards SET pile_id = $1 WHERE id = $2", [
        pileId,
        entry.id,
      ]);
    }
  }

  await touch(deckId);
}

