import { parse } from "smol-toml";

/**
 * The library file for schema 4: everything a user has entered, as text.
 *
 * One of a triplet — (v4 schema, `dumpV4`, `loadV4`) — whose round trip is the
 * test of the dump: `loadV4(dumpV4(lib))` must give `lib` back. Card data is
 * not in the file; a line names its printing by set, collector number and
 * language, and the cache supplies the rest. Row ids are elided and a load
 * assigns fresh ones. See `docs/lab.md` → *The library file*.
 *
 * TOML, one card per line as an inline table. A field at its schema default is
 * left out, and loading puts the default back.
 */

const FORMAT = "decklab-library";
const SCHEMA = 4;

const ZONES = ["commander", "main", "side", "maybe"] as const;
export type V4Zone = (typeof ZONES)[number];

/** A printing as a line names it. `name` is for reading, and checks the rest. */
export interface V4Printing {
  name: string;
  set: string;
  number: string;
  lang: string;
}

export interface V4Item extends V4Printing {
  quantity: number;
  finish: string;
  condition: string;
  notes: string;
  addedAt: string;
}

export interface V4Collection {
  name: string;
  kind: string;
  quantityKind: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  items: V4Item[];
}

export interface V4Pile {
  name: string;
  position: number;
}

export interface V4DeckCard extends V4Printing {
  quantity: number;
  zone: V4Zone;
  /** Pile name within the deck, or null for Unsorted. */
  pile: string | null;
  addedAt: string;
}

export interface V4Deck {
  name: string;
  format: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  piles: V4Pile[];
  cards: V4DeckCard[];
}

/** A `card_tags` row. Keyed by oracle id, as the table is; slated for deletion. */
export interface V4Tag {
  oracleId: string;
  tag: string;
}

export interface V4Library {
  collections: V4Collection[];
  decks: V4Deck[];
  tags: V4Tag[];
}

/** Schema defaults: a field holding one of these is left out of the file. */
const DEFAULTS = {
  lang: "en",
  kind: "paper",
  quantityKind: "natural",
  notes: "",
  finish: "nonfoil",
  condition: "NM",
  format: "commander",
  zone: "main",
} as const;

/* ---------- canonical order ---------- */

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function comparePrinting(a: V4Printing, b: V4Printing): number {
  return (
    byText(a.name, b.name) ||
    byText(a.set, b.set) ||
    byText(a.number, b.number) ||
    byText(a.lang, b.lang)
  );
}

/**
 * Sort everything into the order the dump writes, so that equal libraries
 * dump to equal text and a diff shows only what changed.
 */
export function canonicalV4(lib: V4Library): V4Library {
  return {
    collections: [...lib.collections]
      .sort((a, b) => byText(a.name, b.name))
      .map((c) => ({
        ...c,
        items: [...c.items].sort(
          (a, b) =>
            comparePrinting(a, b) ||
            byText(a.finish, b.finish) ||
            byText(a.condition, b.condition),
        ),
      })),
    decks: [...lib.decks]
      .sort((a, b) => byText(a.name, b.name))
      .map((d) => ({
        ...d,
        piles: [...d.piles].sort(
          (a, b) => a.position - b.position || byText(a.name, b.name),
        ),
        cards: [...d.cards].sort(
          (a, b) =>
            ZONES.indexOf(a.zone) - ZONES.indexOf(b.zone) || comparePrinting(a, b),
        ),
      })),
    tags: [...lib.tags].sort(
      (a, b) => byText(a.tag, b.tag) || byText(a.oracleId, b.oracleId),
    ),
  };
}

/* ---------- dump ---------- */

/**
 * A TOML basic string. JSON's escaping is TOML's, bar DEL, which TOML requires
 * escaped and JSON leaves alone.
 */
function str(value: string): string {
  return JSON.stringify(value).replace(/\x7f/g, "\\u007f");
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * A timestamp as a TOML datetime when it is in the canonical form `now()`
 * writes, so it reads as a date; otherwise as a string, so it survives exactly.
 */
function time(value: string): string {
  return ISO.test(value) ? value : str(value);
}

type Field = [key: string, value: string];

function inline(fields: Field[]): string {
  return `{ ${fields.map(([k, v]) => `${k} = ${v}`).join(", ")} }`;
}

/** `key = value` lines, leaving out any field equal to its default. */
function optional(fields: Field[], key: string, value: string, fallback: string) {
  if (value !== fallback) fields.push([key, str(value)]);
}

function printingFields(p: V4Printing, quantity: number): Field[] {
  const fields: Field[] = [
    ["card", str(p.name)],
    ["qty", String(quantity)],
    ["set", str(p.set)],
    ["number", str(p.number)],
  ];
  optional(fields, "lang", p.lang, DEFAULTS.lang);
  return fields;
}

function cardList(lines: string[]): string {
  if (!lines.length) return "cards = []";
  return `cards = [\n${lines.map((l) => `  ${l},`).join("\n")}\n]`;
}

/** True when positions are 0, 1, 2… in order, so list order alone keeps them. */
function contiguous(piles: V4Pile[]): boolean {
  return piles.every((p, i) => p.position === i);
}

export function dumpV4(library: V4Library): string {
  const lib = canonicalV4(library);
  const out: string[] = [`format = ${str(FORMAT)}`, `schema = ${SCHEMA}`];

  for (const c of lib.collections) {
    const head: Field[] = [["name", str(c.name)]];
    optional(head, "kind", c.kind, DEFAULTS.kind);
    optional(head, "quantity_kind", c.quantityKind, DEFAULTS.quantityKind);
    optional(head, "notes", c.notes, DEFAULTS.notes);
    head.push(["created", time(c.createdAt)], ["updated", time(c.updatedAt)]);

    const lines = c.items.map((item) => {
      const fields = printingFields(item, item.quantity);
      optional(fields, "finish", item.finish, DEFAULTS.finish);
      optional(fields, "condition", item.condition, DEFAULTS.condition);
      optional(fields, "notes", item.notes, DEFAULTS.notes);
      fields.push(["added", time(item.addedAt)]);
      return inline(fields);
    });

    out.push(
      "",
      "[[collection]]",
      ...head.map(([k, v]) => `${k} = ${v}`),
      cardList(lines),
    );
  }

  for (const d of lib.decks) {
    const head: Field[] = [["name", str(d.name)]];
    optional(head, "format", d.format, DEFAULTS.format);
    optional(head, "notes", d.notes, DEFAULTS.notes);
    head.push(["created", time(d.createdAt)], ["updated", time(d.updatedAt)]);
    if (d.piles.length) {
      // Positions are almost always 0, 1, 2…, which the list order carries.
      // Anything else is written out, so it survives.
      const piles = contiguous(d.piles)
        ? d.piles.map((p) => str(p.name))
        : d.piles.map((p) =>
            inline([
              ["name", str(p.name)],
              ["position", String(p.position)],
            ]),
          );
      head.push(["piles", `[${piles.join(", ")}]`]);
    }

    const lines = d.cards.map((card) => {
      const fields = printingFields(card, card.quantity);
      optional(fields, "zone", card.zone, DEFAULTS.zone);
      if (card.pile !== null) fields.push(["pile", str(card.pile)]);
      fields.push(["added", time(card.addedAt)]);
      return inline(fields);
    });

    out.push("", "[[deck]]", ...head.map(([k, v]) => `${k} = ${v}`), cardList(lines));
  }

  for (const t of lib.tags) {
    out.push(
      "",
      "[[tag]]",
      `oracle_id = ${str(t.oracleId)}`,
      `tag = ${str(t.tag)}`,
    );
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

function isTable(value: unknown): value is Table {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/** Reads fields off one TOML table, naming where it is in every error. */
class Reader {
  constructor(
    private readonly table: Table,
    private readonly where: string,
  ) {}

  fail(message: string): never {
    throw new LibraryFormatError(`${this.where}: ${message}`);
  }

  private get(key: string): unknown {
    return this.table[key];
  }

  text(key: string, fallback?: string): string {
    const value = this.get(key);
    if (value === undefined && fallback !== undefined) return fallback;
    if (typeof value !== "string") this.fail(`\`${key}\` must be a string`);
    return value;
  }

  whole(key: string): number {
    const value = this.get(key);
    if (typeof value !== "number" || !Number.isInteger(value)) {
      this.fail(`\`${key}\` must be a whole number`);
    }
    return value;
  }

  count(key: string): number {
    const value = this.whole(key);
    if (value < 1) this.fail(`\`${key}\` must be a whole number of at least 1`);
    return value;
  }

  /** A timestamp: a TOML datetime, or a string kept exactly as written. */
  time(key: string): string {
    const value = this.get(key);
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") return value;
    return this.fail(`\`${key}\` must be a datetime`);
  }

  list(key: string): unknown[] {
    const value = this.get(key);
    if (value === undefined) return [];
    if (!Array.isArray(value)) this.fail(`\`${key}\` must be a list`);
    return value;
  }

  tables(key: string): Table[] {
    return this.list(key).map((entry, i) => {
      if (!isTable(entry)) this.fail(`\`${key}\` entry ${i + 1} must be a table`);
      return entry;
    });
  }
}

function readPrinting(r: Reader): V4Printing {
  return {
    name: r.text("card"),
    set: r.text("set"),
    number: r.text("number"),
    lang: r.text("lang", DEFAULTS.lang),
  };
}

const printingKey = (p: V4Printing) => `${p.set}|${p.number}|${p.lang}`;

function unique(names: string[], what: string, where: string) {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      throw new LibraryFormatError(`${where}: two ${what} named "${name}"`);
    }
    seen.add(name);
  }
}

/**
 * Parse and validate a library file. Everything the database would reject —
 * duplicate names, a pile that does not exist, a repeated row — is caught
 * here, before anything is written.
 */
export function loadV4(text: string): V4Library {
  let doc: Table;
  try {
    doc = parse(text) as Table;
  } catch (e) {
    throw new LibraryFormatError(`Not valid TOML: ${(e as Error).message}`);
  }

  const top = new Reader(doc, "library");
  if (doc.format !== FORMAT) top.fail(`\`format\` must be "${FORMAT}"`);
  if (doc.schema !== SCHEMA) {
    top.fail(`this is schema ${String(doc.schema)}; this loader reads schema ${SCHEMA}`);
  }

  const collections = top.tables("collection").map((table, i) => {
    const r = new Reader(table, `collection ${i + 1}`);
    const name = r.text("name");
    const where = `collection "${name}"`;
    const c = new Reader(table, where);
    const items = c.tables("cards").map((line, j) => {
      const l = new Reader(line, `${where}, card ${j + 1}`);
      return {
        ...readPrinting(l),
        quantity: l.count("qty"),
        finish: l.text("finish", DEFAULTS.finish),
        condition: l.text("condition", DEFAULTS.condition),
        notes: l.text("notes", DEFAULTS.notes),
        addedAt: l.time("added"),
      };
    });
    unique(
      items.map((item) => `${printingKey(item)}|${item.finish}|${item.condition}`),
      "lines for the same printing, finish and condition",
      where,
    );
    return {
      name,
      kind: c.text("kind", DEFAULTS.kind),
      quantityKind: c.text("quantity_kind", DEFAULTS.quantityKind),
      notes: c.text("notes", DEFAULTS.notes),
      createdAt: c.time("created"),
      updatedAt: c.time("updated"),
      items,
    };
  });
  unique(collections.map((c) => c.name), "collections", "library");

  const decks = top.tables("deck").map((table, i) => {
    const r = new Reader(table, `deck ${i + 1}`);
    const name = r.text("name");
    const where = `deck "${name}"`;
    const d = new Reader(table, where);

    const piles = d.list("piles").map((entry, j): V4Pile => {
      if (typeof entry === "string") return { name: entry, position: j };
      if (!isTable(entry)) return d.fail(`pile ${j + 1} must be a name or a table`);
      const p = new Reader(entry, `${where}, pile ${j + 1}`);
      return { name: p.text("name"), position: p.whole("position") };
    });
    unique(piles.map((p) => p.name), "piles", where);
    const pileNames = new Set(piles.map((p) => p.name));

    const cards = d.tables("cards").map((line, j) => {
      const l = new Reader(line, `${where}, card ${j + 1}`);
      const zone = l.text("zone", DEFAULTS.zone);
      if (!(ZONES as readonly string[]).includes(zone)) {
        l.fail(`\`zone\` must be one of ${ZONES.join(", ")}`);
      }
      const pile = line.pile === undefined ? null : l.text("pile");
      if (pile !== null && !pileNames.has(pile)) l.fail(`no pile named "${pile}"`);
      return {
        ...readPrinting(l),
        quantity: l.count("qty"),
        zone: zone as V4Zone,
        pile,
        addedAt: l.time("added"),
      };
    });
    unique(
      cards.map((card) => `${printingKey(card)}|${card.zone}`),
      "lines for the same printing in one zone",
      where,
    );

    return {
      name,
      format: d.text("format", DEFAULTS.format),
      notes: d.text("notes", DEFAULTS.notes),
      createdAt: d.time("created"),
      updatedAt: d.time("updated"),
      piles,
      cards,
    };
  });
  unique(decks.map((d) => d.name), "decks", "library");

  const tags = top.tables("tag").map((table, i) => {
    const r = new Reader(table, `tag ${i + 1}`);
    return { oracleId: r.text("oracle_id"), tag: r.text("tag") };
  });
  unique(tags.map((t) => `${t.oracleId}|${t.tag}`), "identical tags", "library");

  return { collections, decks, tags };
}

/** Every distinct printing the library names. */
export function printingsOf(lib: V4Library): V4Printing[] {
  const all = new Map<string, V4Printing>();
  for (const c of lib.collections) for (const item of c.items) all.set(printingKey(item), item);
  for (const d of lib.decks) for (const card of d.cards) all.set(printingKey(card), card);
  return [...all.values()].map(({ name, set, number, lang }) => ({ name, set, number, lang }));
}

export { printingKey };
