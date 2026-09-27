import { describe, expect, it } from "vitest";
import { fetchSignature, type FetchInputs } from "./poolFetch";

const local: FetchInputs = {
  drawn: "collection",
  localSourceId: "c1",
  effectiveKey: "{}",
  sort: "name",
  sortFlipped: false,
  refreshKey: 0,
};

const universe: FetchInputs = { ...local, drawn: "universe", localSourceId: undefined };

describe("fetchSignature — a write", () => {
  // bugs/001: adding a card, or removing its last copy, left the grid as it was.
  it("refetches a local grid, whose rows are the collection's contents", () => {
    expect(fetchSignature({ ...local, refreshKey: 1 })).not.toBe(fetchSignature(local));
  });

  it("does not re-search All Magic, which contains every collection already", () => {
    expect(fetchSignature({ ...universe, refreshKey: 1 })).toBe(fetchSignature(universe));
  });
});

describe("fetchSignature — the question itself", () => {
  it.each([
    ["source", { localSourceId: "c2" }],
    ["filter", { effectiveKey: '{"query":"t:elf"}' }],
    ["sort", { sort: "cmc" }],
    ["direction", { sortFlipped: true }],
  ])("changes with the %s", (_, change) => {
    expect(fetchSignature({ ...local, ...change })).not.toBe(fetchSignature(local));
  });

  it("tells the two branches apart", () => {
    expect(fetchSignature(universe)).not.toBe(fetchSignature(local));
  });
});
