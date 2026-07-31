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

function remoteUrl(card: Card, size: ImageSize): string | null {
  return size === "small" ? card.imageSmall : card.imageNormal;
}

/**
 * Resolve a displayable image URL for a card, preferring the local cache.
 * Returns the remote URL immediately if the card has not been cached yet, so
 * the grid never blocks on downloads.
 */
export function imageUrl(card: Card, size: ImageSize = "small"): string | null {
  const remote = remoteUrl(card, size);
  if (!remote) return null;
  return resolved.get(`${card.id}-${size}`) ?? remote;
}

/** Kick off caching for a card image; resolves to the local asset URL. */
export function ensureCached(
  card: Card,
  size: ImageSize = "small",
): Promise<string | null> {
  const remote = remoteUrl(card, size);
  if (!remote) return Promise.resolve(null);
  return cacheOne(`${card.id}-${size}`, remote);
}
