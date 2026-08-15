import { useEffect, useMemo, useRef, useState } from "react";
import { collectionItems, ownedOracleIds, QueryError } from "../lib/collections";
import {
  countActiveFilters,
  hasSearchableTerms,
  toScryfallQuery,
  type CardFilter,
} from "../lib/filters";
import { isSuperseded } from "../lib/scheduler";
import * as scryfall from "../lib/scryfall";
import type { Card } from "../lib/types";
import { CardFilters } from "./CardFilters";
import { CardImage } from "./CardImage";

/** How many cards a page shows, so the union pages at a steady rhythm. */
const PAGE = 175;

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
  onAdd,
  target,
  activeCollection,
  scope,
}: {
  selectedId: string | null;
  onSelect: (card: Card) => void;
  /** Previews a card in the detail panel without changing the selection. */
  onHoverCard?: (card: Card | null) => void;
  /** Omitted when there is nowhere to add to, which hides the + button. */
  onAdd?: (card: Card) => void;
  /**
   * Where a bare `+` lands. Used only to label the button — the destination
   * itself comes from `onAdd`, since it differs by context (the deck under the
   * pool, versus the most recently touched thing in the search view).
   */
  target: { name: string } | null;
  /**
   * The "my cards" source. Follows the selection rather than being chosen from
   * a list, so there is one notion of which collection is current.
   */
  activeCollection: { id: string; name: string } | null;
  /** Extra constraints from the deck, e.g. commander identity + format. */
  scope?: { label: string; filter: CardFilter };
}) {
  const [filter, setFilter] = useState<CardFilter>({});
  const [showFilters, setShowFilters] = useState(false);
  const [scopeOn, setScopeOn] = useState(true);
  /** Whether cards outside the active collection appear, shadowed. */
  const [showUnowned, setShowUnowned] = useState(true);

  const [ownedCards, setOwnedCards] = useState<Card[]>([]);
  const [universeCards, setUniverseCards] = useState<Card[]>([]);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [total, setTotal] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a slow early request landing after a later one.
  const requestId = useRef(0);

  const effective = useMemo<CardFilter>(
    () => (scopeOn && scope ? { ...filter, ...scope.filter } : filter),
    [filter, scopeOn, scope],
  );
  const effectiveKey = JSON.stringify(effective);

  /** Oracle ids held by the collection this pool is scoped to. */
  useEffect(() => {
    ownedOracleIds(activeCollection ? [activeCollection.id] : undefined).then(
      setOwned,
    );
  }, [activeCollection?.id]);

  // With no collection selected there is no "mine" to narrow to, so the wider
  // pool is the only meaningful view.
  const includeUnowned = !activeCollection || showUnowned;

  useEffect(() => {
    const id = ++requestId.current;

    const run = async () => {
      setLoading(true);
      setError(null);
      setShown(PAGE);
      try {
        // The collection side is queried in full and locally: your own cards
        // must never be truncated by Scryfall's pagination.
        let mine: Card[] = [];
        if (activeCollection) {
          try {
            const items = await collectionItems(activeCollection.id, effective);
            mine = items.map((item) => item.card);
          } catch (err) {
            // `is:` and friends compile remotely but not locally. Losing the
            // collection half is better than failing a query that All Magic
            // could have answered.
            if (!(err instanceof QueryError)) throw err;
            if (includeUnowned) setError(`${err.message} — showing all of Magic only`);
            else throw err;
          }
        }
        if (requestId.current !== id) return;
        setOwnedCards(mine);

        // Only reach for the network when the local side cannot fill a page.
        if (includeUnowned && hasSearchableTerms(effective) && mine.length < PAGE) {
          const page = await scryfall.search(toScryfallQuery(effective));
          if (requestId.current !== id) return;
          setUniverseCards(page.cards);
          setNextPage(page.nextPage);
          setTotal(page.totalCards);
        } else {
          setUniverseCards([]);
          setNextPage(null);
          setTotal(mine.length);
        }
      } catch (err) {
        if (requestId.current !== id) return;
        if (isSuperseded(err)) return;

        // A half-typed query is the normal case, not a failure, so keep the
        // previous results on screen rather than blanking the grid — which
        // would be indistinguishable from "nothing matched".
        if (!(err instanceof QueryError)) {
          setOwnedCards([]);
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
  }, [activeCollection?.id, includeUnowned, effectiveKey]);

  /**
   * The union, deduped by *oracle* id — a collection holds printings while a
   * search returns one printing per card, so keying on printing would show the
   * same card twice. Owned first: those are the ones you can actually play.
   */
  const merged = useMemo(() => {
    const seen = new Set(ownedCards.map((c) => c.oracleId));
    return [
      ...ownedCards,
      ...universeCards.filter((c) => !seen.has(c.oracleId)),
    ];
  }, [ownedCards, universeCards]);

  async function loadMore() {
    const next = shown + PAGE;
    setShown(next);

    // Pull another page only once the merged list runs dry.
    if (next <= merged.length || nextPage === null) return;
    setLoading(true);
    try {
      const page = await scryfall.search(toScryfallQuery(effective), nextPage);
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

  const activeFilters = countActiveFilters(filter);

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

        {scope && (
          <button
            className={scopeOn ? "primary" : ""}
            onClick={() => setScopeOn((v) => !v)}
            title="Restrict the pool to cards this deck can legally play"
          >
            {scope.label}
          </button>
        )}

        <button
          className={showFilters || activeFilters ? "primary" : ""}
          onClick={() => setShowFilters((v) => !v)}
          title="Extra constraints, combined with whatever you have searched for"
        >
          More filters{activeFilters ? ` (${activeFilters})` : ""}
        </button>

        {/* Not a source picker — an inclusion toggle. Off narrows to the
            collection the selection says is current; on widens to all of Magic
            with everything outside it shadowed. */}
        {activeCollection && (
          <label className="check" title={`Also show cards not in ${activeCollection.name}`}>
            <input
              type="checkbox"
              checked={showUnowned}
              onChange={(e) => setShowUnowned(e.target.checked)}
            />
            Show unowned
          </label>
        )}

        <span className="hint">
          {loading
            ? "Searching…"
            : merged.length
              ? `${visible.length} of ${total || merged.length}`
              : ""}
        </span>
      </div>

      {showFilters && (
        <CardFilters filter={filter} onChange={setFilter} />
      )}

      {error && <div className="status error">{error}</div>}

      <div className="scroll">
        {visible.length === 0 && !loading && (
          <div className="empty">
            {!hasSearchableTerms(effective) && !activeCollection
              ? "Search or pick a filter to fill the pool."
              : "Nothing matches."}
          </div>
        )}

        <div className="card-grid">
          {visible.map((card) => {
            const isOwned = owned.has(card.oracleId);
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
                onDoubleClick={() => onAdd?.(card)}
                title={`${card.name}${
                  activeCollection && !isOwned
                    ? ` — not in ${activeCollection.name}`
                    : ""
                }`}
              >
                <CardImage card={card} size="small" />
                {onAdd && (
                  <button
                    className="add"
                    title={target ? `Add to ${target.name}` : "Add"}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAdd(card);
                    }}
                  >
                    +
                  </button>
                )}
              </div>
            );
          })}
        </div>

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
