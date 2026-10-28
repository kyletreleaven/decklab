import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { AssetError, assetTree, createAsset, deckContents, deleteAsset, moveAsset, placeContents, renameAsset } from "./assets";
import { writeLab } from "./library/labdb";
import { loadV5 } from "./library/v5";
import { sqlOver } from "./sqlOver";

const MIGRATIONS = join(__dirname, "../../src-tauri/migrations");

function store() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(MIGRATIONS, "cache/001_store.sql"), "utf8"));
  const insert = db.prepare(
    `INSERT INTO cards (id, oracle_id, name, set_code, set_name, collector_number, released_at, rarity, layout, data, cached_at)
     VALUES (?, ?, ?, ?, 'Set', ?, ?, 'common', 'normal', '{"lang":"en"}', '2020-01-01')`,
  );
  insert.run("sol-c21", "sol", "Sol Ring", "c21", "263", "2021-04-23");
  insert.run("sol-cmr", "sol", "Sol Ring", "cmr", "472", "2020-11-20");
  insert.run("bolt-m10", "bolt", "Lightning Bolt", "m10", "146", "2009-07-17");
  insert.run("bolt-2x2", "bolt", "Lightning Bolt", "2x2", "117", "2022-07-08");
  // Scryfall gave CMR as Sol Ring, long ago: still its pick.
  db.prepare("INSERT INTO default_printings VALUES ('sol', 'sol-cmr', '2020-01-01')").run();
  return db;
}

function lab() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  db.exec(readFileSync(join(MIGRATIONS, "lab/1000_assets.sql"), "utf8"));
  return db;
}

const FILE = `format = "decklab-library"
version = 5

[[asset]]
path = '/Binders/Red'
type = "place"
cards = [
  { oracle = "bolt", qty = 2, set = "m10", number = "146" },
  { oracle = "bolt", qty = 3, set = "2x2", number = "117" },
  { oracle = "bolt", qty = 1 },
  { oracle = "sol", qty = 2 },
]

[[asset]]
path = '/Decks/Burn'
type = "decklist"

[asset.zones]
main = [ { oracle = "bolt", qty = 4 } ]
side = '&/Sideboards/Burn'

[[asset]]
path = '/Decks/Burn box'
type = "deck"
list = '/Decks/Burn'

[asset.zones]
main = [ { oracle = "bolt", qty = 3, set = "m10", number = "146" } ]
side = '/Binders/Red'

[[asset]]
path = '/Sideboards/Burn'
type = "checklist"
unlisted = "excluded"
cards = [ { oracle = "sol", min = 0, max = 1 } ]
`;

describe("the lab's assets, for display", () => {
  let cards: DatabaseSync;
  let db: DatabaseSync;
  beforeEach(async () => {
    cards = store();
    db = lab();
    await writeLab(sqlOver(db), sqlOver(cards), loadV5(FILE), {
      fetchMissing: () => {
        throw new Error("must not fetch");
      },
    });
  });

  it("reads the tree, implied folders and a deck's inline zone included", async () => {
    const shape = (nodes: Awaited<ReturnType<typeof assetTree>>): unknown =>
      nodes.map((n) => (n.children.length ? [n.name, shape(n.children)] : n.name));
    expect(shape(await assetTree(sqlOver(db)))).toEqual([
      ["Binders", ["Red"]],
      ["Decks", [["Burn", ["main"]], ["Burn box", ["main"]]]],
      ["Sideboards", ["Burn"]],
    ]);
  });

  it("counts every copy of a card together, and draws the printing it holds most of", async () => {
    const red = (await assetTree(sqlOver(db)))[0].children[0];
    const tiles = await placeContents(sqlOver(db), sqlOver(cards), red.id);
    expect(tiles.map((t) => [t.card.name, t.count, t.card.id, t.standIn, t.buckets.length])).toEqual([
      ["Lightning Bolt", 6, "bolt-2x2", false, 3],
      ["Sol Ring", 2, "sol-cmr", true, 1],
    ]);
  });

  it("reads a deck's zones as places: what it does hold", async () => {
    const box = (await assetTree(sqlOver(db)))[1].children[1];
    expect(box.name).toBe("Burn box");
    const zones = await deckContents(sqlOver(db), sqlOver(cards), box.id);
    expect(zones.map((z) => [z.zone, z.target?.path.join("/"), z.tiles.map((t) => [t.card.id, t.count, t.max])])).toEqual([
      ["main", "Decks/Burn box/main", [["bolt-m10", 3, undefined]]],
      ["side", "Binders/Red", [["bolt-2x2", 6, undefined], ["sol-cmr", 2, undefined]]],
    ]);
  });

  it("draws Scryfall's pick for a card with no printing, else the newest", async () => {
    const tree = await assetTree(sqlOver(db));
    const zones = await deckContents(sqlOver(db), sqlOver(cards), tree[1].children[0].id);
    expect(zones.map((z) => [z.zone, z.target?.path.join("/"), z.tiles.map((t) => [t.card.id, t.count, t.max])])).toEqual([
      ["main", "Decks/Burn/main", [["bolt-2x2", 4, 4]]],
      ["side", "Sideboards/Burn", [["sol-cmr", 0, 1]]],
    ]);
  });

  const find = async (path: string) => {
    const walk = (nodes: Awaited<ReturnType<typeof assetTree>>): string | undefined => {
      for (const n of nodes) {
        if (n.path.join("/") === path) return n.id;
        const below = walk(n.children);
        if (below) return below;
      }
    };
    return walk(await assetTree(sqlOver(db)))!;
  };

  it("creates an empty asset, numbering a taken name", async () => {
    const binders = await find("Binders");
    await createAsset(sqlOver(db), binders, "place");
    await createAsset(sqlOver(db), binders, "place");
    await createAsset(sqlOver(db), "root", "checklist");
    expect((await assetTree(sqlOver(db)))[0].children.map((n) => n.name)).toEqual(["New place", "New place 2", "Red"]);
    expect((await assetTree(sqlOver(db))).find((n) => n.name === "New checklist")).toMatchObject({ name: "New checklist", type: "checklist" });
  });

  it("renames, refusing a reserved name or one a sibling has", async () => {
    const red = await find("Binders/Red");
    await renameAsset(sqlOver(db), red, "Crimson");
    expect(await find("Binders/Crimson")).toBe(red);
    await expect(renameAsset(sqlOver(db), red, "..")).rejects.toThrow(AssetError);
    await createAsset(sqlOver(db), await find("Binders"), "place");
    await expect(renameAsset(sqlOver(db), red, "New place")).rejects.toThrow(/already called/);
  });

  it("deletes an asset and everything below it, unless something outside pins it", async () => {
    await expect(deleteAsset(sqlOver(db), await find("Decks/Burn/main"))).rejects.toThrow(/\/Decks\/Burn \(its main\)/);
    // The deck names its sideboard by name: nothing pins it.
    await deleteAsset(sqlOver(db), await find("Sideboards"));
    const side = db.prepare("SELECT path FROM asset_refs WHERE role = 'side'").get();
    expect(side).toEqual({ path: "Sideboards/Burn" });
    await deleteAsset(sqlOver(db), await find("Decks"));
    expect(db.prepare("SELECT COUNT(*) AS n FROM checklist_lines").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM asset_refs").get()).toEqual({ n: 0 });
    expect((await assetTree(sqlOver(db))).map((n) => n.name)).toEqual(["Binders"]);
  });

  it("moves an asset under any other, its pins following, and refuses a loop or a clash", async () => {
    const red = await find("Binders/Red");
    const burn = await find("Decks/Burn");
    await moveAsset(sqlOver(db), red, burn);
    expect(await find("Decks/Burn/Red")).toBe(red);
    // The deck box pins Red as its sideboard: still Red, wherever it is.
    const box = await find("Decks/Burn box");
    const zones = await deckContents(sqlOver(db), sqlOver(cards), box);
    expect(zones.find((z) => z.zone === "side")?.target?.path.join("/")).toBe("Decks/Burn/Red");
    await expect(moveAsset(sqlOver(db), await find("Decks"), burn)).rejects.toThrow(/into itself/);
    await createAsset(sqlOver(db), "root", "place");
    const fresh = await find("New place");
    await renameAsset(sqlOver(db), fresh, "main");
    await expect(moveAsset(sqlOver(db), fresh, burn)).rejects.toThrow(/already called “main”/);
    await moveAsset(sqlOver(db), red, "root");
    expect(await find("Red")).toBe(red);
  });
});
