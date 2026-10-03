import { describe, expect, it } from "vitest";
import { scryfallPages } from "./printings";
import type { Card } from "./types";

function card(data: Record<string, unknown>): Card {
  return { oracleId: "abc-123", setCode: "lea", collectorNumber: "232", data } as unknown as Card;
}

describe("scryfallPages", () => {
  it("uses the payload's own printing and set pages", () => {
    const printing = "https://scryfall.com/card/lea/232/black-lotus?utm_source=api";
    const set = "https://scryfall.com/sets/lea?utm_source=api";
    const pages = scryfallPages(card({ scryfall_uri: printing, scryfall_set_uri: set }));
    expect(pages.printing).toBe(printing);
    expect(pages.set).toBe(set);
  });

  it("falls back to set code and collector number", () => {
    const pages = scryfallPages(card({}));
    expect(pages.printing).toBe("https://scryfall.com/card/lea/232");
    expect(pages.set).toBe("https://scryfall.com/sets/lea");
  });

  it("links the card to every printing, not a redirect to one", () => {
    expect(scryfallPages(card({})).card).toBe(
      "https://scryfall.com/search?q=oracleid%3Aabc-123&unique=prints",
    );
  });
});
