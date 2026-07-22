// Phase E Milestone 27: pure event-synthesis/diffing logic for the
// permanent, shell-owned Global Live Feed (docs/ARCHITECTURE.md
// Section 5/9, Human Approval Brief 2026-07-21). No DOM here -- this
// module only turns two successive analytics.json payloads into a
// list of "things that just happened," fully unit-testable in Node,
// the same tier split as router.js/state.js/format.js.
//
// Human decision, explicit: only synthesize event types that already
// have real data available today, with zero backend/schema changes --
// "New Personal Best," "New Best Ever," "Best Share Today," "New
// User," "New Worker." Do not fabricate or estimate any others (Block
// Found, High Difficulty Share, Pool Hashrate Milestone, Current
// Network Difficulty all named in the original brief have no backing
// data anywhere the frontend can reach -- see PROJECT_LOG.md).
//
// FEED_EVENT_TYPES is the extensibility point the Human explicitly
// asked for: a future event type is one new registry entry (priority,
// icon, label) plus one new detection branch in deriveFeedEvents --
// not a redesign. Mirrors this project's established "one table, one
// entry per future thing" convention (shell.js's own APP_NAV_ITEMS,
// app.js's PAGES/ROUTES).
//
// Priority mapping is the Human's own explicit classification:
// Priority 1 (Block Found, Best Ever, Personal Best) -- only Best
// Ever/Personal Best exist this milestone; Priority 2 (High Difficulty
// Share, Pool Hashrate Milestones) -- no entries yet, no data source;
// Priority 3 (informational statistics) -- Best Share Today, New
// User, New Worker.
//
// transformTickerData/tickerEntryKey/markNewEntries originally lived in
// pages/ticker.js (Phase 2 of this milestone imported them from there
// while that page still existed); Phase 3 retired the page and moved
// them to core/live-ticker.js, their permanent shared home now that
// they're used by more than one caller.
import { transformTickerData, tickerEntryKey, markNewEntries } from "../core/live-ticker.js";
import { buildHash } from "../core/router.js";

export const FEED_EVENT_TYPES = {
  personal_best: { priority: 1, label: "New Personal Best", icon: "trophy" },
  best_ever: { priority: 1, label: "New Best Ever", icon: "trophy" },
  best_today: { priority: 3, label: "Best Share Today", icon: "chart" },
  new_user: { priority: 3, label: "New User", icon: "user" },
  new_worker: { priority: 3, label: "New Worker", icon: "worker" },
};

// A pool best-share record (best_share_ever/best_share_today) has no
// single unique ID -- its own timestamp+sdiff pair is unique in
// practice (the same reasoning ticker.js's own tickerEntryKey already
// applies to a live_ticker entry) and stable across polls for a record
// that hasn't changed, which is exactly what a "did this change since
// last poll" diff needs.
function bestShareKey(best) {
  if (!best || typeof best.timestamp !== "string" || !Number.isFinite(best.sdiff)) return null;
  return `${best.timestamp}|${best.sdiff}`;
}

// Human's own explicit mapping (Approval Brief point 9): New Best Ever
// and Best Share Today are both pool-wide superlatives -- routed to
// the Pool page, not to the specific worker that happened to set them,
// exactly like New Best Ever's own given example, applied consistently
// to Best Share Today rather than inventing a different rule for it.
function poolHref() {
  return buildHash("/pool");
}

// Builds the empty/initial snapshot -- deriveFeedEvents' own "no
// previous poll" case (previousSnapshot === null) returns this same
// shape without synthesizing any *diff-based* events (best_ever/
// best_today/new_user/new_worker), matching ticker.js's established
// markNewEntries(entries, null) convention: the first successful
// payload establishes a baseline silently rather than treating every
// already-existing user/worker/pool-record as "brand new right now."
// personal_best is the one exception -- see personalBestEventsFrom
// below and its own call sites in deriveFeedEvents.
function snapshotOf(payload) {
  const pool = (payload && payload.pool) || {};
  const users = (payload && payload.users) || {};
  const workers = (payload && payload.workers) || {};
  const tickerEntries = transformTickerData(payload).entries;

  return {
    bestEverKey: bestShareKey(pool.best_share_ever),
    bestTodayKey: bestShareKey(pool.best_share_today),
    userKeys: new Set(Object.keys(users)),
    workerKeys: new Set(Object.keys(workers)),
    tickerKeys: new Set(tickerEntries.map(tickerEntryKey)),
  };
}

// Human-reported bug (real-browser use, after the original Code
// Review): a personal_best event carried no sdiff/improvement figures
// at all -- every other place this project has ever shown a "new
// personal best" (the retired ticker-feed.js's own vertical list)
// showed the current vs. previous daily-best sdiff and an improvement
// percentage with a trend-up indicator. This was simply dropped when
// the new component was built from scratch this milestone. Fixed:
// carry the same fields transformTickerData's own entry shape already
// provides (currentDailyBest/previousDailyBest/improvementPercentage)
// through onto the event object, so components/live-feed.js can render
// them exactly the way the retired component used to.
function personalBestEventFrom(entry) {
  return {
    type: "personal_best",
    timestamp: entry.timestamp,
    href: buildHash("/workers/:workername", { workername: entry.workername }),
    detail: entry.workername,
    currentSdiff: entry.currentDailyBest ? entry.currentDailyBest.sdiff : null,
    previousSdiff: entry.previousDailyBest ? entry.previousDailyBest.sdiff : null,
    improvementPercentage: Number.isFinite(entry.improvementPercentage) ? entry.improvementPercentage : null,
  };
}

// Code Review (Milestone 27, Major finding): a dictionary key can only
// ever be attacker-influenceable free text with no charset/non-empty
// enforcement (docs/ARCHITECTURE.md Section 18) -- transformTickerData
// already filters a falsy username/workername out before use; this
// mirrors that same discipline so an empty string here can never reach
// buildHash (which throws on an empty/missing param value) and take
// down the shared core/state.js listener loop this module's only
// caller (shell/shell.js's wireLiveFeed) runs inside of.
function nonEmptyKeys(dict) {
  return Object.keys(dict).filter(Boolean);
}

// Pure: given the latest payload and the previous poll's snapshot (or
// null for "no previous poll yet"), returns { newEvents, snapshot } --
// snapshot is always returned so the caller can persist it for the
// next call regardless of whether any event fired.
//
// Code Review (Milestone 27, Major finding): the very first call used
// to return newEvents: [] unconditionally, meaning the feed showed
// nothing at all on every fresh page load/reload no matter how much
// real recent activity analytics.json's live_ticker already recorded
// -- undermining the feed's whole purpose as "one of the defining
// features of Damopool." Fixed: the first call now seeds newEvents
// from the payload's own already-existing live_ticker content (exactly
// what the retired Ticker page always showed by default) -- this is
// not a fabricated event, it's the same real data the old page always
// displayed on load. best_ever/best_today/new_user/new_worker are
// deliberately NOT seeded the same way: a pool-wide best-share record
// is a single current-state snapshot, not a list of past events, and
// presenting it as something that "just happened" on load could
// misrepresent its actual age (this component renders no timestamp);
// a user/worker dictionary snapshot has no way to know who's "new"
// without a prior poll to diff against at all -- seeding from it would
// flood the feed with every existing user/worker on every single load,
// exactly the bug this null-previousSnapshot convention exists to
// prevent for those four types.
//
// The caller (shell/shell.js's wireLiveFeed) is responsible for not
// treating this first call's newEvents as worth an aria-live
// announcement -- announcing pre-existing content as freshly arrived
// would be as misleading as fabricating it.
//
// New User/New Worker timestamps: analytics.json's users/workers
// dictionaries carry no "joined at" field (docs/ARCHITECTURE.md
// Section 25) -- unlike live_ticker/best_share_* entries, which each
// carry their own backend-authoritative timestamp, there is no
// authoritative moment to attribute a dictionary key's first
// appearance to. `timestamp: null` here honestly reflects that gap
// (the caller/renderer treats it as "detected just now," not a
// fabricated join time) rather than inventing one. One consequence,
// noted rather than silently left implicit (Code Review, Minor
// finding): when several event types fire within the same poll,
// newEvents is ordered type-group by type-group below, not by true
// chronological order across types -- new_user/new_worker have no
// timestamp to sort by at all. Acceptable given the Human's explicit
// "do not fabricate or estimate" instruction leaves no timestamp to
// invent for those two types.
export function deriveFeedEvents(payload, previousSnapshot) {
  const pool = (payload && payload.pool) || {};
  const users = (payload && payload.users) || {};
  const workers = (payload && payload.workers) || {};
  const snapshot = snapshotOf(payload);
  const newEvents = [];

  const tickerEntries = transformTickerData(payload).entries;

  if (!previousSnapshot) {
    for (const entry of tickerEntries) {
      newEvents.push(personalBestEventFrom(entry));
    }
    return { newEvents, snapshot };
  }

  const withNew = markNewEntries(tickerEntries, previousSnapshot.tickerKeys);
  for (const entry of withNew) {
    if (!entry.isNew) continue;
    newEvents.push(personalBestEventFrom(entry));
  }

  // best_ever/best_today carry only currentSdiff, deliberately no
  // previousSdiff/improvementPercentage -- analytics.json's
  // pool.best_share_ever/best_share_today are each a single
  // current-state record with no memory of what they previously held
  // (the old value is simply overwritten), so there is nothing genuine
  // to compare against without fabricating one, which the Human's own
  // "do not fabricate or estimate" instruction rules out.
  if (snapshot.bestEverKey && snapshot.bestEverKey !== previousSnapshot.bestEverKey) {
    newEvents.push({
      type: "best_ever",
      timestamp: pool.best_share_ever.timestamp,
      href: poolHref(),
      detail: pool.best_share_ever.workername,
      currentSdiff: pool.best_share_ever.sdiff,
      previousSdiff: null,
      improvementPercentage: null,
    });
  }

  if (snapshot.bestTodayKey && snapshot.bestTodayKey !== previousSnapshot.bestTodayKey) {
    newEvents.push({
      type: "best_today",
      timestamp: pool.best_share_today.timestamp,
      href: poolHref(),
      detail: pool.best_share_today.workername,
      currentSdiff: pool.best_share_today.sdiff,
      previousSdiff: null,
      improvementPercentage: null,
    });
  }

  for (const username of nonEmptyKeys(users)) {
    if (!previousSnapshot.userKeys.has(username)) {
      newEvents.push({
        type: "new_user",
        timestamp: null,
        href: buildHash("/users/:username", { username }),
        detail: username,
      });
    }
  }

  for (const workername of nonEmptyKeys(workers)) {
    if (!previousSnapshot.workerKeys.has(workername)) {
      newEvents.push({
        type: "new_worker",
        timestamp: null,
        href: buildHash("/workers/:workername", { workername }),
        detail: workername,
      });
    }
  }

  return { newEvents, snapshot };
}

// Pure: prepends newEvents (assumed newest-first among themselves,
// matching every other poll-driven list in this codebase) to the
// existing accumulated history and caps the total length. The feed's
// own event log is a purely client-side accumulation built from
// successive deriveFeedEvents calls -- analytics.json has no
// event-history endpoint of its own, so everything the feed ever shows
// (including the very first render's seeded live_ticker content) flows
// through this same accumulation, not a separate initial-render path.
//
// maxLength has no default deliberately (matching format.js's/api.js's
// own no-default-for-an-unproven-number convention): the right cap is
// a browser-verified tuning decision (Human's own "reduce the number
// of visible events rather than making the feed feel busy" guidance),
// not a number to guess at here.
export function accumulateFeedEvents(existingEvents, newEvents, maxLength) {
  if (!Number.isInteger(maxLength) || maxLength <= 0) {
    throw new TypeError("accumulateFeedEvents requires a positive integer maxLength");
  }
  return [...newEvents, ...existingEvents].slice(0, maxLength);
}
