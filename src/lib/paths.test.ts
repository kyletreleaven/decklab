import { describe, expect, it } from "vitest";
import { formatRef, parsePath, parseRef, PathError, quoteName } from "./paths";

describe("asset paths and references", () => {
  it("reads the two marks independently", () => {
    expect(parseRef("/Cores/core")).toEqual({ byName: false, rooted: true, names: ["Cores", "core"], facets: [] });
    expect(parseRef("main")).toEqual({ byName: false, rooted: false, names: ["main"], facets: [] });
    expect(parseRef("&/Sideboards/current")).toMatchObject({ byName: true, rooted: true });
    expect(parseRef("&commander")).toMatchObject({ byName: true, rooted: false, names: ["commander"] });
  });

  it("allows spaces in a name without quotes", () => {
    expect(parsePath("/Decks/Atraxa Superfriends")).toEqual(["Decks", "Atraxa Superfriends"]);
  });

  it("reads an unquoted dot as a facet, and a quoted one as part of the name", () => {
    expect(parseRef('/Decks/"Atraxa v1.2".arranged.by_mana')).toEqual({
      byName: false,
      rooted: true,
      names: ["Decks", "Atraxa v1.2"],
      facets: ["arranged", "by_mana"],
    });
    expect(parseRef(".arranged.by_mana")).toEqual({
      byName: false,
      rooted: false,
      names: [],
      facets: ["arranged", "by_mana"],
    });
  });

  it("refuses a dot in an unquoted name rather than guess", () => {
    expect(() => parseRef("/Decks/Atraxa v1.2")).toThrow(/must be quoted/);
  });

  it("quotes names that need it, doubling a quote", () => {
    expect(quoteName("St. Louis")).toBe('"St. Louis"');
    expect(quoteName("Trade/Keep")).toBe('"Trade/Keep"');
    expect(quoteName('The "good" box')).toBe('"The ""good"" box"');
    expect(quoteName("Paper")).toBe("Paper");
  });

  it("round-trips any name through quoting", () => {
    for (const name of ["St. Louis", "Trade/Keep", 'a "b" c', "x&y", "a:b", ".hidden", "plain"]) {
      const text = formatRef({ byName: false, rooted: true, names: ["Binders", name], facets: [] });
      expect(parsePath(text)).toEqual(["Binders", name]);
    }
  });

  it("reserves . and .., and refuses empty names", () => {
    expect(() => parsePath('/"."')).toThrow(/reserved/);
    expect(() => parsePath('/a/".."')).toThrow(/reserved/);
    expect(() => parsePath("/a//b")).toThrow(/empty/);
  });

  it("keeps an asset's own path rooted, pinned and without facets", () => {
    expect(() => parsePath("Paper")).toThrow(PathError);
    expect(() => parsePath("&/Paper")).toThrow(PathError);
    expect(() => parsePath("/Deck.oracle")).toThrow(/facet/);
    expect(() => parsePath("/")).toThrow(/root/);
  });

  it("refuses & and : inside an unquoted name", () => {
    expect(() => parseRef("/a&b")).toThrow(/quoted/);
    expect(() => parseRef("/a:b")).toThrow(/quoted/);
  });
});
