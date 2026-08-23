import { describe, expect, it, vi } from "vitest";
import { fromArray, fromPages, mergeSorted, take } from "./merge";

const byValue = (a: number, b: number) => a - b;

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}

describe("mergeSorted", () => {
  it("interleaves two sorted sources", async () => {
    const merged = mergeSorted(
      [fromArray([1, 4, 5]), fromArray([2, 3, 6])],
      byValue,
    );
    expect(await collect(merged)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("handles empty and exhausted sources", async () => {
    // A source may be empty from the start, which must not read as exhausted
    // before it has been pulled — the two states are tracked separately.
    const merged = mergeSorted(
      [fromArray<number>([]), fromArray([1, 2]), fromArray<number>([])],
      byValue,
    );
    expect(await collect(merged)).toEqual([1, 2]);
  });

  it("emits nothing when every source is empty", async () => {
    expect(await collect(mergeSorted([fromArray<number>([])], byValue))).toEqual([]);
  });

  it("keeps every copy when no dedupe key is given", async () => {
    // Union semantics are opt-in: without a key this is a plain merge, and a
    // value present in both sources appears twice.
    const merged = mergeSorted([fromArray([1, 2]), fromArray([2, 3])], byValue);
    expect(await collect(merged)).toEqual([1, 2, 2, 3]);
  });

  it("drops duplicates across sources when given a key", async () => {
    // The union case: a card in both the foreground and the background renders
    // once.
    const merged = mergeSorted(
      [fromArray([1, 2]), fromArray([2, 3])],
      byValue,
      String,
    );
    expect(await collect(merged)).toEqual([1, 2, 3]);
  });

  it("resolves ties in favour of the earlier source, deterministically", async () => {
    type Row = { v: number; from: string };
    const merged = mergeSorted<Row>(
      [
        fromArray([{ v: 1, from: "a" }]),
        fromArray([{ v: 1, from: "b" }]),
      ],
      (x, y) => x.v - y.v,
    );
    expect((await collect(merged)).map((r) => r.from)).toEqual(["a", "b"]);
  });

  it("pulls pages only as they are needed", async () => {
    // The point of streaming: rendering one screen must not drain a source of
    // thousands. Taking three elements should cost one page, not all four.
    const fetchPage = vi.fn(async (page: number) => ({
      items: [page * 10, page * 10 + 1, page * 10 + 2],
      next: page < 4 ? page + 1 : null,
    }));

    const merged = mergeSorted([fromPages(fetchPage)], byValue);
    expect(await take(merged, 3)).toEqual([10, 11, 12]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("advances to the next page when a source runs dry mid-merge", async () => {
    const fetchPage = async (page: number) => ({
      items: page === 1 ? [1, 3] : [5, 7],
      next: page === 1 ? 2 : null,
    });
    const merged = mergeSorted([fromPages(fetchPage), fromArray([2, 4, 6])], byValue);
    expect(await collect(merged)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("never asks a source for more than it needs", async () => {
    // A bounded source must not be required to complete: the merge holds one
    // element of lookahead per source and no more.
    let pulled = 0;
    async function* counted(): AsyncGenerator<number> {
      for (const n of [1, 2, 3, 4, 5]) {
        pulled++;
        yield n;
      }
    }
    const merged = mergeSorted([counted()], byValue);
    await take(merged, 2);
    // Two emitted, plus at most one held in lookahead.
    expect(pulled).toBeLessThanOrEqual(3);
  });

  it("resumes where the previous take stopped", async () => {
    // The regression this file failed to catch: `for await` with a `break`
    // calls return() on the generator and closes it, so the second page comes
    // back empty and the pool looks exhausted after one screen.
    const merged = mergeSorted([fromArray([1, 2, 3, 4, 5, 6])], byValue);
    expect(await take(merged, 2)).toEqual([1, 2]);
    expect(await take(merged, 2)).toEqual([3, 4]);
    expect(await take(merged, 2)).toEqual([5, 6]);
    expect(await take(merged, 2)).toEqual([]);
  });

  it("resumes across pages of a paginated source", async () => {
    const fetchPage = async (page: number) => ({
      items: [page * 10, page * 10 + 1],
      next: page < 3 ? page + 1 : null,
    });
    const merged = mergeSorted([fromPages(fetchPage)], byValue);
    expect(await take(merged, 3)).toEqual([10, 11, 20]);
    expect(await take(merged, 3)).toEqual([21, 30, 31]);
  });

  it("merges more than two sources", async () => {
    const merged = mergeSorted(
      [fromArray([1, 6]), fromArray([2, 5]), fromArray([3, 4])],
      byValue,
    );
    expect(await collect(merged)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("orders by the shared coarse key when sources disagree on ties", async () => {
    // The case from docs/merging-sorted-sources.md: both sources sort by `cost`
    // but break ties differently. The merged output must still be ordered by
    // cost, which is all the theorem promises — and all the display needs.
    type Row = { cost: number; name: string };
    const local: Row[] = [
      { cost: 1, name: "alpha" },
      { cost: 1, name: "beta" },
      { cost: 2, name: "delta" },
    ];
    const remote: Row[] = [
      { cost: 1, name: "zeta" },
      { cost: 1, name: "gamma" },
      { cost: 2, name: "epsilon" },
    ];

    const merged = await collect(
      mergeSorted<Row>([fromArray(local), fromArray(remote)], (a, b) =>
        a.cost !== b.cost ? a.cost - b.cost : a.name.localeCompare(b.name),
      ),
    );

    const costs = merged.map((r) => r.cost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(merged).toHaveLength(6);
  });
});
