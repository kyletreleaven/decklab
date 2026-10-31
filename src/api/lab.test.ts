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

  it("replaces a big pool in chunks: hundreds in, hundreds out", async () => {
    const insert = cards.prepare(
      `INSERT INTO cards (id, oracle_id, name, set_code, set_name, collector_number, released_at, rarity, layout, data, cached_at)
       VALUES (?, ?, ?, 'tst', 'Set', ?, '2020-01-01', 'common', 'normal', '{"lang":"en"}', '2020-01-01')`,
    );
    for (let i = 0; i < 250; i++) insert.run(`c${i}`, `o${i}`, `Card ${i}`, String(i));
    const deck = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `1 Card ${from + i}`).join("\n");
    expect(await (await put("/lab/assets/Big", deck(0, 250), "text/plain")).json()).toEqual({ created: true, members: 250 });
    expect(await (await put("/lab/assets/Big", deck(240, 250), "text/plain")).json()).toEqual({ created: false, members: 10 });
    const left = db.prepare("SELECT oracle_id FROM pool_members ORDER BY oracle_id").all() as { oracle_id: string }[];
    expect(left.map((m) => m.oracle_id)).toEqual(Array.from({ length: 10 }, (_, i) => `o${240 + i}`));
  });

  it("puts a query pool, and saves a new query into it", async () => {
    expect((await put("/lab/assets/Searches/cheap", JSON.stringify({ type: "query pool", query: "mv<=2" }))).status).toBe(201);
    expect((await put("/lab/assets/Searches/cheap", JSON.stringify({ type: "query pool", query: "mv<=1" }))).status).toBe(200);
    expect(db.prepare("SELECT query FROM assets WHERE name = 'cheap'").get()).toEqual({ query: "mv<=1" });
  });

  it("keeps a query pool's filters apart from its text, and refuses bad ones", async () => {
    const body = { type: "query pool", query: "o:proliferate", filters: { colors: ["U", "B"], colorField: "identity", colorOp: "containedBy" } };
    expect((await put("/lab/assets/Searches/golbez", JSON.stringify(body))).status).toBe(201);
    const got = await (await app.request("/lab/assets/Searches/golbez", { headers: auth })).json();
    expect(got).toMatchObject({ query: "o:proliferate", filters: body.filters });
    // Saving the text alone clears them.
    await put("/lab/assets/Searches/golbez", JSON.stringify({ type: "query pool", query: "o:proliferate" }));
    expect(db.prepare("SELECT filters FROM assets WHERE name = 'golbez'").get()).toEqual({ filters: null });
    const res = await put("/lab/assets/Searches/golbez", JSON.stringify({ ...body, filters: { colours: ["U"] } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unknown key `colours`/);
  });

  it("puts a decklist as text, zone by zone, and reads it back as text", async () => {
    const at = "/lab/assets/Decklists/Izzet";
    const res = await put(`${at}?type=decklist`, "Commander\n1 Sol Ring\n\nDeck\n2 Lightning Bolt\n1 Sol Ring (C21) 263\n\nMaybeboard\n1 Lightning Bolt *F*", "text/plain");
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ created: true, zones: { commander: 1, main: 3, maybe: 1 } });
    const text = async () => (await app.request(at, { headers: { ...auth, Accept: "text/plain" } })).text();
    expect(await text()).toBe("Commander\n1 Sol Ring\n\nDeck\n2 Lightning Bolt\n1 Sol Ring (C21) 263\n\nMaybeboard\n1 Lightning Bolt *F*\n");
    const lines = () =>
      db.prepare("SELECT a.name AS zone, l.oracle_id, l.qty, l.added_at FROM lines l JOIN assets a ON a.id = l.asset_id ORDER BY zone, oracle_id").all() as {
        zone: string;
        oracle_id: string;
        qty: number;
        added_at: string;
      }[];
    const bolt = lines().find((l) => l.zone === "main" && l.oracle_id === "bolt")!;

    // Only the zone it names: main gets a new count, keeping the line's date; the rest stay.
    expect((await put(at, "Deck\n3 Lightning Bolt", "text/plain")).status).toBe(200);
    expect(await text()).toBe("Commander\n1 Sol Ring\n\nDeck\n3 Lightning Bolt\n\nMaybeboard\n1 Lightning Bolt *F*\n");
    expect(lines().find((l) => l.zone === "main" && l.oracle_id === "bolt")!.added_at).toBe(bolt.added_at);
    // An empty heading empties its zone.
    await put(at, "Maybeboard\n", "text/plain");
    expect(await text()).toBe("Commander\n1 Sol Ring\n\nDeck\n3 Lightning Bolt\n");
    expect(onWrite).toHaveBeenCalledTimes(3);
  });

  it("puts a decklist as JSON, making the zones it names, and refuses a zone it does not own", async () => {
    const at = "/lab/assets/Izzet";
    const body = { type: "decklist", format: "commander", zones: { main: [{ card: "Lightning Bolt", qty: 4 }], side: [{ oracle: "sol" }] } };
    expect(await (await put(at, JSON.stringify(body))).json()).toEqual({ created: true, zones: { main: 4, side: 1 } });
    const me = await (await app.request(at, { headers: auth })).json();
    expect(me).toMatchObject({ type: "decklist", format: "commander", zones: { main: { names: ["main"] }, side: { names: ["side"] } } });

    // Its main repointed at a checklist elsewhere: shared, so not the API's to write.
    db.exec(`INSERT INTO assets (id, parent_id, name, type) VALUES ('core', 'root', 'Core', 'exact checklist')`);
    db.exec(`UPDATE asset_refs SET target_id = 'core' WHERE role = 'main'`);
    const res = await put(at, JSON.stringify({ type: "decklist", zones: { main: [] } }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/its main is not its own/);
    expect((await put(at, JSON.stringify({ type: "decklist", zones: { mian: [] } }))).status).toBe(400);
  });

  it("deletes an asset and what is below it, but not copies, and not what is pinned", async () => {
    await put("/lab/assets/Pools/ramp", "1 Sol Ring", "text/plain");
    const del = (path: string) => app.request(path, { method: "DELETE", headers: auth });
    expect((await del("/lab/assets/Pools")).status).toBe(204);
    expect(db.prepare("SELECT COUNT(*) AS n FROM assets WHERE name IN ('Pools', 'ramp')").get()).toEqual({ n: 0 });
    expect((await del("/lab/assets/Pools")).status).toBe(404);
    const held = await del("/lab/assets/Binders");
    expect(held.status).toBe(409);
    expect((await held.json()).error).toMatch(/copies are recorded/);
    // A checklist a decklist's zone pins.
    await put("/lab/assets/Izzet", JSON.stringify({ type: "decklist", zones: { main: [] } }));
    db.exec(`INSERT INTO assets (id, parent_id, name, type) VALUES ('core', 'root', 'Core', 'exact checklist')`);
    db.exec(`UPDATE asset_refs SET target_id = 'core' WHERE role = 'main'`);
    expect((await del("/lab/assets/Core")).status).toBe(409);
  });

  it("refuses what it cannot do, writing nothing", async () => {
    const refused = async (res: Response, status: number, why: RegExp) => {
      expect(res.status).toBe(status);
      expect((await res.json()).error).toMatch(why);
    };
    await refused(await put("/lab/assets/Binders/Red", JSON.stringify({ type: "list pool", cards: [] })), 409, /is a place/);
    await refused(await put("/lab/assets/P", JSON.stringify({ type: "place", cards: [] })), 400, /"list pool", "query pool" or "decklist"/);
    await refused(await put("/lab/assets/P", JSON.stringify({ type: "list pool", cards: [{ name: "Sol Ring" }] })), 400, /unknown key `name`/);
    await refused(await put("/lab/assets/P", "{"), 400, /not JSON/);
    // A card the store has never had is named, and never fetched.
    await refused(await put("/lab/assets/P", "1 Mana Crypt", "text/plain"), 400, /Not in the card store:\nMana Crypt/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM assets WHERE name = 'P'").get()).toEqual({ n: 0 });
    expect(onWrite).not.toHaveBeenCalled();
  });

  describe("fetching what the store has never had", () => {
    // Stands in for the app's channel: answers from a known list, into the store, and counts.
    const KNOWN: Record<string, [id: string, oracle: string]> = { "Mana Crypt": ["crypt-2xm", "crypt"] };
    let calls: string[][];
    const withFetch = (fail = false) => {
      calls = [];
      return createApp(async () => "secret", {
        open: async () => ({
          lab: sqlOver(db),
          cards: sqlOver(cards),
          fetch: async (ids) => {
            calls.push(ids.map((i) => ("name" in i ? i.name : JSON.stringify(i))));
            if (fail) throw new Error("HTTP 500");
            const found = ids.flatMap((i) => ("name" in i && KNOWN[i.name] ? [i.name] : []));
            for (const name of found) {
              const [id, oracle] = KNOWN[name];
              cards
                .prepare(
                  `INSERT INTO cards (id, oracle_id, name, set_code, set_name, collector_number, released_at, rarity, layout, data, cached_at)
                   VALUES (?, ?, ?, '2xm', 'Set', '1', '2020-01-01', 'mythic', 'normal', '{"lang":"en"}', '2020-01-01')`,
                )
                .run(id, oracle, name);
            }
            return { found: [] };
          },
        }),
        onWrite,
      });
    };
    const putWith = (a: ReturnType<typeof createApp>, path: string, body: string) =>
      a.request(path, { method: "PUT", headers: { ...auth, "Content-Type": "text/plain" }, body });

    it("fetches only the unknown cards, once, then writes", async () => {
      // Twice in the list, once in the request.
      const res = await putWith(withFetch(), "/lab/assets/P", "1 Sol Ring\n1 Mana Crypt\n1 mana crypt");
      expect(res.status).toBe(201);
      expect(calls).toEqual([["Mana Crypt"]]);
      // Now in the store: no second fetch.
      await putWith(withFetch(), "/lab/assets/P", "1 Mana Crypt");
      expect(calls).toEqual([]);
    });

    it("refuses what Scryfall does not know either, writing nothing", async () => {
      const res = await putWith(withFetch(), "/lab/assets/P", "1 Sol Ring\n1 Zzyzx Not A Card");
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/Zzyzx Not A Card: no card has that name/);
      expect(db.prepare("SELECT COUNT(*) AS n FROM assets WHERE name = 'P'").get()).toEqual({ n: 0 });
    });

    it("fetches at most 150 a call, and says when Scryfall did not answer", async () => {
      const many = Array.from({ length: 151 }, (_, i) => `1 Unknown ${i}`).join("\n");
      const res = await putWith(withFetch(), "/lab/assets/P", many);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/151 cards are not in the card store/);
      expect(calls).toEqual([]);
      const down = await putWith(withFetch(true), "/lab/assets/P", "1 Mana Crypt");
      expect(down.status).toBe(503);
      expect((await down.json()).error).toMatch(/Try again later, not at once/);
    });
  });
});
