import "./styles.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { queryClient } from "./lib/data.ts";
import { applyTheme } from "./lib/prefs.ts";

// The app moved from ride.bbt.team (still attached to the Worker) to app.bbt.team: forward old links and bookmarks.
if (location.hostname === "ride.bbt.team")
  location.replace(`https://app.bbt.team${location.pathname}${location.search}${location.hash}`);

applyTheme();
const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
