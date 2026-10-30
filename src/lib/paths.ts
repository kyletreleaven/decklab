/**
 * Asset paths and references, as written in a library file and a query.
 * See docs/inventory/asset-tree.md → *Naming a set in a query*, *Facets* and *Quoting in
 * paths*.
 *
 * Two marks, each answering one question:
 *
 * - `&`: by name (whatever is at the path when used) rather than pinned
 *   (follows the asset).
 * - a leading `/`: rooted rather than relative to the referrer, and a
 *   relative path reaches down only.
 *
 * `/` separates names (*contains*); an unquoted `.` starts a facet chain
 * (*derived from*). A name with a special character is quoted, a quote inside
 * doubled: `/Decks/"Atraxa v1.2".arranged.by_mana`.
 */

export interface Ref {
  /** `&`: resolved by name each time, never rewritten. */
  byName: boolean;
  /** A leading `/`. */
  rooted: boolean;
  /** Names from the anchor down; empty for the root, or for the referrer itself. */
  names: string[];
  /** The facet chain after the last name: `["arranged", "by_mana"]`. */
  facets: string[];
}

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathError";
  }
}

/** Characters that make a name need quotes. */
const SPECIAL = /[/.&:"]/;

/** A facet: an identifier from the ontology, never a user name. */
const FACET = /^[a-z_][a-z0-9_]*$/;

/** Names that can never be given, so `..` stays free for upward paths. */
const RESERVED = new Set([".", ".."]);

/** Why a name cannot be given, or null when it can. */
export function badName(name: string): string | null {
  if (name === "") return "a name cannot be empty";
  if (RESERVED.has(name)) return `"${name}" is reserved`;
  if (name !== name.trim()) return "a name cannot start or end with a space";
  return null;
}

/** A name as written in a path: quoted when it holds a special character. */
export function quoteName(name: string): string {
  return SPECIAL.test(name) ? `"${name.replace(/"/g, '""')}"` : name;
}

export function formatRef(ref: Ref): string {
  const body = ref.names.map(quoteName).join("/");
  const facets = ref.facets.map((f) => `.${f}`).join("");
  return `${ref.byName ? "&" : ""}${ref.rooted ? "/" : ""}${body}${facets}`;
}

/** An asset's own path: rooted, pinned, no facets. */
export function formatPath(names: string[]): string {
  return formatRef({ byName: false, rooted: true, names, facets: [] });
}

export function parseRef(text: string): Ref {
  const fail = (why: string): never => {
    throw new PathError(`${JSON.stringify(text)}: ${why}`);
  };

  let i = 0;
  const byName = text[i] === "&";
  if (byName) i++;
  const rooted = text[i] === "/";
  if (rooted) i++;

  const names: string[] = [];
  // A path that is only a facet chain (`.arranged.by_mana`) names the
  // referrer's own facet; otherwise names come first.
  if (i < text.length && text[i] !== ".") {
    for (;;) {
      let name: string;
      if (text[i] === '"') {
        let j = i + 1;
        name = "";
        for (;;) {
          if (j >= text.length) fail("an unclosed quote");
          if (text[j] === '"') {
            if (text[j + 1] === '"') {
              name += '"';
              j += 2;
              continue;
            }
            break;
          }
          name += text[j++];
        }
        i = j + 1;
      } else {
        let j = i;
        while (j < text.length && !SPECIAL.test(text[j])) j++;
        name = text.slice(i, j);
        if (j < text.length && text[j] === '"') fail("a quote inside an unquoted name");
        if (j < text.length && (text[j] === "&" || text[j] === ":")) {
          fail(`"${text[j]}" inside a name must be quoted`);
        }
        i = j;
      }
      const why = badName(name);
      if (why) fail(why);
      names.push(name);
      if (text[i] !== "/") break;
      i++;
    }
  }

  const facets: string[] = [];
  while (i < text.length) {
    if (text[i] !== ".") fail(`unexpected "${text[i]}"`);
    let j = i + 1;
    while (j < text.length && text[j] !== ".") j++;
    const facet = text.slice(i + 1, j);
    if (!FACET.test(facet)) {
      fail(
        facet === ""
          ? "an empty facet"
          : `"${facet}" is not a facet: a name with a "." must be quoted`,
      );
    }
    facets.push(facet);
    i = j;
  }

  if (!rooted && !names.length && !facets.length) fail("an empty path");
  return { byName, rooted, names, facets };
}

/** An asset's own path, as `path =` gives it: rooted and pinned, no facets. */
export function parsePath(text: string): string[] {
  const ref = parseRef(text);
  if (ref.byName) throw new PathError(`${JSON.stringify(text)}: an asset's path cannot be by name`);
  if (!ref.rooted) throw new PathError(`${JSON.stringify(text)}: an asset's path must start with "/"`);
  if (ref.facets.length) throw new PathError(`${JSON.stringify(text)}: a facet cannot be defined`);
  if (!ref.names.length) throw new PathError(`${JSON.stringify(text)}: the root is not an asset`);
  return ref.names;
}

/** Where a reference points, as names from the root; the facets are separate. */
export function resolveNames(ref: Ref, referrer: string[]): string[] {
  return ref.rooted ? ref.names : [...referrer, ...ref.names];
}

export const pathKey = (names: string[]) => formatPath(names);
