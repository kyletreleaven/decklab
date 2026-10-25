import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { startApiBridge } from "./api/bridge";
import { storeChannel } from "./lib/channel";
import { cardStore, processKind } from "./lib/db";
import { shareChannel } from "./lib/scheduler";
import { startLibraryMenu } from "./lib/library/menu";
import { seedLab } from "./lib/library/seed";
import "./styles.css";

// Before anything can request: every DeckLab process shares one channel to
// Scryfall, kept in the card store.
shareChannel(storeChannel(cardStore, processKind));

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// In lab mode with a seed file, the lab is loaded before any panel reads it.
void seedLab((path) => root.render(<p className="lab-loading">Loading {path}…</p>)).then(() =>
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  ),
);

startApiBridge().catch((e) => console.error("agent API bridge failed to start", e));
startLibraryMenu().catch((e) => console.error("library menu failed to start", e));
