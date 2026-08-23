import { addCardsToCollection, createCollection } from "./collections";
import { toScryfallQuery, type CardFilter } from "./filters";
import * as scryfall from "./scryfall";
import { remoteSort, type SortKey } from "./sort";
import type { Collection } from "./types";

/**
 * Saving a Scryfall search as a static collection.
 *
 * The result is **binary**: it records that these cards matched, not that you
 * own one of each — see `docs/card-set-types.md`. And **static**: a snapshot,
 * not a live query, so it does not shift when Scryfall reprints something.
 */

/**
 * How many pages one save may spend.
 *
 * The budget is requests, not bytes: pages hold 175 rows whatever the format,
 * and no arrangement of the API makes a large walk cheap
 * (`docs/fetching-many-cards.md`). Scryfall's answer to corpus-scale work is a
 * bulk download, so a modest cap here is the shape the API intends rather than
 * a limitation to route around. Ten pages is about 1,750 cards.
 */
export const MAX_PAGES = 10;

export const MAX_CARDS = MAX_PAGES * 175;

export class TooManyResults extends Error {
  constructor(readonly total: number) {
    super(
      `${total.toLocaleString()} cards is more than one save should fetch ` +
        `(limit ${MAX_CARDS.toLocaleString()}). Narrow the search first.`,
    );
    this.name = "TooManyResults";
  }
}

export interface SaveProgress {
  fetched: number;
  total: number;
}

/**
 * Walk a search and store the result.
 *
 * Refuses up front when the match count is over the cap — Scryfall reports it
 * on the first page, so nothing is wasted finding out. `onProgress` is for a
 * count on screen, and `signal` lets the user stop a walk already under way;
 * whatever was fetched before an abort is discarded rather than half-saved.
 */
export async function saveSearchAsCollection(
  name: string,
  filter: CardFilter,
  sort: SortKey,
  sortFlipped = false,
  onProgress?: (progress: SaveProgress) => void,
  signal?: AbortSignal,
): Promise<Collection> {
  const query = toScryfallQuery(filter) || "*";
  const order = remoteSort(sort, sortFlipped);

  const cards = [];
  let page: number | null = 1;
  let total = 0;

  while (page !== null && page <= MAX_PAGES) {
    const result = await scryfall.search(query, page, order);

    if (page === 1) {
      total = result.totalCards;
      if (total > MAX_CARDS) throw new TooManyResults(total);
    }

    cards.push(...result.cards);
    onProgress?.({ fetched: cards.length, total });

    // Checked after the page rather than before: the request is already spent,
    // and dropping its results would waste it for nothing.
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    page = result.nextPage;
  }

  // Created only once the walk succeeds, so an aborted or failed save leaves no
  // empty collection behind to explain.
  const collection = await createCollection(name, "paper", "binary");
  await addCardsToCollection(collection.id, cards);
  return collection;
}
