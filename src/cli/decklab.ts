import { constants, Database } from "bun:sqlite";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dumpV4 } from "../lib/library/v4";
import { readV4 } from "../lib/library/v4db";
import type { Sql } from "../lib/sql";
import { sqlOver } from "../lib/sqlOver";

/**
 * `decklab`, the command line: the app's own TypeScript over Bun's SQLite,
 * compiled into one executable (`npm run cli:build`). Read-only. See
 * docs/cli.md.
 */

const USAGE = `usage: decklab <command> [options]

commands:
  dump [file]    write the library as a library file, to file or standard output

options:
  --db <path>    the database to read (default: the app's decklab.db)
`;

/** Thrown for a mistake in the command line itself: exit 2, with usage. */
class UsageError extends Error {}

/**
 * Where the app keeps its databases: Tauri's app config directory, which the
 * SQL plugin resolves `sqlite:decklab.db` against.
 */
function appDatabase(): string {
  const id = "dev.treleaven.decklab";
  const dir =
    process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support")
      : process.platform === "win32"
        ? (process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"))
        : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(dir, id, "decklab.db");
}

/** A dump for each user schema the CLI knows, by migration version. */
const DUMPS: Record<number, (sql: Sql) => Promise<string>> = {
  4: async (sql) => dumpV4(await readV4(sql)),
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
async function dump(path: string, out: string | undefined): Promise<void> {
  const db = openToRead(path);
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
      text = await dumpOf(sql);
    } finally {
      db.run("COMMIT");
    }
    if (out === undefined) process.stdout.write(text);
    else writeFileSync(out, text);
  } finally {
    db.close();
  }
}

function parse(argv: string[]): { command: string; args: string[]; db: string } {
  const args: string[] = [];
  let db = appDatabase();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--db") {
      const value = argv[++i];
      if (value === undefined) throw new UsageError("--db needs a path");
      db = value;
    } else if (arg === "-h" || arg === "--help") {
      args.unshift("help");
    } else if (arg.startsWith("-")) {
      throw new UsageError(`unknown option ${arg}`);
    } else {
      args.push(arg);
    }
  }
  const [command = "help", ...rest] = args;
  return { command, args: rest, db };
}

async function main(argv: string[]): Promise<number> {
  const { command, args, db } = parse(argv);
  switch (command) {
    case "help":
      process.stdout.write(USAGE);
      return 0;
    case "dump":
      if (args.length > 1) throw new UsageError("dump takes at most one file");
      await dump(db, args[0]);
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
