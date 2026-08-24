import { useMemo, useState } from "react";
import type { DeckEntry, DeckPile } from "../lib/types";
import { CardImage } from "./CardImage";

/** Sentinel for the virtual "Unsorted" column, which has no database row. */
const UNSORTED = "__unsorted__";

interface Column {
  id: string;
  name: string;
  pile: DeckPile | null;
  entries: DeckEntry[];
}

export function PilesView({
  entries,
  piles,
  selectedCardId,
  onSelectCard,
  onHoverCard,
  onMoveEntry,
  onCreatePile,
  onRenamePile,
  onDeletePile,
  onChangeQuantity,
  dimmed,
  badge,
}: {
  entries: DeckEntry[];
  piles: DeckPile[];
  selectedCardId: string | null;
  onSelectCard: (entry: DeckEntry) => void;
  /** Previews a card in the detail panel without changing the selection. */
  onHoverCard?: (card: DeckEntry["card"] | null) => void;
  onMoveEntry: (entryId: string, pileId: string | null) => void;
  onCreatePile: () => void;
  onRenamePile: (pileId: string, name: string) => void;
  onDeletePile: (pileId: string) => void;
  onChangeQuantity: (entry: DeckEntry, quantity: number) => void;
  /**
   * Cards to shade — the same rule as the pool: lit means in the collection you
   * are building from, so a dimmed card is one you would have to acquire.
   */
  dimmed?: (entry: DeckEntry) => boolean;
  /** The count to show, or `null` for none. Falls back to the plain quantity. */
  badge?: (entry: DeckEntry) => string | null;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [editingPile, setEditingPile] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const commanders = entries.filter((e) => e.zone === "commander");

  const columns = useMemo<Column[]>(() => {
    const main = entries.filter((e) => e.zone === "main");
    const known = new Set(piles.map((p) => p.id));

    // A card whose pile was deleted out from under it falls back to Unsorted
    // rather than vanishing from the view.
    const unsorted = main.filter((e) => !e.pileId || !known.has(e.pileId));

    const built: Column[] = piles.map((pile) => ({
      id: pile.id,
      name: pile.name,
      pile,
      entries: main.filter((e) => e.pileId === pile.id),
    }));

    // Unsorted always leads, even when empty: it is the only way to pull a card
    // back out of a pile, so hiding it would strand filed cards.
    built.unshift({
      id: UNSORTED,
      name: "Unsorted",
      pile: null,
      entries: unsorted,
    });

    return built;
  }, [entries, piles]);

  function handleDrop(columnId: string, event: React.DragEvent) {
    // Prefer React state, but fall back to the transfer payload: if a drag
    // starts in a way that skips our onDragStart, state would be null and the
    // drop would silently do nothing.
    const entryId = dragging || event.dataTransfer.getData("text/plain");
    setDragging(null);
    setDragOver(null);
    if (!entryId) return;
    onMoveEntry(entryId, columnId === UNSORTED ? null : columnId);
  }

  function commitRename(pile: DeckPile) {
    setEditingPile(null);
    if (draftName.trim() && draftName !== pile.name) onRenamePile(pile.id, draftName);
  }

  /** `draggable` is off for commanders: piles only hold main-zone cards, so a
   *  dragged commander would appear to do nothing. */
  function renderCard(entry: DeckEntry, index: number, draggable = true) {
    return (
      <div
        key={entry.id}
        className={`pile-card ${selectedCardId === entry.card.id ? "selected" : ""} ${
          dragging === entry.id ? "dragging" : ""
        } ${draggable ? "" : "static"} ${dimmed?.(entry) ? "dim" : ""}`}
        style={{ zIndex: index }}
        draggable={draggable}
        onDragStart={(e) => {
          setDragging(entry.id);
          e.dataTransfer.effectAllowed = "move";
          // Firefox refuses to start a drag without payload on the transfer.
          e.dataTransfer.setData("text/plain", entry.id);
        }}
        onDragEnd={() => {
          setDragging(null);
          setDragOver(null);
        }}
        onClick={() => onSelectCard(entry)}
        onMouseEnter={() => onHoverCard?.(entry.card)}
        onMouseLeave={() => onHoverCard?.(null)}
        title={`${entry.quantity}× ${entry.card.name}`}
      >
        <CardImage card={entry.card} size="small" />
        {(() => {
          const label = badge
            ? badge(entry)
            : entry.quantity > 1
              ? `${entry.quantity}×`
              : null;
          return label && <span className="qty-badge">{label}</span>;
        })()}
        <span className="tile-controls" onClick={(e) => e.stopPropagation()}>
          <button
            title="Remove one"
            onClick={() => onChangeQuantity(entry, entry.quantity - 1)}
          >
            −
          </button>
          <button
            title="Add one"
            onClick={() => onChangeQuantity(entry, entry.quantity + 1)}
          >
            +
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="piles">
      {commanders.length > 0 && (
        <div className="pile-column commander-column">
          <div className="pile-header">
            <span className="pile-name">Commander</span>
            <span className="pile-count">{commanders.length}</span>
          </div>
          <div className="pile-stack">
            {commanders.map((entry, i) => renderCard(entry, i, false))}
          </div>
        </div>
      )}

      {columns.map((column) => (
        <div
          key={column.id}
          className={`pile-column ${dragOver === column.id ? "drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dragOver !== column.id) setDragOver(column.id);
          }}
          onDragLeave={(e) => {
            // Ignore leave events fired while moving between child cards.
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDragOver((current) => (current === column.id ? null : current));
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            handleDrop(column.id, e);
          }}
        >
          <div className="pile-header">
            {editingPile === column.id && column.pile ? (
              <input
                className="pile-rename"
                value={draftName}
                autoFocus
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => commitRename(column.pile!)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(column.pile!);
                  if (e.key === "Escape") setEditingPile(null);
                }}
              />
            ) : (
              <span
                className="pile-name"
                onDoubleClick={() => {
                  if (!column.pile) return;
                  setEditingPile(column.id);
                  setDraftName(column.name);
                }}
                title={column.pile ? "Double-click to rename" : undefined}
              >
                {column.name}
              </span>
            )}
            <span className="pile-count">
              {column.entries.reduce((sum, e) => sum + e.quantity, 0)}
            </span>
            {column.pile && (
              <button
                className="ghost pile-delete"
                title="Delete pile (cards return to Unsorted)"
                onClick={() => onDeletePile(column.pile!.id)}
              >
                ×
              </button>
            )}
          </div>

          <div className="pile-stack">
            {column.entries.length === 0 ? (
              <div className="pile-empty">Drop cards here</div>
            ) : (
              column.entries.map((entry, i) => renderCard(entry, i))
            )}
          </div>
        </div>
      ))}

      <button className="pile-add" onClick={onCreatePile} title="New pile">
        ＋ New pile
      </button>
    </div>
  );
}
