/**
 * The local search language.
 *
 * Parses Scryfall-style queries and compiles them to SQL over the `cards`
 * table, so `t:creature c:rw mv<=3` means the same thing against a local
 * collection as it does against All Magic — where the string is passed straight
 * through to Scryfall instead.
 *
 * See `docs/query-language.md` for the grammar and what is deliberately
 * unsupported.
 */

export { lex, LexError, type Op, type Token } from "./lex";
export { parse, ParseError, eachTerm, type Node } from "./parse";
export {
  compile,
  CompileError,
  unsupportedTerms,
  type CompiledQuery,
  type CompileOptions,
} from "./compile";

import { compile, CompileError, type CompileOptions } from "./compile";
import { LexError } from "./lex";
import { parse, ParseError } from "./parse";

export interface QueryResult {
  /** SQL boolean expression, or null when the query is empty (match all). */
  sql: string | null;
  params: unknown[];
  /** Present when the query could not be used; `sql` is null in that case. */
  error?: { message: string; at: number };
}

/**
 * Parse and compile in one step, reporting failures rather than throwing.
 *
 * Search runs as you type, so most "errors" are just half-finished input. A
 * caller wants to show a hint and keep the previous results, not handle an
 * exception on every keystroke.
 */
export function compileQuery(
  input: string,
  options: CompileOptions = {},
): QueryResult {
  let node;
  try {
    node = parse(input);
  } catch (err) {
    if (err instanceof LexError || err instanceof ParseError) {
      return { sql: null, params: [], error: { message: err.message, at: err.at } };
    }
    throw err;
  }

  // An empty query matches everything, which is different from matching nothing
  // — callers should omit the WHERE clause rather than emit `WHERE 0`.
  if (!node) return { sql: null, params: [] };

  try {
    const { sql, params } = compile(node, options);
    return { sql, params };
  } catch (err) {
    if (err instanceof CompileError) {
      return { sql: null, params: [], error: { message: err.message, at: err.at } };
    }
    throw err;
  }
}
