const SYMBOL = /\{([^}]+)\}/g;

/**
 * Render a Scryfall mana cost string ("{2}{W}{U}") as coloured pips.
 * Hybrid symbols take the colour of their first half, which is enough to read
 * a curve at a glance without pulling in an icon font.
 */
export function ManaCost({ cost }: { cost: string | null | undefined }) {
  if (!cost) return null;

  const symbols = [...cost.matchAll(SYMBOL)].map((m) => m[1]);
  if (!symbols.length) return null;

  return (
    <span className="mana">
      {symbols.map((symbol, i) => {
        const color = ["W", "U", "B", "R", "G"].find((c) => symbol.includes(c));
        const label = symbol.replace(/\//g, "");
        return (
          <span key={i} className={`pip ${color ?? ""}`} title={`{${symbol}}`}>
            {label.length > 2 ? label[0] : label}
          </span>
        );
      })}
    </span>
  );
}
