import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CardDetail } from "./components/CardDetail";
import { DeckView } from "./components/DeckView";
import { ExportDialog } from "./components/ExportDialog";
import { ImportDialog, type ImportTarget } from "./components/ImportDialog";
import { ManaCost } from "./components/ManaCost";
import { PoolPanel, type Scope } from "./components/PoolPanel";
import { SplitPane } from "./components/SplitPane";
import * as collectionsApi from "./lib/collections";
import { UNIVERSE_ID, UNIVERSE_NAME } from "./lib/collections";
import { forgetPanel } from "./lib/panelState";
import { COLLECTION_KINDS } from "./lib/collections";
import { commanderIdentityOf } from "./lib/deckstats";
import { exportCollection, exportDeck, type ExportFormat } from "./lib/decklist";
import * as decksApi from "./lib/decks";
import type {
  Card,
  Collection,
  CollectionKind,
  Deck,
  DeckEntry,
} from "./lib/types";

type View =
  | { kind: "deck"; id: string }
  | { kind: "collection"; id: string };

/**
 * One entry per deck or collection you have touched, most recent first.
 *
 * A single ordered list rather than separate slots, because the question that
 * matters is "the last deck *or* collection" — which a pair of slots cannot
 * answer without an extra discriminator, and this answers by construction.
 * Opening a deck therefore no longer evicts the active collection, which is
 * what makes the carousel's +/- unambiguous while deckbuilding.
 */
interface Touched {
  kind: "deck" | "collection";
  id: string;
  name: string;
}

/**
 * Whether cards can be put into an entry.
 *
 * Derived rather than stored: every deck and every stored collection is
 * writable, and the only thing that is not is All Magic, which is a synthetic
 * source rather than a `collections` row. This becomes a real field when a
 * *stored* collection wants locking — an imported reference binder — which is a
 * separate feature.
 *
 * Named now because `target` has to ask a question rather than take `touched[0]`
 * on faith: aiming a bare `+` at the universe has no coherent behaviour, since
 * there is nowhere to put the card.
 */
function isWritable(entry: Touched): boolean {
  return !isUniverse(entry);
}

function isUniverse(entry: Touched): boolean {
  return entry.kind === "collection" && entry.id === UNIVERSE_ID;
}

/**
 * Marks a sidebar entry as the active deck or collection, and marks the overall
 * most-recent one more strongly.
 *
 * Two levels rather than one, because they answer different questions: the ring
 * says "this is where deck/collection operations land", while the filled dot
 * says "this is the one a bare + would use". They coincide most of the time and
 * diverge exactly when it matters — with a deck open, the active collection is
 * still marked even though it is not on screen.
 */
function SlotDot({
  active,
  target,
  what,
  onTarget,
}: {
  active: boolean;
  target: boolean;
  what: "deck" | "collection";
  /** Retarget without navigating — the visible counterpart to ⌥-click. */
  onTarget: () => void;
}) {
  // Always rendered, so the row does not reflow when the state changes. CSS
  // hides it until the row is hovered unless it is already active.
  return (
    <span
      className={[
        "slot-dot",
        active ? "active" : "",
        target ? "target" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      // A nested <button> would be invalid inside the row's own button, so this
      // is a span that swallows the click rather than letting it navigate.
      onClick={(e) => {
        e.stopPropagation();
        onTarget();
      }}
      title={
        target
          ? `Active ${what} — and the most recent, so a bare + lands here`
          : `Make this the active ${what} without opening it`
      }
    />
  );
}

const PEEK_KEY = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌥" : "Alt";

/**
 * Opening a sidebar entry does two separable things — retarget, and navigate —
 * and each gesture covers one cell:
 *
 *     click        both
 *     click a dot  retarget only, staying where you are
 *     alt-click    navigate only, keeping the current target
 *
 * The last is for peeking at another deck without losing what you are building
 * against. Alt rather than ⌘ because Option means "a variant of the normal
 * action", and because ⌘-click means *extend the selection* — a meaning we will
 * want literally once ownership scope becomes the union of several selected
 * collections. Ctrl is avoided too: on macOS it is a secondary click.
 */
/** Where the app opens, and where it falls back after a delete. */
const UNIVERSE_VIEW = { kind: "collection", id: UNIVERSE_ID } as const;

function navigatesOnly(event: React.MouseEvent): boolean {
  return event.altKey;
}

export default function App() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [view, setView] = useState<View>(UNIVERSE_VIEW);
  const [touched, setTouched] = useState<Touched[]>([]);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [hoveredCard, setHoveredCard] = useState<Card | null>(null);
  const hoverClear = useRef<number | null>(null);
  const [entries, setEntries] = useState<DeckEntry[]>([]);
  const [dialog, setDialog] = useState<"deck" | "collection" | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftKind, setDraftKind] = useState<CollectionKind>("paper");
  const [error, setError] = useState<string | null>(null);
  const [showPool, setShowPool] = useState(false);
  const [importTarget, setImportTarget] = useState<ImportTarget | null>(null);
  const [exportState, setExportState] = useState<{
    title: string;
    filenameBase: string;
    render: (format: ExportFormat) => string;
  } | null>(null);

  // Bumped whenever collection contents change, so views recompute ownership
  // and owned-copy counts without threading callbacks everywhere.
  const [refreshKey, setRefreshKey] = useState(0);

  /**
   * The printing each card is currently *standing for*, by oracle id.
   *
   * Lives here because two surfaces have to agree on it: the card panel picks
   * it, and the pool renders and writes it. Only meaningful at oracle grain —
   * a collection row already is a specific printing, so it ignores this.
   *
   * Empty by default: with no choice made, each surface falls back to the
   * printing its own stream produced.
   */
  const [activePrintings, setActivePrintings] = useState<Record<string, Card>>({});
  const bump = useCallback(() => setRefreshKey((n) => n + 1), []);

  const reloadDecks = useCallback(async () => {
    setDecks(await decksApi.listDecks());
  }, []);

  const reloadCollections = useCallback(async () => {
    setCollections(await collectionsApi.listCollections());
  }, []);

  useEffect(() => {
    Promise.all([reloadDecks(), reloadCollections()]).catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [reloadDecks, reloadCollections]);

  const currentDeck =
    view.kind === "deck" ? (decks.find((d) => d.id === view.id) ?? null) : null;
  const currentCollection =
    view.kind === "collection"
      ? (collections.find((c) => c.id === view.id) ?? null)
      : null;

  /**
   * All Magic has no row in the `collections` table, so the usual lookup above
   * finds nothing and it has to resolve on its own.
   */
  const viewingUniverse = view.kind === "collection" && view.id === UNIVERSE_ID;

  const reloadEntries = useCallback(async (deckId: string) => {
    setEntries(await decksApi.deckEntries(deckId));
  }, []);

  useEffect(() => {
    if (currentDeck) reloadEntries(currentDeck.id);
    else setEntries([]);
  }, [currentDeck?.id, reloadEntries]);

  /**
   * Hover previews a card without disturbing the selection:
   *
   *     shown = hovered ?? selected ?? empty
   *
   * The panel re-renders immediately, since the card object is already in hand
   * from the grid. Only the queries and fetches keyed off it cost anything, and
   * the scheduler collapses those — a sweep across a grid leaves one request
   * standing rather than one per card.
   */
  const hoverCard = useCallback((card: Card | null) => {
    if (hoverClear.current !== null) {
      clearTimeout(hoverClear.current);
      hoverClear.current = null;
    }

    if (card) {
      setHoveredCard(card);
      return;
    }

    // Moving between adjacent cards fires leave-then-enter as two separate
    // events, which React does not batch — clearing immediately would flash the
    // selected card in between. A short grace period makes the handover seamless.
    hoverClear.current = window.setTimeout(() => setHoveredCard(null), 80);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverClear.current !== null) clearTimeout(hoverClear.current);
    };
  }, []);

  /** What the card panel describes: the hovered card, else the selected one. */
  const shownCard = hoveredCard ?? selectedCard;

  /** Move an entry to the front, or add it. Also refreshes a renamed entry. */
  const touch = useCallback((entry: Touched) => {
    setTouched((prev) => [
      entry,
      ...prev.filter((t) => !(t.kind === entry.kind && t.id === entry.id)),
    ]);
  }, []);

  const forget = useCallback((kind: Touched["kind"], id: string) => {
    setTouched((prev) => prev.filter((t) => !(t.kind === kind && t.id === id)));
  }, []);

  // Everything is derived from the one ordered list.
  const activeDeck = touched.find((t) => t.kind === "deck") ?? null;
  // The set the pool dims against. Any card set will do — dimming is a set
  // difference, not a claim about ownership — so this needs no predicate.
  const activeCollection = touched.find((t) => t.kind === "collection") ?? null;
  // Most recently touched thing you can actually add to — so viewing a
  // read-only source leaves + pointed where it was, rather than at nothing.
  const target = touched.find(isWritable) ?? null;

  function openDeck(deck: Deck, event?: React.MouseEvent) {
    if (!event || !navigatesOnly(event)) {
      touch({ kind: "deck", id: deck.id, name: deck.name });
    }
    setView({ kind: "deck", id: deck.id });
  }

  function openCollection(collection: Collection, event?: React.MouseEvent) {
    if (!event || !navigatesOnly(event)) {
      touch({ kind: "collection", id: collection.id, name: collection.name });
    }
    setView({ kind: "collection", id: collection.id });
  }

  async function addToDeck(card: Card, deckId: string, asCommander: boolean) {
    await decksApi.addCardToDeck(deckId, card, 1, asCommander ? "commander" : "main");
    await reloadDecks();
    if (view.kind === "deck" && view.id === deckId) await reloadEntries(deckId);
    // Reloading entries only refreshes the deck *view*; the card panel's counts
    // are keyed on refreshKey, so without this they stay stale.
    bump();
  }

  async function addToCollection(card: Card, collectionId: string) {
    await collectionsApi.addCardToCollection(collectionId, card, 1);
    await reloadCollections();
    bump();
  }

  async function addToTarget(card: Card) {
    if (!target) return;
    if (target.kind === "deck") await addToDeck(card, target.id, false);
    else await addToCollection(card, target.id);
  }

  async function adjustDeck(deckId: string, card: Card, delta: number) {
    // Maindeck is the default zone. Which zone the +/- writes to is a separate
    // question, and it depends on how zones get modelled.
    await decksApi.adjustDeckQuantity(deckId, card, delta, "main");
    await reloadDecks();
    if (view.kind === "deck" && view.id === deckId) await reloadEntries(deckId);
    bump();
  }

  async function adjustTarget(card: Card, delta: number) {
    if (!target) return;
    if (target.kind === "deck") await adjustDeck(target.id, card, delta);
    else {
      await collectionsApi.adjustCollectionQuantity(target.id, card, delta);
      await reloadCollections();
      bump();
    }
  }

  async function createThing() {
    const name = draftName.trim();
    if (!name || !dialog) return;

    if (dialog === "deck") {
      const deck = await decksApi.createDeck(name);
      await reloadDecks();
      openDeck(deck);
    } else {
      const collection = await collectionsApi.createCollection(name, draftKind);
      await reloadCollections();
      openCollection(collection);
    }

    setDialog(null);
    setDraftName("");
    setDraftKind("paper");
  }

  /**
   * The commander identity of the *active* deck — which may not be the one on
   * screen, since the pool scopes itself by what you last touched.
   *
   * Read from `entries` when they are the same deck, and only queried when they
   * differ, so the common case costs nothing. Null means the commander zone is
   * empty, which is different from a colourless commander.
   */
  const [remoteIdentity, setRemoteIdentity] = useState<string | null>(null);

  useEffect(() => {
    if (!activeDeck || activeDeck.id === currentDeck?.id) {
      setRemoteIdentity(null);
      return;
    }
    let alive = true;
    decksApi.commanderIdentity(activeDeck.id).then((identity) => {
      if (alive) setRemoteIdentity(identity);
    });
    return () => {
      alive = false;
    };
  }, [activeDeck?.id, currentDeck?.id, refreshKey]);

  /**
   * What the active deck constrains, as *independent* toggles.
   *
   * Two rather than one bundled switch: format legality and colour identity are
   * orthogonal, and fusing them makes two useful questions unaskable — banned
   * cards inside your colours, and legal cards outside them when weighing a
   * splash.
   *
   * Keyed off the *active* deck rather than the displayed one, so they survive
   * navigating away — exactly when you are browsing for cards to add.
   */
  const deckScopes = useMemo<Scope[]>(() => {
    if (!activeDeck) return [];
    const deck = decks.find((d) => d.id === activeDeck.id);
    if (!deck) return [];

    const scopes: Scope[] = [
      {
        key: "format",
        label: `Legal in ${deck.format}`,
        title: `Only cards legal in ${deck.format}`,
        filter: { legalIn: deck.format },
      },
    ];

    const identity =
      activeDeck.id === currentDeck?.id
        ? commanderIdentityOf(entries)
        : remoteIdentity;

    // Only once a commander exists: with an empty zone there is nothing to
    // restrict to, and restricting to colourless would hide almost everything.
    if (deck.format === "commander" && identity !== null) {
      scopes.push({
        key: "identity",
        // Shown as symbols rather than the deck's name, because the constraint
        // is about colours.
        label: identity ? (
          <ManaCost cost={[...identity].map((c) => `{${c}}`).join("")} />
        ) : (
          "Colourless"
        ),
        title: `Only cards within ${deck.name}'s colour identity`,
        filter: { withinIdentity: identity },
      });
    }

    return scopes;
  }, [activeDeck, decks, currentDeck?.id, entries, remoteIdentity]);

  /**
   * Per-printing counts of the shown card in each active slot.
   *
   * Both are fetched regardless of which one is the target, because the panel
   * lists both — you want to see that a card is in your deck *and* how many you
   * hold, not just whichever you touched last.
   */
  const [deckQuantities, setDeckQuantities] = useState<Record<string, number>>({});
  const [collectionQuantities, setCollectionQuantities] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    const oracleId = shownCard?.oracleId;
    if (!activeDeck || !oracleId) {
      setDeckQuantities({});
      return;
    }
    let active = true;
    decksApi.printingQuantitiesInDeck(activeDeck.id, oracleId).then((rows) => {
      if (active) setDeckQuantities(rows);
    });
    return () => {
      active = false;
    };
  }, [activeDeck?.id, shownCard?.oracleId, refreshKey]);

  useEffect(() => {
    const oracleId = shownCard?.oracleId;
    if (!activeCollection || !oracleId) {
      setCollectionQuantities({});
      return;
    }
    let active = true;
    collectionsApi
      .printingQuantitiesInCollection(activeCollection.id, oracleId)
      .then((rows) => {
        if (active) setCollectionQuantities(rows);
      });
    return () => {
      active = false;
    };
  }, [activeCollection?.id, shownCard?.oracleId, refreshKey]);

  /**
   * Contents of the deck under the pool, and of the current target — one query
   * each, so a grid of results costs no per-card lookups.
   */
  const [deckContents, setDeckContents] = useState<Record<string, number>>({});
  const [targetContents, setTargetContents] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!currentDeck) {
      setDeckContents({});
      return;
    }
    let alive = true;
    decksApi.deckQuantitiesByPrinting(currentDeck.id).then((rows) => {
      if (alive) setDeckContents(rows);
    });
    return () => {
      alive = false;
    };
  }, [currentDeck?.id, refreshKey]);

  useEffect(() => {
    if (!target) {
      setTargetContents({});
      return;
    }
    let alive = true;
    const load =
      target.kind === "deck"
        ? decksApi.deckQuantitiesByPrinting(target.id)
        : collectionsApi.collectionQuantitiesByPrinting(target.id);
    load.then((rows) => {
      if (alive) setTargetContents(rows);
    });
    return () => {
      alive = false;
    };
  }, [target?.kind, target?.id, refreshKey]);

  /** Put the candidate-card pool above a deck view when the pool is showing. */
  function withPool(node: ReactNode): ReactNode {
    if (!showPool || !currentDeck) return node;
    return (
      <SplitPane
        storageKey="decklab.deck-pool-split"
        defaultRatio={0.5}
        top={
          <PoolPanel
            // Remount per deck, like the collection view: the retained slot is
            // read once at mount, so switching decks without remounting would
            // seed the new pool from the previous deck's results.
            key={currentDeck.id}
            selectedId={selectedCard?.id ?? null}
            onSelect={setSelectedCard}
            onHoverCard={hoverCard}
            stateKey={`deck-pool:${currentDeck.id}`}
            destination={{
              name: currentDeck.name,
              quantities: deckContents,
              add: (card) => addToDeck(card, currentDeck.id, false),
              remove: (card) => adjustDeck(currentDeck.id, card, -1),
            }}
            activeCollection={activeCollection}
            scopes={deckScopes}
            refreshKey={refreshKey}
            activePrintings={activePrintings}
            compact
          />
        }
        bottom={node}
      />
    );
  }

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">DECKLAB</div>


        <div className="nav-section">
          <div className="nav-header">
            <span>Decks</span>
            <button
              className="ghost"
              style={{ padding: "0 6px" }}
              title="New deck"
              onClick={() => {
                setDialog("deck");
                setDraftName("");
              }}
            >
              +
            </button>
          </div>
          {decks.length === 0 && <div className="nav-empty">No decks yet.</div>}
          {decks.map((deck) => (
            <button
              key={deck.id}
              className={`nav-item ${
                view.kind === "deck" && view.id === deck.id ? "active" : ""
              }`}
              onClick={(e) => openDeck(deck, e)}
              title={`${deck.name} — ${PEEK_KEY}-click to open without retargeting`}
            >
              <span className="name">{deck.name}</span>
              <SlotDot
                active={activeDeck?.id === deck.id}
                target={target?.kind === "deck" && target.id === deck.id}
                what="deck"
                onTarget={() =>
                  touch({ kind: "deck", id: deck.id, name: deck.name })
                }
              />
            </button>
          ))}
        </div>

        <div className="nav-section">
          <div className="nav-header">
            <span>Collections</span>
            <button
              className="ghost"
              style={{ padding: "0 6px" }}
              title="New collection"
              onClick={() => {
                setDialog("collection");
                setDraftName("");
              }}
            >
              +
            </button>
          </div>
          {/* Pinned first: it is what every other collection is drawn from. */}
          <button
            className={`nav-item ${viewingUniverse ? "active" : ""}`}
            // Deliberately does not `touch`. Making the universe the active
            // collection would set it as the comparison set for dimming, and
            // that difference is empty — nothing would recede. Browsing all of
            // Magic while your own collection stays lit is the useful reading,
            // and it is what this view is for.
            onClick={() => setView({ kind: "collection", id: UNIVERSE_ID })}
            title={`${UNIVERSE_NAME} — every card that exists`}
          >
            <span className="name">{UNIVERSE_NAME}</span>
            <span className="count">∞</span>
          </button>

          <div className="nav-divider" />

          {collections.length === 0 && (
            <div className="nav-empty">No collections yet.</div>
          )}
          {collections.map((collection) => (
            <button
              key={collection.id}
              className={`nav-item ${
                view.kind === "collection" && view.id === collection.id ? "active" : ""
              }`}
              onClick={(e) => openCollection(collection, e)}
              title={`${collection.name} — ${PEEK_KEY}-click to open without retargeting`}
            >
              <span className="name">{collection.name}</span>
              <span className="count">{collection.kind}</span>
              <SlotDot
                active={activeCollection?.id === collection.id}
                target={
                  target?.kind === "collection" && target.id === collection.id
                }
                what="collection"
                onTarget={() =>
                  touch({
                    kind: "collection",
                    id: collection.id,
                    name: collection.name,
                  })
                }
              />
            </button>
          ))}
        </div>
      </nav>

      <main className="main">
        {error && <div className="status error">{error}</div>}

        {view.kind === "deck" && currentDeck && withPool(
          <DeckView
            deck={currentDeck}
            entries={entries}
            activeCollection={activeCollection}
            selectedCardId={selectedCard?.id ?? null}
            onSelectCard={setSelectedCard}
            onHoverCard={hoverCard}
            refreshKey={refreshKey}
            onChangeQuantity={async (entry, quantity) => {
              await decksApi.setDeckCardQuantity(entry.id, currentDeck.id, quantity);
              await reloadEntries(currentDeck.id);
              bump();
            }}
            onRemove={async (entry) => {
              await decksApi.removeDeckEntry(entry.id, currentDeck.id);
              await reloadEntries(currentDeck.id);
              bump();
            }}
            onSetZone={async (entry, zone) => {
              await decksApi.moveDeckEntry(entry.id, currentDeck.id, zone);
              await reloadEntries(currentDeck.id);
              bump();
            }}
            onRename={async (name) => {
              await decksApi.renameDeck(currentDeck.id, name);
              await reloadDecks();
              touch({ kind: "deck", id: currentDeck.id, name });
            }}
            onDelete={async () => {
              await decksApi.deleteDeck(currentDeck.id);
              await reloadDecks();
              forgetPanel(`deck-pool:${currentDeck.id}`);
              setView(UNIVERSE_VIEW);
              forget("deck", currentDeck.id);
            }}
            onAddCards={() => setView(UNIVERSE_VIEW)}
            onReloadEntries={() => reloadEntries(currentDeck.id)}
            onImport={() =>
              setImportTarget({
                kind: "deck",
                id: currentDeck.id,
                name: currentDeck.name,
              })
            }
            onExport={() =>
              setExportState({
                title: currentDeck.name,
                filenameBase: currentDeck.name,
                render: (format) => exportDeck(entries, format),
              })
            }
            poolOn={showPool}
            onTogglePool={() => setShowPool((v) => !v)}
          />,
        )}

        {viewingUniverse && (
          <PoolPanel
            key={UNIVERSE_ID}
            stateKey="universe"
            selectedId={selectedCard?.id ?? null}
            onSelect={setSelectedCard}
            onHoverCard={hoverCard}
            // No subject: nothing to rename, delete or import into. And the
            // destination is the target, exactly as in search — the universe is
            // where cards come *from*.
            destination={
              target
                ? {
                    name: target.name,
                    quantities: targetContents,
                    add: addToTarget,
                    remove: (card) => adjustTarget(card, -1),
                  }
                : null
            }
            // No comparison set: All Magic is the thing being shown, so there
            // is nothing to hold it against and nothing recedes. This also
            // removes the "Show not in …" toggle, since narrowing to a
            // collection would stop the view being what it claims to be.
            activeCollection={null}
            activePrintings={activePrintings}
            scopes={deckScopes}
            refreshKey={refreshKey}
          />
        )}

        {view.kind === "collection" && currentCollection && (
          <PoolPanel
            // Remount per collection: the panel derives its initial state from
            // the subject (collection-only by default), which an update alone
            // would not re-run.
            key={currentCollection.id}
            stateKey={`collection:${currentCollection.id}`}
            selectedId={selectedCard?.id ?? null}
            onSelect={setSelectedCard}
            onHoverCard={hoverCard}
            // The target, not the collection on screen. Opening a collection
            // normally touches it, so the two coincide — but alt-click opens
            // without retargeting, which is exactly how you browse someone
            // else's binder while `+` keeps filling your own.
            destination={
              target
                ? {
                    name: target.name,
                    quantities: targetContents,
                    add: addToTarget,
                    remove: (card) => adjustTarget(card, -1),
                  }
                : null
            }
            activeCollection={activeCollection}
            activePrintings={activePrintings}
            refreshKey={refreshKey}
            subject={{
              id: currentCollection.id,
              name: currentCollection.name,
              onSetItemQuantity: async (item, quantity) => {
                await collectionsApi.setCollectionItemQuantity(item.id, quantity);
                bump();
              },
              onRemoveItem: async (item) => {
                await collectionsApi.removeCollectionItem(item.id);
                bump();
              },
              onRename: async (name) => {
                await collectionsApi.renameCollection(currentCollection.id, name);
                await reloadCollections();
                touch({ kind: "collection", id: currentCollection.id, name });
              },
              onDelete: async () => {
                await collectionsApi.deleteCollection(currentCollection.id);
                await reloadCollections();
                forgetPanel(`collection:${currentCollection.id}`);
                setView(UNIVERSE_VIEW);
                forget("collection", currentCollection.id);
                bump();
              },
              onImport: () =>
                setImportTarget({
                  kind: "collection",
                  id: currentCollection.id,
                  name: currentCollection.name,
                }),
              onExport: async () => {
                // Export the whole collection, not whatever survived the
                // on-screen filter.
                const items = await collectionsApi.collectionItems(
                  currentCollection.id,
                );
                setExportState({
                  title: currentCollection.name,
                  filenameBase: currentCollection.name,
                  render: (format) => exportCollection(items, format),
                });
              },
            }}
          />
        )}

      </main>

      <CardDetail
        card={shownCard}
        onSetCommander={
          target?.kind === "deck" &&
          decks.find((d) => d.id === target.id)?.format === "commander"
            ? async (card) => {
                // Move rather than add: the old combo box inserted a second
                // entry, leaving the card held in two zones at once.
                await decksApi.setCommander(target.id, card);
                await reloadDecks();
                if (view.kind === "deck" && view.id === target.id) {
                  await reloadEntries(target.id);
                }
                bump();
              }
            : undefined
        }
        target={target}
        onTargetSlot={touch}
        activeDeck={activeDeck}
        deckQuantities={deckQuantities}
        activeCollection={activeCollection}
        collectionQuantities={collectionQuantities}
        onAdjustTarget={adjustTarget}
        onChoosePrinting={(printing) =>
          setActivePrintings((prev) => ({ ...prev, [printing.oracleId]: printing }))
        }
        refreshKey={refreshKey}
      />

      {importTarget && (
        <ImportDialog
          target={importTarget}
          onClose={() => setImportTarget(null)}
          onImported={async (added) => {
            const finished = importTarget;
            setImportTarget(null);
            if (finished.kind === "deck") {
              await reloadDecks();
              if (view.kind === "deck" && view.id === finished.id) {
                await reloadEntries(finished.id);
              }
            } else {
              await reloadCollections();
              bump();
            }
            setError(added ? null : "Nothing was imported.");
          }}
        />
      )}

      {exportState && (
        <ExportDialog
          title={exportState.title}
          filenameBase={exportState.filenameBase}
          render={exportState.render}
          onClose={() => setExportState(null)}
        />
      )}

      {dialog && (
        <div className="overlay" onClick={() => setDialog(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>New {dialog}</h3>
            <div className="field">
              <label>Name</label>
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createThing();
                  if (e.key === "Escape") setDialog(null);
                }}
                placeholder={
                  dialog === "deck" ? "Atraxa Superfriends" : "Paper collection"
                }
              />
            </div>

            {dialog === "collection" && (
              <div className="field">
                <label>Kind</label>
                <select
                  value={draftKind}
                  onChange={(e) => setDraftKind(e.target.value as CollectionKind)}
                >
                  {COLLECTION_KINDS.map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="actions">
              <button onClick={() => setDialog(null)}>Cancel</button>
              <button
                className="primary"
                onClick={createThing}
                disabled={!draftName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
