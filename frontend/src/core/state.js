// Minimal pub/sub store -- docs/ARCHITECTURE.md Section 13. Holds the
// last-fetched analytics.json payload, its fetch timestamp, the
// active theme, and page-local UI state that must survive a route
// change (docs/ARCHITECTURE.md's own example: a search query).
//
// setState only ever shallow-spreads the four known keys below (an
// explicit whitelist, not caller discipline) -- `state.analytics`
// holds the fetched payload by reference and is never merged or
// spread. docs/ARCHITECTURE.md Section 13's guardrail against a
// __proto__/constructor key in analytics.json's unvalidated
// username/workername-keyed objects depends on that payload never
// being merged into another object, here or anywhere else; the
// whitelist also stops a caller mistake like setState(analyticsPayload)
// (instead of setState({ analytics: analyticsPayload })) from
// spreading the payload's own top-level keys onto state's.

const STATE_KEYS = ["analytics", "analyticsFetchedAt", "theme", "searchQuery"];

const listeners = new Set();

let state = {
  analytics: null,
  analyticsFetchedAt: null,
  theme: null,
  searchQuery: "",
};

// A shallow copy, not the live internal reference -- so a caller
// mutating the returned object (e.g. getState().theme = "x") cannot
// bypass setState's listener notification.
export function getState() {
  return { ...state };
}

export function setState(partial) {
  const next = { ...state };
  for (const key of STATE_KEYS) {
    if (key in partial) {
      next[key] = partial[key];
    }
  }
  state = next;
  for (const listener of listeners) {
    listener(state);
  }
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
