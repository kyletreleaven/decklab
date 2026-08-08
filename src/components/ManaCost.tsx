import { manaSymbolUrl } from "../lib/manaSymbols";

const SYMBOL = /\{([^}]+)\}/g;

/**
 * Render a Scryfall mana cost string ("{2}{W}{U}") using the official card
 * symbols.
 *
 * The SVGs are bundled under `public/mana/` rather than fetched, so costs
 * render instantly and work offline. Anything Scryfall does not publish a
 * symbol for falls back to a coloured letter pip.
 */
export function ManaCost({
  cost,
  size = 15,
}: {
  cost: string | null | undefined;
  size?: number;
}) {
  if (!cost) return null;

  const symbols = [...cost.matchAll(SYMBOL)].map((m) => m[1]);
  if (!symbols.length) return null;

  return (
    <span className="mana">
      {symbols.map((symbol, i) => {
        const url = manaSymbolUrl(symbol);

        if (url) {
          return (
            <img
              key={i}
              className="pip-svg"
              src={url}
              alt={`{${symbol}}`}
              title={`{${symbol}}`}
              style={size === 15 ? undefined : { width: size, height: size }}
              draggable={false}
            />
          );
        }

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
