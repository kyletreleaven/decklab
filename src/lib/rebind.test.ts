import { describe, expect, it } from "vitest";
import { planRebind, type CollectionSupply, type DeckDemand } from "./rebind";

const demand = (
  entryId: string,
  cardId: string,
  quantity: number,
  oracleId = "bolt",
): DeckDemand => ({ entryId, cardId, oracleId, quantity });

const supply = (
  cardId: string,
  quantity: number,
  oracleId = "bolt",
): CollectionSupply => ({ cardId, oracleId, quantity });

describe("planRebind", () => {
  it("leaves entries alone when you hold the printing they name", () => {
    // A deck already naming cards you own must not be shuffled around.
    expect(planRebind([demand("e1", "alpha", 2)], [supply("alpha", 2)])).toEqual([]);
  });

  it("swaps to another printing of the same card", () => {
    expect(planRebind([demand("e1", "alpha", 1)], [supply("beta", 1)])).toEqual([
      { entryId: "e1", fromCardId: "alpha", toCardId: "beta", quantity: 1 },
    ]);
  });

  it("binds what it can and leaves the rest — best effort", () => {
    // Four wanted, two available: bind two rather than refusing the lot.
    const plan = planRebind([demand("e1", "alpha", 4)], [supply("beta", 2)]);
    expect(plan).toEqual([
      { entryId: "e1", fromCardId: "alpha", toCardId: "beta", quantity: 2 },
    ]);
  });

  it("splits a shortfall across several printings", () => {
    const plan = planRebind(
      [demand("e1", "alpha", 3)],
      [supply("beta", 1), supply("gamma", 2)],
    );
    expect(plan.map((r) => [r.toCardId, r.quantity])).toEqual([
      ["beta", 1],
      ["gamma", 2],
    ]);
  });

  it("does not hand the same copy to two entries", () => {
    // Two entries competing for one spare copy: one wins, the other stays put.
    const plan = planRebind(
      [demand("e1", "alpha", 1), demand("e2", "gamma", 1)],
      [supply("beta", 1)],
    );
    expect(plan).toHaveLength(1);
  });

  it("claims exact matches before anyone reaches for a substitute", () => {
    // e2 can only be satisfied exactly; if e1 took `beta` first, e2 would be
    // left short while a copy it could not use sat unclaimed.
    const plan = planRebind(
      [demand("e1", "alpha", 1), demand("e2", "beta", 1)],
      [supply("beta", 1)],
    );
    expect(plan).toEqual([]);
  });

  it("keeps oracles apart", () => {
    // A spare Shock cannot stand in for a Bolt.
    expect(
      planRebind([demand("e1", "alpha", 1, "bolt")], [supply("shock-a", 3, "shock")]),
    ).toEqual([]);
  });

  it("is idempotent — a second run has nothing to do", () => {
    const supplies = [supply("beta", 2)];
    const plan = planRebind([demand("e1", "alpha", 2)], supplies);
    expect(plan).toHaveLength(1);
    // After applying, the entry names `beta`, which it now holds exactly.
    expect(planRebind([demand("e1", "beta", 2)], supplies)).toEqual([]);
  });

  it("ignores empty and negative supply rows", () => {
    expect(planRebind([demand("e1", "alpha", 1)], [supply("beta", 0)])).toEqual([]);
  });
});
