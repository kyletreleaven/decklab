import { describe, expect, it } from "vitest";
import { minimumPrice, type PricedPrinting } from "./price";

const P: PricedPrinting[] = [
  { id: "sol-c21", oracleId: "sol", finishes: ["nonfoil", "foil"], prices: { usd: "1.50", usd_foil: "4.00" } },
  { id: "sol-cmr", oracleId: "sol", finishes: ["nonfoil", "foil", "etched"], prices: { usd: "0.90", usd_foil: null, usd_etched: "3.00" } },
  { id: "bolt-m10", oracleId: "bolt", finishes: ["nonfoil"], prices: { usd: null } },
];

describe("minimumPrice", () => {
  it("prices each line at the cheapest printing and finish that fills it, times its copies", () => {
    expect(minimumPrice([{ oracleId: "sol", qty: 2 }], P)).toEqual({ total: 1.8, unpriced: 0 });
    // Bound: that printing only.
    expect(minimumPrice([{ oracleId: "sol", printingId: "sol-c21", qty: 1 }], P)).toEqual({ total: 1.5, unpriced: 0 });
    // A finish: that finish only, where the printing was made in it.
    expect(minimumPrice([{ oracleId: "sol", finish: "foil", qty: 1 }], P)).toEqual({ total: 4, unpriced: 0 });
    expect(minimumPrice([{ oracleId: "sol", finish: "etched", qty: 1 }], P)).toEqual({ total: 3, unpriced: 0 });
  });

  it("leaves out, and counts, a line no printing prices", () => {
    expect(minimumPrice([{ oracleId: "bolt", qty: 4 }, { oracleId: "nope", qty: 1 }, { oracleId: "sol", qty: 1 }], P)).toEqual({
      total: 0.9,
      unpriced: 2,
    });
  });
});
