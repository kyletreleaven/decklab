import { formatPath } from "../paths";
import type { V4Library, V4Printing } from "./v4";
import {
  bucketKey,
  type Asset,
  type AssetOf,
  type AttributeType,
  type Bucket,
  type ChecklistLine,
  type MemberLine,
  type PlaceLine,
  type V5Library,
  type Zone,
} from "./v5";

/**
 * v4 → 5, file to file: the mapping in docs/inventory/README.md → *Mapping today's
 * data*, as written out in docs/library-format-5.md → *v4 → 5*.
 *
 * Pure. What it needs from the card store comes in as two lookups, so the
 * caller decides where they come from; the CLI reads `card-cache.db`, and
 * nothing here can make a request. Every loss is reported rather than
 * buried.
 */

export interface Lookups {
  /** The oracle id of a printing, or undefined when the store lacks it. */
  oracleOf(p: V4Printing): string | undefined;
  /** A card's name by oracle id, or undefined when the store lacks it. */
  nameOf(oracleId: string): string | undefined;
}

export interface Report {
  /** Per collection: rows, and copies, whose finish was not `nonfoil`. */
  finishesDropped: { collection: string; rows: number; copies: number }[];
  /** Collections whose `kind` was not `paper`: convert by hand. */
  kinds: { collection: string; kind: string }[];
  /** Collections that were binary: they probably want to be pools. */
  binary: string[];
  /** Lines merged because they became one bucket. */
  merged: { collection: string; card: string; lines: number }[];
  /** Printings the store has no card for: written without `oracle`. */
  noOracle: string[];
  /** Tags whose cards the store has no name for: written with `oracle` alone. */
  noName: string[];
  /** Assets that had to move to a new path. */
  renamed: { from: string; to: string; why: string }[];
  /** Conditions other than NM, kept as an attribute. */
  conditionsKept: number;
  /** Item notes, kept as the `note` attribute. */
  notesKept: number;
}

export function emptyReport(): Report {
  return {
    finishesDropped: [],
    kinds: [],
    binary: [],
    merged: [],
    noOracle: [],
    noName: [],
    renamed: [],
    conditionsKept: 0,
    notesKept: 0,
  };
}

const printingLabel = (p: V4Printing) =>
  `${p.name} (${p.set}) ${p.number}${p.lang === "en" ? "" : ` [${p.lang}]`}`;

export function convertV4(v4: V4Library, lookups: Lookups): { library: V5Library; report: Report } {
  const report = emptyReport();
  const attributes: Record<string, AttributeType> = {};
  const assets: Asset[] = [];
  const taken = new Set<string>();
  const noOracle = new Set<string>();

  /** A top-level path for a name, unique, with every change reported. */
  function place(name: string, what: string): string[] {
    let base = name;
    if (base === "." || base === "..") {
      base = `${name} (renamed)`;
      report.renamed.push({ from: name, to: base, why: `"${name}" is reserved` });
    }
    let candidate = base;
    for (let n = 2; taken.has(candidate); n++) candidate = `${base} (${what}${n > 2 ? ` ${n - 1}` : ""})`;
    if (candidate !== base) {
      report.renamed.push({ from: name, to: candidate, why: `another asset is already called "${base}"` });
    }
    taken.add(candidate);
    return [candidate];
  }

  function bucketOf(p: V4Printing): Bucket {
    const bucket: Bucket = {
      card: p.name,
      printing: { set: p.set, number: p.number, lang: p.lang },
      attrs: {},
    };
    const oracle = lookups.oracleOf(p);
    if (oracle !== undefined) bucket.oracle = oracle;
    else if (!noOracle.has(printingLabel(p))) {
      noOracle.add(printingLabel(p));
      report.noOracle.push(printingLabel(p));
    }
    return bucket;
  }

  // Collections → places. No inference from `kind` or `quantity_kind`.
  for (const c of v4.collections) {
    const path = place(c.name, "collection");
    if (c.kind !== "paper") report.kinds.push({ collection: c.name, kind: c.kind });
    if (c.quantityKind === "binary") report.binary.push(c.name);

    const lines = new Map<string, PlaceLine & { rows: number }>();
    let rows = 0;
    let copies = 0;
    for (const item of c.items) {
      if (item.finish !== "nonfoil") {
        rows++;
        copies += item.quantity;
      }
      const bucket = bucketOf(item);
      if (item.condition !== "NM") {
        attributes.condition = "condition";
        bucket.attrs.condition = item.condition;
        report.conditionsKept++;
      }
      if (item.notes !== "") {
        attributes.note = "text";
        bucket.attrs.note = item.notes;
        report.notesKept++;
      }
      // Finish is dropped, so two rows can become one bucket: sum them,
      // keep the earlier date.
      const key = bucketKey(bucket);
      const seen = lines.get(key);
      if (seen) {
        seen.qty += item.quantity;
        seen.rows++;
        if (seen.added === undefined || item.addedAt < seen.added) seen.added = item.addedAt;
      } else {
        lines.set(key, { bucket, qty: item.quantity, added: item.addedAt, rows: 1 });
      }
    }
    if (rows) report.finishesDropped.push({ collection: c.name, rows, copies });

    const cards: PlaceLine[] = [];
    for (const { rows: n, ...line } of lines.values()) {
      if (n > 1) report.merged.push({ collection: c.name, card: line.bucket.card ?? "", lines: n });
      cards.push(line);
    }
    assets.push({
      path,
      type: "place",
      ...(c.notes !== "" && { notes: c.notes }),
      created: c.createdAt,
      updated: c.updatedAt,
      cards,
    });
  }

  // Decks → decklists with inline zones; `maybe` → a child checklist; piles
  // → one arrangement. A v4 deck is a list: whether it is built, and where,
  // v4 never said, so no deck (a collection of places) comes of it.
  for (const d of v4.decks) {
    const path = place(d.name, "decklist");
    const deck: AssetOf<"decklist"> = {
      path,
      type: "decklist",
      format: d.format,
      ...(d.notes !== "" && { notes: d.notes }),
      created: d.createdAt,
      updated: d.updatedAt,
      zones: {},
    };
    assets.push(deck);

    const zoneLines = (zone: string): PlaceLine[] =>
      d.cards
        .filter((card) => card.zone === zone)
        .map((card) => ({ bucket: bucketOf(card), qty: card.quantity, added: card.addedAt }));

    for (const zone of ["commander", "main", "side"] as Zone[]) {
      const cards = zoneLines(zone);
      if (!cards.length) continue;
      deck.zones[zone] = { byName: false, rooted: false, names: [zone], facets: [] };
      assets.push({
        path: [...path, zone],
        type: "exact checklist",
        created: d.createdAt,
        updated: d.updatedAt,
        cards,
      });
    }

    const maybe = zoneLines("maybe").map(({ qty, ...l }): ChecklistLine => ({ ...l, min: qty }));
    if (maybe.length) {
      assets.push({
        path: [...path, "maybe"],
        type: "checklist",
        created: d.createdAt,
        updated: d.updatedAt,
        cards: maybe,
      });
    }

    if (d.piles.length) {
      const piles = [...d.piles]
        .sort((a, b) => a.position - b.position)
        .map((pile) => {
          const cards = new Map<string, MemberLine>();
          for (const card of d.cards) {
            if (card.pile !== pile.name) continue;
            const bucket = bucketOf(card);
            cards.set(bucketKey(bucket), { bucket });
          }
          return { name: pile.name, cards: [...cards.values()] };
        });
      assets.push({
        path: [...path, "piles"],
        type: "arrangement",
        of: { byName: false, rooted: true, names: path, facets: [] },
        created: d.createdAt,
        updated: d.updatedAt,
        piles,
      });
    }
  }

  // Tags → one list pool per tag, under /pools.
  const tags = new Map<string, string[]>();
  for (const t of v4.tags) tags.set(t.tag, [...(tags.get(t.tag) ?? []), t.oracleId]);
  if (tags.size) {
    const pools = place("pools", "folder");
    for (const [tag, oracles] of tags) {
      const cards = oracles.map((oracle): MemberLine => {
        const card = lookups.nameOf(oracle);
        if (card === undefined) report.noName.push(`${tag}: ${oracle}`);
        return { bucket: { ...(card !== undefined && { card }), oracle, attrs: {} } };
      });
      const name = tag === "." || tag === ".." ? `${tag} (renamed)` : tag;
      if (name !== tag) {
        report.renamed.push({ from: tag, to: name, why: `"${tag}" is reserved` });
      }
      assets.push({ path: [...pools, name], type: "list pool", cards });
    }
  }

  return { library: { attributes, assets }, report };
}

/** The report as text, one finding per line; empty when nothing was lost. */
export function formatReport(r: Report): string {
  const out: string[] = [];
  for (const f of r.finishesDropped) {
    out.push(`finish dropped: ${f.collection}: ${f.rows} line(s), ${f.copies} cop${f.copies === 1 ? "y" : "ies"} not nonfoil`);
  }
  for (const k of r.kinds) out.push(`convert by hand: ${k.collection} was kind "${k.kind}"; it is now a place`);
  for (const b of r.binary) out.push(`convert by hand: ${b} was binary; it is now a place (a pool?)`);
  for (const m of r.merged) out.push(`merged: ${m.collection}: ${m.lines} lines of ${m.card} became one`);
  for (const p of r.noOracle) out.push(`no oracle id in the card store: ${p}`);
  for (const n of r.noName) out.push(`no name in the card store: ${n}`);
  for (const x of r.renamed) out.push(`renamed: ${x.from} → ${formatPath([x.to])}: ${x.why}`);
  if (r.conditionsKept) out.push(`kept: ${r.conditionsKept} condition(s) other than NM, as the \`condition\` attribute`);
  if (r.notesKept) out.push(`kept: ${r.notesKept} line note(s), as the \`note\` attribute`);
  return out.length ? out.join("\n") + "\n" : "";
}
