/**
 * A card is dimmed when it is not in the active collection and "Show not in" is
 * checked. No active collection, or the box unchecked: nothing dims.
 */
export function isDimmed(
  oracleId: string,
  activeCollection: ReadonlySet<string> | null,
  showNotIn: boolean,
): boolean {
  return activeCollection !== null && showNotIn && !activeCollection.has(oracleId);
}
