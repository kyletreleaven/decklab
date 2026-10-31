import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Every request to Scryfall goes through the channel (`scheduler.ts`): one
 * pace, one pause, shared by every DeckLab process. These tests fail when a
 * way out appears that does not. See bugs/005 and docs/card-fetching.md →
 * *One channel across processes*.
 *
 * They read the source rather than run it, so a new call site is caught the
 * moment it is written, before it ever sends anything.
 */

const ROOT = join(__dirname, "../..");

function sources(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path, exts));
    else if (exts.some((e) => name.endsWith(e)) && !/\.(test|contract\.test)\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

const frontend = sources(join(ROOT, "src"), [".ts", ".tsx"]).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, "utf8"),
}));
const rust = sources(join(ROOT, "src-tauri/src"), [".rs"]).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, "utf8"),
}));

/** The text with comments removed, so prose about `fetch(` does not count. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("every way out to Scryfall goes through the channel", () => {
  it("imports an HTTP client only where it is wrapped or kept off Scryfall", () => {
    const importers = frontend
      .filter((f) => code(f.text).includes("@tauri-apps/plugin-http"))
      .map((f) => f.path)
      .sort();
    expect(importers).toEqual(["src/lib/scryfall.ts", "src/lib/urlimport.ts"]);
  });

  it("calls the API's fetch only through scheduledFetch", () => {
    const scryfall = code(frontend.find((f) => f.path === "src/lib/scryfall.ts")!.text);
    expect(scryfall).toContain("scheduledFetch(fetch)");
    expect(scryfall.match(/(?<![\w.])fetch\(/g) ?? []).toHaveLength(0);
  });

  it("makes no request with the webview's own network APIs", () => {
    const offenders = frontend
      .filter((f) => f.path !== "src/lib/urlimport.ts" && f.path !== "src/cli/decklab.ts")
      .filter((f) => /(?<![\w.])fetch\(|XMLHttpRequest|new WebSocket|new EventSource/.test(code(f.text)))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("lets the CLI reach only the app on this machine, which fetches cards itself", () => {
    const source = frontend.find((f) => f.path === "src/cli/decklab.ts")!.text;
    const cli = code(source);
    // One fetch, inside the function that refuses anything but loopback.
    expect(cli.match(/(?<![\w.])fetch\(/g) ?? []).toHaveLength(1);
    // From the source as written: `code` would take `//` in the URL for a comment.
    expect(source).toContain('const LOOPBACK = "http://127.0.0.1:";');
    const guard = cli.indexOf("if (!url.startsWith(LOOPBACK)) throw");
    expect(guard).toBeGreaterThan(-1);
    expect(cli.indexOf("return fetch(url, init);")).toBeGreaterThan(guard);
    expect(cli).not.toMatch(/scryfall/i);
  });

  it("downloads images only from inside scheduledCall", () => {
    const callers = frontend.filter((f) => code(f.text).includes('"download_card_image"'));
    expect(callers.map((f) => f.path)).toEqual(["src/lib/images.ts"]);
    const images = code(callers[0].text);
    const call = images.indexOf("scheduledCall(");
    const download = images.indexOf('"download_card_image"');
    expect(call).toBeGreaterThan(-1);
    expect(download).toBeGreaterThan(call);
  });

  it("has exactly one HTTP request in Rust: the image download", () => {
    const clients = rust.flatMap((f) =>
      [...code(f.text).matchAll(/reqwest::Client::new\(\)/g)].map((m) => ({ f, at: m.index! })),
    );
    expect(clients).toHaveLength(1);
    const [{ f, at }] = clients;
    const text = code(f.text);
    const fn = text.lastIndexOf("async fn ", at);
    expect(text.slice(fn, fn + "async fn download_card_image".length)).toBe(
      "async fn download_card_image",
    );
  });
});

describe("the doors that could reach Scryfall stay shut", () => {
  it("never hands the webview a remote image URL", async () => {
    vi.resetModules();
    const { imageUrl } = await import("./images");
    const card = {
      id: "x",
      imageSmall: "https://cards.scryfall.io/small/front/x.jpg",
      imageNormal: "https://cards.scryfall.io/normal/front/x.jpg",
      data: {},
    } as never;
    expect(imageUrl(card, "small")).toBeNull();
    expect(imageUrl(card, "normal")).toBeNull();
  });

  it("refuses a pasted Scryfall link instead of fetching it", async () => {
    vi.resetModules();
    const fetch = vi.fn();
    vi.doMock("@tauri-apps/plugin-http", () => ({ fetch }));
    const { importFromUrl } = await import("./urlimport");

    for (const url of [
      "https://scryfall.com/@someone/decks/123",
      "https://api.scryfall.com/cards/search?q=sol",
      "https://cards.scryfall.io/large/front/x.jpg",
    ]) {
      await expect(importFromUrl(url)).rejects.toThrow(/Scryfall/);
    }
    expect(fetch).not.toHaveBeenCalled();
    vi.doUnmock("@tauri-apps/plugin-http");
  });
});
