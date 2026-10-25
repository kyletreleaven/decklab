# The command line — designed, not built

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

The seam already exists: `v4db.ts` and `store.ts` take an `Sql` parameter
(`src/lib/sql.ts`), and `src/lib/testing/sqlOver.ts` is that floor for
`node:sqlite`; it moves out of `testing/` when the CLI uses it.
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
  `BEGIN … COMMIT` they share one shared lock and see one snapshot, so an edit
  committed in the app mid-dump cannot leave a deck half before and half
  after. The CLI has a connection of its own, which is what makes that easy;
  the app's pooled plugin cannot promise it.
- **Beside a running app.** The databases use a rollback journal: readers
  share a lock, and a commit waits for them. A dump takes well under a
  second, against the app's wait of about five, so at worst an edit pauses.
- **Schema versions.** The CLI is distributed apart from the app, so the two
  can disagree. It reads the highest version in `_sqlx_migrations` and
  refuses one it does not know, rather than guessing at its tables.

## Runtime and distribution

- **Bun first:** `bun build --compile` makes one executable, runs TypeScript
  without a build step, and has SQLite built in. To check first: that
  `bun:sqlite` binds `$1`-style parameters the way `Sql` expects, or needs
  the same rewrite `sqlOver` does. Deno's `compile` and Node's single
  executable applications are the alternatives.
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
