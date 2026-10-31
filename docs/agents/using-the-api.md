# Using DeckLab's agent API

For an agent working with a DeckLab user: reading their decks, collections
and pools, and writing pools they can build from. This is the whole guide;
the API serves it at `GET /guide`, so it always matches the running app.
(How the API is built is in `docs/agent-api.md`, and you do not need it.)

## Before you start

- **The user turns it on.** DeckLab → Tools → Agent API → *Enable*, then
  *Copy Token*, and gives you the token. It is off at every launch, and a
  new token revokes the old one: a `401` means ask for the current one.
- **Every request** goes to `http://127.0.0.1:47474` (the user may have set
  another port) with `Authorization: Bearer <token>`.
- **The lab routes need lab mode** (`npm run lab`, the window titled
  *DeckLab — LAB*). Otherwise they answer `404` saying so.
- **The app must be open.** If it has sat in the background a long while, a
  request can time out (`504`); ask the user to bring it forward.

## The model, in one paragraph

Everything is an **asset** in one tree, named by its **path**:
`/Binders/Red`, `/Decklists/Golbez/main`. Types: `folder`; `place` (where
copies are: a binder, a box, a deck's zone); `sum` (a collection adding up
the places under it); `checklist` and `exact checklist` (what should be
somewhere: at least, or exactly, these counts); `list pool` (a set of
cards, no counts); `query pool` (a saved search); `decklist`, `deck`,
`arrangement`. A card line names its card by `card` (name), `oracle`
(Scryfall oracle id), or `set` and `number` (one printing), plus optional
`finish`.

## Routes

| | |
| --- | --- |
| `GET /guide` | this guide |
| `GET /lab/tree` | every asset: `name`, `path`, `type`, a query pool's `query`, `children` |
| `GET /lab/assets/<path>` | one asset, with its cards |
| `PUT /lab/assets/<path>` | create or replace a **pool** |

Paths go in the URL segment by segment, percent-encoded:
`/lab/assets/Decklists/Golbez%20Proliferate/main`.

**Writing a list pool** — as a decklist, one card per line (counts are
ignored: a pool has none; `(SET) 123` pins a printing):

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/plain" \
  --data-binary $'1 Sol Ring\n1 Arcane Signet\n1 Golbez, Crystal Collector (FIN) 225' \
  http://127.0.0.1:47474/lab/assets/Pools/Golbez/ramp
```

or as JSON: `{"type": "list pool", "cards": [{"card": "Sol Ring"}, {"set":
"fin", "number": "225"}]}`. A **query pool**: `{"type": "query pool",
"query": "o:proliferate id<=ub"}`, in Scryfall's syntax.

A `PUT` replaces the pool's members with what you send, makes any folders
missing above it, and answers `201 {"created": true, "members": n}` for a
new pool, `200` for a replaced one. The user's screen updates by itself.

## Rules

- **Put your work where the user expects it.** Ask, or use a folder the
  user names; a pool per role (`Pools/<deck>/ramp`) is easy to build from.
- **Do not overwrite what you did not make** without asking: a `PUT`
  replaces. Read first (`GET`) if unsure.
- **Cards come from the user's card store, never the internet.** A card it
  has never seen is refused by name (`400`, *Not in the card store*). Do
  not retry: tell the user, who can look the card up in DeckLab once, or
  send a printing it already knows.
- **Errors** are `{"error": "…"}`, meant to be read: `400` your request (it
  says what), `404` nothing at that path, `409` another type at that path,
  `401` the token.
