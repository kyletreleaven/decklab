import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeLab } from "../lib/library/labdb";
import { loadV5 } from "../lib/library/v5";
import { sqlOver } from "../lib/sqlOver";
import { createApp } from "./app";

const MIGRATIONS = join(__dirname, "../../src-tauri/migrations");

function store() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(MIGRATIONS, "cache/001_store.sql"), "utf8"));
  const insert = db.prepare(
    `INSERT INTO cards (id, oracle_id, name, set_code, set_name, collector_number, released_at, rarity, layout, data, cached_at)
     VALUES (?, ?, ?, ?, 'Set', ?, ?, 'common', 'normal', '{"lang":"en"}', '2020-01-01')`,
  );
  insert.run("sol-c21", "sol", "Sol Ring", "c21", "263", "2021-04-23");
  insert.run("bolt-m10", "bolt", "Lightning Bolt", "m10", "146", "2009-07-17");
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
cards = [ { oracle = "bolt", qty = 2 } ]
`;

const auth = { Authorization: "Bearer secret" };

describe("agent API, lab routes", () => {
  let cards: DatabaseSync;
  let db: DatabaseSync;
  let onWrite: ReturnType<typeof vi.fn<() => void>>;
  let app: ReturnType<typeof createApp>;
  beforeEach(async () => {
    cards = store();
    db = lab();
    await writeLab(sqlOver(db), sqlOver(cards), loadV5(FILE), {
      fetchMissing: () => {
        throw new Error("must not fetch");
      },
    });
    onWrite = vi.fn<() => void>();
    app = createApp(async () => "secret", {
      open: async () => ({ lab: sqlOver(db), cards: sqlOver(cards) }),
      onWrite,
    });
  });

  const put = (path: string, body: string, type = "application/json") =>
    app.request(path, { method: "PUT", headers: { ...auth, "Content-Type": type }, body });

  it("serves its guide, behind the token like everything else", async () => {
    expect((await app.request("/guide")).status).toBe(401);
    const res = await app.request("/guide", { headers: auth });
    expect(res.headers.get("content-type")).toMatch(/text\/markdown/);
    expect(await res.text()).toMatch(/^# Using DeckLab's agent API/);
  });

  it("answers only in lab mode", async () => {
    const off = createApp(async () => "secret", { open: async () => null });
    const res = await off.request("/lab/tree", { headers: auth });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/lab mode/);
  });

  it("reads the tree by path, no ids", async () => {
    const res = await app.request("/lab/tree", { headers: auth });
    expect(await res.json()).toEqual([
      { name: "Binders", path: "/Binders", type: "folder", children: [{ name: "Red", path: "/Binders/Red", type: "place", children: [] }] },
    ]);
  });

  it("reads an asset as the library file's object, or says there is none", async () => {
    const red = await (await app.request("/lab/assets/Binders/Red", { headers: auth })).json();
    expect(red).toMatchObject({ path: ["Binders", "Red"], type: "place", cards: [{ qty: 2, bucket: { oracle: "bolt", card: "Lightning Bolt" } }] });
    expect(await (await app.request("/lab/assets/Binders", { headers: auth })).json()).toEqual({ path: ["Binders"], type: "folder" });
    expect((await app.request("/lab/assets/Binders/Blue", { headers: auth })).status).toBe(404);
  });

  it("puts a list pool, making folders, and replaces its members, keeping those kept", async () => {
    const res = await put("/lab/assets/Pools/Golbez/ramp", JSON.stringify({ type: "list pool", cards: [{ card: "Sol Ring" }, { card: "Lightning Bolt", set: "M10", number: "146" }] }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ created: true, members: 2 });
    expect(onWrite).toHaveBeenCalledTimes(1);
    const members = () => db.prepare("SELECT oracle_id, printing_id, added_at FROM pool_members ORDER BY oracle_id").all() as { oracle_id: string; printing_id: string; added_at: string }[];
    const sol = members().find((m) => m.oracle_id === "sol")!;

    const again = await put("/lab/assets/Pools/Golbez/ramp", "1 Sol Ring\n1 Lightning Bolt", "text/plain");
    expect(again.status).toBe(200);
    expect(members().map((m) => [m.oracle_id, m.printing_id])).toEqual([
      ["bolt", ""],
      ["sol", ""],
    ]);
    expect(members().find((m) => m.oracle_id === "sol")!.added_at).toBe(sol.added_at);
  });

  it("puts a query pool, and saves a new query into it", async () => {
    expect((await put("/lab/assets/Searches/cheap", JSON.stringify({ type: "query pool", query: "mv<=2" }))).status).toBe(201);
    expect((await put("/lab/assets/Searches/cheap", JSON.stringify({ type: "query pool", query: "mv<=1" }))).status).toBe(200);
    expect(db.prepare("SELECT query FROM assets WHERE name = 'cheap'").get()).toEqual({ query: "mv<=1" });
  });

  it("refuses what it cannot do, writing nothing", async () => {
    const refused = async (res: Response, status: number, why: RegExp) => {
      expect(res.status).toBe(status);
      expect((await res.json()).error).toMatch(why);
    };
    await refused(await put("/lab/assets/Binders/Red", JSON.stringify({ type: "list pool", cards: [] })), 409, /is a place/);
    await refused(await put("/lab/assets/P", JSON.stringify({ type: "place", cards: [] })), 400, /only pools/);
    await refused(await put("/lab/assets/P", JSON.stringify({ type: "list pool", cards: [{ name: "Sol Ring" }] })), 400, /unknown key `name`/);
    await refused(await put("/lab/assets/P", "{"), 400, /not JSON/);
    // A card the store has never had is named, and never fetched.
    await refused(await put("/lab/assets/P", "1 Mana Crypt", "text/plain"), 400, /fetches nothing:\nMana Crypt/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM assets WHERE name = 'P'").get()).toEqual({ n: 0 });
    expect(onWrite).not.toHaveBeenCalled();
  });
});
