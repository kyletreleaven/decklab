import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { Card } from "./types";

/**
 * Card images are downloaded by the Rust side into the app data directory and
 * served back through Tauri's asset protocol. Keeping the download in Rust
 * means image bytes never cross the JS bridge, and the files survive restarts
 * so a cached card renders offline.
 */

/** Remote URL -> local asset URL, so a failed cache attempt can fall back. */
const resolved = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

async function cacheOne(key: string, url: string): Promise<string | null> {
  const existing = resolved.get(key);
  if (existing) return existing;

  const pending = inflight.get(key);
  if (pending) return pending;

  const task = invoke<string>("cache_card_image", { key, url })
    .then((path) => {
      const asset = convertFileSrc(path);
      resolved.set(key, asset);
      return asset;
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, task);
  return task;
}

export type ImageSize = "small" | "normal";

/**
 * Which side of a double-faced card to show.
 *
 * Not a rotation: transform, MDFC and battle cards carry a separate image per
 * face. Split and aftermath cards do *not* — one image holds both halves — so
 * they have no back and this stays "front".
 */
export type Face = "front" | "back";

/**
 * The back face's image, when the card has one.
 *
 * Read from the raw payload rather than a column: `normalize()` flattens to the
 * front face, and every cached card already carries `card_faces` in `data`, so
 * this needs neither a migration nor a refetch.
 *
 * Keyed on the face having its *own* `image_uris`. Meld cards get this right
 * for free — their back is a genuinely separate card, so there are no
 * `card_faces` at all.
 */
export function backUrl(card: Card, size: ImageSize): string | null {
  const faces = (card.data as { card_faces?: { image_uris?: Record<string, string> }[] })
    .card_faces;
  return faces?.[1]?.image_uris?.[size] ?? null;
}

export function hasBack(card: Card): boolean {
  return backUrl(card, "normal") !== null || backUrl(card, "small") !== null;
}

function remoteUrl(card: Card, size: ImageSize, face: Face): string | null {
  if (face === "back") return backUrl(card, size);
  return size === "small" ? card.imageSmall : card.imageNormal;
}

/**
 * Resolve a displayable image URL for a card, preferring the local cache.
 * Returns the remote URL immediately if the card has not been cached yet, so
 * the grid never blocks on downloads.
 */
export function imageUrl(
  card: Card,
  size: ImageSize = "small",
  face: Face = "front",
): string | null {
  const remote = remoteUrl(card, size, face);
  if (!remote) return null;
  return resolved.get(cacheKey(card, size, face)) ?? remote;
}

// The back is a different image under the same card id, so it needs its own
// key or the two would overwrite each other in the resolved map.
function cacheKey(card: Card, size: ImageSize, face: Face): string {
  return face === "back" ? `${card.id}-back-${size}` : `${card.id}-${size}`;
}

/** Kick off caching for a card image; resolves to the local asset URL. */
export function ensureCached(
  card: Card,
  size: ImageSize = "small",
  face: Face = "front",
): Promise<string | null> {
  const remote = remoteUrl(card, size, face);
  if (!remote) return Promise.resolve(null);
  return cacheOne(cacheKey(card, size, face), remote);
}
