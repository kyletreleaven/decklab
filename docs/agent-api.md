# The agent API

An agent should be able to do what the app does — search the card cache, read
and edit decks and collections, import and export — without driving the UI.
That means an API, and a `decklab` CLI over it, on the same data and the same
logic rather than a second implementation of it. What is left to build is in
[`TODO.md`](../TODO.md) → *Backend factoring and a companion CLI*.

## One owner, not two clients

The CLI does not open the database or call Scryfall itself. Exactly one process
owns the SQLite file and the `scheduledFetch` queue, and the app's UI and the
CLI are both clients of it. (The library tool in [`cli.md`](cli.md) is a
separate tool: it reads a database file directly, under the dump/load
exception in [`principles.md`](principles.md), and never writes.) That single
decision settles the hard parts:

- **Rate limit.** CLI traffic goes through the same queue, in a lane of its
  own, ranked last. One pipe, one 429 pause, one client as far as Scryfall can
  tell. Two processes each with their own queue would be two clients,
  whatever their spacing.
- **UI freshness.** Every write goes through the owner, so the owner can tell
  the UI exactly when something changed, rather than a coarse "the file
  changed" from polling `PRAGMA data_version`. It still has to *tell* it —
  see below.
- **Concurrent writes and migrations.** Moot: one connection, one migration
  runner.

## Where the owner lives

1. **The app is the owner.** Rust listens on a localhost port and forwards
   each request to the webview, whose TypeScript runs it with the existing
   `src/lib/` and replies. No new runtime. Cost: the app has to be open.
2. **A headless TypeScript backend.** A Node or Bun process (Tauri sidecar,
   Node SEA or `bun --compile`) owns the database and the queue; the webview
   talks to it over HTTP and gets change events pushed back. Works with the
   app closed. Costs a bundled runtime, an adapter seam in `src/lib/`,
   migrations moving out of `tauri-plugin-sql`, and the webview becoming a
   client of its own backend.

**We are on (1).** (1) is a strict subset of the work of (2): the routes,
token check and CLI are the same either way, so starting with (1) loses
nothing if (2) is wanted later.

Why not Rust for the backend: the logic is TypeScript, per the stack note in
`TODO.md`. A Rust backend would mean porting `compileQuery`, `decklist.ts` and
the collection model.

### The seams (2) would have to cut

Tauri reaches `src/lib/` through exactly three places. Under (1) they stay;
under (2) each takes its implementation from a runtime module set at startup.

| Seam | Where |
|---|---|
| SQLite | `db.ts` (`@tauri-apps/plugin-sql`) |
| HTTP | `scryfall.ts`, `urlimport.ts` (`@tauri-apps/plugin-http`) |
| Image cache | `images.ts` (`invoke("cache_card_image")`) |

Dialogs, clipboard and opener are component-side and stay there.

### (1) is half standard, half not

A desktop app serving a localhost API behind a token the user hands over is
well-worn: Jupyter, AnkiConnect, Obsidian's Local REST API. The unusual part is
the hop inside. A typical Tauri app keeps its logic in Rust, the webview calls
Rust and never the reverse, and an HTTP server would call those Rust functions
directly. Ours lives in the webview, so the server has to call *into* it and
wait for an answer, which Tauri has nothing built in for. It is assembled by
hand: an event out, `invoke` back, a table of pending requests keyed by id.

### Staying on (1) rather than moving to (2)

| | |
|---|---|
| ✅ No bundled runtime | The app stays small; a bundled Node or Bun is very roughly 50–100 MB (unmeasured). |
| ✅ No per-platform sidecar builds | Nothing added to `build-macos.sh` or `build-linux.md`, no re-signing a Node binary after injection. |
| ✅ No process to babysit | No starting, stopping, crash detection or port handoff between processes. |
| ✅ Migrations stay put | `tauri-plugin-sql` keeps running them. |
| ✅ SQLite driver untouched | (2) rules out `better-sqlite3` (native addon, awkward to bundle) in favour of `node:sqlite` or Bun's. |
| ❌ The app must be open | The CLI has no API to talk to otherwise. The one thing only (2) fixes. |
| ❌ The hand-built bridge | Request/reply over events, with timeouts, is ours to get right. |
| ❌ Background webview throttling | **Confirmed**: a backgrounded app eventually times out. See [`bugs/003`](../bugs/003-agent-api-times-out-when-backgrounded.md). |
| ❌ Dev reloads | A request in flight during a webview reload times out rather than being served. |

**UI freshness is not free under either option.** It looks free under (1),
since API writes run in the same process as the UI, but `bump()` is a React
callback in `App.tsx` that components call *after* a write; the mutation
helpers in `decks.ts` and `collections.ts` do not signal. An API write updates
the database and leaves the screen stale. This is the `bump()` trap in
`TODO.md` → *Known debt*.

Move to (2) when the closed-app case is actually wanted, or if throttling
cannot be fixed from inside the app.

## How (1) is built

```
curl ──HTTP──▶ Rust (axum, src-tauri/src/api.rs)
                 │  emit "api-request" {id, method, url, headers, body}
                 ▼
               webview (src/api/bridge.ts)
                 │  new Request(...) → app.fetch() — Hono, src/api/app.ts
                 ▼
               invoke("api_reply", {id, reply}) ──▶ Rust ──HTTP──▶ curl
```

Rust holds the listener and nothing else; what the API *does* is decided in
`src/api/`, so it moves with the TypeScript under (2). A request waits 10s for
the webview, then gets a 504.

### Hono for the router

Express, Koa and Fastify are built on Node's `http` objects, so they cannot run
in a webview that never sees a connection. Python has WSGI/ASGI as a standard
interface between server and framework; Node's older frameworks predate any
equivalent. The equivalent arrived later as the Fetch API's
`Request`/`Response`, and Hono is built on it: the webview builds a `Request`
from Rust's event, calls `app.fetch(request)`, and sends the `Response` back.

The same app runs on Node or Bun under (2) unchanged, which is the main reason.
Also available: typed routes, Zod validation, an OpenAPI spec via
`@hono/zod-openapi` that an agent can read to discover the API, a typed client
(`hc`) the CLI can use, and GraphQL as middleware.

REST rather than GraphQL to start: a handful of resources and one client we
write. GraphQL can be added beside REST at `/graphql`, resolvers calling the
same functions, if cross-resource queries are wanted — but check first whether
the card-set algebra (Campaign 3) already answers them.

### Access: off by default, token from the menu

Tools → Agent API holds *Enable Agent API*, a status line with the port,
*Copy Token* and *New Token*.

- **Off at every launch, nothing remembered.** Nothing listens until the user
  enables it, so the security-conscious do nothing. Enabling binds
  `127.0.0.1:47474` (`DECKLAB_API_PORT` overrides) with a fresh token;
  disabling closes the port, and requests in flight get a 503.
- **The token never appears on screen.** Copying is the only way to get it,
  so screen sharing cannot leak it. New Token revokes the old one.
- **The token check lives in Hono middleware**, not Rust, so it moves with
  the routes. It asks Rust for the token on every request, so a rotation
  takes effect at once, and `null` (API off) lets nothing in.
- **Every route checks it, unknown ones included.** A web page can send
  requests to `127.0.0.1` but never sees the token, so a route that skipped
  the check would be one a page could use. That is also why a `Host` check is
  not needed: DNS rebinding lets a page *read* localhost replies, but it still
  has no token to send.

**The menu.** On macOS the menu is Tauri's default plus Tools, inserted before
Window. Starting from the default matters: replacing it would lose Edit, and
with it ⌘C/⌘V in text fields. Tauri sets no menu on other platforms, and text
editing works without one there, so the in-window menu bar holds only Tools.
That branch has not been compiled on Linux yet.

## Lab routes

For an agent designing a deck with you — `cmdr`'s, say — to work on the
lab's assets beside you. **Lab mode only**: under `npm run lab` the routes
read and write `lab.db`; otherwise they answer 404. Built a step at a time:
reading first, then pools.

- **Assets by path, as in the library file.** No ids: a path is what a
  person and an agent both say (`inventory/README.md` → *The asset tree*).
  A URL's segments are the path's names, percent-encoded, with no quoting.
- **The library format, as JSON.** An asset is the object `readLab` gives
  and [`library-format-5.md`](library-format-5.md) describes: one format,
  read and written, with no second schema to drift.
- **No Scryfall.** A card is resolved from the card store — by name, oracle
  id, or set and number — and one the store has never seen is refused and
  named, never fetched. Fetching would go through the scheduler, with a
  request count first; not yet.
- **A write tells the app.** The routes call back after each write, and the
  app reads the tree and any open view again, so the screen is never stale.

| Route | |
| --- | --- |
| `GET /guide` | how to use the API, for an agent: [`agents/using-the-api.md`](agents/using-the-api.md), bundled, so it matches the running app. Any mode |
| `GET /lab/tree` | every asset: name, path, type, a query pool's query, children |
| `GET /lab/assets/<path>` | one asset, as the library file's object |
| `PUT /lab/assets/<path>` | create or replace a **pool**: a list pool's members (`cards`) or a query pool's `query`. Missing folders above it are made. A different type at the path is refused (409) |

A list pool's members can also be sent as text: `PUT` with `Content-Type:
text/plain` and a decklist — one card per line, counts ignored, `(SET) 123`
pinning a printing — parsed as an import is.

```bash
TOKEN=…   # Tools → Agent API → Copy Token
curl -s -H "Authorization: Bearer $TOKEN" localhost:47474/lab/tree
curl -s -H "Authorization: Bearer $TOKEN" localhost:47474/lab/assets/Decks/Golbez
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/plain" \
  --data-binary $'1 Sol Ring\n1 Arcane Signet (C21) 263' localhost:47474/lab/assets/Pools/Golbez/ramp
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"query pool","query":"o:proliferate id<=ub"}' localhost:47474/lab/assets/Pools/Golbez/proliferate
```

A `PUT` answers `201` with `{ "created": true, "members": n }` for a new
pool, `200` for a replaced one; a refusal is `{ "error": … }`, with `400`
for a bad body or a card the store lacks, `409` for another type at the
path.
