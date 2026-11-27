import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/outfit/700.css";
import "./index.css";
import App from "./App";
import { installAppShell } from "./appShell";
import PlayerOverlay from "./components/PlayerOverlay";
import { OVERLAY } from "./player";

installAppShell();

// the same bundle runs the main window and the embedded player's controls
const label = (window as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__
  ?.metadata?.currentWindow?.label;
const Root = label === OVERLAY ? PlayerOverlay : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
