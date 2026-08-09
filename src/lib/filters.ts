/**
 * One filter model, two backends.
 *
 * The same facet selection drives a Scryfall search and a local collection
 * query, so the pool panel behaves identically whichever source it points at.
 * Scryfall gets a query string; collections get the SQL predicate builder in
 * `collections.ts`.
 */

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

export const COLOR_KEYS = ["W", "U", "B", "R", "G", "C"] as const;

export interface CardFilter {
  /** Substring of the card name, or free text passed through to Scryfall. */
  name?: string;
  /** Colour letters; "C" means colourless. Matches ANY selected. */
  colors?: string[];
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
    (filter.name?.trim() ? 1 : 0) +
    (filter.colors?.length ?? 0) +
    (filter.types?.length ?? 0) +
    (filter.rarities?.length ?? 0) +
    (filter.mvMin !== undefined ? 1 : 0) +
    (filter.mvMax !== undefined ? 1 : 0)
  );
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

  const name = filter.name?.trim();
  if (name) clauses.push(name);

  if (filter.colors?.length) {
    // "C" is colourless, which Scryfall spells as c:c rather than a letter.
    const parts = filter.colors.map((c) => (c === "C" ? "c:c" : `c:${c.toLowerCase()}`));
    clauses.push(parts.length === 1 ? parts[0] : `(${parts.join(" or ")})`);
  }

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

  return clauses.join(" ");
}

/** Whether a filter says anything a search backend could act on. */
export function hasSearchableTerms(filter: CardFilter): boolean {
  return toScryfallQuery(filter).trim().length > 0;
}
