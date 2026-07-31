import { describe, expect, it } from "vitest";
import { categoryOf, commanderIssues, deckStats } from "./deckstats";
import type { Card, DeckEntry } from "./types";

function card(name: string, overrides: Partial<Card> = {}): Card {
  return {
    id: `id-${name}`,
    oracleId: `oracle-${name}`,
    name,
    setCode: "tst",
    setName: "Test",
    collectorNumber: "1",
    releasedAt: null,
    rarity: "common",
    layout: "normal",
    manaCost: null,
    cmc: 0,
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
    ...overrides,
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

describe("categoryOf", () => {
  it("reads an artifact creature as a creature", () => {
    expect(categoryOf(card("Solemn", { typeLine: "Artifact Creature — Golem" }))).toBe(
      "Creature",
    );
  });

  it("reads a land creature as a land", () => {
    // Lands are played as lands regardless of what else they are.
    expect(
      categoryOf(card("Dryad Arbor", { typeLine: "Land Creature — Forest Dryad" })),
    ).toBe("Land");
  });

  it("classifies the ordinary types", () => {
    expect(categoryOf(card("Bolt", { typeLine: "Instant" }))).toBe("Instant");
    expect(categoryOf(card("Wrath", { typeLine: "Sorcery" }))).toBe("Sorcery");
    expect(categoryOf(card("Signet", { typeLine: "Artifact" }))).toBe("Artifact");
    expect(
      categoryOf(card("Jace", { typeLine: "Legendary Planeswalker — Jace" })),
    ).toBe("Planeswalker");
  });
});

describe("deckStats", () => {
  const entries = [
    entry(1, "commander", card("Atraxa", { cmc: 4, manaCost: "{G}{W}{U}{B}", colorIdentity: "WUBG" })),
    entry(1, "main", card("Sol Ring", { cmc: 1, manaCost: "{1}", typeLine: "Artifact" })),
    entry(4, "main", card("Llanowar Elves", { cmc: 1, manaCost: "{G}", colorIdentity: "G" })),
    entry(10, "main", card("Forest", { cmc: 0, typeLine: "Basic Land — Forest" })),
    entry(1, "side", card("Mana Leak", { cmc: 2, manaCost: "{1}{U}", typeLine: "Instant" })),
  ];

  const stats = deckStats(entries);

  it("counts main and commander separately, ignoring the sideboard", () => {
    expect(stats.commanderCount).toBe(1);
    expect(stats.mainCount).toBe(15);
    expect(stats.totalCount).toBe(16);
  });

  it("excludes lands from the average mana value", () => {
    // (4 + 1 + 1*4) / 6 non-land cards = 1.5; the 10 Forests must not drag it down.
    expect(stats.averageMv).toBeCloseTo(1.5, 5);
  });

  it("excludes lands from the curve", () => {
    const atMv0 = stats.curve.find((c) => c.mv === 0)?.count;
    expect(atMv0).toBe(0);
    expect(stats.curve.find((c) => c.mv === 1)?.count).toBe(5);
    expect(stats.curve.find((c) => c.mv === 4)?.count).toBe(1);
  });

  it("counts pips per copy", () => {
    // Four Llanowar Elves contribute four green pips, plus Atraxa's one.
    expect(stats.pips.G).toBe(5);
    expect(stats.pips.W).toBe(1);
    expect(stats.pips.B).toBe(1);
    expect(stats.pips.U).toBe(1);
    // Generic {1} is not a coloured pip.
    expect(stats.pips.R ?? 0).toBe(0);
  });

  it("derives colour identity in WUBRG order", () => {
    expect(stats.colorIdentity).toBe("WUBG");
  });

  it("buckets mana value 7 and above together", () => {
    const big = deckStats([
      entry(1, "main", card("Ulamog", { cmc: 10, typeLine: "Creature" })),
    ]);
    expect(big.curve.find((c) => c.mv === 7)?.count).toBe(1);
  });

  it("counts hybrid pips toward both colours", () => {
    const hybrid = deckStats([
      entry(1, "main", card("Boros Charm", { cmc: 2, manaCost: "{R/W}{R/W}", typeLine: "Instant" })),
    ]);
    expect(hybrid.pips.R).toBe(2);
    expect(hybrid.pips.W).toBe(2);
  });
});

describe("commanderIssues", () => {
  const atraxa = card("Atraxa, Praetors' Voice", {
    typeLine: "Legendary Creature — Phyrexian Angel Horror",
    colorIdentity: "WUBG",
  });

  it("warns when no commander is set", () => {
    const issues = commanderIssues([entry(1, "main", card("Sol Ring"))]);
    expect(issues.some((i) => /no commander/i.test(i.message))).toBe(true);
  });

  it("rejects a non-legendary commander", () => {
    const issues = commanderIssues([
      entry(1, "commander", card("Grizzly Bears", { typeLine: "Creature — Bear" })),
    ]);
    expect(
      issues.some((i) => i.severity === "error" && /cannot be a commander/.test(i.message)),
    ).toBe(true);
  });

  it("accepts a card whose text allows it to be a commander", () => {
    const issues = commanderIssues([
      entry(
        1,
        "commander",
        card("Rowan", {
          typeLine: "Legendary Planeswalker — Rowan",
          oracleText: "Rowan can be your commander.",
        }),
      ),
    ]);
    expect(issues.some((i) => /cannot be a commander/.test(i.message))).toBe(false);
  });

  it("flags cards outside the commander's colour identity", () => {
    const issues = commanderIssues([
      entry(1, "commander", atraxa),
      entry(1, "main", card("Lightning Bolt", { colorIdentity: "R" })),
    ]);
    expect(
      issues.some((i) => i.severity === "error" && /colour identity \(R\)/.test(i.message)),
    ).toBe(true);
  });

  it("allows cards inside the colour identity", () => {
    const issues = commanderIssues([
      entry(1, "commander", atraxa),
      entry(1, "main", card("Counterspell", { colorIdentity: "U" })),
    ]);
    expect(issues.some((i) => /colour identity/.test(i.message))).toBe(false);
  });

  it("flags singleton violations", () => {
    const issues = commanderIssues([
      entry(1, "commander", atraxa),
      entry(4, "main", card("Llanowar Elves", { colorIdentity: "G" })),
    ]);
    expect(issues.some((i) => /breaks the singleton rule/.test(i.message))).toBe(true);
  });

  it("exempts basic lands from the singleton rule", () => {
    const issues = commanderIssues([
      entry(1, "commander", atraxa),
      entry(30, "main", card("Forest", { typeLine: "Basic Land — Forest" })),
    ]);
    expect(issues.some((i) => /singleton/.test(i.message))).toBe(false);
  });

  it("exempts cards that allow any number of copies", () => {
    const issues = commanderIssues([
      entry(1, "commander", atraxa),
      entry(
        9,
        "main",
        card("Persistent Petitioners", {
          colorIdentity: "U",
          oracleText: "A deck can have any number of cards named Persistent Petitioners.",
        }),
      ),
    ]);
    expect(issues.some((i) => /singleton/.test(i.message))).toBe(false);
  });

  it("flags banned cards", () => {
    const issues = commanderIssues([
      entry(1, "commander", atraxa),
      entry(1, "main", card("Black Lotus", { legalities: { commander: "banned" } })),
    ]);
    expect(issues.some((i) => /banned in Commander/.test(i.message))).toBe(true);
  });

  it("reports a deck that is not exactly 100 cards", () => {
    const issues = commanderIssues([
      entry(1, "commander", atraxa),
      entry(50, "main", card("Forest", { typeLine: "Basic Land — Forest" })),
    ]);
    expect(issues.some((i) => /51 cards/.test(i.message))).toBe(true);
  });

  it("is quiet about size for a legal 100-card deck", () => {
    const issues = commanderIssues([
      entry(1, "commander", atraxa),
      entry(99, "main", card("Forest", { typeLine: "Basic Land — Forest" })),
    ]);
    expect(issues.some((i) => /Commander wants exactly 100/.test(i.message))).toBe(false);
  });
});
