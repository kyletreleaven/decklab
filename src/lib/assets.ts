import { rowToCard, type CardRow } from "./db";
import { parseRef, pathKey } from "./paths";
import type { Sql } from "./sql";
import { scryfallLayer, standIns, type Layer } from "./standIn";
import type { Card } from "./types";
import type { AssetType } from "./ontology";

/**
 * Reading the new model's tables (`src-tauri/migrations/lab/1000_assets.sql`)
 * for display, in the lab. Read-only.
 *
 * Takes the lab database and the card store: lines name cards by id only, and
 * what a card is comes from the store, at any age — so showing the lab makes
 * no requests, except images.
 */

export interface AssetNode {
  id: string;
  name: string;
  type: AssetType;
  path: string[];
  children: AssetNode[];
}

/** The asset tree, below the root, siblings in order. */
export async function assetTree(lab: Sql): Promise<AssetNode[]> {
  const rows = await lab.select<{ id: string; parent_id: string | null; name: string; type: AssetType }>(
    "SELECT id, parent_id, name, type FROM assets WHERE id <> 'root' ORDER BY position, name",
  );
  const byParent = new Map<string, typeof rows>();
  for (const r of rows) byParent.set(r.parent_id!, [...(byParent.get(r.parent_id!) ?? []), r]);
  const build = (parent: string, path: string[]): AssetNode[] =>
    (byParent.get(parent) ?? []).map((r) => {
      const p = [...path, r.name];
      return { id: r.id, name: r.name, type: r.type, path: p, children: build(r.id, p) };
    });
  return build("root", []);
}

/** One copy-holding bucket, as the detail lists it. */
export interface HeldBucket {
  /** Absent when the printing was not recorded. */
  printingId?: string;
  finish?: string;
  attrs: Record<string, unknown>;
  qty: number;
}

/**
 * One card in a place or zone, at oracle grain: every copy, whatever its
 * printing, counted together (bug 002).
 */
export interface Tile {
  oracleId: string;
  /** The printing drawn. */
  card: Card;
  /** True when no bucket names a printing, so `card` is a stand-in. */
  standIn: boolean;
  /** Copies, all buckets together; for a checklist, its minimum. */
  count: number;
  /** A checklist's maximum: null for no limit, undefined outside checklists. */
  max?: number | null;
  buckets: HeldBucket[];
}

interface LineRow {
  oracle_id: string;
  printing_id: string;
  finish: string;
  attrs: string;
  qty: number;
  max_qty?: number | null;
}

/**
 * Lines as tiles, sorted by name. A tile draws the printing it holds most
 * copies of; one whose buckets name no printing draws the stand-in.
 */
async function tiles(store: Sql, lines: LineRow[], layers: Layer[]): Promise<Tile[]> {
  const byOracle = new Map<string, LineRow[]>();
  for (const l of lines) byOracle.set(l.oracle_id, [...(byOracle.get(l.oracle_id) ?? []), l]);

  const drawn = new Map<string, { id: string; standIn: boolean }>();
  const unprinted: string[] = [];
  for (const [oracle, ls] of byOracle) {
    const perPrinting = new Map<string, number>();
    for (const l of ls) if (l.printing_id !== "") perPrinting.set(l.printing_id, (perPrinting.get(l.printing_id) ?? 0) + l.qty);
    const most = [...perPrinting].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    if (most) drawn.set(oracle, { id: most[0], standIn: false });
    else unprinted.push(oracle);
  }
  for (const [oracle, id] of await standIns(layers, unprinted)) drawn.set(oracle, { id, standIn: true });

  const ids = [...new Set([...drawn.values()].map((d) => d.id))];
  const cards = new Map<string, Card>();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const rows = await store.select<CardRow>(
      `SELECT * FROM cards WHERE id IN (${chunk.map((_, j) => `$${j + 1}`).join(", ")})`,
      chunk,
    );
    for (const r of rows) cards.set(r.id, rowToCard(r));
  }

  const out: Tile[] = [];
  for (const [oracle, ls] of byOracle) {
    const d = drawn.get(oracle);
    const card = d && cards.get(d.id);
    if (!d || !card) continue; // not in the store: the load would have refused it
    const tile: Tile = {
      oracleId: oracle,
      card,
      standIn: d.standIn,
      count: ls.reduce((n, l) => n + l.qty, 0),
      buckets: ls.map((l) => ({
        ...(l.printing_id !== "" && { printingId: l.printing_id }),
        ...(l.finish !== "" && { finish: l.finish }),
        attrs: JSON.parse(l.attrs) as Record<string, unknown>,
        qty: l.qty,
      })),
    };
    if (ls[0].max_qty !== undefined) {
      tile.max = ls.some((l) => l.max_qty === null) ? null : ls.reduce((n, l) => n + (l.max_qty ?? 0), 0);
    }
    out.push(tile);
  }
  return out.sort((a, b) => a.card.name.localeCompare(b.card.name));
}

/** What a place holds, one tile per card. */
export async function placeContents(lab: Sql, store: Sql, placeId: string, layers = [scryfallLayer(store)]): Promise<Tile[]> {
  const lines = await lab.select<LineRow>(
    "SELECT oracle_id, printing_id, finish, attrs, qty FROM place_lines WHERE asset_id = $1",
    [placeId],
  );
  return tiles(store, lines, layers);
}

/** What a checklist asks for, one tile per card; `count` is its minimum. */
export async function checklistContents(lab: Sql, store: Sql, id: string, layers = [scryfallLayer(store)]): Promise<Tile[]> {
  const lines = await lab.select<LineRow>(
    "SELECT oracle_id, printing_id, finish, attrs, min_qty AS qty, max_qty FROM checklist_lines WHERE asset_id = $1",
    [id],
  );
  return tiles(store, lines, layers);
}

export interface ZoneContents {
  zone: string;
  /** The checklist the zone names; absent when the reference is broken. */
  target?: { id: string; path: string[] };
  tiles: Tile[];
}

/**
 * A deck, zone by zone. A zone's reference is followed to its checklist:
 * pinned by id, or by name through the tree.
 */
export async function deckContents(lab: Sql, store: Sql, deckId: string, layers = [scryfallLayer(store)]): Promise<ZoneContents[]> {
  const tree = await assetTree(lab);
  const byPath = new Map<string, AssetNode>();
  const byId = new Map<string, AssetNode>();
  const index = (nodes: AssetNode[]) => {
    for (const n of nodes) {
      byPath.set(pathKey(n.path), n);
      byId.set(n.id, n);
      index(n.children);
    }
  };
  index(tree);
  const deck = byId.get(deckId);
  if (!deck) return [];

  const refs = await lab.select<{ role: string; target_id: string | null; path: string | null; rooted: number }>(
    "SELECT role, target_id, path, rooted FROM asset_refs WHERE asset_id = $1 AND role IN ('commander', 'main', 'side')",
    [deckId],
  );
  const out: ZoneContents[] = [];
  for (const zone of ["commander", "main", "side"]) {
    const r = refs.find((x) => x.role === zone);
    if (!r) continue;
    let target: AssetNode | undefined;
    if (r.target_id !== null) target = byId.get(r.target_id);
    else if (r.path !== null) {
      const names = r.path === "" ? [] : parseRef(r.path).names;
      target = byPath.get(pathKey(r.rooted ? names : [...deck.path, ...names]));
    }
    out.push({
      zone,
      ...(target && { target: { id: target.id, path: target.path } }),
      tiles: target ? await checklistContents(lab, store, target.id, layers) : [],
    });
  }
  return out;
}
