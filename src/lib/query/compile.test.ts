import { describe, expect, it } from "vitest";
import { compile, CompileError, unsupportedTerms } from "./compile";
import { parse } from "./parse";

/** Compile a query string straight to `{ sql, params }`. */
function q(input: string) {
  return compile(parse(input)!);
}

/** Just the SQL, whitespace-normalised, for readable assertions. */
function sql(input: string): string {
  return q(input).sql.replace(/\s+/g, " ");
}

describe("compile — text fields", () => {
  it("matches a bare word against the card name", () => {
    const { sql, params } = q("bolt");
    expect(sql).toContain("c.name LIKE");
    expect(params).toEqual(["%bolt%"]);
  });

  it("maps t: to type_line and o: to oracle_text", () => {
    expect(sql("t:creature")).toContain("c.type_line LIKE");
    expect(sql("o:flying")).toContain("c.oracle_text LIKE");
  });

  it("accepts long field aliases", () => {
    expect(sql("type:creature")).toBe(sql("t:creature"));
    expect(sql("oracle:flying")).toBe(sql("o:flying"));
  });

  it("treats = as exact and : as contains", () => {
    expect(q("name=Bolt").params).toEqual(["Bolt"]);
    expect(q("name:Bolt").params).toEqual(["%Bolt%"]);
  });

  it("negates with !=", () => {
    expect(sql("t!=creature")).toMatch(/^NOT \(/);
  });

  it("escapes LIKE wildcards in the value", () => {
    // A literal % in a card name must not become a wildcard.
    expect(q("name:100%").params).toEqual(["%100\\%%"]);
    expect(sql("name:100%")).toContain("ESCAPE");
  });
});

describe("compile — numeric fields", () => {
  it("treats : as equality, matching Scryfall", () => {
    expect(sql("mv:3")).toBe("c.cmc = $1");
    expect(q("mv:3").params).toEqual([3]);
  });

  it("passes comparisons through", () => {
    expect(sql("mv<=3")).toBe("c.cmc <= $1");
    expect(sql("mv>3")).toBe("c.cmc > $1");
  });

  it("accepts cmc as an alias for mv", () => {
    expect(sql("cmc>=5")).toBe(sql("mv>=5"));
  });

  it("rejects a non-numeric value", () => {
    expect(() => q("mv:three")).toThrow(/not a number/);
  });
});

describe("compile — power and toughness", () => {
  it("guards against CAST('*') being 0", () => {
    // Without the all-digits guard, pow<=1 matches every */* creature, because
    // SQLite casts '*' to 0. Verified against the live database.
    const out = sql("pow<=1");
    expect(out).toContain("GLOB '[0-9]*'");
    expect(out).toContain("NOT GLOB '*[^0-9]*'");
    expect(out).toContain("CAST(c.power AS INTEGER) <= $1");
  });

  it("guards toughness and loyalty the same way", () => {
    expect(sql("tou>=4")).toContain("CAST(c.toughness AS INTEGER)");
    expect(sql("loy:3")).toContain("CAST(c.loyalty AS INTEGER)");
  });

  it("rejects variable power rather than silently mishandling it", () => {
    expect(() => q("pow:*")).toThrow(/not a number/);
  });
});

describe("compile — colours", () => {
  it("`c:rw` means at least those colours", () => {
    const { sql, params } = q("c:rw");
    expect(sql).toBe("(c.colors LIKE $1 AND c.colors LIKE $2)");
    expect(params).toEqual(["%R%", "%W%"]);
  });

  it("`c=rw` means exactly, without relying on stored order", () => {
    // Storage happens to be WUBRG-canonical, but the SQL must not depend on it:
    // 'contains both, and has two colours' is order-independent.
    const out = sql("c=rw");
    expect(out).toContain("LENGTH(c.colors) = $3");
    expect(out).not.toMatch(/colors = \$\d+/);
  });

  it("`c<=rw` is the Commander identity rule", () => {
    const { sql, params } = q("id<=rw");
    // Expressed as the absence of every disallowed colour.
    expect(sql).toBe(
      "(c.color_identity NOT LIKE $1 AND c.color_identity NOT LIKE $2 AND c.color_identity NOT LIKE $3)",
    );
    expect(params).toEqual(["%U%", "%B%", "%G%"]);
  });

  it("`c>rw` is a strict superset", () => {
    const out = sql("c>rw");
    expect(out).toContain("AND NOT (LENGTH");
  });

  it("handles colourless and multicolour", () => {
    expect(sql("c:c")).toBe("LENGTH(c.colors) = 0");
    expect(sql("c:m")).toBe("LENGTH(c.colors) > 1");
  });

  it("accepts colour names as well as letters", () => {
    expect(sql("c:red")).toBe(sql("c:r"));
  });

  it("ignores duplicate letters", () => {
    expect(q("c:rr").params).toEqual(["%R%"]);
    expect(sql("c:rwr")).toBe(sql("c:rw"));
  });

  it("dedupes before counting, so `c=rr` is mono-red not two-coloured", () => {
    // If the length were taken from the raw value rather than the deduped set,
    // this would ask for exactly two colours that include red — matching a
    // plausible-looking but wrong set of cards.
    expect(q("c=rr").params).toEqual(["%R%", 1]);
    expect(q("c=rwwr").params).toEqual(["%R%", "%W%", 2]);
  });

  it("is order-insensitive in the query too", () => {
    expect(q("c:rw").params.sort()).toEqual(q("c:wr").params.sort());
  });

  it("rejects a letter that is not a colour", () => {
    expect(() => q("c:x")).toThrow(/not a colour/);
  });
});

describe("compile — rarity", () => {
  it("matches exactly for : and =", () => {
    expect(q("r:rare").params).toEqual(["rare"]);
  });

  it("accepts a prefix", () => {
    expect(q("r:myth").params).toEqual(["mythic"]);
  });

  it("ranks rarity for comparisons rather than comparing strings", () => {
    // Alphabetically 'mythic' < 'rare', so a string compare would be wrong.
    const out = sql("r>=rare");
    expect(out).toContain("CASE c.rarity");
    expect(out).toContain(">= $5");
  });

  it("rejects a value that is not a rarity", () => {
    expect(() => q("r:legendary")).toThrow(/not a rarity/);
  });
});

describe("compile — other fields", () => {
  it("maps set aliases to set_code, lowercased", () => {
    expect(q("set:MH2").params).toEqual(["mh2"]);
    expect(sql("e:mh2")).toBe(sql("s:mh2"));
  });

  it("parameterises the format name inside the JSON path", () => {
    // Concatenating into '$.commander' would let a value alter the expression.
    const { sql, params } = q("f:commander");
    expect(sql).toContain("'$.' || $1");
    expect(params).toEqual(["commander"]);
  });

  it("treats restricted as legal for format queries", () => {
    expect(sql("f:vintage")).toContain("IN ('legal', 'restricted')");
  });

  it("matches keywords through json_each", () => {
    const { sql, params } = q("kw:flying");
    expect(sql).toContain("json_each(c.keywords)");
    expect(params).toEqual(["flying"]);
  });

  it("reads artist out of the raw payload", () => {
    expect(sql("a:rebecca")).toContain("json_extract(c.data, '$.artist')");
  });
});

describe("compile — structure", () => {
  it("joins an AND", () => {
    const out = sql("c:r t:creature");
    expect(out).toMatch(/^\(.* AND .*\)$/);
    expect(out).toContain("c.colors LIKE $1");
    expect(out).toContain("c.type_line LIKE $2");
  });

  it("keeps every sub-expression self-contained", () => {
    // A multi-condition term returned bare would mis-associate inside an OR:
    // `a AND b OR c` is not what `c:rw or t:creature` means.
    const out = sql("c:rw or t:creature");
    expect(out).toContain("(c.colors LIKE $1 AND c.colors LIKE $2)");
  });

  it("joins an OR", () => {
    expect(sql("t:instant or t:sorcery")).toContain(" OR ");
  });

  it("wraps a negation", () => {
    expect(sql("-t:creature")).toMatch(/^NOT \(/);
  });

  it("preserves nesting", () => {
    const out = sql("t:creature (c:r or c:w)");
    expect(out).toContain(" AND ");
    expect(out).toContain(" OR ");
  });

  it("numbers parameters in order across the whole tree", () => {
    const { sql, params } = q("t:creature c:r mv<=3");
    expect(params).toHaveLength(3);
    expect(sql).toContain("$1");
    expect(sql).toContain("$2");
    expect(sql).toContain("$3");
  });

  it("honours a param offset so it can embed in a larger query", () => {
    const { sql, params } = compile(parse("t:creature")!, { paramOffset: 4 });
    expect(sql).toContain("$5");
    expect(params).toHaveLength(1);
  });

  it("honours a table alias", () => {
    expect(compile(parse("t:creature")!, { alias: "x" }).sql).toContain(
      "x.type_line",
    );
  });
});

describe("compile — unsupported", () => {
  it("reports is: rather than matching nothing", () => {
    expect(() => q("is:commander")).toThrow(CompileError);
    expect(() => q("is:commander")).toThrow(/not supported/);
  });

  it("reports an unknown field", () => {
    expect(() => q("wibble:3")).toThrow(/unknown field 'wibble'/);
  });

  it("collects every problem without throwing", () => {
    const problems = unsupportedTerms(parse("t:creature is:commander wibble:3")!);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/is:/);
    expect(problems[1]).toMatch(/unknown field/);
  });

  it("reports nothing for a fully supported query", () => {
    expect(unsupportedTerms(parse("t:creature c:r mv<=3")!)).toEqual([]);
  });
});
