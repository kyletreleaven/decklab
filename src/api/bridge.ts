import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createApp } from "./app";

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
  const app = createApp(() => invoke<string | null>("api_token"));

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
