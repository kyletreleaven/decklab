import { describe, expect, it } from "vitest";
import {
  exportCollection,
  exportDeck,
  parseDecklist,
  parseLine,
  splitCsvRow,
} from "./decklist";
import type { Card, CollectionItem, DeckEntry } from "./types";

/** Minimal Card stand-in; only the fields the serialisers read are populated. */
function card(
  name: string,
  setCode: string,
  collectorNumber: string,
  extra: Partial<Card> = {},
): Card {
  return {
    id: `${setCode}-${collectorNumber}`,
    oracleId: `oracle-${name}`,
    name,
    setCode,
    setName: setCode.toUpperCase(),
    collectorNumber,
    releasedAt: null,
    rarity: "common",
    layout: "normal",
    manaCost: "{1}",
    cmc: 1,
    typeLine: "Creature",
    oracleText: "",
    power: null,
    toughness: null,
    loyalty: null,
    colors: "",
    colorIdentity: "",
    keywords: [],
    legalities: {},
    prices: {},
    imageSmall: null,
    imageNormal: null,
    imageArtCrop: null,
    edhrecRank: null,
    reserved: false,
    digital: false,
    data: {},
    ...extra,
  };
}

function entry(
  quantity: number,
  zone: DeckEntry["zone"],
  c: Card,
): DeckEntry {
  return {
    id: `entry-${c.id}-${zone}`,
    deckId: "deck",
    cardId: c.id,
    quantity,
    zone,
    pileId: null,
    card: c,
  };
}

describe("parseLine", () => {
  it("reads a leading quantity", () => {
    expect(parseLine("4 Lightning Bolt", "main")).toMatchObject({
      quantity: 4,
      name: "Lightning Bolt",
    });
  });

  it("accepts 4x and 4 x forms", () => {
    expect(parseLine("4x Lightning Bolt", "main")).toMatchObject({ quantity: 4 });
    expect(parseLine("4 x Lightning Bolt", "main")).toMatchObject({ quantity: 4 });
  });

  it("defaults to one when no quantity is given", () => {
    expect(parseLine("Sol Ring", "main")).toMatchObject({
      quantity: 1,
      name: "Sol Ring",
    });
  });

  it("reads a trailing quantity only when marked with x", () => {
    expect(parseLine("Lightning Bolt x4", "main")).toMatchObject({
      quantity: 4,
      name: "Lightning Bolt",
    });
  });

  it("does not mistake a collector number for a quantity", () => {
    // The regression this guards: "…(M11) 146" must not parse as 146 copies.
    expect(parseLine("Lightning Bolt (M11) 146", "main")).toMatchObject({
      quantity: 1,
      name: "Lightning Bolt",
      setCode: "m11",
      collectorNumber: "146",
    });
  });

  it("reads set codes in parentheses and brackets", () => {
    expect(parseLine("3 Brainstorm [MH2] 42", "main")).toMatchObject({
      quantity: 3,
      name: "Brainstorm",
      setCode: "mh2",
      collectorNumber: "42",
    });
  });

  it("reads a set code with no collector number", () => {
    expect(parseLine("1 Sol Ring (C21)", "main")).toMatchObject({
      name: "Sol Ring",
      setCode: "c21",
      collectorNumber: undefined,
    });
  });

  it("treats Moxfield finish markers as foil", () => {
    expect(parseLine("1 Sol Ring (C21) 263 *F*", "main")).toMatchObject({
      name: "Sol Ring",
      foil: true,
    });
    expect(parseLine("1 Sol Ring *E*", "main")).toMatchObject({ foil: true });
  });

  it("leaves parenthesised card names alone", () => {
    // Set codes are 2-6 alphanumerics, so a real name in brackets is safe.
    expect(parseLine("1 Erase (Not the Urza's Legacy One)", "main")).toMatchObject({
      name: "Erase (Not the Urza's Legacy One)",
      setCode: undefined,
    });
  });

  it("ignores blank input", () => {
    expect(parseLine("   ", "main")).toBeNull();
  });
});

describe("parseDecklist — text formats", () => {
  it("parses an Arena export, skipping the About block", () => {
    const result = parseDecklist(`About
Name Atraxa Superfriends

Commander
1 Atraxa, Praetors' Voice (2XM) 190

Deck
1 Sol Ring (C21) 263
4 Llanowar Elves (M19) 314

Sideboard
2 Mana Leak`);

    expect(result.source).toBe("text");
    expect(result.lines).toHaveLength(4);
    // "Name Atraxa Superfriends" must not become a card.
    expect(result.lines.map((l) => l.name)).not.toContain("Name Atraxa Superfriends");
    expect(result.lines[0]).toMatchObject({
      name: "Atraxa, Praetors' Voice",
      section: "commander",
    });
    expect(result.lines[3]).toMatchObject({ name: "Mana Leak", section: "side" });
  });

  it("parses a bare MTGO-style list as maindeck", () => {
    const result = parseDecklist("4 Lightning Bolt\n2 Counterspell\n24 Island");
    expect(result.lines).toHaveLength(3);
    expect(result.lines.every((l) => l.section === "main")).toBe(true);
    expect(result.lines[2]).toMatchObject({ quantity: 24, name: "Island" });
  });

  it("skips comment lines", () => {
    const result = parseDecklist("// my deck\n# note\n1 Ponder");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].name).toBe("Ponder");
  });

  it("honours section headers written with a colon", () => {
    const result = parseDecklist("Maybeboard:\n1 Ponder");
    expect(result.lines[0].section).toBe("maybe");
  });

  it("respects the requested default section", () => {
    const result = parseDecklist("1 Ponder", "side");
    expect(result.lines[0].section).toBe("side");
  });
});

describe("splitCsvRow", () => {
  it("splits plain fields", () => {
    expect(splitCsvRow("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(splitCsvRow('1,"Atraxa, Praetors\' Voice",2xm')).toEqual([
      "1",
      "Atraxa, Praetors' Voice",
      "2xm",
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(splitCsvRow('"say ""hi""",2')).toEqual(['say "hi"', "2"]);
  });
});

describe("parseDecklist — CSV", () => {
  it("parses a Moxfield-style export", () => {
    const result = parseDecklist(`"Count","Name","Edition","Condition","Language","Foil","Collector Number"
"2","Sol Ring","c21","Near Mint","English","foil","263"
"1","Atraxa, Praetors' Voice","2xm","Near Mint","English","","190"`);

    expect(result.source).toBe("csv");
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({
      quantity: 2,
      name: "Sol Ring",
      setCode: "c21",
      collectorNumber: "263",
      foil: true,
      condition: "Near Mint",
    });
    expect(result.lines[1].foil).toBeUndefined();
  });

  it("parses a ManaBox-style export with differing headers", () => {
    const result = parseDecklist(`Name,Set code,Set name,Collector number,Foil,Rarity,Quantity
Llanowar Elves,m19,Core Set 2019,314,normal,common,4
Cultivate,c21,Commander 2021,180,foil,common,1`);

    expect(result.source).toBe("csv");
    expect(result.lines[0]).toMatchObject({ quantity: 4, name: "Llanowar Elves" });
    // "normal" in a Foil column means not foil.
    expect(result.lines[0].foil).toBeUndefined();
    expect(result.lines[1].foil).toBe(true);
  });

  it("does not treat a decklist containing commas as CSV", () => {
    const result = parseDecklist("1 Atraxa, Praetors' Voice\n1 Sol Ring");
    expect(result.source).toBe("text");
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].name).toBe("Atraxa, Praetors' Voice");
  });
});

describe("export", () => {
  const entries = [
    entry(1, "commander", card("Atraxa, Praetors' Voice", "2xm", "190")),
    entry(1, "main", card("Sol Ring", "c21", "263", { typeLine: "Artifact" })),
    entry(4, "main", card("Llanowar Elves", "m19", "314")),
    entry(2, "side", card("Mana Leak", "ema", "52", { typeLine: "Instant" })),
  ];

  it("writes sectioned plain text", () => {
    const out = exportDeck(entries, "text");
    expect(out).toContain("Commander\n1 Atraxa, Praetors' Voice");
    expect(out).toContain("Deck\n");
    expect(out).toContain("Sideboard\n2 Mana Leak");
    // Plain text carries no printing information.
    expect(out).not.toContain("(C21)");
  });

  it("writes Arena format with set and collector number", () => {
    expect(exportDeck(entries, "arena")).toContain("1 Sol Ring (C21) 263");
  });

  it("round-trips through the parser", () => {
    for (const format of ["text", "arena"] as const) {
      const reparsed = parseDecklist(exportDeck(entries, format));
      expect(reparsed.lines).toHaveLength(entries.length);

      const byName = new Map(reparsed.lines.map((l) => [l.name, l]));
      expect(byName.get("Atraxa, Praetors' Voice")?.section).toBe("commander");
      expect(byName.get("Llanowar Elves")?.quantity).toBe(4);
      expect(byName.get("Mana Leak")?.section).toBe("side");
    }
  });

  it("quotes CSV fields containing commas", () => {
    const csv = exportDeck(entries, "csv");
    expect(csv.split("\n")[0]).toBe(
      "Count,Name,Edition,Collector Number,Zone,Mana Value,Type",
    );
    expect(csv).toContain('"Atraxa, Praetors\' Voice"');
  });

  it("exports a collection with finish markers", () => {
    const items: CollectionItem[] = [
      {
        id: "i1",
        collectionId: "c1",
        cardId: "c21-263",
        quantity: 2,
        finish: "foil",
        condition: "NM",
        notes: "",
        card: card("Sol Ring", "c21", "263"),
      },
    ];

    expect(exportCollection(items, "text")).toBe("2 Sol Ring *F*");
    expect(exportCollection(items, "csv")).toContain("2,Sol Ring,C21,263,foil,NM");
  });

  it("round-trips a foil collection line", () => {
    const items: CollectionItem[] = [
      {
        id: "i1",
        collectionId: "c1",
        cardId: "c21-263",
        quantity: 2,
        finish: "foil",
        condition: "NM",
        notes: "",
        card: card("Sol Ring", "c21", "263"),
      },
    ];

    const reparsed = parseDecklist(exportCollection(items, "arena"));
    expect(reparsed.lines[0]).toMatchObject({
      quantity: 2,
      name: "Sol Ring",
      setCode: "c21",
      foil: true,
    });
  });
});
