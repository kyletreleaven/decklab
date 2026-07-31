import { useEffect, useMemo, useState } from "react";
import { collectionItems } from "../lib/collections";
import type { Card, Collection, CollectionItem } from "../lib/types";
import { ManaCost } from "./ManaCost";

export function CollectionView({
  collection,
  selectedCardId,
  onSelectCard,
  onChangeQuantity,
  onRemove,
  onRename,
  onDelete,
  onAddCards,
  refreshKey,
}: {
  collection: Collection;
  selectedCardId: string | null;
  onSelectCard: (card: Card) => void;
  onChangeQuantity: (item: CollectionItem, quantity: number) => void;
  onRemove: (item: CollectionItem) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onAddCards: () => void;
  refreshKey: number;
}) {
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [filter, setFilter] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(collection.name);

  useEffect(() => {
    setDraftName(collection.name);
    setEditingName(false);
    setFilter("");
  }, [collection.id, collection.name]);

  // The filter runs as a LIKE against the local cache, so this stays offline
  // and fast regardless of collection size.
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      collectionItems(collection.id, filter).then((rows) => {
        if (active) setItems(rows);
      });
    }, filter ? 150 : 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [collection.id, filter, refreshKey]);

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
        <button className="primary" onClick={onAddCards}>
          ＋ Add cards
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
        <span className="spacer" style={{ flex: 1 }} />
        <input
          placeholder="Filter this collection…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: 220 }}
        />
      </div>

      <div className="scroll">
        {items.length === 0 ? (
          <div className="empty">
            {filter
              ? `Nothing in this collection matches “${filter}”.`
              : "This collection is empty. Use “Add cards” to search Scryfall."}
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className={`row ${selectedCardId === item.card.id ? "selected" : ""}`}
              onClick={() => onSelectCard(item.card)}
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
