# Local query language — implementation plan

DeckLab accepts Scryfall's search syntax. Against **All Magic** the string is
passed straight through to Scryfall, who parse their own language better than we
ever will. Against a **local collection** we have to interpret it ourselves —
that is what this document plans.

**Status: built and wired in.** `src/lib/query/` implements lex → parse →
compile behind `compileQuery()`. `collectionItems()` compiles the same string
All Magic sends to Scryfall, and a failure raises `QueryError`, which the pool
shows in its status line while keeping the previous results on screen.

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
  index.ts      public surface: compileQuery(), plus the stage APIs
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
| `r:` | `rarity` | ranked, so `r>=rare` includes mythic (alphabetically `mythic` < `rare`) |
| `s:` `set:` `e:` | `set_code` | equality, lowercase |
| `f:` | `legalities` | `json_extract(legalities, '$.' \|\| ?) IN ('legal','restricted')` — already done for pool scoping |
| `kw:` | `keywords` | JSON array |
| `layout:` | `layout` | equality |
| `a:` `ft:` | raw payload | `json_extract(data, '$.artist')` etc. |
| `game:` | `digital` | `game:paper` only — the column cannot tell Arena from MTGO, so the rest raise rather than guess |
| `is:` | — | **unsupported in v1**; structured error naming the term |

### Colour operators

The subtle part, since Scryfall's operators genuinely differ from one another.
The semantics behind this table — what the two fields mean, why the empty
selection is asymmetric, and which colour searches Scryfall supports that this
compiler does not — are in
[`colour-filtering.md`](colour-filtering.md).

| Query | Means | Compiles to |
| --- | --- | --- |
| `c:rw` `c>=rw` | *at least* R and W | contains R AND contains W |
| `c=rw` | exactly | contains R, contains W, **and** `LENGTH(colors) = 2` |
| `c<=rw` | at most — the Commander identity rule | no letter outside the set |
| `c>rw` | strict superset | contains both, and not exactly two |
| `c:c` / `c:m` | colourless / multicolour | `LENGTH = 0` / `LENGTH > 1` |
| `c>=2` `c=1` | a colour *count*, not a colour | `LENGTH(colors) >= 2` |

**Nothing depends on stored colour order.** Colours happen to be stored
WUBRG-canonical (`"WR"`, not `"RW"`), but expressing equality as *contains each,
and has exactly N* keeps the SQL correct regardless — one fewer invariant the
compiler relies on. Verified: both forms return the same 79 cards.

Values are deduped **before** the count is taken, so `c=rr` is mono-red
(`LENGTH = 1`) rather than a two-colour set containing red.

Accept letters (`rw`), `c` for colourless, `m` for multicolour, and full names
(`red`). Guild and shard names (`azorius`, `bant`) are out of scope for v1.

### Gotcha: `digital` means "not in paper"

`game:paper` compiles to `digital = 0`, which is correct but not for the reason
the column name suggests. `digital` does **not** mean "exists in a digital
game" — it means *this printing is not available in paper*.

Across a 350-printing sample drawn without any digital-related term, 201
printings were on MTGO or Arena **and** paper, and every one was `digital = 0`:

```
digital=False  games=mtgo,paper        138
digital=False  games=paper              92
digital=False  games=arena,mtgo,paper   63
digital=True   games=arena              41
digital=True   games=mtgo               15
digital=False  games=arena,paper         1
```

The invariant `digital == ('paper' not in games)` held without exception, so
`digital = 0` is exactly `game:paper` and not an approximation of it. Confirmed
against the API from the other direction too: `game:paper` and `not:digital`
return the same rows at both grains — 32,732 cards, 97,648 printings.

Two consequences:

- The column is per **printing**, which is the grain a collection holds. An
  Arena-only printing drops out while the paper printing of the same card
  stays — the right answer for a collection, and the reason this is not
  something to "fix" into oracle grain.
- One boolean cannot separate Arena from MTGO, so `game:arena` and `game:mtgo`
  raise a structured error rather than answering with `digital = 1`, which would
  be a guess dressed as a result. The `games` array that *would* answer them
  lives in the `data` JSON.

Prefer the positive spelling in emitted queries: `game:paper` says what is
wanted, `not:digital` says what is not, and they select the same rows.

### Gotcha: power and toughness are TEXT

They hold `*`, `1+*`, `∞`. SQLite's `CAST('*' AS INTEGER)` is `0`, so a naive
`pow<=1` would match every `*` creature. Guard with a numeric check before
comparing, and test it explicitly — this is the kind of bug that looks like
correct output.

### Safety

Every value is parameterised, never interpolated. The compiler returns
`{ sql, params }` for exactly this reason. Field *names* are chosen from a fixed
map, so they never come from user input either.

### Errors are returned, not thrown

`compileQuery()` returns an error rather than throwing. Search runs on every
keystroke, so half-typed input is the normal case, not a failure. A test walks
every prefix of a realistic query to prove none of it explodes.
`unsupportedTerms()` lists terms such as `is:` without throwing.

---

## Testing

All of the below are implemented and passing.

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
