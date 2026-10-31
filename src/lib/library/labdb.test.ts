import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sqlOver } from "../sqlOver";
import { readLab, writeLab } from "./labdb";
import { dumpV5, LibraryFormatError, loadV5 } from "./v5";

const MIGRATIONS = join(__dirname, "../../../src-tauri/migrations");

const SOL = "oracle-sol";
const BOLT = "oracle-bolt";
const DELVER = "oracle-delver";

/** A card store holding a few printings. */
function store() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(MIGRATIONS, "cache/001_store.sql"), "utf8"));
  const insert = db.prepare(
    `INSERT INTO cards (id, oracle_id, name, set_code, set_name, collector_number, rarity, layout, data, cached_at)
     VALUES (?, ?, ?, ?, 'Set', ?, 'common', 'normal', ?, '2026-01-01')`,
  );
  const card = (id: string, oracle: string, name: string, set: string, number: string, lang = "en") =>
    insert.run(id, oracle, name, set, number, JSON.stringify({ lang }));
  card("sol-c21", SOL, "Sol Ring", "c21", "263");
  card("sol-cmr", SOL, "Sol Ring", "cmr", "472");
  card("sol-cmr-ja", SOL, "Sol Ring", "cmr", "472", "ja");
  card("bolt-m10", BOLT, "Lightning Bolt", "m10", "146");
  card("delver-isd", DELVER, "Delver of Secrets // Insectile Aberration", "isd", "51");
  return db;
}

/** A fresh lab database: today's migrations, then the lab's. */
function lab() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  db.exec(readFileSync(join(MIGRATIONS, "lab/1000_assets.sql"), "utf8"));
  return db;
}

const noFetch = () => {
  throw new Error("must not fetch");
};

const FILE = `format = "decklab-library"
version = 5

[attributes]
condition = "condition"

[[asset]]
path = '/Binders/"St. Louis"'
type = "place"
storage = "binder"
created = 2026-03-01T14:02:11.000Z
updated = 2026-03-01T14:02:11.000Z
cards = [
  { card = "Lightning Bolt", oracle = "${BOLT}", qty = 4, set = "m10", number = "146", attrs = { condition = "LP" }, added = 2026-03-01T14:05:00.000Z },
  { card = "Sol Ring", oracle = "${SOL}", qty = 2 },
  { card = "Sol Ring", oracle = "${SOL}", qty = 1, set = "cmr", number = "472", lang = "ja", finish = "foil" },
]

[[asset]]
path = '/Decks/Izzet'
type = "decklist"
format = "commander"
shows = '.arranged.by_mana'
created = 2026-03-01T14:02:11.000Z
updated = 2026-03-01T14:02:11.000Z

[asset.zones]
main = [
  { card = "Lightning Bolt", oracle = "${BOLT}", qty = 1, set = "m10", number = "146" },
  { card = "Sol Ring", oracle = "${SOL}", qty = 1 },
]
side = '&/Sideboards/current'

[[asset]]
path = '/Decks/Izzet/maybe'
type = "checklist"
on = '/Binders/"St. Louis"'
created = 2026-03-01T14:02:11.000Z
updated = 2026-03-01T14:02:11.000Z
cards = [
  { card = "Delver of Secrets // Insectile Aberration", oracle = "${DELVER}", min = 1 },
]

[[asset]]
path = '/Decks/Izzet/piles'
type = "arrangement"
of = '/Decks/Izzet'
created = 2026-03-01T14:02:11.000Z
updated = 2026-03-01T14:02:11.000Z
piles = [
  { name = "Burn", cards = [
    { card = "Lightning Bolt", oracle = "${BOLT}", set = "m10", number = "146" },
  ] },
  { name = "Rocks", query = "t:artifact" },
]

[[asset]]
path = '/Built/Izzet'
type = "deck"
list = '/Decks/Izzet'
shows = '/Decks/Izzet/piles'
created = 2026-03-01T14:02:11.000Z
updated = 2026-03-01T14:02:11.000Z

[asset.zones]
main = [
  { card = "Lightning Bolt", oracle = "${BOLT}", qty = 1, set = "m10", number = "146" },
]
side = '/Binders/"St. Louis"'

[[asset]]
path = '/pools/cheap'
type = "query pool"
query = "usd<1"
filters = { colors = ["U", "B"], colorField = "identity", colorOp = "containedBy", types = ["Creature"], mvMax = 3 }
created = 2026-03-01T14:02:11.000Z
updated = 2026-03-01T14:02:11.000Z
`;

describe("the lab database, against library file version 5", () => {
  let cards: DatabaseSync;
  let db: DatabaseSync;
  beforeEach(() => {
    cards = store();
    db = lab();
  });

  it("round-trips: dump(read(write(file))) is the file", async () => {
    const summary = await writeLab(sqlOver(db), sqlOver(cards), loadV5(FILE), { fetchMissing: noFetch });
    expect(summary.fetched).toBe(0);
    expect(dumpV5(await readLab(sqlOver(db), sqlOver(cards)))).toBe(dumpV5(loadV5(FILE)));
  });

  it("reads one asset as the whole dump has it, an implied folder included", async () => {
    await writeLab(sqlOver(db), sqlOver(cards), loadV5(FILE), { fetchMissing: noFetch });
    const whole = await readLab(sqlOver(db), sqlOver(cards));
    for (const a of whole.assets) {
      expect((await readLab(sqlOver(db), sqlOver(cards), { only: a.path })).assets).toEqual([a]);
    }
    expect((await readLab(sqlOver(db), sqlOver(cards), { only: ["Binders"] })).assets).toEqual([{ path: ["Binders"], type: "folder" }]);
    expect((await readLab(sqlOver(db), sqlOver(cards), { only: ["Nowhere"] })).assets).toEqual([]);
  });

  it("stores absent as '' and '{}', never NULL, and implied folders as rows", async () => {
    await writeLab(sqlOver(db), sqlOver(cards), loadV5(FILE), { fetchMissing: noFetch });
    const sol = db
      .prepare("SELECT printing_id, finish, attrs FROM lines WHERE oracle_id = ? AND printing_id = ''")
      .get(SOL);
    expect(sol).toEqual({ printing_id: "", finish: "", attrs: "{}" });
    const folders = db.prepare("SELECT name FROM assets WHERE type = 'folder' AND id <> 'root' ORDER BY name").all();
    expect(folders).toEqual([{ name: "Binders" }, { name: "Built" }, { name: "Decks" }, { name: "pools" }]);
  });

  it("follows a pinned reference when its target moves, and writes it rooted once it is not below", async () => {
    await writeLab(sqlOver(db), sqlOver(cards), loadV5(FILE), { fetchMissing: noFetch });
    db.prepare("UPDATE assets SET name = 'Shared core' WHERE name = 'main'").run();
    const text = dumpV5(await readLab(sqlOver(db), sqlOver(cards)));
    expect(text).toContain("main = 'Shared core'");
    expect(text).toContain(`on = '/Binders/"St. Louis"'`);
  });

  it("says which card from a name, a printing or an oracle id, and fills the rest in", async () => {
    const lib = loadV5(`format = "decklab-library"
version = 5

[[asset]]
path = '/Box'
type = "place"
cards = [
  { card = "Delver of Secrets", qty = 1 },
  { qty = 1, set = "c21", number = "263" },
  { oracle = "${BOLT}", qty = 1 },
]
`);
    await writeLab(sqlOver(db), sqlOver(cards), lib, { fetchMissing: noFetch, now: () => "2026-01-02T00:00:00.000Z" });
    const box = (await readLab(sqlOver(db), sqlOver(cards))).assets[0];
    if (box.type !== "place") throw new Error("not a place");
    expect(box.created).toBe("2026-01-02T00:00:00.000Z");
    expect(box.cards.map((l) => l.bucket)).toEqual([
      { card: "Delver of Secrets // Insectile Aberration", oracle: DELVER, attrs: {} },
      { card: "Lightning Bolt", oracle: BOLT, attrs: {} },
      { card: "Sol Ring", oracle: SOL, printing: { set: "c21", number: "263", lang: "en" }, attrs: {} },
    ]);
  });

  it("takes a whole name over a front face (bug 008)", async () => {
    // Secret Lair's reversible Sol Ring: a card of its own, its front face "Sol Ring".
    cards
      .prepare(
        `INSERT INTO cards (id, oracle_id, name, set_code, set_name, collector_number, rarity, layout, data, cached_at)
         VALUES ('sol-rev', 'oracle-sol-rev', 'Sol Ring // Sol Ring', 'sld', 'Set', '1512', 'rare', 'reversible_card', '{"lang":"en"}', '2026-01-01')`,
      )
      .run();
    const lib = loadV5(`format = "decklab-library"
version = 5

[[asset]]
path = '/Box'
type = "place"
cards = [ { card = "Sol Ring", qty = 1 }, { card = "Delver of Secrets", qty = 1 } ]
`);
    await writeLab(sqlOver(db), sqlOver(cards), lib, { fetchMissing: noFetch });
    const box = (await readLab(sqlOver(db), sqlOver(cards))).assets[0];
    if (box.type !== "place") throw new Error("not a place");
    // The front face still names a card no other has whole.
    expect(box.cards.map((l) => l.bucket.oracle).sort()).toEqual([DELVER, SOL]);
  });

  it("refuses a line whose parts disagree, before writing anything", async () => {
    const lib = loadV5(`format = "decklab-library"
version = 5

[[asset]]
path = '/Box'
type = "place"
cards = [
  { card = "Lightning Bolt", qty = 1, set = "c21", number = "263" },
  { oracle = "${BOLT}", qty = 1, set = "c21", number = "263" },
]
`);
    await expect(writeLab(sqlOver(db), sqlOver(cards), lib, { fetchMissing: noFetch })).rejects.toThrow(LibraryFormatError);
    await expect(writeLab(sqlOver(db), sqlOver(cards), lib, { fetchMissing: noFetch })).rejects.toThrow(/that card is Sol Ring/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM assets").get()).toEqual({ n: 1 });
  });

  it("fetches only what the store has never had, once", async () => {
    const lib = loadV5(`format = "decklab-library"
version = 5

[[asset]]
path = '/Box'
type = "place"
cards = [
  { card = "Sol Ring", qty = 1, set = "c21", number = "263" },
  { card = "Counterspell", qty = 1 },
]
`);
    const fetch = vi.fn(async () => {
      cards
        .prepare(
          `INSERT INTO cards (id, oracle_id, name, set_code, set_name, collector_number, rarity, layout, data, cached_at)
           VALUES ('cs', 'oracle-cs', 'Counterspell', 'mh2', 'Set', '267', 'uncommon', 'normal', '{}', '2026-01-01')`,
        )
        .run();
      return { found: [{} as never] };
    });
    const summary = await writeLab(sqlOver(db), sqlOver(cards), lib, { fetchMissing: fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith([{ name: "Counterspell" }]);
    expect(summary.fetched).toBe(1);
  });

  it("loads only into an empty lab", async () => {
    await writeLab(sqlOver(db), sqlOver(cards), loadV5(FILE), { fetchMissing: noFetch });
    await expect(writeLab(sqlOver(db), sqlOver(cards), loadV5(FILE), { fetchMissing: noFetch })).rejects.toThrow(/empty/);
  });
});
