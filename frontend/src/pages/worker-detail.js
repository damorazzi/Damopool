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
import { formatCompactSdiff, formatHashrate, formatProgressPercent, formatStillNeededMultiplier, formatRelativeTime, formatTimestamp, truncateWorkername } from "../core/format.js";
import { buildHash } from "../core/router.js";
import { cardSpec } from "../components/card.js";
import { statTileSpec } from "../components/stat-tile.js";
import { emptyStateSpec } from "../components/empty-state.js";
import { loadingSkeletonSpec } from "../components/loading-skeleton.js";
import { errorBannerSpec } from "../components/error-banner.js";
import { histogramPanelSpec } from "../components/histogram-panel.js";
import { blockProgressPanelSpec, emptyBlockProgress } from "../components/block-progress-panel.js";
import { createChart } from "../charts/chart.js";
import { buildEChartsTheme, readThemeTokens } from "../charts/theme-echarts.js";
import {
  DEFAULT_HISTOGRAM_DATASET,
  emptyHistogramDatasetPair,
  selectHistogramBucketData,
  histogramDatasetLabel,
  buildHistogramChartSummary,
  buildHistogramChartOption,
} from "../charts/histogram-chart.js";

const ANALYTICS_ENDPOINT = "/analytics.json";

export const route = { pattern: "/workers/:workername", name: "worker-detail" };

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
    // Phase E Milestone 28: CKPool's own native per-worker hashrate,
    // read verbatim -- never estimated/calculated by this project.
    hashrate1m: record.hashrate_1m,
    hashrate24h: record.hashrate_24h,
    // Phase E Milestone 29: this worker's own difficulty histogram
    // (both datasets), plus the pool-wide network difficulty (only
    // ever on payload.pool -- docs/ARCHITECTURE.md Section 25).
    difficultyHistogram: record.difficulty_histogram || emptyHistogramDatasetPair(),
    networkDifficulty: payload && payload.pool && payload.pool.network_difficulty,
    // Phase E Milestone 30: Block Progress Analytics -- present per-scope
    // (unlike network_difficulty above, no cross-reference into
    // payload.pool is needed; this worker's own block_progress already
    // includes the current pool-wide network_difficulty).
    blockProgress: record.block_progress || emptyBlockProgress(),
    // Phase E Milestone 31: this worker's own CURRENT CONNECTION SESSION
    // accepted/rejected counts -- additive alongside (never replacing)
    // acceptedCount/rejectedCount above, which remain lifetime totals.
    // Worker-scope only, per the approved brief -- no pool/user
    // equivalent exists.
    sessionAcceptedCount: record.session_accepted_count,
    sessionRejectedCount: record.session_rejected_count,
    sessionStartedAt: record.session_started_at || null,
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
      el("h1", {
        className: "worker-detail-page__title",
        attrs: { title: workername, "aria-label": `Worker: ${workername}` },
        text: `Worker: ${truncateWorkername(workername)}`,
      }),
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
      // Phase E Milestone 31: additive, alongside (never replacing) the
      // lifetime Accepted/Rejected Shares tiles above -- current
      // connection session only, per the approved brief.
      statTileSpec({ label: "Session Accepted", value: formatCount(data.sessionAcceptedCount) }),
      statTileSpec({ label: "Session Rejected", value: formatCount(data.sessionRejectedCount) }),
      statTileSpec({ label: "Invalid Result Count", value: formatCount(data.invalidResultCount) }),
      statTileSpec({ label: "Average Sdiff", value: formatCompactSdiff(data.averageSdiff) }),
      statTileSpec({ label: "Median Sdiff", value: formatCompactSdiff(data.medianSdiff) }),
      statTileSpec({ label: "Min Sdiff", value: formatCompactSdiff(data.minSdiff) }),
      statTileSpec({ label: "Max Sdiff", value: formatCompactSdiff(data.maxSdiff) }),
      statTileSpec({
        label: "Best Share Today",
        value: formatCompactSdiff(data.bestShareToday && data.bestShareToday.sdiff),
      }),
      statTileSpec({
        label: "Best Share Ever",
        value: formatCompactSdiff(data.bestShareEver && data.bestShareEver.sdiff),
      }),
      statTileSpec({ label: "Worker Hashrate (1m)", value: formatHashrate(data.hashrate1m) }),
      statTileSpec({ label: "Worker Hashrate (24h)", value: formatHashrate(data.hashrate24h) }),
    ],
  });
}

// Phase E Milestone 31: session_started_at shown as small supporting
// context under the stat tiles, per the approved brief -- explicitly
// NOT a separate tile of its own. Reuses stat-tile.css's own
// .stat-tile__label rule (small, --color-text-secondary) rather than
// introducing new CSS, since that's exactly the muted-caption look
// this needs and stat-tile.js itself stays unmodified.
function sessionCaptionSpec(data) {
  const since = formatTimestamp(data.sessionStartedAt);
  if (!since) return null;
  return el("p", { className: "worker-detail-page__session-caption stat-tile__label", text: `Current session since ${since}` });
}

// Phase E Milestone 29: the one histogram section shared, byte-
// identical logic-wise, with overview.js/user-detail.js -- only the
// title and the supplied dataset differ per page.
function histogramSectionSpec(data, histogramDataset) {
  const bucketData = selectHistogramBucketData(data.difficultyHistogram, histogramDataset);
  const label = histogramDatasetLabel(histogramDataset);
  return histogramPanelSpec({
    title: "Worker Share Difficulty Histogram",
    summary: buildHistogramChartSummary(bucketData, data.networkDifficulty, label),
    activeDataset: histogramDataset,
  });
}

// Phase E Milestone 30: the one Block Progress panel shared, byte-
// identical logic-wise, with overview.js/user-detail.js.
function blockProgressSectionSpec(data) {
  const bp = data.blockProgress;
  return blockProgressPanelSpec({
    networkDifficultyText: formatCompactSdiff(bp.network_difficulty),
    bestShareText: formatCompactSdiff(bp.best_share_difficulty),
    progressPercentText: formatProgressPercent(bp.progress_percent),
    stillNeededText: formatStillNeededMultiplier(bp.still_needed_multiplier),
  });
}

function loadingSectionSpec() {
  return el("div", {
    className: "worker-detail-page__loading",
    children: [
      loadingSkeletonSpec({ shape: "tile", count: 17, className: "tile-grid" }),
      loadingSkeletonSpec({ shape: "tile", count: 4, className: "tile-grid" }),
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
          children: [emptyStateSpec({ message: `No data found for worker "${truncateWorkername(state.workername)}".` })],
        }),
      ],
    });
  }

  if (state.status !== "success") {
    throw new Error(`buildWorkerDetailSpec: unrecognized status "${state.status}"`);
  }

  const sessionCaption = sessionCaptionSpec(state.data);

  return el("div", {
    className: "worker-detail-page",
    children: [
      headerSpec(state.workername),
      ...banners,
      statTilesSectionSpec(state.data),
      ...(sessionCaption ? [sessionCaption] : []),
      blockProgressSectionSpec(state.data),
      histogramSectionSpec(state.data, state.histogramDataset || DEFAULT_HISTOGRAM_DATASET),
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

  return {
    canvasNode: reuseCanvasNode || freshCanvasNode,
    toggleButtonNodes: Array.from(node.querySelectorAll(".dataset-toggle__button")),
  };
}

let isMounted = false;
let mountToken = 0;
let currentWorkername = null;
let chartHandle = null;
let chartCanvasNode = null;
let renderedStatus = null;
let currentDataset = DEFAULT_HISTOGRAM_DATASET;
let lastDetailState = null;
let lastDifficultyHistogram = null;
let lastNetworkDifficulty = null;
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
  currentDataset = DEFAULT_HISTOGRAM_DATASET;
  lastDetailState = null;
  lastDifficultyHistogram = null;
  lastNetworkDifficulty = null;
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

  function wireToggleButtons(toggleButtonNodes) {
    for (const button of toggleButtonNodes || []) {
      button.addEventListener("click", () => {
        if (!isCurrent()) return;
        const nextDataset = button.getAttribute("data-dataset");
        if (!nextDataset || nextDataset === currentDataset) return;
        currentDataset = nextDataset;
        if (lastDetailState) renderState(lastDetailState);
      });
    }
  }

  function renderState(detailState) {
    lastDetailState = detailState;

    const reuseChart =
      renderedStatus === "success" && detailState.status === "success" && chartHandle && chartCanvasNode;

    if (!reuseChart && chartHandle) {
      chartHandle.dispose();
      chartHandle = null;
      chartCanvasNode = null;
    }

    const spec = buildWorkerDetailSpec({ ...detailState, histogramDataset: currentDataset });
    const nodes = render(container, spec, {
      reuseCanvasNode: reuseChart ? chartCanvasNode : null,
    });
    const canvasNode = nodes && nodes.canvasNode;
    renderedStatus = detailState.status;

    wireToggleButtons(nodes && nodes.toggleButtonNodes);

    if (canvasNode && detailState.status === "success") {
      lastDifficultyHistogram = detailState.data.difficultyHistogram;
      lastNetworkDifficulty = detailState.data.networkDifficulty;
      const theme = buildEChartsTheme(readThemeTokensImpl());
      const bucketData = selectHistogramBucketData(lastDifficultyHistogram, currentDataset);
      const option = buildHistogramChartOption(bucketData, lastNetworkDifficulty, theme);
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
    if (chartHandle && renderedStatus === "success" && lastDifficultyHistogram) {
      const theme = buildEChartsTheme(readThemeTokensImpl());
      const bucketData = selectHistogramBucketData(lastDifficultyHistogram, currentDataset);
      chartHandle.update(buildHistogramChartOption(bucketData, lastNetworkDifficulty, theme));
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
  lastDetailState = null;
  lastDifficultyHistogram = null;
  lastNetworkDifficulty = null;
  const container = currentContainer;
  const render = currentRender;
  currentContainer = null;
  render(container, el("div", { className: "worker-detail-page" }));
}
