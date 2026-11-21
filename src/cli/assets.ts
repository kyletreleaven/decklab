import { formatPath, parsePath, PathError } from "../lib/paths";

/**
 * `decklab assets …`: assets as files, through the running app's agent API
 * (docs/agents/using-the-api.md). A thin client: it opens no database and
 * holds no rules of its own, so cards are resolved — and fetched, through
 * the app's channel — exactly as for any agent, and the app's screen
 * redraws after a write. The routes are the lab's for now; that is this
 * module's business, not the command's.
 */

export const ASSETS_USAGE = `  assets tree                     every asset: its path and type
  assets get <path> [file]        an asset, to file or standard output: as text
                                  for a .txt file or --text (a decklist), else JSON
  assets put <path> <file>        create or replace from a file: .txt is a decklist
                                  or list pool (what is there says which; --type
                                  for a new one), .json any body the API takes
  assets patch <path> <file>      change what is there, never replace it: add to a
                                  list pool the cards of a .txt, or a .json patch,
                                  {"add": [cards]}
  assets rm <path>                delete an asset and what is below it
  assets held <path> [file]       what a collection (place, sum, deck) holds, to file
                                  or standard output: as a decklist for a .txt file or
                                  --text, else JSON; --card for only those, --by-place
                                  for where (JSON only)
`;

/** What `assets` needs from outside, so a test can give it the API itself. */
export interface AssetsIo {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  base: string;
  token: string | undefined;
  readFile: (path: string) => string;
  writeFile: (path: string, text: string) => void;
  out: (text: string) => void;
}

export interface AssetsOptions {
  text?: boolean;
  type?: string;
  /** held: only these cards, by name. */
  cards?: string[];
  /** held: each card's count in each place. */
  byPlace?: boolean;
}

/** A mistake in the command line: exit 2, with usage. */
export class AssetsUsageError extends Error {}

/** The API said no, or did not answer: exit 1, with what it said. */
export class AssetsError extends Error {}

function pathUrl(base: string, text: string, route = "/lab/assets"): string {
  let names: string[];
  try {
    names = parsePath(text.startsWith("/") ? text : `/${text}`);
  } catch (e) {
    if (e instanceof PathError) throw new AssetsUsageError(e.message);
    throw e;
  }
  return `${base}${route}/${names.map(encodeURIComponent).join("/")}`;
}

interface TreeNode {
  path: string;
  type: string;
  children: TreeNode[];
}

/** Run `decklab assets <sub> …`. */
export async function assets(sub: string | undefined, args: string[], opts: AssetsOptions, io: AssetsIo): Promise<void> {
  if (!io.token) {
    throw new AssetsUsageError("no token: set DECKLAB_TOKEN, or pass --token (DeckLab → Tools → Agent API → Copy Token)");
  }
  const call = async (url: string, init: RequestInit = {}): Promise<Response> => {
    let res: Response;
    try {
      res = await io.fetch(url, { ...init, headers: { Authorization: `Bearer ${io.token}`, ...init.headers } });
    } catch {
      throw new AssetsError(
        `DeckLab's agent API is not answering at ${io.base}: is the app open, with Tools → Agent API → Enable?`,
      );
    }
    if (!res.ok) {
      const body = await res.text();
      let message = body;
      try {
        message = (JSON.parse(body) as { error?: string }).error ?? body;
      } catch {
        // Not JSON: say it as it came.
      }
      throw new AssetsError(`${res.status}: ${message}`);
    }
    return res;
  };
  const arity = (least: number, most: number, what: string) => {
    if (args.length < least || args.length > most) throw new AssetsUsageError(`assets ${sub} takes ${what}`);
  };

  switch (sub) {
    case "tree": {
      arity(0, 0, "nothing");
      const nodes = (await (await call(`${io.base}/lab/tree`)).json()) as TreeNode[];
      const lines: string[] = [];
      const walk = (ns: TreeNode[]) => {
        for (const n of ns) {
          lines.push(`${n.path}\t${n.type}`);
          walk(n.children);
        }
      };
      walk(nodes);
      io.out(lines.length ? `${lines.join("\n")}\n` : "");
      return;
    }
    case "get": {
      arity(1, 2, "a path, and optionally a file");
      const [path, file] = args;
      const asText = opts.text || (file?.endsWith(".txt") ?? false);
      const res = await call(pathUrl(io.base, path), { headers: { Accept: asText ? "text/plain" : "application/json" } });
      const text = asText ? await res.text() : `${JSON.stringify(await res.json(), null, 2)}\n`;
      if (file === undefined) io.out(text);
      else io.writeFile(file, text);
      return;
    }
    case "put": {
      arity(2, 2, "a path and a file");
      const [path, file] = args;
      const isText = file.endsWith(".txt");
      if (!isText && !file.endsWith(".json")) throw new AssetsUsageError("assets put takes a .txt or a .json file");
      if (opts.type !== undefined && !isText) throw new AssetsUsageError("--type is for a .txt file: a .json body says its own type");
      let body: string;
      try {
        body = io.readFile(file);
      } catch (e) {
        throw new AssetsError(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
      }
      const query = opts.type === undefined ? "" : `?type=${encodeURIComponent(opts.type)}`;
      const res = await call(`${pathUrl(io.base, path)}${query}`, {
        method: "PUT",
        headers: { "Content-Type": isText ? "text/plain" : "application/json" },
        body,
      });
      io.out(`${res.status === 201 ? "created" : "replaced"} ${formatPath(parsePath(path.startsWith("/") ? path : `/${path}`))}: ${await res.text()}\n`);
      return;
    }
    case "patch": {
      arity(2, 2, "a path and a file");
      const [path, file] = args;
      // Text is cards to add: the verb, not the body, says it replaces nothing.
      const isText = file.endsWith(".txt");
      if (!isText && !file.endsWith(".json")) throw new AssetsUsageError("assets patch takes a .txt or a .json file");
      let body: string;
      try {
        body = io.readFile(file);
      } catch (e) {
        throw new AssetsError(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
      }
      const res = await call(pathUrl(io.base, path), {
        method: "PATCH",
        headers: { "Content-Type": isText ? "text/plain" : "application/json" },
        body,
      });
      io.out(`patched ${formatPath(parsePath(path.startsWith("/") ? path : `/${path}`))}: ${await res.text()}\n`);
      return;
    }
    case "rm": {
      arity(1, 1, "a path");
      await call(pathUrl(io.base, args[0]), { method: "DELETE" });
      return;
    }
    case "held": {
      arity(1, 2, "a path, and optionally a file");
      const [path, file] = args;
      const asText = opts.text || (file?.endsWith(".txt") ?? false);
      // A decklist has nowhere to say where: places come as JSON.
      if (asText && opts.byPlace) throw new AssetsUsageError("--by-place is JSON only: a decklist has no places");
      const query = new URLSearchParams();
      for (const card of opts.cards ?? []) query.append("cards", card);
      if (opts.byPlace) query.set("by_place", "true");
      const qs = query.size ? `?${query}` : "";
      const held = (await (await call(`${pathUrl(io.base, path, "/lab/collections")}${qs}`)).json()) as {
        cards: { card: string; qty: number }[];
      };
      const text = asText
        ? held.cards.map((c) => `${c.qty} ${c.card}\n`).join("")
        : `${JSON.stringify(held, null, 2)}\n`;
      if (file === undefined) io.out(text);
      else io.writeFile(file, text);
      return;
    }
    default:
      throw new AssetsUsageError(
        sub === undefined ? "assets needs a command: tree, get, put, patch, rm or held" : `unknown assets command ${sub}`,
      );
  }
}
