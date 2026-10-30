# Moves and plans

Part of the inventory model; the overview is [`README.md`](README.md).

## Moves and plans

A **move** is a set of edges, `source —(n copies of a bucket)→ target`. It is
a value of its own, not just a write: it describes the state before and the
state after.

- **An edge carries one bucket**, what is known about the copies. Moving
  loses no information, so a C21 foil landing beside *Sol Ring, printing
  absent* stays its own bucket.
- **A move is a signed spec per location**: at the algebra's `integer`
  quantity, each edge is `−n` at its source and `+n` at its target, summing
  to zero. That zero is the conservation law that keeps collections
  unchanged.
- **Add and remove are moves to and from All Magic.** Then every write is a
  move, and a collection's total changes exactly when a move crosses an
  inventory's boundary. Today every write is the boundary kind.

**Acquisition list and trades.** The edges of a plan whose source is outside
your inventory are the cards to get, grouped by where from: *ask Dave* for
edges from his binder, *buy* for edges from All Magic. A move with edges both
ways between your inventory and Dave's is a **trade** proposal. When `+` picks
a source, the natural default order is your own locations, then tracked
binders, then All Magic. `Diff(goal, collection)` then appears as edges.

**Temporary locations** are real piles that exist for a while, so a half-done
job is an honest state:

- **A pull pile.** One pass through the binders for three decks, sorted into
  the decks later.
- **A to-file pile.** A teardown or a purchase lands here before filing.
- **A trade pile.** Cards set aside for Dave, so they stop counting as
  available to your own plans.

**Sources may be unresolved; targets may not.** A planned edge can take from
a collection that is not a location — *a Sol Ring from somewhere in Paper* —
and be resolved to a real location before it is committed. Its target is
always a location.

- **Demand is specific, supply is fungible.** Goals sit on targets, so where a
  card goes is the point. Copies in a bucket are interchangeable, so where one
  comes from matters to nobody's goal.
- **Physically**, you know where you are putting a card; you go and find it.
- **Into a non-location** is a move into a temporary location, planned onward
  later.
- An ω set as a source is All Magic with a constraint on the bucket. A goal
  is never a source: no copies live there.

So a move's targets are always resolved, while its sources can be resolved
one edge at a time. "Resolved" is not "committed": committing is carrying the
edge out.

### Pending moves: the active move

**A move is an asset that you make *active***, the way a deck or collection
is active. **`+`/`−` write into the active move** rather than committing,
which fits *Destination* in `CLAUDE.md`: the move is just another
destination. Viewing through it is viewing the hypothetical inventory, like
checking out a branch.

**A location's pending edges are a view, not storage.** Every view of a
location can show what its pending edges would do to it, across every move,
whether or not the location is active. That need not be a list of arrows; it
is a visual language on the tiles themselves: which cards *stay*, which are
*leaving*, which are *arriving*, and which copies are *contested*. The
location's goal informs the same language: a card *missing* from the goal, a
card in *excess* of it, and whether the pending edges would close the gap.

*Considered and set aside:* an **attached** move, one pending move stored on
each location and holding its inbound edges. Any set of edges already splits
by target, so it would store nothing the moves do not; what it offered, *what
is planned into this deck*, is the view above.

Working with pending moves:

- **Commit or stash.** Commit when done; stash until you have time.
- **Commit edge by edge.** Ticking off *done with Binder 2* commits those
  edges and leaves the rest pending.
- **Pending moves compete for copies.** Two decks can each plan to take the
  one Sol Ring in Binder 2, so validity is checked across every pending move,
  and contested copies show as such.

### Plans

**A plan is not a separate kind of asset.** A move can already carry any
number of edges across any locations, and moves sum: each is a signed spec
summing to zero, so their sum is too. *Plan A versus plan B* is two moves,
one active.

**The plan** is the sum of every pending move. Applying it gives a
hypothetical inventory that every question can be asked against: *which
decks become complete, which binder runs out*.

- A plan is valid when no location goes below zero.
- A plan can go stale when the inventory changes underneath it; recheck
  before committing.
- A plan counting on learning more ("needs a C21 among your Sol Rings of
  absent printing") is speculative and should say so.
- Committed moves are a history: *where did my Sol Ring go*, and undo. The
  same idea as *Version control* in `TODO.md`, applied to inventory.

*Possibly later:* a **derived move**, stored as a definition the way a union
is: *Commander night* as the sum of three decks' pull moves, made active as
one.

**Surplus is the natural source to plan against.** A location's surplus is
what it holds beyond its goal's lower bound, `Diff(actual, lo)`. A union's
surplus is the sum of its parts' surpluses, each against its own goal — not
`Diff(Paper, goal(Paper))`, since a deck short of a Sol Ring does not cancel a
binder's spare one.

- **Goals double as protection.** All of a plain binder is surplus; none of a
  built deck is; "keep whole" makes a binder's surplus zero.
- **Excess** goes further: copies above `hi` should leave, `Diff(actual, hi)`.
- **Available** is surplus less what other pending moves already take.
- **Grain.** Surplus is exact at the goal's grain; *which* copy is spare is a
  source choice.
- A trade binder's "my duplicates" is the surplus of everything else.

**Plans can be derived from goals**: the moves that would satisfy them. That
is a flow problem with sources, sinks and finite copies. Goals can compete for
one copy, so not every combination is satisfiable, and "which decks can I
complete at once?" is the feasibility question.

