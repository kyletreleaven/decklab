/**
 * The asset types: a static is-a graph, fixed here. Users do not add types.
 * See docs/inventory.md → *Open* (the ontology of asset types) and
 * docs/library-format-5.md.
 *
 * Each type names its parents and the facets every asset of it has. A file
 * names one node per asset and never the hierarchy, so this graph can be
 * reshaped without changing the format.
 */

export const TYPES = [
  "folder",
  "checklist",
  "place",
  "pool",
  "list pool",
  "query pool",
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
  checklist: { parents: [], facets: [] },
  // A place is a refinement of an exact checklist; a pool is a checklist
  // whose items are all `[0, ∞]` (docs/inventory.md → *Locations and
  // collections*).
  place: { parents: ["checklist"], facets: [] },
  pool: { parents: ["checklist"], facets: [] },
  "list pool": { parents: ["pool"], facets: [] },
  "query pool": { parents: ["pool"], facets: [] },
  deck: {
    parents: [],
    facets: ["oracle", "arranged.by_mana", "arranged.by_type", "arranged.by_colour"],
  },
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
 * type has no such facet. Chains: a deck's `oracle` is a deck (its
 * projection), so `oracle.arranged.by_type` is an arrangement.
 */
export function facetType(type: AssetType, chain: string[]): AssetType | null {
  if (!chain.length) return type;
  if (type === "deck" && chain[0] === "oracle") return facetType("deck", chain.slice(1));
  if (!ONTOLOGY[type].facets.includes(chain.join("."))) return null;
  return chain[0] === "arranged" ? "arrangement" : null;
}
