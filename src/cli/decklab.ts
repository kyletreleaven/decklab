import { constants, Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { convertV4, formatReport, type Lookups } from "../lib/library/convert";
import { dumpV4, loadV4, type V4Printing } from "../lib/library/v4";
import { readV4 } from "../lib/library/v4db";
import { readLab } from "../lib/library/labdb";
import { dumpV5, loadV5 } from "../lib/library/v5";
import type { Sql } from "../lib/sql";
import { sqlOver } from "../lib/sqlOver";

/**
 * `decklab`, the command line: the app's own TypeScript over Bun's SQLite,
 * compiled into one executable (`npm run cli:build`). Read-only. See
 * docs/cli.md.
 */

const USAGE = `usage: decklab <command> [options]

commands:
  dump [file]           write the library as a library file, to file or standard output:
                        schema 4 for the app's database, version 5 for the lab's
  convert <in> [out]    convert a schema 4 library file to version 5, to out or
                        standard output; what was lost goes to standard error

options:
  --db <path>       the database to read (default: the app's decklab.db;
                    the lab's is lab.db, beside it)
  --store <path>    the card store, which says what cards are, for convert
                    and a lab dump (default: the app's card-cache.db)
`;

/** Thrown for a mistake in the command line itself: exit 2, with usage. */
class UsageError extends Error {}

/**
 * Where the app keeps its databases: Tauri's app config directory, which the
 * SQL plugin resolves `sqlite:decklab.db` against.
 */
function appDatabase(name = "decklab.db"): string {
  const id = "dev.treleaven.decklab";
  const dir =
    process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support")
      : process.platform === "win32"
        ? (process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"))
        : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(dir, id, name);
}

/**
 * A dump for each user schema the CLI knows, by migration version. 1000 is
 * the lab's (`src-tauri/migrations/lab/`), which names cards by id only and
 * reads what they are from the card store.
 */
const DUMPS: Record<number, (sql: Sql, store: () => Sql) => Promise<string>> = {
  4: async (sql) => dumpV4(await readV4(sql)),
  1000: async (sql, store) => dumpV5(await readLab(sql, store())),
};

async function schemaOf(sql: Sql): Promise<number> {
  const rows = await sql.select<{ version: number | null }>(
    "SELECT MAX(version) AS version FROM _sqlx_migrations WHERE success = 1",
  );
  return rows[0]?.version ?? 0;
}

/**
 * Open a database to read, never to write.
 *
 * Not `readonly`: the app's databases are in WAL mode (sqlx creates them so),
 * and a read-only connection cannot create the `-wal` and `-shm` files that
 * WAL needs, so with the app closed it cannot open at all. A read-write
 * connection with `query_only` refuses every write instead.
 *
 * On macOS Bun uses Apple's SQLite, which keeps those files after the last
 * connection closes. Turning that off leaves the directory as it was found.
 */
function openToRead(path: string): Database {
  if (!existsSync(path)) throw new Error(`no database at ${path}`);
  const db = new Database(path, { readwrite: true, create: false });
  db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
  db.run("PRAGMA query_only = ON");
  return db;
}

/**
 * One read transaction around the whole dump, so every query sees the same
 * snapshot even if the app commits an edit meanwhile. In WAL mode the app
 * is not held up by it.
 */
async function dump(path: string, out: string | undefined, storePath: string): Promise<void> {
  const db = openToRead(path);
  let storeDb: Database | undefined;
  const store = () => sqlOver((storeDb ??= openToRead(storePath)));
  try {
    const sql = sqlOver(db);
    db.run("BEGIN");
    let text: string;
    try {
      const schema = await schemaOf(sql);
      const dumpOf = DUMPS[schema];
      if (!dumpOf) {
        throw new Error(
          `${path} is at schema ${schema}; this decklab dumps schema ${Object.keys(DUMPS).join(", ")}`,
        );
      }
      text = await dumpOf(sql, store);
    } finally {
      db.run("COMMIT");
    }
    if (out === undefined) process.stdout.write(text);
    else writeFileSync(out, text);
  } finally {
    db.close();
    storeDb?.close();
  }
}

/**
 * v4 → 5, file to file. Oracle ids and names come from the card store, read
 * only: this sends nothing to Scryfall, and a printing the store lacks is
 * reported, not fetched. The result is loaded back before it is written, so
 * a converter bug cannot produce a file version 5 refuses.
 */
function convert(input: string, out: string | undefined, store: string): void {
  const v4 = loadV4(readFileSync(input, "utf8"));
  const db = openToRead(store);
  try {
    const byPrinting = db.prepare(
      `SELECT oracle_id FROM cards
        WHERE set_code = ? AND collector_number = ?
          AND COALESCE(json_extract(data, '$.lang'), 'en') = ?
        LIMIT 1`,
    );
    const byOracle = db.prepare("SELECT name FROM cards WHERE oracle_id = ? LIMIT 1");
    const lookups: Lookups = {
      oracleOf: (p: V4Printing) =>
        (byPrinting.all(...([p.set, p.number, p.lang] as never[]))[0] as { oracle_id: string } | undefined)
          ?.oracle_id,
      nameOf: (oracle: string) =>
        (byOracle.all(...([oracle] as never[]))[0] as { name: string } | undefined)?.name,
    };
    const { library, report } = convertV4(v4, lookups);
    const text = dumpV5(library);
    loadV5(text);
    if (out === undefined) process.stdout.write(text);
    else writeFileSync(out, text);
    process.stderr.write(formatReport(report) || "nothing lost\n");
  } finally {
    db.close();
  }
}

function parse(argv: string[]): { command: string; args: string[]; db: string; store: string } {
  const args: string[] = [];
  let db = appDatabase();
  let store = appDatabase("card-cache.db");
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--db" || arg === "--store") {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${arg} needs a path`);
      if (arg === "--db") db = value;
      else store = value;
    } else if (arg === "-h" || arg === "--help") {
      args.unshift("help");
    } else if (arg.startsWith("-")) {
      throw new UsageError(`unknown option ${arg}`);
    } else {
      args.push(arg);
    }
  }
  const [command = "help", ...rest] = args;
  return { command, args: rest, db, store };
}

async function main(argv: string[]): Promise<number> {
  const { command, args, db, store } = parse(argv);
  switch (command) {
    case "help":
      process.stdout.write(USAGE);
      return 0;
    case "dump":
      if (args.length > 1) throw new UsageError("dump takes at most one file");
      await dump(db, args[0], store);
      return 0;
    case "convert":
      if (args.length < 1 || args.length > 2) throw new UsageError("convert takes a file, and optionally where to write");
      convert(args[0], args[1], store);
      return 0;
    default:
      throw new UsageError(`unknown command ${command}`);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`decklab: ${err instanceof Error ? err.message : String(err)}\n`);
    if (err instanceof UsageError) process.stderr.write(`\n${USAGE}`);
    process.exit(err instanceof UsageError ? 2 : 1);
  },
);
