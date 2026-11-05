import type { Sql } from "./sql";

/** One line a checklist asks for: the card, the printing if it binds one, the finish if it sets one. */
export interface AskedLine {
  oracleId: string;
  printingId?: string;
  finish?: string;
  qty: number;
}

/** A printing as pricing reads it: Scryfall's prices, and the finishes it was made in. */
export interface PricedPrinting {
  id: string;
  oracleId: string;
  finishes: string[];
  prices: Record<string, string | null | undefined>;
}

/** Which of Scryfall's prices is a finish's, in dollars. */
const USD: Record<string, string> = { nonfoil: "usd", foil: "usd_foil", etched: "usd_etched" };

export interface MinimumPrice {
  /** In dollars: each line at its cheapest printing that fills it, times the copies. */
  total: number;
  /** Lines no printing gives a price for: left out of the total. */
  unpriced: number;
}

/**
 * The least a checklist costs to buy, by Scryfall's prices: each line at the
 * cheapest printing and finish that fills it — the one it binds, else any —
 * times the copies asked for. A suggestion asks nothing, so it is any
 * printing (docs/inventory/buckets.md → *Suggested printings*).
 */
export function minimumPrice(lines: AskedLine[], printings: PricedPrinting[]): MinimumPrice {
  const byOracle = new Map<string, PricedPrinting[]>();
  for (const p of printings) byOracle.set(p.oracleId, [...(byOracle.get(p.oracleId) ?? []), p]);
  let total = 0;
  let unpriced = 0;
  for (const l of lines) {
    const run = (byOracle.get(l.oracleId) ?? []).filter((p) => !l.printingId || p.id === l.printingId);
    let least = Infinity;
    for (const p of run) {
      for (const finish of l.finish ? [l.finish] : p.finishes) {
        if (!p.finishes.includes(finish)) continue;
        const usd = Number.parseFloat(p.prices[USD[finish] ?? ""] ?? "");
        if (Number.isFinite(usd) && usd < least) least = usd;
      }
    }
    if (least === Infinity) unpriced++;
    else total += least * l.qty;
  }
  return { total: Math.round(total * 100) / 100, unpriced };
}

/** Every printing the store holds of these cards, as pricing reads them. */
export async function storedPricing(store: Sql, oracleIds: string[]): Promise<PricedPrinting[]> {
  const out: PricedPrinting[] = [];
  for (let i = 0; i < oracleIds.length; i += 400) {
    const chunk = oracleIds.slice(i, i + 400);
    const rows = await store.select<{ id: string; oracle_id: string; finishes: string | null; prices: string | null }>(
      `SELECT id, oracle_id, json_extract(data, '$.finishes') AS finishes, json_extract(data, '$.prices') AS prices
         FROM cards WHERE oracle_id IN (${chunk.map((_, j) => `$${j + 1}`).join(", ")})`,
      chunk,
    );
    for (const r of rows) {
      out.push({
        id: r.id,
        oracleId: r.oracle_id,
        finishes: r.finishes ? (JSON.parse(r.finishes) as string[]) : ["nonfoil"],
        prices: r.prices ? (JSON.parse(r.prices) as PricedPrinting["prices"]) : {},
      });
    }
  }
  return out;
}
