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

/**
 * The same ordering as `orderBySql`, in JavaScript.
 *
 * Needed to merge a local stream with a Scryfall one: SQL can order its own
 * rows but cannot compare them against rows that never went through SQLite.
 * These two must agree — a disagreement shows up as rows visibly out of order
 * where the streams interleave, which is the hardest kind of bug to attribute.
 *
 * `quantity` is absent by design: it is a fact about a held copy, not a card,
 * so it never takes part in a merge (see `availableSorts`).
 */
export function comparator(
  key: SortKey,
  flipped = false,
): (a: SortableCard, b: SortableCard) => number {
  const sign = direction(key, flipped) === "desc" ? -1 : 1;

  return (a, b) => {
    // Decided before the sign is applied, or reversing the sort would drag the
    // priceless cards to the top — `NULLS LAST` means last either way.
    const nulls = compareMissing(key, a, b);
    if (nulls !== 0) return nulls;

    const primary = compareField(key, a, b);
    if (primary !== 0) return primary * sign;
    // The tiebreaker does not flip — only the primary key reverses, so one
    // total order underlies both directions.
    return a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  };
}

/** The card fields a merge comparison needs. */
export interface SortableCard {
  id: string;
  name: string;
  cmc: number;
  prices: { usd?: string | null };
}

/** Price is the only field that can be absent; a missing one always sorts last. */
function compareMissing(key: SortKey, a: SortableCard, b: SortableCard): number {
  if (key !== "value") return 0;
  const aHas = Number.isFinite(Number.parseFloat(a.prices.usd ?? ""));
  const bHas = Number.isFinite(Number.parseFloat(b.prices.usd ?? ""));
  if (aHas === bHas) return 0;
  return aHas ? -1 : 1;
}

function compareField(key: SortKey, a: SortableCard, b: SortableCard): number {
  switch (key) {
    case "mv":
      return a.cmc - b.cmc;
    case "value":
      // Both sides are known present — `compareMissing` has already run.
      return (
        Number.parseFloat(a.prices.usd ?? "") - Number.parseFloat(b.prices.usd ?? "")
      );
    default:
      return 0; // name and quantity fall through to the tiebreaker
  }
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
