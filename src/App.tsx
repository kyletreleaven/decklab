import { useCallback, useEffect, useState } from "react";
import { CardDetail } from "./components/CardDetail";
import { CardSearch } from "./components/CardSearch";
import { CollectionView } from "./components/CollectionView";
import { DeckView } from "./components/DeckView";
import * as collectionsApi from "./lib/collections";
import { COLLECTION_KINDS } from "./lib/collections";
import * as decksApi from "./lib/decks";
import type {
  Card,
  Collection,
  CollectionItem,
  CollectionKind,
  Deck,
  DeckEntry,
} from "./lib/types";

type View =
  | { kind: "search" }
  | { kind: "deck"; id: string }
  | { kind: "collection"; id: string };

/** Where the search view's "+" button sends cards. */
type Target =
  | { kind: "deck"; id: string; name: string }
  | { kind: "collection"; id: string; name: string }
  | null;

export default function App() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [view, setView] = useState<View>({ kind: "search" });
  const [target, setTarget] = useState<Target>(null);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [entries, setEntries] = useState<DeckEntry[]>([]);
  const [dialog, setDialog] = useState<"deck" | "collection" | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftKind, setDraftKind] = useState<CollectionKind>("paper");
  const [error, setError] = useState<string | null>(null);

  // Bumped whenever collection contents change, so views recompute ownership
  // and owned-copy counts without threading callbacks everywhere.
  const [refreshKey, setRefreshKey] = useState(0);
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

  const reloadEntries = useCallback(async (deckId: string) => {
    setEntries(await decksApi.deckEntries(deckId));
  }, []);

  useEffect(() => {
    if (currentDeck) reloadEntries(currentDeck.id);
    else setEntries([]);
  }, [currentDeck?.id, reloadEntries]);

  function openDeck(deck: Deck) {
    setView({ kind: "deck", id: deck.id });
    setTarget({ kind: "deck", id: deck.id, name: deck.name });
  }

  function openCollection(collection: Collection) {
    setView({ kind: "collection", id: collection.id });
    setTarget({ kind: "collection", id: collection.id, name: collection.name });
  }

  async function addToDeck(card: Card, deckId: string, asCommander: boolean) {
    await decksApi.addCardToDeck(deckId, card, 1, asCommander ? "commander" : "main");
    await reloadDecks();
    if (view.kind === "deck" && view.id === deckId) await reloadEntries(deckId);
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

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">DECKLAB</div>

        <div className="nav-section">
          <button
            className={`nav-item ${view.kind === "search" ? "active" : ""}`}
            onClick={() => setView({ kind: "search" })}
          >
            <span>Card search</span>
          </button>
        </div>

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
              onClick={() => openDeck(deck)}
            >
              <span className="name">{deck.name}</span>
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
          {collections.length === 0 && (
            <div className="nav-empty">No collections yet.</div>
          )}
          {collections.map((collection) => (
            <button
              key={collection.id}
              className={`nav-item ${
                view.kind === "collection" && view.id === collection.id ? "active" : ""
              }`}
              onClick={() => openCollection(collection)}
            >
              <span className="name">{collection.name}</span>
              <span className="count">{collection.kind}</span>
            </button>
          ))}
        </div>
      </nav>

      <main className="main">
        {error && <div className="status error">{error}</div>}

        {view.kind === "search" && (
          <>
            {target && (
              <div className="status">
                Adding to <strong>{target.name}</strong>{" "}
                <button
                  className="ghost"
                  style={{ padding: "1px 6px" }}
                  onClick={() => setTarget(null)}
                >
                  clear
                </button>
              </div>
            )}
            <CardSearch
              selectedId={selectedCard?.id ?? null}
              onSelect={setSelectedCard}
              onAdd={target ? addToTarget : undefined}
              addLabel={target ? `Add to ${target.name}` : undefined}
            />
          </>
        )}

        {view.kind === "deck" && currentDeck && (
          <DeckView
            deck={currentDeck}
            entries={entries}
            collections={collections}
            selectedCardId={selectedCard?.id ?? null}
            onSelectCard={setSelectedCard}
            refreshKey={refreshKey}
            onChangeQuantity={async (entry, quantity) => {
              await decksApi.setDeckCardQuantity(entry.id, currentDeck.id, quantity);
              await reloadEntries(currentDeck.id);
            }}
            onRemove={async (entry) => {
              await decksApi.removeDeckEntry(entry.id, currentDeck.id);
              await reloadEntries(currentDeck.id);
            }}
            onSetZone={async (entry, zone) => {
              await decksApi.moveDeckEntry(entry.id, currentDeck.id, zone);
              await reloadEntries(currentDeck.id);
            }}
            onRename={async (name) => {
              await decksApi.renameDeck(currentDeck.id, name);
              await reloadDecks();
              setTarget({ kind: "deck", id: currentDeck.id, name });
            }}
            onDelete={async () => {
              await decksApi.deleteDeck(currentDeck.id);
              await reloadDecks();
              setView({ kind: "search" });
              setTarget(null);
            }}
            onAddCards={() => setView({ kind: "search" })}
            onReloadEntries={() => reloadEntries(currentDeck.id)}
          />
        )}

        {view.kind === "collection" && currentCollection && (
          <CollectionView
            collection={currentCollection}
            selectedCardId={selectedCard?.id ?? null}
            onSelectCard={setSelectedCard}
            refreshKey={refreshKey}
            onChangeQuantity={async (item: CollectionItem, quantity: number) => {
              await collectionsApi.setCollectionItemQuantity(item.id, quantity);
              bump();
            }}
            onRemove={async (item: CollectionItem) => {
              await collectionsApi.removeCollectionItem(item.id);
              bump();
            }}
            onRename={async (name) => {
              await collectionsApi.renameCollection(currentCollection.id, name);
              await reloadCollections();
              setTarget({ kind: "collection", id: currentCollection.id, name });
            }}
            onDelete={async () => {
              await collectionsApi.deleteCollection(currentCollection.id);
              await reloadCollections();
              setView({ kind: "search" });
              setTarget(null);
              bump();
            }}
            onAddCards={() => setView({ kind: "search" })}
          />
        )}
      </main>

      <CardDetail
        card={selectedCard}
        decks={decks}
        collections={collections}
        onAddToDeck={addToDeck}
        onAddToCollection={addToCollection}
        refreshKey={refreshKey}
      />

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
