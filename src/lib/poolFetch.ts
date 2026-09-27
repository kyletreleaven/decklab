/**
 * When a pool must re-run its query.
 *
 * The drawn set is only ever one of two things, and they answer "does a write
 * change the rows?" differently:
 *
 * | drawn | a write changes the rows? | so |
 * | --- | --- | --- |
 * | All Magic, which contains every collection | no, only which are lit | never refetch |
 * | a collection | yes, the rows *are* its contents | refetch |
 *
 * Dimming is a separate, always-subscribed effect, so the first row still sees
 * the write. See `bugs/001`.
 */
export interface FetchInputs {
  drawn: "universe" | "collection";
  /** The collection read locally, when `drawn` is `"collection"`. */
  localSourceId: string | undefined;
  /** The effective filter, already serialised. */
  effectiveKey: string;
  sort: string;
  sortFlipped: boolean;
  /** App's mutation counter, bumped on every write. */
  refreshKey: number;
}

/**
 * The question a pool's rows answer, as a string.
 *
 * Serves as the fetch effect's *only* dependency and as the retention
 * signature, so the two cannot drift apart. Drift was a trap: a remount whose
 * retained signature matched would skip a fetch the effect should have made.
 *
 * `refreshKey` counts only while the list is local. A constant `0` otherwise,
 * because re-searching Scryfall on every `+` is exactly the traffic the
 * scheduler exists to avoid, and it would learn nothing.
 */
export function fetchSignature({
  drawn,
  localSourceId,
  effectiveKey,
  sort,
  sortFlipped,
  refreshKey,
}: FetchInputs): string {
  return JSON.stringify([
    localSourceId,
    drawn,
    effectiveKey,
    sort,
    sortFlipped,
    drawn === "collection" ? refreshKey : 0,
  ]);
}
