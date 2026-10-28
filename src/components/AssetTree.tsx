import { useEffect, useRef, useState, type ReactNode } from "react";
import { CREATABLE, type AssetNode, type Creatable } from "../lib/assets";
import type { AssetType } from "../lib/ontology";

/** A glyph per type, so a place and a deck tell apart at a glance. */
const GLYPH: Record<AssetType, string> = {
  folder: "",
  checklist: "☐",
  place: "▤",
  pool: "◌",
  "list pool": "◌",
  "query pool": "◌",
  decklist: "◇",
  deck: "◆",
  arrangement: "≡",
};

const LABEL: Record<Creatable, string> = {
  folder: "folder",
  place: "place",
  checklist: "checklist",
  "list pool": "pool",
  decklist: "decklist",
  deck: "deck",
};

/** What opening an asset shows: places and decks have views; the rest not yet. */
export const OPENABLE: ReadonlySet<AssetType> = new Set(["place", "decklist", "deck", "checklist"]);

/** Where the menu is, and what it is for: an asset, or the top of the tree. */
interface Menu {
  x: number;
  y: number;
  node: AssetNode | null;
}

/**
 * The lab's asset tree (docs/inventory.md → *The asset tree*): the section's
 * header, `children` (All Magic, built in), then the tree. Folders and
 * anything with children expand; top-level folders start open.
 *
 * Right-click an asset, or `+` for the top, for a menu: new child, rename,
 * delete. The edits themselves are the caller's; a new asset comes back by
 * id and opens for renaming.
 */
export function AssetTree({
  nodes,
  activeId,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  children,
}: {
  nodes: AssetNode[];
  activeId: string | null;
  onOpen: (node: AssetNode) => void;
  /** Creates under `parent` (null: the top); resolves to the new id. */
  onCreate: (parent: AssetNode | null, type: Creatable) => Promise<string | null>;
  onRename: (node: AssetNode, name: string) => Promise<void>;
  onDelete: (node: AssetNode) => Promise<void>;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(nodes.filter((n) => n.type === "folder").map((n) => n.id)),
  );
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // A menu closes on a click elsewhere, Escape, or the window losing focus.
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    const blur = () => setMenu(null);
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", blur);
    };
  }, [menu]);

  const create = async (parent: AssetNode | null, type: Creatable) => {
    setMenu(null);
    const id = await onCreate(parent, type);
    if (!id) return;
    if (parent) setOpen((s) => new Set(s).add(parent.id));
    setRenaming(id);
  };

  const commitRename = async (node: AssetNode, name: string) => {
    setRenaming(null);
    if (name !== node.name) await onRename(node, name);
  };

  const rows = (list: AssetNode[], depth: number): ReactNode[] =>
    list.flatMap((n) => {
      const expandable = n.children.length > 0;
      const isOpen = open.has(n.id);
      const openable = OPENABLE.has(n.type);
      const row = (
        <button
          key={n.id}
          className={`nav-item asset-row ${activeId === n.id ? "active" : ""} ${openable ? "" : "inert"} ${
            menu?.node?.id === n.id ? "menu-open" : ""
          }`}
          style={{ paddingLeft: 8 + depth * 12 }}
          title={`/${n.path.join("/")} — ${n.type}`}
          onClick={() => {
            if (renaming === n.id) return;
            if (openable) onOpen(n);
            else if (expandable) toggle(n.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, node: n });
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
          {renaming === n.id ? (
            <input
              className="asset-rename"
              autoFocus
              defaultValue={n.name}
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                // A button would take Space and Enter as clicks.
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  e.currentTarget.value = n.name;
                  e.currentTarget.blur();
                }
              }}
              onKeyUp={(e) => e.preventDefault()}
              onBlur={(e) => void commitRename(n, e.currentTarget.value)}
            />
          ) : (
            <span className="name">{n.name}</span>
          )}
        </button>
      );
      return expandable && isOpen ? [row, ...rows(n.children, depth + 1)] : [row];
    });

  return (
    <>
      <div className="nav-header">
        <span>Assets</span>
        <button
          className="ghost"
          style={{ padding: "0 6px" }}
          title="New asset at the top"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom + 2, node: null });
          }}
        >
          +
        </button>
      </div>
      {children}
      {nodes.length === 0 && <div className="nav-empty">No assets yet.</div>}
      {rows(nodes, 0)}
      {menu && (
        <div ref={menuRef} className="context-menu" style={{ left: menu.x, top: menu.y }} role="menu">
          {CREATABLE.map((type) => (
            <button key={type} role="menuitem" onClick={() => void create(menu.node, type)}>
              New {LABEL[type]}
            </button>
          ))}
          {menu.node && (
            <>
              <div className="context-menu-divider" />
              <button
                role="menuitem"
                onClick={() => {
                  setRenaming(menu.node!.id);
                  setMenu(null);
                }}
              >
                Rename
              </button>
              <button
                role="menuitem"
                className="danger"
                onClick={() => {
                  const node = menu.node!;
                  setMenu(null);
                  void onDelete(node);
                }}
              >
                Delete…
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
