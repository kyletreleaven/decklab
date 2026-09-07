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

/** Whether a filter says anything a search backend could act on. */
export function hasSearchableTerms(filter: CardFilter): boolean {
  return toScryfallQuery(filter).trim().length > 0;
}
