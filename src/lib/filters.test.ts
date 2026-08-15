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

  it("emits a single colour clause without parentheses", () => {
    expect(toScryfallQuery({ colors: ["R"] })).toBe("c:r");
  });

  it("ORs multiple colours inside parentheses", () => {
    // Without the parens the OR would bind loosely and swallow later clauses.
    expect(toScryfallQuery({ colors: ["R", "W"] })).toBe("(c:r or c:w)");
  });

  it("spells colourless as c:c rather than a letter", () => {
    expect(toScryfallQuery({ colors: ["C"] })).toBe("c:c");
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
    ).toBe("bolt c:r t:instant mv<=1 f:modern");
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
