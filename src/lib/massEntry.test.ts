import { describe, expect, it } from "vitest";
import { massEntry, type AskedPattern } from "./massEntry";

const bolt = (qty: number, extra: Partial<AskedPattern> = {}): AskedPattern => ({
  oracleId: "bolt",
  name: "Lightning Bolt",
  attrs: {},
  qty,
  ...extra,
});
const M10 = { printingId: "m10", printing: { set: "m10", number: "146" } };
const C21 = { printingId: "c21", printing: { set: "c21", number: "153" } };

describe("massEntry", () => {
  it("buys a narrower line inside a wider one once, not on top of it", () => {
    const lines = [bolt(4), bolt(1, M10)];
    expect(massEntry(lines, { printings: false })).toBe("4 Lightning Bolt");
    expect(massEntry(lines, { printings: true })).toBe("3 Lightning Bolt\n1 Lightning Bolt [M10] 146");
  });

  it("adds lines that are disjoint", () => {
    const lines = [bolt(2, M10), bolt(3, C21)];
    expect(massEntry(lines, { printings: false })).toBe("5 Lightning Bolt");
  });

  it("lets narrower lines outgrow a wider one", () => {
    // ≥4 any, ≥2 M10, ≥3 C21: five copies satisfy all three, nine never needed.
    const lines = [bolt(4), bolt(2, M10), bolt(3, C21)];
    expect(massEntry(lines, { printings: false })).toBe("5 Lightning Bolt");
    expect(massEntry(lines, { printings: true })).toBe("3 Lightning Bolt [C21] 153\n2 Lightning Bolt [M10] 146");
  });

  it("folds finish into its printing", () => {
    const lines = [bolt(2, M10), bolt(1, { ...M10, finish: "foil" })];
    expect(massEntry(lines, { printings: true })).toBe("2 Lightning Bolt [M10] 146");
  });

  it("sorts by name", () => {
    const ring: AskedPattern = { oracleId: "ring", name: "Sol Ring", attrs: {}, qty: 1 };
    expect(massEntry([ring, bolt(1)], { printings: false })).toBe("1 Lightning Bolt\n1 Sol Ring");
  });
});
