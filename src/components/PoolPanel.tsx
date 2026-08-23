import { useEffect, useMemo, useRef, useState } from "react";
import {
  collectionItems,
  collectionOracleIds,
  QueryError,
  UNIVERSE_ID,
  UNIVERSE_NAME,
} from "../lib/collections";
import {
  countActiveFilters,
  toScryfallQuery,
  type CardFilter,
} from "../lib/filters";
import {
  fromArray,
  fromPages,
  mergeSorted,
  take,
  type SortedSource,
} from "../lib/merge";
import { retain, retained, useRetained } from "../lib/panelState";
import { MAX_CARDS } from "../lib/saveSearch";
import { isSuperseded } from "../lib/scheduler";
import {
  availableSorts,
  comparator,
  DEFAULT_SORT,
  direction,
  remoteSort,
  type SortKey,
} from "../lib/sort";
import * as scryfall from "../lib/scryfall";
import type { Card, CollectionItem, QuantityKind } from "../lib/types";

/** One toggleable contextual constraint, e.g. format legality or colour identity. */
export interface Scope {
  key: string;
  label: React.ReactNode;
  title: string;
  filter: CardFilter;
}
import { CardFilters, type FilterGroup } from "./CardFilters";
import { CardImage } from "./CardImage";
import { ManaCost } from "./ManaCost";

/**
 * One rendered row, at oracle grain (a card) or printing grain (a held item).
 * The grain follows the stream, not a setting — see `rows`.
 */
/** The derived half of a panel's retained slot — never the only copy of anything. */
interface PoolResults {
  rows: Row[];
  shown: number;
  total: number;
  exhausted: boolean;
  /** What these results answer. Refetch unless the question is unchanged. */
  signature: string;
}

type Row =
  | { kind: "card"; key: string; card: Card }
  | { kind: "item"; key: string; card: Card; item: CollectionItem };

/** How many cards a page shows, so the union pages at a steady rhythm. */
const PAGE = 175;

/**
 * Scryfall rejects an empty `q`, but "everything" is a perfectly good pool to
 * open on — browsing beats an empty grid, and it is no more traffic than the
 * deck pool already spends, since `f:commander` excludes almost nothing.
 */
const EVERYTHING = "*";

/**
 * The candidate-card pool for the deck builder.
 *
 * One panel, two sources: Scryfall (the whole game) or a local collection (what
 * you own). The same filter model drives both — translated to a Scryfall query
 * string in one case and to a SQL predicate in the other — so switching source
 * keeps your filters rather than resetting them.
 */
export function PoolPanel({
  selectedId,
  onSelect,
  onHoverCard,
  stateKey,
  poolToggle = null,
  destination,
  foreground,
  scopes = [],
  refreshKey = 0,
  background = null,
  manage = null,
  onSaveSearch,
  activePrintings = {},
  compact = false,
}: {
  selectedId: string | null;
  onSelect: (card: Card) => void;
  /** Previews a card in the detail panel without changing the selection. */
  onHoverCard?: (card: Card | null) => void;
  /**
   * Where this pool's cards go, and how many are already there.
   *
   * A deck pool's destination is that deck *by construction* — it exists to fill
   * it — while the standalone search sends cards to the current target, which
   * may be a deck or a collection. Either way the panel does not care which kind
   * it is; it only adds, removes and counts.
   */
  destination: {
    name: string;
    /** Copies held, keyed by printing id. */
    quantities: Record<string, number>;
    add: (card: Card) => void;
    remove: (card: Card) => void;
  } | null;
  /**
   * The set you are looking at. Always rendered, always lit.
   *
   * `null` means there is no set of yours in play — the pool then draws the
   * background alone and nothing recedes, because there is nothing to contrast
   * with. All Magic as the foreground behaves the same way: it contains
   * everything, so lighting it lights the grid.
   *
   * `quantityKind` decides whether its rows carry counts at all. A binary set —
   * a saved search — answers membership, so quantities, totals and the stepper
   * would each be an ownership claim it never made.
   */
  foreground: { id: string; name: string; quantityKind?: QuantityKind } | null;
  /**
   * Contextual constraints, each independently toggleable. Separate rather than
   * bundled because a single "deck-legal" switch can only reach two corners of a
   * 2x2 — you could never ask for banned cards inside your colours, nor legal
   * ones outside them when weighing a splash.
   */
  scopes?: Scope[];
  /**
   * Bumped on every mutation. Only the *local* queries depend on it — the
   * Scryfall side must not re-fetch just because you added a card.
   */
  refreshKey?: number;
  /**
   * Show/hide the pool attached to this view. Rendered in the manage header,
   * so it only exists where there is a container to fill.
   */
  poolToggle?: { on: boolean; onToggle: () => void } | null;
  /**
   * Identity of this panel for retained state — `"universe"`, `"deck:<id>"`,
   * `"collection:<id>"`. Two panels sharing a key share their place.
   */
  stateKey: string;
  /**
   * The wider set drawn behind the foreground. `null` means All Magic — "no
   * particular background" and "everything" are the same thing, so unset needs
   * no separate value.
   *
   * Read-only here: it is app-level state, chosen from the card panel, because
   * it is copied in one view and consulted in the next. A control in this
   * toolbar would render once per panel and edit one shared value.
   */
  background?: { id: string; name: string } | null;
  /**
   * Editing the foreground, when it is a collection you own rather than a
   * search result or All Magic.
   *
   * Separate from `foreground` because identity and editability are different
   * questions: the deck-attached pool has a foreground it must not offer to
   * rename. Capability by absence, like `destination`.
   */
  manage?: {
    /**
     * Item-level edits, which only exist at printing grain. Separate from
     * `destination` because they address a *specific* row — this foil, this
     * printing — where the stepper addresses a card.
     */
    onSetItemQuantity: (item: CollectionItem, quantity: number) => void;
    onRemoveItem: (item: CollectionItem) => void;
    onRename: (name: string) => void;
    onDelete: () => void;
    onImport: () => void;
    onExport: () => void;
  } | null;
  /**
   * Keep the current search as a static collection. Absent where there is no
   * search to keep — a collection view is already a collection.
   */
  onSaveSearch?: (filter: CardFilter, sort: SortKey, flipped: boolean) => void;
  /**
   * The printing each card currently stands for, by oracle id — chosen in the
   * card panel. Consulted only at oracle grain: a printing-grain row already
   * *is* a specific printing, so substituting would be a lie about what you
   * hold.
   */
  activePrintings?: Record<string, Card>;
  /**
   * Strip the browsing chrome — layout toggle and totals — and stay a card wall.
   *
   * Set for the pool under a deck, which is a candidate strip in one half of a
   * split pane rather than a place you browse. A list view trades away the thing
   * that strip is for (seeing many cards at once) for detail the card panel
   * already gives, and a totals row there is either dashes or a subtotal of
   * somebody else's collection.
   */
  compact?: boolean;
}) {
  const [filter, setFilter] = useRetained<CardFilter>(stateKey, "filter", {});
  const [showFilters, setShowFilters] = useRetained(stateKey, "showFilters", false);
  const [scopesOff, setScopesOff] = useRetained<Set<string>>(stateKey, "scopesOff", () => new Set());
  /**
   * Whether cards outside the active collection appear, shadowed.
   *
   * Not "unowned": a card sitting in your Cube while Paper is active is owned,
   * just not *here*. The distinction matters now that scope is one named
   * collection rather than a vague aggregate.
   */
  // Viewing a collection means showing *that collection*, so the universe is
  // off by default there and on everywhere else. Initial state only: the panel
  // is remounted per view, so switching collections re-derives it rather than
  // carrying your last toggle across.
  const [showBackground, setShowBackground] = useRetained(
    stateKey,
    "showBackground",
    !manage,
  );
  const [sort, setSort] = useRetained<SortKey>(stateKey, "sort", DEFAULT_SORT);
  /** Inverts the sort's useful default rather than forcing ascending. */
  const [sortFlipped, setSortFlipped] = useRetained(stateKey, "sortFlipped", false);
  const [layout, setLayout] = useRetained<"wall" | "list">(stateKey, "layout", "wall");
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(foreground?.name ?? "");

  // Follow a rename made elsewhere, and reset a half-typed draft on navigation.
  useEffect(() => {
    setDraftName(foreground?.name ?? "");
    setEditingName(false);
  }, [foreground?.name]);

  function commitName() {
    setEditingName(false);
    const next = draftName.trim();
    if (next && next !== foreground?.name) manage?.onRename(next);
    else setDraftName(foreground?.name ?? "");
  }

  /**
   * The local branch's rows *as items*, not as cards.
   *
   * Quantity and finish are dropped when mapping to `Card`, and totals need
   * both — est. value has to pick `usd_foil` over `usd` for a foil copy. Only
   * ever populated in collection-only mode; the universe has no such thing.
   */
  /**
   * Results are seeded as one blob rather than field by field: a page of cards
   * with someone else's `nextPage` would page into the wrong stream, so they
   * are only ever restored together with the signature they were fetched for.
   */
  const cached = useRef(retained(stateKey) as Partial<PoolResults>);

  const [rows, setRows] = useState<Row[]>(() => cached.current.rows ?? []);
  const [inCollection, setInCollection] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(() => cached.current.shown ?? PAGE);
  const [total, setTotal] = useState(() => cached.current.total ?? 0);
  const [exhausted, setExhausted] = useState(() => cached.current.exhausted ?? false);
  const [loading, setLoading] = useState(false);

  /**
   * The merged stream still being drawn from, for `loadMore`.
   *
   * A ref because it is not renderable state, and because a generator cannot be
   * retained — restoring a panel gives back rows but no stream. See the cursor
   * note in `docs/merging-sorted-sources.md`.
   */
  const pending = useRef<AsyncGenerator<Row> | null>(null);

  const compare = useMemo(() => comparator(sort, sortFlipped), [sort, sortFlipped]);

  const [error, setError] = useState<string | null>(null);

  // Guards against a slow early request landing after a later one.
  const requestId = useRef(0);

  const activeScopes = useMemo(
    () => scopes.filter((s) => !scopesOff.has(s.key)),
    [scopes, scopesOff],
  );

  // Scopes AND onto the filter exactly like facets do; each sets its own keys,
  // so a shallow merge is enough.
  const effective = useMemo<CardFilter>(
    () => activeScopes.reduce<CardFilter>((acc, s) => ({ ...acc, ...s.filter }), filter),
    [filter, activeScopes],
  );
  const effectiveKey = JSON.stringify(effective);

  /**
   * All Magic as the foreground is not a set of yours to contrast against — it
   * contains everything — so it lights the grid rather than dimming it.
   */
  const foregroundIsUniverse = foreground?.id === UNIVERSE_ID;

  /**
   * Oracle ids in the foreground — the lit set. Keyed on `refreshKey` too, so
   * adding a card to it lights its tile immediately.
   */
  useEffect(() => {
    // Nothing to contrast with, so nothing to fetch.
    if (!foreground || foregroundIsUniverse) {
      setInCollection(new Set());
      return;
    }
    collectionOracleIds([foreground.id]).then(setInCollection);
  }, [foreground?.id, foregroundIsUniverse, refreshKey]);

  /**
   * Whether the background is what gets drawn.
   *
   * Three ways to end up there: nothing of yours is in play, the foreground is
   * All Magic (which *is* the background), or you asked for it. Otherwise the
   * foreground is drawn alone, from the local query.
   *
   * The background is All Magic and nothing else for now. Once it can be any
   * set this stops being a branch and becomes a union — which needs the two
   * streams merged, since neither would contain the other.
   */
  const drawingBackground =
    !foreground || foregroundIsUniverse || showBackground;

  /**
   * All Magic on either side collapses the union: it contains every other set,
   * so drawing both would be drawing All Magic twice — and worse, it would
   * *duplicate*, since a collection holds printing X while `unique=cards`
   * returns printing Y of the same card and dedupe-by-printing cannot see it.
   *
   * This is the only containment we get for free. Deciding it in general is as
   * expensive as merging, so every other pair merges.
   */
  const backgroundIsUniverse = !background || background.id === UNIVERSE_ID;
  const unionCollapses = foregroundIsUniverse || backgroundIsUniverse;

  /** Whether Scryfall is one of the sources — what the sort menu turns on. */
  const usesRemote = foregroundIsUniverse || (drawingBackground && unionCollapses);

  /** The collection the local branch reads: the foreground, when it is drawn. */
  const localSourceId = foreground?.id;

  /**
   * What the results in hand answer. Retained results are reusable only while
   * this is unchanged; anything else and the question has moved on.
   */
  /** Nothing recedes without a set of yours to recede *from*. */
  const dims = !!foreground && !foregroundIsUniverse;

  /**
   * Whether the rows on screen carry meaningful counts.
   *
   * False for a binary foreground drawn alone. When the background is drawn the
   * rows come from All Magic, which has no counts either — but the destination's
   * quantities are still worth showing, so that case stays counted.
   */
  const counts = drawingBackground || foreground?.quantityKind !== "binary";

  const signature = JSON.stringify([
    localSourceId,
    drawingBackground,
    effectiveKey,
    sort,
    sortFlipped,
    // Must match the fetch effect's deps exactly, or the skip swallows changes
    // the effect would have caught: edit a collection while its panel is
    // unmounted, come back, and the stale rows would look current. Zero for the
    // remote branch — a local write cannot change what Scryfall returns.
    drawingBackground ? 0 : refreshKey,
  ]);

  /**
   * Which sorts are offerable, and the current one's remote spelling.
   *
   * Keyed on whether a Scryfall stream is involved, not on which source is
   * "selected": the constraint is that every stream in the answer must be able
   * to produce the ordering.
   */
  const sorts = useMemo(() => availableSorts(usesRemote), [usesRemote]);
  const scryfallSort = remoteSort(sort, sortFlipped);

  // Turning outside cards back on can strand a sort the universe cannot do.
  useEffect(() => {
    if (!sorts.some((s) => s.key === sort)) setSort(DEFAULT_SORT);
  }, [sorts, sort]);

  /**
   * Results restored from the slot are already the answer to this question, so
   * the first run after a remount is skipped. Consumed once: any later change
   * of signature is a real question and must fetch.
   */
  const restored = useRef(cached.current.signature);

  useEffect(() => {
    if (restored.current !== undefined) {
      const reusable = restored.current === signature;
      restored.current = undefined;
      if (reusable) return;
    }

    const id = ++requestId.current;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        // One source today — the background is always All Magic, which contains
        // every foreground, so their union collapses. Built as a list anyway so
        // that a selectable background is a second entry here rather than a
        // rewrite of everything downstream.
        const sources: SortedSource<Row>[] = [];
        let known: number | null = null;

        /** A collection, read whole and locally — printing grain. */
        const localSource = async (collectionId: string) => {
          const items = await collectionItems(
            collectionId,
            effective,
            sort,
            sortFlipped,
          );
          return {
            count: items.length,
            source: fromArray(
              items.map((item): Row => ({
                kind: "item",
                key: item.id,
                card: item.card,
                item,
              })),
            ),
          };
        };

        if (drawingBackground && !unionCollapses) {
          // Two sets, neither containing the other, so both are drawn and
          // merged. Foreground first, so it wins ties and its row — the one
          // carrying your quantity — is the one that survives dedupe.
          const fg = await localSource(localSourceId!);
          const bg = await localSource(background!.id);
          if (requestId.current !== id) return;
          sources.push(fg.source, bg.source);
          // Not the sum: the two may overlap, and dedupe happens downstream.
          known = null;
        } else if (drawingBackground) {
          const query = toScryfallQuery(effective) || EVERYTHING;
          sources.push(
            fromPages(async (page) => {
              const result = await scryfall.search(query, page, scryfallSort);
              // Scryfall knows its own total; a merged total would not be
              // knowable without draining every source.
              if (page === 1) known = result.totalCards;
              return {
                items: result.cards.map(
                  (card): Row => ({ kind: "card", key: card.oracleId, card }),
                ),
                next: result.nextPage,
              };
            }),
          );
        } else {
          const fg = await localSource(localSourceId!);
          if (requestId.current !== id) return;
          known = fg.count;
          sources.push(fg.source);
        }

        const stream = mergeSorted<Row>(
          sources,
          (a, b) => compare(a.card, b.card),
          // By printing id, which the sort key ends with — so duplicates are
          // adjacent and a single-element lookahead is enough to spot them.
          (row) => row.card.id,
        );
        pending.current = stream;

        const first = await take(stream, PAGE);
        if (requestId.current !== id) return;

        setRows(first);
        setExhausted(first.length < PAGE);
        setTotal(known ?? first.length);
      } catch (err) {
        if (requestId.current !== id) return;
        if (isSuperseded(err)) return;

        // A half-typed query is the normal case, not a failure, so keep the
        // previous results on screen rather than blanking the grid — which
        // would be indistinguishable from "nothing matched".
        if (!(err instanceof QueryError)) {
          setRows([]);
          setTotal(0);
          setExhausted(true);
        }
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    };

    const timer = setTimeout(run, 350);
    return () => clearTimeout(timer);
    // The mutation counter matters only while the list itself is local. Adding
    // it unconditionally would re-run a Scryfall search on every `+`, which is
    // exactly the traffic the scheduler exists to avoid.
  }, [
    localSourceId,
    drawingBackground,
    effectiveKey,
    sort,
    sortFlipped,
    drawingBackground ? 0 : refreshKey,
  ]);

  /**
   * One page of the merged stream at a time, so the rhythm is the same whether
   * the rows came from disk, the network, or both.
   *
   * The active printing is substituted here rather than when fetching, so
   * picking one in the card panel re-renders instead of re-querying. Oracle
   * grain only: a printing-grain row already *is* a specific printing, and
   * swapping it would misreport what is held.
   */
  const visible = useMemo(
    () =>
      rows.slice(0, shown).map((row) =>
        row.kind === "card" && activePrintings[row.card.oracleId]
          ? { ...row, card: activePrintings[row.card.oracleId] }
          : row,
      ),
    [rows, shown, activePrintings],
  );
  const hasMore = shown < rows.length || !exhausted;

  /**
   * Cards / unique / estimated value.
   *
   * `null` whenever a Scryfall stream is in the answer, and shown as `—` rather
   * than as a number. The universe has no quantities to sum, and its "unique"
   * is the total match count, not what happens to be loaded — printing a running
   * subtotal of the page in hand would look like a fact about the search.
   */
  const totals = useMemo(() => {
    if (drawingBackground) return null;
    // Membership has no copies to count and no value to sum — only how many
    // cards matched. Reporting "1,750 cards, $4,000" of a search would be an
    // ownership claim it never made.
    if (!counts) return { cards: null, unique: rows.length, value: null };
    let cards = 0;
    let value = 0;
    let unique = 0;
    for (const row of rows) {
      if (row.kind !== "item") continue;
      unique++;
      cards += row.item.quantity;
      const price = Number.parseFloat(
        (row.item.finish === "foil"
          ? row.card.prices.usd_foil
          : row.card.prices.usd) ?? "",
      );
      if (Number.isFinite(price)) value += price * row.item.quantity;
    }
    return { cards, unique, value };
  }, [drawingBackground, rows]);

  /**
   * What a row's `±` acts on, which depends on its grain.
   *
   * A printing-grain row addresses one *entry* — this printing, this finish —
   * so it edits that entry's quantity directly. Routing it through the
   * card-grained destination would let a `−` on your foil decrement the nonfoil
   * copy instead, since the two share a printing id.
   */
  function stepperFor(row: Row) {
    if (row.kind === "item" && manage && !counts) {
      // Binary: in or out. A `− n +` here would invite you to hold two of
      // something the set never claimed you held one of.
      const { item } = row;
      return {
        name: foreground?.name ?? "",
        dec: null,
        inc: null,
        drop: () => manage.onRemoveItem(item),
      };
    }
    if (row.kind === "item" && manage) {
      const { item } = row;
      return {
        name: foreground?.name ?? "",
        dec: () => manage.onSetItemQuantity(item, item.quantity - 1),
        inc: () => manage.onSetItemQuantity(item, item.quantity + 1),
        drop: () => manage.onRemoveItem(item),
      };
    }
    if (!destination) return null;
    return {
      name: destination.name,
      dec: () => destination.remove(row.card),
      inc: () => destination.add(row.card),
      drop: null,
    };
  }

  /**
   * Results are written as one object, never field by field: a page of cards
   * paired with another query's `nextPage` would fetch the wrong continuation.
   * Skipped while a request is in flight, so a half-updated view is never
   * mistaken for a finished one.
   */
  useEffect(() => {
    if (loading) return;
    retain(stateKey, {
      rows,
      shown,
      total,
      exhausted,
      signature,
    } satisfies PoolResults);
  }, [stateKey, loading, rows, shown, total, exhausted, signature]);

  async function loadMore() {
    const next = shown + PAGE;
    setShown(next);

    // Only reach for the stream once what is already loaded runs out.
    const stream = pending.current;
    if (next <= rows.length || !stream || exhausted) return;

    setLoading(true);
    try {
      const more = await take(stream, PAGE);
      setRows((prev) => [...prev, ...more]);
      if (more.length < PAGE) setExhausted(true);
    } catch (err) {
      if (isSuperseded(err)) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Contextual *constraints*, expressed as toggle groups for the filter bar.
   * They belong beside the facets because they narrow the same way: AND-ed onto
   * whatever has been searched for. Purely visual switches do not go here.
   */
  const groups = useMemo<FilterGroup[]>(() => {
    const out: FilterGroup[] = [];

    if (scopes.length) {
      out.push({
        label: "Deck",
        toggles: scopes.map((scope) => ({
          key: scope.key,
          label: scope.label,
          title: scope.title,
          on: !scopesOff.has(scope.key),
          onChange: (on) =>
            setScopesOff((prev) => {
              const next = new Set(prev);
              if (on) next.delete(scope.key);
              else next.add(scope.key);
              return next;
            }),
        })),
      });
    }

    return out;
  }, [scopes, scopesOff]);

  // Counts what is *narrowing* the list: active facets and enabled scopes. The
  // outside toggle is deliberately absent — it is a view control, not a filter.
  const activeFilters = countActiveFilters(filter) + activeScopes.length;

  /**
   * Whether anything has been narrowed away from the defaults.
   *
   * Includes the query text, which `countActiveFilters` does not count — and
   * which is precisely the state that survives navigation without leaving a
   * mark on the badge. Now that panels remember where you were, a filter set
   * ten minutes ago in another view needs a way back.
   */
  const narrowed =
    (filter.query ?? "").trim().length > 0 ||
    countActiveFilters(filter) > 0 ||
    scopesOff.size > 0;

  function clearFilters() {
    // Filters only. Sort and layout are view preferences, and resetting them
    // here would make one control quietly do two jobs.
    setFilter({});
    setScopesOff(new Set());
  }

  return (
    <div className="pool">
      {manage && foreground && (
        <div className="toolbar">
          {editingName ? (
            <input
              className="search-input"
              value={draftName}
              autoFocus
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") {
                  setDraftName(foreground.name);
                  setEditingName(false);
                }
              }}
            />
          ) : (
            <h1
              onDoubleClick={() => setEditingName(true)}
              title="Double-click to rename"
            >
              {foreground.name}
            </h1>
          )}
          <span className="spacer" />

          {poolToggle && (
            <button
              className={poolToggle.on ? "primary" : ""}
              onClick={poolToggle.onToggle}
              title={
                poolToggle.on
                  ? "Hide the candidate-card pool"
                  : `Open a pool of candidate cards above ${foreground.name}`
              }
            >
              {poolToggle.on ? "Hide pool" : "＋ Add cards"}
            </button>
          )}

          <button className="ghost" onClick={manage.onImport}>
            Import
          </button>
          <button className="ghost" onClick={manage.onExport}>
            Export
          </button>
          <button className="ghost" onClick={() => setEditingName(true)}>
            Rename
          </button>
          <button className="ghost" onClick={manage.onDelete}>
            Delete
          </button>
        </div>
      )}

      <div className="toolbar">
        <input
          className="search-input"
          // The same syntax either way now: passed to Scryfall for the
          // universe, compiled to SQL for a collection.
          placeholder={"Search — t:creature c:r mv<=3"}
          value={filter.query ?? ""}
          onChange={(e) => setFilter({ ...filter, query: e.target.value })}
        />

        <button
          className={showFilters || activeFilters ? "primary" : ""}
          onClick={() => setShowFilters((v) => !v)}
          title="Extra constraints, combined with whatever you have searched for"
        >
          More filters{activeFilters ? ` (${activeFilters})` : ""}
        </button>

        {/* Shadowed or absent — the same axis as the dimming, so it lives in
            the open rather than behind "More filters" with the constraints
            that join with the search query. */}
        {/* Present and greyed rather than absent: the reason a save is not on
            offer is worth reading, and the count that decides it is already in
            hand from the first page — so refusing here costs nothing, where
            refusing after the name dialog wastes the typing. */}
        {onSaveSearch && (
          // Title on the wrapper, not the button: a disabled control dispatches
          // no mouse events, so its own tooltip never appears — which is
          // exactly when the explanation is worth reading.
          <span
            className="hint-wrap"
            title={
              rows.length === 0
                ? "Nothing to save"
                : total > MAX_CARDS
                  ? `${total.toLocaleString()} cards is more than one save should fetch (limit ${MAX_CARDS.toLocaleString()}) — narrow the search first`
                  : "Keep these results as a static collection"
            }
          >
            <button
              className="ghost"
              onClick={() => onSaveSearch(effective, sort, sortFlipped)}
              disabled={rows.length === 0 || total > MAX_CARDS}
            >
              Save search…
            </button>
          </span>
        )}

        {/* Always present, disabled when there is nothing to clear: a control
            that appears and disappears shifts the toolbar under the pointer,
            and its absence is a worse signal than its greyed presence. */}
        <span
          className="hint-wrap"
          title={narrowed ? "Clear the search and all filters" : "Nothing to clear"}
        >
          <button className="ghost" onClick={clearFilters} disabled={!narrowed}>
            Clear
          </button>
        </span>

        {!compact && (
          <div className="segmented">
            <button
              className={layout === "wall" ? "on" : ""}
              onClick={() => setLayout("wall")}
              title="Card wall"
            >
              Wall
            </button>
            <button
              className={layout === "list" ? "on" : ""}
              onClick={() => setLayout("list")}
              title="List"
            >
              List
            </button>
          </div>
        )}

        {/* Wherever there is a foreground to hold something against. This was
            once hidden in a collection view on the grounds that "also show All
            Magic" duplicated the All Magic view — but it does not: there
            everything is lit, here your collection is lit and the rest recedes.
            Different question, different answer. */}
        {foreground && !foregroundIsUniverse && (
          <label
            className="toggle"
            title={`Also draw ${background?.name ?? UNIVERSE_NAME} behind ${foreground.name}, shadowed`}
          >
            <input
              type="checkbox"
              checked={showBackground}
              onChange={(e) => setShowBackground(e.target.checked)}
            />
            Show {background?.name ?? "not in " + foreground.name}
          </label>
        )}

        <label className="toggle" title="Order the pool">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {sorts.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          {/* Arrow shows the direction it is *in*, not the one clicking gives —
              a control that displays its own outcome reads as a prediction. */}
          <button
            className="ghost"
            onClick={() => setSortFlipped((f) => !f)}
            title={`${direction(sort, sortFlipped) === "asc" ? "Ascending" : "Descending"} — click to reverse`}
          >
            {direction(sort, sortFlipped) === "asc" ? "↑" : "↓"}
          </button>
        </label>

        <span className="hint">
          {loading
            ? "Searching…"
            : rows.length
              ? `${visible.length} of ${total || rows.length}`
              : ""}
        </span>
      </div>

      {/* Only when the numbers are true. Against the universe they are not:
          there are no quantities to sum, and the match count is already in the
          toolbar hint — a row of dashes would be chrome pretending to be data. */}
      {totals && !compact && (
        <div className="stats">
          {/* Omitted rather than zeroed for a binary set: a blank says "this
              set does not answer that", where 0 would answer it wrongly. */}
          {totals.cards !== null && (
            <div className="stat">
              <span className="label">Cards</span>
              <span className="value">{totals.cards}</span>
            </div>
          )}
          <div className="stat">
            <span className="label">Unique</span>
            <span className="value">{totals.unique}</span>
          </div>
          {totals.value !== null && (
            <div className="stat">
              <span className="label">Est. value</span>
              <span className="value">${totals.value.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {showFilters && (
        <CardFilters filter={filter} onChange={setFilter} groups={groups} />
      )}

      {error && <div className="status error">{error}</div>}

      <div className="scroll">
        {visible.length === 0 && !loading && (
          <div className="empty">Nothing matches.</div>
        )}

        {layout === "wall" ? (
        <div className="card-grid">
          {visible.map((row) => {
            const card = row.card;
            const isIn = inCollection.has(card.oracleId);
            // At printing grain the count is what you hold in *this* row; at
            // oracle grain it is what the destination holds of that card.
            const count =
              row.kind === "item"
                ? row.item.quantity
                : (destination?.quantities[card.id] ?? 0);
            const step = stepperFor(row);
            return (
              <div
                key={row.key}
                className={[
                  "card-tile",
                  selectedId === card.id ? "selected" : "",
                  // Arena's convention: cards outside the active collection
                  // stay visible but recede.
                  dims && !isIn ? "dim" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onSelect(card)}
                onMouseEnter={() => onHoverCard?.(card)}
                onMouseLeave={() => onHoverCard?.(null)}
                onDoubleClick={() => step?.inc?.()}
                title={[
                  card.name,
                  dims && !isIn && `not in ${foreground.name}`,
                  // Double-click adds, which is otherwise undiscoverable — and
                  // where it lands is exactly the thing that differs between
                  // this grid and the card panel.
                  step?.inc && `double-click to add to ${step.name}`,
                ]
                  .filter(Boolean)
                  .join(" — ")}
              >
                <CardImage card={card} size="small" />
                {step?.dec && step.inc && (
                  <span
                    className="tile-controls"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      title={`Remove one from ${step.name}`}
                      onClick={step.dec}
                      disabled={!count}
                    >
                      −
                    </button>
                    <button title={`Add one to ${step.name}`} onClick={step.inc}>
                      +
                    </button>
                  </span>
                )}
                {/* How many are already in the destination — distinct from the
                    dimming, which is about the active collection. */}
                {counts && count > 0 && <span className="qty-badge">{count}×</span>}
                {row.kind === "item" && row.item.finish !== "nonfoil" && (
                  <span className="finish-badge">{row.item.finish}</span>
                )}
              </div>
            );
          })}
        </div>
        ) : (
          visible.map((row) => {
            const card = row.card;
            const isIn = inCollection.has(card.oracleId);
            const count =
              row.kind === "item"
                ? row.item.quantity
                : (destination?.quantities[card.id] ?? 0);
            const step = stepperFor(row);
            return (
              <div
                key={row.key}
                className={[
                  "row",
                  selectedId === card.id ? "selected" : "",
                  dims && !isIn ? "dim" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onSelect(card)}
                onMouseEnter={() => onHoverCard?.(card)}
                onMouseLeave={() => onHoverCard?.(null)}
                onDoubleClick={() => step?.inc?.()}
              >
                {/* Blank rather than 0× when the destination holds none: a
                    zero would read as a quantity you own. */}
                <span className="qty">
                  {counts && count > 0 ? `${count}×` : ""}
                </span>
                <span className="name">{card.name}</span>
                <span className="meta">
                  {card.setCode.toUpperCase()}
                  {row.kind === "item" && row.item.finish !== "nonfoil"
                    ? ` · ${row.item.finish}`
                    : ""}
                </span>
                <ManaCost cost={card.manaCost} />
                {step && (
                  <span className="controls" onClick={(e) => e.stopPropagation()}>
                    {step.dec && step.inc && (
                      <>
                        <button
                          title={`Remove one from ${step.name}`}
                          onClick={step.dec}
                          disabled={!count}
                        >
                          −
                        </button>
                        <button title={`Add one to ${step.name}`} onClick={step.inc}>
                          +
                        </button>
                      </>
                    )}
                    {/* Drop the entry outright, rather than stepping to zero —
                        only meaningful for a row that *is* an entry. */}
                    {step.drop && (
                      <button
                        title={`Remove this printing from ${step.name} entirely`}
                        onClick={step.drop}
                      >
                        ×
                      </button>
                    )}
                  </span>
                )}
              </div>
            );
          })
        )}

        {hasMore && (
          <div style={{ padding: "12px 0", textAlign: "center" }}>
            <button onClick={loadMore} disabled={loading}>
              {loading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
