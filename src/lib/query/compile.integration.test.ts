import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "./compile";
import { parse } from "./parse";

/**
 * Runs compiled SQL against the real database.
 *
 * The unit tests only prove we emit the string we *intended* — they cannot tell
 * a valid expression from one SQLite rejects, and they cannot catch a predicate
 * that runs but means the wrong thing. This does both, by executing the SQL and
 * asserting relationships between result counts.
 *
 *     npm run test:sql
 *
 * Skipped by default: it needs the app's database, which only exists after the
 * app has run.
 */

const DB = join(
  homedir(),
  "Library/Application Support/dev.treleaven.decklab/decklab.db",
);

const ENABLED = !!process.env.QUERY_SQL && existsSync(DB);

/** Inline params as literals — the sqlite3 CLI has no binding interface. */
function inline(sql: string, params: unknown[]): string {
  let out = sql;
  params.forEach((value, i) => {
    const literal =
      typeof value === "number"
        ? String(value)
        : `'${String(value).replace(/'/g, "''")}'`;
    out = out.replace(new RegExp(`\\$${i + 1}(?![0-9])`, "g"), literal);
  });
  return out;
}

/** Compile a query and return how many cached cards it matches. */
function count(query: string): number {
  const { sql, params } = compile(parse(query)!);
  const statement = `SELECT COUNT(*) FROM cards c WHERE ${inline(sql, params)};`;
  const out = execFileSync("sqlite3", [DB, statement], { encoding: "utf8" });
  return Number.parseInt(out.trim(), 10);
}

describe.runIf(ENABLED)("compiled SQL against the real database", () => {
  it("every supported field produces valid SQL", () => {
    // Executing at all is the assertion: a malformed expression throws.
    for (const query of [
      "t:creature",
      "o:flying",
      "name:bolt",
      "c:r",
      "c:rw",
      "c=rw",
      "id<=rw",
      "c:c",
      "c:m",
      "mv<=3",
      "pow<=1",
      "tou>=4",
      "loy:3",
      "r:mythic",
      "r>=rare",
      "f:commander",
      "kw:flying",
      "set:mh2",
      "layout:normal",
      "a:rebecca",
    ]) {
      expect(() => count(query), query).not.toThrow();
    }
  });

  it("negation partitions the result set exactly", () => {
    // The strongest available correctness check: a predicate and its negation
    // must sum to the whole, with no overlap and nothing lost.
    const all = count("c:r");
    const creatures = count("c:r t:creature");
    const nonCreatures = count("c:r -t:creature");
    expect(creatures + nonCreatures).toBe(all);
  });

  it("AND narrows and OR widens", () => {
    const creatures = count("t:creature");
    expect(count("t:creature c:r")).toBeLessThan(creatures);
    expect(count("t:creature or c:r")).toBeGreaterThan(creatures);
  });

  it("colour operators nest as supersets of one another", () => {
    // exactly RW  ⊆  at least R and W  ⊆  at least R
    expect(count("c=rw")).toBeLessThanOrEqual(count("c:rw"));
    expect(count("c:rw")).toBeLessThanOrEqual(count("c:r"));
  });

  it("colour identity `<=` admits colourless cards", () => {
    // The Commander rule: an artifact with no identity fits any commander.
    expect(count("id<=rw")).toBeGreaterThanOrEqual(count("c:c"));
  });

  it("colourless and multicolour do not overlap", () => {
    const total = count("c:c") + count("c:m");
    expect(count("c:c or c:m")).toBe(total);
  });

  it("guards power against CAST('*') being zero", () => {
    // Unguarded, `pow<=1` also matches every */* creature, because SQLite
    // casts '*' to 0. Compare against the deliberately naive form.
    const guarded = count("pow<=1");
    const naive = Number.parseInt(
      execFileSync(
        "sqlite3",
        [DB, "SELECT COUNT(*) FROM cards c WHERE CAST(c.power AS INTEGER) <= 1;"],
        { encoding: "utf8" },
      ).trim(),
      10,
    );
    expect(guarded).toBeLessThan(naive);
  });

  it("ranks rarity rather than comparing strings", () => {
    // Alphabetically 'mythic' < 'rare', so a string comparison would make
    // `r>=rare` exclude mythics. It must include them.
    expect(count("r>=rare")).toBe(count("r:rare") + count("r:mythic"));
  });

  it("groups override precedence", () => {
    // (a or b) and c  must differ from  a or (b and c) on real data.
    expect(count("(t:instant or t:sorcery) c:r")).not.toBe(
      count("t:instant or (t:sorcery c:r)"),
    );
  });

  it("escapes LIKE wildcards rather than treating them as patterns", () => {
    // If % leaked through unescaped this would match nearly everything.
    expect(count("name:%%%")).toBeLessThan(count("t:creature"));
  });
});
