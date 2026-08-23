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

export type Direction = "asc" | "desc";

export interface SortOption {
  key: SortKey;
  label: string;
  /**
   * The useful direction for this key, for *both* sides.
   *
   * One source, because the two used to disagree by construction: Scryfall's
   * own default varies by key (`cmc` ascends, `usd` descends), and the SQL had
   * its direction baked into a string. Sending no `dir` gets the price list
   * backwards; pinned by a contract test.
   */
  dir: Direction;
  /** Scryfall's spelling, or `null` when the universe cannot express this sort. */
  remote: { order: string } | null;
  /**
   * The SQL expression to order by — no direction and no tiebreaker, both of
   * which are applied by the caller so every sort gets the same treatment.
   *
   * Alias-qualified against `collectionItems`'s query: `c` for cards, `ci` for
   * items. That couples this to one query, which is the price of having a
   * single place where a sort is defined for both sides.
   */
  sql: string;
}

export const SORTS: SortOption[] = [
  { key: "name", label: "Name", dir: "asc", remote: { order: "name" }, sql: "c.name" },
  { key: "mv", label: "Mana value", dir: "asc", remote: { order: "cmc" }, sql: "c.cmc" },
  {
    key: "value",
    label: "Price",
    dir: "desc",
    remote: { order: "usd" },
    sql: "CAST(json_extract(c.prices, '$.usd') AS REAL)",
  },
  { key: "quantity", label: "Quantity", dir: "desc", remote: null, sql: "ci.quantity" },
];

/**
 * The tiebreaker that makes an ordering **total**.
 *
 * Required before two streams can be merged: with ties broken arbitrarily, the
 * same card can land on both sides of a page boundary — duplicated in one page
 * and missing from the next. `name` alone is not enough, since printings share
 * it, so the printing id is the final discriminator. Name comes first because a
 * tie group should still read alphabetically.
 */
export const TIEBREAK_SQL = "c.name ASC, c.id ASC";

/**
 * The direction a sort actually runs in.
 *
 * `SortOption.dir` is the *useful default* per key — price descends, name
 * ascends — and flipping inverts that rather than forcing ascending, so
 * choosing "Price" still opens most-expensive-first.
 */
export function direction(key: SortKey, flipped: boolean): Direction {
  const base = sortOption(key).dir;
  if (!flipped) return base;
  return base === "asc" ? "desc" : "asc";
}

/** `ORDER BY` clause for a sort, direction and tiebreaker included. */
export function orderBySql(key: SortKey, flipped = false): string {
  const option = sortOption(key);
  const dir = direction(key, flipped) === "desc" ? "DESC" : "ASC";
  // SQLite sorts NULL first ascending and last descending; pin it either way so
  // priceless cards do not lead the price list.
  return `${option.sql} ${dir} NULLS LAST, ${TIEBREAK_SQL}`;
}

export const DEFAULT_SORT: SortKey = "name";

export function sortOption(key: SortKey): SortOption {
  return SORTS.find((s) => s.key === key) ?? SORTS[0];
}

/** How a sort is spelled for Scryfall: `order=` plus an explicit `dir=`. */
export function remoteSort(
  key: SortKey,
  flipped = false,
): { order: string; dir: Direction } {
  const option = sortOption(key);
  // Falls back rather than throwing: the panel resets a stranded sort, and a
  // request that arrives first should still be ordered, not ordered wrongly.
  if (!option.remote) return { order: "name", dir: direction("name", flipped) };
  return { order: option.remote.order, dir: direction(key, flipped) };
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
