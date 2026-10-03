# Panel state

Where a panel's state lives, and how it survives navigation.

## Three kinds of state

The kind decides where it lives:

| Kind | Lives in | Survives | Examples |
| --- | --- | --- | --- |
| **Preference** | durable app state | everything | wall/list, sort, list/piles |
| **Object-bound** | the component | nothing; resets with its object | selected printing, a collection's facet filters |
| **Derived / expensive** | a cache keyed by its input | as long as the key is valid | search results, printings, collection counts |

The test for the first two: *if the object changes, does this setting still mean
the same thing?* Wall-vs-list means the same for any collection. A selected
printing means nothing for a different card.

The third row is not state at all, which is why lifting it would be the wrong
shape. Results are cached **by query**, so returning to a search re-renders
instantly from cache, following the pattern printings already use.

## Retention

Panels are conditionally rendered, so navigating used to unmount them and lose
everything: search, click a deck to add a card, come back to an empty box.

State moved out of the component instead of the component staying alive.
`src/lib/panelState.ts` is a module-level store keyed by panel identity
(`universe`, `deck-pool:<id>`, `collection:<id>`), with a `useRetained` hook that
behaves like `useState` but seeds from the slot and writes through. The
alternative, keeping panels mounted and hidden, was rejected: it costs a grid of
DOM per visited panel, all of them re-querying on every mutation.

The two halves are written differently:

| | Fields | Written | Why |
| --- | --- | --- | --- |
| **Lift** | `filter`, `showFilters`, `scopesOff`, `narrowToLit`, `sort`, `sortFlipped`, `layout` | field by field | independent of each other |
| **Cache** | `rows`, `shown`, `total`, `exhausted` | one object, with a signature | rows from one query plus another's paging state would page the wrong stream |
| **Leave** | `loading`, `error`, `editingName`, `draftName` | not at all | restoring `loading: true` with no request in flight is a lie the store cannot back |

**Staleness is pulled, not pushed.** The cache's signature is `fetchSignature`
in `src/lib/poolFetch.ts`, which is also the fetch effect's only dependency, so
the two cannot drift apart. It includes the mutation counter only while the
grid is local, because only then can a write change the rows (see `bugs/001`).
A write made while a panel is unmounted therefore still invalidates it on
return. Pushing invalidation from `App` would be the `bump()` trap again: a
convention with nothing enforcing it. The one thing `App` must push is
`forgetPanel` on delete, which no panel can detect for itself.

## Clear

Retention made a toolbar `Clear` necessary. A filter set ten minutes ago in
another view now survives, and the query text is exactly what the
*More filters (n)* badge does not count. `Clear` resets search, facets and
scopes, and leaves sort and layout, which are view preferences. It is always
present and greyed out when there is nothing to clear, because a button that
comes and goes reflows the toolbar under the pointer.

The facet bar's *Clear all* used to replace the whole filter object, wiping the
search box despite a comment saying it cleared "facets only". It is now
genuinely facets-only, so the two controls differ.
