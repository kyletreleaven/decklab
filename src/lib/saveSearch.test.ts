import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CARDS, MAX_PAGES, TooManyResults } from "./saveSearch";

vi.mock("./scryfall", () => ({ search: vi.fn() }));
vi.mock("./collections", () => ({
  createCollection: vi.fn(),
  addCardsToCollection: vi.fn(),
}));

const { saveSearchAsCollection } = await import("./saveSearch");
const scryfall = await import("./scryfall");
const collections = await import("./collections");

function page(n: number, total: number, last = false) {
  return {
    cards: Array.from({ length: 3 }, (_, i) => ({ id: `${n}-${i}` })),
    totalCards: total,
    hasMore: !last,
    nextPage: last ? null : n + 1,
  };
}

describe("saveSearchAsCollection", () => {
  // Reset rather than clear: one case sets a persistent `mockImplementation`,
  // and call counts accumulate across cases otherwise — both of which make a
  // later assertion see an earlier test's work.
  beforeEach(() => vi.resetAllMocks());

  it("refuses before walking when the match count is over the cap", async () => {
    // Scryfall reports the total on page one, so the refusal costs a single
    // request rather than discovering the size the expensive way.
    vi.mocked(scryfall.search).mockResolvedValueOnce(
      page(1, MAX_CARDS + 1) as never,
    );

    await expect(
      saveSearchAsCollection("Too big", { query: "t:creature" }, "name"),
    ).rejects.toBeInstanceOf(TooManyResults);

    expect(scryfall.search).toHaveBeenCalledTimes(1);
    expect(collections.createCollection).not.toHaveBeenCalled();
  });

  it("saves as a binary collection", async () => {
    // The whole point of the type: it records that these matched, not that you
    // own one of each.
    vi.mocked(scryfall.search).mockResolvedValueOnce(page(1, 3, true) as never);
    vi.mocked(collections.createCollection).mockResolvedValueOnce({
      id: "c1",
    } as never);

    await saveSearchAsCollection("Ramp", { query: "o:ramp" }, "name");

    expect(collections.createCollection).toHaveBeenCalledWith(
      "Ramp",
      "paper",
      "binary",
    );
  });

  it("creates nothing when the walk fails", async () => {
    // An aborted or failed save must not leave an empty collection behind for
    // the user to work out the meaning of.
    vi.mocked(scryfall.search)
      .mockResolvedValueOnce(page(1, 9) as never)
      .mockRejectedValueOnce(new Error("offline"));

    await expect(
      saveSearchAsCollection("Half", { query: "o:ramp" }, "name"),
    ).rejects.toThrow("offline");
    expect(collections.createCollection).not.toHaveBeenCalled();
  });

  it("stops at the page cap even when more pages remain", async () => {
    // The count is under the cap but the source keeps offering pages — the
    // budget is requests, so the walk stops regardless.
    vi.mocked(scryfall.search).mockImplementation(
      async (_q, p = 1) => page(p, 30) as never,
    );
    vi.mocked(collections.createCollection).mockResolvedValueOnce({
      id: "c2",
    } as never);

    await saveSearchAsCollection("Capped", { query: "o:ramp" }, "name");
    expect(scryfall.search).toHaveBeenCalledTimes(MAX_PAGES);
  });

  it("reports progress as it walks", async () => {
    vi.mocked(scryfall.search)
      .mockResolvedValueOnce(page(1, 6) as never)
      .mockResolvedValueOnce(page(2, 6, true) as never);
    vi.mocked(collections.createCollection).mockResolvedValueOnce({
      id: "c3",
    } as never);

    const seen: number[] = [];
    await saveSearchAsCollection(
      "Progress",
      { query: "o:ramp" },
      "name",
      false,
      (p) => seen.push(p.fetched),
    );
    expect(seen).toEqual([3, 6]);
  });
});
