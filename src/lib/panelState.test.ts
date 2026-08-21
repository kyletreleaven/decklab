import { beforeEach, describe, expect, it } from "vitest";
import { forgetPanel, retain, retained } from "./panelState";

describe("panel state", () => {
  beforeEach(() => {
    forgetPanel("a");
    forgetPanel("b");
  });

  it("returns an empty slot for a panel never seen", () => {
    // Callers destructure with defaults, so this must not be undefined.
    expect(retained("a")).toEqual({});
  });

  it("merges rather than replacing", () => {
    // Preferences are written field by field, so a later write of `sort` must
    // not drop an earlier `layout`.
    retain("a", { sort: "name" });
    retain("a", { layout: "list" });
    expect(retained("a")).toEqual({ sort: "name", layout: "list" });
  });

  it("keys panels separately", () => {
    // Two collections must not inherit each other's place.
    retain("a", { sort: "name" });
    retain("b", { sort: "value" });
    expect(retained("a")).toEqual({ sort: "name" });
    expect(retained("b")).toEqual({ sort: "value" });
  });

  it("forgets a panel outright", () => {
    // Called when the underlying deck or collection is deleted; a later panel
    // reusing the id must not resurrect it.
    retain("a", { sort: "value" });
    forgetPanel("a");
    expect(retained("a")).toEqual({});
  });

  it("hands back a snapshot that later writes do not mutate", () => {
    // The results blob is read once at mount and held in a ref; if `retained`
    // aliased the store, a later write would change it underneath the panel.
    const before = retained("a");
    retain("a", { sort: "name" });
    expect(before).toEqual({});
  });
});
