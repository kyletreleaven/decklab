import { useEffect, useState } from "react";
import { ownedCopies, type OwnedCopy } from "../lib/collections";
import type { Card, Collection, Deck } from "../lib/types";
import { CardImage } from "./CardImage";
import { ManaCost } from "./ManaCost";

const LEGALITY_FORMATS = ["commander", "modern", "pioneer", "legacy", "vintage"];

function money(value: string | null | undefined): string | null {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : null;
}

export function CardDetail({
  card,
  decks,
  collections,
  onAddToDeck,
  onAddToCollection,
  refreshKey,
}: {
  card: Card | null;
  decks: Deck[];
  collections: Collection[];
  onAddToDeck: (card: Card, deckId: string, asCommander: boolean) => void;
  onAddToCollection: (card: Card, collectionId: string) => void;
  /** Bumped by the parent when collections change, to refetch owned copies. */
  refreshKey: number;
}) {
  const [owned, setOwned] = useState<OwnedCopy[]>([]);

  useEffect(() => {
    if (!card) {
      setOwned([]);
      return;
    }
    let active = true;
    ownedCopies(card.oracleId).then((rows) => {
      if (active) setOwned(rows);
    });
    return () => {
      active = false;
    };
  }, [card?.oracleId, refreshKey]);

  if (!card) {
    return (
      <aside className="detail-rail">
        <div className="empty">Select a card to see its details.</div>
      </aside>
    );
  }

  const playable = owned.reduce((sum, o) => sum + o.quantity, 0);
  const usd = money(card.prices.usd);
  const usdFoil = money(card.prices.usd_foil);

  return (
    <aside className="detail-rail">
      <div className="detail">
        <CardImage card={card} size="normal" className="art" />

        <h2>{card.name}</h2>
        <div className="type">{card.typeLine}</div>

        {card.manaCost && (
          <div style={{ marginBottom: 10 }}>
            <ManaCost cost={card.manaCost} />
          </div>
        )}

        {card.oracleText && <div className="oracle">{card.oracleText}</div>}

        <dl className="kv">
          <dt>Set</dt>
          <dd>
            {card.setName} ({card.setCode.toUpperCase()} #{card.collectorNumber})
          </dd>

          <dt>Rarity</dt>
          <dd style={{ textTransform: "capitalize" }}>{card.rarity}</dd>

          <dt>Mana value</dt>
          <dd>{card.cmc}</dd>

          {(card.power || card.toughness) && (
            <>
              <dt>P/T</dt>
              <dd>
                {card.power}/{card.toughness}
              </dd>
            </>
          )}

          {card.loyalty && (
            <>
              <dt>Loyalty</dt>
              <dd>{card.loyalty}</dd>
            </>
          )}

          <dt>Identity</dt>
          <dd>{card.colorIdentity || "Colourless"}</dd>

          {(usd || usdFoil) && (
            <>
              <dt>Price</dt>
              <dd>
                {usd ?? "—"}
                {usdFoil ? ` · ${usdFoil} foil` : ""}
              </dd>
            </>
          )}

          {card.edhrecRank && (
            <>
              <dt>EDHREC rank</dt>
              <dd>#{card.edhrecRank}</dd>
            </>
          )}
        </dl>

        <div className="group-title">Legality</div>
        <dl className="kv">
          {LEGALITY_FORMATS.map((format) => {
            const status = card.legalities[format] ?? "unknown";
            const colour =
              status === "legal"
                ? "var(--ok)"
                : status === "banned"
                  ? "var(--danger)"
                  : "var(--text-faint)";
            return (
              <div key={format} style={{ display: "contents" }}>
                <dt style={{ textTransform: "capitalize" }}>{format}</dt>
                <dd style={{ color: colour, textTransform: "capitalize" }}>
                  {status.replace(/_/g, " ")}
                </dd>
              </div>
            );
          })}
        </dl>

        <div className="group-title">
          Owned <span className={playable ? "owned" : "missing"}>{playable} playable</span>
        </div>
        {owned.length === 0 ? (
          <div className="hint" style={{ marginBottom: 12 }}>
            Not in any collection.
          </div>
        ) : (
          <dl className="kv">
            {owned.map((copy, i) => (
              <div key={i} style={{ display: "contents" }}>
                <dt>{copy.quantity}×</dt>
                <dd>
                  {copy.setName} ({copy.setCode.toUpperCase()})
                  {copy.finish !== "nonfoil" ? ` · ${copy.finish}` : ""}
                  <span className="hint"> — {copy.collectionName}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="group-title">Add to</div>
        <div className="detail-actions">
          <select
            value=""
            onChange={(e) => {
              const [deckId, mode] = e.target.value.split("|");
              if (deckId) onAddToDeck(card, deckId, mode === "commander");
              e.target.value = "";
            }}
            disabled={decks.length === 0}
          >
            <option value="">
              {decks.length ? "Add to deck…" : "No decks yet"}
            </option>
            {decks.map((deck) => (
              <optgroup key={deck.id} label={deck.name}>
                <option value={`${deck.id}|main`}>Add to the 99</option>
                <option value={`${deck.id}|commander`}>Set as commander</option>
              </optgroup>
            ))}
          </select>

          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onAddToCollection(card, e.target.value);
              e.target.value = "";
            }}
            disabled={collections.length === 0}
          >
            <option value="">
              {collections.length ? "Add to collection…" : "No collections yet"}
            </option>
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </aside>
  );
}
