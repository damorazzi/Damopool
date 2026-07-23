import test from "node:test";
import assert from "node:assert/strict";
import {
  BUCKET_BOUNDARIES,
  BUCKET_COUNT,
  HISTOGRAM_DATASETS,
  DEFAULT_HISTOGRAM_DATASET,
  bucketLabel,
  bucketIndexForDifficulty,
  emptyHistogramDatasetPair,
  selectHistogramBucketData,
  histogramDatasetLabel,
  buildBucketTooltipLines,
  buildHistogramChartSummary,
  buildHistogramChartOption,
} from "../../src/charts/histogram-chart.js";

function bucketData(counts, best = []) {
  return {
    bucket_counts: counts,
    bucket_best: Array.from({ length: BUCKET_COUNT }, (_, i) => best[i] || null),
  };
}

test("BUCKET_BOUNDARIES / BUCKET_COUNT", async (t) => {
  await t.test("mirrors histogram_builder.py's own fixed 11 boundaries, x10 anchored on 21", () => {
    assert.deepEqual(BUCKET_BOUNDARIES, [
      21_000, 210_000, 2_100_000, 21_000_000, 210_000_000, 2_100_000_000,
      21_000_000_000, 210_000_000_000, 2_100_000_000_000, 21_000_000_000_000, 210_000_000_000_000,
    ]);
  });

  await t.test("12 buckets total (11 boundaries + 1 open-ended)", () => {
    assert.equal(BUCKET_COUNT, 12);
  });

  await t.test("is frozen -- must never be mutated at runtime", () => {
    assert.throws(() => {
      BUCKET_BOUNDARIES.push(999);
    });
  });
});

test("HISTOGRAM_DATASETS", async (t) => {
  await t.test("exactly two datasets, '1 Day' and 'Total (Lifetime)', no others", () => {
    assert.equal(HISTOGRAM_DATASETS.length, 2);
    assert.deepEqual(
      HISTOGRAM_DATASETS.map((d) => d.key),
      ["1d", "total"],
    );
    assert.deepEqual(
      HISTOGRAM_DATASETS.map((d) => d.label),
      ["1 Day", "Total (Lifetime)"],
    );
  });

  await t.test("default dataset is 1d", () => {
    assert.equal(DEFAULT_HISTOGRAM_DATASET, "1d");
  });
});

test("bucketLabel", async (t) => {
  await t.test("bucket 0 is open-ended below the first boundary", () => {
    assert.equal(bucketLabel(0), "< 21K");
  });

  await t.test("a middle bucket shows both boundaries", () => {
    assert.equal(bucketLabel(1), "21K – 210K");
    assert.equal(bucketLabel(5), "210M – 2.1G");
  });

  await t.test("bucket 11 (last) is permanently open-ended above the last boundary", () => {
    assert.equal(bucketLabel(11), "≥ 210T");
  });

  await t.test("throws on an out-of-range index", () => {
    assert.throws(() => bucketLabel(-1), /out of range/);
    assert.throws(() => bucketLabel(12), /out of range/);
    assert.throws(() => bucketLabel(1.5), /out of range/);
  });
});

test("bucketIndexForDifficulty", async (t) => {
  await t.test("places a value below the first boundary in bucket 0", () => {
    assert.equal(bucketIndexForDifficulty(500), 0);
  });

  await t.test("places the real current network difficulty (~127.17T) in the last finite bucket", () => {
    assert.equal(bucketIndexForDifficulty(127_170_500_429_035.2), 10);
  });

  await t.test("places a value at/above the last boundary in the open-ended last bucket", () => {
    assert.equal(bucketIndexForDifficulty(210_000_000_000_000), 11);
    assert.equal(bucketIndexForDifficulty(999_000_000_000_000), 11);
  });

  await t.test("a boundary value itself belongs to the higher bucket (< comparison, not <=)", () => {
    assert.equal(bucketIndexForDifficulty(21_000), 1);
  });

  await t.test("returns null for a non-finite/non-numeric value -- never estimates a placement", () => {
    assert.equal(bucketIndexForDifficulty(null), null);
    assert.equal(bucketIndexForDifficulty(undefined), null);
    assert.equal(bucketIndexForDifficulty(NaN), null);
    assert.equal(bucketIndexForDifficulty("127170500429035.2"), null);
  });
});

test("emptyHistogramDatasetPair", async (t) => {
  await t.test("both datasets present, all-zero counts, all-null bests", () => {
    const pair = emptyHistogramDatasetPair();
    assert.deepEqual(Object.keys(pair).sort(), ["1d", "total"]);
    for (const key of ["1d", "total"]) {
      assert.equal(pair[key].bucket_counts.length, BUCKET_COUNT);
      assert.ok(pair[key].bucket_counts.every((c) => c === 0));
      assert.equal(pair[key].bucket_best.length, BUCKET_COUNT);
      assert.ok(pair[key].bucket_best.every((b) => b === null));
    }
  });
});

test("selectHistogramBucketData", async (t) => {
  await t.test("picks the requested dataset out of a real pair", () => {
    const pair = { "1d": bucketData([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), total: bucketData([9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) };
    assert.deepEqual(selectHistogramBucketData(pair, "1d").bucket_counts[0], 1);
    assert.deepEqual(selectHistogramBucketData(pair, "total").bucket_counts[0], 9);
  });

  await t.test("degrades to an empty (all-zero) shape for a missing/malformed pair or key -- never throws", () => {
    assert.doesNotThrow(() => selectHistogramBucketData(null, "1d"));
    const empty = selectHistogramBucketData(null, "1d");
    assert.equal(empty.bucket_counts.length, BUCKET_COUNT);
    assert.ok(empty.bucket_counts.every((c) => c === 0));
    assert.deepEqual(selectHistogramBucketData({}, "1d").bucket_counts, empty.bucket_counts);
    assert.deepEqual(selectHistogramBucketData({ "1d": {} }, "1d").bucket_counts, empty.bucket_counts);
    assert.deepEqual(selectHistogramBucketData({ "1d": bucketData([]) }, "nonexistent-key").bucket_counts, empty.bucket_counts);
  });
});

test("histogramDatasetLabel", async (t) => {
  await t.test("maps each real key to its label", () => {
    assert.equal(histogramDatasetLabel("1d"), "1 Day");
    assert.equal(histogramDatasetLabel("total"), "Total (Lifetime)");
  });

  await t.test("falls back to the first dataset's label for an unrecognized key", () => {
    assert.equal(histogramDatasetLabel("bogus"), "1 Day");
  });
});

test("buildBucketTooltipLines", async (t) => {
  await t.test("reports range, count, percentage of the SELECTED dataset, and the bucket's own best", () => {
    const counts = new Array(BUCKET_COUNT).fill(0);
    counts[0] = 3;
    counts[1] = 1;
    const data = bucketData(counts, { 1: { sdiff: 150000, timestamp: "unknown" } });

    const lines = buildBucketTooltipLines(1, data);
    assert.equal(lines[0], `Difficulty Range: ${bucketLabel(1)}`);
    assert.equal(lines[1], "Number of Solved Shares: 1");
    assert.equal(lines[2], "Percentage of Selected Dataset: 25.0%");
    assert.match(lines[3], /Highest Solved Share: 150,000/);
  });

  await t.test("an empty bucket with no best share reports 'none', not a crash", () => {
    const data = bucketData(new Array(BUCKET_COUNT).fill(0));
    const lines = buildBucketTooltipLines(3, data);
    assert.equal(lines[1], "Number of Solved Shares: 0");
    assert.equal(lines[2], "Percentage of Selected Dataset: 0.0%");
    assert.equal(lines[3], "Highest Solved Share: none");
  });

  await t.test("degrades gracefully against a malformed/missing bucketData", () => {
    assert.doesNotThrow(() => buildBucketTooltipLines(0, null));
    assert.doesNotThrow(() => buildBucketTooltipLines(0, {}));
  });
});

test("buildHistogramChartSummary", async (t) => {
  await t.test("names the dataset, the total, every bucket's own count, and network difficulty when known", () => {
    const counts = new Array(BUCKET_COUNT).fill(0);
    counts[0] = 5;
    const data = bucketData(counts);
    const summary = buildHistogramChartSummary(data, 127_170_500_429_035.2, "1 Day");
    assert.match(summary, /^Share difficulty distribution \(1 Day\)/);
    assert.match(summary, /5 solved shares/);
    assert.match(summary, new RegExp(`${BUCKET_COUNT} fixed difficulty buckets`));
    assert.match(summary, /< 21K: 5/);
    assert.match(summary, /Current network difficulty: 127\.17T/);
  });

  await t.test("omits the network-difficulty sentence entirely when it is not a finite number", () => {
    const data = emptyHistogramDatasetPair()["1d"];
    const summary = buildHistogramChartSummary(data, null, "Total (Lifetime)");
    assert.ok(!summary.includes("Current network difficulty"));
  });
});

test("buildHistogramChartOption", async (t) => {
  await t.test("produces a 12-category bar series with counts verbatim from bucket_counts", () => {
    const counts = [1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 3];
    const data = bucketData(counts);
    const option = buildHistogramChartOption(data, null, {});
    assert.equal(option.xAxis.data.length, BUCKET_COUNT);
    assert.deepEqual(option.series[0].data, counts);
    assert.equal(option.series[0].type, "bar");
  });

  await t.test("adds a markLine at the bucket containing the network difficulty", () => {
    const data = emptyHistogramDatasetPair()["1d"];
    const option = buildHistogramChartOption(data, 127_170_500_429_035.2, {});
    assert.ok(option.series[0].markLine);
    assert.equal(option.series[0].markLine.data[0].xAxis, 10);
    assert.match(option.series[0].markLine.label.formatter, /Network Difficulty/);
  });

  await t.test("omits markLine entirely when network difficulty is unknown -- never a guessed marker position", () => {
    const data = emptyHistogramDatasetPair()["1d"];
    const option = buildHistogramChartOption(data, null, {});
    assert.equal(option.series[0].markLine, undefined);
  });

  await t.test("tooltip formatter returns the same lines as buildBucketTooltipLines, joined with <br/>", () => {
    const counts = new Array(BUCKET_COUNT).fill(0);
    counts[2] = 7;
    const data = bucketData(counts);
    const option = buildHistogramChartOption(data, null, {});
    const html = option.tooltip.formatter([{ dataIndex: 2 }]);
    assert.equal(html, buildBucketTooltipLines(2, data).join("<br/>"));
  });

  await t.test("applies theme colours when supplied, falls back cleanly when not", () => {
    const data = emptyHistogramDatasetPair()["1d"];
    const themed = buildHistogramChartOption(data, null, { backgroundColor: "transparent", accentColor: "#ffd700" });
    assert.equal(themed.series[0].itemStyle.color, "#ffd700");
    const untheme = buildHistogramChartOption(data, null, {});
    assert.equal(untheme.series[0].itemStyle.color, undefined);
  });
});
