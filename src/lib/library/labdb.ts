import { formatRef, parseRef, pathKey, resolveNames, type Ref } from "../paths";
import type { Identifier } from "../scryfall";
import type { Sql } from "../sql";
import type { Card } from "../types";
import {
  canonicalV5,
  LibraryFormatError,
  ZONES,
  type Asset,
  type AssetOf,
  type AttributeType,
  type AttributeValue,
  type Bucket,
  type Pile,
  type V5Library,
  type Zone,
} from "./v5";

/**
 * Reading and writing the lab schema (`src-tauri/migrations/lab/1000_assets.sql`)
 * as a `V5Library`: the lab's (schema, dump, load) triplet against library
 * file version 5. See docs/library-format-5.md.
 *
 * Takes two SQL handles: the lab database, and the card store, which says
 * which card a line means. Identity is read from the store at any age —
 * which printing a set and number are never changes — so a load fetches only
 * what the store has never had, through the channel to Scryfall.
 */

/* ---------- buckets against the card store ---------- */

/** A bucket as stored: the card, and the rest of what is known. */
interface Stored {
  oracle_id: string;
  printing_id: string;
  finish: string;
  attrs: string;
}

const BUCKET_COLUMNS = ["oracle_id", "printing_id", "finish", "attrs"] as const;

/** User attributes as canonical JSON, keys sorted: part of the bucket's key. */
function attrsJson(attrs: Record<string, AttributeValue>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(attrs).sort(([a], [b]) => (a < b ? -1 : 1))));
}

const fold = (name: string) => name.trim().toLowerCase();

/** A line's name fits a card's: equal, or the front face of it. */
function nameFits(line: string, card: string): boolean {
  return fold(line) === fold(card) || fold(line) === fold(card.split("//")[0]);
}

const printingKey = (set: string, number: string, lang: string) => `${set}|${number}|${lang}`;

interface PrintingRow {
  id: string;
  oracle_id: string;
  name: string;
  set_code: string;
  collector_number: string;
  lang: string;
}

const CHUNK = 400;

async function inChunks<T, R>(items: T[], run: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(...(await run(items.slice(i, i + CHUNK))));
  return out;
}

const holes = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `$${from + i}`).join(", ");

async function printingsByKey(cards: Sql, keys: string[]): Promise<Map<string, PrintingRow>> {
  const rows = await inChunks(keys, (chunk) =>
    cards.select<PrintingRow>(
      `SELECT id, oracle_id, name, set_code, collector_number,
              COALESCE(json_extract(data, '$.lang'), 'en') AS lang
         FROM cards
        WHERE set_code || '|' || collector_number IN (${holes(chunk.length)})`,
      chunk.map((k) => k.split("|").slice(0, 2).join("|")),
    ),
  );
  return new Map(rows.map((r) => [printingKey(r.set_code, r.collector_number, r.lang), r]));
}

async function namesByOracle(cards: Sql, oracles: string[]): Promise<Map<string, string>> {
  const rows = await inChunks(oracles, (chunk) =>
    cards.select<{ oracle_id: string; name: string }>(
      `SELECT oracle_id, MIN(name) AS name FROM cards
        WHERE oracle_id IN (${holes(chunk.length)}) GROUP BY oracle_id`,
      chunk,
    ),
  );
  return new Map(rows.map((r) => [r.oracle_id, r.name]));
}

/** Every card a name could mean, by full name or front face. */
async function oraclesByName(cards: Sql, names: string[]): Promise<Map<string, Set<string>>> {
  const folded = [...new Set(names.map(fold))];
  const rows = await inChunks(folded, (chunk) =>
    cards.select<{ oracle_id: string; name: string }>(
      `SELECT DISTINCT oracle_id, name FROM cards
        WHERE lower(name) IN (${holes(chunk.length)})
           OR lower(trim(substr(name, 1, instr(name, ' // ') - 1))) IN (${holes(chunk.length, chunk.length + 1)})`,
      [...chunk, ...chunk],
    ),
  );
  const out = new Map<string, Set<string>>();
  for (const name of folded) out.set(name, new Set());
  for (const r of rows) {
    for (const name of folded) if (nameFits(name, r.name)) out.get(name)!.add(r.oracle_id);
  }
  return out;
}

export interface LabWriteOptions {
  /**
   * Fetch what the store has never had, into the store. Defaults to Scryfall
   * through the channel; tests pass one that throws.
   */
  fetchMissing?: (identifiers: Identifier[]) => Promise<{ found: Card[] }>;
  /** The time a load gives what the file leaves undated. */
  now?: () => string;
}

/**
 * Which card every bucket means, checked: what a line gives — name, oracle
 * id, printing — must agree. All of it is settled before the first write.
 */
async function resolveBuckets(
  buckets: Bucket[],
  cards: Sql,
  fetchMissing: NonNullable<LabWriteOptions["fetchMissing"]>,
): Promise<{ resolve: (b: Bucket) => Stored; fetched: number }> {
  const keyOf = (b: Bucket) => printingKey(b.printing!.set, b.printing!.number, b.printing!.lang);
  const printed = buckets.filter((b) => b.printing);
  const named = buckets.filter((b) => !b.printing && b.oracle === undefined && b.card !== undefined);

  let printings = await printingsByKey(cards, [...new Set(printed.map(keyOf))]);
  let byName = await oraclesByName(cards, named.map((b) => b.card!));

  // What the store has never had: fetched once, through the channel, then
  // read back from the store.
  const missingPrintings = [...new Set(printed.map(keyOf))].filter((k) => !printings.has(k));
  const foreign = missingPrintings.filter((k) => !k.endsWith("|en"));
  if (foreign.length) {
    throw new LibraryFormatError(
      `Not in the card store, and only English printings can be fetched yet:\n${foreign.join("\n")}`,
    );
  }
  const missingNames = [...byName].filter(([, o]) => o.size === 0).map(([n]) => n);
  const wanted: Identifier[] = [
    ...missingPrintings.map((k) => {
      const [set, collector_number] = k.split("|");
      return { set, collector_number };
    }),
    ...named.filter((b) => missingNames.includes(fold(b.card!))).map((b) => ({ name: b.card! })),
  ];
  let fetched = 0;
  if (wanted.length) {
    fetched = (await fetchMissing(wanted)).found.length;
    printings = await printingsByKey(cards, [...new Set(printed.map(keyOf))]);
    byName = await oraclesByName(cards, named.map((b) => b.card!));
  }

  const oracles = new Set<string>();
  for (const b of buckets) if (b.oracle !== undefined) oracles.add(b.oracle);
  for (const p of printings.values()) oracles.add(p.oracle_id);
  for (const found of byName.values()) for (const o of found) oracles.add(o);
  const names = await namesByOracle(cards, [...oracles]);

  const problems: string[] = [];
  const resolved = new Map<Bucket, Stored>();
  for (const b of buckets) {
    const label = `${b.card ?? b.oracle ?? ""}${b.printing ? ` (${b.printing.set}) ${b.printing.number}` : ""}`;
    let oracle = b.oracle;
    let printingId = "";
    if (b.printing) {
      const p = printings.get(keyOf(b));
      if (!p) {
        problems.push(`${label}: no such printing`);
        continue;
      }
      if (oracle !== undefined && oracle !== p.oracle_id) {
        problems.push(`${label}: that printing is ${p.name}, not the card its oracle id names`);
        continue;
      }
      oracle = p.oracle_id;
      printingId = p.id;
    } else if (oracle === undefined) {
      const found = byName.get(fold(b.card!)) ?? new Set();
      if (found.size !== 1) {
        problems.push(`${label}: ${found.size ? "more than one card has that name" : "no card has that name"}`);
        continue;
      }
      oracle = [...found][0];
    }
    const name = names.get(oracle!);
    if (name === undefined) {
      problems.push(`${label}: no card in the store has that oracle id`);
      continue;
    }
    if (b.card !== undefined && !nameFits(b.card, name)) {
      problems.push(`${label}: that card is ${name}`);
      continue;
    }
    resolved.set(b, { oracle_id: oracle!, printing_id: printingId, finish: b.finish ?? "", attrs: attrsJson(b.attrs) });
  }
  if (problems.length) {
    const shown = problems.slice(0, 10).join("\n");
    const more = problems.length > 10 ? `\n…and ${problems.length - 10} more` : "";
    throw new LibraryFormatError(`Some lines do not say which card consistently:\n${shown}${more}`);
  }
  return { resolve: (b) => resolved.get(b)!, fetched };
}

/* ---------- write ---------- */

export interface LabWriteSummary {
  assets: number;
  lines: number;
  fetched: number;
}

/** Multi-row INSERTs, chunked under SQLite's variable limit. */
async function insertRows(sql: Sql, table: string, columns: readonly string[], rows: unknown[][]) {
  const perChunk = Math.floor(900 / columns.length);
  for (let start = 0; start < rows.length; start += perChunk) {
    const chunk = rows.slice(start, start + perChunk);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const base = params.length;
      params.push(...row);
      return `(${row.map((_, j) => `$${base + j + 1}`).join(", ")})`;
    });
    await sql.execute(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}`, params);
  }
}

export async function labIsEmpty(sql: Sql): Promise<boolean> {
  const rows = await sql.select<{ n: number }>("SELECT COUNT(*) AS n FROM assets WHERE id <> 'root'");
  return rows[0].n === 0;
}

function bucketsOf(a: Asset): Bucket[] {
  switch (a.type) {
    case "place":
    case "checklist":
    case "list pool":
      return (a.cards as { bucket: Bucket }[]).map((l) => l.bucket);
    case "arrangement":
      return a.piles.flatMap((p) => ("cards" in p ? p.cards.map((l) => l.bucket) : []));
    default:
      return [];
  }
}

/**
 * Write a library into an **empty** lab database. Everything that could fail
 * is checked first — `loadV5` checked the file, `resolveBuckets` the cards —
 * because the SQL plugin cannot hold a transaction across calls.
 */
export async function writeLab(
  sql: Sql,
  cards: Sql,
  lib: V5Library,
  options: LabWriteOptions = {},
): Promise<LabWriteSummary> {
  if (!(await labIsEmpty(sql))) {
    throw new LibraryFormatError("The lab already holds assets. A library loads only into an empty one.");
  }
  const now = options.now ?? (() => new Date().toISOString());
  const stamp = now();
  const fetchMissing =
    options.fetchMissing ?? (async (ids: Identifier[]) => (await import("../scryfall")).resolveIdentifiers(ids));
  const { resolve, fetched } = await resolveBuckets(lib.assets.flatMap(bucketsOf), cards, fetchMissing);
  const bucket = (b: Bucket) => {
    const s = resolve(b);
    return BUCKET_COLUMNS.map((c) => s[c]);
  };
  const newId = () => crypto.randomUUID();

  // The tree. A path segment with no asset of its own is an implied folder.
  const ids = new Map<string, string>([[pathKey([]), "root"]]);
  const nextPosition = new Map<string, number>();
  const assetRows: unknown[][] = [];
  const addRow = (path: string[], fields: Record<string, unknown>) => {
    const parent = ids.get(pathKey(path.slice(0, -1)))!;
    const position = nextPosition.get(parent) ?? 0;
    nextPosition.set(parent, position + 1);
    const id = newId();
    ids.set(pathKey(path), id);
    assetRows.push([
      id, parent, position, path[path.length - 1],
      fields.type, fields.notes ?? null, fields.created ?? null, fields.updated ?? null,
      fields.storage ?? null, fields.unlisted ?? null, fields.query ?? null, fields.format ?? null,
    ]);
    return id;
  };
  for (const a of lib.assets) {
    for (let n = 1; n < a.path.length; n++) {
      if (!ids.has(pathKey(a.path.slice(0, n)))) addRow(a.path.slice(0, n), { type: "folder" });
    }
    addRow(a.path, {
      type: a.type,
      notes: a.notes,
      created: a.created ?? stamp,
      updated: a.updated ?? stamp,
      storage: a.type === "place" ? a.storage : undefined,
      unlisted: a.type === "checklist" ? a.unlisted : undefined,
      query: a.type === "query pool" ? a.query : undefined,
      format: a.type === "decklist" ? a.format : undefined,
    });
  }

  const refRows: unknown[][] = [];
  const addRef = (a: Asset, role: string, ref: Ref) => {
    const facets = ref.facets.join(".");
    if (ref.byName) {
      const path = formatRef({ byName: false, rooted: false, names: ref.names, facets: [] });
      refRows.push([ids.get(pathKey(a.path)), role, null, path, ref.rooted ? 1 : 0, facets]);
    } else {
      const target = ids.get(pathKey(resolveNames(ref, a.path)))!;
      refRows.push([ids.get(pathKey(a.path)), role, target, null, ref.rooted ? 1 : 0, facets]);
    }
  };

  const placeLines: unknown[][] = [];
  const checklistLines: unknown[][] = [];
  const poolMembers: unknown[][] = [];
  const pileRows: unknown[][] = [];
  const pileMembers: unknown[][] = [];
  const attributeRows = Object.entries(lib.attributes).map(([name, type]) => [name, type]);

  for (const a of lib.assets) {
    const id = ids.get(pathKey(a.path))!;
    switch (a.type) {
      case "place":
        for (const l of a.cards) placeLines.push([id, ...bucket(l.bucket), l.qty, l.added ?? null]);
        break;
      case "checklist":
        if (a.on) addRef(a, "on", a.on);
        for (const l of a.cards) {
          checklistLines.push([id, ...bucket(l.bucket), l.min, l.max, l.added ?? null]);
        }
        break;
      case "list pool":
        for (const l of a.cards) poolMembers.push([id, ...bucket(l.bucket), l.added ?? null]);
        break;
      case "decklist":
      case "deck":
        for (const zone of ZONES) if (a.zones[zone]) addRef(a, zone, a.zones[zone]!);
        if (a.shows) addRef(a, "shows", a.shows);
        if (a.type === "deck" && a.list) addRef(a, "list", a.list);
        break;
      case "arrangement":
        addRef(a, "of", a.of);
        a.piles.forEach((p, position) => {
          const pileId = newId();
          pileRows.push([pileId, id, position, p.name, "query" in p ? p.query : null]);
          if ("cards" in p) {
            for (const l of p.cards) pileMembers.push([pileId, ...bucket(l.bucket), l.added ?? null]);
          }
        });
        break;
    }
  }

  await insertRows(sql, "attributes", ["name", "type"], attributeRows);
  await insertRows(
    sql,
    "assets",
    ["id", "parent_id", "position", "name", "type", "notes", "created_at", "updated_at", "storage", "unlisted", "query", "format"],
    assetRows,
  );
  await insertRows(sql, "asset_refs", ["asset_id", "role", "target_id", "path", "rooted", "facets"], refRows);
  await insertRows(sql, "place_lines", ["asset_id", ...BUCKET_COLUMNS, "qty", "added_at"], placeLines);
  await insertRows(sql, "checklist_lines", ["asset_id", ...BUCKET_COLUMNS, "min_qty", "max_qty", "added_at"], checklistLines);
  await insertRows(sql, "pool_members", ["asset_id", ...BUCKET_COLUMNS, "added_at"], poolMembers);
  await insertRows(sql, "piles", ["id", "arrangement_id", "position", "name", "query"], pileRows);
  await insertRows(sql, "pile_members", ["pile_id", ...BUCKET_COLUMNS, "added_at"], pileMembers);

  return {
    assets: assetRows.length,
    lines: placeLines.length + checklistLines.length + poolMembers.length + pileMembers.length,
    fetched,
  };
}

/* ---------- read ---------- */

interface AssetRow {
  id: string;
  parent_id: string | null;
  position: number;
  name: string;
  type: Asset["type"];
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  storage: string | null;
  unlisted: "any" | "excluded" | null;
  query: string | null;
  format: string | null;
}

interface RefRow {
  asset_id: string;
  role: string;
  target_id: string | null;
  path: string | null;
  rooted: number;
  facets: string;
}

type LineRow = Stored & { owner: string; added_at: string | null };

const isUnder = (path: string[], ancestor: string[]) =>
  path.length > ancestor.length && ancestor.every((n, i) => path[i] === n);

/**
 * Read the lab database as a library. Lossless or nothing: what the file
 * cannot carry — a broken reference, a printing the store has lost — stops
 * the dump rather than being left out.
 */
export async function readLab(sql: Sql, cards: Sql): Promise<V5Library> {
  const problems: string[] = [];

  const attributes: Record<string, AttributeType> = {};
  for (const r of await sql.select<{ name: string; type: AttributeType }>("SELECT name, type FROM attributes")) {
    attributes[r.name] = r.type;
  }

  const rows = await sql.select<AssetRow>(
    `SELECT id, parent_id, position, name, type, notes, created_at, updated_at,
            storage, unlisted, query, format
       FROM assets ORDER BY position, name`,
  );
  const children = new Map<string, AssetRow[]>();
  for (const r of rows) {
    if (r.parent_id === null) continue;
    children.set(r.parent_id, [...(children.get(r.parent_id) ?? []), r]);
  }

  // Tree order: a parent before its children, siblings by position.
  const ordered: { row: AssetRow; path: string[] }[] = [];
  const paths = new Map<string, string[]>([["root", []]]);
  const walk = (id: string, path: string[]) => {
    for (const child of children.get(id) ?? []) {
      const childPath = [...path, child.name];
      paths.set(child.id, childPath);
      ordered.push({ row: child, path: childPath });
      walk(child.id, childPath);
    }
  };
  walk("root", []);

  const lines = async (table: string, extra: string) =>
    sql.select<LineRow & Record<string, unknown>>(
      `SELECT ${table === "pile_members" ? "pile_id" : "asset_id"} AS owner,
              ${BUCKET_COLUMNS.join(", ")}, added_at${extra}
         FROM ${table}`,
    );
  const group = <R extends { owner: string }>(list: R[]) => {
    const out = new Map<string, R[]>();
    for (const r of list) out.set(r.owner, [...(out.get(r.owner) ?? []), r]);
    return out;
  };
  const placeLines = await lines("place_lines", ", qty");
  const checklistLines = await lines("checklist_lines", ", min_qty, max_qty");
  const poolMembers = await lines("pool_members", "");
  const pileMembers = await lines("pile_members", "");
  const piles = await sql.select<{ id: string; arrangement_id: string; position: number; name: string; query: string | null }>(
    "SELECT id, arrangement_id, position, name, query FROM piles ORDER BY position",
  );
  const refs = await sql.select<RefRow>("SELECT asset_id, role, target_id, path, rooted, facets FROM asset_refs");

  // What the file says about each card, from the store.
  const all = [...placeLines, ...checklistLines, ...poolMembers, ...pileMembers];
  const printingIds = [...new Set(all.map((l) => l.printing_id).filter((p) => p !== ""))];
  const printingRows = await inChunks(printingIds, (chunk) =>
    cards.select<PrintingRow>(
      `SELECT id, oracle_id, name, set_code, collector_number,
              COALESCE(json_extract(data, '$.lang'), 'en') AS lang
         FROM cards WHERE id IN (${holes(chunk.length)})`,
      chunk,
    ),
  );
  const printings = new Map(printingRows.map((p) => [p.id, p]));
  const names = await namesByOracle(cards, [...new Set(all.map((l) => l.oracle_id))]);

  const bucketOf = (l: Stored): Bucket => {
    const b: Bucket = { attrs: JSON.parse(l.attrs) as Record<string, AttributeValue> };
    const p = l.printing_id === "" ? undefined : printings.get(l.printing_id);
    const name = p?.name ?? names.get(l.oracle_id);
    if (name !== undefined) b.card = name;
    b.oracle = l.oracle_id;
    if (l.printing_id !== "") {
      if (!p) problems.push(`printing ${l.printing_id} is not in the card store`);
      else b.printing = { set: p.set_code, number: p.collector_number, lang: p.lang };
    }
    if (l.finish !== "") b.finish = l.finish;
    return b;
  };
  const added = (l: { added_at: string | null }) => (l.added_at === null ? {} : { added: l.added_at });

  const placeBy = group(placeLines);
  const checklistBy = group(checklistLines);
  const poolBy = group(poolMembers);
  const pileMembersBy = group(pileMembers);
  const pilesBy = new Map<string, typeof piles>();
  for (const p of piles) pilesBy.set(p.arrangement_id, [...(pilesBy.get(p.arrangement_id) ?? []), p]);
  const refsBy = new Map<string, Map<string, RefRow>>();
  for (const r of refs) {
    if (!refsBy.has(r.asset_id)) refsBy.set(r.asset_id, new Map());
    refsBy.get(r.asset_id)!.set(r.role, r);
  }

  /** A stored reference as written: pinned ones relative only while below. */
  const refOf = (r: RefRow, from: string[]): Ref => {
    const facets = r.facets === "" ? [] : r.facets.split(".");
    if (r.path !== null) {
      const parsed = r.path === "" ? { names: [] as string[] } : parseRef(r.path);
      return { byName: true, rooted: r.rooted === 1, names: parsed.names, facets };
    }
    const target = r.target_id === null ? undefined : paths.get(r.target_id);
    if (target === undefined) {
      problems.push(`${pathKey(from)}: its \`${r.role}\` names an asset that no longer exists`);
      return { byName: false, rooted: true, names: [], facets };
    }
    // A relative reference reaches down only: to the referrer itself (`.oracle`)
    // or below it. A target that has moved elsewhere is written rooted.
    const relative = r.rooted === 0 && (pathKey(target) === pathKey(from) || isUnder(target, from));
    return relative
      ? { byName: false, rooted: false, names: target.slice(from.length), facets }
      : { byName: false, rooted: true, names: target, facets };
  };

  const assets: Asset[] = [];
  for (const { row, path } of ordered) {
    const common = {
      path,
      ...(row.notes !== null && { notes: row.notes }),
      ...(row.created_at !== null && { created: row.created_at }),
      ...(row.updated_at !== null && { updated: row.updated_at }),
    };
    const myRefs = refsBy.get(row.id) ?? new Map<string, RefRow>();
    switch (row.type) {
      case "folder": {
        // Implied in the file when it has children and nothing of its own.
        const bare = row.notes === null && row.created_at === null && row.updated_at === null;
        if (!(bare && (children.get(row.id) ?? []).length)) assets.push({ ...common, type: "folder" });
        break;
      }
      case "place":
        assets.push({
          ...common,
          type: "place",
          ...(row.storage !== null && { storage: row.storage }),
          cards: (placeBy.get(row.id) ?? []).map((l) => ({ bucket: bucketOf(l), qty: Number(l.qty), ...added(l) })),
        });
        break;
      case "checklist": {
        const on = myRefs.get("on");
        assets.push({
          ...common,
          type: "checklist",
          ...(on && { on: refOf(on, path) }),
          unlisted: row.unlisted!,
          cards: (checklistBy.get(row.id) ?? []).map((l) => ({
            bucket: bucketOf(l),
            min: Number(l.min_qty),
            max: l.max_qty === null ? null : Number(l.max_qty),
            ...added(l),
          })),
        });
        break;
      }
      case "list pool":
        assets.push({
          ...common,
          type: "list pool",
          cards: (poolBy.get(row.id) ?? []).map((l) => ({ bucket: bucketOf(l), ...added(l) })),
        });
        break;
      case "query pool":
        assets.push({ ...common, type: "query pool", query: row.query! });
        break;
      case "decklist":
      case "deck": {
        const zones: Partial<Record<Zone, Ref>> = {};
        for (const zone of ZONES) {
          const r = myRefs.get(zone);
          if (r) zones[zone] = refOf(r, path);
        }
        const shows = myRefs.get("shows");
        const list = myRefs.get("list");
        const deck: AssetOf<"decklist" | "deck"> =
          row.type === "decklist"
            ? {
                ...common,
                type: "decklist",
                ...(row.format !== null && { format: row.format }),
                ...(shows && { shows: refOf(shows, path) }),
                zones,
              }
            : {
                ...common,
                type: "deck",
                ...(list && { list: refOf(list, path) }),
                ...(shows && { shows: refOf(shows, path) }),
                zones,
              };
        assets.push(deck);
        break;
      }
      case "arrangement": {
        const of = myRefs.get("of");
        if (!of) {
          problems.push(`${pathKey(path)}: an arrangement with no \`of\``);
          break;
        }
        const ps: Pile[] = (pilesBy.get(row.id) ?? []).map((p) =>
          p.query !== null
            ? { name: p.name, query: p.query }
            : { name: p.name, cards: (pileMembersBy.get(p.id) ?? []).map((l) => ({ bucket: bucketOf(l), ...added(l) })) },
        );
        assets.push({ ...common, type: "arrangement", of: refOf(of, path), piles: ps });
        break;
      }
    }
  }

  if (problems.length) {
    const shown = problems.slice(0, 10).join("\n");
    const more = problems.length > 10 ? `\n…and ${problems.length - 10} more` : "";
    throw new LibraryFormatError(`Cannot dump this lab:\n${shown}${more}`);
  }
  return canonicalV5({ attributes, assets });
}
