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
export function CardFilters({
  filter,
  onChange,
  showOwnership = false,
}: {
  filter: CardFilter;
  onChange: (next: CardFilter) => void;
  /** Ownership toggles only make sense where a reference collection exists. */
  showOwnership?: boolean;
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

      {showOwnership && (
        <div className="filter-group">
          <span className="filter-label">Show</span>
          <label className="check">
            <input
              type="checkbox"
              checked={filter.showOwned !== false}
              onChange={(e) => patch({ showOwned: e.target.checked })}
            />
            Collected
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={filter.showUnowned !== false}
              onChange={(e) => patch({ showUnowned: e.target.checked })}
            />
            Not collected
          </label>
        </div>
      )}

      {active > 0 && (
        <button
          className="ghost"
          onClick={() =>
            onChange({
              // Ownership toggles are a display mode, not a filter, so a
              // "clear filters" should leave them alone.
              showOwned: filter.showOwned,
              showUnowned: filter.showUnowned,
            })
          }
        >
          Clear all
        </button>
      )}
    </div>
  );
}
