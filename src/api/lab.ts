import {
  addZone,
  AssetError,
  assetTree,
  createAsset,
  createQueryPool,
  deleteAsset,
  setPoolQuery,
  type AssetNode,
} from "../lib/assets";
import { asSection, parseDecklist, type Section } from "../lib/decklist";
import { parseSavedFilters, type SavedFilters } from "../lib/filters";
import { insertRows, readLab, resolveForApi, type LabWriteOptions, type StoredBucket } from "../lib/library/labdb";
import { LibraryFormatError } from "../lib/library/v5";
import type { Asset, Bucket } from "../lib/library/v5";
import { badName, formatPath } from "../lib/paths";
import type { Sql } from "../lib/sql";

/**
 * What the agent API's lab routes do, over the lab's tables
 * (docs/agent-api.md → *Lab routes*). Assets by path, as the library file
 * names them. Cards come from the card store, and what it has never had
 * through `fetch` — the app's own channel, rate-limited — a few requests at
 * most per call.
 */

/** A refusal, with the HTTP status that says what kind. */
export class LabApiError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 503,
  ) {
    super(message);
    this.name = "LabApiError";
  }
}

/** One asset in the tree, as an agent reads it: no ids, a path. */
export interface TreeNode {
  name: string;
  path: string;
  type: string;
  query?: string;
  filters?: SavedFilters;
  children: TreeNode[];
}

export async function tree(lab: Sql): Promise<TreeNode[]> {
  const out = (nodes: AssetNode[]): TreeNode[] =>
    nodes.map((n) => ({
      name: n.name,
      path: formatPath(n.path),
      type: n.type,
      ...(n.query !== undefined && { query: n.query }),
      ...(n.filters !== undefined && { filters: n.filters }),
      children: out(n.children),
    }));
  return out(await assetTree(lab));
}

/** The asset at `names`, as the library file's object. */
export async function assetAt(lab: Sql, cards: Sql, names: string[]): Promise<Asset> {
  if (!names.length) throw new LabApiError("The root is not an asset: read /lab/tree.", 400);
  const [found] = (await readLab(lab, cards, { only: names })).assets;
  if (!found) throw new LabApiError(`Nothing at ${formatPath(names)}.`, 404);
  return found;
}

async function nodeAt(lab: Sql, names: string[]): Promise<{ id: string; type: string } | null> {
  let at: { id: string; type: string } = { id: "root", type: "folder" };
  for (const name of names) {
    const [next] = await lab.select<{ id: string; type: string }>(
      "SELECT id, type FROM assets WHERE parent_id = $1 AND name = $2",
      [at.id, name],
    );
    if (!next) return null;
    at = next;
  }
  return at;
}

/** The type of what is at `names`, or null: what a text body is read as. */
export async function typeAt(lab: Sql, names: string[]): Promise<string | null> {
  return names.length ? ((await nodeAt(lab, names))?.type ?? null) : null;
}

/* ---------- bodies ---------- */

/** A pool as a `PUT` gives it: members, or a query. */
export type PoolBody = { type: "list pool"; cards: Bucket[] } | { type: "query pool"; query: string; filters?: SavedFilters };

/** The zones a decklist `PUT` may write. `maybe` is not a zone but the decklist's `maybe` checklist. */
export const DECK_ZONES = ["commander", "main", "side", "maybe"] as const satisfies readonly Section[];
export type DeckZone = (typeof DECK_ZONES)[number];

export interface CountLine {
  bucket: Bucket;
  qty: number;
}

/** A decklist as a `PUT` gives it: the zones it names, each whole. A zone left out is left alone. */
export interface DecklistBody {
  type: "decklist";
  format?: string;
  zones: Partial<Record<DeckZone, CountLine[]>>;
}

export type PutBody = PoolBody | DecklistBody;

/** Fetching what the card store has never had: the app's channel. Absent, nothing is fetched. */
export type Fetch = LabWriteOptions["fetchMissing"];

const MEMBER_KEYS = ["card", "oracle", "set", "number", "lang", "finish"];

const bad = (why: string): never => {
  throw new LabApiError(why, 400);
};

/** One card line from JSON, any of its keys saying which card; `extra` keys are the caller's. */
function bucketFromJson(raw: unknown, where: string, extra: string[] = []): { bucket: Bucket; m: Record<string, unknown> } {
  if (typeof raw !== "object" || raw === null) return bad(`${where} must be an object.`);
  const m = raw as Record<string, unknown>;
  for (const k of Object.keys(m)) if (!MEMBER_KEYS.includes(k) && !extra.includes(k)) bad(`${where}: unknown key \`${k}\`.`);
  for (const k of MEMBER_KEYS) if (m[k] !== undefined && typeof m[k] !== "string") bad(`${where}.${k} must be a string.`);
  const s = (k: string) => m[k] as string | undefined;
  if (!s("card") && !s("oracle") && !s("set")) bad(`${where} must say which card: \`card\`, \`oracle\`, or \`set\` and \`number\`.`);
  if (!!s("set") !== !!s("number")) bad(`${where}: a printing needs both \`set\` and \`number\`.`);
  return {
    m,
    bucket: {
      ...(s("card") && { card: s("card") }),
      ...(s("oracle") && { oracle: s("oracle") }),
      ...(s("set") && { printing: { set: s("set")!.toLowerCase(), number: s("number")!, lang: s("lang") ?? "en" } }),
      ...(s("finish") && { finish: s("finish") }),
      attrs: {},
    },
  };
}

/**
 * A body from JSON: `{ type: "list pool", cards: [{ card, oracle, set,
 * number, lang, finish }] }`, any of the card's keys saying which; `{ type:
 * "query pool", query, filters? }` — `filters` as *More filters* sets them
 * (`SavedFilters`); or `{ type: "decklist", format?, zones: { commander,
 * main, side, maybe } }`, each zone's lines a card's keys plus `qty`.
 * Attributes are not taken yet.
 */
export function bodyFromJson(json: unknown): PutBody {
  if (typeof json !== "object" || json === null) return bad("The body must be a JSON object.");
  const o = json as Record<string, unknown>;
  const only = (keys: string[]) => {
    for (const k of Object.keys(o)) if (!keys.includes(k)) bad(`A ${String(o.type)}: unknown key \`${k}\`.`);
  };
  if (o.type === "query pool") {
    only(["type", "query", "filters"]);
    if (typeof o.query !== "string") return bad("A query pool needs `query`, a string.");
    return {
      type: "query pool",
      query: o.query,
      ...(o.filters !== undefined && { filters: parseSavedFilters(o.filters, bad) }),
    };
  }
  if (o.type === "list pool") {
    only(["type", "cards"]);
    if (!Array.isArray(o.cards)) return bad("A list pool needs `cards`, an array.");
    return { type: "list pool", cards: o.cards.map((raw, i) => bucketFromJson(raw, `cards[${i}]`).bucket) };
  }
  if (o.type === "decklist") {
    only(["type", "format", "zones"]);
    if (o.format !== undefined && typeof o.format !== "string") bad("`format` must be a string.");
    if (typeof o.zones !== "object" || o.zones === null || Array.isArray(o.zones)) return bad("A decklist needs `zones`, an object.");
    const zones: DecklistBody["zones"] = {};
    for (const [zone, lines] of Object.entries(o.zones)) {
      if (!(DECK_ZONES as readonly string[]).includes(zone)) bad(`zones: unknown zone \`${zone}\` — ${DECK_ZONES.join(", ")}.`);
      if (!Array.isArray(lines)) bad(`zones.${zone} must be an array.`);
      zones[zone as DeckZone] = (lines as unknown[]).map((raw, i) => {
        const where = `zones.${zone}[${i}]`;
        const { bucket, m } = bucketFromJson(raw, where, ["qty"]);
        const qty = m.qty ?? 1;
        if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) bad(`${where}.qty must be a whole number of at least 1.`);
        return { bucket, qty: qty as number };
      });
    }
    return { type: "decklist", ...(o.format !== undefined && { format: o.format as string }), zones };
  }
  return bad('`type` must be "list pool", "query pool" or "decklist".');
}

/** A text line's card: a printing pinned by `(SET) 123`, foil by `*F*`. */
function textBucket(l: { name: string; setCode?: string; collectorNumber?: string; foil?: boolean }): Bucket {
  return {
    card: l.name,
    ...(l.setCode && l.collectorNumber && { printing: { set: l.setCode.toLowerCase(), number: l.collectorNumber, lang: "en" } }),
    ...(l.foil && { finish: "foil" }),
    attrs: {},
  };
}

function parsed(text: string) {
  const result = parseDecklist(text);
  if (result.skipped.length) throw new LabApiError(`Lines not understood:\n${result.skipped.slice(0, 10).join("\n")}`, 400);
  return result;
}

/**
 * A list pool from a decklist, as an import reads one: a card per line,
 * counts ignored — a pool has none — and `(SET) 123` pinning a printing.
 */
export function poolFromText(text: string): PoolBody {
  return { type: "list pool", cards: parsed(text).lines.map(textBucket) };
}

/**
 * A decklist from text: `Commander`, `Deck`, `Sideboard` and `Maybeboard`
 * headers (and the usual others), lines before any header in `main`. The
 * zones it names are written whole, an empty header emptying its zone; one
 * it does not name is left alone.
 */
export function decklistFromText(text: string): DecklistBody {
  const { lines } = parsed(text);
  const named = new Set<DeckZone>(lines.map((l) => l.section));
  for (const raw of text.split(/\r?\n/)) {
    const s = asSection(raw.trim());
    if (s && s !== "ignore") named.add(s);
  }
  const zones: DecklistBody["zones"] = {};
  for (const zone of named) {
    zones[zone] = lines.filter((l) => l.section === zone).map((l) => ({ bucket: textBucket(l), qty: l.quantity }));
  }
  return { type: "decklist", zones };
}

/* ---------- writing ---------- */

type Row = StoredBucket & { qty?: number; added_at?: string | null };

const rowKey = (s: StoredBucket) => JSON.stringify([s.oracle_id, s.printing_id, s.finish, s.attrs]);

/**
 * Make an asset's rows — a pool's members, or a checklist's lines with their
 * counts — exactly `wanted`, in a few statements, not one a row: the plugin
 * holds no transaction, so fewer is a shorter window for a failure to leave
 * it half replaced. A row kept keeps when it was added, its count changed
 * or not. Returns whether anything changed.
 */
async function replaceRows(
  lab: Sql,
  table: "lines" | "pool_members",
  assetId: string,
  wanted: Map<string, Row>,
  at: string,
): Promise<boolean> {
  const counted = table === "lines";
  const had = await lab.select<Row>(
    `SELECT oracle_id, printing_id, finish, attrs, added_at${counted ? ", qty" : ""} FROM ${table} WHERE asset_id = $1`,
    [assetId],
  );
  const gone: Row[] = [];
  const fresh = new Map(wanted);
  for (const h of had) {
    const w = fresh.get(rowKey(h));
    if (!w) gone.push(h);
    else if (counted && Number(h.qty) !== w.qty) {
      // A new count: out, and back in with its old date.
      gone.push(h);
      fresh.set(rowKey(h), { ...w, added_at: h.added_at });
    } else fresh.delete(rowKey(h));
  }
  for (let i = 0; i < gone.length; i += 200) {
    const chunk = gone.slice(i, i + 200);
    await lab.execute(
      `DELETE FROM ${table} WHERE asset_id = $1 AND (oracle_id, printing_id, finish, attrs) IN (VALUES ${chunk
        .map((_, j) => `($${4 * j + 2}, $${4 * j + 3}, $${4 * j + 4}, $${4 * j + 5})`)
        .join(", ")})`,
      [assetId, ...chunk.flatMap((h) => [h.oracle_id, h.printing_id, h.finish, h.attrs])],
    );
  }
  const columns = ["asset_id", "oracle_id", "printing_id", "finish", "attrs", "added_at", ...(counted ? ["qty"] : [])];
  await insertRows(
    lab,
    table,
    columns,
    [...fresh.values()].map((s) => [
      assetId,
      s.oracle_id,
      s.printing_id,
      s.finish,
      s.attrs,
      s.added_at === undefined ? at : s.added_at,
      ...(counted ? [s.qty] : []),
    ]),
  );
  const changed = gone.length > 0 || fresh.size > 0;
  if (changed) await lab.execute("UPDATE assets SET updated_at = $2 WHERE id = $1", [assetId, at]);
  return changed;
}

function checkNames(names: string[], what: string) {
  if (!names.length) throw new LabApiError(`${what} needs a path.`, 400);
  for (const n of names) {
    const why = badName(n);
    if (why) throw new LabApiError(`${formatPath(names)}: ${why}.`, 400);
  }
}

/** The asset at `names` of `type`, made — and any folders above it — if missing. */
async function ensure(
  lab: Sql,
  names: string[],
  type: string,
  make: (parent: string, name: string) => Promise<string>,
  at: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await nodeAt(lab, names);
  if (existing && existing.type !== type) {
    throw new LabApiError(`${formatPath(names)} is a ${existing.type}, not a ${type}.`, 409);
  }
  if (existing) return { id: existing.id, created: false };
  let parent = "root";
  for (let i = 0; i < names.length - 1; i++) {
    parent = (await nodeAt(lab, names.slice(0, i + 1)))?.id ?? (await createAsset(lab, parent, "folder", { name: names[i], at }));
  }
  return { id: await make(parent, names[names.length - 1]), created: true };
}

/**
 * Create or replace the pool at `names`: a list pool's members — those
 * kept keep when they were added — or a query pool's query. Folders above
 * it are made where missing. Every card is settled before the first write.
 */
export async function putPool(
  lab: Sql,
  cards: Sql,
  names: string[],
  body: PoolBody,
  { fetch, at = new Date().toISOString() }: { fetch?: Fetch; at?: string } = {},
): Promise<{ created: boolean; members?: number }> {
  checkNames(names, "A pool");
  const resolve = body.type === "list pool" ? await resolveForApi(body.cards, cards, fetch ?? null).catch(refuse) : null;
  if (body.type === "query pool") {
    const { id, created } = await ensure(
      lab,
      names,
      "query pool",
      (parent, name) => createQueryPool(lab, parent, body.query, { name, at, filters: body.filters }),
      at,
    );
    if (!created) await setPoolQuery(lab, id, body.query, { filters: body.filters, at });
    return { created };
  }
  const { id, created } = await ensure(lab, names, "list pool", (parent, name) => createAsset(lab, parent, "list pool", { name, at }), at);
  const wanted = new Map(body.cards.map((b) => resolve!(b)).map((s) => [rowKey(s), s as Row]));
  await replaceRows(lab, "pool_members", id, wanted, at);
  const [{ n }] = await lab.select<{ n: number }>("SELECT COUNT(*) AS n FROM pool_members WHERE asset_id = $1", [id]);
  return { created, members: n };
}

/**
 * Create or replace the decklist at `names`, zone by zone: each zone the
 * body names is made exactly its lines — those kept keep when they were
 * added — and the rest are left alone. A zone is written only where it is
 * the decklist's own (its inline child, named after the zone), never one
 * shared with another decklist; `maybe` is its `maybe` checklist.
 * Every card is settled before the first write.
 */
export async function putDecklist(
  lab: Sql,
  cards: Sql,
  names: string[],
  body: DecklistBody,
  { fetch, at = new Date().toISOString() }: { fetch?: Fetch; at?: string } = {},
): Promise<{ created: boolean; zones: Partial<Record<DeckZone, number>> }> {
  checkNames(names, "A decklist");
  const all = Object.values(body.zones).flat();
  const resolve = await resolveForApi(all.map((l) => l.bucket), cards, fetch ?? null).catch(refuse);

  // Where each zone goes, settled before anything is written.
  const existing = await nodeAt(lab, names);
  if (existing && existing.type !== "decklist") {
    throw new LabApiError(`${formatPath(names)} is a ${existing.type}, not a decklist.`, 409);
  }
  const targets = new Map<DeckZone, string | null>();
  for (const zone of Object.keys(body.zones) as DeckZone[]) {
    targets.set(zone, existing ? await zoneTarget(lab, existing.id, names, zone) : null);
  }

  const { id, created } = await ensure(lab, names, "decklist", (parent, name) => createAsset(lab, parent, "decklist", { name, at }), at);
  if (body.format !== undefined) {
    await lab.execute("UPDATE assets SET format = $2, updated_at = $3 WHERE id = $1", [id, body.format || null, at]);
  }
  const counts: Partial<Record<DeckZone, number>> = {};
  for (const [zone, lines] of Object.entries(body.zones) as [DeckZone, CountLine[]][]) {
    // A new decklist comes with its main; any other zone is made here.
    let target = targets.get(zone) ?? (created ? await zoneTarget(lab, id, names, zone) : null);
    if (!target) {
      if (zone === "maybe") target = await createAsset(lab, id, "checklist", { name: "maybe", at });
      else {
        await addZone(lab, id, zone, "exact checklist", at);
        target = (await nodeAt(lab, [...names, zone]))!.id;
      }
    }
    const wanted = new Map<string, Row>();
    for (const l of lines) {
      const s = resolve(l.bucket);
      const prior = wanted.get(rowKey(s));
      wanted.set(rowKey(s), { ...s, qty: (prior?.qty ?? 0) + l.qty });
    }
    if (await replaceRows(lab, "lines", target, wanted, at)) {
      await lab.execute("UPDATE assets SET updated_at = $2 WHERE id = $1", [id, at]);
    }
    counts[zone] = lines.reduce((n, l) => n + l.qty, 0);
  }
  return { created, zones: counts };
}

/**
 * The asset a decklist's zone is written to, when it has one: its own, an
 * inline child named after the zone. Null when it has none yet. A zone
 * that names anything else — a checklist shared with another decklist — is
 * refused, as is a child of that name that is not the zone.
 */
async function zoneTarget(lab: Sql, decklistId: string, names: string[], zone: DeckZone): Promise<string | null> {
  const where = formatPath([...names, zone]);
  const child = await nodeAt(lab, [...names, zone]);
  if (zone === "maybe") {
    if (child && child.type !== "checklist") throw new LabApiError(`${where} is a ${child.type}, not the maybeboard's checklist.`, 409);
    return child?.id ?? null;
  }
  const [ref] = await lab.select<{ target_id: string | null; path: string | null }>(
    "SELECT target_id, path FROM asset_refs WHERE asset_id = $1 AND role = $2",
    [decklistId, zone],
  );
  if (ref && (ref.target_id === null || ref.target_id !== child?.id)) {
    throw new LabApiError(
      `${formatPath(names)}: its ${zone} is not its own but names another asset; change that one, or the zone, in the app.`,
      409,
    );
  }
  if (!ref && child) throw new LabApiError(`${where} is there, but is not the decklist's ${zone}.`, 409);
  return ref ? child!.id : null;
}

/* ---------- reading as text ---------- */

const HEADINGS: [DeckZone, string][] = [
  ["commander", "Commander"],
  ["main", "Deck"],
  ["side", "Sideboard"],
  ["maybe", "Maybeboard"],
];

function textLine(qty: number, b: Bucket): string {
  const printing = b.printing ? ` (${b.printing.set.toUpperCase()}) ${b.printing.number}` : "";
  const finish = b.finish === "foil" ? " *F*" : b.finish === "etched" ? " *E*" : "";
  return `${qty} ${b.card ?? b.oracle}${printing}${finish}`;
}

/**
 * A decklist as text, the way `PUT` takes one: a heading per zone it has,
 * then its maybeboard. Attributes are not written.
 */
export async function decklistText(lab: Sql, cards: Sql, names: string[]): Promise<string> {
  const me = await assetAt(lab, cards, names);
  if (me.type !== "decklist") throw new LabApiError(`${formatPath(names)} is a ${me.type}: only a decklist reads as text.`, 400);
  const blocks: string[] = [];
  for (const [zone, heading] of HEADINGS) {
    let at: string[] | undefined;
    if (zone === "maybe") at = [...names, "maybe"];
    else {
      const ref = me.zones[zone];
      if (ref) at = ref.rooted ? ref.names : [...names, ...ref.names];
    }
    if (!at) continue;
    const [asset] = (await readLab(lab, cards, { only: at })).assets;
    if (!asset || !("cards" in asset)) continue;
    const lines = (asset.cards as { bucket: Bucket; qty?: number; min?: number }[]).map((l) =>
      textLine(l.qty ?? l.min ?? 1, l.bucket),
    );
    if (lines.length || zone !== "maybe") blocks.push([heading, ...lines].join("\n"));
  }
  return blocks.join("\n\n") + "\n";
}

/* ---------- deleting ---------- */

/**
 * Delete the asset at `names` and everything below it, as the tree does:
 * refused while something outside pins it. Refused too where copies are
 * recorded below it — a place's or a deck's cards are the user's to drop,
 * in the app, not an agent's.
 */
export async function deleteAt(lab: Sql, names: string[]): Promise<void> {
  if (!names.length) throw new LabApiError("The root cannot be deleted.", 400);
  const node = await nodeAt(lab, names);
  if (!node) throw new LabApiError(`Nothing at ${formatPath(names)}.`, 404);
  const [{ n }] = await lab.select<{ n: number }>(
    `WITH RECURSIVE below(id) AS (
       SELECT $1 UNION ALL SELECT a.id FROM assets a JOIN below b ON a.parent_id = b.id
     )
     SELECT COUNT(*) AS n FROM lines l JOIN assets a ON a.id = l.asset_id
      WHERE a.id IN (SELECT id FROM below) AND a.type = 'place'`,
    [node.id],
  );
  if (n) {
    throw new LabApiError(`${formatPath(names)}: copies are recorded in it or below it. Delete those in the app.`, 409);
  }
  try {
    await deleteAsset(lab, node.id);
  } catch (e) {
    if (e instanceof AssetError) throw new LabApiError(e.message, 409);
    throw e;
  }
}

/**
 * A card no one can settle is the caller's mistake; Scryfall not answering
 * is no one's, and worth trying again later — never at once.
 */
function refuse(e: unknown): never {
  if (e instanceof LibraryFormatError) throw new LabApiError(e.message, 400);
  throw new LabApiError(`Could not fetch cards from Scryfall: ${e instanceof Error ? e.message : String(e)}. Try again later, not at once.`, 503);
}
