import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../api/app";
import { writeLab } from "../lib/library/labdb";
import { loadV5 } from "../lib/library/v5";
import { sqlOver } from "../lib/sqlOver";
import { assets, AssetsError, AssetsUsageError, type AssetsIo } from "./assets";

const MIGRATIONS = join(__dirname, "../../src-tauri/migrations");

function store() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(MIGRATIONS, "cache/001_store.sql"), "utf8"));
  const insert = db.prepare(
    `INSERT INTO cards (id, oracle_id, name, set_code, set_name, collector_number, released_at, rarity, layout, data, cached_at)
     VALUES (?, ?, ?, ?, 'Set', ?, '2020-01-01', 'common', 'normal', '{"lang":"en"}', '2020-01-01')`,
  );
  insert.run("sol-c21", "sol", "Sol Ring", "c21", "263");
  insert.run("bolt-m10", "bolt", "Lightning Bolt", "m10", "146");
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

describe("decklab assets, against the API itself", () => {
  let files: Map<string, string>;
  let printed: string;
  let io: AssetsIo;
  beforeEach(async () => {
    const cards = store();
    const db = lab();
    await writeLab(sqlOver(db), sqlOver(cards), loadV5(`format = "decklab-library"\nversion = 5\n\n[[asset]]\npath = '/Binders/Red'\ntype = "place"\ncards = [ { oracle = "bolt", qty = 2 } ]\n`), {
      fetchMissing: () => {
        throw new Error("must not fetch");
      },
    });
    const app = createApp(async () => "secret", { open: async () => ({ lab: sqlOver(db), cards: sqlOver(cards) }) });
    files = new Map();
    printed = "";
    io = {
      fetch: async (url, init) => app.request(url, init),
      base: "http://127.0.0.1:47474",
      token: "secret",
      readFile: (p) => {
        const t = files.get(p);
        if (t === undefined) throw new Error("no such file");
        return t;
      },
      writeFile: (p, t) => void files.set(p, t),
      out: (t) => void (printed += t),
    };
  });

  it("lists the tree as paths", async () => {
    await assets("tree", [], {}, io);
    expect(printed).toBe("/Binders\tfolder\n/Binders/Red\tplace\n");
  });

  it("puts a decklist from a file, reads it back the same, and removes it", async () => {
    const list = "Commander\n1 Sol Ring\n\nDeck\n2 Lightning Bolt\n";
    files.set("izzet.txt", list);
    await assets("put", ["Decks/Izzet", "izzet.txt"], { type: "decklist" }, io);
    expect(printed).toMatch(/^created \/Decks\/Izzet: \{"created":true/);
    await assets("get", ["/Decks/Izzet", "back.txt"], {}, io);
    expect(files.get("back.txt")).toBe(list);
    await assets("rm", ["/Decks/Izzet"], {}, io);
    await expect(assets("get", ["/Decks/Izzet"], {}, io)).rejects.toThrow(new AssetsError("404: Nothing at /Decks/Izzet."));
  });

  it("gets JSON unless asked for text, and puts JSON as the API takes it", async () => {
    files.set("ramp.json", JSON.stringify({ type: "list pool", cards: [{ card: "Sol Ring" }] }));
    await assets("put", ['/Pools/"St. Louis"', "ramp.json"], {}, io);
    printed = "";
    await assets("get", ['/Pools/"St. Louis"'], {}, io);
    expect(JSON.parse(printed)).toMatchObject({ path: ["Pools", "St. Louis"], type: "list pool" });
  });

  it("says what is wrong with the command line, and what the API refused", async () => {
    await expect(assets("put", ["/P", "p.toml"], {}, io)).rejects.toThrow(AssetsUsageError);
    await expect(assets("put", ["/P", "p.json"], { type: "decklist" }, io)).rejects.toThrow(/--type is for a .txt file/);
    await expect(assets("frob", [], {}, io)).rejects.toThrow(/unknown assets command frob/);
    await expect(assets("tree", [], {}, { ...io, token: undefined })).rejects.toThrow(/no token/);
    await expect(assets("tree", [], {}, { ...io, token: "wrong" })).rejects.toThrow(/^401/);
    files.set("p.txt", "1 Mana Crypt");
    await expect(assets("put", ["/P", "p.txt"], {}, io)).rejects.toThrow(/400: Not in the card store:\nMana Crypt/);
    await expect(assets("tree", [], {}, { ...io, fetch: async () => Promise.reject(new TypeError("refused")) })).rejects.toThrow(
      /not answering at http:\/\/127\.0\.0\.1:47474/,
    );
  });
});
