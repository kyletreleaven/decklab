/**
 * Tokeniser for the search language.
 *
 * Turns `-t:creature (c:r or o:"draw a card")` into a flat token stream. The
 * grammar itself is `parse.ts`'s job; this stage only has to get *boundaries*
 * right, which is where the awkward cases live: quotes may contain spaces,
 * parentheses and operator characters, all of which are otherwise significant.
 *
 * Term tokens arrive already split into field / operator / value. That is a
 * deliberate choice rather than parser work: the split is decided purely by
 * scanning characters, and doing it here keeps "unclosed quote" and "missing )"
 * as errors from clearly different stages.
 */

export type Op = ":" | "=" | "!=" | "<" | "<=" | ">" | ">=";

export type Token =
  | { kind: "lparen"; at: number }
  | { kind: "rparen"; at: number }
  | { kind: "not"; at: number }
  | { kind: "and"; at: number }
  | { kind: "or"; at: number }
  | {
      kind: "term";
      at: number;
      /** Lowercased field name, or null for a bare word (matched against name). */
      field: string | null;
      op: Op;
      value: string;
      /** Whether the value was quoted. Lets the compiler distinguish
       *  `name:bolt` from `name:"bolt"` if it ever wants exact matching. */
      quoted: boolean;
    };

export class LexError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
    this.name = "LexError";
  }
}

/** Longest first, so `<=` is not mistaken for `<` followed by a value of `=`. */
const OPERATORS: Op[] = [">=", "<=", "!=", ":", "=", ">", "<"];

const QUOTES = new Set(['"', "'"]);

function isBoundary(ch: string): boolean {
  return /\s/.test(ch) || ch === "(" || ch === ")";
}

/**
 * Strip a matching pair of surrounding quotes and unescape `\"` within.
 * Returns the text and whether it had been quoted.
 */
function unquote(raw: string): { value: string; quoted: boolean } {
  const text = raw.trim();
  if (text.length >= 2) {
    const first = text[0];
    if (QUOTES.has(first) && text[text.length - 1] === first) {
      return {
        value: text.slice(1, -1).replace(/\\(["'\\])/g, "$1"),
        quoted: true,
      };
    }
  }
  return { value: text, quoted: false };
}

/**
 * Split a scanned term into field, operator and value.
 *
 * The operator is the earliest one *outside* quotes — so `o:"a:b"` splits at the
 * first colon and keeps `a:b` whole as the value, rather than splitting inside
 * the quoted phrase.
 */
function splitTerm(
  raw: string,
  at: number,
): Extract<Token, { kind: "term" }> {
  let quote: string | null = null;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }

    if (QUOTES.has(ch)) {
      quote = ch;
      continue;
    }

    for (const op of OPERATORS) {
      if (!raw.startsWith(op, i)) continue;

      // A leading operator has no field to attach to — `:foo` is not a field
      // reference, so treat the whole thing as a bare word.
      if (i === 0) break;

      const { value, quoted } = unquote(raw.slice(i + op.length));
      return {
        kind: "term",
        at,
        field: raw.slice(0, i).toLowerCase(),
        op,
        value,
        quoted,
      };
    }
  }

  const { value, quoted } = unquote(raw);
  return { kind: "term", at, field: null, op: ":", value, quoted };
}

export function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === "(") {
      tokens.push({ kind: "lparen", at: i++ });
      continue;
    }

    if (ch === ")") {
      tokens.push({ kind: "rparen", at: i++ });
      continue;
    }

    // A `-` only negates at a token boundary. Because the loop always resumes
    // at one, reaching here means it is one — a hyphen inside a word (`Jund-ish`)
    // or a negative number (`mv>-1`) is consumed by the term scan below and
    // never seen here.
    if (ch === "-") {
      tokens.push({ kind: "not", at: i++ });
      continue;
    }

    const start = i;
    let raw = "";
    let quote: string | null = null;

    while (i < input.length) {
      const c = input[i];

      if (quote) {
        if (c === "\\" && i + 1 < input.length) {
          raw += c + input[i + 1];
          i += 2;
          continue;
        }
        if (c === quote) quote = null;
        raw += c;
        i++;
        continue;
      }

      if (QUOTES.has(c)) {
        quote = c;
        raw += c;
        i++;
        continue;
      }

      // Unquoted boundaries end the term. Inside quotes they are just text,
      // which is the whole reason quotes exist here.
      if (isBoundary(c)) break;

      raw += c;
      i++;
    }

    if (quote) {
      throw new LexError(`unclosed ${quote} quote`, start);
    }

    const lowered = raw.toLowerCase();
    if (lowered === "and") tokens.push({ kind: "and", at: start });
    else if (lowered === "or") tokens.push({ kind: "or", at: start });
    else tokens.push(splitTerm(raw, start));
  }

  return tokens;
}
