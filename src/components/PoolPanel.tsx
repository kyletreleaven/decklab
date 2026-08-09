import { useEffect, useMemo, useRef, useState } from "react";
import { collectionItems, ownedOracleIds } from "../lib/collections";
import {
  countActiveFilters,
  hasSearchableTerms,
  ownershipMode,
  toScryfallQuery,
  type CardFilter,
} from "../lib/filters";
import * as scryfall from "../lib/scryfall";
import type { Card, Collection } from "../lib/types";
import { CardFilters } from "./CardFilters";
import { CardImage } from "./CardImage";

const SCRYFALL = "__scryfall__";

/**
 * The candidate-card pool for the deck builder.
 *
 * One panel, two sources: Scryfall (the whole game) or a local collection (what
 * you own). The same filter model drives both — translated to a Scryfall query
 * string in one case and to a SQL predicate in the other — so switching source
 * keeps your filters rather than resetting them.
 */
export function PoolPanel({
  collections,
  selectedId,
  onSelect,
  onAdd,
  scope,
}: {
  collections: Collection[];
  selectedId: string | null;
  onSelect: (card: Card) => void;
  onAdd: (card: Card) => void;
  /** Extra constraints from the deck, e.g. commander identity + format. */
  scope?: { label: string; filter: CardFilter };
}) {
  const [source, setSource] = useState<string>(SCRYFALL);
  const [filter, setFilter] = useState<CardFilter>({});
  const [showFilters, setShowFilters] = useState(false);
  const [scopeOn, setScopeOn] = useState(true);

  const [cards, setCards] = useState<Card[]>([]);
  const [owned, setOwned] = useState<Set<string>>(new Set());
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
  const mode = ownershipMode(filter);

  useEffect(() => {
    ownedOracleIds().then(setOwned);
  }, [collections.length]);

  useEffect(() => {
    const id = ++requestId.current;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        if (source === SCRYFALL) {
          const query = toScryfallQuery(effective);
          if (!hasSearchableTerms(effective)) {
            if (requestId.current !== id) return;
            setCards([]);
            setTotal(0);
            setNextPage(null);
            return;
          }
          const page = await scryfall.search(query);
          if (requestId.current !== id) return;
          setCards(page.cards);
          setTotal(page.totalCards);
          setNextPage(page.nextPage);
        } else {
          const items = await collectionItems(source, effective);
          if (requestId.current !== id) return;
          setCards(items.map((item) => item.card));
          setTotal(items.length);
          setNextPage(null);
        }
      } catch (err) {
        if (requestId.current !== id) return;
        setCards([]);
        setTotal(0);
        setNextPage(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    };

    const timer = setTimeout(run, 350);
    return () => clearTimeout(timer);
  }, [source, effectiveKey]);

  async function loadMore() {
    if (nextPage === null) return;
    setLoading(true);
    try {
      const page = await scryfall.search(toScryfallQuery(effective), nextPage);
      setCards((prev) => [...prev, ...page.cards]);
      setNextPage(page.nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // Ownership is the one facet Scryfall cannot answer, so it is applied here.
  // "all" keeps everything and dims the unowned rather than hiding them.
  const visible = useMemo(() => {
    if (mode === "all") return cards;
    if (mode === "none") return [];
    return cards.filter((card) =>
      mode === "owned" ? owned.has(card.oracleId) : !owned.has(card.oracleId),
    );
  }, [cards, owned, mode]);

  const activeFilters = countActiveFilters(filter);

  return (
    <div className="pool">
      <div className="toolbar">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          title="Where the pool comes from"
        >
          <option value={SCRYFALL}>All of Magic (Scryfall)</option>
          {collections.map((collection) => (
            <option key={collection.id} value={collection.id}>
              {collection.name}
            </option>
          ))}
        </select>

        <input
          className="search-input"
          placeholder={
            source === SCRYFALL
              ? "Search — plain text or Scryfall syntax"
              : "Filter this collection by name…"
          }
          value={filter.name ?? ""}
          onChange={(e) => setFilter({ ...filter, name: e.target.value })}
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
        >
          Filters{activeFilters ? ` (${activeFilters})` : ""}
        </button>

        <span className="hint">
          {loading ? "Searching…" : total ? `${visible.length} of ${total}` : ""}
        </span>
      </div>

      {showFilters && (
        <CardFilters filter={filter} onChange={setFilter} showOwnership />
      )}

      {error && <div className="status error">{error}</div>}

      <div className="scroll">
        {visible.length === 0 && !loading && (
          <div className="empty">
            {mode === "none"
              ? "Both ownership boxes are off, so nothing can show."
              : source === SCRYFALL && !hasSearchableTerms(effective)
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
                  // Arena's convention: with both boxes ticked, cards you do not
                  // own stay visible but are dimmed.
                  mode === "all" && !isOwned ? "dim" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onSelect(card)}
                onDoubleClick={() => onAdd(card)}
                title={`${card.name}${isOwned ? "" : " — not collected"}`}
              >
                <CardImage card={card} size="small" />
                <button
                  className="add"
                  title="Add to deck"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdd(card);
                  }}
                >
                  +
                </button>
              </div>
            );
          })}
        </div>

        {nextPage !== null && (
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
