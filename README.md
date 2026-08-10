# DeckLab

A desktop Magic: the Gathering deck and collection manager. Commander-first, but
not Commander-only.

Tauri 2 · React 19 + TypeScript · SQLite · card data from
[Scryfall](https://scryfall.com).

Roadmap and design notes live in [`TODO.md`](TODO.md).

---

## Prerequisites

| Tool | Version used | Notes |
| --- | --- | --- |
| Node | 24.x | `node --version` |
| Rust | 1.95 | via `rustup` |
| Xcode Command Line Tools | — | macOS only, for linking |

```bash
npm install
```

Rust dependencies are fetched on the first build.

---

## Running in development

### The simple way

```bash
npm run tauri dev
```

Starts Vite, builds the Rust binary, opens the window, and watches **both** sides
— frontend edits hot-reload, and Rust edits trigger a rebuild and relaunch.

### Running the two halves separately

`npm run tauri dev` spawns Vite as a child process. In some shells and task
runners the parent exits and takes Vite with it, leaving the window pointing at a
dead dev server. Running the halves as independent processes avoids that:

```bash
# terminal 1 — dev server on :1420
npx vite

# terminal 2 — the app, pointed at that server
cd src-tauri && cargo run --no-default-features
```

`--no-default-features` disables the `custom-protocol` feature, which is what
makes the app load the frontend from `http://localhost:1420` (the `devUrl` in
`tauri.conf.json`) rather than from bundled assets. It is exactly what
`tauri dev` passes internally.

**Trade-off:** frontend HMR works as normal, but there is no Rust file watcher —
changes to `src-tauri/` need that second command restarted by hand.

### Running the release build instead

Needs no dev server at all, and shares the same database:

```bash
open src-tauri/target/release/bundle/macos/DeckLab.app
```

---

## Tests

```bash
npm test          # once
npm run test:watch
```

Covers the decklist parser and serialisers, deck analysis (curve, pips, Commander
rules), and the filter-to-query translation. Nothing covers the SQL layer or
React components yet.

### Scryfall contract tests

```bash
npm run test:contract
```

Executable documentation of the Scryfall behaviour this app depends on: that an
empty search 404s rather than returning zero rows, that the printings prefix is
`oracleid:` and not `oracle_id:`, that `/cards/collection` caps at 75
identifiers and echoes misses in `not_found`, that double-faced cards carry
images on their faces rather than the card, and that `format=csv` is ~20× smaller
than JSON.

They hit the live network, so they are **skipped in the normal run** and only
execute under this script. When one fails, the fix is usually in our code rather
than in the test.

Typecheck without building:

```bash
npx tsc --noEmit
```

---

## Building a release

```bash
npm run tauri build
```

Produces `src-tauri/target/release/bundle/`:

- `dmg/DeckLab_0.1.0_aarch64.dmg` (~7.5 MB)
- `macos/DeckLab.app`

**From a non-interactive shell, use `CI=true npm run tauri build`.** The DMG
bundler runs an AppleScript to prettify the disk-image window, which fails
without a GUI session and leaves a volume mounted under `/Volumes`. `CI=true`
makes Tauri pass `--skip-jenkins`, skipping the cosmetics. Note `CI=1` is
rejected — the CLI maps it to a `--ci` flag that only accepts `true`/`false`.

Current limitations: unsigned (Gatekeeper blocks it on other machines), Apple
Silicon only, and still using the default Tauri icon. For a universal binary:

```bash
rustup target add x86_64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
```

---

## Where things live

```
src/
  components/     React components — panels, dialogs, card rendering
  lib/            data access, Scryfall client, parsers, deck analysis
                  *.test.ts sit next to what they test
src-tauri/
  src/lib.rs      plugin registration + the three Rust commands
  migrations/     versioned SQL, applied on startup
public/mana/      Scryfall card-symbol SVGs, bundled for offline use
scripts/          one-off tooling (Moxfield binder conversion)
docs/             procedures too long for the README
```

Rust is deliberately thin: it registers plugins and owns file I/O
(`cache_card_image`, `read_text_file`, `write_text_file`). Everything else —
deck rules, parsing, queries, stats — is TypeScript.

### Application data

```
~/Library/Application Support/com.decklab.app/
  decklab.db      decks, collections, and the incremental card cache
  images/         downloaded card images
```

Dev and release builds share this, so your data carries across both. Deleting
`decklab.db*` gives a clean first run.

**Schema changes need a new migration file**, not an edit to an existing one —
applied migrations are recorded and checksummed in `_sqlx_migrations`, so editing
one already applied does nothing at best and errors at worst. Add
`src-tauri/migrations/00N_thing.sql` and register it in `migrations()` in
`src-tauri/src/lib.rs`.

---

## Importing

Paste, file, or URL — all through one parser. Arena, MTGO, Moxfield, Archidekt,
plain lists and CSV all work, and everything shows a matched/unmatched preview
before it commits.

Archidekt supports URL import directly. **Moxfield blocks automated requests**
(403 from Cloudflare on every endpoint including the public page), so use their
export and paste it, or follow
[`docs/importing-moxfield.md`](docs/importing-moxfield.md) for binders you do not
own.

```bash
python3 scripts/moxfield_binder_to_csv.py data/moxfield-binder.json -o data/binder.csv
```

Standard library only, no packages required.
