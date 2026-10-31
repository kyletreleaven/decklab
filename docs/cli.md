# The command line

A `decklab` executable for working with a library: a dump and conversions
between library file formats without opening the app, and assets as files
through the running app's agent API. See
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
- **`decklab convert in.toml [out.toml]`**: a schema 4 library file to
  version 5 ([`library-format-5.md`](library-format-5.md)), to a file or
  standard output; what was lost goes to standard error. Text to text, plus
  read-only lookups of oracle ids and names in the card store (`--store`,
  default the app's `card-cache.db`). It sends nothing to Scryfall: a
  printing the store lacks is reported, not fetched. The result is loaded
  back before it is written, so a converter bug cannot produce a file
  version 5 refuses. On the real library: 10 collections and 11 decks
  became 52 assets in under 3 seconds, every copy accounted for and every
  line with an oracle id.

No `load`. The lab is loaded at launch by the app itself ([`lab.md`](lab.md)
→ *Lab mode*), and nothing writes to a database the app has open.

- **`decklab assets tree | get | put | rm`**: assets as files, for you or an
  agent working beside the app (`cmdr`'s, say). A thin client of the agent
  API ([`agents/using-the-api.md`](agents/using-the-api.md)), so the app must
  be open with the API enabled; the token comes from `$DECKLAB_TOKEN` or
  `--token`, the port from `--port`, `$DECKLAB_API_PORT`, else 47474.
  - `tree`: every asset, a line each, path and type.
  - `get <path> [file]`: an asset to a file or standard output — as text
    for a `.txt` file or `--text` (a decklist, zone headings and all), as
    JSON otherwise.
  - `put <path> <file>`: create or replace from a `.txt` file — a decklist
    or list pool, as what is at the path says; `--type decklist` for a new
    decklist — or a `.json` file, any body the API takes. A decklist is
    replaced zone by zone, the zones the file names.
  - `rm <path>`: delete, as the tree does.

  A path is written as in the library file, the leading `/` optional. The
  API's refusal goes to standard error, exit 1; a command-line mistake,
  exit 2. Nothing here opens a database or reaches Scryfall itself: a card
  the store lacks is fetched by the app, through its channel. On the real
  lab, a 100-card decklist went out to a file, back in as a new decklist,
  and out again byte for byte. The routes are the lab's for now; the
  command is named for what it works on, so it outlives that.

## Read-only, and safe beside the app

The commands that open a database (`dump`, `convert`) only read it.
`assets` writes, but through the app, which owns its database.


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
  (`SQLITE_FCNTL_PERSIST_WAL`). Checked on the real database, with the app
  closed and with it running: same directory listing after a dump.
- **Closing may checkpoint.** If the CLI's is the last connection open,
  SQLite copies the WAL's committed changes into the database file as it
  closes, as the app's own connections do. No data changes, but the file's
  bytes can.
- **Schema versions.** The CLI is distributed apart from the app, so the two
  can disagree. It reads the highest version in `_sqlx_migrations` and
  refuses one it does not know, rather than guessing at its tables.

## Runtime and distribution

- **Bun:** runs TypeScript without a build step and has SQLite built in.
  `npm run cli -- dump` runs it from source; `npm run cli:build` compiles
  `src/cli/decklab.ts` into `build/decklab`, about 90 MB, most of it the
  runtime. It builds from inside `build/`, because Bun writes a temporary
  `.….bun-build` file in the working directory. A dump of the real library
  takes about a second.
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
- **Two executables**, one opening databases and one talking to the app's
  API, as `agent-api.md` once planned. One is less to install and explain:
  the API's commands are the `assets` group, and say so when the app is
  not answering.
