import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { execute, select } from "../db";
import { loadV4 } from "./v4";
import { writeV4, type Sql } from "./v4db";

const appSql: Sql = { select, execute };

interface Seed {
  path: string;
  text: string;
}

/**
 * Load `DECKLAB_LAB_SEED` into the new, empty lab, before the UI reads it
 * (`src-tauri/src/lab.rs`). Outside lab mode, without a seed, or on a reload
 * of a lab already seeded, it does nothing.
 *
 * `loading` is told the file's path before the load starts, which can take
 * seconds when printings must be fetched. A file that fails to load is
 * reported and leaves the lab empty: load checks everything before its first
 * write. Never throws, so the UI always starts.
 */
export async function seedLab(loading: (path: string) => void): Promise<void> {
  let path = "the lab's library file";
  try {
    const seed = await invoke<Seed | null>("lab_seed");
    if (!seed) return;
    path = seed.path;
    loading(path);
    const summary = await writeV4(appSql, loadV4(seed.text));
    console.info(`lab: loaded ${path}`, summary);
  } catch (err) {
    await message(`Could not load ${path}:\n\n${err instanceof Error ? err.message : String(err)}`, {
      title: "Lab",
      kind: "error",
    });
  }
}
