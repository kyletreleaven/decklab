import { useCallback, useEffect, useMemo, useState } from "react";
import { collectionCountsByPrinting } from "../lib/collections";
import { cachedPrintings } from "../lib/cards";
import { printingLabel, variantTraits } from "../lib/printings";
import { isSuperseded } from "../lib/scheduler";
import * as scryfall from "../lib/scryfall";
import type { Card } from "../lib/types";
import { hasBack } from "../lib/images";
import { CardImage } from "./CardImage";
import { ManaCost } from "./ManaCost";

const LEGALITY_FORMATS = ["commander", "modern", "pioneer", "legacy", "vintage"];

function money(value: string | null | undefined): string | null {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : null;
}

export function CardDetail({
  card,
  onSetCommander,
  target,
  onAdjustTarget,
  onTargetSlot,
  activeDeck,
  deckQuantities,
  activeCollection,
  swatch,
  collectionQuantities,
  onChoosePrinting,
  refreshKey,
}: {
  card: Card | null;
  /**
   * Move this card into the target deck's commander zone. Absent when the
   * target is not a Commander deck. *Moves* rather than adds, so a card already
   * in the 99 does not end up held twice.
   */
  onSetCommander?: (card: Card) => void;
  /**
   * The most recently opened deck or collection — where the carousel's +/-
   * writes. For a deck this means its maindeck: the default zone, which is the
   * one sensible answer that does not depend on how zones end up being modelled.
   */
  target: { kind: "deck" | "collection"; id: string; name: string } | null;
  onAdjustTarget: (card: Card, delta: number) => void | Promise<void>;
  /**
   * Retarget to one of the listed slots — the same "select without navigating"
   * gesture as the sidebar dot, offered where the counts already are.
   */
  onTargetSlot: (slot: {
    kind: "deck" | "collection";
    id: string;
    name: string;
  }) => void;
  /** The active deck slot, listed alongside the collection one. */
  activeDeck: { id: string; name: string } | null;
  /** Per-printing counts in `activeDeck`, keyed by printing id. */
  deckQuantities: Record<string, number>;
  /**
   * The collection the panel's counts are stated against. Naming a specific
   * collection beats a vague "owned" aggregate: it answers *which* collection,
   * and it matches the sidebar ring so the scope is visible rather than implied.
   */
  activeCollection: { id: string; name: string } | null;
  /** Per-printing counts in `activeCollection`, keyed by printing id. */
  collectionQuantities: Record<string, number>;
  /** Bumped by the parent when collections change, to refetch owned copies. */
  /**
   * Foreground and background as two named slots, after Photoshop's swatches.
   *
   * Here rather than in a pool toolbar because the background is app-level: it
   * is copied in one view and consulted in the next, and a per-panel control
   * would render once per panel while editing one shared value. This rail
   * already carries the other "what is currently selected" rows.
   */
  swatch?: {
    set: { id: string; name: string } | null;
    foreground: { id: string; name: string } | null;
    onCopyForeground: () => void;
    onSwitch: () => void;
    onClear: () => void;
  };
  /**
   * Fired when a printing is chosen from the carousel. Lifts the choice out of
   * this panel so the pool can render the same printing — and so `+` writes it
   * rather than an arbitrary one.
   */
  onChoosePrinting?: (printing: Card) => void;
  refreshKey: number;
}) {
  const [printings, setPrintings] = useState<Card[]>([]);
  const [printingId, setPrintingId] = useState<string | null>(null);
  /**
   * Which face of a double-faced card is showing.
   *
   * Reset whenever the printing changes: the new printing may not even have a
   * back, and a stuck "back" would silently fall through to the front anyway.
   */
  const [face, setFace] = useState<"front" | "back">("front");
  const [ownedQty, setOwnedQty] = useState<Record<string, number>>({});
  /**
   * Which printings the carousel steps through. A preference, so it persists as
   * focus moves between cards.
   */
  const [printingFilter, setPrintingFilter] = useState<
    "all" | "deck" | "collection"
  >("all");
  const [printingsError, setPrintingsError] = useState<string | null>(null);

  const oracleId = card?.oracleId ?? null;

  // Cache first so the strip draws immediately, then refresh from Scryfall
  // behind it — a card met through search usually has only one printing cached.
  useEffect(() => {
    if (!oracleId) {
      setPrintings([]);
      setPrintingsError(null);
      return;
    }

    let active = true;
    // Tracks whether the network result has landed, so the slower-but-staler
    // cache read cannot clobber it if the two resolve out of order.
    let networkWon = false;

    setPrintings(card ? [card] : []);
    setPrintingsError(null);

    cachedPrintings(oracleId).then((rows) => {
      if (active && !networkWon && rows.length) setPrintings(rows);
    });

    scryfall
      .printings(oracleId)
      .then((rows) => {
        if (!active) return;
        networkWon = true;
        if (rows.length) setPrintings(rows);
      })
      .catch((err) => {
        if (!active) return;
        // Superseded means the pointer moved on before this ran — expected, and
        // not a failure. Anything else is: offline is legitimate, but so is a
        // real error, and a silently truncated print run looks identical to a
        // card that genuinely has two printings.
        if (isSuperseded(err)) return;
        setPrintingsError(err instanceof Error ? err.message : String(err));
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
    collectionCountsByPrinting(oracleId).then((rows) => {
      if (active) setOwnedQty(rows);
    });
    return () => {
      active = false;
    };
  }, [oracleId, refreshKey]);

  /**
   * The panel always shows the printing it was handed. Hovering or clicking a
   * tile is an unambiguous request for *that* printing, so nothing is restored
   * from a previous choice — pointing at a card and seeing a different one is
   * more confusing than losing a carousel selection.
   *
   * A choice made in the carousel still persists while you stay on the card:
   * this only fires when a different card arrives.
   */
  useEffect(() => {
    setPrintingId(card?.id ?? null);
  }, [card?.id]);

  useEffect(() => {
    setFace("front");
  }, [printingId]);

  const choosePrinting = useCallback(
    (printing: Card) => {
      setPrintingId(printing.id);
      // Tell the rest of the app, so an oracle-grain tile showing this card
      // switches to the printing you just picked. Without it the pool keeps
      // rendering whatever `unique=cards` happened to return.
      onChoosePrinting?.(printing);
    },
    [onChoosePrinting],
  );

  /**
   * Counts are stated against the active collection when there is one, falling
   * back to every ownable collection otherwise. One scope for the whole panel,
   * named wherever it appears.
   */
  const scopedQty = activeCollection ? collectionQuantities : ownedQty;

  /** Copies held in each slot, across every printing of this card. */
  const deckTotal = useMemo(
    () => Object.values(deckQuantities).reduce((sum, n) => sum + n, 0),
    [deckQuantities],
  );
  const collectionTotal = useMemo(
    () => Object.values(collectionQuantities).reduce((sum, n) => sum + n, 0),
    [collectionQuantities],
  );

  /** Counts backing the active printing filter, and the labels beside them. */
  const filterQty =
    printingFilter === "deck"
      ? deckQuantities
      : printingFilter === "collection"
        ? collectionQuantities
        : scopedQty;

  const visible = useMemo(
    () =>
      printingFilter === "all"
        ? printings
        : printings.filter((p) => filterQty[p.id]),
    [printings, printingFilter, filterQty],
  );

  // Falling back covers both the slot disappearing and its last copy being
  // removed — either way the filter would otherwise show an empty carousel.
  useEffect(() => {
    if (printingFilter === "deck" && deckTotal === 0) setPrintingFilter("all");
    if (printingFilter === "collection" && collectionTotal === 0) {
      setPrintingFilter("all");
    }
  }, [printingFilter, deckTotal, collectionTotal]);

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
  /**
   * The two active slots, listed together. Only ever these two — not an
   * inventory of everywhere the card lives — because they are what the controls
   * act on and what the counts are stated against.
   */
  const slots = [
    activeDeck && {
      kind: "deck" as const,
      name: activeDeck.name,
      id: activeDeck.id,
      count: deckQuantities[shown.id] ?? 0,
      total: deckTotal,
    },
    activeCollection && {
      kind: "collection" as const,
      name: activeCollection.name,
      id: activeCollection.id,
      count: collectionQuantities[shown.id] ?? 0,
      total: collectionTotal,
    },
  ].filter((slot) => slot !== null);

  const inTarget =
    slots.find((s) => s.kind === target?.kind && s.id === target?.id)?.count ?? 0;

  function step(delta: number) {
    if (visible.length < 2) return;
    // Wrap, so paging through a long print run never dead-ends.
    const from = index === -1 ? 0 : index;
    const next = (from + delta + visible.length) % visible.length;
    choosePrinting(visible[next]);
  }

  return (
    <aside className="detail-rail">
      <div className="detail">
        {/* Operations lead: during deckbuilding these are what you reach for,
            and burying them under the reference data meant scrolling past two
            screenfuls to add a card. */}
        <div className="ops">
          {swatch?.foreground && (
            <div className="swatch">
              <span className="slot" title={`Showing ${swatch.foreground.name}`}>
                {swatch.foreground.name}
              </span>
              <button
                onClick={swatch.onCopyForeground}
                title={`Put ${swatch.foreground.name} behind whatever you look at next`}
              >
                ↓
              </button>
              <button
                onClick={swatch.onSwitch}
                disabled={!swatch.set}
                title={
                  swatch.set
                    ? `Go to ${swatch.set.name}, with ${swatch.foreground.name} behind`
                    : "Nothing to swap with"
                }
              >
                ⇄
              </button>
              <span
                className={`slot ${swatch.set ? "" : "muted"}`}
                title="Drawn behind, shadowed"
              >
                {swatch.set?.name ?? "All Magic"}
              </span>
              <button onClick={swatch.onClear} disabled={!swatch.set} title="Back to All Magic">
                ×
              </button>
            </div>
          )}

          {/* The two active slots and how many of *this printing* each holds.
              The target is marked, so it is visible which one ± drives without
              needing separate text saying so. */}
          {slots.length > 0 ? (
            <div className="slots">
              {slots.map((slot) => {
                const isTarget =
                  slot.kind === target?.kind && slot.id === target?.id;
                return (
                  <div
                    key={`${slot.kind}-${slot.id}`}
                    className={`slot-row ${isTarget ? "target" : ""}`}
                    onClick={() => !isTarget && onTargetSlot(slot)}
                    title={
                      isTarget
                        ? `± changes this — ${slot.name}`
                        : `Click to point ± at ${slot.name}`
                    }
                  >
                    <span
                      className={`slot-count ${slot.count ? "owned" : ""}`}
                      title={
                        slot.total > slot.count
                          ? `${slot.count} of this printing, ${slot.total} across all printings`
                          : `${slot.count} of this printing`
                      }
                    >
                      {slot.count}×
                      {/* Adjacent and parenthesised so it reads as part-of-whole.
                          Shown only when other printings exist, so the common
                          case stays a single uncluttered number. */}
                      {slot.total > slot.count && (
                        <span className="slot-total"> ({slot.total})</span>
                      )}
                    </span>
                    <span className="slot-name">{slot.name}</span>
                    <span className="slot-kind">{slot.kind}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="hint">
              Open a deck or collection to add cards to it.
            </div>
          )}

        </div>

        {/* The image is the carousel viewport: stepping changes the printing
            and everything printing-level below follows it. */}
        <div className="carousel">
          <CardImage
            key={shown.id}
            card={shown}
            size="normal"
            face={face}
            className="art"
          />

          {/* Only for cards that actually have a second image. Split and
              aftermath cards keep both halves on one image and get no button. */}
          {hasBack(shown) && (
            <button
              className="flip"
              onClick={() => setFace((f) => (f === "front" ? "back" : "front"))}
              title={face === "front" ? "Show back face" : "Show front face"}
            >
              ⟳
            </button>
          )}

          {/* Controls overlay the art rather than sitting above it, matching the
              wall tiles. Hover-only, and bottom-centre so they clear the
              carousel arrows at the left and right edges. */}
          <div className="art-controls">
            <span className="printing-qty">
              <button
                onClick={() => onAdjustTarget(shown, -1)}
                disabled={!target || inTarget === 0}
                title={target ? `Remove one from ${target.name}` : "Nothing targeted"}
              >
                −
              </button>
              <span className={inTarget ? "owned" : ""}>{inTarget}</span>
              <button
                onClick={() => onAdjustTarget(shown, 1)}
                disabled={!target}
                title={target ? `Add one to ${target.name}` : "Nothing targeted"}
              >
                +
              </button>
            </span>

            {onSetCommander && (
              <button
                className="art-commander"
                onClick={() => onSetCommander(shown)}
                title={`Make this ${target?.name ?? "the deck"}'s commander`}
              >
                ★
              </button>
            )}
          </div>

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

        </div>

        <div className="carousel-controls">
          <select
            value={shown.id}
            onChange={(e) => {
              const picked = visible.find((p) => p.id === e.target.value);
              if (picked) choosePrinting(picked);
            }}
            disabled={visible.length === 0}
            title="Jump to a printing"
          >
            {visible.map((printing) => (
              <option key={printing.id} value={printing.id}>
                {printingLabel(printing)}
                {filterQty[printing.id] ? ` — ${filterQty[printing.id]}×` : ""}
              </option>
            ))}
          </select>

          <span className="hint">
            {visible.length > 1
              ? `${index === -1 ? 1 : index + 1}/${visible.length}`
              : ""}
          </span>

          <select
            value={printingFilter}
            onChange={(e) =>
              setPrintingFilter(e.target.value as typeof printingFilter)
            }
            title="Which printings to step through"
          >
            <option value="all">All printings</option>
            {/* Only offered when there is something to narrow to. */}
            {activeDeck && deckTotal > 0 && (
              <option value="deck">In {activeDeck.name}</option>
            )}
            {activeCollection && collectionTotal > 0 && (
              <option value="collection">In {activeCollection.name}</option>
            )}
          </select>
        </div>

        {printingsError && (
          <div className="status error" style={{ borderBottom: "none" }}>
            Could not load printings: {printingsError}
          </div>
        )}

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

        </dl>
      </div>
    </aside>
  );
}
