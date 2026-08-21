import { useEffect, useMemo, useState } from "react";
import { deckOwnership } from "../lib/collections";
import {
  autoArrangePiles,
  createPile,
  deletePile,
  listPiles,
  renamePile,
  setEntryPile,
  type AutoArrange,
} from "../lib/decks";
import {
  CATEGORY_ORDER,
  categoryOf,
  commanderIssues,
  deckStats,
} from "../lib/deckstats";
import type {
  Card,
  Deck,
  DeckEntry,
  DeckPile,
  OwnershipRow,
} from "../lib/types";
import { ManaCost } from "./ManaCost";
import { PilesView } from "./PilesView";

export function DeckView({
  deck,
  entries,
  activeCollection,
  selectedCardId,
  onSelectCard,
  onHoverCard,
  onChangeQuantity,
  onRemove,
  onSetZone,
  onRename,
  onDelete,
  onImport,
  onExport,
  onReloadEntries,
  poolOn,
  onTogglePool,
  refreshKey,
}: {
  deck: Deck;
  entries: DeckEntry[];
  /**
   * The collection ownership is checked against — one notion of scope, shared
   * with the card panel, rather than a per-view set of chips. When it becomes
   * multi-valued it should do so in the selection model, once, not here.
   */
  activeCollection: { id: string; name: string } | null;
  selectedCardId: string | null;
  onSelectCard: (card: Card) => void;
  /** Previews a card in the detail panel without changing the selection. */
  onHoverCard?: (card: Card | null) => void;
  onChangeQuantity: (entry: DeckEntry, quantity: number) => void;
  onRemove: (entry: DeckEntry) => void;
  onSetZone: (entry: DeckEntry, zone: DeckEntry["zone"]) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onImport: () => void;
  onExport: () => void;
  onReloadEntries: () => Promise<void>;
  /** Whether the candidate-card pool is showing above this deck. */
  poolOn: boolean;
  onTogglePool: () => void;
  refreshKey: number;
}) {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(deck.name);
  const [ownership, setOwnership] = useState<Map<string, OwnershipRow>>(new Map());
  const [layout, setLayout] = useState<"list" | "piles">("list");
  const [piles, setPiles] = useState<DeckPile[]>([]);

  async function reloadPiles() {
    setPiles(await listPiles(deck.id));
  }

  useEffect(() => {
    let active = true;
    listPiles(deck.id).then((rows) => {
      if (active) setPiles(rows);
    });
    return () => {
      active = false;
    };
  }, [deck.id]);

  async function handleAutoArrange(mode: AutoArrange) {
    await autoArrangePiles(deck.id, mode, entries);
    await reloadPiles();
    await onReloadEntries();
  }

  useEffect(() => {
    setDraftName(deck.name);
    setEditingName(false);
  }, [deck.id, deck.name]);

  useEffect(() => {
    let active = true;
    if (!activeCollection) {
      setOwnership(new Map());
      return;
    }
    deckOwnership(deck.id, [activeCollection.id]).then((rows) => {
      if (active) setOwnership(new Map(rows.map((r) => [r.cardId, r])));
    });
    return () => {
      active = false;
    };
  }, [deck.id, activeCollection?.id, entries, refreshKey]);

  const stats = useMemo(() => deckStats(entries), [entries]);
  const issues = useMemo(() => commanderIssues(entries), [entries]);

  const commanders = entries.filter((e) => e.zone === "commander");
  const main = entries.filter((e) => e.zone === "main");
  const maybe = entries.filter((e) => e.zone === "maybe");

  const grouped = useMemo(() => {
    const buckets = new Map<string, DeckEntry[]>();
    for (const entry of main) {
      const category = categoryOf(entry.card);
      const bucket = buckets.get(category);
      if (bucket) bucket.push(entry);
      else buckets.set(category, [entry]);
    }
    return CATEGORY_ORDER.filter((c) => buckets.has(c)).map((category) => ({
      category,
      entries: buckets.get(category)!,
    }));
  }, [main]);

  const missingCount = useMemo(() => {
    if (!activeCollection) return null;
    let missing = 0;
    for (const row of ownership.values()) {
      missing += Math.max(0, row.required - row.playable);
    }
    return missing;
  }, [ownership, activeCollection]);

  const maxCurve = Math.max(1, ...stats.curve.map((c) => c.count));

  function commitName() {
    setEditingName(false);
    if (draftName.trim() && draftName !== deck.name) onRename(draftName);
    else setDraftName(deck.name);
  }

  function renderRow(entry: DeckEntry) {
    const own = ownership.get(entry.cardId);
    const short = own && own.playable < own.required;

    return (
      <div
        key={entry.id}
        className={`row ${selectedCardId === entry.card.id ? "selected" : ""}`}
        onClick={() => onSelectCard(entry.card)}
        onMouseEnter={() => onHoverCard?.(entry.card)}
        onMouseLeave={() => onHoverCard?.(null)}
      >
        <span className="qty">{entry.quantity}×</span>
        <span className="name">{entry.card.name}</span>
        {own && (
          <span className={`meta ${short ? "missing" : "owned"}`}>
            {short ? `${own.playable}/${own.required}` : "✓"}
          </span>
        )}
        <ManaCost cost={entry.card.manaCost} />
        <span className="controls" onClick={(e) => e.stopPropagation()}>
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
          <button
            title={
              entry.zone === "commander" ? "Move to the 99" : "Make commander"
            }
            onClick={() =>
              onSetZone(entry, entry.zone === "commander" ? "main" : "commander")
            }
          >
            {entry.zone === "commander" ? "☆" : "★"}
          </button>
          <button
            title={entry.zone === "maybe" ? "Move to deck" : "Move to maybeboard"}
            onClick={() => onSetZone(entry, entry.zone === "maybe" ? "main" : "maybe")}
          >
            {entry.zone === "maybe" ? "↑" : "↓"}
          </button>
          <button title="Remove" onClick={() => onRemove(entry)}>
            ×
          </button>
        </span>
      </div>
    );
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
                setDraftName(deck.name);
                setEditingName(false);
              }
            }}
          />
        ) : (
          <h1 onDoubleClick={() => setEditingName(true)} title="Double-click to rename">
            {deck.name}
          </h1>
        )}
        <span className="spacer" />

        {layout === "piles" && (
          <>
            <span className="filter-label">Arrange</span>
            <button onClick={() => handleAutoArrange("type")} title="Rebuild piles by card type">
              By type
            </button>
            <button onClick={() => handleAutoArrange("mv")} title="Rebuild piles by mana value">
              By MV
            </button>
          </>
        )}

        <div className="segmented">
          <button
            className={layout === "list" ? "on" : ""}
            onClick={() => setLayout("list")}
          >
            List
          </button>
          <button
            className={layout === "piles" ? "on" : ""}
            onClick={() => setLayout("piles")}
          >
            Piles
          </button>
        </div>

        <button
          className={poolOn ? "primary" : ""}
          onClick={onTogglePool}
          title={
            poolOn
              ? "Hide the candidate-card pool"
              : "Open a pool of candidate cards above the deck"
          }
        >
          {/* Asymmetric on purpose: closed, it should name what you get;
              open, it should name what the click does. */}
          {poolOn ? "Hide pool" : "＋ Add cards"}
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
          <span className="value">{stats.totalCount}/100</span>
        </div>
        <div className="stat">
          <span className="label">Avg MV</span>
          <span className="value">{stats.averageMv.toFixed(2)}</span>
        </div>
        <div className="stat">
          <span className="label">Identity</span>
          <span className="value">
            {stats.colorIdentity ? (
              <ManaCost
                cost={[...stats.colorIdentity].map((c) => `{${c}}`).join("")}
              />
            ) : (
              "—"
            )}
          </span>
        </div>
        <div className="stat">
          <span className="label">Est. value</span>
          <span className="value">${stats.estimatedUsd.toFixed(2)}</span>
        </div>
        <div className="stat">
          <span className="label">Curve</span>
          <div className="curve">
            {stats.curve.map((bucket) => (
              <div
                key={bucket.mv}
                className="bar"
                style={{ height: `${(bucket.count / maxCurve) * 100}%` }}
                title={`MV ${bucket.mv === 7 ? "7+" : bucket.mv}: ${bucket.count}`}
              >
                <span>{bucket.mv === 7 ? "7+" : bucket.mv}</span>
              </div>
            ))}
          </div>
        </div>
        {missingCount !== null && (
          <div className="stat">
            <span className="label">Missing</span>
            <span className={`value ${missingCount ? "missing" : "owned"}`}>
              {missingCount === 0 ? "Complete" : `${missingCount} cards`}
            </span>
          </div>
        )}
      </div>

      {issues.length > 0 && (
        <div className="issues">
          {issues.map((issue, i) => (
            <div key={i} className={`issue ${issue.severity}`}>
              <span>{issue.severity === "error" ? "✗" : "⚠"}</span>
              <span>{issue.message}</span>
            </div>
          ))}
        </div>
      )}

      {layout === "piles" ? (
        <PilesView
          entries={entries}
          piles={piles}
          selectedCardId={selectedCardId}
          onSelectCard={(entry) => onSelectCard(entry.card)}
          onHoverCard={onHoverCard}
          onChangeQuantity={onChangeQuantity}
          onMoveEntry={async (entryId, pileId) => {
            await setEntryPile(entryId, deck.id, pileId);
            await onReloadEntries();
          }}
          onCreatePile={async () => {
            await createPile(deck.id, `Pile ${piles.length + 1}`);
            await reloadPiles();
          }}
          onRenamePile={async (pileId, name) => {
            await renamePile(pileId, name);
            await reloadPiles();
          }}
          onDeletePile={async (pileId) => {
            await deletePile(pileId, deck.id);
            await reloadPiles();
            await onReloadEntries();
          }}
        />
      ) : (
        <div className="scroll">
          {entries.length === 0 && (
            <div className="empty">
              This deck is empty. Use “Add cards” to search Scryfall.
            </div>
          )}

        {commanders.length > 0 && (
          <div className="group">
            <div className="group-title">
              Commander <span>{commanders.length}</span>
            </div>
            {commanders.map(renderRow)}
          </div>
        )}

        {grouped.map(({ category, entries: bucket }) => (
          <div className="group" key={category}>
            <div className="group-title">
              {category}
              <span>{bucket.reduce((sum, e) => sum + e.quantity, 0)}</span>
            </div>
            {bucket.map(renderRow)}
          </div>
        ))}

          {maybe.length > 0 && (
            <div className="group">
              <div className="group-title">
                Maybeboard <span>{maybe.length}</span>
              </div>
              {maybe.map(renderRow)}
            </div>
          )}
        </div>
      )}
    </>
  );
}
