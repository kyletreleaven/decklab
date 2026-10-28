import { describe, expect, it } from "vitest";
import { convertV4, formatReport, type Lookups } from "./convert";
import type { V4Library } from "./v4";
import { dumpV5, loadV5 } from "./v5";

const T1 = "2026-03-01T14:02:11.000Z";
const T2 = "2026-10-20T09:15:40.123Z";
const SOL = "6ad8011d-3471-4369-9d68-b264cc027487";

const ORACLES: Record<string, string> = {
  "cmr|472|en": SOL,
  "c21|263|en": SOL,
  "2xm|190|en": "atraxa-oracle",
  "m21|177|en": "cultivate-oracle",
};

const lookups: Lookups = {
  oracleOf: (p) => ORACLES[`${p.set}|${p.number}|${p.lang}`],
  nameOf: (o) => (o === SOL ? "Sol Ring" : undefined),
};

function sample(): V4Library {
  return {
    collections: [
      {
        name: "Paper",
        kind: "paper",
        quantityKind: "natural",
        notes: "",
        createdAt: T1,
        updatedAt: T2,
        items: [
          { name: "Sol Ring", set: "cmr", number: "472", lang: "en", quantity: 2, finish: "nonfoil", condition: "NM", notes: "", addedAt: T2 },
          { name: "Sol Ring", set: "cmr", number: "472", lang: "en", quantity: 1, finish: "foil", condition: "NM", notes: "", addedAt: T1 },
          { name: "Brainstorm", set: "sta", number: "13", lang: "ja", quantity: 1, finish: "nonfoil", condition: "LP", notes: "from Dave", addedAt: T1 },
        ],
      },
      { name: "Wants", kind: "wishlist", quantityKind: "binary", notes: "", createdAt: T1, updatedAt: T1, items: [] },
      { name: "Atraxa", kind: "paper", quantityKind: "natural", notes: "", createdAt: T1, updatedAt: T1, items: [] },
    ],
    decks: [
      {
        name: "Atraxa",
        format: "commander",
        notes: "",
        createdAt: T1,
        updatedAt: T2,
        piles: [
          { name: "Draw", position: 1 },
          { name: "Ramp", position: 0 },
        ],
        cards: [
          { name: "Atraxa, Praetors' Voice", set: "2xm", number: "190", lang: "en", quantity: 1, zone: "commander", pile: null, addedAt: T1 },
          { name: "Sol Ring", set: "c21", number: "263", lang: "en", quantity: 1, zone: "main", pile: "Ramp", addedAt: T1 },
          { name: "Cultivate", set: "m21", number: "177", lang: "en", quantity: 1, zone: "maybe", pile: null, addedAt: T2 },
        ],
      },
    ],
    tags: [
      { oracleId: SOL, tag: "ramp" },
      { oracleId: "unknown-oracle", tag: "ramp" },
    ],
  };
}

describe("convert v4 → 5", () => {
  const { library, report } = convertV4(sample(), lookups);
  const at = (...path: string[]) => library.assets.find((a) => a.path.join("/") === path.join("/"));

  it("writes a file version 5 loads, and that dumps back the same", () => {
    const text = dumpV5(library);
    expect(dumpV5(loadV5(text))).toBe(text);
  });

  it("makes every collection a place, dropping finish and merging what becomes one bucket", () => {
    const paper = at("Paper");
    expect(paper).toMatchObject({ type: "place", created: T1, updated: T2 });
    if (paper?.type !== "place") throw new Error("not a place");
    expect(paper.cards).toHaveLength(2);
    expect(paper.cards[0]).toEqual({
      bucket: { card: "Sol Ring", oracle: SOL, printing: { set: "cmr", number: "472", lang: "en" }, attrs: {} },
      qty: 3,
      added: T1,
    });
    expect(report.finishesDropped).toEqual([{ collection: "Paper", rows: 1, copies: 1 }]);
    expect(report.merged).toEqual([{ collection: "Paper", card: "Sol Ring", lines: 2 }]);
  });

  it("keeps a condition other than NM, and a line's notes, as attributes", () => {
    expect(library.attributes).toEqual({ condition: "condition", note: "text" });
    const paper = at("Paper");
    if (paper?.type !== "place") throw new Error("not a place");
    expect(paper.cards[1].bucket.attrs).toEqual({ condition: "LP", note: "from Dave" });
  });

  it("infers nothing from kind or quantity kind, and says so", () => {
    expect(at("Wants")?.type).toBe("place");
    expect(report.kinds).toEqual([{ collection: "Wants", kind: "wishlist" }]);
    expect(report.binary).toEqual(["Wants"]);
  });

  it("gives a deck inline zones, a child maybe checklist, and an arrangement", () => {
    const deck = at("Atraxa (decklist)");
    expect(deck).toMatchObject({ type: "decklist", format: "commander" });
    expect(at("Atraxa (decklist)", "commander")).toMatchObject({ type: "checklist", unlisted: "excluded" });
    expect(at("Atraxa (decklist)", "main")).toMatchObject({ type: "checklist", unlisted: "excluded" });
    expect(at("Atraxa (decklist)", "maybe")).toMatchObject({
      type: "checklist",
      unlisted: "any",
      cards: [{ min: 1, max: null }],
    });
    const piles = at("Atraxa (decklist)", "piles");
    if (piles?.type !== "arrangement") throw new Error("not an arrangement");
    expect(piles.piles.map((p) => p.name)).toEqual(["Ramp", "Draw"]);
    expect(piles.of).toEqual({ byName: false, rooted: true, names: ["Atraxa (decklist)"], facets: [] });

    const text = dumpV5(library);
    expect(text).toContain("[asset.zones]\ncommander = [");
  });

  it("renames on a clash between a collection and a deck, and reports it", () => {
    expect(report.renamed).toEqual([
      { from: "Atraxa", to: "Atraxa (decklist)", why: 'another asset is already called "Atraxa"' },
    ]);
  });

  it("makes each tag a list pool, and reports a card the store cannot name", () => {
    expect(at("pools", "ramp")).toEqual({
      path: ["pools", "ramp"],
      type: "list pool",
      cards: [
        { bucket: { card: "Sol Ring", oracle: SOL, attrs: {} } },
        { bucket: { oracle: "unknown-oracle", attrs: {} } },
      ],
    });
    expect(report.noName).toEqual(["ramp: unknown-oracle"]);
  });

  it("writes a printing the store lacks without an oracle id, and reports it once", () => {
    expect(report.noOracle).toEqual(["Brainstorm (sta) 13 [ja]"]);
  });

  it("reports every loss as a line of text", () => {
    const text = formatReport(report);
    expect(text).toContain("finish dropped: Paper: 1 line(s), 1 copy not nonfoil");
    expect(text).toContain('convert by hand: Wants was kind "wishlist"');
    expect(text).toContain("renamed: Atraxa → /Atraxa (decklist)");
  });
});
