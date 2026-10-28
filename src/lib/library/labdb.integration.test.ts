import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { sqlOver } from "../sqlOver";
import { convertV4 } from "./convert";
import { readLab, writeLab } from "./labdb";
import { dumpV4, loadV4 } from "./v4";
import { readV4 } from "./v4db";
import { dumpV5, loadV5 } from "./v5";

/**
 * The real library, the whole way: dump the app's database (v4), convert it
 * to version 5, load that into a fresh lab database, and dump the lab. The
 * last must be the converted file, byte for byte.
 *
 *     npm run test:library
 *
 * Skipped by default: it needs the app's databases. It never writes to
 * them — it works on copies — and makes no network requests: the load is
 * given a fetch that fails the test.
 */

const DIR = join(homedir(), "Library/Application Support/dev.treleaven.decklab");
const MIGRATIONS = join(__dirname, "../../../src-tauri/migrations");
const ENABLED =
  !!process.env.LIBRARY_DB && existsSync(join(DIR, "decklab.db")) && existsSync(join(DIR, "card-cache.db"));

/** A copy of a WAL database: the file, and its log if there is one. */
function copy(name: string, to: string): DatabaseSync {
  for (const suffix of ["", "-wal"]) {
    if (existsSync(join(DIR, name + suffix))) copyFileSync(join(DIR, name + suffix), join(to, name + suffix));
  }
  return new DatabaseSync(join(to, name));
}

describe.skipIf(!ENABLED)("the real library, through version 5 and the lab", () => {
  const dir = mkdtempSync(join(tmpdir(), "decklab-lab-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("dump(lab(convert(dump(db)))) is the converted file", async () => {
    const real = copy("decklab.db", dir);
    const store = copy("card-cache.db", dir);

    const oracle = store.prepare(
      `SELECT oracle_id FROM cards WHERE set_code = ? AND collector_number = ?
          AND COALESCE(json_extract(data, '$.lang'), 'en') = ? LIMIT 1`,
    );
    const name = store.prepare("SELECT name FROM cards WHERE oracle_id = ? LIMIT 1");
    const v4 = loadV4(dumpV4(await readV4(sqlOver(real))));
    const { library } = convertV4(v4, {
      oracleOf: (p) => (oracle.get(p.set, p.number, p.lang) as { oracle_id: string } | undefined)?.oracle_id,
      nameOf: (o) => (name.get(o) as { name: string } | undefined)?.name,
    });
    const text = dumpV5(library);

    const lab = new DatabaseSync(join(dir, "lab.db"));
    lab.exec("PRAGMA foreign_keys = ON");
    for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
      lab.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
    }
    lab.exec(readFileSync(join(MIGRATIONS, "lab/1000_assets.sql"), "utf8"));

    const summary = await writeLab(sqlOver(lab), sqlOver(store), loadV5(text), {
      fetchMissing: () => {
        throw new Error("the round trip must not touch Scryfall");
      },
    });
    expect(summary.fetched).toBe(0);
    expect(dumpV5(await readLab(sqlOver(lab), sqlOver(store)))).toBe(text);

    for (const db of [real, store, lab]) db.close();
  });
});
