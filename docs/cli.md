# The command line

A `decklab` executable for working with a library without opening the app:
first a dump, later conversions between library file formats. See
[`lab.md`](lab.md) → *The library file* for the format and why each schema
has its own (schema, dump, load).

## One codebase, a different floor

The CLI is the app's own TypeScript compiled into a standalone executable.
The format (`v4.ts`), the database side (`v4db.ts`), the card store's queries
(`store.ts`) and any conversion are the same files in both. Only what sits
under them differs:

| | In the app | In the CLI |
| --- | --- | --- |
| SQL | Tauri SQL plugin | the runtime's SQLite |
| HTTP | Tauri HTTP plugin | the standard `fetch` |
| Where the database is | the plugin resolves it | computed the same way, or `--db path` |

The seam: `v4db.ts` and `store.ts` take an `Sql` parameter
(`src/lib/sql.ts`), and `src/lib/sqlOver.ts` builds one over any
synchronous SQLite — `bun:sqlite` in the CLI, `node:sqlite` in the tests.
Neither binds `$n` by its number (`bun:sqlite` numbers parameters in the
order they first appear), so `sqlOver` rewrites each `$n` to `?`.
`scryfall.ts` imports Tauri's HTTP plugin directly, which the commands below
never reach; a command that fetches would have the fetch passed in.

The database path must agree with the app's: the SQL plugin resolves
`sqlite:<name>` against the app *config* directory, which on macOS is
`~/Library/Application Support/dev.treleaven.decklab/`.

## Commands

- **`decklab dump [out.toml]`**: `readV4` then `dumpV4` on `decklab.db`, to
  a file or standard output.
- **`decklab convert in.toml out.toml`**: a library file from one format to
  the next, once the lab schema differs from v4. Text to text; at most it
  reads the card store, for instance to add oracle ids.

No `load`. The lab is loaded at launch by the app itself ([`lab.md`](lab.md)
→ *Lab mode*), and nothing writes to a database the app has open.

## Read-only, and safe beside the app

- **One transaction per dump.** `readV4` runs several queries; inside one
  `BEGIN … COMMIT` they see one snapshot, so an edit committed in the app
  mid-dump cannot leave a deck half before and half after. The CLI has a
  connection of its own, which is what makes that easy; the app's pooled
  plugin cannot promise it.
- **WAL mode.** sqlx creates databases in WAL mode, so `decklab.db` and
  `lab.db` are in it. (The card store, made by `VACUUM INTO`, is not.) A
  reader then never holds up the app's writes, nor they it.
- **Opened read-write, writes refused.** A read-only connection cannot create
  the `-wal` and `-shm` files WAL needs, so with the app closed it cannot open
  the database at all. The CLI opens it read-write with `PRAGMA query_only`,
  which refuses any write.
- **Leaves no files behind.** On macOS Bun uses Apple's SQLite, which keeps
  `-wal` and `-shm` after the last connection closes; the CLI turns that off
  (`SQLITE_FCNTL_PERSIST_WAL`). Checked on the real database: same bytes
  after a dump, same directory listing.
- **Schema versions.** The CLI is distributed apart from the app, so the two
  can disagree. It reads the highest version in `_sqlx_migrations` and
  refuses one it does not know, rather than guessing at its tables.

## Runtime and distribution

- **Bun:** runs TypeScript without a build step and has SQLite built in.
  `npm run cli -- dump` runs it from source; `npm run cli:build` compiles
  `src/cli/decklab.ts` into `build/decklab`, about 90 MB, most of it the
  runtime. A dump of the real library takes about a second.
- **Every platform from one machine:** `bun build --compile --target=…`
  builds for macOS, Linux and Windows. The database path follows Tauri's
  config directory on each; only macOS is checked so far.
- **`bun:sqlite` has no types here.** `src/cli/bun-sqlite.d.ts` declares the
  part the CLI uses, rather than adding `@types/bun` to a browser project.
- **Distributed separately**, and the app built with or without it bundled
  (Tauri calls a bundled executable a *sidecar*). Bundling and releases wait
  for a release process.

## Considered and rejected

- **Subcommands on the app, run in a hidden web view.** One codebase too, but
  every command pays the app's start-up, and a GUI app acting as a command
  needs work around the Dock, a window it never shows, and output routed
  through Rust.
- **A CLI in Rust.** Small and fast, but a second implementation of the
  format and its checks, in a second language, to drift from the first.

## Open

- **One executable or two.** The Agent API plans a `decklab` CLI too
  ([`agent-api.md`](agent-api.md)), of a different kind: it only talks to the
  running app, and never opens the database. Whether that and this become one
  executable is undecided; until then `decklab` is this tool's working name.
