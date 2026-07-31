import { CardRow, execute, newId, now, rowToCard, select } from "./db";
import type { Card, Deck, DeckEntry, DeckZone } from "./types";

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
};

export async function deckEntries(deckId: string): Promise<DeckEntry[]> {
  const rows = await select<DeckCardRow>(
    `SELECT c.*,
            dc.id       AS entry_id,
            dc.deck_id  AS deck_id,
            dc.quantity AS entry_quantity,
            dc.zone     AS zone
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

/** Broad card categories, in the order a decklist usually reads. */
export const CATEGORY_ORDER = [
  "Creature",
  "Planeswalker",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Battle",
  "Land",
  "Other",
] as const;

export function categoryOf(card: Card): string {
  const type = card.typeLine;
  // Order matters: an "Artifact Creature" reads as a creature, and a
  // "Land Creature" is still played as a land.
  if (/\bLand\b/.test(type)) return "Land";
  if (/\bCreature\b/.test(type)) return "Creature";
  if (/\bPlaneswalker\b/.test(type)) return "Planeswalker";
  if (/\bInstant\b/.test(type)) return "Instant";
  if (/\bSorcery\b/.test(type)) return "Sorcery";
  if (/\bBattle\b/.test(type)) return "Battle";
  if (/\bArtifact\b/.test(type)) return "Artifact";
  if (/\bEnchantment\b/.test(type)) return "Enchantment";
  return "Other";
}

export interface DeckStats {
  /** Cards in the 99 (main zone), counting quantities. */
  mainCount: number;
  commanderCount: number;
  totalCount: number;
  averageMv: number;
  /** Mana value -> number of non-land cards at that value; 7 is "7+". */
  curve: { mv: number; count: number }[];
  /** Colour letter -> number of mana pips across the deck. */
  pips: Record<string, number>;
  colorIdentity: string;
  categories: { category: string; count: number }[];
  estimatedUsd: number;
}

const PIP_PATTERN = /\{([^}]+)\}/g;

function countPips(manaCost: string | null, into: Record<string, number>): void {
  if (!manaCost) return;
  for (const [, symbol] of manaCost.matchAll(PIP_PATTERN)) {
    for (const color of ["W", "U", "B", "R", "G"]) {
      // Hybrid and Phyrexian symbols ({W/U}, {U/P}) count toward each colour
      // they can be paid with.
      if (symbol.includes(color)) into[color] = (into[color] ?? 0) + 1;
    }
  }
}

export function deckStats(entries: DeckEntry[]): DeckStats {
  const counted = entries.filter((e) => e.zone === "main" || e.zone === "commander");

  let mainCount = 0;
  let commanderCount = 0;
  let mvTotal = 0;
  let mvCards = 0;
  let estimatedUsd = 0;

  const curveBuckets = new Map<number, number>();
  const pips: Record<string, number> = {};
  const categoryCounts = new Map<string, number>();
  const identity = new Set<string>();

  for (const entry of counted) {
    const { card, quantity } = entry;

    if (entry.zone === "commander") commanderCount += quantity;
    else mainCount += quantity;

    for (const color of card.colorIdentity) identity.add(color);

    const category = categoryOf(card);
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + quantity);

    for (let i = 0; i < quantity; i++) countPips(card.manaCost, pips);

    const price = Number.parseFloat(card.prices.usd ?? "");
    if (Number.isFinite(price)) estimatedUsd += price * quantity;

    // Lands have no meaningful mana value; including them would drag the
    // average toward zero and make the curve unreadable.
    if (category !== "Land") {
      mvTotal += card.cmc * quantity;
      mvCards += quantity;
      const bucket = Math.min(7, Math.floor(card.cmc));
      curveBuckets.set(bucket, (curveBuckets.get(bucket) ?? 0) + quantity);
    }
  }

  const curve = Array.from({ length: 8 }, (_, mv) => ({
    mv,
    count: curveBuckets.get(mv) ?? 0,
  }));

  const categories = CATEGORY_ORDER.filter((c) => categoryCounts.has(c)).map(
    (category) => ({ category, count: categoryCounts.get(category) ?? 0 }),
  );

  return {
    mainCount,
    commanderCount,
    totalCount: mainCount + commanderCount,
    averageMv: mvCards ? mvTotal / mvCards : 0,
    curve,
    pips,
    colorIdentity: ["W", "U", "B", "R", "G"].filter((c) => identity.has(c)).join(""),
    categories,
    estimatedUsd,
  };
}

export interface LegalityIssue {
  severity: "error" | "warning";
  message: string;
}

/**
 * Commander rules checks. Deliberately advisory: the app reports problems but
 * never refuses an edit, because brewing regularly passes through illegal states.
 */
export function commanderIssues(entries: DeckEntry[]): LegalityIssue[] {
  const issues: LegalityIssue[] = [];
  const commanders = entries.filter((e) => e.zone === "commander");
  const main = entries.filter((e) => e.zone === "main");

  if (commanders.length === 0) {
    issues.push({ severity: "warning", message: "No commander set." });
  }

  const identity = new Set<string>();
  for (const entry of commanders) {
    for (const color of entry.card.colorIdentity) identity.add(color);

    const isLegendaryCreature =
      /\bLegendary\b/.test(entry.card.typeLine) &&
      /\bCreature\b/.test(entry.card.typeLine);
    const canBeCommander = /can be your commander/i.test(entry.card.oracleText);

    if (!isLegendaryCreature && !canBeCommander) {
      issues.push({
        severity: "error",
        message: `${entry.card.name} cannot be a commander.`,
      });
    }
  }

  const total =
    main.reduce((sum, e) => sum + e.quantity, 0) +
    commanders.reduce((sum, e) => sum + e.quantity, 0);

  if (total !== 100 && total > 0) {
    issues.push({
      severity: total > 100 ? "error" : "warning",
      message: `Deck has ${total} cards; Commander wants exactly 100.`,
    });
  }

  for (const entry of main) {
    const card = entry.card;

    const outside = [...card.colorIdentity].filter((c) => !identity.has(c));
    if (commanders.length && outside.length) {
      issues.push({
        severity: "error",
        message: `${card.name} is outside your commander's colour identity (${outside.join("")}).`,
      });
    }

    const basicLand =
      /\bBasic\b/.test(card.typeLine) && /\bLand\b/.test(card.typeLine);
    const unlimited = /A deck can have any number of cards named/i.test(
      card.oracleText,
    );
    if (entry.quantity > 1 && !basicLand && !unlimited) {
      issues.push({
        severity: "error",
        message: `${card.name} x${entry.quantity} breaks the singleton rule.`,
      });
    }

    if (card.legalities.commander === "banned") {
      issues.push({
        severity: "error",
        message: `${card.name} is banned in Commander.`,
      });
    }
  }

  return issues;
}
