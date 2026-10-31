import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CREATABLE, TARGETABLE, type AssetNode, type Creatable } from "../lib/assets";
import type { AssetType } from "../lib/ontology";
import { formatPath } from "../lib/paths";

/**
 * A glyph per type, so a place and a deck tell apart at a glance. A
 * checklist is one thing to the eye, exact or not: its view says which.
 */
const GLYPH: Record<AssetType, string> = {
  folder: "",
  collection: "",
  checklist: "☐",
  "exact checklist": "☐",
  place: "▤",
  sum: "▦",
  pool: "⌕",
  "list pool": "⌕",
  "query pool": "⌕",
  decklist: "◇",
  deck: "◆",
  arrangement: "≡",
};

const LABEL: Record<Creatable, string> = {
  folder: "folder",
  place: "place",
  // What users call a sum: Paper, the places it adds up.
  sum: "collection",
  checklist: "checklist",
  "list pool": "pool",
  decklist: "decklist",
};

/** What opening an asset shows: places and decks have views; the rest not yet. */
export const OPENABLE: ReadonlySet<AssetType> = new Set([
  "place",
  "sum",
  "decklist",
  "deck",
  "checklist",
  "exact checklist",
  "list pool",
  "query pool",
]);

/**
 * The menu's conversions: a folder to a collection (a sum) and back, a place
 * to a checklist, a checklist (either kind) to a place. Exact or not is the
 * checklist view's toggle.
 */
const CONVERT_TO: Partial<Record<AssetType, { to: AssetType; label: string }>> =
  {
    folder: { to: "sum", label: "Convert to collection" },
    sum: { to: "folder", label: "Convert to folder" },
    place: { to: "checklist", label: "Convert to checklist" },
    checklist: { to: "place", label: "Convert to place" },
    "exact checklist": { to: "place", label: "Convert to place" },
  };

/** Where the menu is, and what it is for: an asset, or the top of the tree. */
interface Menu {
  x: number;
  y: number;
  node: AssetNode | null;
}

/** Where a drag would land: an asset to become its child, or the top. */
type DropTarget = AssetNode | "top";

/** How long a drag rests on a closed row before it opens. */
const SPRING_MS = 600;

/**
 * The lab's asset tree (docs/inventory/asset-tree.md → *The asset tree*): the section's
 * header, `children` (All Magic, built in), then the tree. Folders and
 * anything with children expand; top-level folders start open. Siblings come
 * in name order: the tree has no order of its own.
 *
 * Right-click an asset, or `+` for the top, for a menu: new child, a new
 * deck from a decklist, converting a place or checklist, rename, delete. Drag an asset onto another to make it a child — any asset can hold
 * children — or onto the header to move it to the top. The edits themselves
 * are the caller's; a new asset comes back by id and opens for renaming.
 */
export function AssetTree({
  nodes,
  activeId,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onMove,
  onBuildDeck,
  onConvert,
  targetId,
  onTarget,
  children,
}: {
  nodes: AssetNode[];
  activeId: string | null;
  onOpen: (node: AssetNode) => void;
  /** Creates under `parent` (null: the top); resolves to the new id. */
  onCreate: (
    parent: AssetNode | null,
    type: Creatable,
  ) => Promise<string | null>;
  onRename: (node: AssetNode, name: string) => Promise<void>;
  onDelete: (node: AssetNode) => Promise<void>;
  /** Moves `node` under `parent` (null: the top). */
  onMove: (node: AssetNode, parent: AssetNode | null) => Promise<void>;
  /** Makes a deck building this decklist, as its child; resolves to the new id. */
  onBuildDeck: (decklist: AssetNode) => Promise<string | null>;
  /** Changes `node`'s type: lines kept, read anew. */
  onConvert: (node: AssetNode, to: AssetType) => Promise<void>;
  /** The asset `+` adds to, wherever you are: a list pool, for now. */
  targetId: string | null;
  /** Makes `node` the target (null: none). */
  onTarget: (node: AssetNode | null) => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(nodes.filter((n) => n.type === "folder").map((n) => n.id)),
  );
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<AssetNode | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const spring = useRef<{ id: string; timer: number } | null>(null);

  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // A menu stays on screen: one that would run off the bottom opens upward
  // from the click instead, one off the right edge opens to its left.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const gap = 4;
    const { width, height } = el.getBoundingClientRect();
    const fitsBelow = menu.y + height <= window.innerHeight - gap;
    const fitsRight = menu.x + width <= window.innerWidth - gap;
    el.style.top = `${Math.max(gap, fitsBelow ? menu.y : menu.y - height)}px`;
    el.style.left = `${Math.max(gap, fitsRight ? menu.x : menu.x - width)}px`;
  }, [menu]);

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

  /** After an asset is made under `parent`: show it, and open its name. */
  const created = (parent: AssetNode | null, id: string | null) => {
    if (!id) return;
    if (parent) setOpen((s) => new Set(s).add(parent.id));
    setRenaming(id);
  };

  const create = async (parent: AssetNode | null, type: Creatable) => {
    setMenu(null);
    created(parent, await onCreate(parent, type));
  };

  const buildDeck = async (decklist: AssetNode) => {
    setMenu(null);
    created(decklist, await onBuildDeck(decklist));
  };

  const commitRename = async (node: AssetNode, name: string) => {
    setRenaming(null);
    if (name !== node.name) await onRename(node, name);
  };

  /* ---------- dragging ---------- */

  const isUnder = (path: string[], ancestor: string[]) =>
    path.length >= ancestor.length && ancestor.every((n, i) => path[i] === n);

  /** Whether the dragged asset may land here: not on itself or below it, nor where it is. */
  const accepts = (target: DropTarget): boolean => {
    if (!dragging) return false;
    if (target === "top") return dragging.path.length > 1;
    if (isUnder(target.path, dragging.path)) return false;
    return target.path.join("/") !== dragging.path.slice(0, -1).join("/");
  };

  const stopSpring = () => {
    if (spring.current) window.clearTimeout(spring.current.timer);
    spring.current = null;
  };

  const endDrag = () => {
    stopSpring();
    setDragging(null);
    setOver(null);
  };

  const dropOn = (target: DropTarget) => {
    const node = dragging;
    const ok = accepts(target);
    endDrag();
    if (!node || !ok) return;
    if (target !== "top") setOpen((s) => new Set(s).add(target.id));
    void onMove(node, target === "top" ? null : target);
  };

  /** Drop-target handlers, for a row or the header. */
  const target = (t: DropTarget) => {
    const key = t === "top" ? "top" : t.id;
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!accepts(t)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (over !== key) setOver(key);
        // A closed row opens once the drag rests on it.
        if (
          t !== "top" &&
          t.children.length &&
          !open.has(t.id) &&
          spring.current?.id !== t.id
        ) {
          stopSpring();
          spring.current = {
            id: t.id,
            timer: window.setTimeout(
              () => setOpen((s) => new Set(s).add(t.id)),
              SPRING_MS,
            ),
          };
        }
      },
      onDragLeave: (e: React.DragEvent) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        if (over === key) setOver(null);
        if (spring.current?.id === key) stopSpring();
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        dropOn(t);
      },
    };
  };

  const rows = (list: AssetNode[], depth: number): ReactNode[] =>
    list.flatMap((n) => {
      const expandable = n.children.length > 0;
      const isOpen = open.has(n.id);
      const openable = OPENABLE.has(n.type);
      const activate = () => {
        if (renaming === n.id) return;
        if (openable) onOpen(n);
        else if (expandable) toggle(n.id);
      };
      const row = (
        <div
          key={n.id}
          role="treeitem"
          tabIndex={0}
          aria-expanded={expandable ? isOpen : undefined}
          className={[
            "nav-item",
            "asset-row",
            activeId === n.id && "active",
            !openable && "inert",
            menu?.node?.id === n.id && "menu-open",
            dragging?.id === n.id && "dragging",
            over === n.id && "drop-into",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{ paddingLeft: 8 + depth * 12 }}
          title={`/${n.path.join("/")} — ${n.type}`}
          draggable={renaming !== n.id}
          onDragStart={(e) => {
            setMenu(null);
            setDragging(n);
            e.dataTransfer.effectAllowed = "move";
            // Firefox refuses to start a drag without payload on the transfer.
            e.dataTransfer.setData("text/plain", n.path.join("/"));
          }}
          onDragEnd={endDrag}
          {...target(n)}
          onClick={activate}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              activate();
            }
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
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  e.currentTarget.value = n.name;
                  e.currentTarget.blur();
                }
              }}
              onBlur={(e) => void commitRename(n, e.currentTarget.value)}
            />
          ) : (
            <span className="name">{n.name}</span>
          )}
          {targetId === n.id && (
            <span
              className="slot-dot target"
              title={`The target: + adds to `}
            />
          )}
        </div>
      );
      return expandable && isOpen
        ? [row, ...rows(n.children, depth + 1)]
        : [row];
    });

  return (
    <>
      <div
        className={`nav-header ${over === "top" ? "drop-into" : ""}`}
        {...target("top")}
      >
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
      <div role="tree">{rows(nodes, 0)}</div>
      {menu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          {CREATABLE.map((type) => (
            <button
              key={type}
              role="menuitem"
              onClick={() => void create(menu.node, type)}
            >
              New {LABEL[type]}
            </button>
          ))}
          {menu.node?.type === "decklist" && (
            <>
              <div className="context-menu-divider" />
              <button
                role="menuitem"
                onClick={() => void buildDeck(menu.node!)}
              >
                New deck from this decklist
              </button>
            </>
          )}
          {menu.node && TARGETABLE.has(menu.node.type) && (
            <>
              <div className="context-menu-divider" />
              <button
                role="menuitem"
                onClick={() => {
                  const node = menu.node!;
                  setMenu(null);
                  onTarget(targetId === node.id ? null : node);
                }}
              >
                {targetId === menu.node.id ? "Stop targeting" : "Set as target"}
              </button>
            </>
          )}
          {menu.node && CONVERT_TO[menu.node.type] && (
            <>
              <div className="context-menu-divider" />
              <button
                role="menuitem"
                onClick={() => {
                  const node = menu.node!;
                  setMenu(null);
                  void onConvert(node, CONVERT_TO[node.type]!.to);
                }}
              >
                {CONVERT_TO[menu.node.type]!.label}
              </button>
            </>
          )}
          {menu.node && (
            <>
              <div className="context-menu-divider" />
              <button
                role="menuitem"
                onClick={() => {
                  // As the library file and the agent API write it, quoting and all.
                  const path = formatPath(menu.node!.path);
                  setMenu(null);
                  void writeText(path);
                }}
              >
                Copy path
              </button>
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
