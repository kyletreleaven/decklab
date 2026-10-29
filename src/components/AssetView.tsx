import { useEffect, useRef, useState } from "react";
import {
  builtContents,
  deckContents,
  deckList,
  bucketKey,
  lineContents,
  memberContents,
  type AssetNode,
  type Bucket,
  type BuiltZone,
  type ZoneContents,
  type DeckList,
  type HeldBucket,
  type Tile,
} from "../lib/assets";
import { cardStore, execute, select } from "../lib/db";
import type { AssetType } from "../lib/ontology";
import type { Card } from "../lib/types";
import { CATEGORY_ORDER, categoryOf } from "../lib/deckstats";
import { CardImage } from "./CardImage";

/** Tiles a section shows at first, and adds per "Show more": as the pool pages. */
const PAGE = 175;

const ZONE_LABEL: Record<string, string> = {
  commander: "Commander",
  main: "Main",
  side: "Sideboard",
};

interface Section {
  /** Absent for a place or checklist: one section, no heading. */
  zone?: string;
  /** Where a zone's cards live, when it is not the owner's own child. */
  elsewhere?: string;
  /** The zone names nothing that exists. */
  broken?: boolean;
  /**
   * A deck drawn as its decklist: copies the zone asks for, and holds of
   * them; `exact` when the zone allows nothing more.
   */
  built?: { asked: number; held: number; exact: boolean };
  /** The counts are minimums: a checklist's, not exact. */
  atLeast?: boolean;
  /** A pool's members: membership, no counts. */
  members?: boolean;
  /** The asset its tiles are lines of — the view's own, or a zone's — as a source for the target. */
  source?: { id: string; type: AssetType };
  tiles: Tile[];
}

/** A line's count, as a badge says it. */
function bounds(t: Tile, atLeast: boolean | undefined): string {
  return atLeast && !t.state ? `≥${t.count}` : `${t.count}×`;
}

/**
 * A section's first `limit` tiles, as the view draws them: a decklist's or
 * deck's main zone by card type, in the order a decklist reads, each by name
 * within; anything else as one run. A deck's extras — held, not asked for —
 * come last, as their own group.
 */
function groups(
  s: Section,
  limit: number,
): { category?: string; count: number; tiles: Tile[] }[] {
  const listed = s.tiles.filter((t) => t.state !== "extra");
  const extra = s.tiles.filter((t) => t.state === "extra");
  const by = new Map<string, Tile[]>();
  if (s.zone === "main") {
    for (const t of listed) {
      const c = categoryOf(t.card);
      by.set(c, [...(by.get(c) ?? []), t]);
    }
  } else if (listed.length) by.set("", listed);
  if (extra.length) by.set("Extra", extra);
  let left = limit;
  const out: { category?: string; count: number; tiles: Tile[] }[] = [];
  for (const category of ["", ...CATEGORY_ORDER, "Extra"]) {
    const tiles = by.get(category);
    if (!tiles || left <= 0) continue;
    out.push({
      ...(category && { category }),
      count: tiles.reduce((n, t) => n + t.count, 0),
      tiles: tiles.slice(0, left),
    });
    left -= tiles.length;
  }
  return out;
}

/**
 * What a tile knows about its copies, one line per bucket. A pool's member
 * has no count, and no printing means any.
 */
function describe(b: HeldBucket, member = false): string {
  const printing = b.printing
    ? `${b.printing.set.toUpperCase()} ${b.printing.number}`
    : member
      ? "any printing"
      : "printing not recorded";
  const attrs = Object.entries(b.attrs).map(([k, v]) => `${k} ${String(v)}`);
  return [member ? printing : `${b.qty}× ${printing}`, b.finish, ...attrs]
    .filter(Boolean)
    .join(" · ");
}

/** The lab's target, as a view's buttons act on it (App holds it). */
export interface LabTarget {
  id: string;
  name: string;
  type: AssetType;
  /** What it holds of a bucket: a member counts 1. */
  countOf: (bucket: Bucket) => number;
  /** One more or one fewer, as its type takes it. */
  step: (bucket: Bucket, delta: 1 | -1) => void;
  /** One copy between places: `to` the target from `fromId`, or back. */
  move: (fromId: string, bucket: Bucket, dir: "to" | "back") => void;
}

/** The one bucket a tile stands for, whole; none when it covers several. */
function bucketOf(t: Tile): Bucket | null {
  if (t.buckets.length !== 1) return null;
  const b = t.buckets[0];
  return {
    oracleId: t.oracleId,
    ...(b.printingId && { printingId: b.printingId }),
    ...(b.finish && { finish: b.finish }),
    attrs: b.attrs,
  };
}

/**
 * A tile's buttons, which the target's type decides: a list pool takes the
 * bucket in or out (`+`, `×`); a checklist or place counts it (`−`, `+`);
 * and a place, from another place, takes a copy from it (`→`, `←`). A tile
 * covering several buckets cannot say which: greyed, until one is chosen.
 */
function TileControls({
  tile,
  source,
  target,
}: {
  tile: Tile;
  source: { id: string; type: AssetType };
  target: LabTarget;
}) {
  return (
    <BucketButtons
      bucket={bucketOf(tile)}
      several={tile.buckets.length}
      source={source}
      target={target}
      className="tile-controls"
    />
  );
}

/**
 * The buttons for one bucket of a source, as the target's type decides —
 * on a tile, or on a bucket's row in the detail. No bucket: greyed, saying
 * the tile covers `several`.
 */
export function BucketButtons({
  bucket,
  several = 1,
  source,
  target,
  className,
}: {
  bucket: Bucket | null;
  several?: number;
  source: { id: string; type: AssetType };
  target: LabTarget;
  className: string;
}) {
  const has = bucket ? target.countOf(bucket) : 0;
  const why = bucket
    ? undefined
    : `In ${several} buckets — select the card and choose one in the detail`;
  const moving =
    source.type === "place" &&
    target.type === "place" &&
    source.id !== target.id;
  const buttons: { label: string; title: string; on: boolean; go: () => void }[] =
    moving
      ? [
          {
            label: "←",
            title: `Move one back from ${target.name}`,
            on: has > 0,
            go: () => target.move(source.id, bucket!, "back"),
          },
          {
            label: "→",
            title: `Move one to ${target.name}`,
            // The tile is one of the source's lines: there is at least one to move.
            on: true,
            go: () => target.move(source.id, bucket!, "to"),
          },
        ]
      : target.type === "list pool"
        ? [
            has
              ? {
                  label: "×",
                  title: `Remove from ${target.name}`,
                  on: true,
                  go: () => target.step(bucket!, -1),
                }
              : {
                  label: "+",
                  title: `Add to ${target.name}`,
                  on: true,
                  go: () => target.step(bucket!, 1),
                },
          ]
        : [
            {
              label: "−",
              title: `One fewer in ${target.name}`,
              on: has > 0,
              go: () => target.step(bucket!, -1),
            },
            {
              label: "+",
              title: `One more in ${target.name}`,
              on: true,
              go: () => target.step(bucket!, 1),
            },
          ];
  return (
    <span className={className} onClick={(e) => e.stopPropagation()}>
      {target.type !== "list pool" && bucket && (
        <span
          className="target-count"
          title={`${has} in ${target.name}`}
        >
          {has}
        </span>
      )}
      {buttons.map((b) => (
        // Title on the wrapper: a disabled button shows no tooltip.
        <span key={b.label} title={why ?? b.title}>
          <button disabled={!bucket || !b.on} onClick={b.go}>
            {b.label}
          </button>
        </span>
      ))}
    </span>
  );
}

/**
 * A place, checklist, decklist or deck of the new model, in the lab: one
 * tile per card (every copy of every printing counted together). A
 * decklist's zones show their checklists; a deck is drawn as the decklist it
 * builds, what it lacks dimmed. A checklist says whether it is exact, and
 * can be switched. Data comes from `lab.db` and the card store, so opening
 * one makes no requests but for images not yet on disk, paged as the pool
 * pages them.
 */
export function AssetView({
  node,
  selectedId,
  onSelect,
  onHoverCard,
  decklists = [],
  onSetList,
  onConvert,
  target,
  onSelectLines,
  refreshKey = 0,
}: {
  node: AssetNode;
  selectedId: string | null;
  onSelect: (card: Card) => void;
  onHoverCard?: (card: Card | null) => void;
  /** Every decklist in the tree, for a deck's *Builds*. */
  decklists?: AssetNode[];
  /** Points a deck at another decklist. Absent, *Builds* is read-only. */
  onSetList?: (deck: AssetNode, decklistId: string) => Promise<void>;
  /** Changes the asset's type: here, a checklist exact or not. */
  onConvert?: (node: AssetNode, to: AssetType) => Promise<void>;
  /**
   * The lab's target, which a tile's buttons act on — this view is the
   * source, and hands over the bucket a tile stands for. Absent, no buttons.
   */
  target?: LabTarget;
  /** A tile chosen: which asset's lines it is, for the detail's buckets. */
  onSelectLines?: (source: { id: string; type: AssetType }, oracleId: string) => void;
  /** Bumped by an edit to the target — here or in All Magic — to read again. */
  refreshKey?: number;
}) {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [list, setList] = useState<DeckList | null>(null);
  // Bumped by an edit made here, to read the asset again.
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // A deck whose decklist no longer exists: drawn from its places instead.
  const [lost, setLost] = useState(false);
  const [shown, setShown] = useState<Record<string, number>>({});

  // A refresh is not a reopen (bug 006): reset only when the asset changes;
  // an edit reads it again and swaps the new in over the old, keeping the
  // scroll and *Show more* where they were.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    const asset = `${node.id}:${node.type}`;
    if (opened.current !== asset) {
      opened.current = asset;
      setSections(null);
      setError(null);
      setLost(false);
      setShown({});
    }
    (async (): Promise<Section[]> => {
      const lab = { select, execute };
      const store = await cardStore();
      setList(node.type === "deck" ? await deckList(lab, node.id) : null);
      if (
        node.type === "place" ||
        node.type === "checklist" ||
        node.type === "exact checklist"
      )
        return [
          {
            // A checklist a tile per line: its lines overlap, a card's total says nothing.
            tiles: await lineContents(lab, store, node.id, { perLine: node.type !== "place" }),
            atLeast: node.type === "checklist",
            source: { id: node.id, type: node.type },
          },
        ];
      if (node.type === "list pool")
        return [
          {
            tiles: await memberContents(lab, store, node.id),
            members: true,
            source: { id: node.id, type: node.type },
          },
        ];
      // A deck is drawn as the decklist it builds, missing copies dimmed.
      const built =
        node.type === "deck" ? await builtContents(lab, store, node.id) : null;
      if (node.type === "deck") setLost(!built);
      const zones: (ZoneContents &
        Partial<Pick<BuiltZone, "asked" | "held" | "exact">>)[] =
        built ?? (await deckContents(lab, store, node.id, undefined, true));
      const own = node.path.join("/");
      return zones.map((z) => {
        const at = z.target?.path.join("/");
        return {
          zone: z.zone,
          // A deck missing a zone its decklist has: everything there is missing.
          broken: !z.target && z.asked === undefined,
          ...(z.asked !== undefined && {
            built: { asked: z.asked, held: z.held ?? 0, exact: !!z.exact },
          }),
          atLeast: z.target?.type === "checklist",
          ...(z.target && { source: { id: z.target.id, type: z.target.type } }),
          ...(at !== undefined &&
            at !== `${own}/${z.zone}` && { elsewhere: `/${at}` }),
          tiles: z.tiles,
        };
      });
    })()
      .then((s) => {
        if (!live) return;
        setSections(s);
        setError(null);
      })
      .catch(
        (e) => live && setError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      live = false;
    };
    // The path as text: a reloaded tree hands over new arrays for the same path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, node.type, node.path.join("/"), version, refreshKey]);

  const all = sections?.flatMap((s) => s.tiles) ?? [];
  const copies = all.reduce((n, t) => n + t.count, 0);
  const standIns = all.filter((t) => t.standIn).length;
  const isChecklist =
    node.type === "checklist" ||
    node.type === "exact checklist" ||
    node.type === "decklist";
  const built =
    sections?.every((s) => s.built) && sections.length > 0
      ? sections.reduce(
          (b, s) => ({
            asked: b.asked + s.built!.asked,
            held: b.held + s.built!.held,
          }),
          { asked: 0, held: 0 },
        )
      : null;

  return (
    <div className="pool asset-view">
      <div className="toolbar">
        <h1>{node.name}</h1>
        <span className="asset-view-path">
          {/* One kind to the eye: the toggle says whether it is exact. */}/
          {node.path.join("/")} ·{" "}
          {node.type === "exact checklist" ? "checklist" : node.type}
        </span>
        {(node.type === "checklist" || node.type === "exact checklist") && (
          <div
            className="segmented"
            role="radiogroup"
            aria-label="What the counts ask for"
          >
            {(
              [
                [
                  "checklist",
                  "At least",
                  "Each count is a minimum; anything else may be there too",
                ],
                [
                  "exact checklist",
                  "Exactly",
                  "Each count is exact, and nothing unlisted may be there",
                ],
              ] as const
            ).map(([type, label, title]) => (
              <button
                key={type}
                role="radio"
                aria-checked={node.type === type}
                className={node.type === type ? "on" : ""}
                disabled={!onConvert}
                title={title}
                onClick={() =>
                  node.type !== type && void onConvert?.(node, type)
                }
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {node.type === "deck" && (
          <label className="asset-builds" title="The decklist this deck builds">
            Builds
            <select
              value={list?.id ?? (list ? "by-name" : "")}
              disabled={!onSetList}
              onChange={async (e) => {
                if (e.target.value === "by-name" || e.target.value === "")
                  return;
                await onSetList?.(node, e.target.value);
                setVersion((v) => v + 1);
              }}
            >
              {!list && <option value="">(no longer exists)</option>}
              {list?.byName && (
                <option value="by-name">&amp;/{list.path.join("/")}</option>
              )}
              {decklists.map((d) => (
                <option key={d.id} value={d.id}>
                  /{d.path.join("/")}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {sections && (
        <div className="stats">
          {built && (
            <div
              className="stat"
              title="Copies the decklist asks for that this deck holds"
            >
              <span className="label">Built</span>
              <span className="value">
                {built.held} / {built.asked}
              </span>
            </div>
          )}
          {/* As the pool says them: every copy, then distinct cards — a
              decklist's 100 counts its seven Islands seven times. */}
          {node.type === "list pool" ? (
            <div
              className="stat"
              title="Members: a card with no printing, or a printing"
            >
              <span className="label">Members</span>
              <span className="value">{copies}</span>
            </div>
          ) : (
            <div
              className="stat"
              title={isChecklist ? "Copies asked for" : "Copies held"}
            >
              <span className="label">Cards</span>
              <span className="value">{copies}</span>
            </div>
          )}
          <div className="stat" title="Distinct cards">
            <span className="label">Unique</span>
            <span className="value">{all.length}</span>
          </div>
          {standIns > 0 && (
            <div
              className="stat"
              title="Cards whose printing was not recorded: the image is Scryfall's pick"
            >
              <span className="label">Stand-ins</span>
              <span className="value">{standIns}</span>
            </div>
          )}
        </div>
      )}

      {error && <div className="status error">{error}</div>}
      {lost && (
        <div className="status error">
          The decklist this deck builds no longer exists: showing what it holds.
        </div>
      )}

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
                  <span className="asset-zone-count">
                    {s.built
                      ? `${s.built.held} / ${s.built.asked}`
                      : s.tiles.reduce((n, t) => n + t.count, 0)}
                  </span>
                  {s.elsewhere && (
                    <span className="asset-zone-where">{s.elsewhere}</span>
                  )}
                  {s.broken && (
                    <span className="asset-zone-where missing">
                      names nothing
                    </span>
                  )}
                </h2>
              )}
              {s.tiles.length === 0 && !s.broken && (
                <div className="empty">Empty.</div>
              )}
              {groups(s, limit).map((g) => (
                <div key={g.category ?? ""}>
                  {g.category && (
                    <h3
                      className={`asset-category ${g.category === "Extra" && s.built?.exact ? "over" : ""}`}
                      title={
                        g.category !== "Extra"
                          ? undefined
                          : s.built?.exact
                            ? "More than this zone allows: it is exact"
                            : "More than this zone asks for: it asks for at least its counts"
                      }
                    >
                      {g.category === "Extra" && s.built?.exact
                        ? "Extra — over the list"
                        : g.category}
                      <span className="asset-zone-count">{g.count}</span>
                    </h3>
                  )}
                  <div className="card-grid">
                    {g.tiles.map((t) => (
                      <div
                        key={`${t.oracleId}:${t.buckets.length === 1 ? bucketKey(bucketOf(t)!) : ""}:${t.state ?? ""}`}
                        className={[
                          "card-tile",
                          selectedId === t.card.id && "selected",
                          t.standIn && "stand-in",
                          t.state === "missing" && "dim",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => {
                          onSelect(t.card);
                          if (s.source) onSelectLines?.(s.source, t.oracleId);
                        }}
                        onMouseEnter={() => onHoverCard?.(t.card)}
                        onMouseLeave={() => onHoverCard?.(null)}
                        title={[
                          t.card.name,
                          t.state === "missing" &&
                            `${t.count} on the list, not in this deck`,
                          t.state === "extra" &&
                            `${t.count} in this deck, not on the list`,
                          ...(t.state === "missing"
                            ? []
                            : t.buckets.map((b) => describe(b, s.members))),
                          t.standIn &&
                            "Shown as Scryfall's pick: no printing recorded",
                        ]
                          .filter(Boolean)
                          .join("\n")}
                      >
                        <CardImage card={t.card} size="small" />
                        {!s.members && (
                          <span className="qty-badge">
                            {bounds(t, s.atLeast)}
                          </span>
                        )}
                        {target && s.source && t.state !== "missing" && (
                          <TileControls
                            tile={t}
                            source={s.source}
                            target={target}
                          />
                        )}
                        {t.standIn && (
                          <span className="stand-in-badge">stand-in</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {s.tiles.length > limit && (
                <div style={{ padding: "12px 0", textAlign: "center" }}>
                  <button
                    onClick={() =>
                      setShown((m) => ({ ...m, [key]: limit + PAGE }))
                    }
                  >
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
