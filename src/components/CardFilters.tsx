import {
  COLOR_FIELD_LABELS,
  COLOR_KEYS,
  COLOR_OP_LABELS,
  countActiveFilters,
  FILTER_RARITIES,
  FILTER_TYPES,
  type CardFilter,
  type ColorField,
  type ColorOp,
} from "../lib/filters";

function toggle(list: string[] | undefined, value: string): string[] {
  const current = list ?? [];
  return current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
}

/** An empty numeric box means "no bound", which is not the same as zero. */
function bound(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
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
      {/* The pips are one set compared against one field, so the field and the
          operator are part of the same control rather than a separate group. */}
      <div className="filter-group">
        <select
          className="filter-select"
          value={filter.colorField ?? "colors"}
          onChange={(e) => patch({ colorField: e.target.value as ColorField })}
        >
          {(Object.keys(COLOR_FIELD_LABELS) as ColorField[]).map((field) => (
            <option key={field} value={field}>
              {COLOR_FIELD_LABELS[field]}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          value={filter.colorOp ?? "contains"}
          onChange={(e) => patch({ colorOp: e.target.value as ColorOp })}
        >
          {(Object.keys(COLOR_OP_LABELS) as ColorOp[]).map((op) => (
            <option key={op} value={op}>
              {COLOR_OP_LABELS[op]}
            </option>
          ))}
        </select>
        {COLOR_KEYS.map((key) => (
          <button
            key={key}
            className={`pip-toggle ${filter.colors?.includes(key) ? "on" : ""}`}
            onClick={() => patch({ colors: toggle(filter.colors, key) })}
            title={key}
          >
            <span className={`pip ${key}`}>{key}</span>
          </button>
        ))}
      </div>

      {/* Colourless is 0–0 here rather than a sixth pip: "contains colourless"
          would not mean anything, but "has no colours" does. */}
      <div className="filter-group">
        <span className="filter-label">Colours</span>
        <input
          type="number"
          min={0}
          max={5}
          placeholder="min"
          value={filter.colorCountMin ?? ""}
          onChange={(e) => patch({ colorCountMin: bound(e.target.value) })}
          style={{ width: 62 }}
        />
        <span className="filter-label">–</span>
        <input
          type="number"
          min={0}
          max={5}
          placeholder="max"
          value={filter.colorCountMax ?? ""}
          onChange={(e) => patch({ colorCountMax: bound(e.target.value) })}
          style={{ width: 62 }}
        />
      </div>

      {/* Beside the colour count, so the two numeric ranges read as a pair
          rather than being separated by the chip rows. */}
      <div className="filter-group">
        <span className="filter-label">MV</span>
        <input
          type="number"
          min={0}
          placeholder="min"
          value={filter.mvMin ?? ""}
          onChange={(e) => patch({ mvMin: bound(e.target.value) })}
          style={{ width: 62 }}
        />
        <span className="filter-label">–</span>
        <input
          type="number"
          min={0}
          placeholder="max"
          value={filter.mvMax ?? ""}
          onChange={(e) => patch({ mvMax: bound(e.target.value) })}
          style={{ width: 62 }}
        />
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
