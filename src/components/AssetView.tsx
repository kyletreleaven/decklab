import { ask } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  builtContents,
  deckContents,
  deckList,
  bucketKey,
  lineContents,
  memberContents,
  sumContents,
  changePrintings,
  decklistCards,
  stepTarget,
  suggestPrintingsOf,
  type PrintingChange,
  type AssetNode,
  type Bucket,
  type BuiltZone,
  type ZoneContents,
  type DeckList,
  type HeldBucket,
  type Tile,
  type TileGrain,
} from "../lib/assets";
import { QueryError } from "../lib/collections";
import { countActiveFilters, toScryfallQuery, type CardFilter } from "../lib/filters";
import { useRetained } from "../lib/panelState";
import { CardFilters } from "./CardFilters";
import type { Behind } from "./PoolPanel";
import { cardStore, execute, select } from "../lib/db";
import { isA, type AssetType } from "../lib/ontology";
import type { Card } from "../lib/types";
import { CATEGORY_ORDER, categoryOf } from "../lib/deckstats";
import { CardImage } from "./CardImage";
import { PullSheet } from "./PullSheet";
import { plainestPrintings } from "../lib/printings";
import { printingsInSet } from "../lib/scryfall";
import { LAB_CHANGED } from "../api/bridge";

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
  source?: { id: string; type: AssetType; name: string };
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
  const what = [member ? printing : `${b.qty}× ${printing}`, b.finish, ...attrs]
    .filter(Boolean)
    .join(" · ");
  return b.place ? `${b.place.name}: ${what}` : what;
}

/**
 * All Magic behind a collection drawn as one wall: a place or a sum. A
 * deck is a sum too, but drawn by zones, which wait (TODO). A pool shows
 * itself: All Magic with the pool targeted already marks its members.
 */
const behindable = (type: AssetType) => isA(type, "collection") && type !== "deck";

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

/**
 * A checklist is only ever a destination, never a source: in its own view —
 * a decklist's zones too — `−`/`+` ask for one fewer or one more of the
 * line, whatever the target is. Every open view reads again after.
 */
export function selfTarget(
  checklist: { id: string; type: AssetType; name: string },
  countOf: (bucket: Bucket) => number,
): LabTarget {
  return {
    ...checklist,
    countOf,
    step: (bucket, delta) =>
      void stepTarget({ select, execute }, checklist, bucket, delta).then(() => window.dispatchEvent(new Event(LAB_CHANGED))),
    move: () => {},
  };
}

/** A goal: what is asked for, drawn but never drawn from. */
export const isGoal = (type: AssetType) => isA(type, "checklist");

/** The one bucket a tile stands for, whole; none when it covers several. */
function bucketOf(t: Tile): Bucket | null {
  if (t.buckets.length !== 1) return null;
  const b = t.buckets[0];
  return {
    oracleId: t.oracleId,
    ...(b.printingId && { printingId: b.printingId }),
    ...(b.finish && { finish: b.finish }),
    attrs: b.attrs,
    ...(b.shownId && { shownId: b.shownId }),
  };
}

/**
 * A tile's buttons, which the target's type decides: a list pool takes the
 * bucket in or out (`+`, `×`); a checklist or place counts it (`−`, `+`);
 * and a place, from another place, takes a copy from it (`→`, `←`). A tile
 * covering several buckets cannot say which: greyed, until one is chosen.
 * In a sum, the one bucket's place is the source: copies are only in places.
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
  const place = tile.buckets.length === 1 ? tile.buckets[0].place : undefined;
  return (
    <BucketButtons
      bucket={bucketOf(tile)}
      several={tile.buckets.length}
      source={place ? { id: place.id, type: "place" } : source}
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
      {/* Its own count is already on the tile or row. */}
      {target.type !== "list pool" && target.id !== source.id && bucket && (
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
  behindShown = false,
  onBehind,
  renderBehind,
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
  /**
   * A tile chosen: which asset's lines it is, for the detail's buckets —
   * or, `missing` from a deck's zone, the zone to fill.
   */
  onSelectLines?: (source: { id: string; type: AssetType }, oracleId: string, missing: boolean) => void;
  /** All Magic drawn behind the asset, dimmed: a place, checklist or pool. */
  behindShown?: boolean;
  onBehind?: (on: boolean) => void;
  /** The pool panel, drawing All Magic with the asset in front. */
  renderBehind?: (behind: Behind) => ReactNode;
  /** Bumped by an edit to the target — here or in All Magic — to read again. */
  refreshKey?: number;
}) {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [list, setList] = useState<DeckList | null>(null);
  // Bumped by an edit made here, to read the asset again.
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  // A deck whose decklist no longer exists: drawn from its places instead.
  const [lost, setLost] = useState(false);
  const [shown, setShown] = useState<Record<string, number>>({});
  // The search, kept as the pool panel keeps its own, under the same key: it
  // carries over when All Magic is drawn behind.
  const stateKey = `asset:${node.id}`;
  const [filter, setFilter] = useRetained<CardFilter>(stateKey, "filter", {});
  const [showFilters, setShowFilters] = useRetained(stateKey, "showFilters", false);
  const activeFilters = countActiveFilters(filter);
  const query = toScryfallQuery(filter).trim();
  // Half-typed: said, and the last answer kept.
  const [queryError, setQueryError] = useState<string | null>(null);
  const [front, setFront] = useState<Record<"cards" | "printings", Tile[]> | null>(null);

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
            tiles: await lineContents(lab, store, node.id, {
              by: node.type === "place" ? "card" : "line",
              query,
            }),
            atLeast: node.type === "checklist",
            source: { id: node.id, type: node.type, name: node.name },
          },
        ];
      if (node.type === "sum")
        return [
          {
            tiles: await sumContents(lab, store, node.id, { query }),
            source: { id: node.id, type: node.type, name: node.name },
          },
        ];
      if (node.type === "list pool")
        return [
          {
            tiles: await memberContents(lab, store, node.id, { query }),
            members: true,
            source: { id: node.id, type: node.type, name: node.name },
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
          ...(z.target && { source: { id: z.target.id, type: z.target.type, name: z.target.path[z.target.path.length - 1] ?? z.zone } }),
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
        setQueryError(null);
      })
      .catch((e) => {
        if (!live) return;
        if (e instanceof QueryError) setQueryError(e.message);
        else setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
    // The path as text: a reloaded tree hands over new arrays for the same path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, node.type, node.path.join("/"), version, refreshKey, query]);

  // In front of All Magic: the asset's tiles at each grain, unsearched — the
  // search goes to Scryfall, and a tile shows where its card turns up.
  useEffect(() => {
    if (!behindShown || !behindable(node.type)) return setFront(null);
    let live = true;
    (async () => {
      const lab = { select, execute };
      const store = await cardStore();
      const at = (by: TileGrain) =>
        node.type === "sum"
          ? sumContents(lab, store, node.id, { by })
          : lineContents(lab, store, node.id, { by });
      const [cards, printings] = await Promise.all([at("card"), at("printing")]);
      if (live) setFront({ cards, printings });
    })().catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [node.id, node.type, behindShown, version, refreshKey]);

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

  /** One tile: on the asset's own wall, or in All Magic's place in front of it. */
  const drawTile = (t: Tile, s: Section) => (
    <div
      key={`${t.oracleId}:${t.buckets.length === 1 ? bucketKey(bucketOf(t)!) : ""}:${t.state ?? ""}`}
      className={[
        "card-tile",
        selectedId === t.card.id && "selected",
        t.standIn && "stand-in",
        t.state === "missing" && "dim",
        t.state === "missing" && "lacking",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => {
        onSelect(t.card);
        if (s.source) onSelectLines?.(s.source, t.oracleId, t.state === "missing");
      }}
      onMouseEnter={() => onHoverCard?.(t.card)}
      onMouseLeave={() => onHoverCard?.(null)}
      title={[
        t.card.name,
        t.state === "missing" && `${t.count} on the list, not in this deck`,
        t.state === "extra" && `${t.count} in this deck, not on the list`,
        ...(t.state === "missing"
          ? []
          : t.buckets.map((b) => describe(b, s.members))),
        t.standIn && "Shown as Scryfall's pick: no printing recorded",
      ]
        .filter(Boolean)
        .join("\n")}
    >
      <CardImage card={t.card} size="small" />
      {!s.members && (
        <span className="qty-badge">{bounds(t, s.atLeast)}</span>
      )}
      {s.source && isGoal(s.source.type) ? (
        // A checklist's own view edits it, whatever the target.
        <TileControls tile={t} source={s.source} target={selfTarget(s.source, () => t.count)} />
      ) : (
        target && s.source && t.state !== "missing" && <TileControls tile={t} source={s.source} target={target} />
      )}
      {t.standIn && <span className="stand-in-badge">stand-in</span>}
    </div>
  );

  // A place, checklist or pool: one wall of its own lines, which a search
  // narrows locally and All Magic can be drawn behind.
  const flat =
    node.type === "place" ||
    node.type === "sum" ||
    node.type === "checklist" ||
    node.type === "exact checklist" ||
    node.type === "list pool";
  // The asset's tiles in front of All Magic, as a section says how to draw them.
  const frontSection: Section = {
    source: { id: node.id, type: node.type, name: node.name },
    atLeast: node.type === "checklist",
    members: node.type === "list pool",
    tiles: [],
  };
  const canBehind = behindable(node.type);
  const behindNow = canBehind && behindShown && !!renderBehind;

  const header = (
    <div className="toolbar">
      <h1>{node.name}</h1>
        <span className="asset-view-path">
          {/* One kind to the eye: the toggle says whether it is exact. */}/
          {node.path.join("/")} ·{" "}
          {node.type === "exact checklist"
            ? "checklist"
            : node.type === "sum"
              ? "collection"
              : node.type}
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
        {node.type === "decklist" && (
          <PrintingsMenu
            node={node}
            onChanged={() => setVersion((v) => v + 1)}
            onError={setError}
          />
        )}
        {node.type === "deck" && list && (
          <button className="ghost" title="Pull what the deck lacks from a collection" onClick={() => setPulling(true)}>
            Pull…
          </button>
        )}
        {pulling && (
          <PullSheet deck={node} onClose={() => setPulling(false)} onChanged={() => setVersion((v) => v + 1)} />
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
  );

  if (behindNow && front)
    return (
      <div className="pool asset-view">
        {header}
        {renderBehind!({
          name: node.name,
          present: new Set(front.cards.map((t) => t.oracleId)),
          tilesAt: (grain) => {
            const m = new Map<string, ReactNode[]>();
            for (const t of front[grain]) {
              const k =
                grain === "cards"
                  ? t.oracleId
                  : `${t.oracleId}|${t.buckets[0]?.printingId ?? ""}`;
              m.set(k, [...(m.get(k) ?? []), drawTile(t, frontSection)]);
            }
            return m;
          },
          onHide: () => onBehind?.(false),
        })}
      </div>
    );

  return (
    <div className="pool asset-view">
      {header}

      {flat && (
        <>
          <div className="toolbar">
            <input
              className="search-input"
              placeholder={`Search ${node.name} — t:creature c:r mv<=3`}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              value={filter.query ?? ""}
              onChange={(e) => setFilter({ ...filter, query: e.target.value })}
            />
            <button
              className={showFilters || activeFilters ? "primary" : ""}
              onClick={() => setShowFilters((v) => !v)}
              title="Extra constraints, combined with whatever you have searched for"
            >
              More filters{activeFilters ? ` (${activeFilters})` : ""}
            </button>
            {canBehind && onBehind && renderBehind && (
              <label
                className="toggle"
                title={`Also draw All Magic, dimmed, around ${node.name}: paged from Scryfall as All Magic is`}
              >
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => onBehind(true)}
                />
                Show not in {node.name}
              </label>
            )}
          </div>
          {showFilters && <CardFilters filter={filter} onChange={setFilter} />}
          {queryError && <div className="status error">{queryError}</div>}
        </>
      )}

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
                    {g.tiles.map((t) => drawTile(t, s))}
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

/** What each of the *Printings* menu's changes says, before and after. */
const PRINTING_CHANGES: Record<PrintingChange, { label: string; ask: (name: string) => string }> = {
  bind: {
    label: "Bind",
    ask: (n) => `Bind every suggested printing in “${n}”? The deck then asks for exactly those printings.`,
  },
  unbind: {
    label: "Unbind",
    ask: (n) => `Unbind every printing in “${n}”? Each stays as the art shown, but any printing will do.`,
  },
  drop: {
    label: "Drop",
    ask: (n) => `Drop every printing in “${n}”, bound or suggested? Any printing will do, and Scryfall's is shown.`,
  },
};

/**
 * A decklist's printings, all at once, across its own zones
 * (docs/inventory/buckets.md → *Suggested printings*): bind, unbind or drop
 * them, or suggest each card's printing from a set. Each asks first, since
 * none can be undone.
 */
function PrintingsMenu({
  node,
  onChanged,
  onError,
}: {
  node: AssetNode;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [askingSet, setAskingSet] = useState(false);
  const [set, setSet] = useState("");
  const [busy, setBusy] = useState(false);
  const lab = { select, execute };
  const run = async (work: () => Promise<number>) => {
    setBusy(true);
    try {
      const n = await work();
      onChanged();
      return n;
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const change = async (c: PrintingChange) => {
    const yes = await ask(`${PRINTING_CHANGES[c].ask(node.name)} This cannot be undone.`, {
      title: `${PRINTING_CHANGES[c].label} printings`,
      kind: "warning",
      okLabel: PRINTING_CHANGES[c].label,
      cancelLabel: "Cancel",
    });
    if (yes) await run(() => changePrintings(lab, node.id, c));
  };
  const fromSet = async () => {
    const code = set.trim();
    if (!code) return;
    const store = await cardStore();
    const cards = await decklistCards(lab, store, node.id);
    let picks: Map<string, string> | null = null;
    await run(async () => {
      const wanted = new Set(cards.map((c) => c.oracleId));
      picks = new Map([...plainestPrintings(await printingsInSet(code))].filter(([o]) => wanted.has(o)));
      return 0;
    });
    if (!picks) return;
    const found: Map<string, string> = picks;
    const yes = await ask(
      `${code.toUpperCase()} has ${found.size} of the ${cards.length} cards in “${node.name}”. Suggest its printing for each, on every line not bound? This cannot be undone.`,
      { title: "Suggest from set", kind: "warning", okLabel: "Suggest", cancelLabel: "Cancel" },
    );
    if (!yes) return;
    if ((await run(() => suggestPrintingsOf(lab, node.id, found))) !== null) {
      setAskingSet(false);
      setSet("");
    }
  };

  return (
    <span className="printings-menu">
      <select
        value=""
        disabled={busy}
        title="Change every printing in this decklist at once"
        onChange={(e) => {
          const v = e.target.value;
          if (v === "set") setAskingSet(true);
          else if (v) void change(v as PrintingChange);
        }}
      >
        <option value="">Printings…</option>
        {(Object.keys(PRINTING_CHANGES) as PrintingChange[]).map((c) => (
          <option key={c} value={c}>
            {PRINTING_CHANGES[c].label}
          </option>
        ))}
        <option value="set">Suggest from set…</option>
      </select>
      {askingSet && (
        <form
          className="printings-set"
          onSubmit={(e) => {
            e.preventDefault();
            void fromSet();
          }}
        >
          <input
            autoFocus
            value={set}
            placeholder="Set code, e.g. C21"
            size={14}
            disabled={busy}
            onChange={(e) => setSet(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAskingSet(false)}
          />
          <button type="submit" disabled={busy || !set.trim()}>
            {busy ? "Fetching…" : "Suggest"}
          </button>
          <button type="button" className="ghost" onClick={() => setAskingSet(false)}>
            Cancel
          </button>
        </form>
      )}
    </span>
  );
}
