import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { cardStore, execute, select } from "../db";
import { writeLab } from "./labdb";
import { loadV4 } from "./v4";
import { writeV4, type Sql } from "./v4db";
import { loadV5 } from "./v5";

const appSql: Sql = { select, execute };

interface Seed {
  path: string;
  text: string;
}

/** Version 5 says `version = 5`; schema 4 says `schema = 4`. */
const isVersion5 = (text: string) => /^\s*version\s*=\s*5\s*$/m.test(text);

/**
 * Load `DECKLAB_LAB_SEED` into the lab, before the UI reads it
 * (`src-tauri/src/lab.rs`). A seed replaces the lab's data: Rust deleted the
 * last `lab.db` already. Outside lab mode, without a seed, or on a reload of
 * a lab already seeded, it does nothing.
 *
 * A version 5 file goes into the new model's tables (`writeLab`), which
 * today's UI does not read yet; a schema 4 file into today's (`writeV4`).
 *
 * `loading` is told the file's path before the load starts, which can take
 * seconds when cards must be fetched. A file that fails to load is reported
 * and leaves the lab empty: load checks everything before its first write.
 * Never throws, so the UI always starts.
 */
export async function seedLab(loading: (path: string) => void): Promise<void> {
  let path = "the lab's library file";
  try {
    const seed = await invoke<Seed | null>("lab_seed");
    if (!seed) return;
    path = seed.path;
    loading(path);
    const summary = isVersion5(seed.text)
      ? await writeLab(appSql, await cardStore(), loadV5(seed.text))
      : await writeV4(appSql, loadV4(seed.text));
    console.info(`lab: loaded ${path}`, summary);
  } catch (err) {
    await message(`Could not load ${path}:\n\n${err instanceof Error ? err.message : String(err)}`, {
      title: "Lab",
      kind: "error",
    });
  }
}
