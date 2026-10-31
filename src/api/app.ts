import { Hono, type Context } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { HTTPException } from "hono/http-exception";
import { listDecks } from "../lib/decks";
import type { Sql } from "../lib/sql";
import guide from "../../docs/agents/using-the-api.md?raw";
import { assetAt, LabApiError, poolFromJson, poolFromText, putPool, tree } from "./lab";

/**
 * The lab's databases, when the app runs in lab mode: the lab's own and the
 * card store. `onWrite` is told after every write, so the app can read again.
 */
export interface LabAccess {
  open: () => Promise<{ lab: Sql; cards: Sql } | null>;
  onWrite?: () => void;
}

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
export function createApp(token: () => Promise<string | null>, labAccess?: LabAccess) {
  const app = new Hono();

  app.use(
    "*",
    bearerAuth({ verifyToken: async (given) => given === (await token()) }),
  );

  // Middleware signals refusals (a bad token is a 401) by throwing; only
  // anything else is our failure.
  app.onError((err, c) =>
    err instanceof HTTPException
      ? err.getResponse()
      : err instanceof LabApiError
        ? c.json({ error: err.message }, err.status)
        : c.json({ error: err.message }, 500),
  );

  app.get("/decks", async (c) => c.json(await listDecks()));

  // How to use all this, for an agent with no copy of the repo: the guide,
  // bundled, so it matches the running app.
  app.get("/guide", (c) => c.body(guide, 200, { "Content-Type": "text/markdown; charset=utf-8" }));

  // The lab's assets, by path (docs/agent-api.md → *Lab routes*). Lab mode only.
  const lab = async () => {
    const open = await labAccess?.open();
    if (!open) throw new LabApiError("The lab routes answer only when the app runs in lab mode (npm run lab).", 404);
    return open;
  };
  /** The asset path a `/lab/assets/…` URL names: its segments, decoded. */
  const pathOf = (c: Context) =>
    c.req
      .path.slice("/lab/assets".length)
      .split("/")
      .filter((s) => s !== "")
      .map((s) => decodeURIComponent(s));

  app.get("/lab/tree", async (c) => c.json(await tree((await lab()).lab)));

  app.get("/lab/assets/*", async (c) => {
    const { lab: sql, cards } = await lab();
    return c.json(await assetAt(sql, cards, pathOf(c)));
  });

  app.put("/lab/assets/*", async (c) => {
    const { lab: sql, cards } = await lab();
    const text = await c.req.text();
    let body;
    if ((c.req.header("content-type") ?? "").startsWith("text/plain")) body = poolFromText(text);
    else {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new LabApiError("The body is not JSON. Send a decklist as Content-Type: text/plain.", 400);
      }
      body = poolFromJson(json);
    }
    const result = await putPool(sql, cards, pathOf(c), body);
    labAccess?.onWrite?.();
    return c.json(result, result.created ? 201 : 200);
  });

  return app;
}
