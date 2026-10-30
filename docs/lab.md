# The lab

How to try a layout or a data shape in the real app, with real components,
before committing to it. What is left to build is in
[`TODO.md`](../TODO.md) → *Lab and the library file*.

Mockups drawn outside the app were tried for journeys F and G and had too
many details to work through: what a panel feels like depends on real
components and real data. So the lab is part of the app.

## Three pieces

| Piece | What it gives | Needs a restart |
| --- | --- | --- |
| **Flags** | UI variants, switched on whatever database is open | no |
| **Lab mode** | a throwaway database, for experiments that change the schema | yes |
| **The library file** | a text dump/load format; lab mode is seeded from it | — |

Each is useful alone. The library file comes first, for today's schema:
it is the backup Campaign 2 needs and the lab's first seed.

## Flags

A **Lab** menu with one item per flag, built the way *Tools → Agent API* is
in `src-tauri/src/api.rs`: toggling sends an event to the webview, and a
`useFlag("where-is")` hook reads it. No restart.

- **A flag can have several values**, as a radio group: *Where it is: off /
  section / table*. That turns an A/B question into something to flip on
  real data.
- **Flags only switch UI.** An experiment that writes data in a new shape
  cannot be safely gated against the real database; that is lab mode's job.
- **Every flag names its way out.** A registry (`flags.ts`) lists each
  flag's values and the journey or TODO item it serves. Once decided, the
  winning branch stays and the flag is deleted.
- **The agent API can set them**, so an agent can flip a variant and look.

Read-only experiments need nothing else. Journey F's *Where it is* runs on
your real collections.

## Lab mode

The app opens a separate database, marked **LAB** in the window, which
**keeps its data from run to run**; **a seed replaces it**. So:

- **Schema can change freely.** The lab's data lives in a library file
  whose format changes far more slowly than the schema
  ([`library-format-5.md`](library-format-5.md)). After editing an
  experimental table, dump the lab, then relaunch with that dump as the
  seed: a seeded launch starts a fresh `lab.db`, so the sqlx trap of an
  edited applied migration cannot happen. Without the reseed, the lab
  refuses to open.
- **Experiments carry their own migrations.** Lab mode runs the real
  migrations plus an experimental list (`lab/folders.sql`,
  `lab/asset_tags.sql`). The real `decklab.db` never sees that list.
- **Graduation is one step.** A winning experiment is written once as a
  numbered migration, already settled. A losing one is deleted and leaves
  nothing behind.
- **Code that touches experimental tables runs only in lab mode**, behind
  the same flags.

**Built:** `npm run lab` (`DECKLAB_LAB=1`). A launch with a seed deletes the
last `lab.db` and loads the seed into a fresh one; a launch without keeps
the lab as it was. The window title says **LAB**. It serves the
frontend on port 1440 (`DECKLAB_PORT`, and `src-tauri/tauri.lab.conf.json`
pointing Tauri at it), so it runs beside `npm run tauri dev` on 1420. Both
build the same Rust binary, so a Rust edit restarts both. Experimental
migrations go in `lab::migrations()` (`src-tauri/src/lab.rs`), numbered from
1000; the first is the new model's schema, `lab/1000_assets.sql`. Card data
comes from the card store, which every mode shares
([`card-fetching.md`](card-fetching.md) → *The card store*), so the lab never
needs a copy of `decklab.db`.

To work on real data: *File → Export Library…* in the app, then *File →
Import Library…* in the lab.

**Loading at launch:** `DECKLAB_LAB_SEED=path/to/file.toml npm run lab`.
Rust reads the variable and hands the file's text to the webview
(`lab_seed`), which loads it into the new, empty `lab.db` with the library
file's load, before the UI starts (`src/lib/library/seed.ts`). A relative
path is taken from where the command was typed (npm's `INIT_CWD`), not from
`src-tauri/`, where `tauri dev` runs the app. Emptying the lab and loading
the seed happen once per launch: reloading the window keeps the lab as it
is. The file is a hand-written *scenario* or a dump (`decklab dump`,
[`cli.md`](cli.md)). A **version 5** file loads into the new model's tables
(`writeLab`, `src/lib/library/labdb.ts`), which **today's UI does not read
yet**; a schema 4 file loads into today's tables, as before. A schema 4 dump
of the real library becomes version 5 with `decklab convert`, and `decklab
dump --db <lab.db>` dumps the lab back as version 5. A file that fails to
load shows the error and leaves the lab empty. No other program writes to
`lab.db` while the lab runs.

`npm run test:library` runs the whole way on copies of the real databases:
dump, convert, load into a fresh lab, dump the lab. The last is the
converted file, byte for byte, with no requests.

## The library file

A text format for a whole library, written and read by the app.

- **TOML, one card per line** as an inline table: the name, then
  `attr = value` pairs. TOML does the quoting and the types, so there is no
  line grammar to maintain, and a line still reads like a decklist entry.
  A field at its schema default is left out, and loading puts it back.
- **The name checks the printing.** In v4 a line names its printing by
  set, collector number and language (only when not English); load refuses
  a line whose name does not fit the printing it finds, which catches a
  mistyped number in a hand-written file.
- **Property-identified.** A card is its printing and finish, a bucket its
  attribute values (`absent` included), an asset its path. The database
  may use asset ids internally; a dump elides them and a load assigns
  fresh ones (see [`inventory/asset-tree.md`](inventory/asset-tree.md) → *The asset tree*).
- **Detail stays in the cache.** The file says *where cards are*, not what
  they are. Card data is fetched through `scheduledFetch`, cache-first, as
  the app already does, so a new awkward case costs one line and one
  request.
- **Checked before written.** The SQL plugin cannot hold a transaction
  across calls, so load validates everything — names, piles, printings,
  duplicates — before the first insert.
- **Lossless.** Loading a dump of a database gives back the same database:
  the property test that keeps the format honest.

Schema 4's is built: `src/lib/library/` (`v4.ts` the format, `v4db.ts` the
database side), behind *File → Export Library…* and *Import Library…*.
Import loads only into an empty database. `npm run test:library` runs the
round trip on a copy of the real database, row for row.

```toml
format = "decklab-library"
schema = 4

[[collection]]
name = "Paper"
created = 2026-03-01T14:02:11.000Z
updated = 2026-10-20T09:15:40.000Z
cards = [
  { card = "Sol Ring", qty = 1, set = "c21", number = "263", finish = "foil", added = 2026-03-01T14:05:00.000Z },
  { card = "Sol Ring", qty = 2, set = "cmr", number = "472", added = 2026-04-12T18:30:22.000Z },
]

[[deck]]
name = "Atraxa Superfriends"
created = 2026-02-14T20:00:00.000Z
updated = 2026-10-01T21:12:09.000Z
piles = ["Ramp", "Draw"]
cards = [
  { card = "Atraxa, Praetors' Voice", qty = 1, set = "2xm", number = "190", zone = "commander", added = 2026-02-14T20:01:00.000Z },
  { card = "Sol Ring", qty = 1, set = "c21", number = "263", pile = "Ramp", added = 2026-02-14T20:03:00.000Z },
]
```

**One triplet per schema: (schema, dump, load).** Today's is (v4, dump₄,
load₄); the lab's is (lab schema, dump_lab, load_lab), developed
separately. Load is not optional even for a schema about to be replaced:
`load(dump(db)) = db` is the test of dump, and a backup that cannot be
restored is not one.

**A migration is a text-to-text conversion** between two dumps, outside
both triplets. It is pure and testable on a real dump, and it is where the
lossy decisions of [`inventory/README.md`](inventory/README.md) → *Mapping today's data*
live, said out loud rather than buried in a dump. The two formats share
most of their syntax, so the conversion touches only what differs.

A **scenario** is a library file written by hand for one journey, partial
on purpose:

Binder 2 with the C21 foil, a bulk box with two more, Dave's binder with
two: a few `[[collection]]` tables of a line or two each. For a scenario,
timestamps are clutter; whether load may default them when absent is open.

The same format is also:

- **a backup** — Campaign 2 already says *back up first*;
- **a diff** — commit it, and "what changed since last week" is `git diff`;
- **an upgrade path** — dump with the old app, load with the new, as an
  alternative to converting data in place for a redesign like
  [`inventory/README.md`](inventory/README.md);
- **a way to share** — a friend's binder as a file.

**Autosave.** Dumping periodically, or on events (quit, an import, a big
edit), keeps a current library file beside the database.

**Close to `cmdr`, not bound to it.** The format could approximate or
extend the `cmdr`/DeckLab language: one way of writing cards, sets and
places, whether in a query, a decklist or a dump. But `cmdr` itself may not
last, so the library file does not depend on it. The format's own
requirements, lossless and stable, come first; borrowing from the language
is welcome where it costs neither.

## Open

- **Which is the record?** With autosave, the library file could become the
  record and SQLite a cache rebuilt from it. That would change backups,
  sync and migrations; worth deciding before the format is.
- **Timestamps in scenarios**: v4 requires them on every line, which a
  dump needs and a hand-written file does not. Defaulting them on load would
  make scenarios short at no cost to dumps.
- **Autosave triggers and destination**: how often, which events, where the
  file lives, how many to keep.
- **An oracle identifier on card lines**, from the lab schema on. In v4 the
  printing (set, number, language) determines the card and the name only
  checks it. Once a printing can be `absent`, the name is all that is left,
  and names are not stable: Scryfall renames cards. So a line needs
  Scryfall's oracle id, with the name kept for reading and as a check.
- **Where properties are not enough to identify something** in the file.
  Paths cover references to assets; nothing else has needed an identifier
  yet.
