// Pure helpers for analytics.json's live_ticker array (docs/
// ARCHITECTURE.md Section 25) -- shared source of truth for anything
// that needs to read or diff "new personal best" events. Originally
// part of pages/ticker.js (Phase D/E, through Milestone 26); relocated
// here in Phase E Milestone 27 when that page was retired in favour of
// the shell-owned Global Live Feed (shell/live-feed-events.js), which
// is now this module's only consumer alongside its own unit tests --
// unchanged in behaviour, just no longer tied to a page's lifetime.
//
// live_ticker is an *array*, not a dictionary keyed by username/
// workername -- unlike users.js/workers.js/user-detail.js/
// worker-detail.js/search.js, nothing here does a bracket lookup keyed
// by attacker-controlled text, so the prototype-chain risk class those
// pages guard against (safeGet/hasOwnProperty) does not apply here.
// The schema documents live_ticker as "sorted newest first" -- an
// explicit backend-provided invariant, trusted and not re-sorted here.

// A malformed entry with no username or no workername is dropped --
// username/workername are attacker-influenceable free text with no
// backend charset/non-empty enforcement (docs/ARCHITECTURE.md Section
// 18), so a single malformed record must not be able to crash a
// caller's entire render.
export function transformTickerData(payload) {
  const liveTicker = payload && Array.isArray(payload.live_ticker) ? payload.live_ticker : [];
  const entries = liveTicker
    .filter((entry) => entry && entry.username && entry.workername)
    .map((entry) => ({
      username: entry.username,
      workername: entry.workername,
      currentDailyBest: entry.current_daily_best || null,
      previousDailyBest: entry.previous_daily_best || null,
      improvementAmount: Number.isFinite(entry.improvement_amount) ? entry.improvement_amount : null,
      improvementPercentage: Number.isFinite(entry.improvement_percentage) ? entry.improvement_percentage : null,
      timestamp: entry.timestamp || null,
    }));

  return {
    generatedAt: (payload && payload.metadata && payload.metadata.generated_at) || null,
    entries,
  };
}

// A live_ticker entry has no single unique ID field in the schema --
// username+workername+timestamp is unique in practice (a user cannot
// set two new daily bests for the same worker at the exact same
// instant) and stable across polls for an entry that hasn't changed.
// JSON.stringify of the tuple, not a "::"-joined string -- username/
// workername carry no charset restriction (Section 18), so a raw-joined
// string would let a crafted username containing "::" collide with a
// different username/workername split at the same timestamp;
// JSON.stringify's own escaping keeps each tuple element distinct
// regardless of its content.
export function tickerEntryKey(entry) {
  return JSON.stringify([entry.username, entry.workername, entry.timestamp]);
}

// Pure diff: marks an entry `isNew` if its key wasn't present in the
// previous poll's key set. `previousKeys` must be `null` (not an empty
// Set) to mean "no previous poll to compare against" -- the caller's
// own first successful read, where nothing has actually "arrived," it
// was just loaded; passing an empty Set there would instead mark every
// entry as newly arrived.
export function markNewEntries(entries, previousKeys) {
  if (!previousKeys) {
    return entries.map((entry) => ({ ...entry, isNew: false }));
  }
  return entries.map((entry) => ({ ...entry, isNew: !previousKeys.has(tickerEntryKey(entry)) }));
}
