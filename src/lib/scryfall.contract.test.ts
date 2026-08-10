import { describe, expect, it } from "vitest";

/**
 * Contract tests for the Scryfall API.
 *
 * These exist mainly as **executable documentation** of the assumptions
 * `scryfall.ts` and the importer rely on. They hit the live network, so they are
 * skipped by default and only run when asked:
 *
 *     npm run test:contract
 *
 * Each test names what breaks if the assumption stops holding. When one fails,
 * the fix is usually in our code, not in the test.
 */

// Declared locally rather than pulling in @types/node, which would add Node
// globals to every file in a browser-targeted project for the sake of one flag.
declare const process: { env: Record<string, string | undefined> };

const ENABLED = !!process.env.SCRYFALL_CONTRACT;

const API = "https://api.scryfall.com";
const UA = "DeckLab/0.1.0 (contract tests)";

/** Scryfall asks for 50-100ms between requests. */
const GAP_MS = 120;

async function get(path: string): Promise<Response> {
  await new Promise((r) => setTimeout(r, GAP_MS));
  return fetch(`${API}${path}`, {
    headers: { Accept: "application/json", "User-Agent": UA },
  });
}

async function post(path: string, body: unknown): Promise<Response> {
  await new Promise((r) => setTimeout(r, GAP_MS));
  return fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify(body),
  });
}

/** Sol Ring — heavily reprinted, so a good probe for printing behaviour. */
const SOL_RING_ORACLE = "6ad8011d-3471-4369-9d68-b264cc027487";

describe.runIf(ENABLED)("scryfall contract", () => {
  describe("search", () => {
    it("404s an empty result set rather than returning zero rows", async () => {
      // scryfall.ts catches this and converts it to an empty page. Without the
      // catch, an ordinary "no matches" search surfaces as an error.
      const res = await get("/cards/search?q=name:zzzznotarealcard");
      expect(res.status).toBe(404);
    });

    it("accepts `oracleid:` as the printings-lookup prefix", async () => {
      // Not `oracle_id:`. The printings carousel is built on this.
      const res = await get(
        `/cards/search?q=oracleid:${SOL_RING_ORACLE}&unique=prints`,
      );
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.object).toBe("list");
      expect(body.total_cards).toBeGreaterThan(50);
    });

    it("returns several printings from the same set under unique=prints", async () => {
      // Variants (borderless, showcase, surge foil) share a set code, so the
      // carousel must label by collector number or they look like duplicates.
      const res = await get(
        `/cards/search?q=oracleid:${SOL_RING_ORACLE}&unique=prints`,
      );
      const body = await res.json();
      const perSet = new Map<string, number>();
      for (const card of body.data) {
        perSet.set(card.set, (perSet.get(card.set) ?? 0) + 1);
      }
      expect([...perSet.values()].some((n) => n > 1)).toBe(true);
    });

    it("distinguishes foil-only printings with a ★ collector number", async () => {
      // e.g. Warhammer 40k surge foils are separate printings sharing a base
      // collector number; `variantTraits()` leans on the single-finish signal.
      const res = await get(
        `/cards/search?q=oracleid:${SOL_RING_ORACLE}&unique=prints`,
      );
      const body = await res.json();
      const starred = body.data.filter((c: { collector_number: string }) =>
        c.collector_number.includes("★"),
      );
      expect(starred.length).toBeGreaterThan(0);
    });
  });

  describe("batching printings", () => {
    it("accepts several oracleid terms joined by or", async () => {
      // The basis for fetching print runs for a page of results in one request
      // instead of one request per card.
      const bolt = await (await get("/cards/named?exact=Lightning+Bolt")).json();
      const q = encodeURIComponent(
        `oracleid:${SOL_RING_ORACLE} or oracleid:${bolt.oracle_id}`,
      );

      const res = await get(`/cards/search?q=${q}&unique=prints`);
      expect(res.ok).toBe(true);
      const body = await res.json();

      const names = new Set(body.data.map((c: { name: string }) => c.name));
      expect(names.has("Sol Ring")).toBe(true);
      expect(names.has("Lightning Bolt")).toBe(true);
    });

    it("caps a page at 175 results and flags has_more", async () => {
      // The real constraint on batch size — NOT URL length. A batch of popular
      // cards averaging ~19 printings each overflows this and silently returns
      // only some of the requested cards, so batches must be sized against
      // expected printings or follow has_more.
      const res = await get("/cards/search?q=t:creature&unique=prints");
      const body = await res.json();

      expect(body.data.length).toBeLessThanOrEqual(175);
      expect(body.has_more).toBe(true);
      expect(body.next_page).toContain("page=2");
    });

    it("combines batching with CSV, which is how backfill should fetch", async () => {
      const bolt = await (await get("/cards/named?exact=Lightning+Bolt")).json();
      const q = encodeURIComponent(
        `oracleid:${SOL_RING_ORACLE} or oracleid:${bolt.oracle_id}`,
      );

      const res = await get(`/cards/search?q=${q}&unique=prints&format=csv`);
      expect(res.ok).toBe(true);

      const text = await res.text();
      const header = text.split("\n")[0];
      expect(header).toContain("scryfall_id");
      // Well under the JSON weight for the same rows.
      expect(text.length).toBeLessThan(200_000);
    });
  });

  describe("response formats", () => {
    it("serves CSV far more cheaply than JSON for the same query", async () => {
      // The basis for a lightweight printings index: ~20x smaller.
      const path = `/cards/search?q=oracleid:${SOL_RING_ORACLE}&unique=prints`;
      const json = await (await get(path)).text();
      const csv = await (await get(`${path}&format=csv`)).text();

      expect(csv.length).toBeLessThan(json.length / 5);
    });

    it("exposes the columns a printings index needs", async () => {
      const res = await get(
        `/cards/search?q=oracleid:${SOL_RING_ORACLE}&unique=prints&format=csv`,
      );
      const header = (await res.text()).split("\n")[0].split(",");

      for (const column of [
        "set",
        "collector_number",
        "rarity",
        "name",
        "image_uri",
        "scryfall_id",
      ]) {
        expect(header).toContain(column);
      }
    });

    it("does NOT provide set_name or frame data in CSV", async () => {
      // Documents the gap: set names come from /sets, and variant traits
      // (border_color, frame_effects, finishes) still need the full object.
      const res = await get(
        `/cards/search?q=oracleid:${SOL_RING_ORACLE}&unique=prints&format=csv`,
      );
      const header = (await res.text()).split("\n")[0].split(",");

      expect(header).not.toContain("set_name");
      expect(header).not.toContain("frame_effects");
      expect(header).not.toContain("finishes");
    });
  });

  describe("collection endpoint", () => {
    it("echoes unresolved identifiers in not_found", async () => {
      // The importer reports these as unmatched lines.
      const res = await post("/cards/collection", {
        identifiers: [{ name: "Sol Ring" }, { name: "Definitely Not A Real Card" }],
      });
      const body = await res.json();

      expect(body.data.map((c: { name: string }) => c.name)).toContain("Sol Ring");
      expect(body.not_found).toEqual([{ name: "Definitely Not A Real Card" }]);
    });

    it("resolves by set and collector number, preserving exact printings", async () => {
      // Import's first pass depends on this; without it every line would fall
      // back to a name lookup and lose the printing.
      const res = await post("/cards/collection", {
        identifiers: [{ set: "c21", collector_number: "263" }],
      });
      const body = await res.json();

      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe("Sol Ring");
      expect(body.data[0].set).toBe("c21");
    });

    it("rejects more than 75 identifiers", async () => {
      // Why the importer chunks. If this limit rises we can enlarge the batch.
      const res = await post("/cards/collection", {
        identifiers: Array.from({ length: 76 }, () => ({ name: "Sol Ring" })),
      });
      expect(res.ok).toBe(false);
    });
  });

  describe("card objects", () => {
    it("carries oracle_id, and image_uris with the sizes we render", async () => {
      const res = await get("/cards/named?exact=Sol+Ring");
      const card = await res.json();

      expect(card.oracle_id).toBeTruthy();
      for (const size of ["small", "normal", "large", "art_crop"]) {
        expect(card.image_uris[size]).toMatch(/^https:\/\//);
      }
    });

    it("puts images on faces rather than the card for double-faced layouts", async () => {
      // Why `normalize()` falls back to card_faces[0].image_uris.
      const res = await get("/cards/named?exact=Delver+of+Secrets+//+Insectile+Aberration");
      const card = await res.json();

      expect(card.image_uris).toBeUndefined();
      expect(card.card_faces[0].image_uris.normal).toMatch(/^https:\/\//);
    });

    it("does NOT embed a card's printings — only a pointer to them", async () => {
      // The carousel therefore always costs a second request. A card object is
      // ~5KB and carries no print run, so there is no "look up the card and get
      // its sets" shortcut, however much we might want one.
      const res = await get("/cards/named?exact=Sol+Ring");
      const card = await res.json();

      expect(card.printings).toBeUndefined();
      expect(card.prints).toBeUndefined();
      expect(card.sets).toBeUndefined();

      // What you get instead is a URL to run yourself.
      expect(card.prints_search_uri).toContain("oracleid");
      expect(card.prints_search_uri).toContain("unique=prints");
    });

    it("describes only its own printing on the card object", async () => {
      // set/set_name/collector_number are printing-level and describe *this*
      // printing, which is why the panel splits oracle from printing fields.
      const res = await get("/cards/named?exact=Sol+Ring");
      const card = await res.json();

      expect(typeof card.set).toBe("string");
      expect(typeof card.collector_number).toBe("string");
      expect(card.reprint).toBe(true);
    });

    it("is mostly URLs rather than card data", async () => {
      // Justifies not persisting the raw payload: we store `data` verbatim
      // today, and the great majority of those bytes are affiliate links,
      // API self-references and image URLs we can regenerate or ignore.
      // Ratios rather than absolute sizes, so new Scryfall fields do not break
      // this — the claim is about proportion, not bytes.
      const res = await get("/cards/named?exact=Sol+Ring");
      const card = await res.json();

      const bytes = (value: unknown) => JSON.stringify(value ?? null).length;
      const total = bytes(card);

      const urlHeavy =
        bytes(card.image_uris) +
        bytes(card.purchase_uris) +
        bytes(card.related_uris);

      const CORE = [
        "name",
        "mana_cost",
        "type_line",
        "oracle_text",
        "cmc",
        "colors",
        "color_identity",
        "power",
        "toughness",
        "rarity",
        "set",
        "collector_number",
        "released_at",
        "keywords",
      ];
      const core = CORE.reduce((sum, key) => sum + bytes(card[key]), 0);

      expect(total).toBeGreaterThan(3000);
      expect(urlHeavy / total).toBeGreaterThan(0.3);
      // The stuff we actually search and display is a rounding error.
      expect(core / total).toBeLessThan(0.15);
    });

    it("reports legalities per format as a flat string map", async () => {
      const res = await get("/cards/named?exact=Black+Lotus");
      const card = await res.json();

      expect(card.legalities.commander).toBe("banned");
      expect(card.legalities.vintage).toBe("restricted");
    });
  });

  describe("autocomplete", () => {
    it("returns a flat array of names under data", async () => {
      const res = await get("/cards/autocomplete?q=lightn");
      const body = await res.json();

      expect(Array.isArray(body.data)).toBe(true);
      expect(typeof body.data[0]).toBe("string");
    });
  });
});
