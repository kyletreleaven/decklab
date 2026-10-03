import type { Card } from "./types";

/** Printing traits that distinguish same-set variants, read from raw Scryfall JSON. */
export function variantTraits(card: Card): string[] {
  const data = card.data as {
    border_color?: string;
    frame_effects?: string[];
    promo?: boolean;
    finishes?: string[];
  };

  const traits: string[] = [];
  if (data.border_color === "borderless") traits.push("borderless");

  const effects = data.frame_effects ?? [];
  if (effects.includes("showcase")) traits.push("showcase");
  if (effects.includes("extendedart")) traits.push("extended");
  if (effects.includes("etched")) traits.push("etched");
  if (data.promo) traits.push("promo");

  // A single-finish printing is a real distinction (foil-only, etched-only);
  // the usual nonfoil+foil pair is not worth mentioning.
  const finishes = data.finishes ?? [];
  if (finishes.length === 1 && finishes[0] !== "nonfoil") traits.push(finishes[0]);

  return traits;
}

/**
 * A label that actually distinguishes printings.
 *
 * Set name alone is not enough: Sol Ring has 30 Secret Lair printings, so
 * without the collector number they all render identically and the list looks
 * like it is repeating itself.
 */
export function printingLabel(card: Card): string {
  const base = `${card.setName} (${card.setCode.toUpperCase()}) #${card.collectorNumber}`;
  const traits = variantTraits(card);
  return traits.length ? `${base} · ${traits.join(", ")}` : base;
}


/**
 * Scryfall pages for a card, for opening in the browser — one per grain.
 *
 * The printing and set pages are read from the raw payload, which every cached
 * card carries, so no migration and no refetch. Their `utm_source=api` is
 * Scryfall's own attribution for API clients and is kept on purpose. The
 * fallbacks build the same pages, for a payload that somehow lacks the field.
 */
export function scryfallPages(card: Card): { card: string; set: string; printing: string } {
  const data = card.data as { scryfall_uri?: string; scryfall_set_uri?: string };
  const set = encodeURIComponent(card.setCode);
  return {
    // Scryfall has no page per card, only per printing. A search for the oracle
    // id is the nearest, and `unique=prints` matters: a search with exactly one
    // result redirects to that card's default printing.
    card: `https://scryfall.com/search?q=${encodeURIComponent(`oracleid:${card.oracleId}`)}&unique=prints`,
    set: data.scryfall_set_uri ?? `https://scryfall.com/sets/${set}`,
    printing:
      data.scryfall_uri ??
      `https://scryfall.com/card/${set}/${encodeURIComponent(card.collectorNumber)}`,
  };
}
