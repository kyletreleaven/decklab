import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addMember,
  AssetError,
  assetTree,
  bucketKey,
  bucketsOf,
  builtContents,
  convertAsset,
  createAsset,
  createQueryPool,
  nameAfterSearch,
  deckContents,
  deckList,
  deleteAsset,
  moveAsset,
  lineContents,
  memberContents,
  moveCopy,
  moveLines,
  newDeckFrom,
  poolMembers,
  removeMember,
  renameAsset,
  setDeckList,
  setPoolQuery,
  stepLine,
  stepTarget,
  sumContents,
  sumPlaces,
  targetCounts,
} from "./assets";
import { readLab } from "./library/labdb";
import { writeLab } from "./library/labdb";
import { dumpV5, loadV5 } from "./library/v5";
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
cards = [ { oracle = "sol", min = 1 } ]
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
    const tiles = await lineContents(sqlOver(db), sqlOver(cards), red.id);
    expect(tiles.map((t) => [t.card.name, t.count, t.card.id, t.standIn, t.buckets.length])).toEqual([
      ["Lightning Bolt", 6, "bolt-2x2", false, 3],
      ["Sol Ring", 2, "sol-cmr", true, 1],
    ]);
  });

  it("reads a deck's zones as places: what it does hold", async () => {
    const box = (await assetTree(sqlOver(db)))[1].children[1];
    expect(box.name).toBe("Burn box");
    const zones = await deckContents(sqlOver(db), sqlOver(cards), box.id);
    expect(zones.map((z) => [z.zone, z.target?.path.join("/"), z.tiles.map((t) => [t.card.id, t.count])])).toEqual([
      ["main", "Decks/Burn box/main", [["bolt-m10", 3]]],
      ["side", "Binders/Red", [["bolt-2x2", 6], ["sol-cmr", 2]]],
    ]);
  });

  it("draws Scryfall's pick for a card with no printing, else the newest", async () => {
    const tree = await assetTree(sqlOver(db));
    const zones = await deckContents(sqlOver(db), sqlOver(cards), tree[1].children[0].id);
    expect(zones.map((z) => [z.zone, z.target?.path.join("/"), z.tiles.map((t) => [t.card.id, t.count])])).toEqual([
      ["main", "Decks/Burn/main", [["bolt-2x2", 4]]],
      ["side", "Sideboards/Burn", [["sol-cmr", 1]]],
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

  it("creates a decklist with an empty, exact main", async () => {
    const id = await createAsset(sqlOver(db), "root", "decklist");
    const zones = await deckContents(sqlOver(db), sqlOver(cards), id);
    expect(zones.map((z) => [z.zone, z.target?.path.join("/"), z.target?.type])).toEqual([
      ["main", "New decklist/main", "exact checklist"],
    ]);
  });

  it("converts a place to a checklist and back, and a checklist exact or not, keeping its lines", async () => {
    const id = await createAsset(sqlOver(db), "root", "place");
    db.prepare("INSERT INTO lines (asset_id, oracle_id, qty) VALUES (?, 'bolt', 3)").run(id);
    const kind = () => (db.prepare("SELECT type FROM assets WHERE id = ?").get(id) as { type: string }).type;
    for (const to of ["checklist", "exact checklist", "checklist", "place"] as const) {
      await convertAsset(sqlOver(db), id, to);
      expect(kind()).toBe(to);
    }
    expect(db.prepare("SELECT oracle_id, qty FROM lines WHERE asset_id = ?").all(id)).toEqual([{ oracle_id: "bolt", qty: 3 }]);
    await expect(convertAsset(sqlOver(db), await find("Decks"), "place")).rejects.toThrow(/folder cannot become a place/);
  });

  it("refuses to convert a zone into what its owner cannot have", async () => {
    // A decklist's main is exact; a deck's zones are places.
    await expect(convertAsset(sqlOver(db), await find("Decks/Burn/main"), "checklist")).rejects.toThrow(
      /main zone of decklist “Burn”, which must be an exact checklist/,
    );
    await expect(convertAsset(sqlOver(db), await find("Binders/Red"), "checklist")).rejects.toThrow(
      /side zone of deck “Burn box”, which must be a place/,
    );
    // A decklist's sideboard may be either checklist.
    const side = await createAsset(sqlOver(db), await find("Decks/Burn"), "checklist", { name: "side" });
    db.prepare("UPDATE asset_refs SET target_id = ?, path = NULL, rooted = 0 WHERE role = 'side' AND asset_id = ?").run(
      side,
      await find("Decks/Burn"),
    );
    await convertAsset(sqlOver(db), side, "exact checklist");
    await expect(convertAsset(sqlOver(db), side, "place")).rejects.toThrow(/which must be a checklist/);
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
    // Red's lines, and no one else's.
    expect(db.prepare("SELECT COUNT(*) AS n FROM lines").get()).toEqual({ n: 4 });
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

  it("makes a deck from a decklist: its child, building it, with an empty place per zone", async () => {
    const burn = await find("Decks/Burn");
    const id = await newDeckFrom(sqlOver(db), burn);
    expect(await find("Decks/Burn/deck")).toBe(id);
    expect(await deckList(sqlOver(db), id)).toEqual({ id: burn, path: ["Decks", "Burn"], byName: false });
    const zones = await deckContents(sqlOver(db), sqlOver(cards), id);
    expect(zones.map((z) => [z.zone, z.target?.path.join("/"), z.tiles.length])).toEqual([
      ["main", "Decks/Burn/deck/main", 0],
      ["side", "Decks/Burn/deck/side", 0],
    ]);
    expect(await newDeckFrom(sqlOver(db), burn)).toBe(await find("Decks/Burn/deck 2"));
    // It dumps, and the dump loads.
    const text = dumpV5(await readLab(sqlOver(db), sqlOver(cards)));
    expect(text).toContain("path = '/Decks/Burn/deck'\ntype = \"deck\"\nlist = '/Decks/Burn'");
    expect(() => loadV5(text)).not.toThrow();
  });

  it("repoints a deck, dropping its old `shows` and keeping zones it has", async () => {
    const box = await find("Decks/Burn box");
    const other = await createAsset(sqlOver(db), "root", "decklist");
    db.prepare("INSERT INTO asset_refs VALUES (?, 'shows', NULL, 'Decks/Burn.arranged.by_mana', 1, '')").run(box);
    await setDeckList(sqlOver(db), box, other);
    expect(db.prepare("SELECT role FROM asset_refs WHERE asset_id = ? ORDER BY role").all(box)).toEqual([
      { role: "list" },
      { role: "main" },
      { role: "side" },
    ]);
    // Every deck builds one: the decklist it builds cannot go from under it.
    await expect(deleteAsset(sqlOver(db), other)).rejects.toThrow(/Burn box \(its list\)/);
    await expect(setDeckList(sqlOver(db), box, await find("Binders/Red"))).rejects.toThrow(/only build a decklist/);
    await expect(setDeckList(sqlOver(db), other, box)).rejects.toThrow(/Only a deck/);
  });

  it("draws a deck as its decklist: each card's copies split into held, missing and extra", async () => {
    const box = await find("Decks/Burn box");
    const zones = await builtContents(sqlOver(db), sqlOver(cards), box);
    expect(zones!.map((z) => [z.zone, z.exact, z.asked, z.held, z.tiles.map((t) => [t.card.id, t.count, t.state])])).toEqual([
      ["main", true, 4, 3, [["bolt-m10", 3, "held"], ["bolt-2x2", 1, "missing"]]],
      // The list's sideboard asks for at least one Sol Ring: the second is more, not over.
      ["side", false, 1, 1, [["bolt-2x2", 6, "extra"], ["sol-cmr", 1, "held"], ["sol-cmr", 1, "extra"]]],
    ]);
    // Its decklist gone (only by going around the tree's refusal): nothing to draw it as.
    db.prepare("DELETE FROM assets WHERE id = ?").run(await find("Decks/Burn"));
    expect(await builtContents(sqlOver(db), sqlOver(cards), box)).toBeNull();
  });

  it("keeps a search as a query pool, named after it, and saves a new query into it", async () => {
    const id = await createQueryPool(sqlOver(db), "root", "  t:creature o:proliferate  ");
    const again = await createQueryPool(sqlOver(db), "root", "t:creature o:proliferate");
    const long = await createQueryPool(sqlOver(db), "root", "c:u ".repeat(20));
    const blank = await createQueryPool(sqlOver(db), "root", "");
    const byId = new Map((await assetTree(sqlOver(db))).map((n) => [n.id, n]));
    expect(byId.get(id)).toMatchObject({ name: "t:creature o:proliferate", type: "query pool", query: "t:creature o:proliferate" });
    expect(byId.get(again)?.name).toBe("t:creature o:proliferate 2");
    expect(byId.get(long)?.name).toMatch(/^c:u c:u .*…$/);
    expect(byId.get(blank)).toMatchObject({ name: "Saved search", query: "" });
    await setPoolQuery(sqlOver(db), id, "t:creature o:proliferate c:g");
    expect((await assetTree(sqlOver(db))).find((n) => n.id === id)?.query).toBe("t:creature o:proliferate c:g");
    await expect(setPoolQuery(sqlOver(db), await find("Binders/Red"), "x")).rejects.toThrow(/Only a query pool/);
  });

  it("names a query pool after its whole saved search, filters and all, on asking", async () => {
    const id = await createQueryPool(sqlOver(db), "root", "o:proliferate", { filters: { types: ["Creature"] }, name: "mine" });
    await setPoolQuery(sqlOver(db), id, "o:proliferate", { filters: { types: ["Creature"], mvMax: 3 } });
    expect(await nameAfterSearch(sqlOver(db), id)).toBe("o:proliferate t:creature mv<=3");
    // Its own name is not a clash; a sibling's is.
    expect(await nameAfterSearch(sqlOver(db), id)).toBe("o:proliferate t:creature mv<=3");
    const twin = await createQueryPool(sqlOver(db), "root", "o:proliferate", { filters: { types: ["Creature"], mvMax: 3 }, name: "other" });
    expect(await nameAfterSearch(sqlOver(db), twin)).toBe("o:proliferate t:creature mv<=3 2");
    await expect(nameAfterSearch(sqlOver(db), await find("Binders/Red"))).rejects.toThrow(/Only a query pool/);
  });

  it("draws a checklist a tile per line: its lines overlap, so a card's total means nothing", async () => {
    const id = await createAsset(sqlOver(db), "root", "checklist");
    await stepLine(sqlOver(db), id, { oracleId: "bolt" }, 1);
    await stepLine(sqlOver(db), id, { oracleId: "bolt", printingId: "bolt-m10" }, 1);
    await stepLine(sqlOver(db), id, { oracleId: "bolt" }, 1);
    const per = await lineContents(sqlOver(db), sqlOver(cards), id, { by: "line" });
    expect(per.map((t) => [t.card.id, t.count, t.standIn])).toEqual([
      ["bolt-2x2", 2, true],
      ["bolt-m10", 1, false],
    ]);
    expect((await lineContents(sqlOver(db), sqlOver(cards), id)).map((t) => t.count)).toEqual([3]);
  });

  it("searches an asset's lines locally: a printing-level term is unknown on a line with no printing", async () => {
    const id = await createAsset(sqlOver(db), "root", "checklist");
    for (const b of [{ oracleId: "bolt" }, { oracleId: "bolt", printingId: "bolt-m10" }, { oracleId: "sol" }, { oracleId: "sol", printingId: "sol-c21" }])
      await stepLine(sqlOver(db), id, b, 1);
    const found = async (query: string) =>
      (await lineContents(sqlOver(db), sqlOver(cards), id, { by: "line", query })).map((t) =>
        t.standIn ? `${t.oracleId} any` : t.card.id,
      );
    expect(await found("name:bolt")).toEqual(["bolt any", "bolt-m10"]);
    // Unknown matches neither way, whichever way it is asked.
    expect(await found("s:m10")).toEqual(["bolt-m10"]);
    expect(await found("-s:m10")).toEqual(["sol-c21"]);
    expect(await found("r<rare")).toEqual(["bolt-m10", "sol-c21"]);
    expect(await found("-a:anyone")).toEqual(["bolt-m10", "sol-c21"]);
    // A true `or` needs no answer from the unknown side; an `and` does.
    expect(await found("s:m10 or name:sol")).toEqual(["bolt-m10", "sol any", "sol-c21"]);
    expect(await found("s:c21 name:sol")).toEqual(["sol-c21"]);
    expect(await found("")).toHaveLength(4);
    await expect(found("s:")).rejects.toThrow();
  });

  it("steps a target's line, as its type takes it", async () => {
    const red = await find("Binders/Red");
    const m10 = { oracleId: "bolt", printingId: "bolt-m10", attrs: {} };
    const counts = () => targetCounts(sqlOver(db), { id: red, type: "place" });
    expect((await counts()).get(bucketKey(m10))).toBe(2);
    await stepTarget(sqlOver(db), { id: red, type: "place" }, m10, -1);
    await stepTarget(sqlOver(db), { id: red, type: "place" }, m10, -1);
    expect((await counts()).has(bucketKey(m10))).toBe(false);
    await expect(stepLine(sqlOver(db), red, m10, -1)).rejects.toThrow(/none of that/);
    const pool = await createAsset(sqlOver(db), "root", "list pool");
    await stepTarget(sqlOver(db), { id: pool, type: "list pool" }, m10, 1);
    expect((await targetCounts(sqlOver(db), { id: pool, type: "list pool" })).get(bucketKey(m10))).toBe(1);
    await expect(stepLine(sqlOver(db), pool, m10, 1)).rejects.toThrow(/Only a place or checklist/);
  });

  it("moves a copy between places, the whole bucket with it", async () => {
    const red = await find("Binders/Red");
    const box = await createAsset(sqlOver(db), "root", "place");
    const foil = { oracleId: "sol", finish: "foil", attrs: { signed: true } };
    await stepLine(sqlOver(db), red, foil, 1);
    await moveCopy(sqlOver(db), red, box, foil);
    expect((await targetCounts(sqlOver(db), { id: red, type: "place" })).has(bucketKey(foil))).toBe(false);
    expect((await targetCounts(sqlOver(db), { id: box, type: "place" })).get(bucketKey(foil))).toBe(1);
    await expect(moveCopy(sqlOver(db), red, box, foil)).rejects.toThrow(/none of that/);
    await expect(moveCopy(sqlOver(db), red, await find("Sideboards/Burn"), { oracleId: "bolt" })).rejects.toThrow(
      /from one place to another/,
    );
  });

  it("changes a bucket by moving n of it to another: split, merge, clear, and checked", async () => {
    const red = await find("Binders/Red");
    const at = (b: Parameters<typeof bucketKey>[0]) => ({ assetId: red, bucket: b });
    const any = { oracleId: "bolt" };
    const m10 = { oracleId: "bolt", printingId: "bolt-m10" };
    const lp = { oracleId: "bolt", printingId: "bolt-m10", finish: "foil", attrs: { condition: "LP" } };
    const holds = async () =>
      Object.fromEntries((await bucketsOf(sqlOver(db), { id: red, type: "place" }, "bolt")).map((l) => [bucketKey(l.bucket), l.qty]));
    // Red: 2 M10, 3 2X2, 1 unrecorded. Learn one unrecorded copy is M10: merges.
    await moveLines(sqlOver(db), sqlOver(cards), at(any), at(m10), 1);
    expect((await holds())[bucketKey(m10)]).toBe(3);
    expect((await holds())[bucketKey(any)]).toBeUndefined();
    // Split: one of the three is a foil LP.
    await moveLines(sqlOver(db), sqlOver(cards), at(m10), at(lp), 1);
    expect([(await holds())[bucketKey(m10)], (await holds())[bucketKey(lp)]]).toEqual([2, 1]);
    expect(db.prepare("SELECT type FROM attributes WHERE name = 'condition'").get()).toEqual({ type: "condition" });
    // Forget the printing of everything: all of each to the unrecorded bucket.
    for (const [k, n] of Object.entries(await holds())) {
      const [o, p, f, a] = JSON.parse(k) as string[];
      const b = { oracleId: o, ...(p && { printingId: p }), ...(f && { finish: f }), attrs: JSON.parse(a) };
      await moveLines(sqlOver(db), sqlOver(cards), at(b), at({ ...b, printingId: undefined }), n);
    }
    expect(await holds()).toEqual({ [bucketKey(any)]: 5, [bucketKey({ oracleId: "bolt", finish: "foil", attrs: { condition: "LP" } })]: 1 });

    const refused = (to: Parameters<typeof bucketKey>[0], n = 1) => moveLines(sqlOver(db), sqlOver(cards), at(any), at(to), n);
    await expect(refused(any)).rejects.toThrow(/same bucket/);
    await expect(refused(m10, 9)).rejects.toThrow(/only 5/);
    await expect(refused({ oracleId: "bolt", printingId: "sol-c21" })).rejects.toThrow(/another card|its card/);
    await expect(refused({ oracleId: "sol" })).rejects.toThrow(/not its card/);
    await expect(refused({ oracleId: "bolt", attrs: { colour: "red" } })).rejects.toThrow(/not an attribute/);
    await expect(refused({ oracleId: "bolt", attrs: { condition: "great" } })).rejects.toThrow(/cannot be/);

    // A pool's member changes whole; a checklist's line changes as a place's does.
    const pool = await createAsset(sqlOver(db), "root", "list pool");
    await addMember(sqlOver(db), pool, m10);
    await moveLines(sqlOver(db), sqlOver(cards), { assetId: pool, bucket: m10 }, { assetId: pool, bucket: any }, 1);
    expect([...(await poolMembers(sqlOver(db), pool))]).toEqual([bucketKey(any)]);
  });

  it("makes a bucket a member of a list pool, and takes it out again", async () => {
    const pool = await createAsset(sqlOver(db), "root", "list pool");
    const anySol = { oracleId: "sol" };
    const c21 = { oracleId: "sol", printingId: "sol-c21" };
    const m10 = { oracleId: "bolt", printingId: "bolt-m10" };
    await addMember(sqlOver(db), pool, anySol);
    await addMember(sqlOver(db), pool, c21);
    await addMember(sqlOver(db), pool, c21); // already a member: nothing changes
    await addMember(sqlOver(db), pool, m10);
    const m = await poolMembers(sqlOver(db), pool);
    expect(m.size).toBe(3);
    expect([anySol, c21, { oracleId: "sol", printingId: "sol-cmr" }].map((b) => m.has(bucketKey(b)))).toEqual([
      true,
      true,
      false,
    ]);

    // One tile per card; a card with no printing given draws its stand-in.
    const tiles = await memberContents(sqlOver(db), sqlOver(cards), pool);
    expect(tiles.map((t) => [t.card.id, t.count])).toEqual([
      ["bolt-m10", 1],
      ["sol-c21", 2],
    ]);

    // Out goes that bucket only: C21 stays.
    await removeMember(sqlOver(db), pool, anySol);
    expect((await poolMembers(sqlOver(db), pool)).has(bucketKey(c21))).toBe(true);
    await removeMember(sqlOver(db), pool, c21);
    expect([...(await poolMembers(sqlOver(db), pool))]).toEqual([bucketKey(m10)]);
    await expect(addMember(sqlOver(db), await find("Binders/Red"), anySol)).rejects.toThrow(/Only a list pool/);
  });

  it("sums a collection's children, recursively: a deck by its zones, a folder not at all", async () => {
    const paper = await createAsset(sqlOver(db), "root", "sum", { name: "Paper" });
    await moveAsset(sqlOver(db), await find("Binders"), paper);
    await moveAsset(sqlOver(db), await find("Decks/Burn box"), paper);
    await moveAsset(sqlOver(db), await find("Sideboards/Burn"), paper);
    // Binders is a folder: it only organises, so Red is not counted yet.
    expect((await sumPlaces(sqlOver(db), paper)).map((p) => p.name)).toEqual(["Burn box › main"]);

    await convertAsset(sqlOver(db), await find("Paper/Binders"), "sum");
    // Red is the deck's side zone too, but a child of Binders: counted once.
    expect((await sumPlaces(sqlOver(db), paper)).map((p) => p.name)).toEqual(["Binders › Red", "Burn box › main"]);
    const tiles = await sumContents(sqlOver(db), sqlOver(cards), paper);
    expect(
      // Place by place; within one, in no order of their own.
      tiles.map((t) => [t.card.name, t.count, t.buckets.map((b) => `${b.place?.name}: ${b.qty}`).sort()]),
    ).toEqual([
      ["Lightning Bolt", 9, ["Binders › Red: 1", "Binders › Red: 2", "Binders › Red: 3", "Burn box › main: 3"]],
      ["Sol Ring", 2, ["Binders › Red: 2"]],
    ]);
    // A search narrows it as it does a place.
    expect((await sumContents(sqlOver(db), sqlOver(cards), paper, { query: "s:m10" })).map((t) => t.count)).toEqual([5]);

    // The same bucket in two places is two buckets, each its place's.
    const m10 = (await bucketsOf(sqlOver(db), { id: paper, type: "sum" }, "bolt")).filter((b) => b.bucket.printingId === "bolt-m10");
    expect(m10.map((b) => [b.place?.id, b.qty])).toEqual([
      [await find("Paper/Binders/Red"), 2],
      [await find("Paper/Burn box/main"), 3],
    ]);
  });

  it("converts a folder to a sum and back, unless a checklist is checked on it", async () => {
    const binders = await find("Binders");
    await convertAsset(sqlOver(db), binders, "sum");
    expect((await assetTree(sqlOver(db)))[0].type).toBe("sum");
    await convertAsset(sqlOver(db), binders, "folder");
    expect((await assetTree(sqlOver(db)))[0].type).toBe("folder");

    await convertAsset(sqlOver(db), binders, "sum");
    db.prepare("INSERT INTO asset_refs (asset_id, role, target_id, path, rooted, facets) VALUES (?, 'on', ?, NULL, 0, '')").run(
      await find("Sideboards/Burn"),
      binders,
    );
    await expect(convertAsset(sqlOver(db), binders, "folder")).rejects.toThrow(/checked on it/);
  });

  it("dumps and loads a sum, empty or not", async () => {
    const paper = await createAsset(sqlOver(db), "root", "sum", { name: "Paper" });
    await createAsset(sqlOver(db), "root", "sum", { name: "Empty" });
    await moveAsset(sqlOver(db), await find("Binders"), paper);
    const text = dumpV5(await readLab(sqlOver(db), sqlOver(cards)));
    expect(text).toContain(`path = '/Paper'\ntype = "sum"`);
    expect(text).toContain(`path = '/Empty'\ntype = "sum"`);
    expect(dumpV5(loadV5(text))).toBe(text);
  });
});
