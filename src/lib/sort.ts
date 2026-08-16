/**
 * The one sort vocabulary, shared by both card streams.
 *
 * Sorting cannot be done after the fact for the universe: a page is 175 rows of
 * tens of thousands, so ordering what is in hand orders the wrong set. It has to
 * be pushed into Scryfall's `order=`/`dir=` on one side and into SQL on the
 * other, which means the menu is the *intersection* of what both can express.
 *
 * `quantity` is the case that does not intersect — it is a fact about your copy,
 * not about the card — so it carries no remote mapping and has to disappear
 * whenever a Scryfall stream is involved. Silently substituting another order
 * would be worse than not offering it.
 */
export type SortKey = "name" | "mv" | "quantity" | "value";

export interface SortOption {
  key: SortKey;
  label: string;
  /**
   * Scryfall's spelling, or `null` when the universe cannot express this sort.
   *
   * `dir` is always explicit: Scryfall's default direction varies by key —
   * `cmc` ascends, `usd` descends — so relying on the default gets the price
   * list backwards. Pinned by a contract test.
   */
  remote: { order: string; dir: "asc" | "desc" } | null;
}

export const SORTS: SortOption[] = [
  { key: "name", label: "Name", remote: { order: "name", dir: "asc" } },
  { key: "mv", label: "Mana value", remote: { order: "cmc", dir: "asc" } },
  { key: "value", label: "Price", remote: { order: "usd", dir: "desc" } },
  { key: "quantity", label: "Quantity", remote: null },
];

export const DEFAULT_SORT: SortKey = "name";

export function sortOption(key: SortKey): SortOption {
  return SORTS.find((s) => s.key === key) ?? SORTS[0];
}

/**
 * The sorts available when `remote` streams are part of the answer.
 *
 * Takes a flag rather than a source, because the constraint is per *stream*:
 * once any of the k merged streams is Scryfall's, the whole merge has to order
 * by a key every stream can produce.
 */
export function availableSorts(remote: boolean): SortOption[] {
  return remote ? SORTS.filter((s) => s.remote) : SORTS;
}
