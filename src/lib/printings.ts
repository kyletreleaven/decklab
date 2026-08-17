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

