import React from "react";
import ReactDOM from "react-dom/client";

// Fonts are bundled with the app rather than fetched from the internet.
// Otherwise the portable build would look broken on a machine with no network.
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/schibsted-grotesk/wght.css";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/literata/wght.css";
import "@fontsource-variable/source-serif-4/wght.css";

import App from "./App";
import { I18nProvider } from "./i18n";
import { PlayerProvider } from "./player";
import "./styles.css";

// Right-click would otherwise open the rendering engine's own menu — Back,
// Reload, Inspect — which makes no sense inside the app. It stays available
// in text fields and over a selection, where copy and paste are useful.
document.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement | null;
  const jeText =
    target?.closest("input, textarea, [contenteditable='true']") !== null ||
    (window.getSelection()?.toString().length ?? 0) > 0;
  if (!jeText) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <PlayerProvider>
        <App />
      </PlayerProvider>
    </I18nProvider>
  </React.StrictMode>
);
