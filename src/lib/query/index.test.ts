import { describe, expect, it } from "vitest";
import { compileQuery } from "./index";

describe("compileQuery", () => {
  it("compiles a valid query", () => {
    const result = compileQuery("t:creature");
    expect(result.sql).toContain("c.type_line LIKE");
    expect(result.params).toEqual(["%creature%"]);
    expect(result.error).toBeUndefined();
  });

  it("returns null sql for an empty query, without an error", () => {
    // Empty means *match everything*: the caller omits its WHERE clause. It
    // must not be confused with a query that failed and matches nothing.
    for (const input of ["", "   "]) {
      const result = compileQuery(input);
      expect(result.sql).toBeNull();
      expect(result.error).toBeUndefined();
    }
  });

  it("reports a lex error instead of throwing", () => {
    const result = compileQuery('o:"unterminated');
    expect(result.sql).toBeNull();
    expect(result.error?.message).toMatch(/unclosed/);
  });

  it("reports a parse error instead of throwing", () => {
    const result = compileQuery("(c:r");
    expect(result.sql).toBeNull();
    expect(result.error?.message).toMatch(/missing '\)'/);
  });

  it("reports an unsupported field instead of throwing", () => {
    const result = compileQuery("is:commander");
    expect(result.sql).toBeNull();
    expect(result.error?.message).toMatch(/not supported/);
  });

  it("survives every prefix of a realistic query", () => {
    // Search runs on each keystroke, so half-typed input is the normal case,
    // not an edge case. None of it may throw.
    const full = 't:creature (c:r or c:w) mv<=3 o:"draw a card"';
    for (let i = 0; i <= full.length; i++) {
      expect(() => compileQuery(full.slice(0, i)), full.slice(0, i)).not.toThrow();
    }
  });

  it("passes through compile options", () => {
    const result = compileQuery("t:creature", { alias: "x", paramOffset: 2 });
    expect(result.sql).toContain("x.type_line");
    expect(result.sql).toContain("$3");
  });
});
