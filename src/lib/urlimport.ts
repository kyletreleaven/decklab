import { fetch } from "@tauri-apps/plugin-http";
import { parseDecklist, type ParsedLine, type Section } from "./decklist";

/**
 * Import a decklist from a URL.
 *
 * Sites fall into three groups. Some publish a JSON API we can map precisely
 * (Archidekt hands back Scryfall printing ids). Some serve a plain-text export
 * at a stable URL, which needs no adapter at all — fetch it and hand the body
 * to the normal parser. And some actively block automated requests, where the
 * only honest answer is to say so and point at export-and-paste.
 */

export interface UrlImportResult {
  lines: ParsedLine[];
  deckName?: string;
  source: string;
}

export class UrlImportError extends Error {
  constructor(
    message: string,
    /** Shown as a follow-up hint in the dialog. */
    readonly hint?: string,
  ) {
    super(message);
    this.name = "UrlImportError";
  }
}

/* ---------- Archidekt ---------- */

interface ArchidektCard {
  quantity: number;
  categories?: string[];
  modifier?: string;
  card?: {
    uid?: string;
    collectorNumber?: string;
    edition?: { editioncode?: string };
    oracleCard?: { name?: string };
  };
}

/** Archidekt models zones as free-form categories rather than fixed boards. */
function archidektSection(categories: string[] | undefined): Section {
  const lowered = (categories ?? []).map((c) => c.toLowerCase());
  if (lowered.includes("commander")) return "commander";
  if (lowered.includes("sideboard")) return "side";
  if (lowered.includes("maybeboard")) return "maybe";
  return "main";
}

async function importArchidekt(deckId: string): Promise<UrlImportResult> {
  const response = await fetch(`https://archidekt.com/api/decks/${deckId}/`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new UrlImportError(
      `Archidekt returned ${response.status} for deck ${deckId}.`,
      response.status === 404
        ? "Check the URL, or make sure the deck is public."
        : undefined,
    );
  }

  const body = (await response.json()) as {
    name?: string;
    cards?: ArchidektCard[];
  };

  const lines: ParsedLine[] = (body.cards ?? []).flatMap((entry) => {
    const name = entry.card?.oracleCard?.name;
    if (!name) return [];
    return [
      {
        raw: `${entry.quantity} ${name}`,
        quantity: entry.quantity || 1,
        name,
        // The uid is a Scryfall printing id, so import keeps the exact printing.
        scryfallId: entry.card?.uid,
        setCode: entry.card?.edition?.editioncode?.toLowerCase(),
        collectorNumber: entry.card?.collectorNumber,
        foil: entry.modifier?.toLowerCase() === "foil" || undefined,
        section: archidektSection(entry.categories),
      },
    ];
  });

  return { lines, deckName: body.name, source: "Archidekt" };
}

/* ---------- generic ---------- */

/** Sites known to refuse automated requests, so we can fail with a real reason. */
const BLOCKED: { pattern: RegExp; name: string }[] = [
  { pattern: /(^|\.)moxfield\.com$/i, name: "Moxfield" },
];

async function importGeneric(url: URL): Promise<UrlImportResult> {
  const blocked = BLOCKED.find((b) => b.pattern.test(url.hostname));
  if (blocked) {
    throw new UrlImportError(
      `${blocked.name} blocks automated requests, so DeckLab cannot fetch this URL.`,
      `Open the deck on ${blocked.name}, use its export or download option to copy the list as text, then paste it on the Paste tab.`,
    );
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: "text/plain, text/csv, */*" },
  });

  if (!response.ok) {
    throw new UrlImportError(
      `That URL returned ${response.status}.`,
      "If the site requires a login or blocks bots, export the list and paste it instead.",
    );
  }

  const body = await response.text();

  // An HTML page is a deck *page*, not a deck *export* — parsing it would
  // produce nonsense entries, so say what went wrong instead.
  if (/^\s*<(!doctype|html)/i.test(body)) {
    throw new UrlImportError(
      "That URL returned a web page rather than a decklist.",
      "Look for an export or download link on the site and use that URL, or paste the list as text.",
    );
  }

  const parsed = parseDecklist(body);
  if (!parsed.lines.length) {
    throw new UrlImportError(
      "Nothing deck-shaped was found at that URL.",
      "Paste the list as text instead.",
    );
  }

  return { lines: parsed.lines, source: url.hostname };
}

export async function importFromUrl(raw: string): Promise<UrlImportResult> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UrlImportError("That does not look like a URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlImportError("Only http and https URLs can be imported.");
  }

  const archidekt = url.hostname.match(/(^|\.)archidekt\.com$/i)
    ? url.pathname.match(/\/decks\/(\d+)/)
    : null;

  if (archidekt) return importArchidekt(archidekt[1]);

  return importGeneric(url);
}
