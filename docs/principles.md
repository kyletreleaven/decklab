# Design principles

Rules the design keeps to everywhere, each with the reason it exists.

## One way in

**Every operation goes through the domain layer**: the functions in
`src/lib/` that add a card, rename a deck, move a card to a pile. The UI, the
agent API and the CLI are all clients of those same functions. None writes
tables itself, and none has a private copy of a rule. An operation a client
cannot reach yet is a missing function or route, not a reason to go around
the layer.

Why: one implementation of each rule, so the UI and an agent can never
disagree about what an operation does. It is the same reasoning as
[`agent-api.md`](agent-api.md) → *One owner, not two clients*, applied to
logic rather than to the database file.

**The one exception is a schema's dump and load** (`src/lib/library/`).
They are backup and restore, and must put rows back exactly as they were:
timestamps, defaults, and rows the domain functions would merge. So they
live with their schema, as a triplet, not with the operations
([`lab.md`](lab.md) → *The library file*).
