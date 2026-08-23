/**
 * Merging sorted, paginated sources.
 *
 * The pool draws a union of card sets that arrive as separate ordered streams —
 * a local collection and a Scryfall search — and has to render them as one
 * sequence without holding either in full.
 *
 * Why a greedy merge is sound even though the sources sort by different keys,
 * and what ordering the result may claim, is in
 * `docs/merging-sorted-sources.md`. The short version: merging greedily by our
 * key yields a result ordered by whatever coarser key both sources share.
 */

/**
 * A source of elements in ascending order, produced on demand.
 *
 * An `AsyncIterable` rather than an array because one side is paginated and the
 * other may become so: the merge must never require a source to be complete.
 * A bounded source is simply one that finishes early.
 */
export type SortedSource<T> = AsyncIterable<T>;

/** Wrap an in-memory array. The local collection is this today. */
export async function* fromArray<T>(items: readonly T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

/**
 * Wrap a paginated fetcher, pulling the next page only when the current one is
 * spent. `next` returns `null` when there are no more pages.
 */
export async function* fromPages<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; next: number | null }>,
  firstPage = 1,
): AsyncGenerator<T> {
  let page: number | null = firstPage;
  while (page !== null) {
    const { items, next } = await fetchPage(page);
    for (const item of items) yield item;
    page = next;
  }
}

/**
 * Merge sorted sources into one ascending sequence.
 *
 * `compare` must be the *total* key — see `orderBySql` — or elements from one
 * source can be emitted out of order relative to another.
 *
 * `keyOf` deduplicates: the first element with a given key wins and later ones
 * are dropped, so a card in both the foreground and the background appears
 * once. **This relies on equal keys sorting adjacently.** True when the dedupe
 * key is the sort key's own tiebreaker (printing id), and *not* true in
 * general — deduplicating by oracle id under a price sort would miss pairs,
 * since two printings of one card carry different prices and so are not
 * neighbours.
 */
export async function* mergeSorted<T>(
  sources: SortedSource<T>[],
  compare: (a: T, b: T) => number,
  keyOf?: (item: T) => string,
): AsyncGenerator<T> {
  const iterators = sources.map((s) => s[Symbol.asyncIterator]());

  // One element of lookahead per source. `undefined` means "not yet pulled",
  // `null` means exhausted — distinct states, since a source may legitimately
  // be empty from the start.
  const heads: (T | null | undefined)[] = iterators.map(() => undefined);

  async function fill(i: number): Promise<void> {
    if (heads[i] !== undefined) return;
    const { value, done } = await iterators[i].next();
    heads[i] = done ? null : (value as T);
  }

  let lastKey: string | null = null;

  for (;;) {
    await Promise.all(heads.map((_, i) => fill(i)));

    // The smallest head across all sources. Ties go to the earlier source,
    // which makes the merge deterministic for a given set of inputs.
    let pick = -1;
    for (let i = 0; i < heads.length; i++) {
      const head = heads[i];
      if (head === null || head === undefined) continue;
      if (pick === -1 || compare(head, heads[pick] as T) < 0) pick = i;
    }
    if (pick === -1) return;

    const item = heads[pick] as T;
    heads[pick] = undefined;

    if (keyOf) {
      const key = keyOf(item);
      // Adjacent duplicates only — see the note above.
      if (key === lastKey) continue;
      lastKey = key;
    }

    yield item;
  }
}

/**
 * Collect at most `limit` elements — one page of merged output.
 *
 * Pulls with explicit `next()` calls rather than `for await`: breaking out of a
 * `for await` loop calls `return()` on the generator and **closes it**, so a
 * second page would come back empty and the stream would look exhausted after
 * one screen. The source is left open and resumable.
 */
export async function take<T>(
  source: AsyncIterable<T> | AsyncIterator<T>,
  limit: number,
): Promise<T[]> {
  const iterator =
    Symbol.asyncIterator in source
      ? (source as AsyncIterable<T>)[Symbol.asyncIterator]()
      : (source as AsyncIterator<T>);

  const out: T[] = [];
  while (out.length < limit) {
    const { value, done } = await iterator.next();
    if (done) break;
    out.push(value as T);
  }
  return out;
}
