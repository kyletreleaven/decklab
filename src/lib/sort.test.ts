import { describe, expect, it } from "vitest";
import { availableSorts, DEFAULT_SORT, SORTS, sortOption } from "./sort";

describe("sort vocabulary", () => {
  it("offers every sort when the answer is purely local", () => {
    expect(availableSorts(false)).toEqual(SORTS);
  });

  it("drops sorts the universe cannot express once a remote stream is involved", () => {
    const remote = availableSorts(true);
    // Quantity is a fact about your copy, not the card. Offering it against
    // Scryfall would either error or silently sort by something else.
    expect(remote.map((s) => s.key)).not.toContain("quantity");
    expect(remote.every((s) => s.remote !== null)).toBe(true);
  });

  it("keeps the default available in both modes", () => {
    // The panel falls back to this when a sort is stranded, so it must survive
    // the filter or the fallback loops.
    for (const remote of [true, false]) {
      expect(availableSorts(remote).some((s) => s.key === DEFAULT_SORT)).toBe(true);
    }
  });

  it("gives every remote sort an explicit direction", () => {
    // Scryfall's default direction varies by key — cmc ascends, usd descends —
    // so an omitted `dir` gets the price list backwards. Pinned live by the
    // "defaults direction per sort key" contract test.
    for (const option of SORTS) {
      if (option.remote) expect(["asc", "desc"]).toContain(option.remote.dir);
    }
  });

  it("sorts prices most-expensive first", () => {
    // The one place the useful direction is not the default reading order.
    expect(sortOption("value").remote).toEqual({ order: "usd", dir: "desc" });
  });

  it("falls back rather than throwing on an unknown key", () => {
    expect(sortOption("nonsense" as never)).toBe(SORTS[0]);
  });
});
