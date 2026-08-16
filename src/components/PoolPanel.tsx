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

/** One toggleable contextual constraint, e.g. format legality or colour identity. */
export interface Scope {
  key: string;
  label: React.ReactNode;
  title: string;
  filter: CardFilter;
}
import { CardFilters, type FilterGroup } from "./CardFilters";
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
  destination,
  activeCollection,
  scopes = [],
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

  /** Oracle ids held by the collection this pool is scoped to. */
  useEffect(() => {
    ownedOracleIds(activeCollection ? [activeCollection.id] : undefined).then(
      setOwned,
    );
  }, [activeCollection?.id]);

  // With no collection selected there is no "mine" to narrow to, so the wider
  // pool is the only meaningful view.
  const includeOutside = !activeCollection || showOutside;

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
            if (includeOutside) setError(`${err.message} — showing all of Magic only`);
            else throw err;
          }
        }
        if (requestId.current !== id) return;
        setOwnedCards(mine);

        // Only reach for the network when the local side cannot fill a page.
        if (includeOutside && hasSearchableTerms(effective) && mine.length < PAGE) {
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
  }, [activeCollection?.id, includeOutside, effectiveKey]);

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

  /**
   * Everything contextual, expressed as toggle groups for the filter bar — so
   * one place answers "why am I seeing these cards" rather than three.
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

    if (activeCollection) {
      out.push({
        label: activeCollection.name,
        toggles: [
          {
            key: "outside",
            label: `Not in ${activeCollection.name}`,
            title: `Also show cards not in ${activeCollection.name}, shadowed`,
            on: showOutside,
            onChange: setShowOutside,
          },
        ],
      });
    }

    return out;
  }, [scopes, scopesOff, activeCollection, showOutside]);

  // Counts what is *narrowing* the list: active facets, enabled scopes, and the
  // collection restriction when cards outside it are hidden.
  const activeFilters =
    countActiveFilters(filter) +
    activeScopes.length +
    (activeCollection && !showOutside ? 1 : 0);

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

        <span className="hint">
          {loading
            ? "Searching…"
            : merged.length
              ? `${visible.length} of ${total || merged.length}`
              : ""}
        </span>
      </div>

      {showFilters && (
        <CardFilters filter={filter} onChange={setFilter} groups={groups} />
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
