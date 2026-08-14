import { useEffect, useRef, useState } from "react";
import { isSuperseded } from "../lib/scheduler";
import * as scryfall from "../lib/scryfall";
import type { Card } from "../lib/types";
import { CardImage } from "./CardImage";

/**
 * Scryfall-backed card search. The query string is passed through untouched, so
 * the full Scryfall syntax (`t:creature c:rw mv<=3`) works without us
 * reimplementing it. Every result lands in the local cache on the way through.
 */
export function CardSearch({
  onSelect,
  onHoverCard,
  onAdd,
  addLabel,
  selectedId,
}: {
  onSelect: (card: Card) => void;
  /** Previews a card in the detail panel without changing the selection. */
  onHoverCard?: (card: Card | null) => void;
  onAdd?: (card: Card) => void;
  addLabel?: string;
  selectedId?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a slow early request landing after a later one.
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < 2) {
      setCards([]);
      setTotal(0);
      setNextPage(null);
      setError(null);
      return;
    }

    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const page = await scryfall.search(trimmed);
        if (requestId.current !== id) return;
        setCards(page.cards);
        setTotal(page.totalCards);
        setNextPage(page.nextPage);
      } catch (err) {
        if (requestId.current !== id) return;
        setCards([]);
        setTotal(0);
        setNextPage(null);
        // A superseded request was replaced by a newer one; nothing failed.
        if (isSuperseded(err)) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [query]);

  async function loadMore() {
    if (nextPage === null) return;
    setLoading(true);
    try {
      const page = await scryfall.search(query.trim(), nextPage);
      setCards((prev) => [...prev, ...page.cards]);
      setNextPage(page.nextPage);
    } catch (err) {
      // A superseded request was replaced by a newer one; nothing failed.
      if (isSuperseded(err)) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search Scryfall — e.g. sol ring, or t:creature c:rw mv<=3"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <span className="hint">
          {loading ? "Searching…" : total ? `${total} result${total === 1 ? "" : "s"}` : ""}
        </span>
      </div>

      {error && <div className="status error">{error}</div>}

      <div className="scroll">
        {cards.length === 0 && !loading && (
          <div className="empty">
            {query.trim().length < 2
              ? "Type to search Scryfall. Results are cached locally as you browse."
              : error
                ? "No results."
                : "No cards matched."}
          </div>
        )}

        <div className="card-grid">
          {cards.map((card) => (
            <div
              key={card.id}
              className={`card-tile ${selectedId === card.id ? "selected" : ""}`}
              onClick={() => onSelect(card)}
              onMouseEnter={() => onHoverCard?.(card)}
              onMouseLeave={() => onHoverCard?.(null)}
              onDoubleClick={() => onAdd?.(card)}
              title={card.name}
            >
              <CardImage card={card} size="small" />
              {onAdd && (
                <button
                  className="add"
                  title={addLabel ?? "Add"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdd(card);
                  }}
                >
                  +
                </button>
              )}
            </div>
          ))}
        </div>

        {nextPage !== null && (
          <div style={{ padding: "14px 0", textAlign: "center" }}>
            <button onClick={loadMore} disabled={loading}>
              {loading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
