/**
 * Re-pointing deck entries at printings you actually hold.
 *
 * A deck entry names a *printing*, so a deck imported from elsewhere asks for
 * whichever printing that list happened to name — and you may own the same card
 * three times over in other sets. This works out which entries could be
 * satisfied by swapping the printing, without changing what the deck plays.
 *
 * Allocation, not a lookup: two entries of the same card compete for the same
 * copies, and a printing already spoken for by one is not available to another.
 */

export interface DeckDemand {
  entryId: string;
  /** The printing the deck currently names. */
  cardId: string;
  oracleId: string;
  quantity: number;
}

export interface CollectionSupply {
  cardId: string;
  oracleId: string;
  quantity: number;
}

/** Move `quantity` of an entry from one printing to another. */
export interface Rebind {
  entryId: string;
  fromCardId: string;
  toCardId: string;
  quantity: number;
}

/**
 * Work out which entries can be satisfied by a printing you hold.
 *
 * Entries keep what they can of their own printing first — a deck that already
 * names cards you own should not be shuffled around — and only the shortfall
 * looks elsewhere.
 *
 * **Best effort.** A shortfall it cannot cover is left alone rather than
 * abandoned — an entry asking for four with two available binds those two.
 *
 * Greedy is also *optimal* for that: within one oracle every copy satisfies
 * every demand, so the number bound is `min(supply, demand)` whatever order the
 * entries are visited in. There is nothing to be cleverer about.
 *
 * Never over-allocates: each copy is handed out once, so running it twice
 * changes nothing the second time.
 */
export function planRebind(
  demands: readonly DeckDemand[],
  supply: readonly CollectionSupply[],
): Rebind[] {
  /** Copies still unspoken for, by printing. */
  const free = new Map<string, number>();
  /** Printings of each oracle that the collection holds, in a stable order. */
  const byOracle = new Map<string, string[]>();

  for (const row of supply) {
    if (row.quantity <= 0) continue;
    free.set(row.cardId, (free.get(row.cardId) ?? 0) + row.quantity);
    const list = byOracle.get(row.oracleId) ?? [];
    if (!list.includes(row.cardId)) list.push(row.cardId);
    byOracle.set(row.oracleId, list);
  }

  // Claim exact matches first, across *all* entries, before anything reaches
  // for a substitute. Doing it entry by entry would let an early entry take a
  // printing that a later one could only have satisfied exactly.
  const shortfall = new Map<string, number>();
  for (const demand of demands) {
    const exact = Math.min(demand.quantity, free.get(demand.cardId) ?? 0);
    if (exact > 0) free.set(demand.cardId, (free.get(demand.cardId) ?? 0) - exact);
    if (exact < demand.quantity) shortfall.set(demand.entryId, demand.quantity - exact);
  }

  const rebinds: Rebind[] = [];

  for (const demand of demands) {
    let wanted = shortfall.get(demand.entryId) ?? 0;
    if (wanted === 0) continue;

    for (const candidate of byOracle.get(demand.oracleId) ?? []) {
      if (wanted === 0) break;
      if (candidate === demand.cardId) continue;

      const available = free.get(candidate) ?? 0;
      if (available <= 0) continue;

      const taken = Math.min(wanted, available);
      free.set(candidate, available - taken);
      wanted -= taken;

      rebinds.push({
        entryId: demand.entryId,
        fromCardId: demand.cardId,
        toCardId: candidate,
        quantity: taken,
      });
    }
  }

  return rebinds;
}
