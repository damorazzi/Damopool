// Worker Detail page -- docs/ARCHITECTURE.md Section 4/5/9
// (`/app/#/workers/:workername`). The second dynamic-route page,
// mirroring user-detail.js's structure closely (chart with canvas-
// node-preservation and a theme-repaint subscription, the mountToken
// stale-remount guard, a mandatory params.workername).
//
// Deliberately simpler than user-detail.js in two ways, both directly
// following from what's actually in analytics.json (docs/
// ARCHITECTURE.md Section 25), not an oversight: Section 5 composes
// worker-detail.js from "StatTile x N, ChartPanel" only -- no
// DataTable, no .split-layout -- because a worker has no sub-entities
// the way a user has workers; and analytics.json's daily_bests object
// is keyed by username only, with no per-worker equivalent, so there
// is no daily-best/improvement tile here the way there is on
// user-detail.js.
//
// Applies the lesson from user-detail.js's own Code Reviewer finding
// proactively (DEVELOPMENT_PROCESS.md Section 4): `workername` is
// URL-supplied, fully visitor-controlled text (Section 18), so the
// lookup into `payload.workers` uses the same hasOwnProperty-guarded
// safeGet from the start, not added after the fact.

import { el, specToDom } from "../core/dom.js";
import { fetchEndpoint, startPolling } from "../core/api.js";
import { validateSchema, describeFetchError } from "../core/errors.js";
import { getState, setState, subscribe } from "../core/state.js";
import { formatSdiff, formatRelativeTime } from "../core/format.js";
import { buildHash } from "../core/router.js";
import { cardSpec } from "../components/card.js";
import { statTileSpec } from "../components/stat-tile.js";
import { emptyStateSpec } from "../components/empty-state.js";
import { loadingSkeletonSpec } from "../components/loading-skeleton.js";
import { errorBannerSpec } from "../components/error-banner.js";
import { chartPanelSpec } from "../components/chart-panel.js";
import { createChart } from "../charts/chart.js";
import { buildEChartsTheme, readThemeTokens } from "../charts/theme-echarts.js";

const ANALYTICS_ENDPOINT = "/analytics.json";

export const route = { pattern: "/workers/:workername", name: "worker-detail" };

const WINDOW_ORDER = ["15m", "1h", "24h"];
const WINDOW_LABELS = { "15m": "15 min", "1h": "1 hour", "24h": "24 hours" };

// -------------------------------------------------------------------
// Pure data transformation
// -------------------------------------------------------------------

// See user-detail.js's identical helper for why this guard exists:
// `dict[key]` for a key that isn't `dict`'s own property resolves
// through the prototype chain (`dict["constructor"]` returns the real
// Object constructor, truthy), which would otherwise let a URL like
// #/workers/constructor bypass the not-found check.
function safeGet(dict, key) {
  return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : undefined;
}

// Returns null if `workername` has no record at all in payload.workers
// -- the caller (deriveWorkerDetailState) treats that as "not-found".
export function transformWorkerDetailData(payload, workername) {
  const record = payload && payload.workers && safeGet(payload.workers, workername);
  if (!record) return null;

  return {
    generatedAt: (payload && payload.metadata && payload.metadata.generated_at) || null,
    workername,
    agent: record.agent || null,
    isActive: Boolean(record.is_active),
    firstShareAt: record.first_share_at || null,
    lastShareAt: record.last_share_at || null,
    acceptedCount: record.accepted_count,
    rejectedCount: record.rejected_count,
    invalidResultCount: record.invalid_result_count,
    averageSdiff: record.average_sdiff,
    medianSdiff: record.median_sdiff,
    minSdiff: record.min_sdiff,
    maxSdiff: record.max_sdiff,
    bestShareToday: record.best_share_today || null,
    bestShareEver: record.best_share_ever || null,
    rollingWindows: record.rolling_windows || {},
  };
}

function staleMessage(generatedAtIso) {
  const relative = formatRelativeTime(generatedAtIso);
  return relative ? `Data may be stale -- last updated ${relative}.` : "Data may be stale.";
}

export function deriveWorkerDetailState({ payload, workername, error = null, isStale = false } = {}) {
  if (!payload) {
    return { status: "error", data: null, workername, error, isStale: false };
  }
  const data = transformWorkerDetailData(payload, workername);
  const status = data ? "success" : "not-found";
  return { status, data, workername, error, isStale: Boolean(isStale) };
}

// -------------------------------------------------------------------
// Pure chart data transformation
// -------------------------------------------------------------------

export function buildWorkerWindowsChartOption(rollingWindows, theme = {}) {
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

export function buildWorkerWindowsChartSummary(rollingWindows) {
  const windows = rollingWindows || {};
  const parts = WINDOW_ORDER.map((key) => {
    const avg = windows[key] && windows[key].average_sdiff;
    const formatted = Number.isFinite(avg) ? formatSdiff(avg) : "no data";
    return `${WINDOW_LABELS[key]}: ${formatted}`;
  });
  return `Average share difficulty by window -- ${parts.join(", ")}.`;
}

// -------------------------------------------------------------------
// Pure page-spec building
// -------------------------------------------------------------------

function formatCount(n) {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : null;
}

function headerSpec(workername) {
  return el("div", {
    className: "worker-detail-page__header",
    children: [
      el("a", {
        className: "worker-detail-page__back-link",
        attrs: { href: buildHash("/workers") },
        text: "← Back to Workers",
      }),
      el("h1", { className: "worker-detail-page__title", text: `Worker: ${workername}` }),
    ],
  });
}

function statTilesSectionSpec(data) {
  return el("div", {
    className: "tile-grid",
    children: [
      statTileSpec({ label: "Status", value: data.isActive ? "Active" : "Inactive" }),
      statTileSpec({ label: "Agent", value: data.agent }),
      statTileSpec({ label: "First Seen", value: formatRelativeTime(data.firstShareAt) }),
      statTileSpec({ label: "Last Share", value: formatRelativeTime(data.lastShareAt) }),
      statTileSpec({ label: "Accepted Shares", value: formatCount(data.acceptedCount) }),
      statTileSpec({ label: "Rejected Shares", value: formatCount(data.rejectedCount) }),
      statTileSpec({ label: "Invalid Result Count", value: formatCount(data.invalidResultCount) }),
      statTileSpec({ label: "Average Sdiff", value: formatSdiff(data.averageSdiff) }),
      statTileSpec({ label: "Median Sdiff", value: formatSdiff(data.medianSdiff) }),
      statTileSpec({ label: "Min Sdiff", value: formatSdiff(data.minSdiff) }),
      statTileSpec({ label: "Max Sdiff", value: formatSdiff(data.maxSdiff) }),
      statTileSpec({
        label: "Best Share Today",
        value: formatSdiff(data.bestShareToday && data.bestShareToday.sdiff),
      }),
      statTileSpec({
        label: "Best Share Ever",
        value: formatSdiff(data.bestShareEver && data.bestShareEver.sdiff),
      }),
    ],
  });
}

function loadingSectionSpec() {
  return el("div", {
    className: "worker-detail-page__loading",
    children: [
      loadingSkeletonSpec({ shape: "tile", count: 13, className: "tile-grid" }),
      loadingSkeletonSpec({ shape: "block", height: 320 }),
    ],
  });
}

export function buildWorkerDetailSpec(state) {
  if (state.status === "loading") {
    return el("div", {
      className: "worker-detail-page",
      children: [headerSpec(state.workername), loadingSectionSpec()],
    });
  }

  if (state.status === "error") {
    return el("div", {
      className: "worker-detail-page",
      children: [
        headerSpec(state.workername),
        errorBannerSpec({ message: describeFetchError(state.error), icon: "error" }),
      ],
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
      className: "worker-detail-page",
      children: [
        headerSpec(state.workername),
        ...banners,
        cardSpec({
          children: [emptyStateSpec({ message: `No data found for worker "${state.workername}".` })],
        }),
      ],
    });
  }

  if (state.status !== "success") {
    throw new Error(`buildWorkerDetailSpec: unrecognized status "${state.status}"`);
  }

  return el("div", {
    className: "worker-detail-page",
    children: [
      headerSpec(state.workername),
      ...banners,
      statTilesSectionSpec(state.data),
      chartPanelSpec({
        title: "Average Share Difficulty",
        summary: buildWorkerWindowsChartSummary(state.data.rollingWindows),
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
let currentWorkername = null;
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
    throw new Error("worker-detail.mount: already mounted -- call unmount() first");
  }
  const workername = params && params.workername;
  if (!workername) {
    throw new Error("worker-detail.mount: params.workername is required");
  }

  isMounted = true;
  mountToken += 1;
  const myToken = mountToken;

  currentWorkername = workername;
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

    const spec = buildWorkerDetailSpec(detailState);
    const canvasNode = render(container, spec, {
      reuseCanvasNode: reuseChart ? chartCanvasNode : null,
    });
    renderedStatus = detailState.status;

    if (canvasNode && detailState.status === "success") {
      lastRollingWindows = detailState.data.rollingWindows;
      const theme = buildEChartsTheme(readThemeTokensImpl());
      const option = buildWorkerWindowsChartOption(lastRollingWindows, theme);
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
    renderState(deriveWorkerDetailState({ ...result, workername: currentWorkername }));
  }

  renderState({ status: "loading", workername: currentWorkername });

  stopThemeSubscription = subscribe((appState) => {
    if (!isCurrent()) return;
    if (appState.theme === lastAppliedTheme) return;
    lastAppliedTheme = appState.theme;
    if (chartHandle && renderedStatus === "success" && lastRollingWindows) {
      const theme = buildEChartsTheme(readThemeTokensImpl());
      chartHandle.update(buildWorkerWindowsChartOption(lastRollingWindows, theme));
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
  render(container, el("div", { className: "worker-detail-page" }));
}
