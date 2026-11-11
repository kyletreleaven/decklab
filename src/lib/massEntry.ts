/**
 * A checklist as TCGplayer Mass Entry text: `1 Lightning Bolt`, or with a
 * printing `1 Lightning Bolt [SLD] 84` (help.tcgplayer.com → *Getting Started
 * With Mass Entry*). Set codes are Scryfall's, which TCGplayer's mostly match.
 *
 * A checklist's lines can overlap — at least four Bolts, at least one of them
 * M10 — so adding them up asks for copies nobody wanted. A card's lines nest
 * by how much they pin (any ⊇ M10 ⊇ M10 foil), and each needs
 *
 *   bound(line) = max(its own count, Σ bound(each narrowest line inside it))
 *
 * Each line is then bought for what its narrower lines leave: ≥4 Bolt with
 * ≥1 M10 Bolt is one M10 and three of any printing. Where the lines do not
 * nest — a signed line and a near-mint line, neither inside the other — the
 * count is an upper bound: one copy might have been both.
 */

export interface AskedPattern {
  oracleId: string;
  /** The card's name, as TCGplayer lists it. */
  name: string;
  printingId?: string;
  printing?: { set: string; number: string };
  finish?: string;
  attrs: Record<string, unknown>;
  qty: number;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** `a` asks for every copy `b` does, and more: what `a` leaves out, `b` pins. */
function contains(a: AskedPattern, b: AskedPattern): boolean {
  if (a === b || a.oracleId !== b.oracleId) return false;
  if (a.printingId && a.printingId !== b.printingId) return false;
  if (a.finish && a.finish !== b.finish) return false;
  if (!Object.entries(a.attrs).every(([k, v]) => k in b.attrs && same(b.attrs[k], v))) return false;
  // The same pattern twice is not nested; `contains` both ways would recurse forever.
  const equal = a.printingId === b.printingId && a.finish === b.finish && same(a.attrs, b.attrs);
  return !equal;
}

/** Each pattern with the copies it is bought for, beyond its narrower lines. */
export function residuals(lines: AskedPattern[]): { pattern: AskedPattern; n: number }[] {
  const kids = new Map<AskedPattern, AskedPattern[]>();
  for (const p of lines) {
    const inside = lines.filter((q) => contains(p, q));
    kids.set(p, inside.filter((q) => !inside.some((r) => contains(r, q))));
  }
  const memo = new Map<AskedPattern, number>();
  const bound = (p: AskedPattern): number => {
    const known = memo.get(p);
    if (known !== undefined) return known;
    const n = Math.max(p.qty, kids.get(p)!.reduce((s, q) => s + bound(q), 0));
    memo.set(p, n);
    return n;
  };
  return lines.map((p) => ({ pattern: p, n: bound(p) - kids.get(p)!.reduce((s, q) => s + bound(q), 0) }));
}

/**
 * The Mass Entry text. With `printings`, a line naming one keeps its set and
 * number; without, every card is one line of any printing.
 */
export function massEntry(lines: AskedPattern[], { printings }: { printings: boolean }): string {
  const out = new Map<string, { name: string; tail: string; n: number }>();
  for (const { pattern: p, n } of residuals(lines)) {
    if (n <= 0) continue;
    const tail = printings && p.printing ? ` [${p.printing.set.toUpperCase()}] ${p.printing.number}` : "";
    const key = `${p.oracleId}|${tail}`;
    const row = out.get(key) ?? { name: p.name, tail, n: 0 };
    row.n += n;
    out.set(key, row);
  }
  return [...out.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.tail.localeCompare(b.tail))
    .map((r) => `${r.n} ${r.name}${r.tail}`)
    .join("\n");
}
