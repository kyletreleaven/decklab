import { parse } from "smol-toml";
import { facetType, isA, isType, type AssetType } from "../ontology";
import {
  formatPath,
  formatRef,
  parsePath,
  parseRef,
  PathError,
  pathKey,
  resolveNames,
  type Ref,
} from "../paths";

/**
 * The library file, version 5: the user's data in the new model, as text.
 * See docs/library-format-5.md.
 *
 * Meant to outlive many schemas: each schema gets its own load and dump
 * against this one format, and the format changes rarely, by one-shot
 * file-to-file conversion (`convertV4`). This module is the format alone —
 * text to model and back — with no database.
 *
 * The rule that sets it apart from v4: **a key left out is `absent`.**
 * Nothing is filled in on load.
 */

const FORMAT = "decklab-library";
const VERSION = 5;

export const ZONES = ["commander", "main", "side"] as const;
export type Zone = (typeof ZONES)[number];

export const ATTRIBUTE_TYPES = ["condition", "text", "number", "boolean"] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];
export const CONDITIONS = ["M", "NM", "LP", "MP", "HP", "DMG"] as const;
export type AttributeValue = string | number | boolean;

/* ---------- the model ---------- */

export interface Printing {
  set: string;
  number: string;
  /** Always present here; the file leaves it out when English. */
  lang: string;
}

/** What is known about some copies. Every field left out is `absent`. */
export interface Bucket {
  /**
   * The card, by name, by oracle id, or by the printing: any of them, so
   * long as one says which card. A dump writes all it knows.
   */
  card?: string;
  oracle?: string;
  printing?: Printing;
  finish?: string;
  attrs: Record<string, AttributeValue>;
}

/** A place's line: copies known exactly this much about. */
export interface PlaceLine {
  bucket: Bucket;
  qty: number;
  added?: string;
}

/** A checklist's line: an interval on the bucket's population. */
export interface ChecklistLine {
  bucket: Bucket;
  min: number;
  /** null: no upper bound. */
  max: number | null;
  added?: string;
}

/** A pool's or a pile's line: membership, no count. */
export interface MemberLine {
  bucket: Bucket;
  added?: string;
}

export type Unlisted = "any" | "excluded";

export type Pile = { name: string; cards: MemberLine[] } | { name: string; query: string };

interface Common {
  path: string[];
  notes?: string;
  created?: string;
  updated?: string;
}

export type Asset = Common &
  (
    | { type: "folder" }
    | { type: "place"; storage?: string; cards: PlaceLine[] }
    | { type: "checklist"; on?: Ref; unlisted: Unlisted; cards: ChecklistLine[] }
    | { type: "list pool"; cards: MemberLine[] }
    | { type: "query pool"; query: string }
    /** Zones name checklists: what a deck should hold. */
    | { type: "decklist"; format?: string; zones: Partial<Record<Zone, Ref>>; shows?: Ref }
    /**
     * Zones name places: what it does hold. `list` is the decklist it builds,
     * zone by zone; `shows`, one of that decklist's arrangements.
     */
    | { type: "deck"; list?: Ref; zones: Partial<Record<Zone, Ref>>; shows?: Ref }
    | { type: "arrangement"; of: Ref; piles: Pile[] }
  );

export type AssetOf<T extends AssetType> = Extract<Asset, { type: T }>;

export interface V5Library {
  attributes: Record<string, AttributeType>;
  /**
   * In tree order: a parent before its children. Siblings have no order of
   * their own; a dump writes them in the canonical one (`canonicalV5`).
   */
  assets: Asset[];
}

/* ---------- canonical order ---------- */

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function sortedAttrs(attrs: Record<string, AttributeValue>): [string, AttributeValue][] {
  return Object.entries(attrs).sort(([a], [b]) => byText(a, b));
}

/** A bucket's identity: two lines with equal keys are one bucket. */
export function bucketKey(b: Bucket): string {
  return JSON.stringify([
    b.oracle ?? (b.card !== undefined ? `name:${b.card}` : null),
    b.printing ? [b.printing.set, b.printing.number, b.printing.lang] : null,
    b.finish ?? null,
    sortedAttrs(b.attrs),
  ]);
}

function compareBuckets(a: Bucket, b: Bucket): number {
  return (
    byText(a.card ?? "", b.card ?? "") ||
    byText(a.oracle ?? "", b.oracle ?? "") ||
    byText(bucketKey(a), bucketKey(b))
  );
}

const byBucket = <L extends { bucket: Bucket }>(lines: L[]) =>
  [...lines].sort((a, b) => compareBuckets(a.bucket, b.bucket));

/**
 * Lines sorted into the order a dump writes them, so equal libraries dump to
 * equal text. Assets keep their order: it is the tree's.
 */
/**
 * The tree, parents first, siblings in the canonical order: a decklist's or
 * deck's zones that could be written inline come first, in zone order —
 * where a load puts inline zones back — then the rest by name. The tree has
 * no order of its own (docs/inventory.md → *The asset tree*).
 */
function treeOrder(assets: Asset[]): Asset[] {
  const byPath = new Map(assets.map((a) => [pathKey(a.path), a]));
  const children = new Map<string, Map<string, string[]>>();
  for (const a of assets) {
    for (let n = 1; n <= a.path.length; n++) {
      const parent = pathKey(a.path.slice(0, n - 1));
      if (!children.has(parent)) children.set(parent, new Map());
      children.get(parent)!.set(a.path[n - 1], a.path.slice(0, n));
    }
  }
  const rank = (parent: Asset | undefined, name: string): number => {
    if (parent?.type !== "decklist" && parent?.type !== "deck") return ZONES.length;
    const zone = ZONES.findIndex((z) => {
      const ref = parent.zones[z];
      return !!ref && !ref.byName && !ref.rooted && ref.facets.length === 0 && ref.names.length === 1 && ref.names[0] === name;
    });
    return zone === -1 ? ZONES.length : zone;
  };
  const out: Asset[] = [];
  const walk = (path: string[]) => {
    const key = pathKey(path);
    const parent = byPath.get(key);
    const kids = [...(children.get(key) ?? new Map<string, string[]>())].sort(
      ([a], [b]) => rank(parent, a) - rank(parent, b) || byText(a, b),
    );
    for (const [, child] of kids) {
      const asset = byPath.get(pathKey(child));
      if (asset) out.push(asset);
      walk(child);
    }
  };
  walk([]);
  return out;
}

export function canonicalV5(lib: V5Library): V5Library {
  return {
    attributes: Object.fromEntries(
      Object.entries(lib.attributes).sort(([a], [b]) => byText(a, b)),
    ),
    assets: treeOrder(lib.assets).map((a): Asset => {
      switch (a.type) {
        case "place":
        case "checklist":
        case "list pool":
          return { ...a, cards: byBucket(a.cards as { bucket: Bucket }[]) } as Asset;
        case "arrangement":
          return {
            ...a,
            piles: a.piles.map((p) => ("cards" in p ? { ...p, cards: byBucket(p.cards) } : p)),
          };
        default:
          return a;
      }
    }),
  };
}

/* ---------- dump ---------- */

/** A TOML basic string (JSON's escaping is TOML's, bar DEL). */
function str(value: string): string {
  return JSON.stringify(value).replace(/\x7f/g, "\\u007f");
}

/**
 * A path or reference: a TOML literal string, so the quotes a path uses need
 * no escaping. Falls back to a basic string for the rare text a literal
 * string cannot hold.
 */
function lit(value: string): string {
  return /['\x00-\x1f\x7f]/.test(value) ? str(value) : `'${value}'`;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A canonical timestamp as a TOML datetime; anything else as a string. */
function time(value: string): string {
  return ISO.test(value) ? value : str(value);
}

function key(name: string): string {
  return /^[A-Za-z0-9_-]+$/.test(name) ? name : str(name);
}

function value(v: AttributeValue): string {
  return typeof v === "string" ? str(v) : String(v);
}

type Field = [key: string, value: string];

function inline(fields: Field[]): string {
  return `{ ${fields.map(([k, v]) => `${k} = ${v}`).join(", ")} }`;
}

function bucketFields(b: Bucket): Field[] {
  const fields: Field[] = [];
  if (b.card !== undefined) fields.push(["card", str(b.card)]);
  if (b.oracle !== undefined) fields.push(["oracle", str(b.oracle)]);
  return fields;
}

/** The fields after the count: printing, finish, attributes. */
function detailFields(b: Bucket): Field[] {
  const fields: Field[] = [];
  if (b.printing) {
    fields.push(["set", str(b.printing.set)], ["number", str(b.printing.number)]);
    if (b.printing.lang !== "en") fields.push(["lang", str(b.printing.lang)]);
  }
  if (b.finish !== undefined) fields.push(["finish", str(b.finish)]);
  const attrs = sortedAttrs(b.attrs);
  if (attrs.length) fields.push(["attrs", inline(attrs.map(([k, v]) => [key(k), value(v)]))]);
  return fields;
}

function line(b: Bucket, counts: Field[], added: string | undefined): string {
  const fields = [...bucketFields(b), ...counts, ...detailFields(b)];
  if (added !== undefined) fields.push(["added", time(added)]);
  return inline(fields);
}

function checklistCounts(l: ChecklistLine): Field[] {
  if (l.max !== null && l.min === l.max) return [["qty", String(l.min)]];
  const fields: Field[] = [];
  if (l.min !== 0) fields.push(["min", String(l.min)]);
  if (l.max !== null) fields.push(["max", String(l.max)]);
  return fields;
}

function list(name: string, lines: string[]): string {
  if (!lines.length) return `${name} = []`;
  return `${name} = [\n${lines.map((l) => `  ${l},`).join("\n")}\n]`;
}

const isChildOf = (child: string[], parent: string[]) =>
  child.length === parent.length + 1 && parent.every((n, i) => child[i] === n);

const isUnder = (path: string[], ancestor: string[]) =>
  path.length > ancestor.length && ancestor.every((n, i) => path[i] === n);

/**
 * The zones a dump writes inline: a zone goes inline exactly when its asset
 * is the owner's child named after the zone, referred to pinned and
 * relative, with an inline zone's defaults and nothing of its own — and sits
 * where a load would put it back, straight after the owner in zone order.
 * A decklist's inline zone is an exact checklist; a deck's, a plain place.
 * Anything else is written as its own asset. See library-format-5.md → *When
 * a zone is written inline*.
 */
function inlineZones(deck: AssetOf<"decklist" | "deck">, at: number, assets: Asset[]): Zone[] {
  const inline: Zone[] = [];
  let next = at + 1;
  for (const zone of ZONES) {
    const ref = deck.zones[zone];
    if (!ref) continue;
    const child = assets[next];
    const fits =
      !ref.byName &&
      !ref.rooted &&
      ref.facets.length === 0 &&
      ref.names.length === 1 &&
      ref.names[0] === zone &&
      child !== undefined &&
      (deck.type === "decklist"
        ? child.type === "checklist" &&
          child.unlisted === "excluded" &&
          child.on === undefined &&
          child.cards.every((l) => l.max !== null && l.min === l.max)
        : child.type === "place" && child.storage === undefined) &&
      isChildOf(child.path, deck.path) &&
      child.path[child.path.length - 1] === zone &&
      child.notes === undefined &&
      child.created === deck.created &&
      child.updated === deck.updated &&
      !assets.some((a) => isUnder(a.path, child.path));
    // Only a run straight after the deck: a load puts inline zones there.
    if (!fits) break;
    inline.push(zone);
    next++;
  }
  return inline;
}

export function dumpV5(library: V5Library): string {
  const lib = canonicalV5(library);
  const out: string[] = [`format = ${str(FORMAT)}`, `version = ${VERSION}`];

  const attrs = Object.entries(lib.attributes);
  if (attrs.length) {
    out.push("", "[attributes]", ...attrs.map(([k, t]) => `${key(k)} = ${str(t)}`));
  }

  for (let i = 0; i < lib.assets.length; i++) {
    const a = lib.assets[i];
    const head: Field[] = [
      ["path", lit(formatPath(a.path))],
      ["type", str(a.type)],
    ];
    const body: string[] = [];

    switch (a.type) {
      case "place":
        if (a.storage !== undefined) head.push(["storage", str(a.storage)]);
        body.push(list("cards", a.cards.map((l) => line(l.bucket, [["qty", String(l.qty)]], l.added))));
        break;
      case "checklist":
        if (a.on) head.push(["on", lit(formatRef(a.on))]);
        head.push(["unlisted", str(a.unlisted)]);
        body.push(list("cards", a.cards.map((l) => line(l.bucket, checklistCounts(l), l.added))));
        break;
      case "list pool":
        body.push(list("cards", a.cards.map((l) => line(l.bucket, [], l.added))));
        break;
      case "query pool":
        head.push(["query", str(a.query)]);
        break;
      case "decklist":
      case "deck": {
        if (a.type === "decklist" && a.format !== undefined) head.push(["format", str(a.format)]);
        if (a.type === "deck" && a.list) head.push(["list", lit(formatRef(a.list))]);
        if (a.shows) head.push(["shows", lit(formatRef(a.shows))]);
        const inline = inlineZones(a, i, lib.assets);
        const zones = ZONES.filter((z) => a.zones[z]);
        if (zones.length) {
          body.push("", "[asset.zones]");
          for (const zone of zones) {
            if (inline.includes(zone)) {
              const child = lib.assets[i + 1 + inline.indexOf(zone)] as AssetOf<"checklist" | "place">;
              const lines =
                child.type === "checklist"
                  ? child.cards.map((l) => line(l.bucket, [["qty", String(l.min)]], l.added))
                  : child.cards.map((l) => line(l.bucket, [["qty", String(l.qty)]], l.added));
              body.push(list(zone, lines));
            } else {
              body.push(`${zone} = ${lit(formatRef(a.zones[zone]!))}`);
            }
          }
        }
        i += inline.length;
        break;
      }
      case "arrangement": {
        head.push(["of", lit(formatRef(a.of))]);
        const piles = a.piles.map((p) =>
          "query" in p
            ? `  ${inline([["name", str(p.name)], ["query", str(p.query)]])},`
            : `  { name = ${str(p.name)}, cards = [\n${p.cards
                .map((l) => `    ${line(l.bucket, [], l.added)},`)
                .join("\n")}\n  ] },`,
        );
        body.push(piles.length ? `piles = [\n${piles.join("\n")}\n]` : "piles = []");
        break;
      }
      case "folder":
        break;
    }

    if (a.notes !== undefined) head.push(["notes", str(a.notes)]);
    if (a.created !== undefined) head.push(["created", time(a.created)]);
    if (a.updated !== undefined) head.push(["updated", time(a.updated)]);

    out.push("", "[[asset]]", ...head.map(([k, v]) => `${k} = ${v}`), ...body);
  }

  return out.join("\n") + "\n";
}

/* ---------- load ---------- */

export class LibraryFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibraryFormatError";
  }
}

type Table = Record<string, unknown>;

function isTable(v: unknown): v is Table {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/**
 * Reads one TOML table, naming where it is in every error, and refuses any
 * key it was not told about: a typo in a hand-written file is an error, not
 * something silently ignored.
 */
class Reader {
  constructor(
    readonly table: Table,
    readonly where: string,
    allowed: readonly string[],
  ) {
    for (const k of Object.keys(table)) {
      if (!allowed.includes(k)) this.fail(`unknown key \`${k}\``);
    }
  }

  fail(message: string): never {
    throw new LibraryFormatError(`${this.where}: ${message}`);
  }

  has(k: string): boolean {
    return this.table[k] !== undefined;
  }

  text(k: string): string {
    const v = this.table[k];
    if (typeof v !== "string") this.fail(`\`${k}\` must be a string`);
    return v;
  }

  optText(k: string): string | undefined {
    return this.has(k) ? this.text(k) : undefined;
  }

  whole(k: string, least: number): number {
    const v = this.table[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < least) {
      this.fail(`\`${k}\` must be a whole number of at least ${least}`);
    }
    return v;
  }

  optTime(k: string): string | undefined {
    const v = this.table[k];
    if (v === undefined) return undefined;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "string") return v;
    return this.fail(`\`${k}\` must be a datetime`);
  }

  tables(k: string): Table[] {
    const v = this.table[k];
    if (v === undefined) return [];
    if (!Array.isArray(v)) this.fail(`\`${k}\` must be a list`);
    return v.map((entry, i) => {
      if (!isTable(entry)) this.fail(`\`${k}\` entry ${i + 1} must be a table`);
      return entry;
    });
  }

  ref(k: string): Ref {
    try {
      return parseRef(this.text(k));
    } catch (e) {
      if (e instanceof PathError) this.fail(`\`${k}\`: ${e.message}`);
      throw e;
    }
  }
}

const BUCKET_KEYS = ["card", "oracle", "set", "number", "lang", "finish", "attrs", "added"];
const ASSET_KEYS = ["path", "type", "notes", "created", "updated"];

function readBucket(r: Reader, attributes: Record<string, AttributeType>): Bucket {
  // A line must say which card, by any means: name, oracle id or printing.
  // Whether what it gives agrees is for a load against the card store.
  const card = r.optText("card");
  const oracle = r.optText("oracle");
  if (card === undefined && oracle === undefined && !r.has("set")) {
    r.fail("a line must say which card: `card`, `oracle`, or a printing");
  }

  let printing: Printing | undefined;
  if (r.has("set") || r.has("number") || r.has("lang")) {
    if (!r.has("set") || !r.has("number")) {
      r.fail("a printing needs both `set` and `number` (and `lang` only when not English)");
    }
    const lang = r.optText("lang") ?? "en";
    if (r.has("lang") && lang === "en") r.fail("`lang` is left out when English");
    printing = { set: r.text("set"), number: r.text("number"), lang };
  }

  const finish = r.optText("finish");

  const attrs: Record<string, AttributeValue> = {};
  const raw = r.table.attrs;
  if (raw !== undefined) {
    if (!isTable(raw)) r.fail("`attrs` must be a table");
    for (const [name, v] of Object.entries(raw)) {
      const type = attributes[name];
      if (!type) r.fail(`attribute \`${name}\` is not declared in [attributes]`);
      const ok =
        type === "condition"
          ? typeof v === "string" && (CONDITIONS as readonly string[]).includes(v)
          : type === "text"
            ? typeof v === "string"
            : type === "number"
              ? typeof v === "number"
              : typeof v === "boolean";
      if (!ok) {
        r.fail(
          type === "condition"
            ? `\`${name}\` must be one of ${CONDITIONS.join(", ")}`
            : `\`${name}\` must be a ${type}`,
        );
      }
      attrs[name] = v as AttributeValue;
    }
  }

  const bucket: Bucket = { attrs };
  if (card !== undefined) bucket.card = card;
  if (oracle !== undefined) bucket.oracle = oracle;
  if (printing) bucket.printing = printing;
  if (finish !== undefined) bucket.finish = finish;
  return bucket;
}

function withAdded<T extends object>(r: Reader, line: T): T & { added?: string } {
  const added = r.optTime("added");
  return added === undefined ? line : { ...line, added };
}

function unique(keys: string[], what: string, where: string) {
  const seen = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) throw new LibraryFormatError(`${where}: two ${what}`);
    seen.add(k);
  }
}

/**
 * A reference to check once every asset is known. `collection` is what a
 * checklist may be checked against: anything with contents.
 */
interface Pending {
  ref: Ref;
  from: string[];
  as: AssetType | "collection";
  where: string;
}

/**
 * Parse and validate a version 5 file. Everything a load could trip on later
 * — an unknown key, a duplicate bucket, a pinned reference to nothing — is
 * caught here, before anything is written.
 */
export function loadV5(text: string): V5Library {
  let doc: Table;
  try {
    doc = parse(text) as Table;
  } catch (e) {
    throw new LibraryFormatError(`Not valid TOML: ${(e as Error).message}`);
  }

  // Which file this is comes first, so an old one is pointed at the
  // converter rather than refused for its keys.
  const which = (message: string): never => {
    throw new LibraryFormatError(`library: ${message}`);
  };
  if (doc.format !== "decklab-library") which('`format` must be "decklab-library"');
  if (doc.version !== VERSION) {
    which(
      doc.schema !== undefined
        ? `this is a schema ${String(doc.schema)} file; convert it first (\`decklab convert\`)`
        : `this is version ${String(doc.version)}; this loader reads version ${VERSION}`,
    );
  }
  const top: Reader = new Reader(doc, "library", ["format", "version", "attributes", "asset"]);

  const attributes: Record<string, AttributeType> = {};
  const declared = doc.attributes;
  if (declared !== undefined) {
    if (!isTable(declared)) top.fail("`attributes` must be a table");
    for (const [name, type] of Object.entries(declared)) {
      if (typeof type !== "string" || !(ATTRIBUTE_TYPES as readonly string[]).includes(type)) {
        top.fail(`attribute \`${name}\` must be one of ${ATTRIBUTE_TYPES.join(", ")}`);
      }
      attributes[name] = type as AttributeType;
    }
  }

  const assets: Asset[] = [];
  const pending: Pending[] = [];
  const decksShowing: { where: string; path: string[]; list: Ref; shows: Ref }[] = [];

  top.tables("asset").forEach((table, i) => {
    const pre = new Reader(table, `asset ${i + 1}`, Object.keys(table));
    let path: string[];
    try {
      path = parsePath(pre.text("path"));
    } catch (e) {
      if (e instanceof PathError) pre.fail(`\`path\`: ${e.message}`);
      throw e;
    }
    const where = formatPath(path);
    const type = new Reader(table, where, Object.keys(table)).text("type");
    if (!isType(type)) throw new LibraryFormatError(`${where}: unknown type "${type}"`);

    const common = (r: Reader): Common => {
      const c: Common = { path };
      const notes = r.optText("notes");
      const created = r.optTime("created");
      const updated = r.optTime("updated");
      if (notes !== undefined) c.notes = notes;
      if (created !== undefined) c.created = created;
      if (updated !== undefined) c.updated = updated;
      return c;
    };
    const lines = (r: Reader, k: string, extra: string[]) =>
      r.tables(k).map((t, j) => new Reader(t, `${where}, ${k} ${j + 1}`, [...BUCKET_KEYS, ...extra]));
    const noDuplicates = (buckets: Bucket[], k = "lines") =>
      unique(buckets.map(bucketKey), `${k} for the same bucket`, where);
    const refer = (r: Reader, k: string, as: Pending["as"]) => {
      const ref = r.ref(k);
      pending.push({ ref, from: path, as, where: `${where}, \`${k}\`` });
      return ref;
    };

    // `pool` is the general node; the key it has decides which kind.
    const kind: AssetType =
      type === "pool" ? (table.query !== undefined ? "query pool" : "list pool") : type;

    switch (kind) {
      case "folder": {
        const r = new Reader(table, where, ASSET_KEYS);
        assets.push({ ...common(r), type: "folder" });
        break;
      }
      case "place": {
        const r = new Reader(table, where, [...ASSET_KEYS, "storage", "cards"]);
        const cards = lines(r, "cards", ["qty"]).map((l) =>
          withAdded(l, { bucket: readBucket(l, attributes), qty: l.whole("qty", 1) }),
        );
        noDuplicates(cards.map((c) => c.bucket));
        const storage = r.optText("storage");
        assets.push({ ...common(r), type: "place", ...(storage !== undefined && { storage }), cards });
        break;
      }
      case "checklist": {
        const r: Reader = new Reader(table, where, [...ASSET_KEYS, "on", "unlisted", "cards"]);
        const text = r.text("unlisted");
        if (text !== "any" && text !== "excluded") r.fail('`unlisted` must be "any" or "excluded"');
        const unlisted: Unlisted = text;
        const cards = lines(r, "cards", ["qty", "min", "max"]).map((l) => {
          const bucket = readBucket(l, attributes);
          if (l.has("qty")) {
            if (l.has("min") || l.has("max")) l.fail("`qty` is exact: it takes no `min` or `max`");
            const n = l.whole("qty", 1);
            return withAdded(l, { bucket, min: n, max: n });
          }
          if (!l.has("min") && !l.has("max")) l.fail("a checklist line needs `qty`, `min` or `max`");
          const min = l.has("min") ? l.whole("min", 0) : 0;
          const max = l.has("max") ? l.whole("max", 0) : null;
          if (max !== null && max < min) l.fail("`max` is below `min`");
          return withAdded(l, { bucket, min, max });
        });
        noDuplicates(cards.map((c) => c.bucket));
        const on = r.has("on") ? refer(r, "on", "collection") : undefined;
        assets.push({
          ...common(r),
          type: "checklist",
          ...(on && { on }),
          unlisted,
          cards,
        });
        break;
      }
      case "list pool":
      case "query pool": {
        const r = new Reader(table, where, [...ASSET_KEYS, "cards", "query"]);
        if (r.has("cards") && r.has("query")) r.fail("a pool has `cards` or `query`, not both");
        if (type === "list pool" && r.has("query")) r.fail("a list pool has `cards`, not `query`");
        if (type === "query pool" && !r.has("query")) r.fail("a query pool needs `query`");
        if (kind === "query pool") {
          assets.push({ ...common(r), type: "query pool", query: r.text("query") });
        } else {
          if (!r.has("cards")) r.fail("a pool needs `cards` or `query`");
          const cards = lines(r, "cards", []).map((l) =>
            withAdded(l, { bucket: readBucket(l, attributes) }),
          );
          noDuplicates(cards.map((c) => c.bucket));
          assets.push({ ...common(r), type: "list pool", cards });
        }
        break;
      }
      case "decklist":
      case "deck": {
        const isList = kind === "decklist";
        const r: Reader = new Reader(table, where, [...ASSET_KEYS, isList ? "format" : "list", "shows", "zones"]);
        const c = common(r);
        const format = isList ? r.optText("format") : undefined;
        const list = !isList && r.has("list") ? refer(r, "list", "decklist") : undefined;
        if (!isList && r.has("shows") && !list) r.fail("a deck shows its decklist's arrangement: it needs `list`");
        const shows = r.has("shows") ? refer(r, "shows", "arrangement") : undefined;
        if (!isList && shows && list) decksShowing.push({ where, path, list, shows });
        const zones: Partial<Record<Zone, Ref>> = {};
        const inline: AssetOf<"checklist" | "place">[] = [];
        if (r.has("zones")) {
          const given = table.zones;
          if (!isTable(given)) r.fail("`zones` must be a table");
          const z = new Reader(given, `${where}, zones`, ZONES);
          for (const zone of ZONES) {
            const v = z.table[zone];
            if (v === undefined) continue;
            if (typeof v === "string") {
              zones[zone] = z.ref(zone);
              pending.push({
                ref: zones[zone]!,
                from: path,
                as: isList ? "checklist" : "place",
                where: `${where}, zone \`${zone}\``,
              });
              continue;
            }
            // Inline: a child with an inline zone's defaults — for a
            // decklist an exact checklist, for a deck a plain place — and a
            // pinned relative reference to it.
            const read = lines(z, zone, ["qty"]).map((l) => ({ l, bucket: readBucket(l, attributes), n: l.whole("qty", 1) }));
            noDuplicates(read.map((x) => x.bucket), `\`${zone}\` lines`);
            const child: AssetOf<"checklist" | "place"> = isList
              ? {
                  path: [...path, zone],
                  type: "checklist",
                  unlisted: "excluded",
                  cards: read.map(({ l, bucket, n }) => withAdded(l, { bucket, min: n, max: n as number | null })),
                }
              : {
                  path: [...path, zone],
                  type: "place",
                  cards: read.map(({ l, bucket, n }) => withAdded(l, { bucket, qty: n })),
                };
            if (c.created !== undefined) child.created = c.created;
            if (c.updated !== undefined) child.updated = c.updated;
            inline.push(child);
            zones[zone] = { byName: false, rooted: false, names: [zone], facets: [] };
          }
        }
        assets.push(
          isList
            ? { ...c, type: "decklist", ...(format !== undefined && { format }), ...(shows && { shows }), zones }
            : { ...c, type: "deck", ...(list && { list }), ...(shows && { shows }), zones },
        );
        assets.push(...inline);
        break;
      }
      case "arrangement": {
        const r = new Reader(table, where, [...ASSET_KEYS, "of", "piles"]);
        const of = refer(r, "of", "decklist");
        const piles = r.tables("piles").map((t, j): Pile => {
          const p = new Reader(t, `${where}, pile ${j + 1}`, ["name", "cards", "query"]);
          const name = p.text("name");
          if (p.has("query")) {
            if (p.has("cards")) p.fail("a pile has `cards` or `query`, not both");
            return { name, query: p.text("query") };
          }
          const cards = p
            .tables("cards")
            .map((l, k) => new Reader(l, `${where}, pile "${name}", card ${k + 1}`, BUCKET_KEYS))
            .map((l) => withAdded(l, { bucket: readBucket(l, attributes) }));
          unique(cards.map((x) => bucketKey(x.bucket)), `lines for the same bucket in pile "${name}"`, where);
          return { name, cards };
        });
        unique(piles.map((p) => p.name), "piles of the same name", where);
        assets.push({ ...common(r), type: "arrangement", of, piles });
        break;
      }
    }
  });

  // The tree: every path once, a parent before its children. A parent with
  // no asset of its own is an implied folder.
  const everyPath = new Set(assets.map((a) => pathKey(a.path)));
  const byPath = new Map<string, Asset>();
  for (const a of assets) {
    const k = pathKey(a.path);
    if (byPath.has(k)) throw new LibraryFormatError(`${k}: two assets at this path`);
    for (let n = 1; n < a.path.length; n++) {
      const parent = pathKey(a.path.slice(0, n));
      if (everyPath.has(parent) && !byPath.has(parent)) {
        throw new LibraryFormatError(`${k}: comes before its parent ${parent}`);
      }
    }
    byPath.set(k, a);
  }

  // Pinned references must name something of the right type; by-name ones
  // are resolved each time they are used, and may name nothing yet.
  for (const p of pending) {
    if (p.ref.byName) continue;
    const names = resolveNames(p.ref, p.from);
    const target = byPath.get(pathKey(names));
    if (!target) {
      throw new LibraryFormatError(`${p.where}: nothing at ${formatPath(names)}`);
    }
    const type = facetType(target.type, p.ref.facets);
    if (type === null) {
      throw new LibraryFormatError(
        `${p.where}: a ${target.type} has no facet .${p.ref.facets.join(".")}`,
      );
    }
    const fits =
      p.as === "collection" ? isA(type, "checklist") || type === "decklist" || type === "deck" : isA(type, p.as);
    if (!fits) {
      throw new LibraryFormatError(`${p.where}: ${formatRef(p.ref)} is a ${type}, not a ${p.as}`);
    }
  }

  // A deck shows one of its own decklist's arrangements: a facet of it, or
  // an arrangement `of` it. Checked where both are pinned; a by-name one is
  // resolved when used.
  for (const d of decksShowing) {
    if (d.list.byName || d.shows.byName) continue;
    const list = pathKey(resolveNames(d.list, d.path));
    const base = resolveNames(d.shows, d.path);
    let of: string | null = null;
    if (d.shows.facets.length) of = pathKey(base);
    else {
      const a = byPath.get(pathKey(base));
      if (a?.type === "arrangement") of = a.of.byName ? list : pathKey(resolveNames(a.of, a.path));
    }
    if (of !== list) {
      throw new LibraryFormatError(`${d.where}, \`shows\`: not an arrangement of its decklist ${list}`);
    }
  }

  return { attributes, assets };
}
