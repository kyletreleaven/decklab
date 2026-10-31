import { rowToCard, type CardRow } from "./db";
import { badName, parseRef, pathKey } from "./paths";
import type { Sql } from "./sql";
import { scryfallLayer, standIns, type Layer } from "./standIn";
import type { Card } from "./types";
import { isA, TYPES, type AssetType } from "./ontology";
import { QueryError } from "./collections";
import { compileQuery } from "./query";
import { filtersColumn, filtersOfColumn, searchName, type SavedFilters } from "./filters";

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
  /** The asset above it: "root" at the top. */
  parentId: string;
  /** A query pool's query. */
  query?: string;
  /** A query pool's *More filters*: with `query`, what it searches. */
  filters?: SavedFilters;
}

/** The asset tree, below the root, siblings in order. */
export async function assetTree(lab: Sql): Promise<AssetNode[]> {
  const rows = await lab.select<{ id: string; parent_id: string | null; name: string; type: AssetType; query: string | null; filters: string | null }>(
    // No order of their own: by name, as a reader expects.
    "SELECT id, parent_id, name, type, query, filters FROM assets WHERE id <> 'root' ORDER BY name COLLATE NOCASE, name",
  );
  const byParent = new Map<string, typeof rows>();
  for (const r of rows) byParent.set(r.parent_id!, [...(byParent.get(r.parent_id!) ?? []), r]);
  const build = (parent: string, path: string[]): AssetNode[] =>
    (byParent.get(parent) ?? []).map((r) => {
      const p = [...path, r.name];
      return {
        id: r.id,
        parentId: parent,
        name: r.name,
        type: r.type,
        path: p,
        children: build(r.id, p),
        ...(r.query !== null && { query: r.query }),
        ...(r.filters !== null && { filters: filtersOfColumn(r.filters) }),
      };
    });
  return build("root", []);
}

/** One copy-holding bucket, as the detail lists it. */
export interface HeldBucket {
  /** Absent when the printing was not recorded. */
  printingId?: string;
  /** Its set and collector number, for saying which printing. */
  printing?: { set: string; number: string };
  finish?: string;
  attrs: Record<string, unknown>;
  /** A suggested printing: how the copies are drawn, never which they are. */
  shownId?: string;
  qty: number;
  /** In a sum: the place the copies are in, named from the sum down. */
  place?: Place;
}

/** A place in a sum, by its path below the sum: `Atraxa › main`. */
export interface Place {
  id: string;
  name: string;
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
  /** Copies, all buckets together: held, or asked for, as the asset's type reads them. */
  count: number;
  /**
   * Against a decklist, in a deck it builds: held and on the list, on the
   * list and not held, or held beyond what the list asks. Undefined elsewhere.
   */
  state?: BuiltState;
  buckets: HeldBucket[];
}

interface LineRow {
  oracle_id: string;
  printing_id: string;
  finish: string;
  attrs: string;
  shown_id: string;
  qty: number;
  /** A sum's line: which of its places holds it. */
  place?: Place;
}

/**
 * Lines as tiles, sorted by name. A tile draws the printing it holds most
 * copies of; one whose buckets name no printing draws the stand-in.
 */
/** What a tile stands for: a card, a card's printing (finish and attributes dropped), or a line. */
export type TileGrain = "card" | "printing" | "line";

async function tiles(store: Sql, lines: LineRow[], layers: Layer[], by: TileGrain = "card"): Promise<Tile[]> {
  // Keyed by card, or — a tile per line — by bucket; either way each key's
  // lines are one card's.
  const byKey = new Map<string, LineRow[]>();
  for (const l of lines) {
    const k =
      by === "line"
        ? JSON.stringify([l.oracle_id, l.printing_id, l.finish, l.attrs, l.shown_id])
        : by === "printing"
          ? JSON.stringify([l.oracle_id, l.printing_id])
          : l.oracle_id;
    byKey.set(k, [...(byKey.get(k) ?? []), l]);
  }

  // Drawn printings by key; a stand-in is the card's, whichever key asks.
  const drawn = new Map<string, { id: string; standIn: boolean }>();
  const unprinted = new Set<string>();
  for (const [key, ls] of byKey) {
    const perPrinting = new Map<string, number>();
    for (const l of ls) if (l.printing_id !== "") perPrinting.set(l.printing_id, (perPrinting.get(l.printing_id) ?? 0) + l.qty);
    // Failing that, the most suggested: still a stand-in, but the line's own.
    const perShown = new Map<string, number>();
    for (const l of ls) if (l.shown_id !== "") perShown.set(l.shown_id, (perShown.get(l.shown_id) ?? 0) + l.qty);
    const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    const most = top(perPrinting);
    const suggested = top(perShown);
    if (most) drawn.set(key, { id: most[0], standIn: false });
    else if (suggested) drawn.set(key, { id: suggested[0], standIn: true });
    else unprinted.add(ls[0].oracle_id);
  }
  const stood = await standIns(layers, [...unprinted]);
  for (const [key, ls] of byKey) {
    const id = drawn.has(key) ? undefined : stood.get(ls[0].oracle_id);
    if (id) drawn.set(key, { id, standIn: true });
  }

  // The drawn printings, and every bucket's, to say which it is.
  const ids = [
    ...new Set([...[...drawn.values()].map((d) => d.id), ...lines.map((l) => l.printing_id).filter((p) => p !== "")]),
  ];
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
  for (const [key, ls] of byKey) {
    const d = drawn.get(key);
    const card = d && cards.get(d.id);
    if (!d || !card) continue; // not in the store: the load would have refused it
    out.push({
      oracleId: ls[0].oracle_id,
      card,
      standIn: d.standIn,
      count: ls.reduce((n, l) => n + l.qty, 0),
      buckets: ls.map((l) => ({
        ...(l.printing_id !== "" && { printingId: l.printing_id }),
        ...(cards.has(l.printing_id) && {
          printing: { set: cards.get(l.printing_id)!.setCode, number: cards.get(l.printing_id)!.collectorNumber },
        }),
        ...(l.finish !== "" && { finish: l.finish }),
        attrs: JSON.parse(l.attrs) as Record<string, unknown>,
        ...(l.shown_id !== "" && { shownId: l.shown_id }),
        qty: l.qty,
        ...(l.place && { place: l.place }),
      })),
    });
  }
  return out.sort((a, b) => a.card.name.localeCompare(b.card.name));
}

/**
 * The lines a search matches, answered from the card store: every card an
 * asset holds is there, so no request. A line naming a printing is tested on
 * it; one naming none on a printing of the card with its printing-level
 * terms unknown, so they match neither way (docs/inventory/buckets.md → *Querying a
 * bucket that leaves a key out*). No query, every line.
 */
async function matching(store: Sql, lines: LineRow[], query: string | undefined, layers: Layer[]): Promise<LineRow[]> {
  if (!query?.trim()) return lines;
  // Placeholders after the ids: compiled once per chunk, at that chunk's offset.
  const stand = await standIns(layers, [...new Set(lines.filter((l) => l.printing_id === "").map((l) => l.oracle_id))]);
  const asked = [
    ...[...new Set(lines.map((l) => l.printing_id).filter((p) => p !== ""))].map((id) => ({ id, unknown: 0 })),
    ...[...stand.values()].map((id) => ({ id, unknown: 1 })),
  ];
  const known = new Set<string>(); // printing ids matched
  const unknown = new Set<string>(); // oracle ids matched, printing unknown
  for (let i = 0; i < asked.length; i += 400) {
    const chunk = asked.slice(i, i + 400);
    const holes = (u: number) =>
      chunk
        .map((a, j) => (a.unknown === u ? `$${j + 1}` : null))
        .filter(Boolean)
        .join(", ") || "NULL";
    const compiled = compileQuery(query, { alias: "c", paramOffset: chunk.length, unknownPrinting: "c.unknown_printing = 1" });
    if (compiled.error) throw new QueryError(compiled.error.message, compiled.error.at);
    const rows = await store.select<{ id: string; oracle_id: string; unknown_printing: number }>(
      `SELECT c.id, c.oracle_id, c.unknown_printing FROM (
         SELECT *, 0 AS unknown_printing FROM cards WHERE id IN (${holes(0)})
         UNION ALL
         SELECT *, 1 AS unknown_printing FROM cards WHERE id IN (${holes(1)})
       ) c${compiled.sql ? ` WHERE ${compiled.sql}` : ""}`,
      [...chunk.map((a) => a.id), ...compiled.params],
    );
    for (const r of rows) (r.unknown_printing ? unknown : known).add(r.unknown_printing ? r.oracle_id : r.id);
  }
  return lines.filter((l) => (l.printing_id === "" ? unknown.has(l.oracle_id) : known.has(l.printing_id)));
}

/**
 * A place's, checklist's or exact checklist's lines: one tile per card, or
 * `by` another grain: a card's printing, or a line. The count is the same number for each; the type
 * says what it means: held, at least, exactly. A checklist is drawn per line:
 * its lines can overlap — at least four Bolts, at least one of them M10 —
 * so a card's total is a number nobody asked for.
 */
export async function lineContents(
  lab: Sql,
  store: Sql,
  id: string,
  {
    by = "card",
    query,
    layers = [scryfallLayer(store)],
  }: { by?: TileGrain; query?: string; layers?: Layer[] } = {},
): Promise<Tile[]> {
  const lines = await lab.select<LineRow>(
    "SELECT oracle_id, printing_id, finish, attrs, shown_id, qty FROM lines WHERE asset_id = $1",
    [id],
  );
  return tiles(store, await matching(store, lines, query, layers), layers, by);
}

/** The types that are collections; of them, the sums, which count their children. */
const COLLECTIONS = TYPES.filter((t) => isA(t, "collection"));
const SUMS = TYPES.filter((t) => isA(t, "sum"));
const quoted = (ts: readonly string[]) => ts.map((t) => `'${t}'`).join(", ");

/**
 * The places a sum adds up: its children that are collections, a child sum
 * — a deck among them — by its own children, recursively. Anything else
 * under it, a folder included, contributes nothing (docs/inventory/README.md →
 * *Unions*). Each named by its path below the sum.
 */
export async function sumPlaces(lab: Sql, sumId: string): Promise<Place[]> {
  const rows = await lab.select<{ id: string; name: string }>(
    `WITH RECURSIVE under (id, type, name) AS (
       SELECT id, type, name FROM assets WHERE parent_id = $1 AND type IN (${quoted(COLLECTIONS)})
       UNION ALL
       SELECT a.id, a.type, u.name || ' › ' || a.name FROM assets a JOIN under u ON a.parent_id = u.id
        WHERE u.type IN (${quoted(SUMS)}) AND a.type IN (${quoted(COLLECTIONS)})
     )
     SELECT id, name FROM under WHERE type = 'place' ORDER BY name COLLATE NOCASE, name`,
    [sumId],
  );
  return rows;
}

/** A sum's lines, each with the place it is in. */
async function sumLines(lab: Sql, sumId: string, oracleId?: string): Promise<LineRow[]> {
  const places = await sumPlaces(lab, sumId);
  const byId = new Map(places.map((p) => [p.id, p]));
  const out: LineRow[] = [];
  for (let i = 0; i < places.length; i += 400) {
    const chunk = places.slice(i, i + 400);
    const rows = await lab.select<LineRow & { asset_id: string }>(
      `SELECT asset_id, oracle_id, printing_id, finish, attrs, shown_id, qty FROM lines
        WHERE asset_id IN (${chunk.map((_, j) => `$${j + 1}`).join(", ")})
        ${oracleId ? `AND oracle_id = $${chunk.length + 1}` : ""}`,
      [...chunk.map((p) => p.id), ...(oracleId ? [oracleId] : [])],
    );
    for (const { asset_id, ...r } of rows) out.push({ ...r, place: byId.get(asset_id)! });
  }
  // In place order, so a tile lists its buckets place by place.
  const rank = new Map(places.map((p, i) => [p.id, i]));
  return out.sort((a, b) => rank.get(a.place!.id)! - rank.get(b.place!.id)!);
}

/**
 * A sum's tiles: every copy in its places, a tile per card or `by` printing,
 * each bucket saying which place it is in. The same bucket in two places is
 * two buckets.
 */
export async function sumContents(
  lab: Sql,
  store: Sql,
  id: string,
  { by = "card", query, layers = [scryfallLayer(store)] }: { by?: TileGrain; query?: string; layers?: Layer[] } = {},
): Promise<Tile[]> {
  return tiles(store, await matching(store, await sumLines(lab, id), query, layers), layers, by);
}

export interface ZoneContents {
  zone: string;
  /** The asset the zone names; absent when the reference is broken. */
  target?: { id: string; path: string[]; type: AssetType };
  tiles: Tile[];
}

/**
 * A decklist or deck, zone by zone. A zone's reference is followed to its
 * asset — a decklist's to a checklist, a deck's to a place — pinned by id,
 * or by name through the tree.
 */
export async function deckContents(
  lab: Sql,
  store: Sql,
  deckId: string,
  layers = [scryfallLayer(store)],
  /** Checklist zones a tile per line, as their own view draws them. */
  perLine = false,
): Promise<ZoneContents[]> {
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
      ...(target && { target: { id: target.id, path: target.path, type: target.type } }),
      tiles: target
        ? await lineContents(lab, store, target.id, { layers, by: perLine && isA(target.type, "checklist") ? "line" : "card" })
        : [],
    });
  }
  return out;
}

/* ---------- editing the tree ---------- */

/**
 * What the tree's menu can create; the others need more than a name. A deck
 * needs its decklist: it is made from one (`newDeckFrom`).
 */
export const CREATABLE = ["folder", "place", "sum", "checklist", "list pool", "decklist"] as const;
export type Creatable = (typeof CREATABLE)[number];

/** An edit the tree refuses, with a message to show as it stands. */
export class AssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetError";
  }
}

const DEFAULT_NAME: Record<Creatable | "deck", string> = {
  folder: "New folder",
  place: "New place",
  sum: "New collection",
  checklist: "New checklist",
  "list pool": "New pool",
  decklist: "New decklist",
  deck: "New deck",
};

/** A child of `parentId` called `zone`, of `type`, as its owner's zone. */
export async function addZone(lab: Sql, ownerId: string, zone: string, type: "place" | "exact checklist", at: string): Promise<void> {
  const id = crypto.randomUUID();
  await lab.execute(
    "INSERT INTO assets (id, parent_id, name, type, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)",
    [id, ownerId, zone, type, at],
  );
  await lab.execute(
    "INSERT INTO asset_refs (asset_id, role, target_id, path, rooted, facets) VALUES ($1, $2, $3, NULL, 0, '')",
    [ownerId, zone, id],
  );
}

/**
 * A new, empty asset under `parentId`, named `name` — by default "New
 * <type>" — numbered past any sibling already called that. Returns its id.
 * A decklist comes with an empty, exact `main`. A deck is only made here
 * for `newDeckFrom`, which gives it its decklist next.
 */
export async function createAsset(
  lab: Sql,
  parentId: string,
  type: Creatable | "deck",
  { name: base = DEFAULT_NAME[type], at = new Date().toISOString() }: { name?: string; at?: string } = {},
): Promise<string> {
  const name = await freeName(lab, parentId, base);
  const id = crypto.randomUUID();
  await lab.execute(
    `INSERT INTO assets (id, parent_id, name, type, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [id, parentId, name, type, at],
  );
  if (type === "decklist") await addZone(lab, id, "main", "exact checklist", at);
  return id;
}

/** `base`, numbered past any child of `parentId` already called that. */
async function freeName(lab: Sql, parentId: string, base: string, except = ""): Promise<string> {
  const siblings = await lab.select<{ name: string }>("SELECT name FROM assets WHERE parent_id = $1 AND id <> $2", [
    parentId,
    except,
  ]);
  const taken = new Set(siblings.map((s) => s.name));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  return name;
}

/**
 * A query pool: a search kept, as its query — Scryfall syntax, what the
 * pool panel runs — and its *More filters*, not its results, so saving one
 * sends no requests. Named after the whole search unless told otherwise.
 * Returns its id.
 */
export async function createQueryPool(
  lab: Sql,
  parentId: string,
  query: string,
  { name, at = new Date().toISOString(), filters }: { name?: string; at?: string; filters?: SavedFilters } = {},
): Promise<string> {
  const text = query.trim();
  const base = (name ?? searchName(text, filters)) || "Saved search";
  const id = crypto.randomUUID();
  await lab.execute(
    `INSERT INTO assets (id, parent_id, name, type, created_at, updated_at, query, filters)
     VALUES ($1, $2, $3, 'query pool', $4, $4, $5, $6)`,
    [id, parentId, await freeName(lab, parentId, base), at, text, filtersColumn(filters)],
  );
  return id;
}

/** Replace a query pool's search, its text and its filters: its Save. */
export async function setPoolQuery(
  lab: Sql,
  id: string,
  query: string,
  { filters, at = new Date().toISOString() }: { filters?: SavedFilters; at?: string } = {},
): Promise<void> {
  const [me] = await lab.select<{ type: string }>("SELECT type FROM assets WHERE id = $1", [id]);
  if (me?.type !== "query pool") throw new AssetError("Only a query pool has a query.");
  await lab.execute("UPDATE assets SET query = $2, filters = $3, updated_at = $4 WHERE id = $1", [
    id,
    query.trim(),
    filtersColumn(filters),
    at,
  ]);
}

/**
 * What converting can make of an asset: a checklist of a place (its lines
 * read as minimums); a place of either checklist (as held); and a checklist
 * exact or not. Lines stay as they are: one table holds them all, so it is a
 * change of type, in one statement (docs/inventory/goals.md → *Kinds of
 * checklist*).
 */
export const CONVERSIONS: Partial<Record<AssetType, AssetType[]>> = {
  // Neither holds anything of its own: a sum counts its children, a folder
  // only organises them.
  folder: ["sum"],
  sum: ["folder"],
  place: ["checklist"],
  checklist: ["place", "exact checklist"],
  "exact checklist": ["place", "checklist"],
};

/**
 * What a zone may be: a deck's are places; a decklist's commander and main
 * are exact checklists, its sideboard either checklist.
 */
function zoneFits(owner: AssetType, zone: string, type: AssetType): boolean {
  if (owner === "deck") return type === "place";
  if (zone === "side") return type === "checklist" || type === "exact checklist";
  return type === "exact checklist";
}

/**
 * Change an asset's type to one `CONVERSIONS` allows. Refused when something
 * pins it as a zone the new type cannot be — a deck's place, a decklist's
 * exact main — so no reference is left naming the wrong kind.
 */
export async function convertAsset(lab: Sql, id: string, to: AssetType, at = new Date().toISOString()): Promise<void> {
  const [me] = await lab.select<{ type: AssetType }>("SELECT type FROM assets WHERE id = $1", [id]);
  if (!me) throw new AssetError("That asset no longer exists.");
  if (!CONVERSIONS[me.type]?.includes(to)) throw new AssetError(`A ${me.type} cannot become a ${to}.`);
  const zones = await lab.select<{ role: string; owner: AssetType; name: string }>(
    `SELECT r.role, a.type AS owner, a.name FROM asset_refs r JOIN assets a ON a.id = r.asset_id
      WHERE r.target_id = $1 AND r.role IN ('commander', 'main', 'side')`,
    [id],
  );
  const clash = zones.find((z) => !zoneFits(z.owner, z.role, to));
  if (clash) {
    const what = clash.owner === "deck" ? "a place" : clash.role === "side" ? "a checklist" : "an exact checklist";
    throw new AssetError(`Cannot convert: it is the ${clash.role} zone of ${clash.owner} “${clash.name}”, which must be ${what}.`);
  }
  // A checklist is checked on a collection; a folder is none.
  if (to === "folder") {
    const [on] = await lab.select<{ name: string }>(
      "SELECT a.name FROM asset_refs r JOIN assets a ON a.id = r.asset_id WHERE r.target_id = $1 AND r.role = 'on'",
      [id],
    );
    if (on) throw new AssetError(`Cannot convert: checklist “${on.name}” is checked on it, and a folder holds nothing.`);
  }
  await lab.execute("UPDATE assets SET type = $2, updated_at = $3 WHERE id = $1", [id, to, at]);
}

/**
 * Rename an asset. Pinned references follow it; by-name ones keep the old
 * name, which is what *by name* means (docs/inventory/asset-tree.md → *Naming a set in
 * a query*).
 */
/**
 * Name a query pool after its saved search, as *Save as* would: numbered
 * when a sibling has the name already. Returns the name it ends up with.
 */
export async function nameAfterSearch(lab: Sql, id: string, at = new Date().toISOString()): Promise<string> {
  const [me] = await lab.select<{ type: string; parent_id: string; name: string; query: string; filters: string | null }>(
    "SELECT type, parent_id, name, query, filters FROM assets WHERE id = $1",
    [id],
  );
  if (me?.type !== "query pool") throw new AssetError("Only a query pool is named after its search.");
  const name = await freeName(lab, me.parent_id, searchName(me.query, filtersOfColumn(me.filters)) || "Saved search", id);
  if (name !== me.name) await lab.execute("UPDATE assets SET name = $2, updated_at = $3 WHERE id = $1", [id, name, at]);
  return name;
}

export async function renameAsset(lab: Sql, id: string, name: string, at = new Date().toISOString()): Promise<void> {
  const bad = badName(name);
  if (bad) throw new AssetError(`Cannot rename: ${bad}.`);
  const clash = await lab.select<{ n: number }>(
    `SELECT COUNT(*) AS n FROM assets
      WHERE parent_id = (SELECT parent_id FROM assets WHERE id = $1) AND name = $2 AND id <> $1`,
    [id, name],
  );
  if (clash[0].n) throw new AssetError(`Cannot rename: something beside it is already called “${name}”.`);
  await lab.execute("UPDATE assets SET name = $2, updated_at = $3 WHERE id = $1", [id, name, at]);
}

/** An asset and everything below it: ids, the asset's first. */
async function subtree(lab: Sql, id: string): Promise<string[]> {
  const rows = await lab.select<{ id: string }>(
    `WITH RECURSIVE below(id) AS (
       SELECT $1 UNION ALL SELECT a.id FROM assets a JOIN below b ON a.parent_id = b.id
     ) SELECT id FROM below`,
    [id],
  );
  return rows.map((r) => r.id);
}

/** How many assets deleting `id` would delete, itself included. */
export async function subtreeSize(lab: Sql, id: string): Promise<number> {
  return (await subtree(lab, id)).length;
}

/**
 * Delete an asset and everything below it, in one statement: the schema
 * cascades to children, lines and references. Refused while an asset outside
 * pins something inside, since the dump could not write that reference.
 */
export async function deleteAsset(lab: Sql, id: string): Promise<void> {
  if (id === "root") throw new AssetError("The root cannot be deleted.");
  const fk = await lab.select<{ foreign_keys: number }>("PRAGMA foreign_keys");
  if (!fk[0]?.foreign_keys) throw new AssetError("Cannot delete: foreign keys are off, so nothing would cascade.");
  const ids = await subtree(lab, id);
  const inside = new Set(ids);
  const pins = await lab.select<{ asset_id: string; role: string; target_id: string }>(
    "SELECT asset_id, role, target_id FROM asset_refs WHERE target_id IS NOT NULL",
  );
  const from = pins.filter((p) => inside.has(p.target_id) && !inside.has(p.asset_id));
  if (from.length) {
    const tree = await assetTree(lab);
    const paths = new Map<string, string>();
    const index = (nodes: AssetNode[]) => {
      for (const n of nodes) {
        paths.set(n.id, "/" + n.path.join("/"));
        index(n.children);
      }
    };
    index(tree);
    const list = from.map((p) => `${paths.get(p.asset_id)} (its ${p.role})`).join("\n");
    throw new AssetError(`Cannot delete: other assets refer to it.\n\n${list}`);
  }
  await lab.execute("DELETE FROM assets WHERE id = $1", [id]);
}

/**
 * Move an asset, and everything below it, under `parentId` (`"root"` for
 * the top). Any asset can hold children. Pinned references follow it; a
 * by-name one keeps its path. Refused into itself or below itself, or beside
 * something of the same name.
 */
export async function moveAsset(lab: Sql, id: string, parentId: string, at = new Date().toISOString()): Promise<void> {
  if (id === "root") throw new AssetError("The root cannot be moved.");
  if ((await subtree(lab, id)).includes(parentId)) throw new AssetError("Cannot move an asset into itself.");
  const [me] = await lab.select<{ name: string; parent_id: string }>(
    "SELECT name, parent_id FROM assets WHERE id = $1",
    [id],
  );
  if (!me) throw new AssetError("That asset no longer exists.");
  if (me.parent_id === parentId) return;
  const clash = await lab.select<{ n: number }>(
    "SELECT COUNT(*) AS n FROM assets WHERE parent_id = $1 AND name = $2",
    [parentId, me.name],
  );
  if (clash[0].n) throw new AssetError(`Cannot move: something there is already called “${me.name}”.`);
  await lab.execute("UPDATE assets SET parent_id = $2, updated_at = $3 WHERE id = $1", [id, parentId, at]);
}

/* ---------- a deck and its decklist ---------- */

const ZONE_ROLES = ["commander", "main", "side"] as const;

/** The decklist a deck builds: pinned, as an asset; by name, as its path. */
export interface DeckList {
  id?: string;
  path: string[];
  byName: boolean;
}

/** Which decklist a deck builds; null when its pinned one no longer exists. */
export async function deckList(lab: Sql, deckId: string): Promise<DeckList | null> {
  const [r] = await lab.select<{ target_id: string | null; path: string | null; rooted: number }>(
    "SELECT target_id, path, rooted FROM asset_refs WHERE asset_id = $1 AND role = 'list'",
    [deckId],
  );
  if (!r) return null;
  if (r.target_id === null) return { path: r.path ? parseRef(r.path).names : [], byName: true };
  const tree = await assetTree(lab);
  const find = (nodes: AssetNode[]): AssetNode | undefined => {
    for (const n of nodes) {
      if (n.id === r.target_id) return n;
      const below = find(n.children);
      if (below) return below;
    }
  };
  const target = find(tree);
  return target ? { id: target.id, path: target.path, byName: false } : null;
}

/**
 * Point a deck at the decklist it builds, pinned, so it follows the decklist
 * anywhere. Every deck builds one, so this replaces, never clears. Its
 * `shows` goes, being one of the old decklist's arrangements. A deck with no
 * zones yet gets an empty place for each zone the decklist has, as its
 * children; zones it has are kept.
 *
 * Written so that stopping between statements leaves a lab that still
 * loads — at worst a deck with no `list`, which a dump reports: the plugin
 * holds no transaction across calls.
 */
export async function setDeckList(lab: Sql, deckId: string, decklistId: string, at = new Date().toISOString()): Promise<void> {
  const types = await lab.select<{ id: string; type: string }>(
    "SELECT id, type FROM assets WHERE id IN ($1, $2)",
    [deckId, decklistId],
  );
  const typeOf = (id: string) => types.find((t) => t.id === id)?.type;
  if (typeOf(deckId) !== "deck") throw new AssetError("Only a deck builds a decklist.");
  if (typeOf(decklistId) !== "decklist") throw new AssetError("A deck can only build a decklist.");

  await lab.execute("DELETE FROM asset_refs WHERE asset_id = $1 AND role IN ('list', 'shows')", [deckId]);
  await lab.execute(
    "INSERT INTO asset_refs (asset_id, role, target_id, path, rooted, facets) VALUES ($1, 'list', $2, NULL, 1, '')",
    [deckId, decklistId],
  );
  const zones = await lab.select<{ role: string }>(
    "SELECT role FROM asset_refs WHERE asset_id = $1 AND role IN ('commander', 'main', 'side')",
    [deckId],
  );
  if (!zones.length) {
    const theirs = await lab.select<{ role: string }>(
      "SELECT role FROM asset_refs WHERE asset_id = $1 AND role IN ('commander', 'main', 'side')",
      [decklistId],
    );
    for (const zone of ZONE_ROLES.filter((z) => theirs.some((t) => t.role === z))) {
      const [child] = await lab.select<{ id: string; type: string }>(
        "SELECT id, type FROM assets WHERE parent_id = $1 AND name = $2",
        [deckId, zone],
      );
      if (child && child.type !== "place") continue; // something else by that name: leave the zone unset
      if (child) {
        await lab.execute(
          "INSERT INTO asset_refs (asset_id, role, target_id, path, rooted, facets) VALUES ($1, $2, $3, NULL, 0, '')",
          [deckId, zone, child.id],
        );
      } else {
        await addZone(lab, deckId, zone, "place", at);
      }
    }
  }
  await lab.execute("UPDATE assets SET updated_at = $2 WHERE id = $1", [deckId, at]);
}

/** A new deck building `decklistId`, as its child, named "deck". Returns its id. */
export async function newDeckFrom(lab: Sql, decklistId: string, at = new Date().toISOString()): Promise<string> {
  const id = await createAsset(lab, decklistId, "deck", { name: "deck", at });
  await setDeckList(lab, id, decklistId, at);
  return id;
}

export type BuiltState = "held" | "missing" | "extra";

export interface BuiltZone extends ZoneContents {
  /** Copies the decklist's zone asks for, and how many of them the deck holds. */
  asked: number;
  held: number;
  /**
   * The decklist's zone is exact: extras are over what it allows. Otherwise
   * it asks for at least its counts, and extras are only more.
   */
  exact: boolean;
}

/**
 * A deck drawn as the decklist it builds: zone by zone, at card grain (the
 * decklist's oracle projection, what the deck plays). Each card's copies
 * split into runs by state — held, missing, extra — so a tile is never
 * partly there: 3 of 7 Islands is a held 3× and a missing 4×. Null when the
 * decklist no longer exists.
 */
export async function builtContents(
  lab: Sql,
  store: Sql,
  deckId: string,
  layers = [scryfallLayer(store)],
): Promise<BuiltZone[] | null> {
  const list = await deckList(lab, deckId);
  let listId = list?.id;
  if (list && !listId) {
    // By name: whatever is at that path now.
    const tree = await assetTree(lab);
    const walk = (nodes: AssetNode[]): string | undefined => {
      for (const n of nodes) {
        if (pathKey(n.path) === pathKey(list.path) && n.type === "decklist") return n.id;
        const below = walk(n.children);
        if (below) return below;
      }
    };
    listId = walk(tree);
  }
  if (!listId) return null;

  const asked = await deckContents(lab, store, listId, layers);
  const held = await deckContents(lab, store, deckId, layers);
  const out: BuiltZone[] = [];
  for (const zone of ZONE_ROLES) {
    const a = asked.find((z) => z.zone === zone);
    const h = held.find((z) => z.zone === zone);
    if (!a && !h) continue;
    const heldBy = new Map((h?.tiles ?? []).map((t) => [t.oracleId, t]));
    const tiles: Tile[] = [];
    let askedN = 0;
    let heldN = 0;
    for (const want of a?.tiles ?? []) {
      const have = heldBy.get(want.oracleId);
      heldBy.delete(want.oracleId);
      const has = have?.count ?? 0;
      const there = Math.min(has, want.count);
      askedN += want.count;
      heldN += there;
      if (there > 0) tiles.push({ ...have!, count: there, state: "held" });
      if (want.count > has) tiles.push({ ...want, count: want.count - has, state: "missing" });
      if (has > want.count) tiles.push({ ...have!, count: has - want.count, state: "extra" });
    }
    for (const have of heldBy.values()) tiles.push({ ...have, state: "extra" });
    out.push({
      zone,
      ...(h?.target && { target: h.target }),
      tiles: tiles.sort((x, y) => x.card.name.localeCompare(y.card.name)),
      asked: askedN,
      held: heldN,
      exact: a?.target?.type !== "checklist",
    });
  }
  return out;
}

/**
 * All Magic as a pull sheet's source: the one collection holding every
 * card, in any number. Pulling from it adds copies rather than moving them.
 */
export const ALL_MAGIC = "all-magic";

/**
 * `n` copies of a bucket added to a place: from All Magic, where they were
 * not counted anywhere before. A copy already there of the same bucket
 * gains them.
 */
export async function addCopies(lab: Sql, placeId: string, bucket: Bucket, n: number, at = new Date().toISOString()): Promise<void> {
  const [me] = await lab.select<{ type: AssetType }>("SELECT type FROM assets WHERE id = $1", [placeId]);
  if (me?.type !== "place") throw new AssetError("Copies are added to a place.");
  if (!Number.isInteger(n) || n < 1) throw new AssetError("Add at least one.");
  await lab.execute(
    `INSERT INTO lines (asset_id, oracle_id, printing_id, finish, attrs, shown_id, qty, added_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (asset_id, oracle_id, printing_id, finish, attrs, shown_id) DO UPDATE SET qty = qty + excluded.qty`,
    [placeId, ...columns(bucket), n, at],
  );
  await lab.execute("UPDATE assets SET updated_at = $2 WHERE id = $1", [placeId, at]);
}

/** Copies somewhere that would fill a deck's slot: a bucket in a place, and how many. */
export interface PullSource {
  place: Place;
  bucket: Bucket;
  qty: number;
}

/** A card a deck's decklist asks for and the deck lacks: how many, where it goes, and where it could come from. */
export interface PullRow {
  zone: string;
  /** The deck's place for the zone; absent when the deck has no such zone. */
  zoneId?: string;
  oracleId: string;
  card: Card;
  missing: number;
  sources: PullSource[];
}

/**
 * A copy's bucket fills a decklist line when it lies inside the line's:
 * the line's printing, if it binds one, finish and attributes all matched.
 * A suggestion asks nothing (docs/inventory/buckets.md → *Suggested printings*).
 */
function fills(want: HeldBucket, have: HeldBucket): boolean {
  if (want.printingId && want.printingId !== have.printingId) return false;
  if (want.finish && want.finish !== have.finish) return false;
  return Object.entries(want.attrs).every(([k, v]) => have.attrs[k] === v);
}

/**
 * What a deck lacks, with every bucket in `fromId` — a place, or a sum's
 * places — that would fill it: the pull sheet. The deck's own places are
 * never a source. Sources come in the order to offer them: the line's
 * suggested art first, then the most copies. Local only: no request.
 */
export async function pullSheet(lab: Sql, store: Sql, deckId: string, fromId: string): Promise<PullRow[]> {
  const built = await builtContents(lab, store, deckId);
  if (!built) return [];
  const missing = built.flatMap((z) =>
    z.tiles.filter((t) => t.state === "missing").map((t) => ({ zone: z.zone, zoneId: z.target?.id, tile: t })),
  );
  if (!missing.length) return [];

  // All Magic holds every card, any number: what the decklist line says, as
  // it says it, first. A line that binds no printing is filled by any, so
  // each printing the store knows follows — known, not the whole run, since
  // a sheet sends no requests — newest first, the suggested art leading.
  if (fromId === ALL_MAGIC) {
    const place = { id: ALL_MAGIC, name: "All Magic" };
    const oracles = [...new Set(missing.map((m) => m.tile.oracleId))];
    const printings = new Map<string, { id: string; finishes: string[] }[]>();
    for (let i = 0; i < oracles.length; i += 400) {
      const chunk = oracles.slice(i, i + 400);
      const rows = await store.select<{ id: string; oracle_id: string; finishes: string | null }>(
        `SELECT id, oracle_id, json_extract(data, '$.finishes') AS finishes FROM cards
          WHERE oracle_id IN (${chunk.map((_, j) => `$${j + 1}`).join(", ")})
            AND COALESCE(json_extract(data, '$.lang'), 'en') = 'en'
          ORDER BY released_at DESC, set_code, collector_number`,
        chunk,
      );
      for (const r of rows) {
        printings.set(r.oracle_id, [...(printings.get(r.oracle_id) ?? []), { id: r.id, finishes: r.finishes ? (JSON.parse(r.finishes) as string[]) : [] }]);
      }
    }
    return missing.map(({ zone, zoneId, tile }) => {
      const seen = new Set<string>();
      const sources: PullSource[] = [];
      const offer = (bucket: Bucket) => {
        if (seen.has(bucketKey(bucket))) return;
        seen.add(bucketKey(bucket));
        sources.push({ place, qty: tile.count, bucket });
      };
      for (const w of tile.buckets) {
        const base = { oracleId: tile.oracleId, ...(w.finish && { finish: w.finish }), attrs: w.attrs };
        offer({ ...base, ...(w.printingId && { printingId: w.printingId }), ...(w.shownId && { shownId: w.shownId }) });
      }
      for (const w of tile.buckets) {
        if (w.printingId) continue;
        const base = { oracleId: tile.oracleId, ...(w.finish && { finish: w.finish }), attrs: w.attrs };
        const run = (printings.get(tile.oracleId) ?? []).filter((p) => !w.finish || !p.finishes.length || p.finishes.includes(w.finish));
        const lead = run.filter((p) => p.id === w.shownId);
        for (const p of [...lead, ...run.filter((p) => p.id !== w.shownId)]) offer({ ...base, printingId: p.id });
      }
      return { zone, ...(zoneId && { zoneId }), oracleId: tile.oracleId, card: tile.card, missing: tile.count, sources };
    });
  }

  const [from] = await lab.select<{ id: string; name: string; type: AssetType }>("SELECT id, name, type FROM assets WHERE id = $1", [fromId]);
  if (!from) throw new AssetError("That collection no longer exists.");
  // Its own: what is below it, and the places its zones name, wherever they are.
  const zoneTargets = await lab.select<{ target_id: string }>(
    "SELECT target_id FROM asset_refs WHERE asset_id = $1 AND role IN ('commander', 'main', 'side') AND target_id IS NOT NULL",
    [deckId],
  );
  const own = new Set([...(await subtree(lab, deckId)), ...zoneTargets.map((z) => z.target_id)]);
  const places = (isA(from.type, "sum") ? await sumPlaces(lab, from.id) : from.type === "place" ? [{ id: from.id, name: from.name }] : []).filter(
    (p) => !own.has(p.id),
  );
  const byId = new Map(places.map((p) => [p.id, p]));
  const oracles = [...new Set(missing.map((m) => m.tile.oracleId))];
  const rows: (LineRow & { asset_id: string })[] = [];
  for (let i = 0; i < places.length; i += 200) {
    const chunk = places.slice(i, i + 200);
    for (let j = 0; j < oracles.length; j += 200) {
      const cards = oracles.slice(j, j + 200);
      rows.push(
        ...(await lab.select<LineRow & { asset_id: string }>(
          `SELECT asset_id, oracle_id, printing_id, finish, attrs, shown_id, qty FROM lines
            WHERE asset_id IN (${chunk.map((_, k) => `$${k + 1}`).join(", ")})
              AND oracle_id IN (${cards.map((_, k) => `$${chunk.length + k + 1}`).join(", ")})`,
          [...chunk.map((p) => p.id), ...cards],
        )),
      );
    }
  }

  return missing.map(({ zone, zoneId, tile }) => {
    const wants = tile.buckets;
    const drawn = new Set(wants.flatMap((w) => [w.printingId, w.shownId]).filter(Boolean));
    const sources = rows
      .filter((r) => r.oracle_id === tile.oracleId)
      .map((r) => {
        const held: HeldBucket = {
          ...(r.printing_id && { printingId: r.printing_id }),
          ...(r.finish && { finish: r.finish }),
          attrs: JSON.parse(r.attrs) as Record<string, unknown>,
          ...(r.shown_id && { shownId: r.shown_id }),
          qty: r.qty,
        };
        return { held, place: byId.get(r.asset_id)! };
      })
      .filter(({ held }) => wants.some((w) => fills(w, held)))
      .map(({ held, place }) => ({
        place,
        qty: held.qty,
        bucket: {
          oracleId: tile.oracleId,
          ...(held.printingId && { printingId: held.printingId }),
          ...(held.finish && { finish: held.finish }),
          attrs: held.attrs,
          ...(held.shownId && { shownId: held.shownId }),
        } as Bucket,
      }))
      .sort(
        (a, b) =>
          Number(drawn.has(b.bucket.printingId)) - Number(drawn.has(a.bucket.printingId)) ||
          b.qty - a.qty ||
          a.place.name.localeCompare(b.place.name),
      );
    return { zone, ...(zoneId && { zoneId }), oracleId: tile.oracleId, card: tile.card, missing: tile.count, sources };
  });
}

/* ---------- a list pool's members ---------- */

/**
 * What a tile stands for, as the view it is in says: a card, any printing; a
 * printing; and, from a place, a finish and attributes too. Left out is
 * `absent`. The source decides it; a destination only acts on it.
 */
export interface Bucket {
  oracleId: string;
  printingId?: string;
  finish?: string;
  attrs?: Record<string, unknown>;
  /** A suggested printing: drawn, never matched, never beside `printingId`. */
  shownId?: string;
}

/** A bucket as its five columns, `absent` as the schema stores it. */
function columns(b: Bucket): [string, string, string, string, string] {
  const attrs = Object.fromEntries(Object.entries(b.attrs ?? {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  return [b.oracleId, b.printingId ?? "", b.finish ?? "", JSON.stringify(attrs), b.shownId ?? ""];
}

/** The row with a bucket's five columns, from `$1` (the asset) on. */
const BUCKET_WHERE = "asset_id = $1 AND oracle_id = $2 AND printing_id = $3 AND finish = $4 AND attrs = $5 AND shown_id = $6";

/** A bucket's identity: equal keys, one bucket. */
export const bucketKey = (b: Bucket): string => JSON.stringify(columns(b));

/** A list pool's members, by `bucketKey`. */
export type Members = Set<string>;

export async function poolMembers(lab: Sql, poolId: string): Promise<Members> {
  const rows = await lab.select<{ oracle_id: string; printing_id: string; finish: string; attrs: string; shown_id: string }>(
    "SELECT oracle_id, printing_id, finish, attrs, shown_id FROM pool_members WHERE asset_id = $1",
    [poolId],
  );
  return new Set(rows.map((r) => JSON.stringify([r.oracle_id, r.printing_id, r.finish, r.attrs, r.shown_id])));
}

async function requireListPool(lab: Sql, poolId: string): Promise<void> {
  const [me] = await lab.select<{ type: string }>("SELECT type FROM assets WHERE id = $1", [poolId]);
  if (me?.type !== "list pool") throw new AssetError("Only a list pool takes members.");
}

/**
 * Make a bucket a member; already one, nothing changes. Its card is in the
 * store already — the tile came from a page of it.
 */
export async function addMember(lab: Sql, poolId: string, bucket: Bucket, at = new Date().toISOString()): Promise<void> {
  await requireListPool(lab, poolId);
  await lab.execute(
    `INSERT OR IGNORE INTO pool_members (asset_id, oracle_id, printing_id, finish, attrs, shown_id, added_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [poolId, ...columns(bucket), at],
  );
  await lab.execute("UPDATE assets SET updated_at = $2 WHERE id = $1", [poolId, at]);
}

/** Take a bucket out of a pool: that bucket only, not the card's others. */
export async function removeMember(lab: Sql, poolId: string, bucket: Bucket, at = new Date().toISOString()): Promise<void> {
  await requireListPool(lab, poolId);
  await lab.execute(
    `DELETE FROM pool_members WHERE ${BUCKET_WHERE}`,
    [poolId, ...columns(bucket)],
  );
  await lab.execute("UPDATE assets SET updated_at = $2 WHERE id = $1", [poolId, at]);
}

/**
 * A list pool's members, one tile per card. Membership has no count: a
 * tile's `count` is how many of the card's buckets are members, and its
 * buckets say which.
 */
export async function memberContents(
  lab: Sql,
  store: Sql,
  poolId: string,
  { by = "card", query, layers = [scryfallLayer(store)] }: { by?: TileGrain; query?: string; layers?: Layer[] } = {},
): Promise<Tile[]> {
  const lines = await lab.select<LineRow>(
    "SELECT oracle_id, printing_id, finish, attrs, shown_id, 1 AS qty FROM pool_members WHERE asset_id = $1",
    [poolId],
  );
  return tiles(store, await matching(store, lines, query, layers), layers, by);
}

/* ---------- targets ---------- */

/**
 * What can be the lab's target: what `+` acts on, from whatever view is the
 * source. A list pool takes members; the others count, each as its type
 * reads a line — held, at least, exactly.
 */
export const TARGETABLE: ReadonlySet<AssetType> = new Set<AssetType>(["list pool", "checklist", "exact checklist", "place"]);

/** What a target holds of each bucket, by `bucketKey`: a member counts 1. */
export async function targetCounts(lab: Sql, target: { id: string; type: AssetType }): Promise<Map<string, number>> {
  const rows = await lab.select<{ oracle_id: string; printing_id: string; finish: string; attrs: string; shown_id: string; qty: number }>(
    target.type === "list pool"
      ? "SELECT oracle_id, printing_id, finish, attrs, shown_id, 1 AS qty FROM pool_members WHERE asset_id = $1"
      : "SELECT oracle_id, printing_id, finish, attrs, shown_id, qty FROM lines WHERE asset_id = $1",
    [target.id],
  );
  return new Map(rows.map((r) => [JSON.stringify([r.oracle_id, r.printing_id, r.finish, r.attrs, r.shown_id]), r.qty]));
}

/**
 * One more, or one fewer, of a bucket's line: created at 1, gone at 0. Fewer
 * of a line there is none of is refused.
 */
export async function stepLine(lab: Sql, id: string, bucket: Bucket, delta: 1 | -1, at = new Date().toISOString()): Promise<void> {
  const [me] = await lab.select<{ type: AssetType }>("SELECT type FROM assets WHERE id = $1", [id]);
  if (!me || me.type === "list pool" || !TARGETABLE.has(me.type)) throw new AssetError("Only a place or checklist counts copies.");
  const key = [id, ...columns(bucket)];
  const where = BUCKET_WHERE;
  if (delta > 0) {
    await lab.execute(
      `INSERT INTO lines (asset_id, oracle_id, printing_id, finish, attrs, shown_id, qty, added_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7)
       ON CONFLICT (asset_id, oracle_id, printing_id, finish, attrs, shown_id) DO UPDATE SET qty = qty + 1`,
      [...key, at],
    );
  } else {
    const [line] = await lab.select<{ qty: number }>(`SELECT qty FROM lines WHERE ${where}`, key);
    if (!line) throw new AssetError("There is none of that to take away.");
    await lab.execute(line.qty > 1 ? `UPDATE lines SET qty = qty - 1 WHERE ${where}` : `DELETE FROM lines WHERE ${where}`, key);
  }
  await lab.execute("UPDATE assets SET updated_at = $2 WHERE id = $1", [id, at]);
}

/** One more or one fewer in a target, as its type takes it: a member in or out, or a line counted. */
export async function stepTarget(
  lab: Sql,
  target: { id: string; type: AssetType },
  bucket: Bucket,
  delta: 1 | -1,
  at = new Date().toISOString(),
): Promise<void> {
  if (target.type === "list pool") return delta > 0 ? addMember(lab, target.id, bucket, at) : removeMember(lab, target.id, bucket, at);
  return stepLine(lab, target.id, bucket, delta, at);
}

/** One copy of a bucket from one place to another: `moveLines`, one copy, the bucket unchanged. */
export async function moveCopy(lab: Sql, fromId: string, toId: string, bucket: Bucket, at = new Date().toISOString()): Promise<void> {
  if (fromId === toId) throw new AssetError("A copy moves from one place to another.");
  await moveLines(lab, null, { assetId: fromId, bucket }, { assetId: toId, bucket }, 1, at);
}

/* ---------- changing a bucket ---------- */

/**
 * The attributes a bucket can be given, to start: a fixed set, so keys do
 * not drift ("signed", "Signed"). Language is not one — it is part of the
 * printing. Each is declared in the lab's `attributes` on first use.
 */
export const FIXED_ATTRIBUTES = { condition: "condition", signed: "boolean", altered: "boolean", note: "text" } as const;
export const CONDITIONS = ["M", "NM", "LP", "MP", "HP", "DMG"] as const;

/**
 * One card's buckets in an asset, and what each holds: a member counts 1.
 * A sum's are its places', each saying which, in place order.
 */
export async function bucketsOf(
  lab: Sql,
  asset: { id: string; type: AssetType },
  oracleId: string,
): Promise<{ bucket: Bucket; qty: number; place?: Place }[]> {
  const rows: Omit<LineRow, "oracle_id">[] = isA(asset.type, "sum")
    ? await sumLines(lab, asset.id, oracleId)
    : await lab.select<Omit<LineRow, "oracle_id">>(
        asset.type === "list pool"
          ? "SELECT printing_id, finish, attrs, shown_id, 1 AS qty FROM pool_members WHERE asset_id = $1 AND oracle_id = $2"
          : "SELECT printing_id, finish, attrs, shown_id, qty FROM lines WHERE asset_id = $1 AND oracle_id = $2",
        [asset.id, oracleId],
      );
  const order = (r: { bucket: Bucket; place?: Place }) => `${r.place?.name ?? ""}\u0000${bucketKey(r.bucket)}`;
  return rows
    .map((r) => ({
      bucket: {
        oracleId,
        ...(r.printing_id !== "" && { printingId: r.printing_id }),
        ...(r.finish !== "" && { finish: r.finish }),
        attrs: JSON.parse(r.attrs) as Record<string, unknown>,
        ...(r.shown_id !== "" && { shownId: r.shown_id }),
      },
      qty: r.qty,
      ...(r.place && { place: r.place }),
    }))
    .sort((a, b) => (order(a) < order(b) ? -1 : 1));
}

/** Refuse an attribute outside the fixed set, or of the wrong kind; declare it if new. */
async function declareAttributes(lab: Sql, attrs: Record<string, unknown>): Promise<void> {
  for (const [name, v] of Object.entries(attrs)) {
    const type = (FIXED_ATTRIBUTES as Record<string, string>)[name];
    if (!type) throw new AssetError(`“${name}” is not an attribute a bucket can have yet.`);
    const ok =
      type === "condition"
        ? (CONDITIONS as readonly unknown[]).includes(v)
        : type === "boolean"
          ? typeof v === "boolean"
          : typeof v === "string" && v !== "";
    if (!ok) throw new AssetError(`“${name}” cannot be ${JSON.stringify(v)}.`);
    const [have] = await lab.select<{ type: string }>("SELECT type FROM attributes WHERE name = $1", [name]);
    if (have && have.type !== type) throw new AssetError(`“${name}” is declared as ${have.type} in this library, not ${type}.`);
    if (!have) await lab.execute("INSERT INTO attributes (name, type) VALUES ($1, $2)", [name, type]);
  }
}

/** Refuse a printing that is not of the card, or a finish it does not come in. */
async function checkPrinting(store: Sql, b: Bucket): Promise<void> {
  if (b.shownId) {
    if (b.printingId) throw new AssetError("A bucket names its printing or suggests one, not both.");
    const [row] = await store.select<CardRow>("SELECT * FROM cards WHERE id = $1", [b.shownId]);
    if (!row) throw new AssetError("That printing is not in the card store.");
    if (row.oracle_id !== b.oracleId) throw new AssetError(`${row.name} is another card.`);
  }
  if (!b.printingId) return;
  const [row] = await store.select<CardRow>("SELECT * FROM cards WHERE id = $1", [b.printingId]);
  if (!row) throw new AssetError("That printing is not in the card store.");
  const card = rowToCard(row);
  if (card.oracleId !== b.oracleId) throw new AssetError(`${card.name} is another card.`);
  const finishes = (card.data.finishes as string[] | undefined) ?? [];
  if (b.finish && finishes.length && !finishes.includes(b.finish))
    throw new AssetError(`${card.setCode.toUpperCase()} ${card.collectorNumber} does not come ${b.finish}.`);
}

/**
 * Move `n` from bucket B to bucket B′: B loses n, gone at 0; n of B′ join
 * any already there. One operation for every change of a bucket — setting,
 * changing or clearing a printing, finish or attribute, all of a line or a
 * split of it — and for a copy moving between places. A list pool has no
 * counts: its member is B or B′, whole.
 *
 * Within an asset, any type with lines; between two, places only — a
 * checklist's line is a requirement, not a thing that can be elsewhere. B′
 * must be the same card. `store`, when given, checks B′'s printing and
 * finish against it; null is for a bucket that keeps its printing.
 *
 * Two writes the plugin cannot make one transaction, so B gives first — a
 * failure between loses the n, and says so, rather than doubling them
 * silently. Move transactions are parked (TODO).
 */
export async function moveLines(
  lab: Sql,
  store: Sql | null,
  from: { assetId: string; bucket: Bucket },
  to: { assetId: string; bucket: Bucket },
  n: number,
  at = new Date().toISOString(),
): Promise<void> {
  const kinds = await lab.select<{ id: string; type: AssetType }>("SELECT id, type FROM assets WHERE id IN ($1, $2)", [
    from.assetId,
    to.assetId,
  ]);
  const type = (id: string) => kinds.find((k) => k.id === id)?.type;
  const same = from.assetId === to.assetId;
  const t = type(from.assetId);
  if (!t || !type(to.assetId)) throw new AssetError("No such asset.");
  if (!same && (t !== "place" || type(to.assetId) !== "place")) throw new AssetError("A copy moves from one place to another.");
  if (!TARGETABLE.has(t)) throw new AssetError("Only a place, checklist or pool has buckets.");
  if (from.bucket.oracleId !== to.bucket.oracleId) throw new AssetError("A bucket can change, not its card.");
  if (same && bucketKey(from.bucket) === bucketKey(to.bucket)) throw new AssetError("Nothing to change: it is the same bucket.");
  if (!Number.isInteger(n) || n < 1) throw new AssetError("Move at least one.");
  await declareAttributes(lab, to.bucket.attrs ?? {});
  if (store) await checkPrinting(store, to.bucket);

  if (t === "list pool") {
    const [has] = await lab.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM pool_members WHERE ${BUCKET_WHERE}`,
      [from.assetId, ...columns(from.bucket)],
    );
    if (!has.n) throw new AssetError("There is none of that to change.");
    await removeMember(lab, from.assetId, from.bucket, at);
    await addMember(lab, from.assetId, to.bucket, at);
    return;
  }

  const where = BUCKET_WHERE;
  const key = [from.assetId, ...columns(from.bucket)];
  const [line] = await lab.select<{ qty: number }>(`SELECT qty FROM lines WHERE ${where}`, key);
  if (!line || line.qty < n) throw new AssetError(line ? `There are only ${line.qty} of that.` : "There is none of that to take away.");
  await lab.execute(
    line.qty > n ? `UPDATE lines SET qty = qty - ${n} WHERE ${where}` : `DELETE FROM lines WHERE ${where}`,
    key,
  );
  try {
    await lab.execute(
      `INSERT INTO lines (asset_id, oracle_id, printing_id, finish, attrs, shown_id, qty, added_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (asset_id, oracle_id, printing_id, finish, attrs, shown_id) DO UPDATE SET qty = qty + excluded.qty`,
      [to.assetId, ...columns(to.bucket), n, at],
    );
  } catch (e) {
    throw new AssetError(`${n} left but did not arrive: ${e instanceof Error ? e.message : String(e)}`);
  }
  await lab.execute("UPDATE assets SET updated_at = $2 WHERE id IN ($1, $3)", [from.assetId, at, to.assetId]);
}

/* ---------- a decklist's printings, all at once ---------- */

/** A decklist's own zones: its inline ones, named after it, and its `maybe`; never one shared with another. */
async function ownZones(lab: Sql, decklistId: string): Promise<string[]> {
  const rows = await lab.select<{ id: string }>(
    `SELECT a.id FROM assets a
      WHERE a.parent_id = $1
        AND (a.name = 'maybe' OR a.id IN (SELECT target_id FROM asset_refs WHERE asset_id = $1 AND role IN ('commander', 'main', 'side')))`,
    [decklistId],
  );
  return rows.map((r) => r.id);
}

/**
 * A change to lines' printings, as SQL over each line's own columns
 * (`lines.…`, from `$2` for `params`): which lines, and what their
 * `printing_id` and `shown_id` become.
 */
interface Rebucket {
  where: string;
  printing: string;
  shown: string;
  params?: unknown[];
}

/**
 * Apply `r` to every line of a decklist's own zones. Lines with nothing to
 * join change in one statement each zone, so no window for a failure; the
 * few that become a line already there move into it, counts added, as any
 * change of bucket does. Finishes and attributes stay. Returns how many
 * lines changed.
 */
async function rebucket(lab: Sql, decklistId: string, r: Rebucket, at: string): Promise<number> {
  const params = r.params ?? [];
  const changes = `${r.where} AND NOT (${r.printing} = lines.printing_id AND ${r.shown} = lines.shown_id)`;
  let changed = 0;
  for (const id of await ownZones(lab, decklistId)) {
    const [{ n }] = await lab.select<{ n: number }>(`SELECT COUNT(*) AS n FROM lines WHERE asset_id = $1 AND ${changes}`, [id, ...params]);
    if (!n) continue;
    await lab.execute(
      `UPDATE lines SET printing_id = ${r.printing}, shown_id = ${r.shown}
        WHERE asset_id = $1 AND ${changes}
          AND NOT EXISTS (SELECT 1 FROM lines o
                           WHERE o.asset_id = lines.asset_id AND o.oracle_id = lines.oracle_id AND o.finish = lines.finish
                             AND o.attrs = lines.attrs AND o.printing_id = ${r.printing} AND o.shown_id = ${r.shown})`,
      [id, ...params],
    );
    const rest = await lab.select<LineRow & { to_printing: string; to_shown: string }>(
      `SELECT oracle_id, printing_id, finish, attrs, shown_id, qty, ${r.printing} AS to_printing, ${r.shown} AS to_shown
         FROM lines WHERE asset_id = $1 AND ${changes}`,
      [id, ...params],
    );
    for (const l of rest) {
      const bucket = { oracleId: l.oracle_id, finish: l.finish || undefined, attrs: JSON.parse(l.attrs) as Record<string, unknown> };
      const as = (printingId: string, shownId: string): Bucket => ({
        ...bucket,
        ...(printingId && { printingId }),
        ...(shownId && { shownId }),
      });
      await moveLines(lab, null, { assetId: id, bucket: as(l.printing_id, l.shown_id) }, { assetId: id, bucket: as(l.to_printing, l.to_shown) }, l.qty, at);
    }
    await lab.execute("UPDATE assets SET updated_at = $2 WHERE id = $1", [id, at]);
    changed += n;
  }
  return changed;
}

/**
 * What a decklist's *Printings* menu does to every line
 * (docs/inventory/buckets.md → *Suggested printings*): **bind** makes each
 * suggestion the line's own printing, **unbind** each bound printing a
 * suggestion, drawn as before, and **drop** clears both, so any printing
 * will do and the stand-in is drawn.
 */
export type PrintingChange = "bind" | "unbind" | "drop";

const PRINTING_CHANGES: Record<PrintingChange, Rebucket> = {
  bind: { where: "lines.shown_id <> ''", printing: "lines.shown_id", shown: "''" },
  unbind: { where: "lines.printing_id <> ''", printing: "''", shown: "lines.printing_id" },
  drop: { where: "(lines.printing_id <> '' OR lines.shown_id <> '')", printing: "''", shown: "''" },
};

export async function changePrintings(lab: Sql, decklistId: string, change: PrintingChange, at = new Date().toISOString()): Promise<number> {
  return rebucket(lab, decklistId, PRINTING_CHANGES[change], at);
}

/** Every card a decklist's own zones name: what to look for in a set. */
export async function decklistCards(lab: Sql, store: Sql, decklistId: string): Promise<{ oracleId: string; name: string }[]> {
  const zones = await ownZones(lab, decklistId);
  if (!zones.length) return [];
  const rows = await lab.select<{ oracle_id: string }>(
    `SELECT DISTINCT oracle_id FROM lines WHERE asset_id IN (${zones.map((_, i) => `$${i + 1}`).join(", ")})`,
    zones,
  );
  const out: { oracleId: string; name: string }[] = [];
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400).map((r) => r.oracle_id);
    const names = await store.select<{ oracle_id: string; name: string }>(
      `SELECT oracle_id, MIN(name) AS name FROM cards WHERE oracle_id IN (${chunk.map((_, j) => `$${j + 1}`).join(", ")}) GROUP BY oracle_id`,
      chunk,
    );
    out.push(...names.map((n) => ({ oracleId: n.oracle_id, name: n.name })));
  }
  return out;
}

/**
 * Suggest, for every line not bound, the printing `printings` gives its
 * card — one from a set, say. A bound line is left alone: someone meant it.
 * Returns how many lines changed.
 */
export async function suggestPrintingsOf(
  lab: Sql,
  decklistId: string,
  printings: Map<string, string>,
  at = new Date().toISOString(),
): Promise<number> {
  if (!printings.size) return 0;
  const pick = `json_extract($2, '$."' || lines.oracle_id || '"')`;
  return rebucket(
    lab,
    decklistId,
    { where: `lines.printing_id = '' AND ${pick} IS NOT NULL`, printing: "''", shown: pick, params: [JSON.stringify(Object.fromEntries(printings))] },
    at,
  );
}
