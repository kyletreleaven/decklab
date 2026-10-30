/**
 * The asset types: a static is-a graph, fixed here. Users do not add types.
 * See docs/inventory/README.md → *Open* (the ontology of asset types) and
 * docs/library-format-5.md.
 *
 * Each type names its parents and the facets every asset of it has. A file
 * names one node per asset and never the hierarchy, so this graph can be
 * reshaped without changing the format.
 */

export const TYPES = [
  "folder",
  "collection",
  "checklist",
  "exact checklist",
  "place",
  "sum",
  "pool",
  "list pool",
  "query pool",
  "decklist",
  "deck",
  "arrangement",
] as const;

export type AssetType = (typeof TYPES)[number];

interface Node {
  parents: AssetType[];
  /** Facet chains, dotted: `arranged.by_mana`. */
  facets: string[];
}

const ONTOLOGY: Record<AssetType, Node> = {
  folder: { parents: [], facets: [] },
  // What holds cards: a place, a sum of them, and someday a filtered
  // collection. Not a type an asset has, only one to name: a checklist is
  // checked `on` one. A place converts to a checklist, its lines read as
  // minimums; a checklist converts back to a place (docs/inventory/goals.md →
  // *Kinds of checklist*).
  collection: { parents: [], facets: [] },
  place: { parents: ["collection"], facets: [] },
  // The sum of its children that are collections, recursively; nothing of
  // its own. A deck is one, of its zones (docs/inventory/README.md → *Unions*).
  sum: { parents: ["collection"], facets: [] },
  // A checklist asks for at least its counts. An exact one asks for exactly
  // them and nothing unlisted, so it refines the checklist with its lines.
  checklist: { parents: [], facets: [] },
  "exact checklist": { parents: ["checklist"], facets: [] },
  // A pool is a checklist whose items are all `[0, ∞]`.
  pool: { parents: ["checklist"], facets: [] },
  "list pool": { parents: ["pool"], facets: [] },
  "query pool": { parents: ["pool"], facets: [] },
  // A decklist's zones are checklists: what a deck should hold — its
  // commander and main exact. A deck's zones are places: what it does hold,
  // and it always builds a decklist. Arrangements are the decklist's; a
  // deck shows one of its decklist's (docs/inventory/goals.md → *Every decklist
  // has an oracle projection*).
  decklist: {
    parents: [],
    facets: ["oracle", "arranged.by_mana", "arranged.by_type", "arranged.by_colour"],
  },
  deck: { parents: ["sum"], facets: [] },
  arrangement: { parents: [], facets: [] },
};

export function isType(name: string): name is AssetType {
  return (TYPES as readonly string[]).includes(name);
}

/** `type` is `ancestor`, or descends from it. */
export function isA(type: AssetType, ancestor: AssetType): boolean {
  return type === ancestor || ONTOLOGY[type].parents.some((p) => isA(p, ancestor));
}

/**
 * The type of what a facet chain names, on an asset of `type`; null when the
 * type has no such facet. Chains: a decklist's `oracle` is a decklist (its
 * projection), so `oracle.arranged.by_type` is an arrangement.
 */
export function facetType(type: AssetType, chain: string[]): AssetType | null {
  if (!chain.length) return type;
  if (type === "decklist" && chain[0] === "oracle") return facetType("decklist", chain.slice(1));
  if (!ONTOLOGY[type].facets.includes(chain.join("."))) return null;
  return chain[0] === "arranged" ? "arrangement" : null;
}
