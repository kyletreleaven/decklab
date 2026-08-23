import type { QuantityKind } from "./types";

/**
 * Which edit controls a pool row offers.
 *
 * Two inputs, and only two: the destination's quantity kind, and whether the
 * card is already in it.
 *
 * | | in the destination | not in it |
 * | --- | --- | --- |
 * | natural | `− +` | `+` |
 * | binary  | `×`   | `+` |
 *
 * Drawing a background does not change the rule — it changes which cards
 * appear, so the right-hand column has anything in it.
 */
export type StepperCase =
  /** Held, and counted: step the copies. */
  | "counted-member"
  /** Already a member of a binary set: removal is the only edit. */
  | "binary-member"
  /** Not there yet, whatever the kind. Nothing to remove, so only `+`. */
  | "absent"
  /** Nowhere to write. */
  | "none";

export interface StepperInput {
  /** The kind of the container being written to, when there is one. */
  destinationKind: QuantityKind | null;
  /**
   * Copies of *this row* already in the destination.
   *
   * Membership must come from the destination, not from the foreground: with
   * All Magic in front and a binary collection as the target, a foreground
   * membership test is empty and every card wrongly reads as absent.
   */
  inDestination: number;
}

export function stepperCase({
  destinationKind,
  inDestination,
}: StepperInput): StepperCase {
  if (destinationKind === null) return "none";

  // Nothing in the destination means nothing to remove or step down, whatever
  // the kind: `+` alone, rather than a `−` that could only ever be disabled.
  //
  // Note this is the *destination's* count, not litness. In a collection view
  // the two coincide, since the destination is the foreground — a dimmed row is
  // by definition absent. In a deck pool they part company: the foreground is
  // your collection and the destination is the deck, so a dimmed card you do
  // not own may already be in the deck.
  if (inDestination === 0) return "absent";

  return destinationKind === "binary" ? "binary-member" : "counted-member";
}

/** Which buttons a case offers, and whether the wall shows the drop. */
export const STEPPER_CONTROLS: Record<
  StepperCase,
  { dec: boolean; inc: boolean; drop: boolean; dropOnWall: boolean }
> = {
  "counted-member": { dec: true, inc: true, drop: false, dropOnWall: false },
  // `×` rather than `−` because the label is right, not because the action
  // differs: a binary set holds one of everything, so removing one *is*
  // removing it.
  "binary-member": { dec: false, inc: false, drop: true, dropOnWall: true },
  absent: { dec: false, inc: true, drop: false, dropOnWall: false },
  none: { dec: false, inc: false, drop: false, dropOnWall: false },
};
