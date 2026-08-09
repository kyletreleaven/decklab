import { useEffect, useMemo, useState } from "react";
import { ownedByPrinting } from "../lib/collections";
import { cachedPrintings } from "../lib/cards";
import * as scryfall from "../lib/scryfall";
import type { Card, Collection, Deck } from "../lib/types";
import { CardImage } from "./CardImage";
import { ManaCost } from "./ManaCost";

const LEGALITY_FORMATS = ["commander", "modern", "pioneer", "legacy", "vintage"];

function money(value: string | null | undefined): string | null {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : null;
}

/** Printing traits that distinguish same-set variants, read from raw Scryfall JSON. */
function variantTraits(card: Card): string[] {
  const data = card.data as {
    border_color?: string;
    frame_effects?: string[];
    promo?: boolean;
    finishes?: string[];
  };

  const traits: string[] = [];
  if (data.border_color === "borderless") traits.push("borderless");

  const effects = data.frame_effects ?? [];
  if (effects.includes("showcase")) traits.push("showcase");
  if (effects.includes("extendedart")) traits.push("extended");
  if (effects.includes("etched")) traits.push("etched");
  if (data.promo) traits.push("promo");

  // A single-finish printing is a real distinction (foil-only, etched-only);
  // the usual nonfoil+foil pair is not worth mentioning.
  const finishes = data.finishes ?? [];
  if (finishes.length === 1 && finishes[0] !== "nonfoil") traits.push(finishes[0]);

  return traits;
}

/**
 * A label that actually distinguishes printings.
 *
 * Set name alone is not enough: Sol Ring has 30 Secret Lair printings, so
 * without the collector number they all render identically and the list looks
 * like it is repeating itself.
 */
function printingLabel(card: Card): string {
  const base = `${card.setName} (${card.setCode.toUpperCase()}) #${card.collectorNumber}`;
  const traits = variantTraits(card);
  return traits.length ? `${base} · ${traits.join(", ")}` : base;
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
  const [printings, setPrintings] = useState<Card[]>([]);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [ownedQty, setOwnedQty] = useState<Record<string, number>>({});
  const [ownedOnly, setOwnedOnly] = useState(false);

  const oracleId = card?.oracleId ?? null;

  // Cache first so the strip draws immediately, then refresh from Scryfall
  // behind it — a card met through search usually has only one printing cached.
  useEffect(() => {
    if (!oracleId) {
      setPrintings([]);
      return;
    }

    let active = true;
    setPrintings(card ? [card] : []);

    cachedPrintings(oracleId).then((rows) => {
      if (active && rows.length) setPrintings(rows);
    });

    scryfall
      .printings(oracleId)
      .then((rows) => {
        if (active && rows.length) setPrintings(rows);
      })
      .catch(() => {
        /* offline is fine; the cached list stands */
      });

    return () => {
      active = false;
    };
  }, [oracleId]);

  useEffect(() => {
    if (!oracleId) {
      setOwnedQty({});
      return;
    }
    let active = true;
    ownedByPrinting(oracleId).then((rows) => {
      if (active) setOwnedQty(rows);
    });
    return () => {
      active = false;
    };
  }, [oracleId, refreshKey]);

  // Follow the card selected elsewhere; the carousel then moves within its
  // printings without disturbing that selection.
  useEffect(() => {
    setPrintingId(card?.id ?? null);
    setOwnedOnly(false);
  }, [card?.id]);

  const visible = useMemo(
    () => (ownedOnly ? printings.filter((p) => ownedQty[p.id]) : printings),
    [printings, ownedOnly, ownedQty],
  );

  const ownedTotal = useMemo(
    () => Object.values(ownedQty).reduce((sum, n) => sum + n, 0),
    [ownedQty],
  );

  if (!card) {
    return (
      <aside className="detail-rail">
        <div className="empty">Select a card to see its details.</div>
      </aside>
    );
  }

  // The carousel selection is what the panel describes and what ops act on, so
  // picking a printing and adding it does the obvious thing.
  const shown = printings.find((p) => p.id === printingId) ?? card;
  const index = visible.findIndex((p) => p.id === shown.id);
  const usd = money(shown.prices.usd);
  const usdFoil = money(shown.prices.usd_foil);
  const shownOwned = ownedQty[shown.id] ?? 0;

  function step(delta: number) {
    if (visible.length < 2) return;
    // Wrap, so paging through a long print run never dead-ends.
    const from = index === -1 ? 0 : index;
    const next = (from + delta + visible.length) % visible.length;
    setPrintingId(visible[next].id);
  }

  return (
    <aside className="detail-rail">
      <div className="detail">
        {/* Operations lead: during deckbuilding these are what you reach for,
            and burying them under the reference data meant scrolling past two
            screenfuls to add a card. */}
        <div className="ops">
          <div className="ops-row">
            <select
              value=""
              onChange={(e) => {
                const [deckId, mode] = e.target.value.split("|");
                if (deckId) onAddToDeck(shown, deckId, mode === "commander");
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
                if (e.target.value) onAddToCollection(shown, e.target.value);
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

          {/* Any printing counts, so this is an oracle-level number. */}
          <div className={`owned-badge ${ownedTotal ? "owned" : "missing"}`}>
            {ownedTotal ? `${ownedTotal} owned` : "Not owned"}
          </div>
        </div>

        {/* The image is the carousel viewport: stepping changes the printing
            and everything printing-level below follows it. */}
        <div className="carousel">
          <CardImage key={shown.id} card={shown} size="normal" className="art" />

          {visible.length > 1 && (
            <>
              <button
                className="carousel-arrow left"
                onClick={() => step(-1)}
                title="Previous printing"
              >
                ‹
              </button>
              <button
                className="carousel-arrow right"
                onClick={() => step(1)}
                title="Next printing"
              >
                ›
              </button>
            </>
          )}

          {shownOwned > 0 && <span className="qty-badge">{shownOwned}×</span>}
        </div>

        <div className="carousel-controls">
          <select
            value={shown.id}
            onChange={(e) => setPrintingId(e.target.value)}
            disabled={visible.length === 0}
            title="Jump to a printing"
          >
            {visible.map((printing) => (
              <option key={printing.id} value={printing.id}>
                {printingLabel(printing)}
                {ownedQty[printing.id] ? ` — ${ownedQty[printing.id]}× owned` : ""}
              </option>
            ))}
          </select>

          <span className="hint">
            {visible.length > 1
              ? `${index === -1 ? 1 : index + 1}/${visible.length}`
              : ""}
          </span>

          <label className="check" title="Show only printings you hold">
            <input
              type="checkbox"
              checked={ownedOnly}
              onChange={(e) => setOwnedOnly(e.target.checked)}
              disabled={ownedTotal === 0}
            />
            Owned only
          </label>
        </div>

        <h2>{shown.name}</h2>
        <div className="type">{shown.typeLine}</div>

        {shown.manaCost && (
          <div style={{ marginBottom: 10 }}>
            <ManaCost cost={shown.manaCost} />
          </div>
        )}

        {shown.oracleText && <div className="oracle">{shown.oracleText}</div>}

        {/* Oracle-level: true of the card whichever printing is selected. */}
        <dl className="kv">
          <dt>Mana value</dt>
          <dd>{shown.cmc}</dd>

          {(shown.power || shown.toughness) && (
            <>
              <dt>P/T</dt>
              <dd>
                {shown.power}/{shown.toughness}
              </dd>
            </>
          )}

          {shown.loyalty && (
            <>
              <dt>Loyalty</dt>
              <dd>{shown.loyalty}</dd>
            </>
          )}

          <dt>Identity</dt>
          <dd>{shown.colorIdentity || "Colourless"}</dd>

          {shown.edhrecRank && (
            <>
              <dt>EDHREC rank</dt>
              <dd>#{shown.edhrecRank}</dd>
            </>
          )}
        </dl>

        <div className="group-title">Legality</div>
        <dl className="kv">
          {LEGALITY_FORMATS.map((format) => {
            const status = shown.legalities[format] ?? "unknown";
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

        {/* Printing-level: everything here changes with the carousel. */}
        <div className="group-title">This printing</div>
        <dl className="kv">
          <dt>Set</dt>
          <dd>
            {shown.setName} ({shown.setCode.toUpperCase()} #{shown.collectorNumber})
          </dd>

          <dt>Rarity</dt>
          <dd style={{ textTransform: "capitalize" }}>{shown.rarity}</dd>

          {variantTraits(shown).length > 0 && (
            <>
              <dt>Variant</dt>
              <dd style={{ textTransform: "capitalize" }}>
                {variantTraits(shown).join(", ")}
              </dd>
            </>
          )}

          {shown.releasedAt && (
            <>
              <dt>Released</dt>
              <dd>{shown.releasedAt}</dd>
            </>
          )}

          {(usd || usdFoil) && (
            <>
              <dt>Price</dt>
              <dd>
                {usd ?? "—"}
                {usdFoil ? ` · ${usdFoil} foil` : ""}
              </dd>
            </>
          )}

          <dt>Owned</dt>
          <dd className={shownOwned ? "owned" : "missing"}>
            {shownOwned ? `${shownOwned} of this printing` : "None of this printing"}
          </dd>
        </dl>
      </div>
    </aside>
  );
}
