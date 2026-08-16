import { useEffect, useMemo, useRef, useState } from "react";
import { collectionItems, ownedOracleIds, QueryError } from "../lib/collections";
import {
  countActiveFilters,
  toScryfallQuery,
  type CardFilter,
} from "../lib/filters";
import { isSuperseded } from "../lib/scheduler";
import {
  availableSorts,
  DEFAULT_SORT,
  sortOption,
  type SortKey,
} from "../lib/sort";
import * as scryfall from "../lib/scryfall";
import type { Card, CollectionItem } from "../lib/types";

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
  destination,
  activeCollection,
  scopes = [],
  refreshKey = 0,
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
   * The "my cards" source. Follows the selection rather than being chosen from
   * a list, so there is one notion of which collection is current.
   */
  activeCollection: { id: string; name: string } | null;
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
  const [filter, setFilter] = useState<CardFilter>({});
  const [showFilters, setShowFilters] = useState(false);
  const [scopesOff, setScopesOff] = useState<Set<string>>(new Set());
  /**
   * Whether cards outside the active collection appear, shadowed.
   *
   * Not "unowned": a card sitting in your Cube while Paper is active is owned,
   * just not *here*. The distinction matters now that scope is one named
   * collection rather than a vague aggregate.
   */
  const [showOutside, setShowOutside] = useState(true);
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);
  const [layout, setLayout] = useState<"wall" | "list">("wall");

  /**
   * The local branch's rows *as items*, not as cards.
   *
   * Quantity and finish are dropped when mapping to `Card`, and totals need
   * both — est. value has to pick `usd_foil` over `usd` for a foil copy. Only
   * ever populated in collection-only mode; the universe has no such thing.
   */
  const [ownedItems, setOwnedItems] = useState<CollectionItem[]>([]);
  const ownedCards = useMemo(() => ownedItems.map((i) => i.card), [ownedItems]);
  const [universeCards, setUniverseCards] = useState<Card[]>([]);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [total, setTotal] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
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
   * Oracle ids held by the collection this pool is scoped to — the un-dimming
   * set. Keyed on `refreshKey` as well as the collection, so adding a card to
   * the collection lights its tile up immediately.
   */
  useEffect(() => {
    ownedOracleIds(activeCollection ? [activeCollection.id] : undefined).then(
      setOwned,
    );
  }, [activeCollection?.id, refreshKey]);

  // With no collection selected there is no "mine" to narrow to, so the wider
  // pool is the only meaningful view.
  const includeOutside = !activeCollection || showOutside;

  /**
   * Which sorts are offerable, and the current one's remote spelling.
   *
   * Keyed on whether a Scryfall stream is involved, not on which source is
   * "selected": the constraint is that every stream in the answer must be able
   * to produce the ordering.
   */
  const sorts = useMemo(() => availableSorts(includeOutside), [includeOutside]);
  const remoteSort = sortOption(sort).remote ?? { order: "name", dir: "asc" as const };

  // Turning outside cards back on can strand a sort the universe cannot do.
  useEffect(() => {
    if (!sorts.some((s) => s.key === sort)) setSort(DEFAULT_SORT);
  }, [sorts, sort]);

  useEffect(() => {
    const id = ++requestId.current;

    const run = async () => {
      setLoading(true);
      setError(null);
      setShown(PAGE);
      try {
        if (includeOutside) {
          // All of Magic is the base set, a page at a time. What you own does
          // not decide what appears here — it only decides what is un-dimmed,
          // which comes from the oracle-id set loaded separately. Querying the
          // collection as well and merging would truncate the universe behind
          // however many of your own cards happened to match.
          setOwnedItems([]);
          const page = await scryfall.search(
            toScryfallQuery(effective) || EVERYTHING,
            1,
            remoteSort,
          );
          if (requestId.current !== id) return;
          setUniverseCards(page.cards);
          setNextPage(page.nextPage);
          setTotal(page.totalCards);
        } else {
          // Cards outside the collection are unwanted, so the whole answer is
          // local — and complete, since nothing here is paged by Scryfall.
          const items = await collectionItems(activeCollection!.id, effective, sort);
          if (requestId.current !== id) return;
          setOwnedItems(items);
          setUniverseCards([]);
          setNextPage(null);
          setTotal(items.length);
        }
      } catch (err) {
        if (requestId.current !== id) return;
        if (isSuperseded(err)) return;

        // A half-typed query is the normal case, not a failure, so keep the
        // previous results on screen rather than blanking the grid — which
        // would be indistinguishable from "nothing matched".
        if (!(err instanceof QueryError)) {
          setOwnedItems([]);
          setUniverseCards([]);
          setTotal(0);
          setNextPage(null);
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
  }, [activeCollection?.id, includeOutside, effectiveKey, sort, includeOutside ? 0 : refreshKey]);

  /**
   * Exactly one of the two lanes is populated — All Magic when outside cards
   * are shown, the collection when they are not — so this is a concatenation in
   * practice. The dedupe by *oracle* id is kept because a collection holds
   * printings while a search returns one printing per card, and the two lanes
   * may yet be mixed.
   */
  const merged = useMemo(() => {
    const seen = new Set(ownedCards.map((c) => c.oracleId));
    return [
      ...ownedCards,
      ...universeCards.filter((c) => !seen.has(c.oracleId)),
    ];
  }, [ownedCards, universeCards]);

  /**
   * Cards / unique / estimated value.
   *
   * `null` whenever a Scryfall stream is in the answer, and shown as `—` rather
   * than as a number. The universe has no quantities to sum, and its "unique"
   * is the total match count, not what happens to be loaded — printing a running
   * subtotal of the page in hand would look like a fact about the search.
   */
  const totals = useMemo(() => {
    if (includeOutside) return null;
    let cards = 0;
    let value = 0;
    for (const item of ownedItems) {
      cards += item.quantity;
      const price = Number.parseFloat(
        (item.finish === "foil" ? item.card.prices.usd_foil : item.card.prices.usd) ??
          "",
      );
      if (Number.isFinite(price)) value += price * item.quantity;
    }
    return { cards, unique: ownedItems.length, value };
  }, [includeOutside, ownedItems]);

  async function loadMore() {
    const next = shown + PAGE;
    setShown(next);

    // Pull another page only once the merged list runs dry.
    if (next <= merged.length || nextPage === null) return;
    setLoading(true);
    try {
      const page = await scryfall.search(
        toScryfallQuery(effective) || EVERYTHING,
        nextPage,
        remoteSort,
      );
      setUniverseCards((prev) => [...prev, ...page.cards]);
      setNextPage(page.nextPage);
    } catch (err) {
      if (isSuperseded(err)) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // The union is chopped to a page so the rhythm stays the same whether the
  // cards came from disk, the network, or both.
  const visible = useMemo(() => merged.slice(0, shown), [merged, shown]);
  const hasMore = shown < merged.length || nextPage !== null;

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

  return (
    <div className="pool">
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
        {activeCollection && (
          <label
            className="toggle"
            title={`Show cards not in ${activeCollection.name}, shadowed`}
          >
            <input
              type="checkbox"
              checked={showOutside}
              onChange={(e) => setShowOutside(e.target.checked)}
            />
            Show not in {activeCollection.name}
          </label>
        )}

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

        <label className="toggle" title="Order the pool">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {sorts.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <span className="hint">
          {loading
            ? "Searching…"
            : merged.length
              ? `${visible.length} of ${total || merged.length}`
              : ""}
        </span>
      </div>

      {/* Only when the numbers are true. Against the universe they are not:
          there are no quantities to sum, and the match count is already in the
          toolbar hint — a row of dashes would be chrome pretending to be data. */}
      {totals && !compact && (
        <div className="stats">
          <div className="stat">
            <span className="label">Cards</span>
            <span className="value">{totals.cards}</span>
          </div>
          <div className="stat">
            <span className="label">Unique</span>
            <span className="value">{totals.unique}</span>
          </div>
          <div className="stat">
            <span className="label">Est. value</span>
            <span className="value">${totals.value.toFixed(2)}</span>
          </div>
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
          {visible.map((card) => {
            const isOwned = owned.has(card.oracleId);
            const inDestination = destination?.quantities[card.id] ?? 0;
            return (
              <div
                key={card.id}
                className={[
                  "card-tile",
                  selectedId === card.id ? "selected" : "",
                  // Arena's convention: cards outside the active collection
                  // stay visible but recede.
                  activeCollection && !isOwned ? "dim" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onSelect(card)}
                onMouseEnter={() => onHoverCard?.(card)}
                onMouseLeave={() => onHoverCard?.(null)}
                onDoubleClick={() => destination?.add(card)}
                title={`${card.name}${
                  activeCollection && !isOwned
                    ? ` — not in ${activeCollection.name}`
                    : ""
                }`}
              >
                <CardImage card={card} size="small" />
                {destination && (
                  <span
                    className="tile-controls"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      title={`Remove one from ${destination.name}`}
                      onClick={() => destination.remove(card)}
                      disabled={!inDestination}
                    >
                      −
                    </button>
                    <button
                      title={`Add one to ${destination.name}`}
                      onClick={() => destination.add(card)}
                    >
                      +
                    </button>
                  </span>
                )}
                {/* How many are already in the destination — distinct from the
                    dimming, which is about the active collection. */}
                {inDestination > 0 && (
                  <span className="qty-badge">{inDestination}×</span>
                )}
              </div>
            );
          })}
        </div>
        ) : (
          visible.map((card) => {
            const isOwned = owned.has(card.oracleId);
            const inDestination = destination?.quantities[card.id] ?? 0;
            return (
              <div
                key={card.id}
                className={[
                  "row",
                  selectedId === card.id ? "selected" : "",
                  activeCollection && !isOwned ? "dim" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onSelect(card)}
                onMouseEnter={() => onHoverCard?.(card)}
                onMouseLeave={() => onHoverCard?.(null)}
                onDoubleClick={() => destination?.add(card)}
              >
                {/* Blank rather than 0× when the destination holds none: a
                    zero would read as a quantity you own. */}
                <span className="qty">
                  {inDestination > 0 ? `${inDestination}×` : ""}
                </span>
                <span className="name">{card.name}</span>
                <span className="meta">{card.setCode.toUpperCase()}</span>
                <ManaCost cost={card.manaCost} />
                {destination && (
                  <span className="controls" onClick={(e) => e.stopPropagation()}>
                    <button
                      title={`Remove one from ${destination.name}`}
                      onClick={() => destination.remove(card)}
                      disabled={!inDestination}
                    >
                      −
                    </button>
                    <button
                      title={`Add one to ${destination.name}`}
                      onClick={() => destination.add(card)}
                    >
                      +
                    </button>
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
