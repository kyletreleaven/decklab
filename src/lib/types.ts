/** Canonical MTG colour order. Colour sets are stored as strings in this order
 *  ("BG", "WUR") so they can be compared and displayed without re-sorting. */
export const WUBRG = ["W", "U", "B", "R", "G"] as const;
export type Color = (typeof WUBRG)[number];

export function canonicalColors(colors: string[] | undefined | null): string {
  if (!colors?.length) return "";
  return WUBRG.filter((c) => colors.includes(c)).join("");
}

export interface Prices {
  usd?: string | null;
  usd_foil?: string | null;
  eur?: string | null;
  tix?: string | null;
}

/** A card as stored in the local cache. Mirrors the `cards` table. */
export interface Card {
  id: string;
  oracleId: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  releasedAt: string | null;
  rarity: string;
  layout: string;
  manaCost: string | null;
  cmc: number;
  typeLine: string;
  oracleText: string;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  /** Canonical WUBRG-ordered string, e.g. "BR". */
  colors: string;
  /** Canonical WUBRG-ordered string. This is what Commander legality keys off. */
  colorIdentity: string;
  keywords: string[];
  legalities: Record<string, string>;
  prices: Prices;
  imageSmall: string | null;
  imageNormal: string | null;
  imageArtCrop: string | null;
  edhrecRank: number | null;
  reserved: boolean;
  digital: boolean;
  /** Untouched Scryfall payload, for anything not denormalised above. */
  data: Record<string, unknown>;
}

export type DeckZone = "commander" | "main" | "side" | "maybe";

export interface Deck {
  id: string;
  name: string;
  format: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeckEntry {
  id: string;
  deckId: string;
  cardId: string;
  quantity: number;
  zone: DeckZone;
  card: Card;
}

export type CollectionKind =
  | "paper"
  | "arena"
  | "mtgo"
  | "cube"
  | "loaned"
  | "wishlist";

export interface Collection {
  id: string;
  name: string;
  kind: CollectionKind;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionItem {
  id: string;
  collectionId: string;
  cardId: string;
  quantity: number;
  finish: string;
  condition: string;
  notes: string;
  card: Card;
}

/** Ownership of a single deck slot, resolved against one or more collections. */
export interface OwnershipRow {
  cardId: string;
  name: string;
  /** How many the deck asks for. */
  required: number;
  /** Copies of this exact printing. */
  exact: number;
  /** Copies of any printing sharing the oracle id — what you can actually play. */
  playable: number;
  /** Per-printing breakdown, so "2x Alpha, 1x Secret Lair" stays visible. */
  printings: { setCode: string; setName: string; quantity: number }[];
}
