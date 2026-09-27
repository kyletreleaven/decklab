import { describe, expect, it } from "vitest";
import { isDimmed } from "./dimming";

const active = new Set(["in"]);

describe("isDimmed", () => {
  it.each([
    // card,  active collection, show not in, dimmed
    ["out", active, true, true],
    ["in", active, true, false],
    // ("out", active, false) cannot occur: unchecked draws only the collection.
    ["in", active, false, false],
    // No active collection: every card is "out", and there is no toggle.
    ["out", null, false, false],
  ] as const)("%s, active %o, show-not-in %s → %s", (card, coll, showNotIn, expected) => {
    expect(isDimmed(card, coll, showNotIn)).toBe(expected);
  });
});
