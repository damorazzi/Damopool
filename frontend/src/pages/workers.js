// Workers (list) page -- docs/ARCHITECTURE.md Section 4/5/9
// (`/app/#/workers`). Fourth complete page module. Mirrors users.js
// closely (client-side substring search over an already-fetched
// dictionary, the same search-input-preservation technique, the same
// mountToken stale-remount guard) -- workername carries the same "no
// charset restriction" untrusted-text status as username (Section 18),
// and analytics.json's `workers` object is the same kind of plain
// dictionary keyed by that untrusted text (Section 13's __proto__/
// constructor-key warning), so transformWorkersData reads it via
// Object.entries only, exactly like transformUsersData.
//
// New to this page: workers[...].is_active is a genuine boolean field
// (docs/ARCHITECTURE.md Section 25) -- exactly the field badge.js's
// own module comment names as one of the "two genuine binary status
// fields already in analytics.json" it was built for. This is that
// field's first real consumer. Rendering a Badge inside a table cell
// (rather than plain text) is why data-table.js gained an additive
// `column.render` option this milestone -- every other page's columns
// are unaffected, since `render` is opt-in.

import { el, specToDom } from "../core/dom.js";
import { fetchEndpoint, startPolling } from "../core/api.js";
import { validateSchema, describeFetchError } from "../core/errors.js";
import { getState, setState } from "../core/state.js";
import { formatSdiff, formatRelativeTime } from "../core/format.js";
import { buildHash } from "../core/router.js";
import { cardSpec } from "../components/card.js";
import { emptyStateSpec } from "../components/empty-state.js";
import { loadingSkeletonSpec } from "../components/loading-skeleton.js";
import { errorBannerSpec } from "../components/error-banner.js";
import { dataTableSpec } from "../components/data-table.js";
import { searchBoxSpec } from "../components/search-box.js";
import { badgeSpec } from "../components/badge.js";

const ANALYTICS_ENDPOINT = "/analytics.json";

export const route = { pattern: "/workers", name: "workers" };

// Links each row to pages/worker-detail.js -- added once that page
// existed to link to, mirroring users.js's identical usernameCellSpec
// (docs/ARCHITECTURE.md Section 23's "add it when a page needs it").
//
// Exported so pages/search.js can reuse it verbatim for its own
// workername-result column -- additive, behaviour-preserving,
// identical to users.js's own usernameCellSpec export.
export function workernameCellSpec(row) {
  return el("a", {
    attrs: { href: buildHash("/workers/:workername", { workername: row.workername }) },
    text: row.workername,
  });
}

const WORKER_COLUMNS = [
  { key: "workername", label: "Workername", mono: true, render: workernameCellSpec },
  { key: "status", label: "Status", render: (row) => badgeSpec({ variant: row.isActive ? "active" : "inactive" }) },
  { key: "agent", label: "Agent" },
  { key: "lastShare", label: "Last Share", align: "right" },
  { key: "accepted", label: "Accepted", align: "right" },
  { key: "rejected", label: "Rejected", align: "right" },
  { key: "avgSdiff", label: "Avg Sdiff", align: "right" },
  { key: "bestToday", label: "Best Today", align: "right" },
  { key: "bestEver", label: "Best Ever", align: "right" },
];

// -------------------------------------------------------------------
// Pure data transformation
// -------------------------------------------------------------------

// docs/ARCHITECTURE.md Section 25 lists four worker-specific fields:
// agent, first_share_at, last_share_at, is_active. first_share_at is
// deliberately not read here -- this list view shows recency
// (lastShareAt, "how active is this worker right now"), not
// provenance ("when did it first appear"); the latter is more useful
// as detail-page context (alongside rolling_windows, also not shown
// here) than as a ninth list column. Revisit if a Worker Detail page
// needs it.
export function transformWorkersData(payload) {
  const workers = (payload && payload.workers) || {};
  const rows = Object.entries(workers)
    .map(([workername, record]) => ({
      workername,
      agent: record.agent || null,
      isActive: Boolean(record.is_active),
      lastShareAt: record.last_share_at || null,
      acceptedCount: record.accepted_count,
      rejectedCount: record.rejected_count,
      averageSdiff: record.average_sdiff,
      bestShareToday: record.best_share_today || null,
      bestShareEver: record.best_share_ever || null,
    }))
    .sort((a, b) => a.workername.localeCompare(b.workername));

  return {
    generatedAt: (payload && payload.metadata && payload.metadata.generated_at) || null,
    rows,
  };
}

export function isWorkersEmpty(payload) {
  const workers = (payload && payload.workers) || {};
  return Object.keys(workers).length === 0;
}

function staleMessage(generatedAtIso) {
  const relative = formatRelativeTime(generatedAtIso);
  return relative ? `Data may be stale -- last updated ${relative}.` : "Data may be stale.";
}

export function deriveWorkersState({ payload, error = null, isStale = false } = {}) {
  if (!payload) {
    return { status: "error", data: null, error, isStale: false };
  }
  const data = transformWorkersData(payload);
  const status = isWorkersEmpty(payload) ? "empty" : "success";
  return { status, data, error, isStale: Boolean(isStale) };
}

// Case-insensitive substring match on workername only -- matching
// users.js's filterUsersByQuery scope exactly (not agent, not any
// other field).
export function filterWorkersByQuery(rows, query) {
  const trimmed = (query || "").trim();
  if (!trimmed) return rows;
  const needle = trimmed.toLowerCase();
  return rows.filter((row) => row.workername.toLowerCase().includes(needle));
}

// -------------------------------------------------------------------
// Pure table row formatting
// -------------------------------------------------------------------

function formatCount(n) {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : null;
}

export function formatWorkerRow(row) {
  return {
    workername: row.workername,
    // Passed through raw, not stringified -- the "status" column's
    // render() reads this boolean directly rather than a formatted
    // display string, since it builds a Badge, not plain text.
    isActive: row.isActive,
    // Already normalized to null-or-string by transformWorkersData --
    // no reformatting needed, unlike the numeric fields below.
    agent: row.agent,
    lastShare: formatRelativeTime(row.lastShareAt),
    accepted: formatCount(row.acceptedCount),
    rejected: formatCount(row.rejectedCount),
    avgSdiff: formatSdiff(row.averageSdiff),
    bestToday: formatSdiff(row.bestShareToday && row.bestShareToday.sdiff),
    bestEver: formatSdiff(row.bestShareEver && row.bestShareEver.sdiff),
  };
}

// -------------------------------------------------------------------
// Pure page-spec building
// -------------------------------------------------------------------

function loadingSectionSpec() {
  return el("div", {
    className: "workers-page__loading",
    children: [loadingSkeletonSpec({ shape: "row", count: 5 })],
  });
}

export function buildWorkersSpec(state) {
  const heading = el("h1", { className: "workers-page__title", text: "Workers" });

  if (state.status === "loading") {
    return el("div", { className: "workers-page", children: [heading, loadingSectionSpec()] });
  }

  if (state.status === "error") {
    return el("div", {
      className: "workers-page",
      children: [heading, errorBannerSpec({ message: describeFetchError(state.error), icon: "error" })],
    });
  }

  const banners = [];
  if (state.error) {
    banners.push(errorBannerSpec({ message: describeFetchError(state.error), icon: "error" }));
  } else if (state.isStale) {
    banners.push(errorBannerSpec({ message: staleMessage(state.data.generatedAt), icon: "warning" }));
  }

  if (state.status === "empty") {
    return el("div", {
      className: "workers-page",
      children: [
        heading,
        ...banners,
        cardSpec({ children: [emptyStateSpec({ message: "No workers have been recorded yet." })] }),
      ],
    });
  }

  if (state.status !== "success") {
    throw new Error(`buildWorkersSpec: unrecognized status "${state.status}"`);
  }

  const query = state.searchQuery || "";
  const filteredRows = filterWorkersByQuery(state.data.rows, query);
  const searchBox = searchBoxSpec({ value: query, placeholder: "Search workers", label: "Search workers" });

  const content =
    query.trim() && filteredRows.length === 0
      ? cardSpec({
          children: [emptyStateSpec({ message: `No workers match "${query.trim()}".` })],
        })
      : cardSpec({
          title: "Workers",
          children: [
            dataTableSpec({
              caption: "Pool workers",
              columns: WORKER_COLUMNS,
              rows: filteredRows.map(formatWorkerRow),
            }),
          ],
        });

  return el("div", {
    className: "workers-page",
    children: [heading, ...banners, searchBox, content],
  });
}

// -------------------------------------------------------------------
// DOM glue -- mount/unmount lifecycle
// -------------------------------------------------------------------

const EMPTY_PAGE_SPEC = el("div", { className: "workers-page" });

function defaultRender(container, spec, { reuseSearchInputNode = null } = {}) {
  const node = specToDom(spec);
  const freshInputNode = node.querySelector(".search-box__input");

  let searchInputNode = freshInputNode;
  if (reuseSearchInputNode && freshInputNode && freshInputNode.parentNode) {
    freshInputNode.parentNode.replaceChild(reuseSearchInputNode, freshInputNode);
    searchInputNode = reuseSearchInputNode;
  }

  container.replaceChildren(node);

  return {
    searchInputNode,
    clearButtonNode: node.querySelector(".search-box__clear"),
  };
}

let isMounted = false;
let mountToken = 0;
let searchInputNode = null;
let renderedStatus = null;
let currentSearchQuery = "";
let lastWorkersState = null;
let stopPollingFn = null;
let currentRender = defaultRender;
let currentContainer = null;

export function mount(
  container,
  { fetchImpl, intervalMs, staleAfterMs, render = defaultRender } = {},
) {
  if (isMounted) {
    throw new Error("workers.mount: already mounted -- call unmount() first");
  }
  isMounted = true;
  mountToken += 1;
  const myToken = mountToken;

  searchInputNode = null;
  renderedStatus = null;
  lastWorkersState = null;
  stopPollingFn = null;
  currentRender = render;
  currentContainer = container;
  currentSearchQuery = getState().searchQuery || "";

  function isCurrent() {
    return isMounted && mountToken === myToken;
  }

  const safeStaleAfterMs = Number.isFinite(staleAfterMs) && staleAfterMs > 0 ? staleAfterMs : undefined;
  const fetchOptions = { fetchImpl, validate: validateSchema, staleAfterMs: safeStaleAfterMs };

  function renderState(workersState) {
    lastWorkersState = workersState;

    const reuseInput =
      renderedStatus === "success" && workersState.status === "success" && Boolean(searchInputNode);

    const spec = buildWorkersSpec({ ...workersState, searchQuery: currentSearchQuery });
    const nodes = render(container, spec, {
      reuseSearchInputNode: reuseInput ? searchInputNode : null,
    });

    const isFreshInput = nodes.searchInputNode && nodes.searchInputNode !== searchInputNode;
    searchInputNode = nodes.searchInputNode || null;
    renderedStatus = workersState.status;

    if (isFreshInput) {
      searchInputNode.addEventListener("input", (event) => {
        if (!isCurrent()) return;
        currentSearchQuery = event.target.value;
        setState({ searchQuery: currentSearchQuery });
        renderState(lastWorkersState);
      });
    }

    if (nodes.clearButtonNode) {
      nodes.clearButtonNode.addEventListener("click", () => {
        if (!isCurrent()) return;
        currentSearchQuery = "";
        setState({ searchQuery: "" });
        if (searchInputNode) searchInputNode.value = "";
        renderState(lastWorkersState);
        if (searchInputNode) searchInputNode.focus();
      });
    }
  }

  function handleResult(result) {
    if (result.payload) {
      setState({
        analytics: result.payload,
        analyticsFetchedAt: result.fetchedAt ? result.fetchedAt.toISOString() : null,
      });
    }
    renderState(deriveWorkersState(result));
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

// Deliberately does not clear state.js's searchQuery -- same reasoning
// as users.js: the whole point of storing it there is that it
// survives a route change.
export function unmount() {
  if (!isMounted) return;
  isMounted = false;
  if (stopPollingFn) {
    stopPollingFn();
    stopPollingFn = null;
  }
  searchInputNode = null;
  renderedStatus = null;
  lastWorkersState = null;
  currentRender(currentContainer, EMPTY_PAGE_SPEC);
  currentContainer = null;
}
