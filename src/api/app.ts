import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { HTTPException } from "hono/http-exception";
import { listDecks } from "../lib/decks";

/**
 * The agent API, as a Fetch-standard Hono app.
 *
 * Nothing here knows about Tauri: `bridge.ts` feeds it requests forwarded from
 * Rust, and a headless backend could serve the same app directly. The token
 * check lives here rather than in Rust for the same reason — it moves with the
 * routes. `token` is asked for on every request, so a rotation takes effect
 * immediately; `null` means the API is off and nothing gets in. Every route is
 * behind it: a web page can send requests to localhost
 * but never sees the token, so a route that skips the check is one a page can
 * use.
 */
export function createApp(token: () => Promise<string | null>) {
  const app = new Hono();

  app.use(
    "*",
    bearerAuth({ verifyToken: async (given) => given === (await token()) }),
  );

  // Middleware signals refusals (a bad token is a 401) by throwing; only
  // anything else is our failure.
  app.onError((err, c) =>
    err instanceof HTTPException ? err.getResponse() : c.json({ error: err.message }, 500),
  );

  app.get("/decks", async (c) => c.json(await listDecks()));

  return app;
}
