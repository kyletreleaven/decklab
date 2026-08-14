import { fetch } from "@tauri-apps/plugin-http";
import type { Card } from "./types";
import { canonicalColors } from "./types";
import { cacheCards } from "./cards";
import { schedule, type Lane } from "./scheduler";

const API = "https://api.scryfall.com";

/**
 * Scryfall asks for 50-100ms between requests and a descriptive User-Agent.
 * Requests go through the Tauri HTTP plugin rather than the webview's `fetch`
 * so we can actually set that header, and through the scheduler so the spacing
 * holds and interactive work can preempt background work.
 */

export class ScryfallError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ScryfallError";
  }
}

interface RequestOptions extends RequestInit {
  /** Scopes eviction in the interactive lane. Per *kind*, not per argument. */
  key?: string;
  lane?: Lane;
}

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const { key, lane, ...fetchInit } = init ?? {};
  return schedule<T>(
    async () => {
      const response = await fetch(`${API}${path}`, {
        ...fetchInit,
        headers: {
          Accept: "application/json",
          "User-Agent": "DeckLab/0.1.0 (desktop)",
          ...(fetchInit.body ? { "Content-Type": "application/json" } : {}),
          ...fetchInit.headers,
        },
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        const detail =
          (body as { details?: string } | null)?.details ??
          `Scryfall returned ${response.status}`;
        throw new ScryfallError(detail, response.status);
      }

      return body as T;
    },
    { lane, key },
  );
}

/** Raw Scryfall card JSON. Only the fields we denormalise are typed. */
export interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  released_at?: string;
  rarity: string;
  layout: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors?: string[];
  color_identity?: string[];
  keywords?: string[];
  legalities?: Record<string, string>;
  prices?: Record<string, string | null>;
  image_uris?: Record<string, string>;
  card_faces?: {
    name: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    power?: string;
    toughness?: string;
    loyalty?: string;
    colors?: string[];
    image_uris?: Record<string, string>;
  }[];
  edhrec_rank?: number;
  reserved?: boolean;
  digital?: boolean;
  [key: string]: unknown;
}

/**
 * Double-faced cards carry their images on the faces rather than the card, and
 * split/adventure cards duplicate text across faces. Flatten both so the cache
 * always has something to display and search.
 */
export function normalize(raw: ScryfallCard): Card {
  const front = raw.card_faces?.[0];
  const images = raw.image_uris ?? front?.image_uris ?? {};

  const oracleText =
    raw.oracle_text ??
    raw.card_faces?.map((f) => f.oracle_text ?? "").join("\n//\n") ??
    "";

  // A face's colours are only part of the story; fall back to colour identity
  // so colourless-looking DFCs still filter correctly.
  const colors = raw.colors ?? front?.colors ?? [];

  return {
    id: raw.id,
    oracleId: raw.oracle_id ?? raw.id,
    name: raw.name,
    setCode: raw.set,
    setName: raw.set_name,
    collectorNumber: raw.collector_number,
    releasedAt: raw.released_at ?? null,
    rarity: raw.rarity,
    layout: raw.layout,
    manaCost: raw.mana_cost ?? front?.mana_cost ?? null,
    cmc: raw.cmc ?? 0,
    typeLine: raw.type_line ?? front?.type_line ?? "",
    oracleText,
    power: raw.power ?? front?.power ?? null,
    toughness: raw.toughness ?? front?.toughness ?? null,
    loyalty: raw.loyalty ?? front?.loyalty ?? null,
    colors: canonicalColors(colors),
    colorIdentity: canonicalColors(raw.color_identity),
    keywords: raw.keywords ?? [],
    legalities: raw.legalities ?? {},
    prices: raw.prices ?? {},
    imageSmall: images.small ?? null,
    imageNormal: images.normal ?? images.large ?? null,
    imageArtCrop: images.art_crop ?? null,
    edhrecRank: raw.edhrec_rank ?? null,
    reserved: !!raw.reserved,
    digital: !!raw.digital,
    data: raw as unknown as Record<string, unknown>,
  };
}

export interface SearchPage {
  cards: Card[];
  totalCards: number;
  hasMore: boolean;
  nextPage: number | null;
}

interface ScryfallList {
  data: ScryfallCard[];
  total_cards?: number;
  has_more?: boolean;
}

/**
 * Full Scryfall search. Every card that comes back is written into the local
 * cache, which is what incrementally builds up the offline catalogue.
 */
export async function search(query: string, page = 1): Promise<SearchPage> {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    unique: "cards",
    order: "name",
  });

  let list: ScryfallList;
  try {
    list = await request<ScryfallList>(`/cards/search?${params}`, {
      key: "search",
    });
  } catch (error) {
    // Scryfall 404s an empty result set rather than returning zero rows.
    if (error instanceof ScryfallError && error.status === 404) {
      return { cards: [], totalCards: 0, hasMore: false, nextPage: null };
    }
    throw error;
  }

  const cards = list.data.map(normalize);
  await cacheCards(cards);

  return {
    cards,
    totalCards: list.total_cards ?? cards.length,
    hasMore: !!list.has_more,
    nextPage: list.has_more ? page + 1 : null,
  };
}

export async function autocomplete(partial: string): Promise<string[]> {
  if (partial.trim().length < 2) return [];
  const params = new URLSearchParams({ q: partial });
  const body = await request<{ data: string[] }>(
    `/cards/autocomplete?${params}`,
    { key: "autocomplete" },
  );
  return body.data ?? [];
}

export async function named(name: string, exact = true): Promise<Card> {
  const params = new URLSearchParams(exact ? { exact: name } : { fuzzy: name });
  const card = normalize(
    await request<ScryfallCard>(`/cards/named?${params}`, { key: "named" }),
  );
  await cacheCards([card]);
  return card;
}

/**
 * A card's print run barely changes — new sets arrive every few weeks and
 * nothing else about an existing run moves — so this is memoised for a week.
 *
 * In memory only, for now; a persisted TTL arrives with migration 003. Even
 * so, this is what stops the request queue filling with duplicate work as
 * focus moves between cards.
 */
const PRINTINGS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const printingsMemo = new Map<string, { at: number; cards: Card[] }>();
const printingsInflight = new Map<string, Promise<Card[]>>();

async function fetchPrintings(oracleId: string): Promise<Card[]> {
  const params = new URLSearchParams({
    q: `oracleid:${oracleId}`,
    unique: "prints",
    order: "released",
  });
  const list = await request<ScryfallList>(`/cards/search?${params}`, {
    key: "printings",
  });
  const cards = list.data.map(normalize);
  await cacheCards(cards);
  return cards;
}

/** Every printing of a card, used by the printings carousel. */
export async function printings(oracleId: string): Promise<Card[]> {
  const hit = printingsMemo.get(oracleId);
  if (hit && Date.now() - hit.at < PRINTINGS_TTL_MS) return hit.cards;

  // Collapse concurrent asks for the same card into one request. Without this,
  // moving focus back and forth re-enqueues work that is already in flight.
  const pending = printingsInflight.get(oracleId);
  if (pending) return pending;

  const task = fetchPrintings(oracleId)
    .then((cards) => {
      printingsMemo.set(oracleId, { at: Date.now(), cards });
      return cards;
    })
    .finally(() => {
      printingsInflight.delete(oracleId);
    });

  printingsInflight.set(oracleId, task);
  return task;
}

/** Identifier shapes accepted by Scryfall's /cards/collection endpoint. */
export type Identifier =
  | { id: string }
  | { set: string; collector_number: string }
  | { name: string };

export interface IdentifierResult {
  found: Card[];
  notFound: Identifier[];
}

/**
 * Batch-resolve arbitrary identifiers. Used by import, where a line may pin an
 * exact printing (Archidekt gives us Scryfall ids outright, Arena gives set +
 * collector number) or may only know a name.
 */
export async function resolveIdentifiers(
  identifiers: Identifier[],
): Promise<IdentifierResult> {
  const found: Card[] = [];
  const notFound: Identifier[] = [];

  for (let i = 0; i < identifiers.length; i += 75) {
    const chunk = identifiers.slice(i, i + 75);
    const body = await request<{
      data: ScryfallCard[];
      not_found: Identifier[];
    }>("/cards/collection", {
      method: "POST",
      body: JSON.stringify({ identifiers: chunk }),
      // Background lane: every chunk carries distinct cards, so these must
      // queue rather than evict one another, and they should yield to whatever
      // the user is doing.
      lane: "background",
    });

    found.push(...(body.data ?? []).map(normalize));
    notFound.push(...(body.not_found ?? []));
  }

  await cacheCards(found);
  return { found, notFound };
}

export interface ResolveResult {
  found: Card[];
  notFound: string[];
}

/**
 * Batch name lookup, used by decklist import. Scryfall's collection endpoint
 * takes 75 identifiers per call, so long lists are chunked.
 */
export async function resolveNames(names: string[]): Promise<ResolveResult> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const found: Card[] = [];
  const notFound: string[] = [];

  for (let i = 0; i < unique.length; i += 75) {
    const chunk = unique.slice(i, i + 75);
    const body = await request<{
      data: ScryfallCard[];
      not_found: { name?: string }[];
    }>("/cards/collection", {
      method: "POST",
      body: JSON.stringify({ identifiers: chunk.map((name) => ({ name })) }),
      lane: "background",
    });

    found.push(...(body.data ?? []).map(normalize));
    notFound.push(
      ...(body.not_found ?? []).map((entry) => entry.name ?? "unknown"),
    );
  }

  await cacheCards(found);
  return { found, notFound };
}
