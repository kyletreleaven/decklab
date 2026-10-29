import { rowToCard, type CardRow } from "./db";
import { badName, parseRef, pathKey } from "./paths";
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
    // No order of their own: by name, as a reader expects.
    "SELECT id, parent_id, name, type FROM assets WHERE id <> 'root' ORDER BY name COLLATE NOCASE, name",
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
  for (const [oracle, ls] of byOracle) {
    const d = drawn.get(oracle);
    const card = d && cards.get(d.id);
    if (!d || !card) continue; // not in the store: the load would have refused it
    out.push({
      oracleId: oracle,
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
 * A place's, checklist's or exact checklist's lines, one tile per card. The
 * count is the same number for each; the type says what it means: held, at
 * least, exactly.
 */
export async function lineContents(lab: Sql, store: Sql, id: string, layers = [scryfallLayer(store)]): Promise<Tile[]> {
  const lines = await lab.select<LineRow>(
    "SELECT oracle_id, printing_id, finish, attrs, qty FROM lines WHERE asset_id = $1",
    [id],
  );
  return tiles(store, lines, layers);
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
      ...(target && { target: { id: target.id, path: target.path, type: target.type } }),
      tiles: target ? await lineContents(lab, store, target.id, layers) : [],
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
  const siblings = await lab.select<{ name: string }>(
    "SELECT name FROM assets WHERE parent_id = $1",
    [parentId],
  );
  const taken = new Set(siblings.map((s) => s.name));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  const id = crypto.randomUUID();
  await lab.execute(
    `INSERT INTO assets (id, parent_id, name, type, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [id, parentId, name, type, at],
  );
  if (type === "decklist") await addZone(lab, id, "main", "exact checklist", at);
  return id;
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
