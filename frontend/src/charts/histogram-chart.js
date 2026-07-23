// Phase E Milestone 29: Share Difficulty Distribution Histogram --
// pure ECharts-option/summary/tooltip logic shared, byte-identical,
// across Overview (Pool), User Detail, and Worker Detail (Human
// Approval Brief: "reused identically... only the supplied dataset
// differs"). This is the one and only place that logic lives; page
// modules call into this file rather than each rebuilding their own
// copy, the same "one reusable component" intent already established
// for chart-panel.js itself.
//
// BUCKET_BOUNDARIES mirrors histogram_builder.py's own permanent,
// fixed-forever constant of the same name -- independently duplicated
// across the Python/JavaScript boundary rather than shared, the same
// "mirror, don't import across an architectural/language boundary"
// precedent histogram_builder.py itself already established against
// analytics_state.py. These 11 values must never change without
// updating both files together -- the whole point of the fixed-bucket
// design (Human Approval Brief) is permanent comparability across
// pool/users/workers/time/future software versions.

import { formatCompactSdiff, formatSdiff } from "../core/format.js";

export const BUCKET_BOUNDARIES = Object.freeze([
  21_000,
  210_000,
  2_100_000,
  21_000_000,
  210_000_000,
  2_100_000_000,
  21_000_000_000,
  210_000_000_000,
  2_100_000_000_000,
  21_000_000_000_000,
  210_000_000_000_000,
]);
export const BUCKET_COUNT = BUCKET_BOUNDARIES.length + 1; // 12

// Human Approval Brief: exactly two datasets, no others.
export const HISTOGRAM_DATASETS = Object.freeze([
  Object.freeze({ key: "1d", label: "1 Day" }),
  Object.freeze({ key: "total", label: "Total (Lifetime)" }),
]);
export const DEFAULT_HISTOGRAM_DATASET = "1d";

function formatBoundary(value) {
  return formatCompactSdiff(value) || String(value);
}

// Bucket 0 is "< first boundary"; the last bucket (index BUCKET_COUNT-1)
// is permanently open-ended ("≥ last boundary") -- Human Approval Brief:
// "bucket 12 can be open ended, no need for more buckets."
export function bucketLabel(index) {
  if (!Number.isInteger(index) || index < 0 || index >= BUCKET_COUNT) {
    throw new Error(`bucketLabel: index ${index} out of range (0-${BUCKET_COUNT - 1})`);
  }
  if (index === 0) {
    return `< ${formatBoundary(BUCKET_BOUNDARIES[0])}`;
  }
  if (index === BUCKET_COUNT - 1) {
    return `≥ ${formatBoundary(BUCKET_BOUNDARIES[BUCKET_BOUNDARIES.length - 1])}`;
  }
  return `${formatBoundary(BUCKET_BOUNDARIES[index - 1])} – ${formatBoundary(BUCKET_BOUNDARIES[index])}`;
}

// Same bucketing rule as histogram_builder.py's own bucket_index --
// used here only to place the Network Difficulty Marker in the right
// category, never to compute a count (all counts always come verbatim
// from analytics.json, never recomputed client-side -- Human Approval
// Brief: "Do NOT estimate. Do NOT interpolate.").
export function bucketIndexForDifficulty(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  for (let i = 0; i < BUCKET_BOUNDARIES.length; i++) {
    if (value < BUCKET_BOUNDARIES[i]) return i;
  }
  return BUCKET_BOUNDARIES.length;
}

function emptyBucketData() {
  return { bucket_counts: new Array(BUCKET_COUNT).fill(0), bucket_best: new Array(BUCKET_COUNT).fill(null) };
}

// The same "well-formed all-zero shape, never a missing key" fallback
// histogram_builder.py's own empty_histogram_dataset_pair() guarantees
// server-side -- mirrored here as a defensive client-side default for
// a malformed/partial payload, not a normal expected path.
export function emptyHistogramDatasetPair() {
  return { "1d": emptyBucketData(), total: emptyBucketData() };
}

// Picks one dataset ("1d" or "total") out of a difficulty_histogram
// pair -- shared by every page module (overview.js/user-detail.js/
// worker-detail.js) rather than each re-deriving the same fallback.
// Degrades to an empty (all-zero) bucket shape for a missing/malformed
// pair or an unrecognized key, never throws -- a page's render path
// must not crash over a stale/partial payload mid-poll.
export function selectHistogramBucketData(pair, datasetKey) {
  const data = pair && pair[datasetKey];
  return data && Array.isArray(data.bucket_counts) ? data : emptyBucketData();
}

export function histogramDatasetLabel(datasetKey) {
  const found = HISTOGRAM_DATASETS.find((d) => d.key === datasetKey);
  return found ? found.label : HISTOGRAM_DATASETS[0].label;
}

function safeCounts(bucketData) {
  const counts = bucketData && Array.isArray(bucketData.bucket_counts) ? bucketData.bucket_counts : [];
  return Array.from({ length: BUCKET_COUNT }, (_, i) => (Number.isFinite(counts[i]) ? counts[i] : 0));
}

function safeBest(bucketData) {
  const best = bucketData && Array.isArray(bucketData.bucket_best) ? bucketData.bucket_best : [];
  return Array.from({ length: BUCKET_COUNT }, (_, i) => best[i] || null);
}

// -------------------------------------------------------------------
// Tooltip (per-bucket, plain text -- joined into an HTML string with
// <br/> by the option builder below, never innerHTML'd with anything
// but numbers/fixed labels this module itself produces, so there is no
// user-controlled text -- e.g. a username -- anywhere in this string).
// -------------------------------------------------------------------

export function buildBucketTooltipLines(index, bucketData) {
  const counts = safeCounts(bucketData);
  const bests = safeBest(bucketData);
  const count = counts[index];
  const total = counts.reduce((sum, c) => sum + c, 0);
  const percentage = total > 0 ? (count / total) * 100 : 0;
  const best = bests[index];
  const bestLine =
    best && Number.isFinite(best.sdiff) ? `Highest Solved Share: ${formatSdiff(best.sdiff)}` : "Highest Solved Share: none";

  return [
    `Difficulty Range: ${bucketLabel(index)}`,
    `Number of Solved Shares: ${count.toLocaleString("en-US")}`,
    `Percentage of Selected Dataset: ${percentage.toFixed(1)}%`,
    bestLine,
  ];
}

// -------------------------------------------------------------------
// Accessible summary (docs/ARCHITECTURE.md Section 17 / chart-panel.js:
// "each instance is paired with an adjacent accessible summary").
// -------------------------------------------------------------------

export function buildHistogramChartSummary(bucketData, networkDifficulty, datasetLabel) {
  const counts = safeCounts(bucketData);
  const totalShares = counts.reduce((sum, c) => sum + c, 0);
  const parts = counts.map((count, i) => `${bucketLabel(i)}: ${count.toLocaleString("en-US")}`);
  const netPart =
    typeof networkDifficulty === "number" && Number.isFinite(networkDifficulty)
      ? ` Current network difficulty: ${formatCompactSdiff(networkDifficulty)}.`
      : "";
  return (
    `Share difficulty distribution (${datasetLabel}) -- ${totalShares.toLocaleString("en-US")} solved shares ` +
    `across ${BUCKET_COUNT} fixed difficulty buckets: ${parts.join(", ")}.${netPart}`
  );
}

// -------------------------------------------------------------------
// ECharts option (pure data -> option shape; charts/chart.js itself
// stays the only ECharts-touching, DOM-dependent module).
// -------------------------------------------------------------------

export function buildHistogramChartOption(bucketData, networkDifficulty, theme = {}) {
  const counts = safeCounts(bucketData);
  const labels = Array.from({ length: BUCKET_COUNT }, (_, i) => bucketLabel(i));
  const netIndex = bucketIndexForDifficulty(networkDifficulty);

  const markLine =
    netIndex === null
      ? undefined
      : {
          silent: true,
          symbol: "none",
          animation: false,
          lineStyle: { color: theme.accentColor || undefined, type: "dashed", width: 2 },
          label: {
            formatter: `Network Difficulty (${formatCompactSdiff(networkDifficulty)})`,
            color: theme.textStyle ? theme.textStyle.color : undefined,
          },
          data: [{ xAxis: netIndex }],
        };

  return {
    backgroundColor: theme.backgroundColor || "transparent",
    textStyle: theme.textStyle || {},
    animation: false,
    grid: { left: 56, right: 16, top: 40, bottom: 64, containLabel: true },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: theme.axisLine || {},
      axisLabel: { ...(theme.axisLabel || {}), rotate: 30, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLine: theme.axisLine || {},
      axisLabel: theme.axisLabel || {},
      splitLine: theme.splitLine || {},
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter(params) {
        const dataIndex = Array.isArray(params) ? params[0].dataIndex : params.dataIndex;
        return buildBucketTooltipLines(dataIndex, bucketData).join("<br/>");
      },
    },
    series: [
      {
        type: "bar",
        data: counts,
        itemStyle: { color: theme.accentColor || undefined },
        barMaxWidth: 36,
        markLine,
      },
    ],
  };
}
