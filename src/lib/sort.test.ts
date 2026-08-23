import { describe, expect, it } from "vitest";
import {
  availableSorts,
  DEFAULT_SORT,
  orderBySql,
  remoteSort,
  SORTS,
  sortOption,
} from "./sort";

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

  it("gives every sort one direction, used by both sides", () => {
    // These used to disagree by construction: Scryfall's default varies by key
    // and the SQL had its direction baked into a string.
    for (const option of SORTS) {
      expect(["asc", "desc"]).toContain(option.dir);
      if (option.remote) expect(remoteSort(option.key).dir).toBe(option.dir);
    }
  });

  it("sorts prices most-expensive first", () => {
    // The one place the useful direction is not the default reading order.
    expect(remoteSort("value")).toEqual({ order: "usd", dir: "desc" });
    expect(orderBySql("value")).toContain("DESC");
  });

  it("ends every ordering with a unique tiebreaker", () => {
    // Totality is what makes streams mergeable: with ties broken arbitrarily a
    // card can land on both sides of a page boundary — duplicated in one page,
    // missing from the next. Printings share a name, so the id is the only
    // column that can finish the job.
    for (const option of SORTS) {
      expect(orderBySql(option.key).endsWith("c.name ASC, c.id ASC")).toBe(true);
    }
  });

  it("keeps nulls last whichever way the sort runs", () => {
    // SQLite puts NULL first ascending, which would lead the price list with
    // cards that have no price.
    expect(orderBySql("value")).toContain("NULLS LAST");
    expect(orderBySql("name")).toContain("NULLS LAST");
  });

  it("falls back rather than throwing on an unknown key", () => {
    expect(sortOption("nonsense" as never)).toBe(SORTS[0]);
  });
});
