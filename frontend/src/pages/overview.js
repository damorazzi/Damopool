// Dashboard Overview page -- docs/ARCHITECTURE.md Section 4/5/9
// (`/app/#/`), Section 22's Dashboard Overview wireframe. The first
// complete page module, proving the end-to-end architecture: shell
// (Milestone 5) + router contract + API layer (Milestone 4) + shared
// components + one focused chart.
//
// Split the same way as every prior DOM-producing module in this
// project (router.js, shell.js, dom.js): everything up to and
// including buildOverviewSpec is a pure function -- data
// transformation (transformOverviewData, deriveOverviewState) kept
// separate from spec-building (buildOverviewSpec and its helpers),
// both fully unit-tested with no DOM. mount()/unmount() are the thin
// DOM glue -- rendering real nodes, creating/disposing the ECharts
// instance, wiring the fetch/poll lifecycle -- and take every DOM-
// or ECharts-touching dependency (render, createChartImpl,
// readThemeTokensImpl) as an injectable parameter, so the
// *orchestration* logic (what gets fetched, when render is called,
// what gets cleaned up) is itself testable without a DOM emulation
// dependency, even though mount()/unmount() are not pure.

import { el, specToDom } from "../core/dom.js";
import { fetchEndpoint, startPolling } from "../core/api.js";
import { validateSchema, describeFetchError } from "../core/errors.js";
import { getState, setState, subscribe } from "../core/state.js";
import { formatSdiff, formatRelativeTime } from "../core/format.js";
import { cardSpec } from "../components/card.js";
import { statTileSpec } from "../components/stat-tile.js";
import { emptyStateSpec } from "../components/empty-state.js";
import { loadingSkeletonSpec } from "../components/loading-skeleton.js";
import { errorBannerSpec } from "../components/error-banner.js";
import { chartPanelSpec } from "../components/chart-panel.js";
import { createChart } from "../charts/chart.js";
import { buildEChartsTheme, readThemeTokens } from "../charts/theme-echarts.js";

const ANALYTICS_ENDPOINT = "/analytics.json";

// router.js's routes array expects `{ pattern, ...anything }` (Section
// 11); a future app bootstrap matches this against the current hash
// and calls mount()/unmount() on enter/leave, mirroring
// createRouter's onNavigate contract -- documented here rather than
// wired up, since no bootstrap module exists yet (the same "define
// the contract, wire it up when the consumer exists" pattern already
// used for shell.js's #main-content contract).
export const route = { pattern: "/", name: "overview" };

const WINDOW_ORDER = ["15m", "1h", "24h"];
const WINDOW_LABELS = { "15m": "15 min", "1h": "1 hour", "24h": "24 hours" };

// -------------------------------------------------------------------
// Pure data transformation
// -------------------------------------------------------------------

// Pulls exactly the fields this page renders out of the raw
// analytics.json payload (docs/ARCHITECTURE.md Section 25) -- kept
// separate from rendering so a future addition to this page's data
// needs (or a schema change) touches this function, not the spec
// builders below.
export function transformOverviewData(payload) {
  const pool = (payload && payload.pool) || {};
  return {
    generatedAt: (payload && payload.metadata && payload.metadata.generated_at) || null,
    acceptedCount: pool.accepted_count,
    rejectedCount: pool.rejected_count,
    bestShareToday: pool.best_share_today || null,
    bestShareEver: pool.best_share_ever || null,
    rollingWindows: pool.rolling_windows || {},
  };
}

// A genuinely empty pool -- no shares processed at all yet -- rather
// than a pool with legitimately zero *recent* activity (docs/
// ARCHITECTURE.md Section 16 point 3: "not a generic 'no data'").
// rolling_windows is deliberately not part of this check: a pool with
// real historical shares but zero shares in the last 15 minutes is not
// empty, it is quiet -- the chart correctly shows that as flat/zero
// bars rather than the page hiding real information behind EmptyState.
export function isOverviewEmpty(pool) {
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

// Combines a core/api.js fetchEndpoint()/startPolling() result into
// this page's own render state. `status` is one of "error" (no data
// at all to show), "empty", or "success" -- "loading" is not produced
// here, it is the state mount() renders synchronously before the
// first fetch resolves, since there is no fetch result to derive it
// from. `error` and `isStale` are orthogonal to `status`: per docs/
// ARCHITECTURE.md Section 16.2, a fetch can fail while a last-good
// cached payload still exists, in which case status reflects the
// (still valid) cached data and `error` carries the failure to render
// alongside it.
export function deriveOverviewState({ payload, error = null, isStale = false } = {}) {
  if (!payload) {
    return { status: "error", data: null, error, isStale: false };
  }
  const data = transformOverviewData(payload);
  const status = isOverviewEmpty(payload.pool) ? "empty" : "success";
  return { status, data, error, isStale: Boolean(isStale) };
}

// -------------------------------------------------------------------
// Pure chart data transformation
// -------------------------------------------------------------------

export function buildPoolWindowsChartOption(rollingWindows, theme = {}) {
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

export function buildPoolWindowsChartSummary(rollingWindows) {
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

// The Dashboard Overview wireframe (docs/ARCHITECTURE.md Section 22)
// shows a "Pool hashrate" tile, but hashrate is not part of
// analytics.json's schema (Section 25) -- Section 3.4 names
// pool_stats.json as its actual source, a second endpoint deliberately
// not added to this milestone (only analytics.json is fetched here).
// These four tiles are the wireframe's intent applied to the data this
// page actually has: every field below is a real analytics.json
// `pool` field.
function statTilesSectionSpec(data) {
  return el("div", {
    className: "tile-grid",
    children: [
      statTileSpec({ label: "Accepted Shares", value: formatCount(data.acceptedCount) }),
      statTileSpec({ label: "Rejected Shares", value: formatCount(data.rejectedCount) }),
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
    className: "overview-page__loading",
    children: [
      loadingSkeletonSpec({ shape: "tile", count: 4, className: "tile-grid" }),
      loadingSkeletonSpec({ shape: "block", height: 320 }),
    ],
  });
}

// The one pure function every render path (mount's first synchronous
// render, every subsequent poll tick) goes through -- docs/
// ARCHITECTURE.md Section 16 point 1: background refreshes must not
// re-show the loading skeleton, which this satisfies structurally
// (deriveOverviewState never produces "loading", so a poll-driven
// re-render can never land back on the loading branch below).
export function buildOverviewSpec(state) {
  const heading = el("h1", { className: "overview-page__title", text: "Overview" });

  if (state.status === "loading") {
    return el("div", { className: "overview-page", children: [heading, loadingSectionSpec()] });
  }

  if (state.status === "error") {
    return el("div", {
      className: "overview-page",
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
      className: "overview-page",
      children: [
        heading,
        ...banners,
        cardSpec({ children: [emptyStateSpec({ message: "No shares have been recorded yet." })] }),
      ],
    });
  }

  if (state.status !== "success") {
    // Fails loudly on an unrecognized status rather than silently
    // falling through to the success-rendering branch below with
    // state.data possibly undefined -- matches this codebase's
    // established fail-on-bad-input convention (badge.js's unknown
    // variant, router.js's buildHash missing param).
    throw new Error(`buildOverviewSpec: unrecognized status "${state.status}"`);
  }

  return el("div", {
    className: "overview-page",
    children: [
      heading,
      ...banners,
      statTilesSectionSpec(state.data),
      chartPanelSpec({
        title: "Average Share Difficulty",
        summary: buildPoolWindowsChartSummary(state.data.rollingWindows),
      }),
    ],
  });
}

// -------------------------------------------------------------------
// DOM glue -- mount/unmount lifecycle
// -------------------------------------------------------------------

const EMPTY_PAGE_SPEC = el("div", { className: "overview-page" });

// specToDom + a real container -- never exercised in unit tests
// (mount() takes `render` as an injectable parameter specifically so
// tests can supply a fake instead, per this project's no-DOM-
// emulation-dependency constraint).
//
// docs/ARCHITECTURE.md Section 16 point 1 / Section 20: a background
// poll landing on the same "success" status as the render it replaces
// must not visibly reload the page or flash the (canvas-rendered,
// therefore genuinely expensive to tear down and redraw) chart.
// Rebuilding the stat tiles/banners/heading every render is cheap and
// imperceptible either way, so this always does a full
// specToDom()/replaceChildren() rebuild for that part -- but when
// `reuseCanvasNode` is supplied, the freshly-built (throwaway) canvas
// div inside the new tree is swapped out for the *actual*, still-live
// canvas node the previous chart instance is attached to, before that
// tree is inserted. The result: text/structure always reflects the
// latest data, but the one visually-disruptive element (the chart)
// physically never leaves the DOM across a same-status re-render, so
// there is nothing for the caller to dispose/recreate.
function defaultRender(container, spec, { reuseCanvasNode = null } = {}) {
  const node = specToDom(spec);
  const freshCanvasNode = node.querySelector(".chart-panel__canvas");

  if (reuseCanvasNode && freshCanvasNode && freshCanvasNode.parentNode) {
    freshCanvasNode.parentNode.replaceChild(reuseCanvasNode, freshCanvasNode);
  }

  container.replaceChildren(node);
  return reuseCanvasNode || freshCanvasNode;
}

// Module-singleton lifecycle state -- consistent with core/state.js's
// and core/api.js's own module-singleton design, and correct here
// because docs/ARCHITECTURE.md Section 3.4's single-page dashboard app
// only ever has exactly one active page mounted at a time.
//
// `mountToken` guards against a stale in-flight fetch/poll from a
// *previous* mount() call resolving after unmount() was immediately
// followed by a new mount() -- a plain boolean is not enough there,
// since the new mount() also sets it back to "mounted," which would
// let the old promise's continuation through incorrectly (it would
// dispose/overwrite the *new* mount's chart, and could silently
// orphan the new mount's own stopPollingFn). Every mount() call
// captures the token's value at that moment; every async continuation
// compares against the *current* token, not just an "is something
// mounted" flag.
let isMounted = false;
let mountToken = 0;
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
  } = {},
) {
  if (isMounted) {
    throw new Error("overview.mount: already mounted -- call unmount() first");
  }
  isMounted = true;
  mountToken += 1;
  const myToken = mountToken;

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

  // staleAfterMs has no approved default (core/errors.js's
  // getStaleness/core/api.js's fetchEndpoint both require an explicit
  // caller-supplied threshold for the same reason) -- silently
  // dropping a malformed value here, rather than passing it through
  // to throw deep inside getStaleness, matches intervalMs's own
  // silent-skip-if-invalid handling below instead of surfacing a
  // caller configuration bug as a misleading "network error" banner.
  const safeStaleAfterMs = Number.isFinite(staleAfterMs) && staleAfterMs > 0 ? staleAfterMs : undefined;
  const fetchOptions = { fetchImpl, validate: validateSchema, staleAfterMs: safeStaleAfterMs };

  function renderState(overviewState) {
    const reuseChart =
      renderedStatus === "success" &&
      overviewState.status === "success" &&
      chartHandle &&
      chartCanvasNode;

    if (!reuseChart && chartHandle) {
      chartHandle.dispose();
      chartHandle = null;
      chartCanvasNode = null;
    }

    const spec = buildOverviewSpec(overviewState);
    const canvasNode = render(container, spec, {
      reuseCanvasNode: reuseChart ? chartCanvasNode : null,
    });
    renderedStatus = overviewState.status;

    if (canvasNode && overviewState.status === "success") {
      lastRollingWindows = overviewState.data.rollingWindows;
      const theme = buildEChartsTheme(readThemeTokensImpl());
      const option = buildPoolWindowsChartOption(lastRollingWindows, theme);
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
    renderState(deriveOverviewState(result));
  }

  renderState({ status: "loading" });

  stopThemeSubscription = subscribe((appState) => {
    if (!isCurrent()) return;
    // docs/DESIGN_SYSTEM.md Section 10.6: "chart colours always match
    // the active theme." Every other element repaints instantly via
    // CSS custom properties reacting to shell.js's data-theme
    // attribute; the canvas-rendered chart does not get that for
    // free, so it is repainted explicitly here -- but only on an
    // actual theme change (state.js's subscribe fires on every
    // setState call, not just theme ones) and only when a chart is
    // currently showing.
    if (appState.theme === lastAppliedTheme) return;
    lastAppliedTheme = appState.theme;
    if (chartHandle && renderedStatus === "success" && lastRollingWindows) {
      const theme = buildEChartsTheme(readThemeTokensImpl());
      chartHandle.update(buildPoolWindowsChartOption(lastRollingWindows, theme));
    }
  });

  (async () => {
    const result = await fetchEndpoint(ANALYTICS_ENDPOINT, fetchOptions);
    if (!isCurrent()) return; // unmounted (or superseded by a new mount()) before this resolved
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

// docs/ARCHITECTURE.md Section 14: dispose() is guaranteed on route
// teardown, preventing the memory/canvas leaks hash-routed SPAs are
// prone to when charts aren't explicitly cleaned up. Safe to call when
// nothing is mounted (a no-op), matching this project's other
// idempotent-teardown precedent (core/api.js's stopPolling). Clears
// the container back to an empty page shell via the same injected
// `render` the mount used, rather than leaving a torn-down chart's
// now-inert canvas (and the rest of the last-rendered page) visible
// indefinitely if no immediately-following mount() replaces it.
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
  currentRender(currentContainer, EMPTY_PAGE_SPEC);
  currentContainer = null;
}
