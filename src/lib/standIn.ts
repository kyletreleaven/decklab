import type { Sql } from "./sql";

/**
 * Which printing to draw for a card whose bucket names none: the stand-in.
 * See docs/inventory.md → *Rendering an `absent` printing or finish*.
 *
 * A chain of layers, tried in order; each answers for the cards it can and
 * leaves the rest to the next. Printing selectors will be layers here. Until
 * they exist the chain is Scryfall's layer alone, which always answers for a
 * card the store has. Display only: nothing here changes a bucket.
 */
export type Layer = (oracleIds: string[]) => Promise<Map<string, string>>;

/** Each card's stand-in printing id, from the first layer that answers. */
export async function standIns(layers: Layer[], oracleIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let left = [...new Set(oracleIds)];
  for (const layer of layers) {
    if (!left.length) break;
    for (const [oracle, printing] of await layer(left)) out.set(oracle, printing);
    left = left.filter((o) => !out.has(o));
  }
  return out;
}

const CHUNK = 400;
const holes = (n: number) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(", ");

/**
 * Scryfall's pick: the printing it last gave as the card, at any age, or else
 * the newest English paper printing the store has, or else any it has.
 */
export function scryfallLayer(store: Sql): Layer {
  return async (oracleIds) => {
    const out = new Map<string, string>();
    for (let i = 0; i < oracleIds.length; i += CHUNK) {
      const chunk = oracleIds.slice(i, i + CHUNK);
      const rows = await store.select<{ oracle_id: string; id: string }>(
        `SELECT oracle_id, COALESCE(
                  (SELECT d.printing_id FROM default_printings d
                     JOIN cards p ON p.id = d.printing_id
                    WHERE d.oracle_id = o.oracle_id),
                  (SELECT c.id FROM cards c
                    WHERE c.oracle_id = o.oracle_id
                    ORDER BY COALESCE(json_extract(c.data, '$.lang'), 'en') = 'en' DESC,
                             c.digital ASC, c.released_at DESC, c.id
                    LIMIT 1)) AS id
           FROM (SELECT DISTINCT oracle_id FROM cards WHERE oracle_id IN (${holes(chunk.length)})) o`,
        chunk,
      );
      for (const r of rows) if (r.id) out.set(r.oracle_id, r.id);
    }
    return out;
  };
}
