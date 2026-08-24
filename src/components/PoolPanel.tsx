import { useEffect, useMemo, useRef, useState } from "react";
import {
  collectionItems,
  collectionOracleIds,
  QueryError,
  UNIVERSE_NAME,
} from "../lib/collections";
import {
  countActiveFilters,
  toScryfallQuery,
  type CardFilter,
} from "../lib/filters";
import { fromArray, fromPages, take } from "../lib/merge";
import { retained, useRetained } from "../lib/panelState";
import { MAX_CARDS } from "../lib/saveSearch";
import { stepperCase, STEPPER_CONTROLS } from "../lib/stepper";
import { isSuperseded } from "../lib/scheduler";
import {
  availableSorts,
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

/**
 * What a row's `±` acts on. One shape across all cases so a caller can ask
 * `step.inc` without the branch it came from changing the answer's type —
 * binary rows have no stepper, only removal.
 */
interface Stepper {
  name: string;
  dec: (() => void) | null;
  inc: (() => void) | null;
  drop: (() => void) | null;
  /** Whether the wall shows the drop, or leaves it to the list. */
  dropOnWall: boolean;
}

/**
 * A drawn card. `item` rows come from a collection and carry its entry — the
 * quantity and finish; `card` rows come from Scryfall and carry neither.
 *
 * No provenance field: only one set is ever drawn, so every entry row belongs
 * to it.
 */
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
  source,
  lit = null,
  narrowable = false,
  scopes = [],
  refreshKey = 0,
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
    /** Binary destinations take members, not copies — see `docs/card-set-types.md`. */
    quantityKind?: QuantityKind;
    add: (card: Card) => void;
    remove: (card: Card) => void;
  } | null;
  /**
   * What this pane draws. Exactly one set — never a union.
   *
   * All Magic contains every collection, so "All Magic with the rest dimmed" is
   * still a single source. That is what keeps this panel free of merging, row
   * provenance and membership spread across sources; see
   * `docs/two-designs.md`.
   *
   * `quantityKind` decides whether a collection's rows carry counts at all. A
   * binary set — a saved search — answers membership, so quantities, totals and
   * the stepper would each be an ownership claim it never made.
   */
  source:
    | { kind: "universe" }
    | { kind: "collection"; id: string; name: string; quantityKind?: QuantityKind };
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
   * Which cards stay lit. Everything else recedes.
   *
   * `null` means light everything — a collection viewed on its own has nothing
   * to contrast against, and All Magic held against your collection is a
   * browsing view, not a judgement about the universe.
   */
  lit?: { id: string; name: string } | null;
  /**
   * Offer a toggle narrowing the drawn set to `lit`.
   *
   * The deck-building pool has it — you build decks from cards you own. The
   * collection-building pool does not: you are *recording* what you own, so All
   * Magic is the only sensible source.
   */
  narrowable?: boolean;
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
  const [narrowToLit, setNarrowToLit] = useRetained(
    stateKey,
    "narrowToLit",
    !manage,
  );
  const [sort, setSort] = useRetained<SortKey>(stateKey, "sort", DEFAULT_SORT);
  /** Inverts the sort's useful default rather than forcing ascending. */
  const [sortFlipped, setSortFlipped] = useRetained(stateKey, "sortFlipped", false);
  const [layout, setLayout] = useRetained<"wall" | "list">(stateKey, "layout", "wall");
  /** What this pane is showing, by name. */
  const sourceName = source.kind === "collection" ? source.name : UNIVERSE_NAME;

  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(sourceName);

  // Follow a rename made elsewhere, and reset a half-typed draft on navigation.
  useEffect(() => {
    setDraftName(sourceName);
    setEditingName(false);
  }, [sourceName]);

  function commitName() {
    setEditingName(false);
    const next = draftName.trim();
    if (next && next !== sourceName) manage?.onRename(next);
    else setDraftName(sourceName);
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
  const [shown, setShown] = useState(() => cached.current.shown ?? PAGE);
  const [total, setTotal] = useState(() => cached.current.total ?? 0);
  const [exhausted, setExhausted] = useState(() => cached.current.exhausted ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Guards against a slow early request landing after a later one. */
  const requestId = useRef(0);

  /**
   * The stream still being drawn from, for `loadMore`.
   *
   * A ref because it is not renderable state, and because a generator cannot be
   * retained — restoring a panel gives back rows but no stream.
   */
  const pending = useRef<AsyncGenerator<Row> | null>(null);

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
   * Oracle ids in the lit set — everything else recedes.
   *
   * One source of truth for "do I have this", and reloaded on every mutation.
   * These are two cheap local queries against a set that is never the drawn
   * one, so nothing re-pages.
   */
  const [inCollection, setInCollection] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!lit) {
      setInCollection(new Set());
      return;
    }
    collectionOracleIds([lit.id]).then(setInCollection);
  }, [lit?.id, refreshKey]);

  /**
   * Narrow the drawn set to the lit collection.
   *
   * Only offered where it makes sense — a deck pool builds from what you own, a
   * collection pool records what you own — and only possible when there is a
   * lit set to narrow to.
   */
  const canNarrow = narrowable && !!lit;
  const drawn: "universe" | "collection" =
    canNarrow && narrowToLit ? "collection" : source.kind;

  /** The collection to read locally, when that is what is drawn. */
  const localSourceId =
    drawn === "collection"
      ? source.kind === "collection"
        ? source.id
        : lit?.id
      : undefined;

  /** A card lights if it is in the lit set. With no lit set, everything does. */
  const dims = !!lit;

  /** Whose counts the rows carry, and whether they mean anything. */
  const drawnKind: QuantityKind =
    drawn === "collection" && source.kind === "collection"
      ? (source.quantityKind ?? "natural")
      : "natural";
  const counts =
    drawn === "universe"
      ? destination?.quantityKind !== "binary"
      : drawnKind !== "binary";

  const signature = JSON.stringify([
    localSourceId,
    drawn,
    effectiveKey,
    sort,
    sortFlipped,
    // Must match the fetch effect's deps exactly, or the retention skip
    // swallows a change the effect would have caught. `refreshKey` is in
    // neither: adding a card moves it between foreground and background, so
    // the union — and therefore the wall — is unchanged. Membership lives in
    // the cache above instead.
  ]);

  /**
   * Which sorts are offerable, and the current one's remote spelling.
   *
   * Keyed on whether a Scryfall stream is involved, not on which source is
   * "selected": the constraint is that every stream in the answer must be able
   * to produce the ordering.
   */
  const sorts = useMemo(() => availableSorts(drawn === "universe"), [drawn]);
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
        // Exactly one set is drawn, so there is nothing to merge. All Magic
        // contains every collection, which is why "All Magic with the rest
        // dimmed" is still a single source — see `docs/two-designs.md`.
        let stream: AsyncGenerator<Row>;
        let known: number | null = null;

        if (drawn === "collection") {
          const items = await collectionItems(
            localSourceId!,
            effective,
            sort,
            sortFlipped,
          );
          if (requestId.current !== id) return;
          known = items.length;
          stream = fromArray(
            items.map((item): Row => ({
              kind: "item",
              key: item.id,
              card: item.card,
              item,
            })),
          );
        } else {
          const query = toScryfallQuery(effective) || EVERYTHING;
          stream = fromPages(async (page) => {
            const result = await scryfall.search(query, page, scryfallSort);
            // Scryfall knows its own total; a local list knows its length.
            if (page === 1) known = result.totalCards;
            return {
              items: result.cards.map(
                (card): Row => ({ kind: "card", key: card.oracleId, card }),
              ),
              next: result.nextPage,
            };
          });
        }

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
    drawn,
    effectiveKey,
    sort,
    sortFlipped,
    // `refreshKey` is deliberately absent: a write changes what you *hold*, not
    // which cards match, and the lit set is reloaded separately. Re-paging to
    // learn nothing would rebuild the grid and lose your place.
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
    if (drawn === "universe") return null;
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
  }, [drawn, counts, rows]);

  /**
   * What a row's `±` acts on, which depends on its grain.
   *
   * A printing-grain row addresses one *entry* — this printing, this finish —
   * so it edits that entry's quantity directly. Routing it through the
   * card-grained destination would let a `−` on your foil decrement the nonfoil
   * copy instead, since the two share a printing id.
   */
  /**
   * The edits a row offers, and the handlers behind them.
   *
   * The *decision* lives in `stepper.ts` where it can be tabulated and tested —
   * three inputs interact and I got it wrong repeatedly by inspection. This
   * only binds handlers to the case it returns.
   */
  /**
   * The edits a card offers, and the handlers behind them.
   *
   * The decision lives in `stepper.ts`, on two inputs: the destination's kind
   * and whether the card is already in it. Everything here is binding handlers
   * — which differ by row, since an entry can be adjusted by its own id where a
   * card has to go through the destination.
   */
  /**
   * The edits a card offers, and the handlers behind them.
   *
   * The decision lives in `stepper.ts`, on two inputs: the destination's kind
   * and whether the card is already in it. Everything here is binding handlers.
   */
  function stepperFor(row: Row): Stepper | null {
    // From the destination, which App refreshes on every write — never from the
    // row, whose entry is frozen at fetch time and would keep claiming to be
    // held after a removal.
    const held = destination?.quantities[row.card.id] ?? 0;
    const kind = destination ? (destination.quantityKind ?? "natural") : null;

    const which = stepperCase({ destinationKind: kind, inDestination: held });
    if (which === "none") return null;

    const controls = STEPPER_CONTROLS[which];
    // Editable as an entry only when this pane presents the collection it
    // belongs to; otherwise the card goes through the destination.
    const entry = row.kind === "item" && manage && held > 0 ? row.item : null;

    return {
      name: destination?.name ?? "",
      dropOnWall: controls.dropOnWall,
      dec: !controls.dec
        ? null
        : entry
          ? () => manage!.onSetItemQuantity(entry, entry.quantity - 1)
          : () => destination?.remove(row.card),
      inc: !controls.inc ? null : () => destination?.add(row.card),
      drop: !controls.drop
        ? null
        : entry
          ? () => manage!.onRemoveItem(entry)
          : () => destination?.remove(row.card),
    };
  }

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
      {manage && (
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
                  setDraftName(sourceName);
                  setEditingName(false);
                }
              }}
            />
          ) : (
            <h1
              onDoubleClick={() => setEditingName(true)}
              title="Double-click to rename"
            >
              {sourceName}
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
                  : `Open a pool of candidate cards above ${sourceName}`
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

        {/* Narrows the drawn set to what you own. Offered by the deck pool,
            where you build from your cards; not by the collection pool, where
            you are recording them and All Magic is the only source. */}
        {canNarrow && (
          <label
            className="toggle"
            title={`Also draw cards not in ${lit!.name}, dimmed`}
          >
            <input
              type="checkbox"
              checked={!narrowToLit}
              onChange={(e) => setNarrowToLit(!e.target.checked)}
            />
            Show not in {lit!.name}
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
            // The entry's own count, since `quantities` sums a printing's
            // finishes and would show a foil and a nonfoil the same total. But
            // suppressed once the destination no longer holds it, so a removed
            // card drops its badge without the list being refetched.
            const count = destination?.quantities[card.id] ?? 0;
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
                  dims && !isIn && `not in ${lit!.name}`,
                  // Double-click adds, which is otherwise undiscoverable — and
                  // where it lands is exactly the thing that differs between
                  // this grid and the card panel.
                  step?.inc && `double-click to add to ${step.name}`,
                ]
                  .filter(Boolean)
                  .join(" — ")}
              >
                <CardImage card={card} size="small" />
                {/* Whichever of the three exist. A counted destination offers
                    `− +`; a binary one offers `×` on a member and `+` on a
                    non-member, since membership has no states between. */}
                {step && (step.dec || step.inc || step.drop) && (
                  <span
                    className="tile-controls"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {step.dec && (
                      <button
                        title={`Remove one from ${step.name}`}
                        onClick={step.dec}
                        disabled={!count}
                      >
                        −
                      </button>
                    )}
                    {step.inc && (
                      <button title={`Add to ${step.name}`} onClick={step.inc}>
                        +
                      </button>
                    )}
                    {/* Only where it is the *only* edit. Alongside a stepper
                        this is a shortcut for stepping to zero, and the wall is
                        too dense to carry a third button for that — the list
                        offers it there instead. */}
                    {step.drop && step.dropOnWall && (
                      <button
                        title={`Remove from ${step.name}`}
                        onClick={step.drop}
                      >
                        ×
                      </button>
                    )}
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
            // The entry's own count, since `quantities` sums a printing's
            // finishes and would show a foil and a nonfoil the same total. But
            // suppressed once the destination no longer holds it, so a removed
            // card drops its badge without the list being refetched.
            const count = destination?.quantities[card.id] ?? 0;
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
                    {step.dec && (
                      <button
                        title={`Remove one from ${step.name}`}
                        onClick={step.dec}
                        disabled={!count}
                      >
                        −
                      </button>
                    )}
                    {step.inc && (
                      <button title={`Add to ${step.name}`} onClick={step.inc}>
                        +
                      </button>
                    )}
                    {/* Removes the row outright rather than stepping to zero:
                        for a counted entry that is "drop this printing", and
                        for a member of a binary set it is the only edit. */}
                    {step.drop && (
                      <button
                        title={`Remove from ${step.name}`}
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
