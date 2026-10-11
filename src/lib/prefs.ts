// Per-rider preferences kept in this browser (DESIGN.md → Settings): theme, units, kit offset, weather app, open panels.
import { useSyncExternalStore } from "react";
import type { KitOffset } from "../../shared/kit.ts";

export interface Prefs {
  theme: "auto" | "light" | "dark";
  units: "imperial" | "metric";
  kitOffset: KitOffset;
  wxApp: "nws" | "weathercom" | "windy" | "google";
  panels: Record<string, boolean>;
}
const DEFAULTS: Prefs = { theme: "auto", units: "imperial", kitOffset: "avg", wxApp: "nws", panels: {} };
const KEY = "bbt.prefs";

function read(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS; // private mode or blocked storage
  }
}
let current = read();
const listeners = new Set<() => void>();

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  current = { ...current, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // keep the in-memory value
  }
  if (key === "theme") applyTheme();
  for (const l of listeners) l();
}

export const usePrefs = (): Prefs =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );

export function applyTheme() {
  if (current.theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", current.theme);
}

export const isDark = () =>
  current.theme === "dark" || (current.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
