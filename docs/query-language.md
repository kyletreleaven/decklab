# Local query language — implementation plan

DeckLab accepts Scryfall's search syntax. Against **All Magic** the string is
passed straight through to Scryfall, who parse their own language better than we
ever will. Against a **local collection** we have to interpret it ourselves —
that is what this document plans.

Status: not started. Pure logic, no UI and no schema change, so it is
independently testable and independently shippable.

> A version of this was written and deleted early on, when scope was cut back to
> "manage collections and decks". It was never committed, so this is a rewrite,
> not a recovery.

---

## Why local at all

The same box has to mean the same thing wherever it appears. Today it does not:
`PoolPanel` sends free text to Scryfall for the Universe source but compiles it
to `c.name LIKE '%…%'` for a collection, so typing `t:creature` at a collection
silently returns nothing. Merging card search into the collection view makes that
inconsistency the centrepiece rather than a corner.

Facets are **not** part of this. They stay an independent filter AND-ed with the
query, which avoids having to match a facet against a term buried in an arbitrary
boolean expression:

```
effective  =  parse(queryText)  AND  facets  AND  deckScope
```

---

## Grammar

Confirmed against the live API and pinned by contract tests in
`src/lib/scryfall.contract.test.ts`:

```
expr  := or
or    := and ( ("or" | "OR") and )*
and   := unary ( ("and" | "AND")? unary )*    -- juxtaposition is AND
unary := "-" unary | atom
atom  := "(" expr ")" | term
term  := field op value | bareword
op    := ":" | "=" | "!=" | "<" | "<=" | ">" | ">="
```

Verified behaviours:

| Query | Result |
| --- | --- |
| `c:r t:creature` | 4,369 — juxtaposition is AND |
| `(c:r or c:w) t:creature` | 8,338 — strictly more, so the grouping binds |
| `t:land and mv>3` | 31 — explicit `and` works |
| `-t:creature c:r` | 2,704 — `-` negates |
| `t:creature (c:r or (c:w and mv<=2))` | 5,592 — nesting works |

The OR case returning *more* than the AND case is the assertion that actually
proves parentheses group, rather than merely proving the query parses.

---

## Files

```
src/lib/query/
  lex.ts        string  → tokens      quoted phrases, operators, parens, '-'
  parse.ts      tokens  → AST
  compile.ts    AST     → { sql, params }   a WHERE fragment
  index.ts      public surface: parse, compileToSql, error types
```

Split three ways because each stage is independently testable, and because
failures at each stage want different messages: a lexer error is "unclosed
quote", a parser error is "missing )", a compiler error is "`is:` is not
supported here".

---

## Field mapping

Every field in v1 hits a column that already exists on `cards`.

| Term | Column | Notes |
| --- | --- | --- |
| bareword, `name:` | `name` | `LIKE %v%` |
| `t:` | `type_line` | `LIKE` |
| `o:` | `oracle_text` | `LIKE`; honour quoted phrases |
| `c:` | `colors` | see colour operators |
| `id:` | `color_identity` | see colour operators |
| `mv:` `cmc:` | `cmc` | numeric compare, REAL column |
| `pow:` `tou:` `loy:` | `power` `toughness` `loyalty` | TEXT — see gotcha |
| `r:` | `rarity` | equality |
| `s:` `set:` `e:` | `set_code` | equality, lowercase |
| `f:` | `legalities` | `json_extract(legalities, '$.' \|\| ?) IN ('legal','restricted')` — already done for pool scoping |
| `kw:` | `keywords` | JSON array |
| `is:` | — | **unsupported in v1**; structured error naming the term |

### Colour operators

The subtle part. Colours are stored as canonical WUBRG strings (`"RW"`), and
Scryfall's operators genuinely differ:

| Query | Means | Compiles to |
| --- | --- | --- |
| `c:rw` | *at least* R and W | contains R AND contains W |
| `c=rw` | exactly | `colors = 'RW'` — canonicalise the value first |
| `c<=rw` | at most — the Commander identity rule | no letter outside the set |
| `c>rw` | strict superset | contains both, and not equal |

`c<=` already exists as `withinIdentity` in `filters.ts` and can be lifted.

Accept letters (`rw`), `c` for colourless, and full names (`red`). Guild and
shard names (`azorius`, `bant`) are out of scope for v1.

### Gotcha: power and toughness are TEXT

They hold `*`, `1+*`, `∞`. SQLite's `CAST('*' AS INTEGER)` is `0`, so a naive
`pow<=1` would match every `*` creature. Guard with a numeric check before
comparing, and test it explicitly — this is the kind of bug that looks like
correct output.

### Safety

Every value is parameterised, never interpolated. The compiler returns
`{ sql, params }` for exactly this reason. Field *names* are chosen from a fixed
map, so they never come from user input either.

---

## Testing

| Stage | Cases |
| --- | --- |
| Lexer | quoted phrases, operators *inside* quotes, negation, bare parens, unclosed quote |
| Parser | precedence (`or` looser than `and`), nesting, `-` applied to a group, trailing operator |
| Compiler | golden `{sql, params}` per field, all four colour operators, the P/T numeric guard |
| Integration | run generated SQL against the live database — unit tests only prove we emit the string we *intended* |

That last row matters. Everything above is string comparison; only the
integration pass proves the SQL is valid and selects what it should.

---

## Out of scope for v1

- **`is:`** — deferred deliberately. It still works against All Magic, where the
  string passes through. Locally it should report *"`is:` is not supported here
  yet"* rather than matching nothing. The eventual design is **cached hidden
  collections**: resolve `is:fetchland` from Scryfall once, cache the card set,
  then treat it as a local membership test. That generalises to any predicate we
  cannot compute — but it makes the predicate **async on cold cache**, which no
  other local predicate is, and that asymmetry is better paid once the rest of
  the language has settled.
- **Regex terms** (`o:/…/`) — SQLite has no `REGEXP` without registering a
  function in Rust. Post-filtering in JS would work on a bounded result set.
- **Guild and shard colour names.**
- **Result modifiers** `unique:` / `order:` / `direction:` — not predicates at
  all; they belong with sorting and paging.

**Candidate stretch:** price comparisons (`usd>5`) are easy via
`json_extract(prices, '$.usd')` and need no new storage.
