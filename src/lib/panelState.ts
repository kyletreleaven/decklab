import { useEffect, useState } from "react";

/**
 * Per-panel state that survives unmounting.
 *
 * Panels are conditionally rendered, so navigating away destroys them: search
 * for something, click a deck to add a card, come back to an empty box. The
 * alternative — keeping every visited panel mounted and hidden — costs a grid of
 * DOM per panel and re-queries all of them on every mutation, so state moves out
 * of the component instead of the component staying alive.
 *
 * Deliberately module state rather than storage: this is "where I was", which
 * should not outlive the process. Preferences that *should* persist across
 * launches are a separate concern.
 */
const store = new Map<string, Record<string, unknown>>();

export function retained(key: string): Record<string, unknown> {
  return store.get(key) ?? {};
}

export function retain(key: string, patch: Record<string, unknown>): void {
  store.set(key, { ...retained(key), ...patch });
}

/** Forget a panel — call when the thing it was showing is deleted. */
export function forgetPanel(key: string): void {
  store.delete(key);
}

/**
 * `useState`, but seeded from and written back to the panel's retained slot.
 *
 * The key is part of the identity: switching from one collection to another
 * with the same field name reads that collection's value, not the previous
 * one's.
 */
export function useRetained<T>(
  panelKey: string,
  field: string,
  initial: T | (() => T),
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const slot = retained(panelKey);
    if (field in slot) return slot[field] as T;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });

  useEffect(() => {
    retain(panelKey, { [field]: value });
  }, [panelKey, field, value]);

  return [value, setValue];
}
