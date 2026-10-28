import { useEffect, useState } from "react";
import {
  checklistContents,
  deckContents,
  placeContents,
  type AssetNode,
  type HeldBucket,
  type Tile,
} from "../lib/assets";
import { cardStore, execute, select } from "../lib/db";
import type { Card } from "../lib/types";
import { CardImage } from "./CardImage";

/** Tiles a section shows at first, and adds per "Show more": as the pool pages. */
const PAGE = 175;

const ZONE_LABEL: Record<string, string> = { commander: "Commander", main: "Main", side: "Sideboard" };

interface Section {
  /** Absent for a place or checklist: one section, no heading. */
  zone?: string;
  /** Where a zone's cards live, when it is not the owner's own child. */
  elsewhere?: string;
  /** The zone names nothing that exists. */
  broken?: boolean;
  tiles: Tile[];
}

/** A checklist line's bounds, as a badge says them. */
function bounds(t: Tile): string {
  if (t.max === undefined) return `${t.count}×`;
  if (t.max === null) return t.count ? `≥${t.count}` : "any";
  return t.count === t.max ? `${t.count}×` : `${t.count}–${t.max}`;
}

/** What a tile knows about its copies, one line per bucket. */
function describe(b: HeldBucket): string {
  const printing = b.printing ? `${b.printing.set.toUpperCase()} ${b.printing.number}` : "printing not recorded";
  const attrs = Object.entries(b.attrs).map(([k, v]) => `${k} ${String(v)}`);
  return [`${b.qty}× ${printing}`, b.finish, ...attrs].filter(Boolean).join(" · ");
}

/**
 * A place, checklist, decklist or deck of the new model, in the lab:
 * read-only, one tile per card (every copy of every printing counted
 * together). A decklist's zones show their checklists, a deck's their places.
 * Data comes from `lab.db` and the card store, so opening one makes no
 * requests but for images not yet on disk, paged as the pool pages them.
 */
export function AssetView({
  node,
  selectedId,
  onSelect,
  onHoverCard,
}: {
  node: AssetNode;
  selectedId: string | null;
  onSelect: (card: Card) => void;
  onHoverCard?: (card: Card | null) => void;
}) {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<string, number>>({});

  useEffect(() => {
    let live = true;
    setSections(null);
    setError(null);
    setShown({});
    (async () => {
      const lab = { select, execute };
      const store = await cardStore();
      if (node.type === "place") return [{ tiles: await placeContents(lab, store, node.id) }];
      if (node.type === "checklist") return [{ tiles: await checklistContents(lab, store, node.id) }];
      const own = node.path.join("/");
      return (await deckContents(lab, store, node.id)).map((z) => {
        const at = z.target?.path.join("/");
        return {
          zone: z.zone,
          broken: !z.target,
          ...(at !== undefined && at !== `${own}/${z.zone}` && { elsewhere: `/${at}` }),
          tiles: z.tiles,
        };
      });
    })()
      .then((s) => live && setSections(s))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
    // The path as text: a reloaded tree hands over new arrays for the same path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, node.type, node.path.join("/")]);

  const all = sections?.flatMap((s) => s.tiles) ?? [];
  const copies = all.reduce((n, t) => n + t.count, 0);
  const standIns = all.filter((t) => t.standIn).length;
  const isChecklist = node.type === "checklist" || node.type === "decklist";

  return (
    <div className="pool asset-view">
      <div className="toolbar">
        <h1>{node.name}</h1>
        <span className="asset-view-path">
          /{node.path.join("/")} · {node.type}
        </span>
      </div>

      {sections && (
        <div className="stats">
          <div className="stat">
            <span className="label">Cards</span>
            <span className="value">{all.length}</span>
          </div>
          <div className="stat">
            <span className="label">{isChecklist ? "Asks for" : "Copies"}</span>
            <span className="value">{copies}</span>
          </div>
          {standIns > 0 && (
            <div className="stat" title="Cards whose printing was not recorded: the image is Scryfall's pick">
              <span className="label">Stand-ins</span>
              <span className="value">{standIns}</span>
            </div>
          )}
        </div>
      )}

      {error && <div className="status error">{error}</div>}

      <div className="scroll">
        {!sections && !error && <div className="empty">Loading…</div>}
        {sections?.length === 0 && <div className="empty">No zones.</div>}
        {sections?.map((s) => {
          const key = s.zone ?? "";
          const limit = shown[key] ?? PAGE;
          return (
            <section key={key} className="asset-section">
              {s.zone && (
                <h2 className="asset-zone">
                  {ZONE_LABEL[s.zone] ?? s.zone}
                  <span className="asset-zone-count">{s.tiles.reduce((n, t) => n + t.count, 0)}</span>
                  {s.elsewhere && <span className="asset-zone-where">{s.elsewhere}</span>}
                  {s.broken && <span className="asset-zone-where missing">names nothing</span>}
                </h2>
              )}
              {s.tiles.length === 0 && !s.broken && <div className="empty">Empty.</div>}
              <div className="card-grid">
                {s.tiles.slice(0, limit).map((t) => (
                  <div
                    key={t.oracleId}
                    className={["card-tile", selectedId === t.card.id && "selected", t.standIn && "stand-in"]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => onSelect(t.card)}
                    onMouseEnter={() => onHoverCard?.(t.card)}
                    onMouseLeave={() => onHoverCard?.(null)}
                    title={[
                      t.card.name,
                      ...t.buckets.map(describe),
                      t.standIn && "Shown as Scryfall's pick: no printing recorded",
                    ]
                      .filter(Boolean)
                      .join("\n")}
                  >
                    <CardImage card={t.card} size="small" />
                    <span className="qty-badge">{bounds(t)}</span>
                    {t.standIn && <span className="stand-in-badge">stand-in</span>}
                  </div>
                ))}
              </div>
              {s.tiles.length > limit && (
                <div style={{ padding: "12px 0", textAlign: "center" }}>
                  <button onClick={() => setShown((m) => ({ ...m, [key]: limit + PAGE }))}>
                    Show more ({s.tiles.length - limit})
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
