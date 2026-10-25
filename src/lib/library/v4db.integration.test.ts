import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { dumpV4, loadV4 } from "./v4";
import { sqlOver } from "../sqlOver";
import { readV4, writeV4 } from "./v4db";

/**
 * The library round trip against the real database:
 * `load(dump(db))` into a fresh schema-4 database must give back every row.
 *
 *     npm run test:library
 *
 * Skipped by default: it needs the app's database. It never writes to it — it
 * works on a copy — and makes no network requests: every printing the library
 * names is copied into the fresh database's cache first.
 */

const DB = join(homedir(), "Library/Application Support/dev.treleaven.decklab/decklab.db");
const MIGRATIONS = join(__dirname, "../../../src-tauri/migrations");

const ENABLED = !!process.env.LIBRARY_DB && existsSync(DB);

/** Every user row, with ids replaced by the names they stand for. */
function userRows(db: DatabaseSync) {
  const all = (sql: string) => db.prepare(sql).all();
  return {
    collections: all(
      `SELECT name, kind, quantity_kind, notes, created_at, updated_at
         FROM collections ORDER BY name`,
    ),
    items: all(
      `SELECT c.name, i.card_id, i.quantity, i.finish, i.condition, i.notes, i.added_at
         FROM collection_items i JOIN collections c ON c.id = i.collection_id
        ORDER BY c.name, i.card_id, i.finish, i.condition`,
    ),
    decks: all(
      `SELECT name, format, notes, created_at, updated_at FROM decks ORDER BY name`,
    ),
    piles: all(
      `SELECT d.name, p.name AS pile, p.position
         FROM deck_piles p JOIN decks d ON d.id = p.deck_id
        ORDER BY d.name, p.position, p.name`,
    ),
    deckCards: all(
      `SELECT d.name, dc.card_id, dc.quantity, dc.zone, p.name AS pile, dc.added_at
         FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id
         LEFT JOIN deck_piles p ON p.id = dc.pile_id
        ORDER BY d.name, dc.card_id, dc.zone`,
    ),
    tags: all(`SELECT oracle_id, tag FROM card_tags ORDER BY oracle_id, tag`),
  };
}

describe.skipIf(!ENABLED)("library round trip on the real database", () => {
  const dir = mkdtempSync(join(tmpdir(), "decklab-library-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("load(dump(db)) gives back every row", async () => {
    const copyPath = join(dir, "copy.db");
    copyFileSync(DB, copyPath);
    const real = new DatabaseSync(copyPath);

    const fresh = new DatabaseSync(join(dir, "fresh.db"));
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
      fresh.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    }

    // The cache the load will resolve against: exactly the printings in use.
    const cards = real
      .prepare(
        `SELECT * FROM cards WHERE id IN
           (SELECT card_id FROM collection_items UNION SELECT card_id FROM deck_cards)`,
      )
      .all() as Record<string, unknown>[];
    if (cards.length) {
      const columns = Object.keys(cards[0]);
      const insert = fresh.prepare(
        `INSERT INTO cards (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      );
      for (const card of cards) insert.run(...(columns.map((c) => card[c]) as never[]));
    }

    const text = dumpV4(await readV4(sqlOver(real)));
    const summary = await writeV4(sqlOver(fresh), loadV4(text), {
      fetchPrintings: () => {
        throw new Error("the round trip must not touch Scryfall");
      },
    });

    expect(summary.fetched).toBe(0);
    expect(userRows(fresh)).toEqual(userRows(real));
    expect(dumpV4(await readV4(sqlOver(fresh)))).toBe(text);

    real.close();
    fresh.close();
  });
});
