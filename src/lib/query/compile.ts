/**
 * Compiles a parsed query into a parameterised SQL fragment over `cards`.
 *
 * Every value is a bound parameter; nothing user-supplied is ever interpolated.
 * Field names come from a fixed map, so those are not user-supplied either.
 *
 * The fragment is a boolean expression suitable for a WHERE clause, with
 * placeholders numbered from `paramOffset + 1` so it can be embedded in a larger
 * query that already has parameters of its own.
 */

import { eachTerm, type Node } from "./parse";
import type { Op } from "./lex";

export class CompileError extends Error {
  constructor(
    message: string,
    readonly at: number,
    /** What the user typed, so callers can name it without re-deriving. */
    readonly term?: string,
  ) {
    super(message);
    this.name = "CompileError";
  }
}

export interface CompiledQuery {
  sql: string;
  params: unknown[];
}

export interface CompileOptions {
  /** Table alias the fragment is written against. */
  alias?: string;
  /** Placeholders start at this number plus one. */
  paramOffset?: number;
}

const COLOUR_LETTERS = ["W", "U", "B", "R", "G"] as const;

const COLOUR_NAMES: Record<string, string> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
};

const RARITY_RANK = ["common", "uncommon", "rare", "mythic"];

/** Fields that are matched as substrings of a text column. */
const TEXT_FIELDS: Record<string, string> = {
  name: "name",
  n: "name",
  t: "type_line",
  type: "type_line",
  o: "oracle_text",
  oracle: "oracle_text",
  a: "artist",
  ft: "flavor_text",
};

/** Fields compared as numbers against a REAL column. */
const NUMERIC_FIELDS: Record<string, string> = {
  mv: "cmc",
  cmc: "cmc",
};

/** Numeric fields stored as TEXT, which need the `*` guard. */
const NUMERIC_TEXT_FIELDS: Record<string, string> = {
  pow: "power",
  power: "power",
  tou: "toughness",
  toughness: "toughness",
  loy: "loyalty",
  loyalty: "loyalty",
};

const COLOUR_FIELDS: Record<string, string> = {
  c: "colors",
  color: "colors",
  colour: "colors",
  id: "color_identity",
  identity: "color_identity",
};

const SET_FIELDS = new Set(["s", "set", "e", "edition"]);

/** Recognised but not implementable locally — reported, never silently ignored. */
const UNSUPPORTED: Record<string, string> = {
  is: "`is:` is not supported in local collections yet",
  has: "`has:` is not supported in local collections yet",
  in: "`in:` is not supported in local collections yet",
  new: "`new:` is not supported in local collections yet",
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Parse a colour value into distinct letters.
 * Accepts letters (`rw`), names (`red`), `c` for colourless, `m` for multicolour.
 */
function parseColours(
  raw: string,
  at: number,
): { letters: string[]; colourless: boolean; multicolour: boolean } {
  const value = raw.trim().toLowerCase();
  if (!value) throw new CompileError("colour value is empty", at);

  if (value === "c" || value === "colorless" || value === "colourless") {
    return { letters: [], colourless: true, multicolour: false };
  }
  if (value === "m" || value === "multicolor" || value === "multicolour") {
    return { letters: [], colourless: false, multicolour: true };
  }

  const named = COLOUR_NAMES[value];
  if (named) return { letters: [named], colourless: false, multicolour: false };

  const letters: string[] = [];
  for (const ch of value) {
    const upper = ch.toUpperCase();
    if (!(COLOUR_LETTERS as readonly string[]).includes(upper)) {
      throw new CompileError(`'${ch}' is not a colour`, at, raw);
    }
    if (!letters.includes(upper)) letters.push(upper);
  }
  return { letters, colourless: false, multicolour: false };
}

export function compile(
  node: Node,
  options: CompileOptions = {},
): CompiledQuery {
  const { alias = "c", paramOffset = 0 } = options;
  const params: unknown[] = [];

  /** Bind a value and return its placeholder. */
  const p = (value: unknown): string => {
    params.push(value);
    return `$${paramOffset + params.length}`;
  };

  const col = (name: string) => `${alias}.${name}`;

  function contains(column: string, value: string): string {
    return `${col(column)} LIKE ${p(`%${escapeLike(value)}%`)} ESCAPE '\\'`;
  }

  function textTerm(column: string, op: Op, value: string): string {
    switch (op) {
      case ":":
        return contains(column, value);
      case "=":
        return `${col(column)} = ${p(value)}`;
      case "!=":
        return `NOT (${contains(column, value)})`;
      default:
        throw new CompileError(`'${op}' cannot be used on text`, 0, value);
    }
  }

  function numericTerm(column: string, op: Op, value: string, at: number): string {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new CompileError(`'${value}' is not a number`, at, value);
    }
    // `:` means equality for numbers, matching Scryfall.
    const sqlOp = op === ":" ? "=" : op;
    return `${col(column)} ${sqlOp} ${p(n)}`;
  }

  /**
   * Power, toughness and loyalty are TEXT and hold `*`, `1+*`, `∞`.
   * SQLite's CAST('*' AS INTEGER) is 0, so an unguarded `pow<=1` matches every
   * `*` creature. Restrict to all-digit values before comparing.
   */
  function numericTextTerm(
    column: string,
    op: Op,
    value: string,
    at: number,
  ): string {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new CompileError(
        `'${value}' is not a number (variable power like * is not supported yet)`,
        at,
        value,
      );
    }
    const sqlOp = op === ":" ? "=" : op;
    const c = col(column);
    return (
      `(${c} GLOB '[0-9]*' AND ${c} NOT GLOB '*[^0-9]*' ` +
      `AND CAST(${c} AS INTEGER) ${sqlOp} ${p(n)})`
    );
  }

  /**
   * Colour comparisons are written to be independent of the order colours are
   * stored in, so nothing here relies on the WUBRG canonicalisation holding.
   * "Exactly RW" is *contains R, contains W, and has two colours* rather than a
   * string equality against `'WR'`.
   */
  function colourTerm(column: string, op: Op, value: string, at: number): string {
    const { letters, colourless, multicolour } = parseColours(value, at);
    const c = col(column);

    if (colourless) {
      return op === "!=" ? `LENGTH(${c}) > 0` : `LENGTH(${c}) = 0`;
    }
    if (multicolour) {
      return op === "!=" ? `LENGTH(${c}) <= 1` : `LENGTH(${c}) > 1`;
    }

    // These are built lazily and only for the branch that uses them: calling
    // `p()` binds a parameter, so constructing all three up front would bind
    // parameters no branch references and corrupt the numbering.
    const containsAll = () =>
      letters.map((l) => `${c} LIKE ${p(`%${l}%`)}`).join(" AND ");
    const withinSet = () => {
      const outside = COLOUR_LETTERS.filter((l) => !letters.includes(l));
      if (!outside.length) return "1=1";
      return outside.map((l) => `${c} NOT LIKE ${p(`%${l}%`)}`).join(" AND ");
    };
    const exactCount = () => `LENGTH(${c}) = ${p(letters.length)}`;

    // Every branch returns a self-contained expression. Returning a bare
    // `a AND b` would mis-associate once embedded in an OR.
    switch (op) {
      // `c:rw` and `c>=rw` both mean "at least these colours".
      case ":":
      case ">=":
        return `(${containsAll()})`;
      case "=":
        return `(${containsAll()} AND ${exactCount()})`;
      case "!=":
        return `NOT (${containsAll()} AND ${exactCount()})`;
      // The Commander identity rule: no colour outside the given set.
      case "<=":
        return `(${withinSet()})`;
      case ">":
        return `(${containsAll()} AND NOT (${exactCount()}))`;
      case "<":
        return `(${withinSet()} AND NOT (${exactCount()}))`;
    }
  }

  function rarityTerm(op: Op, value: string, at: number): string {
    const wanted = value.trim().toLowerCase();
    const full = RARITY_RANK.find((r) => r.startsWith(wanted));
    if (!full) throw new CompileError(`'${value}' is not a rarity`, at, value);

    if (op === ":" || op === "=") return `${col("rarity")} = ${p(full)}`;
    if (op === "!=") return `${col("rarity")} <> ${p(full)}`;

    // Rarity is ordered, so comparisons rank it rather than comparing strings.
    const cases = RARITY_RANK.map((r, i) => `WHEN ${p(r)} THEN ${i}`).join(" ");
    return `(CASE ${col("rarity")} ${cases} ELSE -1 END) ${op} ${p(
      RARITY_RANK.indexOf(full),
    )}`;
  }

  function term(node: Extract<Node, { kind: "term" }>): string {
    const { field, op, value, at } = node;

    // A bare word matches the card name.
    if (field === null) return contains("name", value);

    const key = field.toLowerCase();

    if (UNSUPPORTED[key]) {
      throw new CompileError(UNSUPPORTED[key], at, `${field}${op}${value}`);
    }

    if (TEXT_FIELDS[key]) {
      const column = TEXT_FIELDS[key];
      // artist and flavor_text are not columns; they live in the raw payload.
      if (column === "artist" || column === "flavor_text") {
        const path = column === "artist" ? "$.artist" : "$.flavor_text";
        const expr = `COALESCE(json_extract(${col("data")}, '${path}'), '')`;
        if (op === ":") {
          return `${expr} LIKE ${p(`%${escapeLike(value)}%`)} ESCAPE '\\'`;
        }
        if (op === "=") return `${expr} = ${p(value)}`;
        throw new CompileError(`'${op}' cannot be used on ${field}`, at, value);
      }
      return textTerm(column, op, value);
    }

    if (NUMERIC_FIELDS[key]) {
      return numericTerm(NUMERIC_FIELDS[key], op, value, at);
    }

    if (NUMERIC_TEXT_FIELDS[key]) {
      return numericTextTerm(NUMERIC_TEXT_FIELDS[key], op, value, at);
    }

    if (COLOUR_FIELDS[key]) {
      return colourTerm(COLOUR_FIELDS[key], op, value, at);
    }

    if (key === "r" || key === "rarity") {
      return rarityTerm(op, value, at);
    }

    if (SET_FIELDS.has(key)) {
      const v = value.trim().toLowerCase();
      return op === "!="
        ? `${col("set_code")} <> ${p(v)}`
        : `${col("set_code")} = ${p(v)}`;
    }

    if (key === "f" || key === "format" || key === "legal") {
      // Parameterised rather than concatenated into the JSON path, so a format
      // name can never alter the expression.
      return `json_extract(${col("legalities")}, '$.' || ${p(
        value.trim().toLowerCase(),
      )}) IN ('legal', 'restricted')`;
    }

    if (key === "kw" || key === "keyword") {
      return (
        `EXISTS (SELECT 1 FROM json_each(${col("keywords")}) ` +
        `WHERE lower(json_each.value) = ${p(value.trim().toLowerCase())})`
      );
    }

    if (key === "layout") {
      return `${col("layout")} = ${p(value.trim().toLowerCase())}`;
    }

    throw new CompileError(
      `unknown field '${field}'`,
      at,
      `${field}${op}${value}`,
    );
  }

  function walk(node: Node): string {
    switch (node.kind) {
      case "term":
        return term(node);
      case "not":
        return `NOT (${walk(node.node)})`;
      case "and":
        return `(${node.nodes.map(walk).join(" AND ")})`;
      case "or":
        return `(${node.nodes.map(walk).join(" OR ")})`;
    }
  }

  return { sql: walk(node), params };
}

/**
 * Every term a local compile would reject, without throwing.
 *
 * Lets the UI say "`is:` is not supported here" up front rather than failing on
 * submit, and lets a caller decide to send the query to Scryfall instead.
 */
export function unsupportedTerms(node: Node): string[] {
  const problems: string[] = [];
  eachTerm(node, (t) => {
    try {
      compile(t);
    } catch (err) {
      if (err instanceof CompileError) {
        problems.push(err.message);
      }
    }
  });
  return problems;
}
