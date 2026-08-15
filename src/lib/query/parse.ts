/**
 * Recursive-descent parser for the search language.
 *
 * Grammar, confirmed against the live Scryfall API and pinned by contract tests
 * in `scryfall.contract.test.ts`:
 *
 *     expr  := or
 *     or    := and ( ("or") and )*
 *     and   := unary ( ("and")? unary )*      -- juxtaposition is AND
 *     unary := "not" unary | atom
 *     atom  := "(" expr ")" | term
 *
 * `or` binds looser than `and`, so `a or b c` is `a or (b and c)`.
 */

import { lex, type Op, type Token } from "./lex";

export type Node =
  | { kind: "and"; nodes: Node[] }
  | { kind: "or"; nodes: Node[] }
  | { kind: "not"; node: Node }
  | {
      kind: "term";
      field: string | null;
      op: Op;
      value: string;
      quoted: boolean;
      at: number;
    };

export class ParseError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

/**
 * Parse a query into an AST, or null if it is empty.
 *
 * Null rather than an empty node because "no query" is a legitimate state that
 * means *match everything*, and callers should not have to distinguish it from
 * a query that happened to parse to nothing.
 */
export function parse(input: string): Node | null {
  const tokens = lex(input);
  if (!tokens.length) return null;

  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const end = () => input.length;

  function parseExpr(): Node {
    return parseOr();
  }

  function parseOr(): Node {
    const nodes = [parseAnd()];
    while (peek()?.kind === "or") {
      pos++;
      nodes.push(parseAnd());
    }
    return nodes.length === 1 ? nodes[0] : { kind: "or", nodes };
  }

  function parseAnd(): Node {
    const nodes: Node[] = [];

    while (pos < tokens.length) {
      const token = peek();
      // `or` and `)` end this conjunction; everything else continues it, which
      // is what makes juxtaposition mean AND.
      if (!token || token.kind === "rparen" || token.kind === "or") break;

      if (token.kind === "and") {
        if (!nodes.length) {
          throw new ParseError("'and' needs something before it", token.at);
        }
        pos++;
        // An explicit `and` must be followed by an operand.
        const next = peek();
        if (!next || next.kind === "rparen" || next.kind === "or") {
          throw new ParseError("'and' needs something after it", token.at);
        }
        continue;
      }

      nodes.push(parseUnary());
    }

    if (!nodes.length) {
      throw new ParseError("expected a search term", peek()?.at ?? end());
    }
    return nodes.length === 1 ? nodes[0] : { kind: "and", nodes };
  }

  function parseUnary(): Node {
    const token = peek();
    if (token?.kind === "not") {
      pos++;
      const next = peek();
      if (!next || next.kind === "rparen" || next.kind === "or" || next.kind === "and") {
        throw new ParseError("'-' needs something to negate", token.at);
      }
      return { kind: "not", node: parseUnary() };
    }
    return parseAtom();
  }

  function parseAtom(): Node {
    const token = peek();
    if (!token) throw new ParseError("unexpected end of query", end());

    if (token.kind === "lparen") {
      pos++;
      if (peek()?.kind === "rparen") {
        throw new ParseError("empty group", token.at);
      }
      const inner = parseExpr();
      if (peek()?.kind !== "rparen") {
        throw new ParseError("missing ')'", token.at);
      }
      pos++;
      return inner;
    }

    if (token.kind === "rparen") {
      throw new ParseError("unexpected ')'", token.at);
    }

    if (token.kind === "term") {
      pos++;
      const { field, op, value, quoted, at } = token;
      // A dangling operator is a typo; `t:""` is a deliberate empty string, so
      // the quoting is what distinguishes intent here.
      if (field !== null && value === "" && !quoted) {
        throw new ParseError(`'${field}${op}' needs a value`, at);
      }
      return { kind: "term", field, op, value, quoted, at };
    }

    throw new ParseError(`unexpected '${token.kind}'`, token.at);
  }

  const node = parseExpr();

  if (pos < tokens.length) {
    throw new ParseError("unexpected trailing input", tokens[pos].at);
  }
  return node;
}

/** Walk every term in an AST. Used by the compiler and by "what is unsupported". */
export function eachTerm(
  node: Node,
  visit: (term: Extract<Node, { kind: "term" }>) => void,
): void {
  switch (node.kind) {
    case "term":
      visit(node);
      return;
    case "not":
      eachTerm(node.node, visit);
      return;
    default:
      for (const child of node.nodes) eachTerm(child, visit);
  }
}
