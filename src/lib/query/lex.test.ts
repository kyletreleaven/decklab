import { describe, expect, it } from "vitest";
import { lex, LexError, type Token } from "./lex";

/** Terms only, without positions — most tests do not care where they were. */
function terms(input: string) {
  return lex(input)
    .filter((t): t is Extract<Token, { kind: "term" }> => t.kind === "term")
    .map(({ field, op, value, quoted }) => ({ field, op, value, quoted }));
}

/** The token stream as kind names, for structural assertions. */
function kinds(input: string): string[] {
  return lex(input).map((t) => t.kind);
}

describe("lex — basics", () => {
  it("returns nothing for empty or whitespace-only input", () => {
    expect(lex("")).toEqual([]);
    expect(lex("   \t\n ")).toEqual([]);
  });

  it("reads a bare word as a fieldless term", () => {
    expect(terms("lightning")).toEqual([
      { field: null, op: ":", value: "lightning", quoted: false },
    ]);
  });

  it("splits field, operator and value", () => {
    expect(terms("t:creature")).toEqual([
      { field: "t", op: ":", value: "creature", quoted: false },
    ]);
  });

  it("lowercases the field but preserves the value's case", () => {
    // Field names are ours; values may be card text, where case can matter.
    expect(terms("T:Creature")).toEqual([
      { field: "t", op: ":", value: "Creature", quoted: false },
    ]);
  });

  it("splits several terms on whitespace", () => {
    expect(terms("c:r t:creature")).toHaveLength(2);
  });
});

describe("lex — operators", () => {
  it("recognises every comparison operator", () => {
    expect(terms("mv:3")[0].op).toBe(":");
    expect(terms("mv=3")[0].op).toBe("=");
    expect(terms("mv!=3")[0].op).toBe("!=");
    expect(terms("mv<3")[0].op).toBe("<");
    expect(terms("mv>3")[0].op).toBe(">");
  });

  it("prefers the two-character operators", () => {
    // Scanning shortest-first would read `mv<=3` as `<` with a value of `=3`.
    expect(terms("mv<=3")).toEqual([
      { field: "mv", op: "<=", value: "3", quoted: false },
    ]);
    expect(terms("mv>=3")).toEqual([
      { field: "mv", op: ">=", value: "3", quoted: false },
    ]);
  });

  it("splits at the earliest operator", () => {
    expect(terms("a:b:c")).toEqual([
      { field: "a", op: ":", value: "b:c", quoted: false },
    ]);
  });

  it("treats a leading operator as a bare word, not an empty field", () => {
    expect(terms(":foo")).toEqual([
      { field: null, op: ":", value: ":foo", quoted: false },
    ]);
  });
});

describe("lex — quotes", () => {
  it("keeps spaces inside a quoted value", () => {
    expect(terms('o:"draw a card"')).toEqual([
      { field: "o", op: ":", value: "draw a card", quoted: true },
    ]);
  });

  it("does not split on operators inside quotes", () => {
    // The colon in the phrase must not become the field separator.
    expect(terms('o:"target: creature"')).toEqual([
      { field: "o", op: ":", value: "target: creature", quoted: true },
    ]);
  });

  it("does not treat comparison characters inside quotes as operators", () => {
    expect(terms('o:"deals 3 damage <= target"')[0].value).toBe(
      "deals 3 damage <= target",
    );
  });

  it("does not end a term at a parenthesis inside quotes", () => {
    const result = lex('o:"(as this enters)"');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ value: "(as this enters)" });
  });

  it("accepts a fully quoted bare word", () => {
    expect(terms('"lightning bolt"')).toEqual([
      { field: null, op: ":", value: "lightning bolt", quoted: true },
    ]);
  });

  it("accepts single quotes", () => {
    expect(terms("o:'draw a card'")).toEqual([
      { field: "o", op: ":", value: "draw a card", quoted: true },
    ]);
  });

  it("unescapes an escaped quote inside a value", () => {
    expect(terms('o:"say \\"boo\\""')[0].value).toBe('say "boo"');
  });

  it("does not end the term on an escaped closing quote", () => {
    expect(lex('o:"a\\"b"')).toHaveLength(1);
  });

  it("reports an unclosed quote with its position", () => {
    expect(() => lex('o:"draw a card')).toThrow(LexError);
    try {
      lex('t:creature o:"unterminated');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LexError);
      expect((err as LexError).at).toBe(11);
    }
  });
});

describe("lex — negation", () => {
  it("emits a not token for a leading dash", () => {
    expect(kinds("-t:creature")).toEqual(["not", "term"]);
  });

  it("negates after whitespace", () => {
    expect(kinds("c:r -t:creature")).toEqual(["term", "not", "term"]);
  });

  it("negates a group", () => {
    expect(kinds("-(c:r or c:w)")).toEqual([
      "not",
      "lparen",
      "term",
      "or",
      "term",
      "rparen",
    ]);
  });

  it("does NOT negate mid-word", () => {
    // A hyphenated card name must survive intact.
    expect(terms("Jund-ish")).toEqual([
      { field: null, op: ":", value: "Jund-ish", quoted: false },
    ]);
    expect(kinds("Jund-ish")).toEqual(["term"]);
  });

  it("does NOT treat a negative number as negation", () => {
    expect(kinds("mv>-1")).toEqual(["term"]);
    expect(terms("mv>-1")).toEqual([
      { field: "mv", op: ">", value: "-1", quoted: false },
    ]);
  });

  it("handles a hyphenated value after a field", () => {
    expect(terms("set:pre-release")).toEqual([
      { field: "set", op: ":", value: "pre-release", quoted: false },
    ]);
  });
});

describe("lex — grouping and keywords", () => {
  it("emits paren tokens", () => {
    expect(kinds("(c:r)")).toEqual(["lparen", "term", "rparen"]);
  });

  it("does not require whitespace around parens", () => {
    expect(kinds("t:creature(c:r or c:w)")).toEqual([
      "term",
      "lparen",
      "term",
      "or",
      "term",
      "rparen",
    ]);
  });

  it("recognises and/or in any case", () => {
    expect(kinds("a and b")).toEqual(["term", "and", "term"]);
    expect(kinds("a AND b")).toEqual(["term", "and", "term"]);
    expect(kinds("a Or b")).toEqual(["term", "or", "term"]);
  });

  it("treats a quoted 'or' as a value, not a keyword", () => {
    // Otherwise a card named "or" — or a phrase containing it — breaks parsing.
    expect(kinds('"or"')).toEqual(["term"]);
    expect(terms('"or"')[0].value).toBe("or");
  });

  it("does not treat a field value of 'or' as a keyword", () => {
    expect(kinds("t:or")).toEqual(["term"]);
  });

  it("records positions", () => {
    const tokens = lex("c:r or c:w");
    expect(tokens.map((t) => t.at)).toEqual([0, 4, 7]);
  });
});

describe("lex — edges left for later stages", () => {
  // The lexer's job is boundaries, not validity. These produce well-formed
  // tokens that the parser or compiler is responsible for rejecting.

  it("produces an empty value for a dangling operator", () => {
    expect(terms("mv>=")).toEqual([
      { field: "mv", op: ">=", value: "", quoted: false },
    ]);
    expect(terms("t:")).toEqual([
      { field: "t", op: ":", value: "", quoted: false },
    ]);
  });

  it("emits a lone not for a bare dash", () => {
    expect(kinds("-")).toEqual(["not"]);
  });

  it("emits empty parens rather than rejecting them", () => {
    expect(kinds("()")).toEqual(["lparen", "rparen"]);
  });

  it("leaves Scryfall's `!` exact-name prefix as literal text", () => {
    // `!"Lightning Bolt"` is not supported locally. It lexes as a bare word so
    // the compiler can recognise and report it, rather than the lexer guessing.
    expect(terms('!"Lightning Bolt"')).toEqual([
      { field: null, op: ":", value: '!"Lightning Bolt"', quoted: false },
    ]);
  });
});

describe("lex — realistic queries", () => {
  it("handles a full query", () => {
    expect(kinds('-t:creature (c:r or c:w) o:"draw a card" mv<=3')).toEqual([
      "not",
      "term",
      "lparen",
      "term",
      "or",
      "term",
      "rparen",
      "term",
      "term",
    ]);
  });

  it("handles nested groups", () => {
    expect(kinds("t:creature (c:r or (c:w and mv<=2))")).toEqual([
      "term",
      "lparen",
      "term",
      "or",
      "lparen",
      "term",
      "and",
      "term",
      "rparen",
      "rparen",
    ]);
  });
});
