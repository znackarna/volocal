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
import ErrorBoundary from "./ErrorBoundary";
import { keepUncaughtErrors } from "./crashlog";
import { applyTheme, rememberedTheme } from "./types";
import { I18nProvider } from "./i18n";
import { PlayerProvider } from "./player";
import { RecorderProvider } from "./recorder";
import "./styles.css";

// Before anything else, so that a throw while the tree is being set up is
// written down too. `ErrorBoundary` catches a throw during render; this catches
// the quiet kind React does not route to it — one inside an event handler,
// which is how a button comes to do nothing at all.
keepUncaughtErrors();

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

// Before the first paint, from the choice remembered locally. The settings
// arrive from the backend a moment later and re-apply the same thing; without
// this the window would open light and turn dark once they did.
applyTheme(rememberedTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      {/* Inside the dictionary, outside everything else: the crash screen has
          to be able to say what happened, and the player, the recorder and the
          application are what can throw. */}
      <ErrorBoundary>
        <PlayerProvider>
          <RecorderProvider>
            <App />
          </RecorderProvider>
        </PlayerProvider>
      </ErrorBoundary>
    </I18nProvider>
  </React.StrictMode>
);
