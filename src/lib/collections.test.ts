import { describe, expect, it } from "vitest";
import { COLLECTION_KINDS, OWNABLE_KINDS } from "./collections";

/**
 * The SQL in this module needs a database and is not covered here. What *is*
 * worth locking down is the policy decision about which collections count as
 * cards you actually have — it is easy to "simplify" back to counting
 * everything, which silently makes every ownership number wrong.
 */
describe("OWNABLE_KINDS", () => {
  it("excludes wishlist, which is by definition what you do not own", () => {
    expect(OWNABLE_KINDS).not.toContain("wishlist");
  });

  it("excludes loaned out, which you own but cannot play", () => {
    expect(OWNABLE_KINDS).not.toContain("loaned");
  });

  it("includes paper and cube", () => {
    expect(OWNABLE_KINDS).toContain("paper");
    expect(OWNABLE_KINDS).toContain("cube");
  });

  it("only names kinds that actually exist", () => {
    const known = COLLECTION_KINDS.map((k) => k.value);
    for (const kind of OWNABLE_KINDS) {
      expect(known).toContain(kind);
    }
  });

  it("accounts for every kind as either ownable or deliberately excluded", () => {
    // Forces a decision when a new collection kind is added, rather than
    // letting it default to "not owned" unnoticed.
    const excluded = ["wishlist", "loaned"];
    const accounted = new Set([...OWNABLE_KINDS, ...excluded]);
    for (const { value } of COLLECTION_KINDS) {
      expect(accounted.has(value)).toBe(true);
    }
  });
});
