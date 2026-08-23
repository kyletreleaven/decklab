import { describe, expect, it } from "vitest";
import { stepperCase, STEPPER_CONTROLS, type StepperCase } from "./stepper";
import type { QuantityKind } from "./types";

/** The controls a case offers, as they read on screen. */
const buttons = (which: StepperCase) => {
  const c = STEPPER_CONTROLS[which];
  return [c.dec && "−", c.inc && "+", c.drop && "×"].filter(Boolean).join(" ");
};

/**
 * A **collection view**: the destination *is* the foreground, so "lit" and "in
 * the destination" are the same fact. Everything here rests on that, which is
 * why the other situation is a separate block rather than one helper quietly
 * assuming it.
 */
describe("stepper — destination is the foreground", () => {
  /** Background drawn, so cards absent from the destination appear too. */
  const withBackground = (fg: QuantityKind, lit: boolean) =>
    stepperCase({
      destinationKind: fg,
      inDestination: lit ? 1 : 0,
    });

  /** Foreground alone, so every card shown is one it holds. */
  const alone = (fg: QuantityKind) =>
    stepperCase({
      destinationKind: fg,
      inDestination: 1,
    });

  it("counted, alone: step the copies", () => {
    // No `×`: holding it down a few times is `−`, and a second removal control
    // is not worth the width.
    expect(buttons(alone("natural"))).toBe("− +");
  });

  it("binary, alone: removal is the only edit", () => {
    // There is no count between "in" and "out" to step through.
    expect(buttons(alone("binary"))).toBe("×");
  });

  it("counted, with background: lit steps, dimmed only adds", () => {
    expect(buttons(withBackground("natural", true))).toBe("− +");
    // Dimmed is absent by definition here, so `−` could only ever be disabled.
    expect(buttons(withBackground("natural", false))).toBe("+");
  });

  it("binary, with background: lit removes, dimmed adds", () => {
    expect(buttons(withBackground("binary", true))).toBe("×");
    expect(buttons(withBackground("binary", false))).toBe("+");
  });

  it("gives both kinds the same control when absent", () => {
    // Nothing held is nothing to remove, so the kind stops mattering.
    expect(withBackground("natural", false)).toBe(withBackground("binary", false));
  });

  it("shows a removal control in both layouts, or not at all", () => {
    // Only binary offers one, and it is the sole edit there — so it appears on
    // the wall as well as in the list.
    expect(STEPPER_CONTROLS[alone("natural")]).toMatchObject({ drop: false });
    expect(STEPPER_CONTROLS[alone("binary")]).toMatchObject({
      drop: true,
      dropOnWall: true,
    });
  });
});

/**
 * A **deck pool**, or the All Magic view: the destination is something else
 * entirely, so litness stops being the membership test — a dimmed card you do
 * not own may already be in the deck you are filling.
 */
describe("stepper — destination differs from the foreground", () => {
  it("keys on the destination's contents, not on litness", () => {
    // Dimmed, so absent from the foreground collection, yet already in the deck
    // — it must still offer `−`. Reading litness here was the bug that made the
    // All Magic view show `+` on cards already in a binary target.
    expect(
      buttons(
        stepperCase({
          destinationKind: "natural",
          inDestination: 2,
        }),
      ),
    ).toBe("− +");
  });

  it("offers nothing when there is nowhere to write", () => {
    expect(
      stepperCase({
        destinationKind: null,
        inDestination: 0,
      }),
    ).toBe("none");
  });
});
