import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { startApiBridge } from "./api/bridge";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

startApiBridge().catch((e) => console.error("agent API bridge failed to start", e));
