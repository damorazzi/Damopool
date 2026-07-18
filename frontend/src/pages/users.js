// Users (list) page -- docs/ARCHITECTURE.md Section 4/5/9
// (`/app/#/users`). Third complete page module, and the first to
// render genuinely untrusted, attacker-influenceable text: usernames
// carry no charset restriction (docs/ARCHITECTURE.md Section 18).
// Every username that reaches this page's spec goes through el()'s
// `text` field (-> specToDom's textContent, never innerHTML) or an
// input's `value` attr (-> setAttribute, never string-concatenated
// markup) -- the same enforcement already relied on throughout this
// project, exercised here for the first time against data that is
// actually attacker-controlled rather than server-computed numbers.
//
// analytics.json's `users` object is a plain JSON dictionary keyed by
// those same unvalidated usernames (docs/ARCHITECTURE.md Section 13's
// __proto__/constructor-key warning). transformUsersData reads it
// exclusively via Object.entries (own enumerable properties only,
// never walks the prototype chain the way `for...in` would) and never
// spreads a user record onto another object under its own key --
// every row is built as a fresh object literal with fixed, known
// property names.
//
// Unlike overview.js/pool.js, this page has no chart -- a plain table
// and a text input both re-theme automatically via CSS custom
// properties, with no ECharts-specific repaint step needed, so there
// is no core/state.js theme subscription here. What replaces the
// chart-node-preservation concern from those pages is the search
// input: a full spec rebuild on every keystroke would destroy and
// recreate the <input> DOM node, silently stealing focus after every
// character typed. defaultRender swaps the freshly-built (throwaway)
// input for the actual, still-focused live one before inserting the
// new tree, the same technique overview.js/pool.js use to keep a
// chart's canvas node alive across a same-status re-render.

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

const ANALYTICS_ENDPOINT = "/analytics.json";

export const route = { pattern: "/users", name: "users" };

// Links each row to pages/user-detail.js -- added once that page
// existed to link to (docs/ARCHITECTURE.md Section 23's "add it when
// a page needs it" discipline, the same reasoning already applied to
// data-table.js's render() option and sorting). buildHash correctly
// encodes a username containing "/", "#", or "%" (docs/ARCHITECTURE.md
// Section 11) -- the same untrusted-text handling as every other
// reach of `username` on this page. No className here: the column's
// own `mono: true` (below) already puts base.css's .mono class on the
// <td>, and font-family inherits down to this anchor without needing
// its own copy of the class.
function usernameCellSpec(row) {
  return el("a", {
    attrs: { href: buildHash("/users/:username", { username: row.username }) },
    text: row.username,
  });
}

const USER_COLUMNS = [
  { key: "username", label: "Username", mono: true, render: usernameCellSpec },
  { key: "workerCount", label: "Workers", align: "right" },
  { key: "accepted", label: "Accepted", align: "right" },
  { key: "rejected", label: "Rejected", align: "right" },
  { key: "avgSdiff", label: "Avg Sdiff", align: "right" },
  { key: "bestToday", label: "Best Today", align: "right" },
  { key: "bestEver", label: "Best Ever", align: "right" },
];

// -------------------------------------------------------------------
// Pure data transformation
// -------------------------------------------------------------------

export function transformUsersData(payload) {
  const users = (payload && payload.users) || {};
  const rows = Object.entries(users)
    .map(([username, record]) => ({
      username,
      workerCount: Array.isArray(record.workers) ? record.workers.length : 0,
      acceptedCount: record.accepted_count,
      rejectedCount: record.rejected_count,
      averageSdiff: record.average_sdiff,
      bestShareToday: record.best_share_today || null,
      bestShareEver: record.best_share_ever || null,
    }))
    // A stable, predictable default order -- analytics.json's key
    // order is whatever analytics_builder.py happened to write, not a
    // meaningful sort. No sort-column UI exists yet (data-table.js
    // deliberately doesn't implement one -- see its own module
    // comment), so this is the one sensible default until it does.
    .sort((a, b) => a.username.localeCompare(b.username));

  return {
    generatedAt: (payload && payload.metadata && payload.metadata.generated_at) || null,
    rows,
  };
}

export function isUsersEmpty(payload) {
  const users = (payload && payload.users) || {};
  return Object.keys(users).length === 0;
}

function staleMessage(generatedAtIso) {
  const relative = formatRelativeTime(generatedAtIso);
  return relative ? `Data may be stale -- last updated ${relative}.` : "Data may be stale.";
}

export function deriveUsersState({ payload, error = null, isStale = false } = {}) {
  if (!payload) {
    return { status: "error", data: null, error, isStale: false };
  }
  const data = transformUsersData(payload);
  const status = isUsersEmpty(payload) ? "empty" : "success";
  return { status, data, error, isStale: Boolean(isStale) };
}

// Case-insensitive substring match on username. An empty/whitespace-only
// query is not a filter at all -- every row passes through unchanged.
export function filterUsersByQuery(rows, query) {
  const trimmed = (query || "").trim();
  if (!trimmed) return rows;
  const needle = trimmed.toLowerCase();
  return rows.filter((row) => row.username.toLowerCase().includes(needle));
}

// -------------------------------------------------------------------
// Pure table row formatting
// -------------------------------------------------------------------

function formatCount(n) {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : null;
}

export function formatUserRow(row) {
  return {
    username: row.username,
    workerCount: formatCount(row.workerCount),
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
    className: "users-page__loading",
    children: [loadingSkeletonSpec({ shape: "row", count: 5 })],
  });
}

export function buildUsersSpec(state) {
  const heading = el("h1", { className: "users-page__title", text: "Users" });

  if (state.status === "loading") {
    return el("div", { className: "users-page", children: [heading, loadingSectionSpec()] });
  }

  if (state.status === "error") {
    return el("div", {
      className: "users-page",
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
      className: "users-page",
      children: [
        heading,
        ...banners,
        cardSpec({ children: [emptyStateSpec({ message: "No users have been recorded yet." })] }),
      ],
    });
  }

  if (state.status !== "success") {
    throw new Error(`buildUsersSpec: unrecognized status "${state.status}"`);
  }

  const query = state.searchQuery || "";
  const filteredRows = filterUsersByQuery(state.data.rows, query);
  const searchBox = searchBoxSpec({ value: query, placeholder: "Search users", label: "Search users" });

  const content =
    query.trim() && filteredRows.length === 0
      ? cardSpec({
          children: [emptyStateSpec({ message: `No users match "${query.trim()}".` })],
        })
      : cardSpec({
          title: "Users",
          children: [
            dataTableSpec({
              caption: "Pool users",
              columns: USER_COLUMNS,
              rows: filteredRows.map(formatUserRow),
            }),
          ],
        });

  return el("div", {
    className: "users-page",
    children: [heading, ...banners, searchBox, content],
  });
}

// -------------------------------------------------------------------
// DOM glue -- mount/unmount lifecycle
// -------------------------------------------------------------------

const EMPTY_PAGE_SPEC = el("div", { className: "users-page" });

// Returns the search input node (reused if `reuseSearchInputNode` was
// supplied and a matching one exists in the freshly-built tree) and
// the freshly-built clear button, which is never reused -- unlike the
// input, losing/regaining the clear button across a render carries no
// focus/typing-state cost, so it is simplest to always rebuild it and
// (re)wire its listener every render, exactly like the rest of the
// page's non-stateful markup.
function defaultRender(container, spec, { reuseSearchInputNode = null } = {}) {
  const node = specToDom(spec);
  const freshInputNode = node.querySelector(".search-box__input");

  // Only ever report the *supplied* node as reused if the swap
  // actually happened -- reporting it unconditionally (e.g. via
  // `reuseSearchInputNode || freshInputNode`) would claim a node is
  // live in the newly-inserted tree without having verified it was
  // actually spliced in, if the swap guard below ever fails for a
  // reason the caller didn't anticipate.
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
let lastUsersState = null;
let stopPollingFn = null;
let currentRender = defaultRender;
let currentContainer = null;

export function mount(
  container,
  { fetchImpl, intervalMs, staleAfterMs, render = defaultRender } = {},
) {
  if (isMounted) {
    throw new Error("users.mount: already mounted -- call unmount() first");
  }
  isMounted = true;
  mountToken += 1;
  const myToken = mountToken;

  searchInputNode = null;
  renderedStatus = null;
  lastUsersState = null;
  stopPollingFn = null;
  currentRender = render;
  currentContainer = container;
  // docs/ARCHITECTURE.md Section 13: a search query is page-local UI
  // state that must survive a route change -- read back whatever the
  // user last typed here, rather than always starting blank.
  currentSearchQuery = getState().searchQuery || "";

  function isCurrent() {
    return isMounted && mountToken === myToken;
  }

  const safeStaleAfterMs = Number.isFinite(staleAfterMs) && staleAfterMs > 0 ? staleAfterMs : undefined;
  const fetchOptions = { fetchImpl, validate: validateSchema, staleAfterMs: safeStaleAfterMs };

  function renderState(usersState) {
    lastUsersState = usersState;

    const reuseInput =
      renderedStatus === "success" && usersState.status === "success" && Boolean(searchInputNode);

    const spec = buildUsersSpec({ ...usersState, searchQuery: currentSearchQuery });
    const nodes = render(container, spec, {
      reuseSearchInputNode: reuseInput ? searchInputNode : null,
    });

    const isFreshInput = nodes.searchInputNode && nodes.searchInputNode !== searchInputNode;
    searchInputNode = nodes.searchInputNode || null;
    renderedStatus = usersState.status;

    if (isFreshInput) {
      searchInputNode.addEventListener("input", (event) => {
        if (!isCurrent()) return;
        currentSearchQuery = event.target.value;
        setState({ searchQuery: currentSearchQuery });
        renderState(lastUsersState);
      });
    }

    if (nodes.clearButtonNode) {
      nodes.clearButtonNode.addEventListener("click", () => {
        if (!isCurrent()) return;
        currentSearchQuery = "";
        setState({ searchQuery: "" });
        if (searchInputNode) searchInputNode.value = "";
        renderState(lastUsersState);
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
    renderState(deriveUsersState(result));
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

// Deliberately does not clear state.js's searchQuery -- the whole
// point of storing it there rather than only in this module's own
// currentSearchQuery is that it survives a route change (Section 13);
// the next mount() reads it back.
export function unmount() {
  if (!isMounted) return;
  isMounted = false;
  if (stopPollingFn) {
    stopPollingFn();
    stopPollingFn = null;
  }
  searchInputNode = null;
  renderedStatus = null;
  lastUsersState = null;
  currentRender(currentContainer, EMPTY_PAGE_SPEC);
  currentContainer = null;
}
