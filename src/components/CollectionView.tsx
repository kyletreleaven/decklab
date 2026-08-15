import { useEffect, useMemo, useState } from "react";
import {
  collectionItems,
  QueryError,
  type CollectionSort,
} from "../lib/collections";
import { countActiveFilters, type CardFilter } from "../lib/filters";
import type { Card, Collection, CollectionItem } from "../lib/types";
import { CardFilters } from "./CardFilters";
import { CardImage } from "./CardImage";
import { ManaCost } from "./ManaCost";

const SORTS: { value: CollectionSort; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "mv", label: "Mana value" },
  { value: "quantity", label: "Quantity" },
  { value: "value", label: "Price" },
];

export function CollectionView({
  collection,
  selectedCardId,
  onSelectCard,
  onHoverCard,
  onChangeQuantity,
  onRemove,
  onRename,
  onDelete,
  onAddCards,
  onImport,
  onExport,
  refreshKey,
}: {
  collection: Collection;
  selectedCardId: string | null;
  onSelectCard: (card: Card) => void;
  /** Previews a card in the detail panel without changing the selection. */
  onHoverCard?: (card: Card | null) => void;
  onChangeQuantity: (item: CollectionItem, quantity: number) => void;
  onRemove: (item: CollectionItem) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onAddCards: () => void;
  onImport: () => void;
  onExport: () => void;
  refreshKey: number;
}) {
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [layout, setLayout] = useState<"list" | "wall">("wall");
  const [showFilters, setShowFilters] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);

  const [filter, setFilter] = useState<CardFilter>({});
  const [sort, setSort] = useState<CollectionSort>("name");

  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(collection.name);

  useEffect(() => {
    setDraftName(collection.name);
    setEditingName(false);
  }, [collection.id, collection.name]);

  // Reset filters when switching collections, so a filter from one collection
  // does not silently hide everything in the next.
  useEffect(() => {
    setFilter({});
  }, [collection.id]);

  // Serialised so a new object identity per render does not retrigger the query.
  const filterKey = JSON.stringify(filter);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () => {
        collectionItems(collection.id, filter, sort)
          .then((rows) => {
            if (!active) return;
            setItems(rows);
            setQueryError(null);
          })
          .catch((err) => {
            if (!active) return;
            // Keep the previous results on screen. A half-typed query is the
            // normal case, not a failure, and blanking the list would make it
            // look like nothing matched.
            setQueryError(
              err instanceof QueryError ? err.message : String(err?.message ?? err),
            );
          });
      },
      filter.query ? 150 : 0,
    );

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [collection.id, filterKey, sort, refreshKey]);

  const totals = useMemo(() => {
    let cards = 0;
    let value = 0;
    for (const item of items) {
      cards += item.quantity;
      const price = Number.parseFloat(
        (item.finish === "foil" ? item.card.prices.usd_foil : item.card.prices.usd) ??
          "",
      );
      if (Number.isFinite(price)) value += price * item.quantity;
    }
    return { cards, unique: items.length, value };
  }, [items]);

  const activeFilters = countActiveFilters(filter);

  function commitName() {
    setEditingName(false);
    if (draftName.trim() && draftName !== collection.name) onRename(draftName);
    else setDraftName(collection.name);
  }

  return (
    <>
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
                setDraftName(collection.name);
                setEditingName(false);
              }
            }}
          />
        ) : (
          <h1
            onDoubleClick={() => setEditingName(true)}
            title="Double-click to rename"
          >
            {collection.name}
          </h1>
        )}
        <span className="spacer" />

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

        <button className="primary" onClick={onAddCards}>
          ＋ Add cards
        </button>
        <button className="ghost" onClick={onImport}>
          Import
        </button>
        <button className="ghost" onClick={onExport}>
          Export
        </button>
        <button className="ghost" onClick={() => setEditingName(true)}>
          Rename
        </button>
        <button className="ghost" onClick={onDelete}>
          Delete
        </button>
      </div>

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

        <span style={{ flex: 1 }} />

        <input
          placeholder={"Search — t:creature c:r mv<=3"}
          value={filter.query ?? ""}
          onChange={(e) => setFilter({ ...filter, query: e.target.value })}
          style={{ width: 260 }}
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as CollectionSort)}
          title="Sort"
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              Sort: {option.label}
            </option>
          ))}
        </select>
        <button
          className={showFilters || activeFilters ? "primary" : ""}
          onClick={() => setShowFilters((v) => !v)}
          title="Extra constraints, combined with whatever you have searched for"
        >
          More filters{activeFilters ? ` (${activeFilters})` : ""}
        </button>
      </div>

      {showFilters && <CardFilters filter={filter} onChange={setFilter} />}

      {queryError && <div className="status error">{queryError}</div>}

      <div className="scroll">
        {items.length === 0 ? (
          <div className="empty">
            {activeFilters || filter.query
              ? "Nothing in this collection matches."
              : "This collection is empty. Use “Add cards” to search Scryfall."}
          </div>
        ) : layout === "wall" ? (
          <div className="card-grid">
            {items.map((item) => (
              <div
                key={item.id}
                className={`card-tile ${
                  selectedCardId === item.card.id ? "selected" : ""
                }`}
                onClick={() => onSelectCard(item.card)}
                onMouseEnter={() => onHoverCard?.(item.card)}
                onMouseLeave={() => onHoverCard?.(null)}
                title={`${item.quantity}× ${item.card.name}`}
              >
                <CardImage card={item.card} size="small" />
                <span className="qty-badge">{item.quantity}×</span>
                {item.finish !== "nonfoil" && (
                  <span className="finish-badge">{item.finish}</span>
                )}
                <span
                  className="tile-controls"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    title="Remove one"
                    onClick={() => onChangeQuantity(item, item.quantity - 1)}
                  >
                    −
                  </button>
                  <button
                    title="Add one"
                    onClick={() => onChangeQuantity(item, item.quantity + 1)}
                  >
                    +
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className={`row ${selectedCardId === item.card.id ? "selected" : ""}`}
              onClick={() => onSelectCard(item.card)}
              onMouseEnter={() => onHoverCard?.(item.card)}
              onMouseLeave={() => onHoverCard?.(null)}
            >
              <span className="qty">{item.quantity}×</span>
              <span className="name">{item.card.name}</span>
              <span className="meta">
                {item.card.setCode.toUpperCase()}
                {item.finish !== "nonfoil" ? ` · ${item.finish}` : ""}
              </span>
              <ManaCost cost={item.card.manaCost} />
              <span className="controls" onClick={(e) => e.stopPropagation()}>
                <button
                  title="Remove one"
                  onClick={() => onChangeQuantity(item, item.quantity - 1)}
                >
                  −
                </button>
                <button
                  title="Add one"
                  onClick={() => onChangeQuantity(item, item.quantity + 1)}
                >
                  +
                </button>
                <button title="Remove" onClick={() => onRemove(item)}>
                  ×
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
