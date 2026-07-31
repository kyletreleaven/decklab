import type { Card, DeckEntry, CollectionItem } from "./types";

/**
 * Parsing and serialisation for decklists and collection exports.
 *
 * The goal is "paste anything vaguely deck-shaped": Arena and MTGO exports,
 * Moxfield/Archidekt text, tournament lists, and the CSV files that collection
 * trackers produce. Nothing here touches the network — resolution against
 * Scryfall happens separately, so parsing stays synchronous and testable.
 */

export type Section = "commander" | "main" | "side" | "maybe";

export interface ParsedLine {
  raw: string;
  quantity: number;
  name: string;
  /** Present when the source pinned an exact printing. */
  setCode?: string;
  collectorNumber?: string;
  /** Set by adapters that already know the Scryfall printing id (e.g. Archidekt). */
  scryfallId?: string;
  foil?: boolean;
  condition?: string;
  section: Section;
}

export interface ParseResult {
  lines: ParsedLine[];
  /** Lines that looked like content but could not be understood. */
  skipped: string[];
  source: "text" | "csv";
}

/* ---------- section headers ---------- */

const SECTIONS: Record<string, Section | "ignore"> = {
  commander: "commander",
  commanders: "commander",
  deck: "main",
  main: "main",
  mainboard: "main",
  maindeck: "main",
  sideboard: "side",
  side: "side",
  companion: "side",
  maybeboard: "maybe",
  maybe: "maybe",
  considering: "maybe",
  // Arena exports open with an "About" block holding the deck name.
  about: "ignore",
};

function asSection(line: string): Section | "ignore" | null {
  const cleaned = line
    .replace(/^[/#]+/, "")
    .replace(/[:：]\s*$/, "")
    .trim()
    .toLowerCase();

  if (!cleaned || /\d/.test(cleaned)) return null;
  return SECTIONS[cleaned] ?? null;
}

/* ---------- text lines ---------- */

// Trailing "(MH2) 123", "[MH2] 123", "(MH2)". Set codes are 2-6 alphanumerics,
// which is tight enough not to swallow parenthesised card names.
const SET_SUFFIX = /[([]([A-Za-z0-9]{2,6})[)\]]\s*([A-Za-z0-9★-]+)?\s*$/;
const LEADING_QTY = /^(\d+)\s*[xX]?[\s.)]+(.*)$/;
const TRAILING_QTY = /^(.*?)\s+[xX](\d+)\s*$/;

export function parseLine(raw: string, section: Section): ParsedLine | null {
  let text = raw.trim();
  if (!text) return null;

  let foil = false;

  // Moxfield marks finishes with *F* (foil) and *E* (etched).
  if (/\*F\*/i.test(text) || /\*E\*/i.test(text)) {
    foil = true;
    text = text.replace(/\*[FE]\*/gi, " ").trim();
  }

  let quantity = 1;
  const leading = text.match(LEADING_QTY);
  if (leading) {
    quantity = Number.parseInt(leading[1], 10);
    text = leading[2].trim();
  } else {
    // Only accept a trailing count when it is explicitly marked with an x,
    // otherwise a collector number would be read as a quantity.
    const trailing = text.match(TRAILING_QTY);
    if (trailing) {
      text = trailing[1].trim();
      quantity = Number.parseInt(trailing[2], 10);
    }
  }

  let setCode: string | undefined;
  let collectorNumber: string | undefined;
  const suffix = text.match(SET_SUFFIX);
  if (suffix) {
    setCode = suffix[1].toLowerCase();
    collectorNumber = suffix[2];
    text = text.slice(0, suffix.index).trim();
  }

  // Strip trailing category tags that Archidekt and friends append.
  text = text.replace(/\s*\^[^^]*\^\s*$/, "").trim();

  if (!text) return null;
  if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;

  return {
    raw,
    quantity,
    name: text,
    setCode,
    collectorNumber,
    foil: foil || undefined,
    section,
  };
}

/* ---------- CSV ---------- */

/** Split one CSV row, honouring quoted fields and doubled quotes. */
export function splitCsvRow(row: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < row.length; i++) {
    const ch = row[i];

    if (quoted) {
      if (ch === '"') {
        if (row[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ",") {
      fields.push(current);
      current = "";
    } else current += ch;
  }

  fields.push(current);
  return fields.map((f) => f.trim());
}

const HEADER_ALIASES: Record<string, string[]> = {
  quantity: ["count", "quantity", "qty", "amount", "card count", "have"],
  name: ["name", "card name", "card"],
  set: ["set", "set code", "setcode", "edition", "edition code", "set_code"],
  number: [
    "collector number",
    "collector_number",
    "card number",
    "cardnumber",
    "number",
    "cn",
  ],
  foil: ["foil", "finish", "printing", "is foil", "foiling"],
  condition: ["condition", "cond"],
  section: ["section", "zone", "board", "category", "maybeboard"],
};

function mapHeaders(header: string[]): Record<string, number> {
  const index: Record<string, number> = {};
  header.forEach((raw, i) => {
    const key = raw.trim().toLowerCase().replace(/^"|"$/g, "");
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(key) && index[field] === undefined) index[field] = i;
    }
  });
  return index;
}

function looksFoil(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "foil" || v === "yes" || v === "true" || v === "1" || v === "etched";
}

/* ---------- entry point ---------- */

export function parseDecklist(input: string, defaultSection: Section = "main"): ParseResult {
  const rows = input.split(/\r?\n/);
  const nonEmpty = rows.filter((r) => r.trim());
  if (!nonEmpty.length) return { lines: [], skipped: [], source: "text" };

  // Treat it as CSV only when the first row genuinely looks like a header,
  // otherwise a decklist containing commas would be misread.
  const firstFields = splitCsvRow(nonEmpty[0]);
  if (firstFields.length >= 2) {
    const index = mapHeaders(firstFields);
    if (index.name !== undefined) {
      return parseCsv(nonEmpty, index, defaultSection);
    }
  }

  const lines: ParsedLine[] = [];
  const skipped: string[] = [];
  let section: Section = defaultSection;
  let ignoring = false;

  for (const row of rows) {
    const trimmed = row.trim();

    if (!trimmed) {
      // A blank line ends an ignored block but otherwise means nothing.
      ignoring = false;
      continue;
    }

    const header = asSection(trimmed);
    if (header) {
      if (header === "ignore") {
        ignoring = true;
      } else {
        ignoring = false;
        section = header;
      }
      continue;
    }

    if (ignoring) continue;

    // Comments, but only when the line is not a section marker (handled above).
    if (/^(#|\/\/)/.test(trimmed)) continue;

    const parsed = parseLine(trimmed, section);
    if (parsed) lines.push(parsed);
    else skipped.push(trimmed);
  }

  return { lines, skipped, source: "text" };
}

function parseCsv(
  rows: string[],
  index: Record<string, number>,
  defaultSection: Section,
): ParseResult {
  const lines: ParsedLine[] = [];
  const skipped: string[] = [];

  for (const row of rows.slice(1)) {
    const fields = splitCsvRow(row);
    const name = fields[index.name]?.replace(/^"|"$/g, "").trim();
    if (!name) {
      if (row.trim()) skipped.push(row);
      continue;
    }

    const quantityRaw = index.quantity !== undefined ? fields[index.quantity] : "1";
    const quantity = Number.parseInt(quantityRaw || "1", 10);

    const sectionRaw =
      index.section !== undefined ? fields[index.section]?.toLowerCase() : "";
    const mapped = sectionRaw ? SECTIONS[sectionRaw] : undefined;
    const section: Section =
      mapped && mapped !== "ignore" ? mapped : defaultSection;

    lines.push({
      raw: row,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      name,
      setCode: index.set !== undefined ? fields[index.set]?.toLowerCase() || undefined : undefined,
      collectorNumber:
        index.number !== undefined ? fields[index.number] || undefined : undefined,
      foil: index.foil !== undefined ? looksFoil(fields[index.foil]) || undefined : undefined,
      condition:
        index.condition !== undefined ? fields[index.condition] || undefined : undefined,
      section,
    });
  }

  return { lines, skipped, source: "csv" };
}

/* ---------- export ---------- */

export type ExportFormat = "text" | "arena" | "csv";

function csvCell(value: string | number | undefined | null): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function printingSuffix(card: Card): string {
  return `(${card.setCode.toUpperCase()}) ${card.collectorNumber}`;
}

const ZONE_HEADINGS: { zone: DeckEntry["zone"]; heading: string }[] = [
  { zone: "commander", heading: "Commander" },
  { zone: "main", heading: "Deck" },
  { zone: "side", heading: "Sideboard" },
  { zone: "maybe", heading: "Maybeboard" },
];

export function exportDeck(entries: DeckEntry[], format: ExportFormat): string {
  if (format === "csv") {
    const header = "Count,Name,Edition,Collector Number,Zone,Mana Value,Type";
    const rows = entries.map((e) =>
      [
        e.quantity,
        csvCell(e.card.name),
        csvCell(e.card.setCode.toUpperCase()),
        csvCell(e.card.collectorNumber),
        e.zone,
        e.card.cmc,
        csvCell(e.card.typeLine),
      ].join(","),
    );
    return [header, ...rows].join("\n");
  }

  const blocks: string[] = [];

  for (const { zone, heading } of ZONE_HEADINGS) {
    const inZone = entries.filter((e) => e.zone === zone);
    if (!inZone.length) continue;

    const body = inZone
      .slice()
      .sort((a, b) => a.card.name.localeCompare(b.card.name))
      .map((e) =>
        format === "arena"
          ? `${e.quantity} ${e.card.name} ${printingSuffix(e.card)}`
          : `${e.quantity} ${e.card.name}`,
      );

    blocks.push([heading, ...body].join("\n"));
  }

  return blocks.join("\n\n");
}

export function exportCollection(
  items: CollectionItem[],
  format: ExportFormat,
): string {
  if (format === "csv") {
    const header = "Count,Name,Edition,Collector Number,Foil,Condition";
    const rows = items.map((item) =>
      [
        item.quantity,
        csvCell(item.card.name),
        csvCell(item.card.setCode.toUpperCase()),
        csvCell(item.card.collectorNumber),
        item.finish === "nonfoil" ? "" : item.finish,
        csvCell(item.condition),
      ].join(","),
    );
    return [header, ...rows].join("\n");
  }

  return items
    .map((item) => {
      const suffix = format === "arena" ? ` ${printingSuffix(item.card)}` : "";
      const foil = item.finish !== "nonfoil" ? " *F*" : "";
      return `${item.quantity} ${item.card.name}${suffix}${foil}`;
    })
    .join("\n");
}
