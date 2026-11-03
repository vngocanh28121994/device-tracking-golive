// Screen state lives in the query string (?tab=golive&view=history&release=…) so a reload or a
// shared link reopens the same screen. Only the browser has a URL; on the server these are no-ops.

export function readUrlParam(name: string) {
  return typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get(name) || "";
}

// `push` adds a history entry so Back returns to the previous screen; otherwise the entry is replaced.
export function writeUrlParams(values: Record<string, string>, push = false) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if (url.href === window.location.href) return;
  window.history[push ? "pushState" : "replaceState"](window.history.state, "", url);
}
