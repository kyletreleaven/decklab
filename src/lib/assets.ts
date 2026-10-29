import { rowToCard, type CardRow } from "./db";
import { badName, parseRef, pathKey } from "./paths";
import type { Sql } from "./sql";
import { scryfallLayer, standIns, type Layer } from "./standIn";
import type { Card } from "./types";
import { isA, type AssetType } from "./ontology";

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
}

/** The asset tree, below the root, siblings in order. */
export async function assetTree(lab: Sql): Promise<AssetNode[]> {
  const rows = await lab.select<{ id: string; parent_id: string | null; name: string; type: AssetType; query: string | null }>(
    // No order of their own: by name, as a reader expects.
    "SELECT id, parent_id, name, type, query FROM assets WHERE id <> 'root' ORDER BY name COLLATE NOCASE, name",
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
  qty: number;
}

/**
 * Lines as tiles, sorted by name. A tile draws the printing it holds most
 * copies of; one whose buckets name no printing draws the stand-in.
 */
async function tiles(store: Sql, lines: LineRow[], layers: Layer[], perLine = false): Promise<Tile[]> {
  // Keyed by card, or — a tile per line — by bucket; either way each key's
  // lines are one card's.
  const byKey = new Map<string, LineRow[]>();
  for (const l of lines) {
    const k = perLine ? JSON.stringify([l.oracle_id, l.printing_id, l.finish, l.attrs]) : l.oracle_id;
    byKey.set(k, [...(byKey.get(k) ?? []), l]);
  }

  // Drawn printings by key; a stand-in is the card's, whichever key asks.
  const drawn = new Map<string, { id: string; standIn: boolean }>();
  const unprinted = new Set<string>();
  for (const [key, ls] of byKey) {
    const perPrinting = new Map<string, number>();
    for (const l of ls) if (l.printing_id !== "") perPrinting.set(l.printing_id, (perPrinting.get(l.printing_id) ?? 0) + l.qty);
    const most = [...perPrinting].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    if (most) drawn.set(key, { id: most[0], standIn: false });
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
        qty: l.qty,
      })),
    });
  }
  return out.sort((a, b) => a.card.name.localeCompare(b.card.name));
}

/**
 * A place's, checklist's or exact checklist's lines: one tile per card, or
 * `perLine`, one per line. The count is the same number for each; the type
 * says what it means: held, at least, exactly. A checklist is drawn per line:
 * its lines can overlap — at least four Bolts, at least one of them M10 —
 * so a card's total is a number nobody asked for.
 */
export async function lineContents(
  lab: Sql,
  store: Sql,
  id: string,
  { perLine = false, layers = [scryfallLayer(store)] }: { perLine?: boolean; layers?: Layer[] } = {},
): Promise<Tile[]> {
  const lines = await lab.select<LineRow>(
    "SELECT oracle_id, printing_id, finish, attrs, qty FROM lines WHERE asset_id = $1",
    [id],
  );
  return tiles(store, lines, layers, perLine);
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
        ? await lineContents(lab, store, target.id, { layers, perLine: perLine && isA(target.type, "checklist") })
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
export const CREATABLE = ["folder", "place", "checklist", "list pool", "decklist"] as const;
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
  checklist: "New checklist",
  "list pool": "New pool",
  decklist: "New decklist",
  deck: "New deck",
};

/** A child of `parentId` called `zone`, of `type`, as its owner's zone. */
async function addZone(lab: Sql, ownerId: string, zone: string, type: "place" | "exact checklist", at: string): Promise<void> {
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
async function freeName(lab: Sql, parentId: string, base: string): Promise<string> {
  const siblings = await lab.select<{ name: string }>("SELECT name FROM assets WHERE parent_id = $1", [parentId]);
  const taken = new Set(siblings.map((s) => s.name));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  return name;
}

/**
 * A query pool: a search kept, as its query — Scryfall syntax, what the
 * pool panel runs — not its results, so saving one sends no requests. Named
 * after the query unless told otherwise. Returns its id.
 */
export async function createQueryPool(
  lab: Sql,
  parentId: string,
  query: string,
  { name, at = new Date().toISOString() }: { name?: string; at?: string } = {},
): Promise<string> {
  const text = query.trim();
  const base = (name ?? (text.length > 40 ? `${text.slice(0, 39).trimEnd()}…` : text)) || "Saved search";
  const id = crypto.randomUUID();
  await lab.execute(
    `INSERT INTO assets (id, parent_id, name, type, created_at, updated_at, query)
     VALUES ($1, $2, $3, 'query pool', $4, $4, $5)`,
    [id, parentId, await freeName(lab, parentId, base), at, text],
  );
  return id;
}

/** Replace a query pool's query: its Save. */
export async function setPoolQuery(lab: Sql, id: string, query: string, at = new Date().toISOString()): Promise<void> {
  const [me] = await lab.select<{ type: string }>("SELECT type FROM assets WHERE id = $1", [id]);
  if (me?.type !== "query pool") throw new AssetError("Only a query pool has a query.");
  await lab.execute("UPDATE assets SET query = $2, updated_at = $3 WHERE id = $1", [id, query.trim(), at]);
}

/**
 * What converting can make of an asset: a checklist of a place (its lines
 * read as minimums); a place of either checklist (as held); and a checklist
 * exact or not. Lines stay as they are: one table holds them all, so it is a
 * change of type, in one statement (docs/inventory.md → *Kinds of
 * checklist*).
 */
export const CONVERSIONS: Partial<Record<AssetType, AssetType[]>> = {
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
  await lab.execute("UPDATE assets SET type = $2, updated_at = $3 WHERE id = $1", [id, to, at]);
}

/**
 * Rename an asset. Pinned references follow it; by-name ones keep the old
 * name, which is what *by name* means (docs/inventory.md → *Naming a set in
 * a query*).
 */
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
}

/** A bucket as its four columns, `absent` as the schema stores it. */
function columns(b: Bucket): [string, string, string, string] {
  const attrs = Object.fromEntries(Object.entries(b.attrs ?? {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  return [b.oracleId, b.printingId ?? "", b.finish ?? "", JSON.stringify(attrs)];
}

/** A bucket's identity: equal keys, one bucket. */
export const bucketKey = (b: Bucket): string => JSON.stringify(columns(b));

/** A list pool's members, by `bucketKey`. */
export type Members = Set<string>;

export async function poolMembers(lab: Sql, poolId: string): Promise<Members> {
  const rows = await lab.select<{ oracle_id: string; printing_id: string; finish: string; attrs: string }>(
    "SELECT oracle_id, printing_id, finish, attrs FROM pool_members WHERE asset_id = $1",
    [poolId],
  );
  return new Set(rows.map((r) => JSON.stringify([r.oracle_id, r.printing_id, r.finish, r.attrs])));
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
    `INSERT OR IGNORE INTO pool_members (asset_id, oracle_id, printing_id, finish, attrs, added_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [poolId, ...columns(bucket), at],
  );
  await lab.execute("UPDATE assets SET updated_at = $2 WHERE id = $1", [poolId, at]);
}

/** Take a bucket out of a pool: that bucket only, not the card's others. */
export async function removeMember(lab: Sql, poolId: string, bucket: Bucket, at = new Date().toISOString()): Promise<void> {
  await requireListPool(lab, poolId);
  await lab.execute(
    `DELETE FROM pool_members
      WHERE asset_id = $1 AND oracle_id = $2 AND printing_id = $3 AND finish = $4 AND attrs = $5`,
    [poolId, ...columns(bucket)],
  );
  await lab.execute("UPDATE assets SET updated_at = $2 WHERE id = $1", [poolId, at]);
}

/**
 * A list pool's members, one tile per card. Membership has no count: a
 * tile's `count` is how many of the card's buckets are members, and its
 * buckets say which.
 */
export async function memberContents(lab: Sql, store: Sql, poolId: string, layers = [scryfallLayer(store)]): Promise<Tile[]> {
  const lines = await lab.select<LineRow>(
    "SELECT oracle_id, printing_id, finish, attrs, 1 AS qty FROM pool_members WHERE asset_id = $1",
    [poolId],
  );
  return tiles(store, lines, layers);
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
  const rows = await lab.select<{ oracle_id: string; printing_id: string; finish: string; attrs: string; qty: number }>(
    target.type === "list pool"
      ? "SELECT oracle_id, printing_id, finish, attrs, 1 AS qty FROM pool_members WHERE asset_id = $1"
      : "SELECT oracle_id, printing_id, finish, attrs, qty FROM lines WHERE asset_id = $1",
    [target.id],
  );
  return new Map(rows.map((r) => [JSON.stringify([r.oracle_id, r.printing_id, r.finish, r.attrs]), r.qty]));
}

/**
 * One more, or one fewer, of a bucket's line: created at 1, gone at 0. Fewer
 * of a line there is none of is refused.
 */
export async function stepLine(lab: Sql, id: string, bucket: Bucket, delta: 1 | -1, at = new Date().toISOString()): Promise<void> {
  const [me] = await lab.select<{ type: AssetType }>("SELECT type FROM assets WHERE id = $1", [id]);
  if (!me || me.type === "list pool" || !TARGETABLE.has(me.type)) throw new AssetError("Only a place or checklist counts copies.");
  const key = [id, ...columns(bucket)];
  const where = "asset_id = $1 AND oracle_id = $2 AND printing_id = $3 AND finish = $4 AND attrs = $5";
  if (delta > 0) {
    await lab.execute(
      `INSERT INTO lines (asset_id, oracle_id, printing_id, finish, attrs, qty, added_at)
       VALUES ($1, $2, $3, $4, $5, 1, $6)
       ON CONFLICT (asset_id, oracle_id, printing_id, finish, attrs) DO UPDATE SET qty = qty + 1`,
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

/**
 * One copy of a bucket from one place to another: a card is in one place at
 * a time. Two writes the plugin cannot make one transaction, so the copy
 * leaves first — a failure between leaves it in neither, and says so, rather
 * than in both silently. Move transactions are parked (TODO).
 */
export async function moveCopy(lab: Sql, fromId: string, toId: string, bucket: Bucket, at = new Date().toISOString()): Promise<void> {
  const kinds = await lab.select<{ id: string; type: AssetType }>("SELECT id, type FROM assets WHERE id IN ($1, $2)", [fromId, toId]);
  if (fromId === toId || kinds.length !== 2 || kinds.some((k) => k.type !== "place"))
    throw new AssetError("A copy moves from one place to another.");
  await stepLine(lab, fromId, bucket, -1, at);
  try {
    await stepLine(lab, toId, bucket, 1, at);
  } catch (e) {
    throw new AssetError(`The copy left but did not arrive: ${e instanceof Error ? e.message : String(e)}`);
  }
}
