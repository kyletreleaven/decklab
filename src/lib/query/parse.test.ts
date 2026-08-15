import { describe, expect, it } from "vitest";
import { eachTerm, parse, ParseError, type Node } from "./parse";

/**
 * A compact structural rendering, so tests assert shape rather than drowning in
 * object literals. `a AND b`, `NOT(x)`, terms as `field:value`.
 */
function shape(node: Node | null): string {
  if (!node) return "∅";
  switch (node.kind) {
    case "term":
      return `${node.field ?? "_"}${node.op}${node.value}`;
    case "not":
      return `NOT(${shape(node.node)})`;
    case "and":
      return `(${node.nodes.map(shape).join(" AND ")})`;
    case "or":
      return `(${node.nodes.map(shape).join(" OR ")})`;
  }
}

describe("parse — basics", () => {
  it("returns null for an empty query", () => {
    // Null means "match everything", which callers must not confuse with a
    // query that matched nothing.
    expect(parse("")).toBeNull();
    expect(parse("   ")).toBeNull();
  });

  it("parses a single term", () => {
    expect(shape(parse("t:creature"))).toBe("t:creature");
  });

  it("parses a bare word as a fieldless term", () => {
    expect(shape(parse("bolt"))).toBe("_:bolt");
  });
});

describe("parse — juxtaposition is AND", () => {
  it("joins adjacent terms", () => {
    expect(shape(parse("c:r t:creature"))).toBe("(c:r AND t:creature)");
  });

  it("flattens a run of terms into one node", () => {
    expect(shape(parse("a b c"))).toBe("(_:a AND _:b AND _:c)");
  });

  it("treats an explicit `and` identically", () => {
    expect(shape(parse("c:r and t:creature"))).toBe(shape(parse("c:r t:creature")));
  });

  it("mixes explicit and implicit and", () => {
    expect(shape(parse("a and b c"))).toBe("(_:a AND _:b AND _:c)");
  });
});

describe("parse — precedence", () => {
  it("binds `or` looser than `and`", () => {
    // The whole point: `a or b c` must be a or (b and c), not (a or b) and c.
    expect(shape(parse("a or b c"))).toBe("(_:a OR (_:b AND _:c))");
  });

  it("binds `or` looser than an explicit `and`", () => {
    expect(shape(parse("a or b and c"))).toBe("(_:a OR (_:b AND _:c))");
  });

  it("flattens a chain of ors", () => {
    expect(shape(parse("a or b or c"))).toBe("(_:a OR _:b OR _:c)");
  });

  it("lets parentheses override precedence", () => {
    expect(shape(parse("(a or b) c"))).toBe("((_:a OR _:b) AND _:c)");
  });
});

describe("parse — grouping", () => {
  it("unwraps a redundant group", () => {
    expect(shape(parse("(t:creature)"))).toBe("t:creature");
  });

  it("parses nested groups", () => {
    expect(shape(parse("t:creature (c:r or (c:w and mv<=2))"))).toBe(
      "(t:creature AND (c:r OR (c:w AND mv<=2)))",
    );
  });

  it("rejects an unclosed group", () => {
    expect(() => parse("(c:r")).toThrow(/missing '\)'/);
  });

  it("rejects a stray closing paren", () => {
    expect(() => parse("c:r)")).toThrow(ParseError);
  });

  it("rejects an empty group", () => {
    expect(() => parse("()")).toThrow(/empty group/);
  });
});

describe("parse — negation", () => {
  it("negates a term", () => {
    expect(shape(parse("-t:creature"))).toBe("NOT(t:creature)");
  });

  it("negates a group", () => {
    expect(shape(parse("-(c:r or c:w)"))).toBe("NOT((c:r OR c:w))");
  });

  it("binds tighter than and", () => {
    expect(shape(parse("-a b"))).toBe("(NOT(_:a) AND _:b)");
  });

  it("allows double negation", () => {
    expect(shape(parse("--a"))).toBe("NOT(NOT(_:a))");
  });

  it("rejects a dangling negation", () => {
    expect(() => parse("-")).toThrow(/needs something to negate/);
    expect(() => parse("a -")).toThrow(/needs something to negate/);
  });
});

describe("parse — malformed input", () => {
  it("rejects a leading `and` or `or`", () => {
    expect(() => parse("and a")).toThrow(/needs something before it/);
    expect(() => parse("or a")).toThrow(ParseError);
  });

  it("rejects a trailing `and`", () => {
    expect(() => parse("a and")).toThrow(/needs something after it/);
  });

  it("rejects a trailing `or`", () => {
    expect(() => parse("a or")).toThrow(ParseError);
  });

  it("rejects a field with no value", () => {
    expect(() => parse("t:")).toThrow(/'t:' needs a value/);
    expect(() => parse("mv>=")).toThrow(/needs a value/);
  });

  it("allows an empty *quoted* value, which is explicit", () => {
    // `t:""` is a deliberate empty string, unlike a dangling `t:`.
    expect(shape(parse('t:""'))).toBe("t:");
  });

  it("reports a position with the error", () => {
    try {
      parse("c:r and");
      expect.unreachable();
    } catch (err) {
      expect((err as ParseError).at).toBe(4);
    }
  });
});

describe("eachTerm", () => {
  it("visits every term regardless of nesting or negation", () => {
    const node = parse("a -(b or (c and d))")!;
    const seen: string[] = [];
    eachTerm(node, (t) => seen.push(t.value));
    expect(seen).toEqual(["a", "b", "c", "d"]);
  });
});
