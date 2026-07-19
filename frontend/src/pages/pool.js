// Pool Statistics page -- docs/ARCHITECTURE.md Section 4/5/9
// (`/app/#/pool`). Second complete page module, exercising the
// extensibility path Milestone 7 built: one new route, one page
// module, reusing shell.js's already-existing "Pool" nav entry
// (Milestone 5's APP_NAV_ITEMS already anticipated this page).
//
// Distinct from Overview by design, not by accident: Overview shows
// the "at a glance" figures (accepted/rejected/best shares) and a
// rolling-windows *chart*. This page shows the detail Overview
// deliberately left out -- the sdiff distribution (average, median,
// min, max), the percentile breakdown as its own chart, and the
// rolling-windows figures as a real table rather than a single
// summary chart -- so the two pages complement rather than repeat
// each other.
//
// Split the same way as overview.js and every other DOM-producing
// module in this project: pure data transformation and pure
// spec-building are fully unit-tested with no DOM; mount()/unmount()
// are the thin DOM glue, with every DOM/ECharts-touching dependency
// injectable for testability.
//
// describeFetchError is imported from core/errors.js, not duplicated
// here -- it was extracted (with explicit Human approval, per
// DEVELOPMENT_PROCESS.md Section 5's governance over editing
// previously-shipped files) once a fourth page (Workers) needed it,
// replacing what were three identical copies here, in overview.js,
// and in users.js. The pool-emptiness check below remains a
// deliberate local duplicate of overview.js's isOverviewEmpty: it is
// small and, unlike describeFetchError, was never named as a shared
// trigger point -- revisited independently if that changes.

import { el, specToDom } from "../core/dom.js";
import { fetchEndpoint, startPolling } from "../core/api.js";
import { validateSchema, describeFetchError } from "../core/errors.js";
import { getState, setState, subscribe } from "../core/state.js";
import { formatCompactSdiff, formatSdiff, formatRelativeTime } from "../core/format.js";
import { cardSpec } from "../components/card.js";
import { statTileSpec } from "../components/stat-tile.js";
import { emptyStateSpec } from "../components/empty-state.js";
import { loadingSkeletonSpec } from "../components/loading-skeleton.js";
import { errorBannerSpec } from "../components/error-banner.js";
import { chartPanelSpec } from "../components/chart-panel.js";
import { dataTableSpec } from "../components/data-table.js";
import { createChart } from "../charts/chart.js";
import { buildEChartsTheme, readThemeTokens } from "../charts/theme-echarts.js";

const ANALYTICS_ENDPOINT = "/analytics.json";

export const route = { pattern: "/pool", name: "pool" };

const WINDOW_ORDER = ["15m", "1h", "24h"];
const WINDOW_LABELS = { "15m": "15 min", "1h": "1 hour", "24h": "24 hours" };
const PERCENTILE_ORDER = ["p50", "p90", "p99"];
const PERCENTILE_LABELS = { p50: "p50", p90: "p90", p99: "p99" };

const ROLLING_WINDOWS_COLUMNS = [
  { key: "window", label: "Window" },
  { key: "accepted", label: "Accepted", align: "right" },
  { key: "rejected", label: "Rejected", align: "right" },
  { key: "avgSdiff", label: "Avg Sdiff", align: "right" },
  { key: "frequency", label: "Shares/min", align: "right" },
];

// -------------------------------------------------------------------
// Pure data transformation
// -------------------------------------------------------------------

export function transformPoolData(payload) {
  const pool = (payload && payload.pool) || {};
  const percentiles = pool.percentiles || {};
  return {
    generatedAt: (payload && payload.metadata && payload.metadata.generated_at) || null,
    acceptedCount: pool.accepted_count,
    rejectedCount: pool.rejected_count,
    invalidResultCount: pool.invalid_result_count,
    averageSdiff: pool.average_sdiff,
    medianSdiff: pool.median_sdiff,
    minSdiff: pool.min_sdiff,
    maxSdiff: pool.max_sdiff,
    percentiles: {
      p50: percentiles.p50,
      p90: percentiles.p90,
      p99: percentiles.p99,
    },
    rollingWindows: pool.rolling_windows || {},
  };
}

// Identical criterion to overview.js's isOverviewEmpty -- see the
// module comment above for why this is duplicated rather than shared.
//
// best_share_today/best_share_ever are checked here purely as an
// emptiness signal, even though this page does not render either
// field (Overview's stat tiles already do) -- a pool can have real
// historical best shares while its accepted/rejected counts happen to
// read zero (a boundary condition, not the common case), and checking
// all four fields is what actually distinguishes "genuinely no shares
// ever" from "quiet right now," matching overview.js's identical
// reasoning for its own tiles.
export function isPoolEmpty(pool) {
  if (!pool) return true;
  const hasAccepted = Number.isFinite(pool.accepted_count) && pool.accepted_count > 0;
  const hasRejected = Number.isFinite(pool.rejected_count) && pool.rejected_count > 0;
  const hasBestToday = pool.best_share_today != null;
  const hasBestEver = pool.best_share_ever != null;
  return !hasAccepted && !hasRejected && !hasBestToday && !hasBestEver;
}

function staleMessage(generatedAtIso) {
  const relative = formatRelativeTime(generatedAtIso);
  return relative ? `Data may be stale -- last updated ${relative}.` : "Data may be stale.";
}

export function derivePoolState({ payload, error = null, isStale = false } = {}) {
  if (!payload) {
    return { status: "error", data: null, error, isStale: false };
  }
  const data = transformPoolData(payload);
  const status = isPoolEmpty(payload.pool) ? "empty" : "success";
  return { status, data, error, isStale: Boolean(isStale) };
}

// -------------------------------------------------------------------
// Pure chart data transformation
// -------------------------------------------------------------------

export function buildPercentilesChartOption(percentiles, theme = {}) {
  const values = PERCENTILE_ORDER.map((key) => {
    const value = percentiles && percentiles[key];
    return Number.isFinite(value) ? value : null;
  });

  return {
    backgroundColor: theme.backgroundColor || "transparent",
    textStyle: theme.textStyle || {},
    grid: { left: 56, right: 16, top: 24, bottom: 32, containLabel: true },
    xAxis: {
      type: "category",
      data: PERCENTILE_ORDER.map((key) => PERCENTILE_LABELS[key]),
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
export function buildPercentilesChartSummary(percentiles) {
  const parts = PERCENTILE_ORDER.map((key) => {
    const value = percentiles && percentiles[key];
    const formatted = Number.isFinite(value) ? formatSdiff(value) : "no data";
    return `${PERCENTILE_LABELS[key]}: ${formatted}`;
  });
  return `Share difficulty percentiles -- ${parts.join(", ")}.`;
}

// -------------------------------------------------------------------
// Pure table data transformation
// -------------------------------------------------------------------

function formatCount(n) {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : null;
}

function formatRate(n) {
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

export function buildRollingWindowsRows(rollingWindows) {
  const windows = rollingWindows || {};
  return WINDOW_ORDER.map((key) => {
    const w = windows[key];
    return {
      window: WINDOW_LABELS[key],
      accepted: w ? formatCount(w.accepted) : null,
      rejected: w ? formatCount(w.rejected) : null,
      avgSdiff: formatCompactSdiff(w && w.average_sdiff),
      frequency: w ? formatRate(w.share_frequency_per_minute) : null,
    };
  });
}

// -------------------------------------------------------------------
// Pure page-spec building
// -------------------------------------------------------------------

function statTilesSectionSpec(data) {
  return el("div", {
    className: "tile-grid",
    children: [
      statTileSpec({ label: "Accepted Shares", value: formatCount(data.acceptedCount) }),
      statTileSpec({ label: "Rejected Shares", value: formatCount(data.rejectedCount) }),
      statTileSpec({ label: "Invalid Result Count", value: formatCount(data.invalidResultCount) }),
      statTileSpec({ label: "Average Sdiff", value: formatCompactSdiff(data.averageSdiff) }),
      statTileSpec({ label: "Median Sdiff", value: formatCompactSdiff(data.medianSdiff) }),
      statTileSpec({ label: "Min Sdiff", value: formatCompactSdiff(data.minSdiff) }),
      statTileSpec({ label: "Max Sdiff", value: formatCompactSdiff(data.maxSdiff) }),
    ],
  });
}

function rollingWindowsTableSpec(rollingWindows) {
  return cardSpec({
    title: "Rolling Windows",
    children: [
      dataTableSpec({
        caption: "Pool share statistics by rolling time window",
        columns: ROLLING_WINDOWS_COLUMNS,
        rows: buildRollingWindowsRows(rollingWindows),
      }),
    ],
  });
}

function loadingSectionSpec() {
  return el("div", {
    className: "pool-page__loading",
    children: [
      loadingSkeletonSpec({ shape: "tile", count: 7, className: "tile-grid" }),
      loadingSkeletonSpec({ shape: "block", height: 320 }),
      loadingSkeletonSpec({ shape: "row", count: 3 }),
    ],
  });
}

export function buildPoolSpec(state) {
  const heading = el("h1", { className: "pool-page__title", text: "Pool Statistics" });

  if (state.status === "loading") {
    return el("div", { className: "pool-page", children: [heading, loadingSectionSpec()] });
  }

  if (state.status === "error") {
    return el("div", {
      className: "pool-page",
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
      className: "pool-page",
      children: [
        heading,
        ...banners,
        cardSpec({ children: [emptyStateSpec({ message: "No shares have been recorded yet." })] }),
      ],
    });
  }

  if (state.status !== "success") {
    throw new Error(`buildPoolSpec: unrecognized status "${state.status}"`);
  }

  return el("div", {
    className: "pool-page",
    children: [
      heading,
      ...banners,
      statTilesSectionSpec(state.data),
      chartPanelSpec({
        title: "Share Difficulty Percentiles",
        summary: buildPercentilesChartSummary(state.data.percentiles),
      }),
      rollingWindowsTableSpec(state.data.rollingWindows),
    ],
  });
}

// -------------------------------------------------------------------
// DOM glue -- mount/unmount lifecycle
// -------------------------------------------------------------------

const EMPTY_PAGE_SPEC = el("div", { className: "pool-page" });

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
let chartHandle = null;
let chartCanvasNode = null;
let renderedStatus = null;
let lastPercentiles = null;
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
  } = {},
) {
  if (isMounted) {
    throw new Error("pool.mount: already mounted -- call unmount() first");
  }
  isMounted = true;
  mountToken += 1;
  const myToken = mountToken;

  chartHandle = null;
  chartCanvasNode = null;
  renderedStatus = null;
  lastPercentiles = null;
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

  function renderState(poolState) {
    const reuseChart =
      renderedStatus === "success" && poolState.status === "success" && chartHandle && chartCanvasNode;

    if (!reuseChart && chartHandle) {
      chartHandle.dispose();
      chartHandle = null;
      chartCanvasNode = null;
    }

    const spec = buildPoolSpec(poolState);
    const canvasNode = render(container, spec, {
      reuseCanvasNode: reuseChart ? chartCanvasNode : null,
    });
    renderedStatus = poolState.status;

    if (canvasNode && poolState.status === "success") {
      lastPercentiles = poolState.data.percentiles;
      const theme = buildEChartsTheme(readThemeTokensImpl());
      const option = buildPercentilesChartOption(lastPercentiles, theme);
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
    renderState(derivePoolState(result));
  }

  renderState({ status: "loading" });

  stopThemeSubscription = subscribe((appState) => {
    if (!isCurrent()) return;
    if (appState.theme === lastAppliedTheme) return;
    lastAppliedTheme = appState.theme;
    if (chartHandle && renderedStatus === "success" && lastPercentiles) {
      const theme = buildEChartsTheme(readThemeTokensImpl());
      chartHandle.update(buildPercentilesChartOption(lastPercentiles, theme));
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
  lastPercentiles = null;
  currentRender(currentContainer, EMPTY_PAGE_SPEC);
  currentContainer = null;
}
