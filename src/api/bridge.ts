import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cardStore, execute, processKind, select } from "../lib/db";
import { createApp } from "./app";

/** The page event an API write to the lab fires. */
export const LAB_CHANGED = "decklab:lab-changed";

/** One HTTP request as Rust forwards it (`ApiRequest` in `api.rs`). */
interface ApiRequest {
  id: number;
  method: string;
  url: string;
  headers: [string, string][];
  body: string | null;
}

/**
 * Answer the API requests Rust forwards to the webview.
 *
 * Call once, at module level: inside a component, StrictMode's double mount
 * would register a second listener. A duplicate is harmless — Rust takes the
 * first reply per id — but it does every request twice.
 */
export async function startApiBridge(): Promise<void> {
  const app = createApp(() => invoke<string | null>("api_token"), {
    // The lab routes, in lab mode only: then `db()` is `lab.db`.
    open: async () => ((await processKind()) === "lab" ? { lab: { select, execute }, cards: await cardStore() } : null),
    // The app reads its tree and open view again (`App.tsx`).
    onWrite: () => window.dispatchEvent(new Event(LAB_CHANGED)),
  });

  await listen<ApiRequest>("api-request", async ({ payload: req }) => {
    // The host is irrelevant: the router only reads path and query.
    const response = await app.fetch(
      new Request(new URL(req.url, "http://localhost"), {
        method: req.method,
        headers: req.headers,
        body: req.body ?? undefined,
      }),
    );
    await invoke("api_reply", {
      id: req.id,
      reply: {
        status: response.status,
        headers: [...response.headers],
        body: await response.text(),
      },
    });
  });
}
