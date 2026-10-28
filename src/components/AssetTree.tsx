import { useState } from "react";
import type { AssetNode } from "../lib/assets";
import type { AssetType } from "../lib/ontology";

/** A glyph per type, so a place and a deck tell apart at a glance. */
const GLYPH: Record<AssetType, string> = {
  folder: "",
  checklist: "☐",
  place: "▤",
  pool: "◌",
  "list pool": "◌",
  "query pool": "◌",
  deck: "◆",
  arrangement: "≡",
};

/** What opening an asset shows: places and decks have views; the rest not yet. */
export const OPENABLE: ReadonlySet<AssetType> = new Set(["place", "deck", "checklist"]);

/**
 * The lab's asset tree (docs/inventory.md → *The asset tree*), read-only.
 * Folders and anything with children expand; top-level folders start open.
 */
export function AssetTree({
  nodes,
  activeId,
  onOpen,
}: {
  nodes: AssetNode[];
  activeId: string | null;
  onOpen: (node: AssetNode) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(nodes.filter((n) => n.type === "folder").map((n) => n.id)),
  );
  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const rows = (list: AssetNode[], depth: number): React.ReactNode[] =>
    list.flatMap((n) => {
      const expandable = n.children.length > 0;
      const isOpen = open.has(n.id);
      const openable = OPENABLE.has(n.type);
      const row = (
        <button
          key={n.id}
          className={`nav-item asset-row ${activeId === n.id ? "active" : ""} ${openable ? "" : "inert"}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          title={`/${n.path.join("/")} — ${n.type}`}
          onClick={() => {
            if (openable) onOpen(n);
            else if (expandable) toggle(n.id);
          }}
        >
          <span
            className="twisty"
            onClick={(e) => {
              if (!expandable) return;
              e.stopPropagation();
              toggle(n.id);
            }}
          >
            {expandable ? (isOpen ? "▾" : "▸") : ""}
          </span>
          <span className="glyph">{GLYPH[n.type]}</span>
          <span className="name">{n.name}</span>
        </button>
      );
      return expandable && isOpen ? [row, ...rows(n.children, depth + 1)] : [row];
    });

  return <>{rows(nodes, 0)}</>;
}
