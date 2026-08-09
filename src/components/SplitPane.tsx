import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Two stacked panes with a draggable divider.
 *
 * Sizing is a percentage rather than pixels so the split survives window
 * resizing, and the ratio is remembered per `storageKey` so a layout persists
 * across restarts. Pointer events (not mouse events) so the drag keeps tracking
 * when the cursor leaves the divider.
 */
export function SplitPane({
  top,
  bottom,
  storageKey,
  defaultRatio = 0.45,
  minRatio = 0.15,
  maxRatio = 0.85,
}: {
  top: React.ReactNode;
  bottom: React.ReactNode;
  /** Remembers the ratio across sessions when provided. */
  storageKey?: string;
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const [ratio, setRatio] = useState(() => {
    if (!storageKey) return defaultRatio;
    const stored = Number.parseFloat(localStorage.getItem(storageKey) ?? "");
    return Number.isFinite(stored) ? stored : defaultRatio;
  });

  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, String(ratio));
  }, [storageKey, ratio]);

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const box = container.current?.getBoundingClientRect();
      if (!box || box.height === 0) return;
      const next = (event.clientY - box.top) / box.height;
      setRatio(Math.min(maxRatio, Math.max(minRatio, next)));
    },
    [minRatio, maxRatio],
  );

  useEffect(() => {
    if (!dragging) return;

    const stop = () => setDragging(false);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);

    // Without this the drag selects text and shows an I-beam over the panes.
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "row-resize";

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.cursor = previousCursor;
    };
  }, [dragging, onPointerMove]);

  return (
    <div className="split" ref={container}>
      <div className="split-pane" style={{ height: `${ratio * 100}%` }}>
        {top}
      </div>

      <div
        className={`split-divider ${dragging ? "dragging" : ""}`}
        onPointerDown={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDoubleClick={() => setRatio(defaultRatio)}
        title="Drag to resize · double-click to reset"
        role="separator"
        aria-orientation="horizontal"
      />

      <div className="split-pane grow">{bottom}</div>
    </div>
  );
}
