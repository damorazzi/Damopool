// Ticker page -- docs/ARCHITECTURE.md Section 4/5/9/17 (`/app/#/ticker`).
// Composes TickerFeed and EmptyState only, per Section 5's component
// list -- no chart, no search box. shell.js's APP_NAV_ITEMS already had
// a Ticker nav entry since Milestone 5, so no shell.js change is needed
// here.
//
// analytics.json's `live_ticker` (docs/ARCHITECTURE.md Section 25) is
// an *array*, not a dictionary keyed by username/workername -- unlike
// users.js/workers.js/user-detail.js/worker-detail.js/search.js, this
// page never does a bracket lookup keyed by attacker-controlled text,
// so the prototype-chain risk class those pages guard against
// (safeGet/hasOwnProperty) does not apply here at all: entries are read
// via a plain Array.isArray + .map, and username/workername still reach
// the DOM exclusively through el()'s text/attrs.href paths (never
// innerHTML), the same untrusted-text discipline as every other page.
//
// The schema documents live_ticker as "sorted newest first" -- an
// explicit backend-provided invariant, trusted and not re-sorted here,
// the same trust already extended to rolling_windows' fixed 15m/1h/24h
// order (data-table.js's own module comment).
//
// The list itself (ticker-feed.js's <ul>) is still fully rebuilt on
// every render, like every other page's non-canvas/non-input markup --
// but Section 17's "new entries are announced to screen readers"
// requirement cannot be met by putting aria-live on a node that is
// itself destroyed and recreated every render (a live region only
// reliably announces a mutation on a node that persists in the DOM;
// "a brand-new subtree that happens to already contain the text" is
// not the same thing, and most assistive tech will not announce it
// correctly, if at all). So this page needs exactly one persisted,
// swapped DOM node after all -- not a chart canvas or a search input,
// but a small, dedicated, visually-hidden announcer element
// (ticker-feed.js's `.ticker-feed__announcer`), following the same
// swap technique already established for those two. Its textContent is
// set imperatively in renderState below, only on a render that found a
// genuinely new entry -- a real, minimal DOM mutation on a persistent
// node is what actually makes an aria-live region work.
//
// Known, disclosed limitation: a keyboard user focused on a
// username/workername link still loses focus on
// every poll tick, since those links are still part of the fully
// rebuilt list. Fixing that would require true incremental list-item
// reconciliation (tracking and reusing each entry's own DOM node, not
// just one dedicated announcer node) -- a materially bigger mechanism
// than any other page in this project has needed, deferred rather than
// built speculatively; the announcer fix above closes the actual
// Section 17 requirement without it.

import { el, specToDom } from "../core/dom.js";
import { fetchEndpoint, startPolling } from "../core/api.js";
import { validateSchema, describeFetchError } from "../core/errors.js";
import { setState } from "../core/state.js";
import { formatCompactSdiff, formatPercentage, formatRelativeTime } from "../core/format.js";
import { buildHash } from "../core/router.js";
import { cardSpec } from "../components/card.js";
import { emptyStateSpec } from "../components/empty-state.js";
import { loadingSkeletonSpec } from "../components/loading-skeleton.js";
import { errorBannerSpec } from "../components/error-banner.js";
import { tickerFeedSpec } from "../components/ticker-feed.js";

const ANALYTICS_ENDPOINT = "/analytics.json";

export const route = { pattern: "/ticker", name: "ticker" };

// -------------------------------------------------------------------
// Pure data transformation
// -------------------------------------------------------------------

// A malformed entry with no username or no workername is dropped
// rather than reaching formatEntry/buildHash below -- buildHash throws
// on an empty/missing param (router.js's own contract, deliberately
// fail-loud for a genuine caller mistake), and a live_ticker entry's
// username/workername are attacker-influenceable free text with no
// backend charset/non-empty enforcement (docs/ARCHITECTURE.md Section
// 18), so a single malformed record must not be able to crash this
// page's entire render -- the same "degrade gracefully on a bad field"
// discipline every other transform in this project already applies,
// just applied here at the whole-entry level since an array entry (
// unlike a dictionary record) can be entirely missing its identity.
export function transformTickerData(payload) {
  const liveTicker = payload && Array.isArray(payload.live_ticker) ? payload.live_ticker : [];
  const entries = liveTicker
    .filter((entry) => entry && entry.username && entry.workername)
    .map((entry) => ({
      username: entry.username,
      workername: entry.workername,
      currentDailyBest: entry.current_daily_best || null,
      previousDailyBest: entry.previous_daily_best || null,
      // Retained on the transformed entry but not currently rendered
      // by formatEntry/ticker-feed.js -- improvementPercentage (below)
      // is what the Design System's "improvement figure" actually
      // displays; this is kept for a plausible future refinement (an
      // absolute-sdiff-delta tooltip/detail) rather than dropped,
      // matching this project's convention of documenting a kept-but-
      // unused schema field rather than leaving the omission silent.
      improvementAmount: Number.isFinite(entry.improvement_amount) ? entry.improvement_amount : null,
      improvementPercentage: Number.isFinite(entry.improvement_percentage) ? entry.improvement_percentage : null,
      timestamp: entry.timestamp || null,
    }));

  return {
    generatedAt: (payload && payload.metadata && payload.metadata.generated_at) || null,
    entries,
  };
}

// Derived from the same filtered transform used everywhere else on
// this page, not a second, independent read of the raw payload -- a
// payload whose live_ticker entries are all malformed (see the filter
// above) has nothing valid to show and must count as empty, even
// though payload.live_ticker.length itself is non-zero.
export function isTickerEmpty(payload) {
  return transformTickerData(payload).entries.length === 0;
}

function staleMessage(generatedAtIso) {
  const relative = formatRelativeTime(generatedAtIso);
  return relative ? `Data may be stale -- last updated ${relative}.` : "Data may be stale.";
}

export function deriveTickerState({ payload, error = null, isStale = false } = {}) {
  if (!payload) {
    return { status: "error", data: null, error, isStale: false };
  }
  const data = transformTickerData(payload);
  const status = isTickerEmpty(payload) ? "empty" : "success";
  return { status, data, error, isStale: Boolean(isStale) };
}

// A live_ticker entry has no single unique ID field in the schema --
// username+workername+timestamp is unique in practice (a user cannot
// set two new daily bests for the same worker at the exact same
// instant) and stable across polls for an entry that hasn't changed,
// which is exactly what the new-arrival diff below needs. JSON.stringify
// of the tuple, not a "::"-joined string -- username/workername carry
// no charset restriction (Section 18), so a raw-joined string would let
// a crafted username containing "::" collide with a different
// username/workername split (e.g. "a::b"/"c" vs. "a"/"b::c" at the same
// timestamp); JSON.stringify's own escaping keeps each tuple element
// distinct regardless of its content.
export function tickerEntryKey(entry) {
  return JSON.stringify([entry.username, entry.workername, entry.timestamp]);
}

// Pure diff: marks an entry `isNew` if its key wasn't present in the
// previous poll's key set. `previousKeys` must be `null` (not an empty
// Set) to mean "no previous poll to compare against" -- the page's own
// first successful render, where nothing has actually "arrived," it
// was just loaded; passing an empty Set there would instead mark every
// entry as newly arrived.
export function markNewEntries(entries, previousKeys) {
  if (!previousKeys) {
    return entries.map((entry) => ({ ...entry, isNew: false }));
  }
  return entries.map((entry) => ({ ...entry, isNew: !previousKeys.has(tickerEntryKey(entry)) }));
}

// Pure: the text a screen reader actually hears when a poll brings in
// one or more genuinely new entries -- mount()'s renderState sets this
// as the persisted announcer node's textContent (a real DOM mutation
// on a node that survives across renders), not via the spec tree,
// which is what makes the aria-live region below actually announce
// something rather than being a no-op on a freshly-rebuilt subtree.
export function buildAnnouncementText(entries) {
  const newOnes = entries.filter((entry) => entry.isNew);
  if (newOnes.length === 0) return "";
  return newOnes.map((entry) => `New best share by ${entry.username} on ${entry.workername}.`).join(" ");
}

// -------------------------------------------------------------------
// Pure entry formatting
// -------------------------------------------------------------------

function formatEntry(entry) {
  return {
    isNew: Boolean(entry.isNew),
    usernameHref: buildHash("/users/:username", { username: entry.username }),
    username: entry.username,
    workernameHref: buildHash("/workers/:workername", { workername: entry.workername }),
    workername: entry.workername,
    currentBestLabel: formatCompactSdiff(entry.currentDailyBest && entry.currentDailyBest.sdiff) || "--",
    previousBestLabel: entry.previousDailyBest
      ? formatCompactSdiff(entry.previousDailyBest.sdiff) || "--"
      : "First best of the day",
    // A live-ticker entry always represents a new best, so a
    // meaningful improvement figure is always positive -- matching
    // user-detail.js's own "exactly 0% shows no trend" precedent,
    // extended here to also exclude a non-positive/missing value
    // entirely rather than a bidirectional up/down choice, since
    // ticker-feed.js only ever renders an "up" trend.
    improvementLabel:
      Number.isFinite(entry.improvementPercentage) && entry.improvementPercentage > 0
        ? formatPercentage(entry.improvementPercentage)
        : null,
    timestampLabel: formatRelativeTime(entry.timestamp) || "--",
  };
}

// -------------------------------------------------------------------
// Pure page-spec building
// -------------------------------------------------------------------

function loadingSectionSpec() {
  return el("div", {
    className: "ticker-page__loading",
    children: [loadingSkeletonSpec({ shape: "row", count: 5 })],
  });
}

export function buildTickerSpec(state) {
  const heading = el("h1", { className: "ticker-page__title", text: "Ticker" });

  if (state.status === "loading") {
    return el("div", { className: "ticker-page", children: [heading, loadingSectionSpec()] });
  }

  if (state.status === "error") {
    return el("div", {
      className: "ticker-page",
      children: [heading, errorBannerSpec({ message: describeFetchError(state.error), icon: "error" })],
    });
  }

  const banners = [];
  if (state.error) {
    banners.push(errorBannerSpec({ message: describeFetchError(state.error), icon: "error" }));
  } else if (state.isStale) {
    banners.push(errorBannerSpec({ message: staleMessage(state.data && state.data.generatedAt), icon: "warning" }));
  }

  if (state.status === "empty") {
    return el("div", {
      className: "ticker-page",
      children: [
        heading,
        ...banners,
        cardSpec({ children: [emptyStateSpec({ message: "No best shares recorded yet today." })] }),
      ],
    });
  }

  if (state.status !== "success") {
    throw new Error(`buildTickerSpec: unrecognized status "${state.status}"`);
  }

  return el("div", {
    className: "ticker-page",
    children: [
      heading,
      ...banners,
      tickerFeedSpec({ title: "Recent Best Shares", entries: state.data.entries.map(formatEntry) }),
    ],
  });
}

// -------------------------------------------------------------------
// DOM glue -- mount/unmount lifecycle
// -------------------------------------------------------------------

const EMPTY_PAGE_SPEC = el("div", { className: "ticker-page" });

// Identical swap technique to users.js's/workers.js's search-input
// preservation and overview.js's/pool.js's chart-canvas preservation,
// applied to the announcer node instead: build the fresh spec's own
// (throwaway) announcer element, then splice in the real, already-live
// one before inserting the new tree, so its aria-live association with
// assistive tech is never lost across a render.
function defaultRender(container, spec, { reuseAnnouncerNode = null } = {}) {
  const node = specToDom(spec);
  const freshAnnouncerNode = node.querySelector(".ticker-feed__announcer");

  let announcerNode = freshAnnouncerNode;
  if (reuseAnnouncerNode && freshAnnouncerNode && freshAnnouncerNode.parentNode) {
    freshAnnouncerNode.parentNode.replaceChild(reuseAnnouncerNode, freshAnnouncerNode);
    announcerNode = reuseAnnouncerNode;
  }

  container.replaceChildren(node);

  return { announcerNode };
}

let isMounted = false;
let mountToken = 0;
let renderedStatus = null;
let previousKeys = null;
let announcerNode = null;
let stopPollingFn = null;
let currentRender = defaultRender;
let currentContainer = null;

export function mount(container, { fetchImpl, intervalMs, staleAfterMs, render = defaultRender } = {}) {
  if (isMounted) {
    throw new Error("ticker.mount: already mounted -- call unmount() first");
  }
  isMounted = true;
  mountToken += 1;
  const myToken = mountToken;

  renderedStatus = null;
  previousKeys = null;
  announcerNode = null;
  stopPollingFn = null;
  currentRender = render;
  currentContainer = container;

  function isCurrent() {
    return isMounted && mountToken === myToken;
  }

  const safeStaleAfterMs = Number.isFinite(staleAfterMs) && staleAfterMs > 0 ? staleAfterMs : undefined;
  const fetchOptions = { fetchImpl, validate: validateSchema, staleAfterMs: safeStaleAfterMs };

  function renderState(tickerState) {
    let specState = tickerState;
    let announcementText = "";

    // isSubsequentSuccess gates both the new-entry diff and the
    // announcer-node reuse on the exact same condition: only a
    // success -> success transition has a genuine previous poll to
    // compare against or a live announcer node worth preserving. A
    // transient error/empty render in between (previousKeys/
    // announcerNode left as-is, just bypassed) means the next success
    // is treated as a first paint again -- deliberately: it fails
    // toward under-announcing (a real arrival during the gap goes
    // unannounced once) rather than toward a wrong/stale announcement,
    // and a genuine, sustained connectivity gap is already surfaced by
    // the error banner itself.
    if (tickerState.status === "success") {
      const isSubsequentSuccess = renderedStatus === "success";
      const entriesWithNew = markNewEntries(tickerState.data.entries, isSubsequentSuccess ? previousKeys : null);
      previousKeys = new Set(entriesWithNew.map(tickerEntryKey));
      specState = { ...tickerState, data: { ...tickerState.data, entries: entriesWithNew } };
      announcementText = buildAnnouncementText(entriesWithNew);
    }

    const reuseAnnouncer = renderedStatus === "success" && tickerState.status === "success" && Boolean(announcerNode);
    const spec = buildTickerSpec(specState);
    const nodes = render(container, spec, { reuseAnnouncerNode: reuseAnnouncer ? announcerNode : null });
    announcerNode = (nodes && nodes.announcerNode) || null;
    if (announcerNode) {
      announcerNode.textContent = announcementText;
    }
    renderedStatus = tickerState.status;
  }

  function handleResult(result) {
    if (result.payload) {
      setState({
        analytics: result.payload,
        analyticsFetchedAt: result.fetchedAt ? result.fetchedAt.toISOString() : null,
      });
    }
    renderState(deriveTickerState(result));
  }

  renderState({ status: "loading" });

  (async () => {
    const result = await fetchEndpoint(ANALYTICS_ENDPOINT, fetchOptions);
    if (!isCurrent()) return;
    handleResult(result);

    if (Number.isFinite(intervalMs) && intervalMs > 0) {
      stopPollingFn = startPolling(
        ANALYTICS_ENDPOINT,
        intervalMs,
        (pollResult) => {
          if (!isCurrent()) return;
          handleResult(pollResult);
        },
        fetchOptions,
      );
    }
  })();
}

export function unmount() {
  if (!isMounted) return;
  isMounted = false;
  if (stopPollingFn) {
    stopPollingFn();
    stopPollingFn = null;
  }
  renderedStatus = null;
  previousKeys = null;
  announcerNode = null;
  currentRender(currentContainer, EMPTY_PAGE_SPEC);
  currentContainer = null;
}
