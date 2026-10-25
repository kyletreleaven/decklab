import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  completePrintings,
  freshById,
  freshBySetNumber,
  freshDefaults,
  markPrintingsFetched,
  recordDefaults,
  setNumberKey,
  storeCards,
  TTL_MS,
} from "./store";
import type { Sql } from "./sql";
import { sqlOver } from "./sqlOver";
import type { Card } from "./types";

const MIGRATIONS = join(__dirname, "../../src-tauri/migrations");
const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const FRESH = new Date(NOW - 1000).toISOString();
const STALE = new Date(NOW - TTL_MS - 1000).toISOString();

function card(id: string, over: Partial<Card> & { lang?: string } = {}): Card {
  const { lang = "en", ...rest } = over;
  return {
    id,
    oracleId: `o-${id}`,
    name: `Card ${id}`,
    setCode: "tst",
    setName: "Test",
    collectorNumber: id,
    releasedAt: "2020-01-01",
    rarity: "common",
    layout: "normal",
    manaCost: null,
    cmc: 0,
    typeLine: "Artifact",
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
    data: { lang },
    ...rest,
  };
}

let store: Sql;

beforeEach(() => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(MIGRATIONS, "cache/001_store.sql"), "utf8"));
  store = sqlOver(db);
});

describe("the card store", () => {
  it("answers by id only while a card is fresh", async () => {
    await storeCards(store, [card("a")], FRESH);
    await storeCards(store, [card("b")], STALE);

    const rows = await freshById(store, ["a", "b", "c"], NOW);
    expect(rows.map((r) => r.card.id)).toEqual(["a"]);
    expect(rows[0].cachedAt).toBe(FRESH);
  });

  it("answers set + number with the English printing, any case of set code", async () => {
    await storeCards(
      store,
      [
        card("en", { collectorNumber: "7" }),
        card("ja", { collectorNumber: "7", lang: "ja" }),
        card("old", { collectorNumber: "8" }),
      ],
      FRESH,
    );
    await storeCards(store, [card("old", { collectorNumber: "8" })], STALE);

    const rows = await freshBySetNumber(
      store,
      [setNumberKey("TST", "7"), setNumberKey("tst", "8")],
      NOW,
    );
    expect(rows.map((r) => r.card.id)).toEqual(["en"]);
  });

  it("serves a print run only under a fresh stamp", async () => {
    const run = [
      card("p1", { oracleId: "o", releasedAt: "2001-01-01" }),
      card("p2", { oracleId: "o", releasedAt: "2021-01-01" }),
    ];
    await storeCards(store, run, FRESH);
    expect(await completePrintings(store, "o", NOW)).toBeNull();

    await markPrintingsFetched(store, "o", STALE);
    expect(await completePrintings(store, "o", NOW)).toBeNull();

    await markPrintingsFetched(store, "o", FRESH);
    const rows = await completePrintings(store, "o", NOW);
    expect(rows?.map((r) => r.card.id)).toEqual(["p2", "p1"]);
  });
});

describe("default printings", () => {
  const ring = (id: string) => card(id, { oracleId: "ring", name: "Sol Ring" });

  it("answers a bare name, in any case, with the last printing given as the card", async () => {
    await storeCards(store, [ring("r1"), ring("r2")], FRESH);
    await recordDefaults(store, [ring("r1")], FRESH);
    await recordDefaults(store, [ring("r2")], FRESH);

    const hits = await freshDefaults(store, ["  sol RING "], NOW);
    expect(hits.get("sol ring")?.card.id).toBe("r2");
  });

  it("keeps the last of several answers in one batch", async () => {
    await storeCards(store, [ring("r1"), ring("r2")], FRESH);
    await recordDefaults(store, [ring("r1"), ring("r2")], FRESH);
    expect((await freshDefaults(store, ["Sol Ring"], NOW)).get("sol ring")?.card.id).toBe("r2");
  });

  it("matches a front face", async () => {
    const delver = card("d", {
      oracleId: "delver",
      name: "Delver of Secrets // Insectile Aberration",
    });
    await storeCards(store, [delver], FRESH);
    await recordDefaults(store, [delver], FRESH);

    const hits = await freshDefaults(store, ["Delver of Secrets"], NOW);
    expect(hits.get("delver of secrets")?.card.id).toBe("d");
  });

  it("misses a card Scryfall never gave as the card", async () => {
    await storeCards(store, [ring("r1")], FRESH);
    expect((await freshDefaults(store, ["Sol Ring"], NOW)).size).toBe(0);
  });

  it("misses when the default, or its printing, is stale", async () => {
    await storeCards(store, [ring("r1")], FRESH);
    await recordDefaults(store, [ring("r1")], STALE);
    expect((await freshDefaults(store, ["Sol Ring"], NOW)).size).toBe(0);

    await recordDefaults(store, [ring("r1")], FRESH);
    await storeCards(store, [ring("r1")], STALE);
    expect((await freshDefaults(store, ["Sol Ring"], NOW)).size).toBe(0);
  });

  it("prefers a full name to a front face, and misses when a name is ambiguous", async () => {
    const full = card("f", { oracleId: "full", name: "Fire" });
    const split = card("s", { oracleId: "split", name: "Fire // Ice" });
    const twin = card("t", { oracleId: "twin", name: "Fire // Brimstone" });
    await storeCards(store, [full, split, twin], FRESH);
    await recordDefaults(store, [full, split, twin], FRESH);

    expect((await freshDefaults(store, ["Fire"], NOW)).get("fire")?.card.id).toBe("f");

    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync(join(MIGRATIONS, "cache/001_store.sql"), "utf8"));
    const other = sqlOver(db);
    await storeCards(other, [split, twin], FRESH);
    await recordDefaults(other, [split, twin], FRESH);
    expect((await freshDefaults(other, ["Fire"], NOW)).size).toBe(0);
  });
});

describe("starting the store from decklab.db", () => {
  it("runs on a copy of the user schema once the user tables are gone", () => {
    const db = new DatabaseSync(":memory:");
    for (const file of ["001_init.sql", "002_piles.sql", "003_oracle_fetches.sql", "004_quantity_kind.sql"]) {
      db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    }
    for (const table of ["deck_cards", "deck_piles", "decks", "collection_items", "collections", "card_tags"]) {
      db.exec(`DROP TABLE ${table}`);
    }
    db.exec(readFileSync(join(MIGRATIONS, "cache/001_store.sql"), "utf8"));

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(["cards", "default_printings", "oracle_fetches"]);
  });
});
