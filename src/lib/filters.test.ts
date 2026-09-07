import { describe, expect, it } from "vitest";
import {
  countActiveFilters,
  hasSearchableTerms,
  ownershipMode,
  toScryfallQuery,
} from "./filters";

describe("toScryfallQuery", () => {
  it("is empty for an empty filter", () => {
    expect(toScryfallQuery({})).toBe("");
    expect(hasSearchableTerms({})).toBe(false);
  });

  it("passes free text through untouched so Scryfall syntax still works", () => {
    expect(toScryfallQuery({ query: "o:draw a card" })).toBe("o:draw a card");
  });

  it("treats the selection as one set, not a list of alternatives", () => {
    // `c>=rw` is red AND white, not red OR white. The pips describe one
    // comparison; asking for either colour is `contains R` with max 1.
    expect(toScryfallQuery({ colors: ["R"] })).toBe("c>=r");
    expect(toScryfallQuery({ colors: ["R", "W"] })).toBe("c>=wr");
  });

  it("canonicalises the letters so pip click order cannot change the query", () => {
    expect(toScryfallQuery({ colors: ["R", "W"] })).toBe(
      toScryfallQuery({ colors: ["W", "R"] }),
    );
  });

  it("switches both the comparison and the count to identity together", () => {
    expect(
      toScryfallQuery({ colors: ["G"], colorField: "identity", colorCountMax: 2 }),
    ).toBe("id>=g id<=2");
  });

  it("uses <= for contained by, which is the subset test", () => {
    expect(toScryfallQuery({ colors: ["W", "U"], colorOp: "containedBy" })).toBe(
      "c<=wu",
    );
  });

  it("reads contained by an empty selection as colourless, not as no filter", () => {
    // The only cards whose colours are a subset of nothing are the colourless
    // ones. Dropping the clause would silently widen the search to everything.
    expect(toScryfallQuery({ colorOp: "containedBy" })).toBe("c<=c");
    expect(toScryfallQuery({ colorOp: "containedBy", colors: [] })).toBe("c<=c");
    expect(
      toScryfallQuery({ colorOp: "containedBy", colorField: "identity" }),
    ).toBe("id<=c");
  });

  it("reads contains an empty selection as no filter, which is vacuously true", () => {
    // The asymmetry is the point: every card contains no colours, but only
    // colourless cards are contained by none.
    expect(toScryfallQuery({ colorOp: "contains" })).toBe("");
    expect(toScryfallQuery({ colorOp: "contains", colors: [] })).toBe("");
  });

  it("spells colourless as a count of zero rather than a sixth pip", () => {
    // "contains colourless" is not a question; "has no colours" is.
    expect(toScryfallQuery({ colorCountMax: 0 })).toBe("c<=0");
  });

  it("expresses exactly-these-colours as contains plus pinned bounds", () => {
    expect(
      toScryfallQuery({ colors: ["W", "U"], colorCountMin: 2, colorCountMax: 2 }),
    ).toBe("c>=wu c>=2 c<=2");
  });

  it("treats a colour count of zero as a real bound, not absent", () => {
    expect(toScryfallQuery({ colorCountMin: 0 })).toBe("c>=0");
  });

  it("lowercases types", () => {
    expect(toScryfallQuery({ types: ["Creature"] })).toBe("t:creature");
    expect(toScryfallQuery({ types: ["Creature", "Land"] })).toBe(
      "(t:creature or t:land)",
    );
  });

  it("emits rarity clauses", () => {
    expect(toScryfallQuery({ rarities: ["rare", "mythic"] })).toBe(
      "(r:rare or r:mythic)",
    );
  });

  it("emits mana value bounds", () => {
    expect(toScryfallQuery({ mvMin: 2, mvMax: 5 })).toBe("mv>=2 mv<=5");
    expect(toScryfallQuery({ mvMax: 3 })).toBe("mv<=3");
  });

  it("treats mana value zero as a real bound, not absent", () => {
    expect(toScryfallQuery({ mvMax: 0 })).toBe("mv<=0");
  });

  it("uses id<= for colour identity, which is the Commander rule", () => {
    expect(toScryfallQuery({ withinIdentity: "WUBG" })).toBe("id<=WUBG");
  });

  it("maps an empty colour identity to colourless rather than dropping it", () => {
    // A colourless commander must not silently mean "no restriction".
    expect(toScryfallQuery({ withinIdentity: "" })).toBe("id<=c");
  });

  it("emits format legality", () => {
    expect(toScryfallQuery({ legalIn: "commander" })).toBe("f:commander");
  });

  it("joins several facets with spaces, i.e. AND", () => {
    expect(
      toScryfallQuery({
        query: "bolt",
        colors: ["R"],
        types: ["Instant"],
        mvMax: 1,
        legalIn: "modern",
      }),
    ).toBe("bolt c>=r t:instant mv<=1 f:modern");
  });

  it("ignores ownership toggles, which Scryfall cannot answer", () => {
    expect(toScryfallQuery({ showOwned: true, showUnowned: false })).toBe("");
  });
});

describe("ownershipMode", () => {
  it("defaults to showing everything", () => {
    expect(ownershipMode({})).toBe("all");
  });

  it("returns owned when only collected is ticked", () => {
    expect(ownershipMode({ showUnowned: false })).toBe("owned");
  });

  it("returns unowned when only not-collected is ticked", () => {
    expect(ownershipMode({ showOwned: false })).toBe("unowned");
  });

  it("returns none when both are unticked", () => {
    expect(ownershipMode({ showOwned: false, showUnowned: false })).toBe("none");
  });
});

describe("countActiveFilters", () => {
  it("counts each facet, and each selected value within one", () => {
    expect(
      countActiveFilters({ colors: ["R", "W"], types: ["Instant"], mvMax: 3 }),
    ).toBe(4);
  });

  it("does not count the colour field, which narrows nothing on its own", () => {
    expect(countActiveFilters({ colorField: "identity" })).toBe(0);
    expect(
      countActiveFilters({ colorField: "identity", colors: ["W"] }),
    ).toBe(1);
  });

  it("counts contained-by with an empty selection, which means colourless", () => {
    // It filters, so the bar must not read as clear — otherwise there is no
    // Clear all to undo it with.
    expect(countActiveFilters({ colorOp: "containedBy" })).toBe(1);
    // With pips selected the operator is already implied by their count.
    expect(countActiveFilters({ colorOp: "containedBy", colors: ["W"] })).toBe(1);
    expect(countActiveFilters({ colorOp: "contains" })).toBe(0);
  });

  it("counts colour bounds", () => {
    expect(countActiveFilters({ colorCountMin: 2, colorCountMax: 3 })).toBe(2);
  });

  it("does not count ownership toggles or deck scoping", () => {
    // Neither is something the user set in the filter bar's facets.
    expect(
      countActiveFilters({
        showOwned: false,
        withinIdentity: "WU",
        legalIn: "commander",
      }),
    ).toBe(0);
  });

  it("ignores whitespace-only names", () => {
    expect(countActiveFilters({ query: "   " })).toBe(0);
  });
});
