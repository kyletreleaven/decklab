import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { message, open, save } from "@tauri-apps/plugin-dialog";
import { execute, select } from "../db";
import { dumpV4, loadV4 } from "./v4";
import { isEmpty, readV4, writeV4, type Sql } from "./v4db";

const appSql: Sql = { select, execute };

const TITLE = "Library";
const FILTERS = [{ name: "DeckLab library", extensions: ["toml"] }];

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

async function failed(err: unknown): Promise<void> {
  await message(err instanceof Error ? err.message : String(err), {
    title: TITLE,
    kind: "error",
  });
}

async function exportLibrary(): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const path = await save({ defaultPath: `decklab-library-${day}.toml`, filters: FILTERS });
    if (!path) return;

    const lib = await readV4(appSql);
    await invoke("write_text_file", { path, contents: dumpV4(lib) });
    await message(
      `Exported ${plural(lib.collections.length, "collection")} and ` +
        `${plural(lib.decks.length, "deck")} to ${path}`,
      { title: TITLE },
    );
  } catch (err) {
    await failed(err);
  }
}

/**
 * Load a library file. Only into an empty database for now — that is the
 * lab's case — so an import can never overwrite what is already here.
 */
async function importLibrary(): Promise<void> {
  try {
    if (!(await isEmpty(appSql))) {
      await message(
        "Import Library loads into an empty database only, so it cannot " +
          "overwrite what is here. This one already has collections or decks.",
        { title: TITLE, kind: "warning" },
      );
      return;
    }

    const path = await open({ multiple: false, directory: false, filters: FILTERS });
    if (!path) return;

    const text = await invoke<string>("read_text_file", { path });
    const summary = await writeV4(appSql, loadV4(text));
    await message(
      `Imported ${plural(summary.collections, "collection")} ` +
        `(${plural(summary.items, "line")}) and ${plural(summary.decks, "deck")} ` +
        `(${plural(summary.deckCards, "line")}, ${plural(summary.piles, "pile")})` +
        (summary.fetched ? `, fetching ${plural(summary.fetched, "printing")}.` : "."),
      { title: TITLE },
    );
    // Every panel read its lists at mount; starting over is the simple refresh.
    window.location.reload();
  } catch (err) {
    await failed(err);
  }
}

/**
 * Answer File → Export Library… and Import Library….
 *
 * Call once, at module level, for the same reason as `startApiBridge`.
 */
export async function startLibraryMenu(): Promise<void> {
  await listen("library-export", () => void exportLibrary());
  await listen("library-import", () => void importLibrary());
}
