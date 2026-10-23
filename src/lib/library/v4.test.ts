import { describe, expect, it } from "vitest";
import { canonicalV4, dumpV4, LibraryFormatError, loadV4, type V4Library } from "./v4";

const T1 = "2026-03-01T14:02:11.000Z";
const T2 = "2026-10-20T09:15:40.123Z";

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
          { name: "Sol Ring", set: "cmr", number: "472", lang: "en", quantity: 2, finish: "nonfoil", condition: "NM", notes: "", addedAt: T1 },
          { name: "Sol Ring", set: "c21", number: "263", lang: "en", quantity: 1, finish: "foil", condition: "NM", notes: "", addedAt: T2 },
          { name: "Brainstorm", set: "sta", number: "13", lang: "ja", quantity: 1, finish: "nonfoil", condition: "LP", notes: 'from "Dave"\nin a sleeve', addedAt: T1 },
        ],
      },
      {
        name: "Saved: t:artifact",
        kind: "paper",
        quantityKind: "binary",
        notes: "a saved search",
        createdAt: T1,
        updatedAt: T1,
        items: [],
      },
    ],
    decks: [
      {
        name: "Atraxa Superfriends",
        format: "commander",
        notes: "",
        createdAt: T1,
        updatedAt: T2,
        piles: [
          { name: "Ramp", position: 0 },
          { name: "Draw", position: 1 },
        ],
        cards: [
          { name: "Sol Ring", set: "c21", number: "263", lang: "en", quantity: 1, zone: "main", pile: "Ramp", addedAt: T1 },
          { name: "Atraxa, Praetors' Voice", set: "2xm", number: "190", lang: "en", quantity: 1, zone: "commander", pile: null, addedAt: T1 },
          { name: "Cultivate", set: "m21", number: "177", lang: "en", quantity: 1, zone: "maybe", pile: null, addedAt: T2 },
        ],
      },
    ],
    tags: [{ oracleId: "6ad8011d-3471-4369-9d68-b264cc027487", tag: "ramp" }],
  };
}

describe("library file, schema 4", () => {
  it("round-trips: load(dump(lib)) is lib", () => {
    const lib = sample();
    expect(loadV4(dumpV4(lib))).toEqual(canonicalV4(lib));
  });

  it("dumps equal libraries to equal text, whatever their order", () => {
    const lib = sample();
    const shuffled: V4Library = {
      collections: [...lib.collections].reverse(),
      decks: lib.decks.map((d) => ({ ...d, cards: [...d.cards].reverse() })),
      tags: lib.tags,
    };
    expect(dumpV4(shuffled)).toBe(dumpV4(lib));
  });

  it("is stable: dumping a load gives the same text", () => {
    const text = dumpV4(sample());
    expect(dumpV4(loadV4(text))).toBe(text);
  });

  it("leaves out fields at their default, and writes the rest", () => {
    const text = dumpV4(sample());
    expect(text).toContain(
      '{ card = "Sol Ring", qty = 2, set = "cmr", number = "472", added = 2026-03-01T14:02:11.000Z }',
    );
    expect(text).toContain('finish = "foil"');
    expect(text).toContain('lang = "ja"');
    expect(text).toContain('quantity_kind = "binary"');
    expect(text).not.toContain('kind = "paper"');
    expect(text).not.toContain('zone = "main"');
    expect(text).toContain('zone = "commander"');
    expect(text).toContain('piles = ["Ramp", "Draw"]');
  });

  it("keeps a timestamp it cannot write as a datetime, exactly", () => {
    const lib = sample();
    lib.decks[0].createdAt = "2026-03-01 14:02:11";
    const text = dumpV4(lib);
    expect(text).toContain('created = "2026-03-01 14:02:11"');
    expect(loadV4(text).decks[0].createdAt).toBe("2026-03-01 14:02:11");
  });

  it("keeps pile positions that are not 0, 1, 2…", () => {
    const lib = sample();
    lib.decks[0].piles = [
      { name: "Ramp", position: 2 },
      { name: "Draw", position: 5 },
    ];
    expect(loadV4(dumpV4(lib))).toEqual(canonicalV4(lib));
  });

  describe("refuses, before anything is written", () => {
    const head = 'format = "decklab-library"\nschema = 4\n';

    const fails = (text: string, message: RegExp) =>
      expect(() => loadV4(text)).toThrow(message);

    it("another schema", () => {
      fails('format = "decklab-library"\nschema = 5\n', /schema 5/);
    });

    it("something that is not a library file", () => {
      fails("schema = 4\n", /format/);
      expect(() => loadV4("not = [toml")).toThrow(LibraryFormatError);
    });

    it("two collections with one name", () => {
      fails(
        head +
          '[[collection]]\nname = "Paper"\ncreated = 2026-01-01T00:00:00.000Z\nupdated = 2026-01-01T00:00:00.000Z\n' +
          '[[collection]]\nname = "Paper"\ncreated = 2026-01-01T00:00:00.000Z\nupdated = 2026-01-01T00:00:00.000Z\n',
        /two collections named "Paper"/,
      );
    });

    it("a card in a pile the deck does not have", () => {
      fails(
        head +
          '[[deck]]\nname = "D"\ncreated = 2026-01-01T00:00:00.000Z\nupdated = 2026-01-01T00:00:00.000Z\n' +
          'cards = [{ card = "Sol Ring", qty = 1, set = "c21", number = "263", pile = "Ramp", added = 2026-01-01T00:00:00.000Z }]\n',
        /deck "D", card 1: no pile named "Ramp"/,
      );
    });

    it("the same printing twice in one zone", () => {
      const line =
        '{ card = "Sol Ring", qty = 1, set = "c21", number = "263", added = 2026-01-01T00:00:00.000Z }';
      fails(
        head +
          '[[deck]]\nname = "D"\ncreated = 2026-01-01T00:00:00.000Z\nupdated = 2026-01-01T00:00:00.000Z\n' +
          `cards = [${line}, ${line}]\n`,
        /same printing in one zone/,
      );
    });

    it("a quantity below one", () => {
      fails(
        head +
          '[[collection]]\nname = "P"\ncreated = 2026-01-01T00:00:00.000Z\nupdated = 2026-01-01T00:00:00.000Z\n' +
          'cards = [{ card = "Sol Ring", qty = 0, set = "c21", number = "263", added = 2026-01-01T00:00:00.000Z }]\n',
        /collection "P", card 1: `qty`/,
      );
    });
  });
});
