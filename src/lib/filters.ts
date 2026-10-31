/**
 * One filter model, two backends.
 *
 * The same facet selection drives a Scryfall search and a local collection
 * query, so the pool panel behaves identically whichever source it points at.
 * Scryfall gets a query string; collections get the SQL predicate builder in
 * `collections.ts`.
 */

import { canonicalColors } from "./types";

export const FILTER_TYPES = [
  "Creature",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Planeswalker",
  "Land",
] as const;

export const FILTER_RARITIES = ["common", "uncommon", "rare", "mythic"] as const;

export const COLOR_KEYS = ["W", "U", "B", "R", "G"] as const;

/** Which colour fact the selected pips are compared against. */
export type ColorField = "colors" | "identity";

/**
 * How the selection relates to the card. There is deliberately no "exactly":
 * it is `contains` with both count bounds pinned to the size of the selection,
 * so making it an operator would give two spellings of one filter.
 */
export type ColorOp = "contains" | "containedBy";

export const COLOR_FIELD_LABELS: Record<ColorField, string> = {
  colors: "Colour",
  identity: "Colour identity",
};

export const COLOR_OP_LABELS: Record<ColorOp, string> = {
  contains: "contains",
  containedBy: "contained by",
};

export interface CardFilter {
  /**
   * The free-text query. Full search syntax either way: passed through to
   * Scryfall for remote sources, compiled to SQL for local ones.
   */
  query?: string;
  /**
   * The colour letters the operator compares against — a set, not a list of
   * alternatives. Empty means no comparison at all, which is why colourless is
   * not a member here: it is `colorCountMax: 0`.
   */
  colors?: string[];
  /** What `colors` is compared against. Defaults to the card's own colours. */
  colorField?: ColorField;
  /** How `colors` is compared. Defaults to "contains". */
  colorOp?: ColorOp;
  /**
   * Bounds on how many colours the card has, counted on the same field as
   * `colorField`. 0/0 is colourless, 1/1 mono-coloured, min 2 multicoloured.
   */
  colorCountMin?: number;
  colorCountMax?: number;
  types?: string[];
  rarities?: string[];
  mvMin?: number;
  mvMax?: number;
  /**
   * Restrict to a colour identity, as a canonical WUBRG string. Used to scope a
   * pool to a deck's commander; empty string means colourless only, undefined
   * means no restriction.
   */
  withinIdentity?: string;
  /** Format legality, e.g. "commander". */
  legalIn?: string;

  /**
   * Restrict to cards available as a physical object.
   *
   * Grain-sensitive on purpose. Against Scryfall this asks whether *some*
   * printing exists in paper; against a collection it asks whether *this*
   * printing is one. Each is the right question for its stream — a collection
   * holds printings, the pool pages oracle rows.
   *
   * The local column is `digital`, which means "this printing is not available
   * in paper" rather than "exists in a digital game": a printing on both MTGO
   * and paper is `digital = 0`. Verified against a 350-printing sample, where
   * `digital == ('paper' not in games)` held without exception.
   */
  paperOnly?: boolean;

  /**
   * Arena-style ownership toggles. Both on (the default) shows everything with
   * unowned cards dimmed rather than hidden.
   *
   * These cannot become part of a Scryfall query — Scryfall does not know what
   * you own — so they are applied locally against the reference collections.
   */
  showOwned?: boolean;
  showUnowned?: boolean;
}

export type OwnershipMode = "all" | "owned" | "unowned" | "none";

/** Resolve the two toggles into what should actually be displayed. */
export function ownershipMode(filter: CardFilter): OwnershipMode {
  // Undefined means unset, which reads as on — a fresh filter shows everything.
  const owned = filter.showOwned !== false;
  const unowned = filter.showUnowned !== false;
  if (owned && unowned) return "all";
  if (owned) return "owned";
  if (unowned) return "unowned";
  return "none";
}

export const EMPTY_FILTER: CardFilter = {};

export function isFilterEmpty(filter: CardFilter): boolean {
  return countActiveFilters(filter) === 0;
}

export function countActiveFilters(filter: CardFilter): number {
  return (
    (filter.colors?.length ?? 0) +
    // The field never narrows on its own, so counting it would show "1 active"
    // on a fresh bar. The operator narrows in exactly one case: contained by an
    // empty selection is "colourless", which must not filter while the bar
    // still reads as clear.
    (filter.colorOp === "containedBy" && !filter.colors?.length ? 1 : 0) +
    (filter.colorCountMin !== undefined ? 1 : 0) +
    (filter.colorCountMax !== undefined ? 1 : 0) +
    (filter.types?.length ?? 0) +
    (filter.rarities?.length ?? 0) +
    (filter.mvMin !== undefined ? 1 : 0) +
    (filter.mvMax !== undefined ? 1 : 0) +
    (filter.paperOnly ? 1 : 0)
  );
}

/**
 * The colour facets as a Scryfall query fragment.
 *
 * Shared rather than reimplemented per backend: the remote path splices this
 * into the query it sends, and the local path hands the same string to
 * `compileQuery`, which already knows all six colour operators. One grammar, so
 * the pips cannot mean one thing against All Magic and another against a
 * collection — which is exactly what they used to do.
 */
export function colorQueryFragment(filter: CardFilter): string {
  // Both the containment test and the count read the same field, so switching
  // to identity switches them together.
  const field = filter.colorField === "identity" ? "id" : "c";
  const clauses: string[] = [];

  const letters = canonicalColors(filter.colors).toLowerCase();
  if (filter.colorOp === "containedBy") {
    // An empty selection is a real restriction here, not the absence of one:
    // the only cards whose colours are a subset of nothing are the colourless
    // ones. Spelled `c` because Scryfall has no empty colour literal — the same
    // move `withinIdentity` makes for a colourless commander.
    clauses.push(`${field}<=${letters || "c"}`);
  } else if (letters) {
    // "contains nothing" is true of every card, so an empty selection really is
    // no filter on this side.
    clauses.push(`${field}>=${letters}`);
  }

  // Counting subsumes several controls that would otherwise each need one:
  // 0/0 colourless, 1/1 mono, min 2 multicoloured, and both bounds pinned to
  // the selection size turns "contains" into "exactly".
  if (filter.colorCountMin !== undefined) {
    clauses.push(`${field}>=${filter.colorCountMin}`);
  }
  if (filter.colorCountMax !== undefined) {
    clauses.push(`${field}<=${filter.colorCountMax}`);
  }

  return clauses.join(" ");
}

/** Quote a value for Scryfall if it contains anything needing it. */
function quote(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/**
 * Translate a filter into Scryfall query syntax.
 *
 * Facets become clauses rather than being applied client-side, so paging and
 * result counts stay correct — Scryfall does the work, which is also why the
 * free-text part is passed through untouched and can use full Scryfall syntax.
 */
export function toScryfallQuery(filter: CardFilter): string {
  const clauses: string[] = [];

  const query = filter.query?.trim();
  if (query) clauses.push(query);

  const colors = colorQueryFragment(filter);
  if (colors) clauses.push(colors);

  if (filter.types?.length) {
    const parts = filter.types.map((t) => `t:${t.toLowerCase()}`);
    clauses.push(parts.length === 1 ? parts[0] : `(${parts.join(" or ")})`);
  }

  if (filter.rarities?.length) {
    const parts = filter.rarities.map((r) => `r:${r}`);
    clauses.push(parts.length === 1 ? parts[0] : `(${parts.join(" or ")})`);
  }

  if (filter.mvMin !== undefined) clauses.push(`mv>=${filter.mvMin}`);
  if (filter.mvMax !== undefined) clauses.push(`mv<=${filter.mvMax}`);

  if (filter.withinIdentity !== undefined) {
    // id<= is "identity is a subset of", which is exactly the Commander rule.
    // An empty identity means colourless only.
    clauses.push(`id<=${filter.withinIdentity || "c"}`);
  }

  if (filter.legalIn) clauses.push(`f:${quote(filter.legalIn)}`);

  if (filter.paperOnly) clauses.push("game:paper");

  return clauses.join(" ");
}

/**
 * What *More filters* sets, kept beside a query pool's text so that opening
 * the pool gives the settings back rather than their query. The pool means
 * the two together: `toScryfallQuery({ query, ...filters })`.
 */
export type SavedFilters = Pick<
  CardFilter,
  "colors" | "colorField" | "colorOp" | "colorCountMin" | "colorCountMax" | "types" | "rarities" | "mvMin" | "mvMax" | "paperOnly"
>;

const SAVED_KEYS = [
  "colors",
  "colorField",
  "colorOp",
  "colorCountMin",
  "colorCountMax",
  "types",
  "rarities",
  "mvMin",
  "mvMax",
  "paperOnly",
] as const satisfies readonly (keyof SavedFilters)[];

/** The order a list setting is kept in, whatever order it was clicked in. */
const ORDER: Partial<Record<keyof SavedFilters, readonly string[]>> = {
  colors: COLOR_KEYS,
  types: FILTER_TYPES,
  rarities: FILTER_RARITIES,
};

/** The saved part of a filter: only the keys that say something, lists in order. */
export function savedFilters(filter: CardFilter): SavedFilters {
  const out: Record<string, unknown> = {};
  for (const k of SAVED_KEYS) {
    const v = filter[k];
    if (v === undefined || v === false || (Array.isArray(v) && !v.length)) continue;
    const order = ORDER[k];
    out[k] = Array.isArray(v) && order ? [...v].sort((a, b) => order.indexOf(a) - order.indexOf(b)) : v;
  }
  return out as SavedFilters;
}

/**
 * Saved filters from outside — a library file, the agent API — checked key
 * by key; `fail` says why not.
 */
export function parseSavedFilters(raw: unknown, fail: (why: string) => never): SavedFilters {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("`filters` must be a table");
  const o = raw as Record<string, unknown>;
  const strings = (k: string, allowed: readonly string[]) => {
    const v = o[k];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !allowed.includes(x))) {
      fail(`\`filters.${k}\` must be a list of ${allowed.join(", ")}`);
    }
    return v as string[];
  };
  const whole = (k: string) => {
    const v = o[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) fail(`\`filters.${k}\` must be a whole number`);
    return v as number;
  };
  const one = <T extends string>(k: string, allowed: readonly T[]) => {
    if (!allowed.includes(o[k] as T)) fail(`\`filters.${k}\` must be one of ${allowed.join(", ")}`);
    return o[k] as T;
  };
  const out: SavedFilters = {};
  for (const k of Object.keys(o)) {
    if (!(SAVED_KEYS as readonly string[]).includes(k)) fail(`\`filters\`: unknown key \`${k}\``);
  }
  if (o.colors !== undefined) out.colors = strings("colors", COLOR_KEYS);
  if (o.colorField !== undefined) out.colorField = one("colorField", ["colors", "identity"] as const);
  if (o.colorOp !== undefined) out.colorOp = one("colorOp", ["contains", "containedBy"] as const);
  if (o.colorCountMin !== undefined) out.colorCountMin = whole("colorCountMin");
  if (o.colorCountMax !== undefined) out.colorCountMax = whole("colorCountMax");
  if (o.types !== undefined) out.types = strings("types", FILTER_TYPES);
  if (o.rarities !== undefined) out.rarities = strings("rarities", FILTER_RARITIES);
  if (o.mvMin !== undefined) out.mvMin = whole("mvMin");
  if (o.mvMax !== undefined) out.mvMax = whole("mvMax");
  if (o.paperOnly !== undefined) {
    if (typeof o.paperOnly !== "boolean") fail("`filters.paperOnly` must be true or false");
    out.paperOnly = o.paperOnly as boolean;
  }
  return savedFilters(out);
}

/**
 * A search split for keeping: the text box's query with whatever else is not
 * a *More filters* setting (a deck's scopes) written into it, and the
 * settings themselves. Together they search what `filter` does.
 */
export function splitSearch(filter: CardFilter): { query: string; filters: SavedFilters } {
  const rest: CardFilter = { ...filter };
  for (const k of SAVED_KEYS) delete rest[k];
  return { query: toScryfallQuery(rest).trim(), filters: savedFilters(filter) };
}

/** Whether two kept searches are the same: what Save and Revert compare. */
export function sameSearch(a: { query: string; filters?: SavedFilters }, b: { query: string; filters?: SavedFilters }): boolean {
  return a.query.trim() === b.query.trim() && filtersColumn(a.filters) === filtersColumn(b.filters);
}

/** Saved filters as the lab's `filters` column holds them: NULL for none. */
export function filtersColumn(f: SavedFilters | undefined): string | null {
  const saved = savedFilters(f ?? {});
  return Object.keys(saved).length ? JSON.stringify(saved) : null;
}

export function filtersOfColumn(text: string | null): SavedFilters {
  return text === null ? {} : savedFilters(JSON.parse(text) as SavedFilters);
}

/** Whether a filter says anything a search backend could act on. */
export function hasSearchableTerms(filter: CardFilter): boolean {
  return toScryfallQuery(filter).trim().length > 0;
}

/**
 * The name a search is given: the whole of it, *More filters* written out
 * as their query, shortened past 40 characters.
 */
export function searchName(query: string, filters: SavedFilters = {}): string {
  const text = toScryfallQuery({ query, ...filters }).trim();
  return text.length > 40 ? `${text.slice(0, 39).trimEnd()}…` : text;
}
