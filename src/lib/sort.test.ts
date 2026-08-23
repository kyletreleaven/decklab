import { describe, expect, it } from "vitest";
import {
  availableSorts,
  comparator,
  DEFAULT_SORT,
  direction,
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

  it("flips each sort's own default rather than forcing ascending", () => {
    // Choosing "Price" must still open most-expensive-first; the toggle inverts
    // that. Forcing asc would make the flip mean different things per key.
    expect(direction("value", false)).toBe("desc");
    expect(direction("value", true)).toBe("asc");
    expect(direction("name", false)).toBe("asc");
    expect(direction("name", true)).toBe("desc");
  });

  it("flips both sides together", () => {
    for (const option of SORTS) {
      const flipped = direction(option.key, true);
      expect(orderBySql(option.key, true)).toContain(
        flipped === "desc" ? "DESC" : "ASC",
      );
      if (option.remote) expect(remoteSort(option.key, true).dir).toBe(flipped);
    }
  });

  it("keeps the tiebreaker ascending when the sort is reversed", () => {
    // Only the primary key flips. Reversing the tiebreaker too would reorder
    // within tie groups for no reason, and the merge depends on one fixed
    // total order.
    expect(orderBySql("value", true).endsWith("c.name ASC, c.id ASC")).toBe(true);
  });

  it("orders the same way in JS as in SQL", () => {
    // The two run on different rows of the same merge, so a disagreement shows
    // up as cards out of order exactly where the streams interleave.
    const card = (id: string, name: string, cmc: number, usd: string | null) => ({
      id,
      name,
      cmc,
      prices: { usd },
    });

    const cheap = card("a", "Cheap", 1, "0.10");
    const dear = card("b", "Dear", 1, "40.00");
    expect(comparator("value")(dear, cheap)).toBeLessThan(0);
    expect(comparator("value", true)(cheap, dear)).toBeLessThan(0);

    const light = card("c", "Light", 1, null);
    const heavy = card("d", "Heavy", 6, null);
    expect(comparator("mv")(light, heavy)).toBeLessThan(0);
  });

  it("keeps priceless cards last in both directions", () => {
    // Matching NULLS LAST. Treating an absent price as zero would file such
    // cards among the cheapest, where they look like real data.
    const priced = { id: "a", name: "Priced", cmc: 1, prices: { usd: "1.00" } };
    const priceless = { id: "b", name: "Priceless", cmc: 1, prices: { usd: null } };
    expect(comparator("value")(priced, priceless)).toBeLessThan(0);
    expect(comparator("value", true)(priced, priceless)).toBeLessThan(0);
  });

  it("tiebreaks by name then id, and does not flip the tiebreaker", () => {
    // One total order underlies both directions, which is what lets a reversed
    // sort still merge correctly.
    const a = { id: "1", name: "Aaa", cmc: 2, prices: { usd: "1.00" } };
    const b = { id: "2", name: "Bbb", cmc: 2, prices: { usd: "1.00" } };
    expect(comparator("mv")(a, b)).toBeLessThan(0);
    expect(comparator("mv", true)(a, b)).toBeLessThan(0);
  });

  it("falls back rather than throwing on an unknown key", () => {
    expect(sortOption("nonsense" as never)).toBe(SORTS[0]);
  });
});
