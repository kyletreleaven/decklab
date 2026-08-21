import {
  COLOR_KEYS,
  countActiveFilters,
  FILTER_RARITIES,
  FILTER_TYPES,
  type CardFilter,
} from "../lib/filters";

function toggle(list: string[] | undefined, value: string): string[] {
  const current = list ?? [];
  return current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
}

/**
 * The facet bar, shared by the collection view and the deck-builder pool so the
 * two behave identically. Purely presentational — the caller decides whether the
 * resulting filter drives a Scryfall query or a local SQL query.
 */
/**
 * A labelled row of on/off toggles supplied by the caller — deck scopes,
 * collection membership, anything contextual. Kept generic so this component
 * does not need to know what a "scope" is; it only knows they AND with the
 * facets, like everything else here.
 */
export interface FilterGroup {
  label: string;
  toggles: {
    key: string;
    label: React.ReactNode;
    title?: string;
    on: boolean;
    onChange: (on: boolean) => void;
  }[];
}

export function CardFilters({
  filter,
  onChange,
  groups = [],
}: {
  filter: CardFilter;
  onChange: (next: CardFilter) => void;
  /** Contextual toggles, rendered after the fixed facets. */
  groups?: FilterGroup[];
}) {
  const active = countActiveFilters(filter);
  const patch = (next: Partial<CardFilter>) => onChange({ ...filter, ...next });

  return (
    <div className="filter-bar">
      <div className="filter-group">
        <span className="filter-label">Colour</span>
        {COLOR_KEYS.map((key) => (
          <button
            key={key}
            className={`pip-toggle ${filter.colors?.includes(key) ? "on" : ""}`}
            onClick={() => patch({ colors: toggle(filter.colors, key) })}
            title={key === "C" ? "Colourless" : key}
          >
            <span className={`pip ${key === "C" ? "" : key}`}>{key}</span>
          </button>
        ))}
      </div>

      <div className="filter-group">
        <span className="filter-label">Type</span>
        {FILTER_TYPES.map((type) => (
          <button
            key={type}
            className={`chip ${filter.types?.includes(type) ? "on" : ""}`}
            onClick={() => patch({ types: toggle(filter.types, type) })}
          >
            {type}
          </button>
        ))}
      </div>

      <div className="filter-group">
        <span className="filter-label">Rarity</span>
        {FILTER_RARITIES.map((rarity) => (
          <button
            key={rarity}
            className={`chip ${filter.rarities?.includes(rarity) ? "on" : ""}`}
            onClick={() => patch({ rarities: toggle(filter.rarities, rarity) })}
          >
            {rarity}
          </button>
        ))}
      </div>

      <div className="filter-group">
        <span className="filter-label">MV</span>
        <input
          type="number"
          min={0}
          placeholder="min"
          value={filter.mvMin ?? ""}
          onChange={(e) =>
            patch({ mvMin: e.target.value === "" ? undefined : Number(e.target.value) })
          }
          style={{ width: 62 }}
        />
        <span className="filter-label">–</span>
        <input
          type="number"
          min={0}
          placeholder="max"
          value={filter.mvMax ?? ""}
          onChange={(e) =>
            patch({ mvMax: e.target.value === "" ? undefined : Number(e.target.value) })
          }
          style={{ width: 62 }}
        />
      </div>

      {groups.map((group) => (
        <div className="filter-group" key={group.label}>
          <span className="filter-label">{group.label}</span>
          {group.toggles.map((toggle) => (
            <button
              key={toggle.key}
              className={`chip ${toggle.on ? "on" : ""}`}
              onClick={() => toggle.onChange(!toggle.on)}
              title={toggle.title}
            >
              {toggle.label}
            </button>
          ))}
        </div>
      ))}

      {active > 0 && (
        <button
          className="ghost"
          // Facets only, which is what the label promises and what the count
          // beside it counts. The query lives in the same object, so clearing
          // it wholesale would wipe the search box from a control that never
          // said it would. Contextual toggles belong to whoever supplied them
          // and are not this component's to reset either.
          onClick={() => onChange({ query: filter.query })}
        >
          Clear all
        </button>
      )}
    </div>
  );
}
