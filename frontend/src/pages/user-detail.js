// User Detail page -- docs/ARCHITECTURE.md Section 4/5/9/22
// (`/app/#/users/:username`). The first dynamic-route page: router.js
// has supported named segments since Milestone 3, and app.js's
// decideNavigation was made params-aware in Milestone 7 specifically
// anticipating this page, but no page had ever actually received a
// route param until now -- app.js's mount() call gains a `params`
// option this same milestone, forwarding `decision.params` for the
// first time (previously tracked in app.js's own bookkeeping but
// never passed through, since nothing consumed it).
//
// This is also the first real consumer of several already-built,
// previously-unused primitives: stat-tile.js's `trend` indicator
// (built for exactly this page's daily-best-improvement figure, per
// its own module comment), core/format.js's `formatPercentage`,
// core/router.js's `buildHash` (used here for the "back to Users"
// link and, in users.js, to link each row's username to this page),
// and layout.css's `.split-layout` grid (worker list beside the
// sdiff chart, matching the Section 22 wireframe).
//
// Reads two dictionaries analytics.json keys by unvalidated free text
// (docs/ARCHITECTURE.md Section 13): `users` (this page's own subject)
// and `workers` (cross-referenced for the subject's own worker list).
// Both are read via Object.entries/Object.keys only, the same
// dictionary-safety discipline as users.js/workers.js.

import { el, specToDom } from "../core/dom.js";
import { fetchEndpoint, startPolling } from "../core/api.js";
import { validateSchema, describeFetchError } from "../core/errors.js";
import { getState, setState, subscribe } from "../core/state.js";
import { formatCompactSdiff, formatSdiff, formatPercentage, formatRelativeTime } from "../core/format.js";
import { buildHash } from "../core/router.js";
import { cardSpec } from "../components/card.js";
import { statTileSpec } from "../components/stat-tile.js";
import { emptyStateSpec } from "../components/empty-state.js";
import { loadingSkeletonSpec } from "../components/loading-skeleton.js";
import { errorBannerSpec } from "../components/error-banner.js";
import { chartPanelSpec } from "../components/chart-panel.js";
import { dataTableSpec } from "../components/data-table.js";
import { badgeSpec } from "../components/badge.js";
import { createChart } from "../charts/chart.js";
import { buildEChartsTheme, readThemeTokens } from "../charts/theme-echarts.js";

const ANALYTICS_ENDPOINT = "/analytics.json";

export const route = { pattern: "/users/:username", name: "user-detail" };

const WINDOW_ORDER = ["15m", "1h", "24h"];
const WINDOW_LABELS = { "15m": "15 min", "1h": "1 hour", "24h": "24 hours" };

const WORKER_COLUMNS = [
  { key: "workername", label: "Workername", mono: true },
  { key: "status", label: "Status", render: (row) => badgeSpec({ variant: row.isActive ? "active" : "inactive" }) },
  { key: "lastShare", label: "Last Share", align: "right" },
  { key: "accepted", label: "Accepted", align: "right" },
];

// -------------------------------------------------------------------
// Pure data transformation
// -------------------------------------------------------------------

// `username`/`workername` are URL-supplied, fully visitor-controlled
// text -- no login, no backend validation before reaching here
// (docs/ARCHITECTURE.md Section 18) -- and every dictionary they key
// into (`payload.users`, `payload.workers`, a daily_bests date's
// `users`) is a plain object literal from JSON.parse. A bare bracket
// lookup (`dict[key]`) resolves through the prototype chain for a key
// that is not the dictionary's own property: `dict["constructor"]`
// returns the built-in Object constructor (truthy), `dict["toString"]`
// returns Object.prototype.toString, and so on for every Object.
// prototype member name. Navigating to a real Damopool pool with no
// user literally named "constructor" would otherwise flip this page
// from the required "not-found" state to a blank-but-"success" one.
// hasOwnProperty.call is the guard against exactly that -- it only
// matches an actual, own key JSON.parse put there.
function safeGet(dict, key) {
  return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : undefined;
}

// daily_bests holds only today and, where present, yesterday (UTC),
// keyed by YYYY-MM-DD (docs/ARCHITECTURE.md Section 25) -- a string
// sort of its keys is a correct chronological sort, so the latest
// entry is simply the lexicographically greatest key, with no
// dependency on the client's own clock or timezone agreeing with the
// server's "today".
function findLatestDailyBest(dailyBests, username) {
  const dates = Object.keys(dailyBests || {}).sort();
  const latestDate = dates.length > 0 ? dates[dates.length - 1] : null;
  if (!latestDate) return null;
  // latestDate itself came from Object.keys, so it's already a real
  // own key -- only the username lookup below is attacker-controlled.
  const usersForDate = (dailyBests[latestDate] && dailyBests[latestDate].users) || {};
  return safeGet(usersForDate, username) || null;
}

// Returns null if `username` has no record at all in payload.users --
// the caller (deriveUserDetailState) treats that as "not-found", a
// different case from an empty rows array (that's a list-page
// concept; a single-entity detail page's equivalent of "empty" is
// "this specific entity doesn't exist").
export function transformUserDetailData(payload, username) {
  const record = payload && payload.users && safeGet(payload.users, username);
  if (!record) return null;

  const allWorkers = (payload && payload.workers) || {};
  const workerRows = (Array.isArray(record.workers) ? record.workers : [])
    .map((workername) => {
      const workerRecord = safeGet(allWorkers, workername);
      return {
        workername,
        isActive: workerRecord ? Boolean(workerRecord.is_active) : false,
        acceptedCount: workerRecord ? workerRecord.accepted_count : undefined,
        lastShareAt: workerRecord ? workerRecord.last_share_at || null : null,
      };
    })
    .sort((a, b) => a.workername.localeCompare(b.workername));

  const dailyBest = findLatestDailyBest(payload && payload.daily_bests, username);

  return {
    generatedAt: (payload && payload.metadata && payload.metadata.generated_at) || null,
    username,
    acceptedCount: record.accepted_count,
    rejectedCount: record.rejected_count,
    averageSdiff: record.average_sdiff,
    bestShareEver: record.best_share_ever || null,
    rollingWindows: record.rolling_windows || {},
    workerRows,
    currentDailyBest: (dailyBest && dailyBest.current_daily_best) || null,
    previousDailyBest: (dailyBest && dailyBest.previous_daily_best) || null,
    improvementAmount: dailyBest ? dailyBest.improvement_amount : null,
    improvementPercentage: dailyBest ? dailyBest.improvement_percentage : null,
  };
}

function staleMessage(generatedAtIso) {
  const relative = formatRelativeTime(generatedAtIso);
  return relative ? `Data may be stale -- last updated ${relative}.` : "Data may be stale.";
}

export function deriveUserDetailState({ payload, username, error = null, isStale = false } = {}) {
  if (!payload) {
    return { status: "error", data: null, username, error, isStale: false };
  }
  const data = transformUserDetailData(payload, username);
  const status = data ? "success" : "not-found";
  return { status, data, username, error, isStale: Boolean(isStale) };
}

// -------------------------------------------------------------------
// Pure chart data transformation
// -------------------------------------------------------------------

export function buildUserWindowsChartOption(rollingWindows, theme = {}) {
  const windows = rollingWindows || {};
  const values = WINDOW_ORDER.map((key) => {
    const avg = windows[key] && windows[key].average_sdiff;
    return Number.isFinite(avg) ? avg : null;
  });

  return {
    backgroundColor: theme.backgroundColor || "transparent",
    textStyle: theme.textStyle || {},
    grid: { left: 56, right: 16, top: 24, bottom: 32, containLabel: true },
    xAxis: {
      type: "category",
      data: WINDOW_ORDER.map((key) => WINDOW_LABELS[key]),
      axisLine: theme.axisLine || {},
      axisLabel: theme.axisLabel || {},
    },
    yAxis: {
      type: "value",
      axisLine: theme.axisLine || {},
      axisLabel: theme.axisLabel || {},
      splitLine: theme.splitLine || {},
    },
    series: [
      {
        type: "bar",
        data: values,
        itemStyle: { color: theme.accentColor || undefined },
        barMaxWidth: 48,
      },
    ],
  };
}

// Feeds chartPanelSpec's `summary` prop -- accessible, screen-reader
// text (docs/ARCHITECTURE.md Section 17), not the visible chart.
// Deliberately full-precision formatSdiff, not formatCompactSdiff
// (Phase E Milestone 25) -- see overview.js's buildPoolWindowsChartSummary
// for the same reasoning and the same accidental-then-reverted history.
export function buildUserWindowsChartSummary(rollingWindows) {
  const windows = rollingWindows || {};
  const parts = WINDOW_ORDER.map((key) => {
    const avg = windows[key] && windows[key].average_sdiff;
    const formatted = Number.isFinite(avg) ? formatSdiff(avg) : "no data";
    return `${WINDOW_LABELS[key]}: ${formatted}`;
  });
  return `Average share difficulty by window -- ${parts.join(", ")}.`;
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
    isActive: row.isActive,
    lastShare: formatRelativeTime(row.lastShareAt),
    accepted: formatCount(row.acceptedCount),
  };
}

// -------------------------------------------------------------------
// Pure page-spec building
// -------------------------------------------------------------------

function headerSpec(username) {
  return el("div", {
    className: "user-detail-page__header",
    children: [
      el("a", {
        className: "user-detail-page__back-link",
        // buildHash's own encoding guarantee is irrelevant for a
        // static, param-free pattern, but going through it rather
        // than a literal "#/users" string keeps every hash link in
        // this codebase constructed the same way, not just the ones
        // that happen to need encoding.
        attrs: { href: buildHash("/users") },
        text: "← Back to Users",
      }),
      el("h1", { className: "user-detail-page__title", text: `User: ${username}` }),
    ],
  });
}

function statTilesSectionSpec(data) {
  return el("div", {
    className: "tile-grid",
    children: [
      statTileSpec({
        label: "Current Daily Best",
        value: formatCompactSdiff(data.currentDailyBest && data.currentDailyBest.sdiff),
      }),
      statTileSpec({
        label: "Previous Daily Best",
        value: formatCompactSdiff(data.previousDailyBest && data.previousDailyBest.sdiff),
      }),
      statTileSpec({
        label: "Daily Improvement",
        value: formatCompactSdiff(data.improvementAmount),
        // Exactly 0% is deliberately excluded from both directions --
        // an unchanged daily best is not "up" (docs/DESIGN_SYSTEM.md
        // Section 10.5's trend indicator is for "a meaningful daily
        // comparison"; showing a green up-arrow for zero improvement
        // would misleadingly imply progress that didn't happen).
        trend:
          Number.isFinite(data.improvementPercentage) && data.improvementPercentage !== 0
            ? {
                direction: data.improvementPercentage > 0 ? "up" : "down",
                label: formatPercentage(data.improvementPercentage),
              }
            : undefined,
      }),
      statTileSpec({ label: "Accepted Shares", value: formatCount(data.acceptedCount) }),
      statTileSpec({ label: "Rejected Shares", value: formatCount(data.rejectedCount) }),
      statTileSpec({ label: "Average Sdiff", value: formatCompactSdiff(data.averageSdiff) }),
      statTileSpec({
        label: "Best Share Ever",
        value: formatCompactSdiff(data.bestShareEver && data.bestShareEver.sdiff),
      }),
    ],
  });
}

function workerListSpec(workerRows) {
  if (workerRows.length === 0) {
    return cardSpec({
      title: "Workers",
      children: [emptyStateSpec({ message: "No workers found for this user." })],
    });
  }
  return cardSpec({
    title: "Workers",
    children: [
      dataTableSpec({
        caption: "This user's workers",
        columns: WORKER_COLUMNS,
        rows: workerRows.map(formatWorkerRow),
      }),
    ],
  });
}

function loadingSectionSpec() {
  return el("div", {
    className: "user-detail-page__loading",
    children: [
      loadingSkeletonSpec({ shape: "tile", count: 7, className: "tile-grid" }),
      loadingSkeletonSpec({ shape: "row", count: 3 }),
      loadingSkeletonSpec({ shape: "block", height: 320 }),
    ],
  });
}

export function buildUserDetailSpec(state) {
  if (state.status === "loading") {
    return el("div", {
      className: "user-detail-page",
      children: [headerSpec(state.username), loadingSectionSpec()],
    });
  }

  if (state.status === "error") {
    return el("div", {
      className: "user-detail-page",
      children: [headerSpec(state.username), errorBannerSpec({ message: describeFetchError(state.error), icon: "error" })],
    });
  }

  const banners = [];
  if (state.error) {
    banners.push(errorBannerSpec({ message: describeFetchError(state.error), icon: "error" }));
  } else if (state.isStale) {
    banners.push(errorBannerSpec({ message: staleMessage(state.data && state.data.generatedAt), icon: "warning" }));
  }

  if (state.status === "not-found") {
    return el("div", {
      className: "user-detail-page",
      children: [
        headerSpec(state.username),
        ...banners,
        cardSpec({
          children: [emptyStateSpec({ message: `No data found for user "${state.username}".` })],
        }),
      ],
    });
  }

  if (state.status !== "success") {
    throw new Error(`buildUserDetailSpec: unrecognized status "${state.status}"`);
  }

  return el("div", {
    className: "user-detail-page",
    children: [
      headerSpec(state.username),
      ...banners,
      statTilesSectionSpec(state.data),
      el("div", {
        className: "split-layout",
        children: [
          workerListSpec(state.data.workerRows),
          chartPanelSpec({
            title: "Average Share Difficulty",
            summary: buildUserWindowsChartSummary(state.data.rollingWindows),
          }),
        ],
      }),
    ],
  });
}

// -------------------------------------------------------------------
// DOM glue -- mount/unmount lifecycle
// -------------------------------------------------------------------

function defaultRender(container, spec, { reuseCanvasNode = null } = {}) {
  const node = specToDom(spec);
  const freshCanvasNode = node.querySelector(".chart-panel__canvas");

  if (reuseCanvasNode && freshCanvasNode && freshCanvasNode.parentNode) {
    freshCanvasNode.parentNode.replaceChild(reuseCanvasNode, freshCanvasNode);
  }

  container.replaceChildren(node);
  return reuseCanvasNode || freshCanvasNode;
}

let isMounted = false;
let mountToken = 0;
let currentUsername = null;
let chartHandle = null;
let chartCanvasNode = null;
let renderedStatus = null;
let lastRollingWindows = null;
let lastAppliedTheme = null;
let stopPollingFn = null;
let stopThemeSubscription = null;
let currentRender = defaultRender;
let currentContainer = null;

export function mount(
  container,
  {
    fetchImpl,
    intervalMs,
    staleAfterMs,
    render = defaultRender,
    createChartImpl = createChart,
    readThemeTokensImpl = readThemeTokens,
    params,
  } = {},
) {
  if (isMounted) {
    throw new Error("user-detail.mount: already mounted -- call unmount() first");
  }
  const username = params && params.username;
  if (!username) {
    throw new Error("user-detail.mount: params.username is required");
  }

  isMounted = true;
  mountToken += 1;
  const myToken = mountToken;

  currentUsername = username;
  chartHandle = null;
  chartCanvasNode = null;
  renderedStatus = null;
  lastRollingWindows = null;
  stopPollingFn = null;
  stopThemeSubscription = null;
  currentRender = render;
  currentContainer = container;
  lastAppliedTheme = getState().theme;

  function isCurrent() {
    return isMounted && mountToken === myToken;
  }

  const safeStaleAfterMs = Number.isFinite(staleAfterMs) && staleAfterMs > 0 ? staleAfterMs : undefined;
  const fetchOptions = { fetchImpl, validate: validateSchema, staleAfterMs: safeStaleAfterMs };

  function renderState(detailState) {
    const reuseChart =
      renderedStatus === "success" && detailState.status === "success" && chartHandle && chartCanvasNode;

    if (!reuseChart && chartHandle) {
      chartHandle.dispose();
      chartHandle = null;
      chartCanvasNode = null;
    }

    const spec = buildUserDetailSpec(detailState);
    const canvasNode = render(container, spec, {
      reuseCanvasNode: reuseChart ? chartCanvasNode : null,
    });
    renderedStatus = detailState.status;

    if (canvasNode && detailState.status === "success") {
      lastRollingWindows = detailState.data.rollingWindows;
      const theme = buildEChartsTheme(readThemeTokensImpl());
      const option = buildUserWindowsChartOption(lastRollingWindows, theme);
      if (reuseChart) {
        chartHandle.update(option);
      } else {
        chartHandle = createChartImpl(canvasNode, option);
      }
      chartCanvasNode = canvasNode;
    } else {
      chartCanvasNode = null;
    }
  }

  function handleResult(result) {
    if (result.payload) {
      setState({
        analytics: result.payload,
        analyticsFetchedAt: result.fetchedAt ? result.fetchedAt.toISOString() : null,
      });
    }
    renderState(deriveUserDetailState({ ...result, username: currentUsername }));
  }

  renderState({ status: "loading", username: currentUsername });

  stopThemeSubscription = subscribe((appState) => {
    if (!isCurrent()) return;
    if (appState.theme === lastAppliedTheme) return;
    lastAppliedTheme = appState.theme;
    if (chartHandle && renderedStatus === "success" && lastRollingWindows) {
      const theme = buildEChartsTheme(readThemeTokensImpl());
      chartHandle.update(buildUserWindowsChartOption(lastRollingWindows, theme));
    }
  });

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
  if (stopThemeSubscription) {
    stopThemeSubscription();
    stopThemeSubscription = null;
  }
  if (stopPollingFn) {
    stopPollingFn();
    stopPollingFn = null;
  }
  if (chartHandle) {
    chartHandle.dispose();
    chartHandle = null;
  }
  chartCanvasNode = null;
  renderedStatus = null;
  lastRollingWindows = null;
  const container = currentContainer;
  const render = currentRender;
  currentContainer = null;
  render(container, el("div", { className: "user-detail-page" }));
}
