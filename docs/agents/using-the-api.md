# Using DeckLab's agent API

For an agent working with a DeckLab user: reading their decks, collections
and pools, and writing pools and decklists they can build from. This is the whole guide;
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
| `GET /lab/tree` | every asset: `name`, `path`, `type`, a query pool's `query` and `filters`, `children` |
| `GET /lab/assets/<path>` | one asset, with its cards |
| `GET /lab/assets/<path>` + `Accept: text/plain` | a decklist as text |
| `PUT /lab/assets/<path>` | create or replace a **pool** or a **decklist** |
| `DELETE /lab/assets/<path>` | delete an asset and everything below it |

Paths go in the URL segment by segment, percent-encoded:
`/lab/assets/Decklists/Golbez%20Proliferate/main`.

With DeckLab's `decklab` command installed, `decklab assets tree | get |
put | rm` does the same with files — `decklab assets get /Decklists/Golbez
golbez.txt`, edit, `decklab assets put /Decklists/Golbez golbez.txt` — the
token in `$DECKLAB_TOKEN`. Its errors are the API's.

**Writing a list pool** — as a decklist, one card per line (counts are
ignored: a pool has none; `(SET) 123` pins a printing):

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/plain" \
  --data-binary $'1 Sol Ring\n1 Arcane Signet\n1 Golbez, Crystal Collector (FIN) 225' \
  http://127.0.0.1:47474/lab/assets/Pools/Golbez/ramp
```

or as JSON: `{"type": "list pool", "cards": [{"card": "Sol Ring"}, {"set":
"fin", "number": "225"}]}`. A **query pool**: `{"type": "query pool",
"query": "o:proliferate id<=ub"}`, in Scryfall's syntax. It may add
`filters`, the settings the user sees under *More filters* rather than in
the search box, e.g. `{"colors": ["U", "B"], "colorField": "identity",
"colorOp": "containedBy", "types": ["Creature"], "mvMax": 3}`; the pool
searches query and filters together. Reading a query pool gives both back.
The keys, each optional: `colors` (of W U B R G), `colorField` (`colors` or
`identity`), `colorOp` (`contains` or `containedBy`), `colorCountMin`,
`colorCountMax`, `types` (of Creature Instant Sorcery Artifact Enchantment
Planeswalker Land), `rarities` (of common uncommon rare mythic), `mvMin`,
`mvMax`, `paperOnly`. Sending only `query` clears any filters.

A `PUT` replaces the pool's members with what you send, makes any folders
missing above it, and answers `201 {"created": true, "members": n}` for a
new pool, `200` for a replaced one. The user's screen updates by itself.

**Writing a decklist** — as text, with zone headings:

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/plain" \
  --data-binary $'Commander\n1 Golbez, Crystal Collector\n\nDeck\n1 Sol Ring\n1 Arcane Signet\n\nMaybeboard\n1 Mana Crypt' \
  "http://127.0.0.1:47474/lab/assets/Decklists/Golbez?type=decklist"
```

Headings: `Commander`, `Deck` (lines before any heading are the deck too),
`Sideboard`, `Maybeboard`. `?type=decklist` is needed only to make a new
one: text sent to an existing decklist is read as one. Or as JSON:
`{"type": "decklist", "format": "commander", "zones": {"commander":
[{"card": "Golbez, Crystal Collector"}], "main": [{"card": "Sol Ring",
"qty": 1}]}}` — zones `commander`, `main`, `side`, `maybe`, each line a
card's keys plus `qty` (default 1).

**Zone by zone:** each zone you send replaces that zone; a zone you leave
out is left alone, so `Deck` alone changes the main deck only. An empty
heading (or `[]`) empties its zone. Answers `{"created": …, "zones":
{"main": 99, …}}`, the copies in each zone written. Read it back as text
with `Accept: text/plain`, in the same shape. A zone the decklist shares
with another (the user set that up) is refused, `409`.

**Deleting:** `DELETE /lab/assets/<path>` answers `204`. Refused (`409`)
while something else depends on it — a deck building that decklist — and
where it or anything below it records copies the user holds.

## Rules

- **Put your work where the user expects it.** Ask, or use a folder the
  user names; a pool per role (`Pools/<deck>/ramp`) is easy to build from.
- **Do not overwrite or delete what you did not make** without asking: a
  `PUT` replaces. Read first (`GET`) if unsure.
- **Cards you name are looked up for you**, in the user's card store and, if
  it has never had one, on Scryfall, through DeckLab's own rate-limited
  channel. Up to **150 unknown cards a request**; more is refused before
  anything is sent, so split a long list. A card Scryfall does not know
  either is refused by name (`400`, *no card has that name*, *no such
  printing*): fix the name, do not resend it unchanged.
- **Errors** are `{"error": "…"}`, meant to be read: `400` your request (it
  says what), `404` nothing at that path, `409` another type at that path
  or something in the way, `401` the token, `503` Scryfall did not answer —
  wait before trying again, never at once. A refused write writes nothing.
