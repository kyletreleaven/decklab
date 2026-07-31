import { addCardToCollection } from "./collections";
import type { ParsedLine } from "./decklist";
import { addCardToDeck } from "./decks";
import { resolveIdentifiers, type Identifier } from "./scryfall";
import type { Card, DeckZone } from "./types";

export interface ResolvedLine {
  line: ParsedLine;
  card: Card | null;
}

export interface ImportPreview {
  resolved: ResolvedLine[];
  matched: number;
  unmatched: number;
  /** Total physical cards that would be added. */
  totalCards: number;
}

/** Normalise a name for matching: case, punctuation and DFC halves all vary. */
function nameKeys(name: string): string[] {
  const base = name.trim().toLowerCase();
  const keys = [base];
  // "Front // Back" should also match a line that only named the front face.
  const front = base.split("//")[0]?.trim();
  if (front && front !== base) keys.push(front);
  return keys;
}

function bestIdentifier(line: ParsedLine): Identifier {
  if (line.scryfallId) return { id: line.scryfallId };
  if (line.setCode && line.collectorNumber) {
    return { set: line.setCode, collector_number: line.collectorNumber };
  }
  return { name: line.name };
}

/**
 * Resolve parsed lines against Scryfall in two passes.
 *
 * The first pass uses the most precise identifier each line offers, so exact
 * printings survive the round trip. Anything that fails — a set code the source
 * spelled differently, a collector number that has since moved — gets a second
 * pass by name, which is far more forgiving. Without the fallback a single bad
 * set code would drop the card entirely.
 */
export async function resolveLines(lines: ParsedLine[]): Promise<ImportPreview> {
  if (!lines.length) {
    return { resolved: [], matched: 0, unmatched: 0, totalCards: 0 };
  }

  const byId = new Map<string, Card>();
  const bySetNumber = new Map<string, Card>();
  const byName = new Map<string, Card>();

  function index(cards: Card[]): void {
    for (const card of cards) {
      byId.set(card.id, card);
      bySetNumber.set(`${card.setCode}|${card.collectorNumber}`, card);
      for (const key of nameKeys(card.name)) {
        // Keep the first printing seen; Scryfall returns them in request order.
        if (!byName.has(key)) byName.set(key, card);
      }
    }
  }

  const first = await resolveIdentifiers(lines.map(bestIdentifier));
  index(first.found);

  function lookup(line: ParsedLine): Card | null {
    if (line.scryfallId) {
      const hit = byId.get(line.scryfallId);
      if (hit) return hit;
    }
    if (line.setCode && line.collectorNumber) {
      const hit = bySetNumber.get(`${line.setCode}|${line.collectorNumber}`);
      if (hit) return hit;
    }
    for (const key of nameKeys(line.name)) {
      const hit = byName.get(key);
      if (hit) return hit;
    }
    return null;
  }

  const stillMissing = lines.filter(
    (line) => !lookup(line) && !(bestIdentifier(line) as { name?: string }).name,
  );

  if (stillMissing.length) {
    const second = await resolveIdentifiers(
      stillMissing.map((line) => ({ name: line.name })),
    );
    index(second.found);
  }

  const resolved = lines.map((line) => ({ line, card: lookup(line) }));
  const matched = resolved.filter((r) => r.card).length;

  return {
    resolved,
    matched,
    unmatched: resolved.length - matched,
    totalCards: resolved.reduce(
      (sum, r) => sum + (r.card ? r.line.quantity : 0),
      0,
    ),
  };
}

const SECTION_TO_ZONE: Record<ParsedLine["section"], DeckZone> = {
  commander: "commander",
  main: "main",
  side: "side",
  maybe: "maybe",
};

export async function importIntoDeck(
  deckId: string,
  resolved: ResolvedLine[],
): Promise<number> {
  let added = 0;
  for (const { line, card } of resolved) {
    if (!card) continue;
    await addCardToDeck(deckId, card, line.quantity, SECTION_TO_ZONE[line.section]);
    added += line.quantity;
  }
  return added;
}

export async function importIntoCollection(
  collectionId: string,
  resolved: ResolvedLine[],
): Promise<number> {
  let added = 0;
  for (const { line, card } of resolved) {
    if (!card) continue;
    await addCardToCollection(
      collectionId,
      card,
      line.quantity,
      line.foil ? "foil" : "nonfoil",
      line.condition?.trim() || "NM",
    );
    added += line.quantity;
  }
  return added;
}
