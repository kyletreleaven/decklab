import { assetTree, createAsset, createQueryPool, setPoolQuery, type AssetNode } from "../lib/assets";
import { parseDecklist } from "../lib/decklist";
import { parseSavedFilters, type SavedFilters } from "../lib/filters";
import { insertRows, readLab, resolveLocally } from "../lib/library/labdb";
import type { Asset, Bucket } from "../lib/library/v5";
import { badName, formatPath } from "../lib/paths";
import type { Sql } from "../lib/sql";

/**
 * What the agent API's lab routes do, over the lab's tables
 * (docs/agent-api.md → *Lab routes*). Assets by path, as the library file
 * names them; cards from the card store only, so nothing here sends a
 * request.
 */

/** A refusal, with the HTTP status that says what kind. */
export class LabApiError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
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

/** A pool as a `PUT` gives it: members, or a query. */
export type PoolBody = { type: "list pool"; cards: Bucket[] } | { type: "query pool"; query: string; filters?: SavedFilters };

const MEMBER_KEYS = new Set(["card", "oracle", "set", "number", "lang", "finish"]);

/**
 * A pool from JSON: `{ type: "list pool", cards: [{ card, oracle, set,
 * number, lang, finish }] }`, any of the card's keys saying which, or `{
 * type: "query pool", query, filters? }` — `filters` as *More filters* sets
 * them (`SavedFilters`). Attributes are not taken yet.
 */
export function poolFromJson(json: unknown): PoolBody {
  const bad = (why: string): never => {
    throw new LabApiError(why, 400);
  };
  if (typeof json !== "object" || json === null) return bad("The body must be a JSON object.");
  const o = json as Record<string, unknown>;
  if (o.type === "query pool") {
    if (typeof o.query !== "string") return bad("A query pool needs `query`, a string.");
    for (const k of Object.keys(o)) if (!["type", "query", "filters"].includes(k)) bad(`A query pool: unknown key \`${k}\`.`);
    return {
      type: "query pool",
      query: o.query,
      ...(o.filters !== undefined && { filters: parseSavedFilters(o.filters, bad) }),
    };
  }
  if (o.type !== "list pool") return bad('`type` must be "list pool" or "query pool": only pools can be written yet.');
  if (!Array.isArray(o.cards)) return bad("A list pool needs `cards`, an array.");
  const cards = o.cards.map((raw, i): Bucket => {
    const where = `cards[${i}]`;
    if (typeof raw !== "object" || raw === null) return bad(`${where} must be an object.`);
    const m = raw as Record<string, unknown>;
    for (const k of Object.keys(m)) if (!MEMBER_KEYS.has(k)) bad(`${where}: unknown key \`${k}\`.`);
    for (const k of MEMBER_KEYS) if (m[k] !== undefined && typeof m[k] !== "string") bad(`${where}.${k} must be a string.`);
    const s = (k: string) => m[k] as string | undefined;
    if (!s("card") && !s("oracle") && !s("set")) bad(`${where} must say which card: \`card\`, \`oracle\`, or \`set\` and \`number\`.`);
    if (!!s("set") !== !!s("number")) bad(`${where}: a printing needs both \`set\` and \`number\`.`);
    return {
      ...(s("card") && { card: s("card") }),
      ...(s("oracle") && { oracle: s("oracle") }),
      ...(s("set") && { printing: { set: s("set")!.toLowerCase(), number: s("number")!, lang: s("lang") ?? "en" } }),
      ...(s("finish") && { finish: s("finish") }),
      attrs: {},
    };
  });
  return { type: "list pool", cards };
}

/**
 * A list pool from a decklist, as an import reads one: a card per line,
 * counts ignored — a pool has none — and `(SET) 123` pinning a printing.
 */
export function poolFromText(text: string): PoolBody {
  const { lines, skipped } = parseDecklist(text);
  if (skipped.length) throw new LabApiError(`Lines not understood:\n${skipped.slice(0, 10).join("\n")}`, 400);
  return {
    type: "list pool",
    cards: lines.map((l) => ({
      card: l.name,
      ...(l.setCode &&
        l.collectorNumber && { printing: { set: l.setCode.toLowerCase(), number: l.collectorNumber, lang: "en" } }),
      ...(l.foil && { finish: "foil" }),
      attrs: {},
    })),
  };
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
  at = new Date().toISOString(),
): Promise<{ created: boolean; members?: number }> {
  if (!names.length) throw new LabApiError("A pool needs a path.", 400);
  for (const n of names) {
    const why = badName(n);
    if (why) throw new LabApiError(`${formatPath(names)}: ${why}.`, 400);
  }
  const resolve = body.type === "list pool" ? await resolveLocally(body.cards, cards).catch(refuse) : null;

  const existing = await nodeAt(lab, names);
  if (existing && existing.type !== body.type) {
    throw new LabApiError(`${formatPath(names)} is a ${existing.type}, not a ${body.type}.`, 409);
  }
  let id = existing?.id;
  if (!id) {
    let parent = "root";
    for (let i = 0; i < names.length - 1; i++) {
      parent = (await nodeAt(lab, names.slice(0, i + 1)))?.id ?? (await createAsset(lab, parent, "folder", { name: names[i], at }));
    }
    const name = names[names.length - 1];
    id =
      body.type === "query pool"
        ? await createQueryPool(lab, parent, body.query, { name, at, filters: body.filters })
        : await createAsset(lab, parent, "list pool", { name, at });
  } else if (body.type === "query pool") {
    await setPoolQuery(lab, id, body.query, { filters: body.filters, at });
  }
  if (body.type === "query pool") return { created: !existing };

  // Members: what goes, then what is new. Those kept are left alone.
  const key = (s: { oracle_id: string; printing_id: string; finish: string; attrs: string }) =>
    JSON.stringify([s.oracle_id, s.printing_id, s.finish, s.attrs]);
  const wanted = new Map(body.cards.map((b) => resolve!(b)).map((s) => [key(s), s]));
  const had = await lab.select<{ oracle_id: string; printing_id: string; finish: string; attrs: string }>(
    "SELECT oracle_id, printing_id, finish, attrs FROM pool_members WHERE asset_id = $1",
    [id],
  );
  // Kept: no longer to insert. Gone: deleted. A few statements, not one a
  // member: the plugin holds no transaction, so fewer is a shorter window
  // for a failure to leave the pool half replaced.
  const gone = had.filter((h) => !wanted.delete(key(h)));
  for (let i = 0; i < gone.length; i += 200) {
    const chunk = gone.slice(i, i + 200);
    await lab.execute(
      `DELETE FROM pool_members WHERE asset_id = $1 AND (oracle_id, printing_id, finish, attrs) IN (VALUES ${chunk
        .map((_, j) => `($${4 * j + 2}, $${4 * j + 3}, $${4 * j + 4}, $${4 * j + 5})`)
        .join(", ")})`,
      [id, ...chunk.flatMap((h) => [h.oracle_id, h.printing_id, h.finish, h.attrs])],
    );
  }
  await insertRows(
    lab,
    "pool_members",
    ["asset_id", "oracle_id", "printing_id", "finish", "attrs", "added_at"],
    [...wanted.values()].map((s) => [id, s.oracle_id, s.printing_id, s.finish, s.attrs, at]),
  );
  await lab.execute("UPDATE assets SET updated_at = $2 WHERE id = $1", [id, at]);
  const [{ n }] = await lab.select<{ n: number }>("SELECT COUNT(*) AS n FROM pool_members WHERE asset_id = $1", [id]);
  return { created: !existing, members: n };
}

/** A card the store cannot settle is the caller's mistake, not ours. */
function refuse(e: unknown): never {
  throw new LabApiError(e instanceof Error ? e.message : String(e), 400);
}
