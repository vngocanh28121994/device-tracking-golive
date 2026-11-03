"use client";
import { useSyncExternalStore } from "react";

// Per-browser display preferences. The server always renders the defaults; the client reads
// the real values right after hydration without a setState-in-effect round trip.

export type Theme = "light" | "dark";

// app/layout.tsx sets data-theme before first paint; this hook follows that attribute.
export function useTheme(): [Theme, (next: Theme) => void] {
  const theme = useSyncExternalStore(subscribeTheme, () => document.documentElement.dataset.theme === "dark" ? "dark" : "light", () => "light" as Theme);
  const setTheme = (next: Theme) => {
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch {}
  };
  return [theme, setTheme];
}

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

const COLLAPSED_KEY = "sidebar-collapsed", CHANGE_EVENT = "preferences-change";

export function useSidebarCollapsed(): [boolean, (next: boolean) => void] {
  const collapsed = useSyncExternalStore(subscribeStorage, readCollapsed, () => false);
  const setCollapsed = (next: boolean) => {
    try { localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch {}
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };
  return [collapsed, setCollapsed];
}

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
}

function subscribeStorage(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => { window.removeEventListener(CHANGE_EVENT, onChange); window.removeEventListener("storage", onChange); };
}
