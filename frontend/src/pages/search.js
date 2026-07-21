// Search page -- docs/ARCHITECTURE.md Section 4/5/9 (`/app/#/search`).
// The central, cross-entity search interface named in Section 9's
// route table (already anticipated by shell.js's APP_NAV_ITEMS since
// Milestone 5 -- no nav change needed here), distinct from the
// per-page filter boxes on users.js/workers.js: this page searches
// *both* dictionaries at once and groups the results by kind.
//
// Deliberately introduces no duplicate implementation of anything
// users.js/workers.js already do correctly: the dictionary transforms
// (`transformUsersData`/`transformWorkersData`), the filter logic
// (`filterUsersByQuery`/`filterWorkersByQuery`), the row formatters
// (`formatUserRow`/`formatWorkerRow`), and the linked-name cell
// builders (`usernameCellSpec`/`workernameCellSpec`, exported this
// same milestone specifically so this file could reuse them verbatim)
// are all imported and reused as-is, not reimplemented. This is
// additive reuse, not a refactor -- no existing file's behaviour
// changed, only two previously-private helpers became exported.
//
// No new prototype-chain risk exists here the way it did for the
// detail pages: the search query is only ever used as a substring
// (`.includes()`) inside an already-materialized array via
// filterUsersByQuery/filterWorkersByQuery, never as a direct bracket
// key into a dictionary -- there is nothing here for an attacker-
// controlled string to resolve through the prototype chain with.
//
// Like users.js/workers.js and unlike overview.js/pool.js/*-detail.js,
// this page has no chart, so there is no core/state.js theme
// subscription -- the same reasoning as those two pages: plain tables
// and a text input re-theme automatically via CSS custom properties.
// What it does need, exactly like users.js/workers.js, is the search-
// input-preservation DOM swap (a full spec rebuild on every keystroke
// would destroy and recreate the <input>, stealing focus after every
// character typed) and the shared, route-survivable core/state.js
// `searchQuery` field -- deliberately the *same* field users.js/
// workers.js already read/write, not a second, page-specific query
// field: "the current thing being searched for" is one coherent piece
// of UI state, not three separate ones that happen to coincide.

import { el, specToDom } from "../core/dom.js";
import { fetchEndpoint, startPolling } from "../core/api.js";
import { validateSchema, describeFetchError } from "../core/errors.js";
import { getState, setState } from "../core/state.js";
import { formatRelativeTime } from "../core/format.js";
import { cardSpec } from "../components/card.js";
import { emptyStateSpec } from "../components/empty-state.js";
import { loadingSkeletonSpec } from "../components/loading-skeleton.js";
import { errorBannerSpec } from "../components/error-banner.js";
import { dataTableSpec } from "../components/data-table.js";
import { searchBoxSpec } from "../components/search-box.js";
import { badgeSpec } from "../components/badge.js";
import {
  transformUsersData,
  filterUsersByQuery,
  formatUserRow,
  usernameCellSpec,
} from "./users.js";
import {
  transformWorkersData,
  filterWorkersByQuery,
  formatWorkerRow,
  workernameCellSpec,
} from "./workers.js";

const ANALYTICS_ENDPOINT = "/analytics.json";

export const route = { pattern: "/search", name: "search" };

// Deliberately a reduced column set compared to users.js's/workers.js's
// own USER_COLUMNS/WORKER_COLUMNS (2 columns here vs. 7/9 there): a
// search result is a lightweight index into the full list pages, not
// a replacement for them -- enough per row to recognize the right
// match and follow its link, not a duplicate of the detailed table
// those pages already own.
const USER_RESULT_COLUMNS = [
  { key: "username", label: "Username", mono: true, render: usernameCellSpec },
  { key: "workerCount", label: "Workers", align: "right" },
];

const WORKER_RESULT_COLUMNS = [
  { key: "workername", label: "Workername", mono: true, render: workernameCellSpec },
  { key: "status", label: "Status", render: (row) => badgeSpec({ variant: row.isActive ? "active" : "inactive" }) },
];

// -------------------------------------------------------------------
// Pure data transformation
// -------------------------------------------------------------------

// Reuses users.js's/workers.js's own transforms rather than walking
// payload.users/payload.workers a third way -- the unfiltered row
// lists this page searches against.
export function transformSearchData(payload) {
  return {
    generatedAt: (payload && payload.metadata && payload.metadata.generated_at) || null,
    userRows: transformUsersData(payload).rows,
    workerRows: transformWorkersData(payload).rows,
  };
}

function staleMessage(generatedAtIso) {
  const relative = formatRelativeTime(generatedAtIso);
  return relative ? `Data may be stale -- last updated ${relative}.` : "Data may be stale.";
}

// No "empty" status here, deliberately unlike overview.js/pool.js/
// users.js/workers.js: this page is never "empty" in their sense
// (there is nothing to hide behind an EmptyState just because the
// pool itself has no users/workers yet -- the query-driven guidance/
// no-matches states below already cover every real case correctly,
// including a genuinely empty pool, which just yields zero matches
// for any query).
export function deriveSearchState({ payload, error = null, isStale = false } = {}) {
  if (!payload) {
    return { status: "error", data: null, error, isStale: false };
  }
  const data = transformSearchData(payload);
  return { status: "success", data, error, isStale: Boolean(isStale) };
}

// An empty/whitespace-only query is "no query yet" (hasQuery: false),
// not "matched everything" -- distinct from users.js's/workers.js's
// own filter functions, which treat an empty query as "return every
// row" because their list view has something sensible to show either
// way. Reuses those same filter functions once a real query exists.
export function buildSearchResults(data, query) {
  const trimmed = (query || "").trim();
  if (!trimmed) {
    return { userResults: [], workerResults: [], hasQuery: false };
  }
  return {
    userResults: filterUsersByQuery(data.userRows, query),
    workerResults: filterWorkersByQuery(data.workerRows, query),
    hasQuery: true,
  };
}

// -------------------------------------------------------------------
// Pure page-spec building
// -------------------------------------------------------------------

function userResultsSpec(userResults) {
  return cardSpec({
    title: "Users",
    children: [
      dataTableSpec({
        caption: "Matching users",
        columns: USER_RESULT_COLUMNS,
        rows: userResults.map(formatUserRow),
      }),
    ],
  });
}

function workerResultsSpec(workerResults) {
  return cardSpec({
    title: "Workers",
    children: [
      dataTableSpec({
        caption: "Matching workers",
        columns: WORKER_RESULT_COLUMNS,
        rows: workerResults.map(formatWorkerRow),
      }),
    ],
  });
}

function loadingSectionSpec() {
  return el("div", {
    className: "search-page__loading",
    children: [loadingSkeletonSpec({ shape: "row", count: 3 })],
  });
}

export function buildSearchSpec(state) {
  const heading = el("h1", { className: "search-page__title", text: "Search" });

  if (state.status === "loading") {
    return el("div", { className: "search-page", children: [heading, loadingSectionSpec()] });
  }

  if (state.status === "error") {
    return el("div", {
      className: "search-page",
      children: [heading, errorBannerSpec({ message: describeFetchError(state.error), icon: "error" })],
    });
  }

  if (state.status !== "success") {
    throw new Error(`buildSearchSpec: unrecognized status "${state.status}"`);
  }

  const banners = [];
  if (state.error) {
    banners.push(errorBannerSpec({ message: describeFetchError(state.error), icon: "error" }));
  } else if (state.isStale) {
    banners.push(errorBannerSpec({ message: staleMessage(state.data.generatedAt), icon: "warning" }));
  }

  const query = state.searchQuery || "";
  const searchBox = searchBoxSpec({
    value: query,
    placeholder: "Search users or workers",
    label: "Search users or workers",
  });
  const results = buildSearchResults(state.data, query);

  let content;
  if (!results.hasQuery) {
    content = cardSpec({
      children: [emptyStateSpec({ message: "Type a username or workername to search." })],
    });
  } else if (results.userResults.length === 0 && results.workerResults.length === 0) {
    // Deliberately not truncated (Phase E username/workername truncation
    // pass, PROJECT_LOG.md): `query` is the visitor's own typed search
    // text, not a username/workername identifier being displayed back --
    // truncating what someone just typed would hide it from them, which
    // is a different concern than shortening a long BTC address in a
    // table or heading.
    content = cardSpec({
      children: [emptyStateSpec({ message: `No matches found for "${query.trim()}".` })],
    });
  } else {
    content = el("div", {
      className: "search-page__results",
      children: [
        results.userResults.length > 0 ? userResultsSpec(results.userResults) : null,
        results.workerResults.length > 0 ? workerResultsSpec(results.workerResults) : null,
      ].filter(Boolean),
    });
  }

  return el("div", {
    className: "search-page",
    children: [heading, ...banners, searchBox, content],
  });
}

// -------------------------------------------------------------------
// DOM glue -- mount/unmount lifecycle
// -------------------------------------------------------------------

const EMPTY_PAGE_SPEC = el("div", { className: "search-page" });

// Identical technique to users.js's/workers.js's defaultRender: swaps
// the freshly-built (throwaway) search input for the actual live one
// before inserting the new tree, so typing never loses focus.
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
let lastSearchState = null;
let stopPollingFn = null;
let currentRender = defaultRender;
let currentContainer = null;

export function mount(
  container,
  { fetchImpl, intervalMs, staleAfterMs, render = defaultRender } = {},
) {
  if (isMounted) {
    throw new Error("search.mount: already mounted -- call unmount() first");
  }
  isMounted = true;
  mountToken += 1;
  const myToken = mountToken;

  searchInputNode = null;
  renderedStatus = null;
  lastSearchState = null;
  stopPollingFn = null;
  currentRender = render;
  currentContainer = container;
  // docs/ARCHITECTURE.md Section 13: shared, route-survivable UI
  // state -- the same field users.js/workers.js already read/write.
  currentSearchQuery = getState().searchQuery || "";

  function isCurrent() {
    return isMounted && mountToken === myToken;
  }

  const safeStaleAfterMs = Number.isFinite(staleAfterMs) && staleAfterMs > 0 ? staleAfterMs : undefined;
  const fetchOptions = { fetchImpl, validate: validateSchema, staleAfterMs: safeStaleAfterMs };

  function renderState(searchState) {
    lastSearchState = searchState;

    const reuseInput =
      renderedStatus === "success" && searchState.status === "success" && Boolean(searchInputNode);

    const spec = buildSearchSpec({ ...searchState, searchQuery: currentSearchQuery });
    const nodes = render(container, spec, {
      reuseSearchInputNode: reuseInput ? searchInputNode : null,
    });

    const isFreshInput = nodes.searchInputNode && nodes.searchInputNode !== searchInputNode;
    searchInputNode = nodes.searchInputNode || null;
    renderedStatus = searchState.status;

    if (isFreshInput) {
      searchInputNode.addEventListener("input", (event) => {
        if (!isCurrent()) return;
        currentSearchQuery = event.target.value;
        setState({ searchQuery: currentSearchQuery });
        renderState(lastSearchState);
      });
    }

    if (nodes.clearButtonNode) {
      nodes.clearButtonNode.addEventListener("click", () => {
        if (!isCurrent()) return;
        currentSearchQuery = "";
        setState({ searchQuery: "" });
        if (searchInputNode) searchInputNode.value = "";
        renderState(lastSearchState);
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
    renderState(deriveSearchState(result));
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
// as users.js/workers.js: it must survive a route change, including a
// route change *to* Users/Workers, which is exactly the point of
// sharing this field with them.
export function unmount() {
  if (!isMounted) return;
  isMounted = false;
  if (stopPollingFn) {
    stopPollingFn();
    stopPollingFn = null;
  }
  searchInputNode = null;
  renderedStatus = null;
  lastSearchState = null;
  currentRender(currentContainer, EMPTY_PAGE_SPEC);
  currentContainer = null;
}
