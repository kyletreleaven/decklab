# The asset tree

Part of the inventory model; the overview is [`README.md`](README.md).

## The asset tree

The model has many kinds of entity, and a flat sidebar of decks and
collections cannot hold them. What ties them together is **one tree of
assets**, after Unity's Project window. Its open work is in `TODO.md` →
*The asset tree, in the lab*.

**What is an asset.** Anything the DeckLab language defines — collections,
filters, decklists — and everything in this doc: locations (cells, and groups
such as a binder), goals, moves. A friend's binder is an ordinary
location asset. **All Magic is the only special one**: built in, `∞`, never
summed into a collection.

**Any asset can act as a folder** — a lean, not a decision. Every asset has
a parent, so a deck can hold its decklist, goals and moves the way Unity
nests sub-assets, and a pure folder is an asset with no type.

**A folder only organises.** Containing means nothing: a folder sums nothing,
and whether a binder holds a card never depends on which folder it sits in.
That holds for an asset acting as a folder too: **a definition does not refer
to its children**, at least not automatically. A binder holding three sheets
is not their union unless its definition says so — a sum collection's
does, and is nothing else ([`README.md`](README.md) → *Unions*); a deck holding a decklist
is not thereby built from it. References go by path, and renaming or moving
an asset rewrites every reference to it in the same transaction, so a
reference follows its target rather than staying with the old position.
**No identifiers where properties or a path will do** — in the model and
in the library file. Inside the database, asset ids are fine wherever they
make that transaction simpler (store a reference by id, render it as the
current path); a dump writes paths and elides the ids, and a load assigns
fresh ones.

**Siblings have no order.** A hand-made order is a viewing preference, not a
fact about the collection, so the tree stores none: it shows siblings by
name, and a file writes them in a canonical order. A custom order could come
back someday, as a view's. So moving an asset is only ever *into* another,
never *between* two. (An arrangement's piles do keep their order: that is
order inside one asset, and it means something.)

| Unity | Here |
| --- | --- |
| Every asset has a GUID; references go by GUID | a goal names its decklist, a move its locations, by path; renaming or moving rewrites those references in one transaction, so it never breaks a link, with no GUID needed |
| Asset types, a per-type *Create* menu, search by type | `t:deck`, `t:move`, `t:filter`; *Create* offers what fits where you are |
| The Inspector shows whatever is selected | the card panel, generalised to any asset |
| Labels across folders | tags on assets, possibly as an alternative or complement to the tree |

**Naming a set in a query.** Card search extends Scryfall's syntax the way
`cmdr` does: `:ramp` means "in the ω set named `ramp`". A typed name has to
become a reference. Two marks, each answering one question, the way Excel
marks `$`:

- **`&`: does it follow the target?** Without it, **pinned**: it follows
  the set. With it, **by name**: whatever is at that path when the query
  runs.
- **A leading `/`: anchored where?** With it, **rooted**. Without it,
  **relative** to where the query lives, and downward only.

| | The target moves or is renamed | The query's owner moves | The owner is copied | Another set takes the target's old path |
| --- | --- | --- | --- | --- |
| `:/staples/ramp` pinned, rooted | followed: rewritten | unaffected | the copy points at the *original's* set | ignored |
| `:ramp` pinned, relative | followed while it stays below the owner; if it leaves, becomes rooted | still its own | the copy points at *its own* | ignored |
| `:&/staples/ramp` by name, rooted | not followed: means whatever is there | unaffected | same path | picked up |
| `:&ramp` by name, relative | not followed | still its own | the copy's own: a template checklist's `:&ramp` finds each deck's own ramp | picked up |

**Typing a bare name searches.** `:ramp` as typed is looked up by name, then
stored as a pinned reference: relative when the set is below the query's
owner, rooted otherwise. The same tables, for the library file, are in
[`library-format-5.md`](../library-format-5.md) → *References*.

- **Pinned is the default** because most queries become saved state — live
  pools, checklists, deck pools — and saved state should not break when a set
  is renamed. It is also the path rule above. A `cmdr` file pasted in means the
  same, since within one file binding early and binding late agree.
- **Pinning happens as you type.** No set by that name is an error, or an
  offer to create one. Two sets by that name: take the nearest or ask, then
  render enough path to tell them apart. A pinned set later deleted shows as
  broken, like Excel's `#REF!`, rather than matching nothing.
- **`&` is for what pinning cannot do**: a set that does not exist yet, and
  `cmdr`'s open definitions (`<<`), where several definitions add to one name.
- **The token says which references a rename rewrites**: pinned ones are
  rewritten, `&` ones never are. None needs an identifier.

**Facets: implicit assets.** Some assets come with every asset of a type:
derived, never stored, never made by hand. They are **facets** of their
asset, written as a suffix: `/` is *contains*, `.` is *derived from*.

| Facet | Is |
| --- | --- |
| `MyDeck.arranged.by_mana`, `.by_type`, `.by_colour` | automatic arrangements of a decklist |
| `MyDeck.oracle` | the decklist's oracle projection ([`goals.md`](goals.md) → *Every decklist has an oracle projection*) |
| perhaps `Binder.surplus`, `Wishlist.missing` | derived from goals and contents ([`moves.md`](moves.md) → *Plans*) |

- **The ontology declares them.** Each type says which facets its assets
  have; facet names are identifiers from code (`by_mana`), not user names.
- **A facet holds nothing.** It is not a place in the tree, so nothing sits
  under it. The tree may show an asset's facets, set apart.
- **Facets chain** where the facet's own type declares facets:
  `MyDeck.oracle.arranged.by_type` arranges the oracle projection.
- **Referenced like any asset.** Relative to its owner, a facet starts with
  the dot: a deck's `shows = ".arranged.by_mana"` is its own, and a copied
  deck's is the copy's. A facet never moves or is renamed on its own, so
  pinned and by-name references to one differ only as relative and rooted
  do.
- **Materialise to edit.** A facet cannot be edited; copying it makes an
  ordinary asset that starts as an exact snapshot, as rendering a live pool
  to a literal one does.
- **Never in a library file.** A dump skips facets, so adding one needs no
  new version.

All Magic stays a built-in asset of its own, not a facet.

**Quoting in paths.** A path segment containing anything special — `.`,
`/`, `&`, `:`, a quote, or a space where the context needs one — is wrapped
in quotes, as Windows quotes a path with spaces; a quote inside a name is
doubled. An unquoted `.` always starts a facet.

```
/Decks/"Atraxa v1.2".arranged.by_mana
/Binders/"St. Louis"/"Trade/Keep"
```

So names can hold any character, and the text alone says what a path
means: reading one never depends on the asset's type. Queries needed a rule
for names with spaces anyway (`:"Atraxa v1.2"`), and it is the one Scryfall
syntax already uses for values (`o:"draw a card"`).

## Sources and targets

How a view's cards reach another asset. Two roles, and one operation
between them.

**The source is the view you are in.** A tile hands over the bucket it
stands for, whole: printing, finish, attributes, as the source has them.
From All Magic or a query pool that is what the grain says — the card at
Cards, the printing at Printings; from an asset, the line itself. The
target never guesses what a tile meant.

**The target is set in the tree** (*Set as target*), and is what a tile's
buttons act on. Its type decides what they do:

| Target | `+` | `−` |
| --- | --- | --- |
| list pool | the bucket becomes a member (`+`) | it stops being one (`×`) |
| checklist, exact checklist | the line asks for one more, made at 1 | one fewer, gone at 0 |
| place | one more copy in that bucket | one fewer, gone at 0 |
| place, from another place | one copy **moves** to the target (`→`) | one moves back (`←`) |

A copy is in one place at a time, so place to place is never *add*. A
step is one; copying a whole line or asset is an action of its own. Viewing
the target itself is editing it. A decklist is not a target: its zones are.

**How an asset is drawn**, so a tile can always say which bucket it is:

- **A checklist, a tile per line.** Its lines can overlap — at least four
  Bolts, at least one of them M10 — so a card's total is a number nobody
  asked for ([`goals.md`](goals.md) → *Checking a deck against its decklist*). No grain toggle.
- **A place or a pool, a tile per card.** A place's lines are disjoint, so
  its total means something. A tile standing for one bucket has its
  buttons; one standing for several has them greyed, and the bucket is
  chosen where the card's buckets are listed — the detail, beside the
  wall.

**Changing a bucket is one operation: move n of B to B′.** B loses n, and
is gone at 0; n of B′ join any B′ already there. It covers setting,
changing or clearing a printing, finish or attribute — clearing is how a
guess is taken back — for all of a line or a split of it; and, between
two places, a copy moving. B′ is the same card; a printing must be of it,
and a finish one it comes in. A pool has no counts: its member is B or
B′, whole.

**Attributes start as a fixed set** — condition, signed, altered, note —
declared on first use, so keys do not drift. Language is not one: it is
part of the printing.

