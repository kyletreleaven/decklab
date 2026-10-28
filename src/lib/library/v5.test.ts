import { describe, expect, it } from "vitest";
import { canonicalV5, dumpV5, LibraryFormatError, loadV5, type V5Library } from "./v5";

const T1 = "2026-03-01T14:02:11.000Z";
const T2 = "2026-10-20T09:15:40.123Z";
const SOL = "6ad8011d-3471-4369-9d68-b264cc027487";
const ATRAXA = "d0b8ee6b-1a6b-4b2e-9e3a-000000000001";

const pinned = (...names: string[]) => ({ byName: false, rooted: false, names, facets: [] });

function sample(): V5Library {
  return {
    attributes: { condition: "condition", note: "text" },
    assets: [
      {
        path: ["Bulk box"],
        type: "place",
        storage: "box",
        created: T1,
        updated: T2,
        cards: [
          { bucket: { card: "Sol Ring", oracle: SOL, attrs: {} }, qty: 2, added: T1 },
          {
            bucket: { card: "Sol Ring", oracle: SOL, printing: { set: "c21", number: "263", lang: "en" }, finish: "foil", attrs: {} },
            qty: 1,
          },
          {
            bucket: { card: "Sol Ring", oracle: SOL, printing: { set: "cmr", number: "472", lang: "ja" }, attrs: { condition: "LP", note: 'from "Dave"' } },
            qty: 1,
          },
        ],
      },
      { path: ['St. Louis', 'Trade/Keep'], type: "place", cards: [] },
      {
        path: ["Wishlist"],
        type: "checklist",
        on: { byName: false, rooted: true, names: ["Bulk box"], facets: [] },
        unlisted: "any",
        cards: [{ bucket: { card: "Mana Crypt", attrs: {} }, min: 1, max: null }],
      },
      { path: ["pools", "ramp"], type: "list pool", cards: [{ bucket: { card: "Cultivate", attrs: {} } }] },
      { path: ["pools", "cheap blue"], type: "query pool", query: "c:u usd<1" },
      {
        path: ["Decks", "Atraxa v1.2"],
        type: "deck",
        format: "commander",
        shows: { byName: false, rooted: false, names: [], facets: ["arranged", "by_mana"] },
        created: T1,
        updated: T2,
        zones: {
          commander: pinned("commander"),
          main: { byName: false, rooted: true, names: ["Cores", "core"], facets: [] },
          side: { byName: true, rooted: true, names: ["Sideboards", "current"], facets: [] },
        },
      },
      {
        path: ["Decks", "Atraxa v1.2", "commander"],
        type: "checklist",
        unlisted: "excluded",
        created: T1,
        updated: T2,
        cards: [
          {
            bucket: { card: "Atraxa, Praetors' Voice", oracle: ATRAXA, printing: { set: "2xm", number: "190", lang: "en" }, attrs: {} },
            min: 1,
            max: 1,
            added: T1,
          },
        ],
      },
      {
        path: ["Decks", "Atraxa v1.2", "maybe"],
        type: "checklist",
        unlisted: "any",
        cards: [{ bucket: { card: "Doubling Season", attrs: {} }, min: 1, max: null }],
      },
      {
        path: ["Decks", "Atraxa v1.2", "piles"],
        type: "arrangement",
        of: { byName: false, rooted: true, names: ["Decks", "Atraxa v1.2"], facets: [] },
        piles: [
          { name: "Ramp", cards: [{ bucket: { card: "Sol Ring", oracle: SOL, attrs: {} } }] },
          { name: "Draw", query: ":draw" },
        ],
      },
      {
        path: ["Cores", "core"],
        type: "checklist",
        unlisted: "excluded",
        notes: "shared by three decks",
        cards: [{ bucket: { card: "Sol Ring", oracle: SOL, attrs: {} }, min: 1, max: 1 }],
      },
      { path: ["Empty"], type: "folder", notes: "for later" },
    ],
  };
}

const load = (body: string) => loadV5(`format = "decklab-library"\nversion = 5\n${body}`);

describe("library file, version 5", () => {
  it("round-trips: load(dump(lib)) is lib", () => {
    const lib = sample();
    expect(loadV5(dumpV5(lib))).toEqual(canonicalV5(lib));
  });

  it("dumps to the same text twice", () => {
    const text = dumpV5(sample());
    expect(dumpV5(loadV5(text))).toBe(text);
  });

  it("writes a zone inline when it is the deck's own child with a decklist's defaults", () => {
    const text = dumpV5(sample());
    expect(text).toContain("[asset.zones]\ncommander = [");
    expect(text).toContain("main = '/Cores/core'");
    expect(text).toContain("side = '&/Sideboards/current'");
    expect(text).not.toContain("path = '/Decks/\"Atraxa v1.2\"/commander'");
  });

  it("writes a zone as its own asset when it has anything of its own", () => {
    const lib = sample();
    const commander = lib.assets[6];
    commander.notes = "the face of the deck";
    const text = dumpV5(lib);
    expect(text).toContain("commander = 'commander'");
    expect(text).toContain("path = '/Decks/\"Atraxa v1.2\"/commander'");
    expect(loadV5(text)).toEqual(canonicalV5(lib));
  });

  it("quotes names in paths, as literal strings", () => {
    expect(dumpV5(sample())).toContain(`path = '/"St. Louis"/"Trade/Keep"'`);
  });

  it("leaves out what is absent, and fills nothing in", () => {
    const lib = load(`
[[asset]]
path = '/Box'
type = "place"
cards = [ { card = "Sol Ring", qty = 2 } ]
`);
    expect(lib.assets[0]).toEqual({
      path: ["Box"],
      type: "place",
      cards: [{ bucket: { card: "Sol Ring", attrs: {} }, qty: 2 }],
    });
  });

  it("takes a line that says which card by any means, and refuses one that does not", () => {
    const lib = load(`
[[asset]]
path = '/Box'
type = "place"
cards = [
  { qty = 1, set = "c21", number = "263" },
  { oracle = "${SOL}", qty = 1 },
  { card = "Sol Ring", qty = 1, finish = "foil" },
]
`);
    expect(lib.assets).toHaveLength(1);
    expect(() =>
      load(`[[asset]]\npath = '/Box'\ntype = "place"\ncards = [ { qty = 1, finish = "foil" } ]`),
    ).toThrow(/which card/);
  });

  it("takes `pool` and lets the key decide which kind", () => {
    const lib = load(`
[[asset]]
path = '/q'
type = "pool"
query = "t:land"

[[asset]]
path = '/l'
type = "pool"
cards = []
`);
    expect(lib.assets.map((a) => a.type)).toEqual(["query pool", "list pool"]);
  });

  it("refuses what a hand-written file could get wrong", () => {
    const cases: [string, RegExp][] = [
      [`[[asset]]\npath = '/a'\ntype = "place"\ncolour = "red"`, /unknown key `colour`/],
      [`[[asset]]\npath = '/a'\ntype = "binder"`, /unknown type "binder"/],
      [`[[asset]]\npath = '/a'\ntype = "pool"\nquery = "x"\ncards = []`, /not both/],
      [`[[asset]]\npath = '/a'\ntype = "pool"`, /needs `cards` or `query`/],
      [`[[asset]]\npath = '/a'\ntype = "place"\ncards = [ { card = "X", qty = 1, set = "c21" } ]`, /both `set` and `number`/],
      [`[[asset]]\npath = '/a'\ntype = "place"\ncards = [ { card = "X", qty = 1, attrs = { signed = true } } ]`, /not declared/],
      [`[[asset]]\npath = '/a'\ntype = "place"\ncards = [ { card = "X", qty = 1 }, { card = "X", qty = 2 } ]`, /same bucket/],
      [`[[asset]]\npath = '/a'\ntype = "checklist"\nunlisted = "any"\ncards = [ { card = "X", qty = 1, min = 1 } ]`, /exact/],
      [`[[asset]]\npath = '/a'\ntype = "checklist"\nunlisted = "any"\ncards = [ { card = "X", min = 3, max = 1 } ]`, /below/],
      [`[[asset]]\npath = '/a'\ntype = "place"\n\n[[asset]]\npath = '/a'\ntype = "place"`, /two assets/],
      [`[[asset]]\npath = '/a/b'\ntype = "place"\n\n[[asset]]\npath = '/a'\ntype = "place"`, /before its parent/],
      [`[[asset]]\npath = '/d'\ntype = "deck"\n\n[asset.zones]\nmain = '/nowhere'`, /nothing at \/nowhere/],
      [`[[asset]]\npath = '/p'\ntype = "place"\n\n[[asset]]\npath = '/d'\ntype = "deck"\n\n[asset.zones]\nmaybe = '/p'`, /unknown key `maybe`/],
      [`[[asset]]\npath = '/d'\ntype = "deck"\n\n[[asset]]\npath = '/x'\ntype = "arrangement"\nof = '/d.oracle.arranged.by_size'\npiles = []`, /no facet/],
      [`[[asset]]\npath = '/f'\ntype = "folder"\n\n[[asset]]\npath = '/x'\ntype = "arrangement"\nof = '/f'\npiles = []`, /a folder, not a deck/],
    ];
    for (const [body, error] of cases) {
      expect(() => load(body), body).toThrow(LibraryFormatError);
      expect(() => load(body), body).toThrow(error);
    }
  });

  it("accepts a facet chain the ontology declares, and a by-name reference to nothing yet", () => {
    expect(() =>
      load(`
[[asset]]
path = '/d'
type = "deck"
shows = '.oracle.arranged.by_type'

[asset.zones]
main = '&/not yet'
`),
    ).not.toThrow();
  });

  it("points a schema 4 file at the converter", () => {
    expect(() => loadV5('format = "decklab-library"\nschema = 4\n')).toThrow(/decklab convert/);
  });
});
