import test from "node:test";
import assert from "node:assert/strict";
import {
  route,
  parseSizeString,
  formatHashrate,
  formatCompactDifficulty,
  transformHistoryData,
  isValidHistoricalData,
  deriveHistoryState,
  buildHashrateChartOption,
  buildHashrateChartSummary,
  buildSharesChartOption,
  buildSharesChartSummary,
  buildDifficultyChartOption,
  buildDifficultyChartSummary,
  buildActivityChartOption,
  buildActivityChartSummary,
  buildHistorySpec,
  mount,
  unmount,
} from "../../src/pages/history.js";
import { getState, setState } from "../../src/core/state.js";
import { FetchApiError } from "../../src/core/api.js";

function sampleEntry(overrides = {}) {
  return {
    timestamp: "2026-07-18T09:00:00.000Z",
    pool_stats: {
      timestamp: "2026-07-18T09:00:00.000Z",
      pool_hashrate: "14.2T",
      workers: 4,
      users: 3,
      accepted_shares: 38818023432,
      rejected_shares: 141631622,
      highest_difficulty: "241.08G",
      runtime: "0d 0h 6m",
      user_stats: [],
      config_version: "1.2",
    },
    config_version: "1.2",
    ...overrides,
  };
}

function samplePayload() {
  return [
    sampleEntry({
      timestamp: "2026-07-18T09:00:00.000Z",
      pool_stats: {
        ...sampleEntry().pool_stats,
        pool_hashrate: "14.2T",
        accepted_shares: 38800000000,
        rejected_shares: 141000000,
        highest_difficulty: "241.08G",
        workers: 4,
        users: 3,
      },
    }),
    sampleEntry({
      timestamp: "2026-07-18T10:00:00.000Z",
      pool_stats: {
        ...sampleEntry().pool_stats,
        pool_hashrate: "13.7T",
        accepted_shares: 38860000000,
        rejected_shares: 141600000,
        highest_difficulty: "241.08G",
        workers: 4,
        users: 3,
      },
    }),
  ];
}

function findByClassName(spec, className) {
  if (!spec || typeof spec !== "object") return null;
  const classes = (spec.className || "").split(" ");
  if (classes.includes(className)) return spec;
  for (const child of spec.children || []) {
    const found = findByClassName(child, className);
    if (found) return found;
  }
  return null;
}

function findAllByClassName(spec, className, out = []) {
  if (!spec || typeof spec !== "object") return out;
  const classes = (spec.className || "").split(" ");
  if (classes.includes(className)) out.push(spec);
  for (const child of spec.children || []) {
    findAllByClassName(child, className, out);
  }
  return out;
}

test("route", async (t) => {
  await t.test("matches router.js's routes-array shape and is distinct from every other page's", () => {
    assert.equal(route.pattern, "/history");
    assert.equal(route.name, "history");
  });
});

test("parseSizeString", async (t) => {
  await t.test("parses a legacy suffixed string into a plain number of base units", () => {
    assert.equal(parseSizeString("14.2T"), 14.2e12);
    assert.equal(parseSizeString("541.00G"), 541e9);
    assert.equal(parseSizeString("2.04G"), 2.04e9);
    assert.equal(parseSizeString("500M"), 500e6);
    assert.equal(parseSizeString("1K"), 1e3);
    assert.equal(parseSizeString("1P"), 1e15);
  });

  await t.test("is case-insensitive on the unit letter", () => {
    assert.equal(parseSizeString("14.2t"), 14.2e12);
  });

  await t.test("a bare number string with no unit is the value itself", () => {
    assert.equal(parseSizeString("38818023432"), 38818023432);
    assert.equal(parseSizeString("0"), 0);
  });

  await t.test("passes an already-numeric value straight through", () => {
    assert.equal(parseSizeString(14200000000000), 14200000000000);
    assert.equal(parseSizeString(NaN), null);
  });

  await t.test("allows whitespace between the number and the unit", () => {
    assert.equal(parseSizeString("14.2 T"), 14.2e12);
  });

  await t.test("a negative value is parsed correctly, sign preserved", () => {
    assert.equal(parseSizeString("-14.2T"), -14.2e12);
    assert.equal(parseSizeString(-500), -500);
  });

  await t.test("a malformed or unrecognized string returns null, not a throw", () => {
    assert.equal(parseSizeString("not-a-number"), null);
    assert.equal(parseSizeString("14.2X"), null);
    assert.equal(parseSizeString(""), null);
    assert.equal(parseSizeString(null), null);
    assert.equal(parseSizeString(undefined), null);
    assert.equal(parseSizeString({}), null);
  });
});

test("formatHashrate", async (t) => {
  await t.test("scales to the largest unit that keeps the number readable", () => {
    assert.equal(formatHashrate(14.2e12), "14.20 TH/s");
    assert.equal(formatHashrate(541e9), "541.00 GH/s");
    assert.equal(formatHashrate(500), "500.00 H/s");
  });

  await t.test("a negative value keeps its sign", () => {
    assert.equal(formatHashrate(-14.2e12), "-14.20 TH/s");
  });

  await t.test("a non-finite value returns null, not a throw or 'NaN' string", () => {
    assert.equal(formatHashrate(NaN), null);
    assert.equal(formatHashrate(undefined), null);
    assert.equal(formatHashrate(null), null);
  });
});

test("formatCompactDifficulty", async (t) => {
  await t.test("scales to the largest unit, with no H/s suffix", () => {
    assert.equal(formatCompactDifficulty(241.08e9), "241.08 G");
    assert.equal(formatCompactDifficulty(500), "500.00");
  });

  await t.test("a non-finite value returns null", () => {
    assert.equal(formatCompactDifficulty(NaN), null);
  });
});

test("transformHistoryData", async (t) => {
  await t.test("builds one snapshot per entry, parsing suffixed fields into numbers", () => {
    const data = transformHistoryData(samplePayload());
    assert.equal(data.snapshots.length, 2);
    assert.equal(data.snapshots[0].hashrate, 14.2e12);
    assert.equal(data.snapshots[0].acceptedShares, 38800000000);
    assert.equal(data.snapshots[0].rejectedShares, 141000000);
    assert.equal(data.snapshots[0].highestDifficulty, 241.08e9);
    assert.equal(data.snapshots[0].workers, 4);
    assert.equal(data.snapshots[0].users, 3);
  });

  await t.test("sorts ascending by timestamp regardless of the input array's own order", () => {
    const reversed = [...samplePayload()].reverse();
    const data = transformHistoryData(reversed);
    assert.equal(data.snapshots[0].timestamp, "2026-07-18T09:00:00.000Z");
    assert.equal(data.snapshots[1].timestamp, "2026-07-18T10:00:00.000Z");
  });

  await t.test("drops an entry with no timestamp or no pool_stats, rather than throwing", () => {
    const payload = [
      sampleEntry({ timestamp: null }),
      sampleEntry({ pool_stats: undefined }),
      sampleEntry({ timestamp: "2026-07-18T09:00:00.000Z" }),
    ];
    const data = transformHistoryData(payload);
    assert.equal(data.snapshots.length, 1);
  });

  await t.test("drops an entry whose timestamp is truthy but unparseable, not sorted as NaN", () => {
    const payload = [
      sampleEntry({ timestamp: "not-a-real-timestamp" }),
      sampleEntry({ timestamp: "2026-07-18T09:00:00.000Z" }),
    ];
    const data = transformHistoryData(payload);
    assert.equal(data.snapshots.length, 1);
    assert.equal(data.snapshots[0].timestamp, "2026-07-18T09:00:00.000Z");
  });

  await t.test("degrades gracefully when the payload is not an array at all", () => {
    assert.deepEqual(transformHistoryData(null).snapshots, []);
    assert.deepEqual(transformHistoryData(undefined).snapshots, []);
    assert.deepEqual(transformHistoryData({}).snapshots, []);
    assert.deepEqual(transformHistoryData("not-an-array").snapshots, []);
  });

  await t.test("a malformed pool_hashrate/highest_difficulty parses to null, not a throw", () => {
    const payload = [sampleEntry({ pool_stats: { ...sampleEntry().pool_stats, pool_hashrate: "garbage", highest_difficulty: undefined } })];
    const data = transformHistoryData(payload);
    assert.equal(data.snapshots[0].hashrate, null);
    assert.equal(data.snapshots[0].highestDifficulty, null);
  });
});

test("isValidHistoricalData", async (t) => {
  await t.test("any array is valid, including an empty one", () => {
    assert.deepEqual(isValidHistoricalData([]), { valid: true, reason: null });
    assert.deepEqual(isValidHistoricalData(samplePayload()), { valid: true, reason: null });
  });

  await t.test("anything that is not an array is invalid", () => {
    assert.equal(isValidHistoricalData({}).valid, false);
    assert.equal(isValidHistoricalData(null).valid, false);
    assert.equal(isValidHistoricalData("not-an-array").valid, false);
    assert.equal(isValidHistoricalData(42).valid, false);
  });
});

test("deriveHistoryState", async (t) => {
  await t.test("no payload at all is status error with no data", () => {
    const state = deriveHistoryState({ payload: null, error: new Error("boom") });
    assert.equal(state.status, "error");
    assert.equal(state.data, null);
  });

  await t.test("an empty array is status empty", () => {
    const state = deriveHistoryState({ payload: [] });
    assert.equal(state.status, "empty");
  });

  await t.test("real data is status success", () => {
    const state = deriveHistoryState({ payload: samplePayload() });
    assert.equal(state.status, "success");
  });

  await t.test("an error alongside a cached payload keeps status success and carries the error", () => {
    const error = new FetchApiError("x", { endpoint: "/historical_data", kind: "network" });
    const state = deriveHistoryState({ payload: samplePayload(), error });
    assert.equal(state.status, "success");
    assert.equal(state.error, error);
  });

  await t.test("no staleAfterMs supplied means never stale, regardless of how old the latest snapshot is", () => {
    const state = deriveHistoryState({ payload: samplePayload() });
    assert.equal(state.isStale, false);
  });

  await t.test("staleAfterMs is compared against the *latest* snapshot's own timestamp, not metadata.generated_at", () => {
    const recentPayload = [
      sampleEntry({ timestamp: new Date(Date.now() - 30 * 60_000).toISOString() }),
      sampleEntry({ timestamp: new Date(Date.now() - 1_000).toISOString() }),
    ];
    const stateFresh = deriveHistoryState({ payload: recentPayload, staleAfterMs: 60_000 });
    assert.equal(stateFresh.isStale, false, "the latest entry is only 1s old, well under the 60s threshold");

    const stalePayload = [
      sampleEntry({ timestamp: new Date(Date.now() - 2 * 3_600_000).toISOString() }),
    ];
    const stateStale = deriveHistoryState({ payload: stalePayload, staleAfterMs: 60_000 });
    assert.equal(stateStale.isStale, true);
  });

  await t.test("an empty array with staleAfterMs supplied is never stale (nothing to compare)", () => {
    const state = deriveHistoryState({ payload: [], staleAfterMs: 1000 });
    assert.equal(state.status, "empty");
    assert.equal(state.isStale, false);
  });
});

test("buildHashrateChartOption", async (t) => {
  await t.test("plots [timestampMs, hashrate] pairs on a time x-axis", () => {
    const snapshots = transformHistoryData(samplePayload()).snapshots;
    const option = buildHashrateChartOption(snapshots, {});
    assert.equal(option.xAxis.type, "time");
    assert.equal(option.series.length, 1);
    assert.equal(option.series[0].data.length, 2);
    assert.equal(option.series[0].data[0][0], new Date("2026-07-18T09:00:00.000Z").getTime());
    assert.equal(option.series[0].data[0][1], 14.2e12);
  });

  await t.test("a null hashrate point is excluded from the series, not plotted as zero", () => {
    const snapshots = [{ timestamp: "2026-07-18T09:00:00.000Z", hashrate: null }];
    const option = buildHashrateChartOption(snapshots, {});
    assert.equal(option.series[0].data.length, 0);
  });

  await t.test("the Y-axis formatter renders a compact hashrate string", () => {
    const option = buildHashrateChartOption([], {});
    assert.equal(option.yAxis.axisLabel.formatter(14.2e12), "14.20 TH/s");
  });

  await t.test("uses the theme's accent colour for its single series", () => {
    const option = buildHashrateChartOption([], { accentColor: "#123456" });
    assert.equal(option.series[0].itemStyle.color, "#123456");
  });

  await t.test("no legend for a single-series chart", () => {
    const option = buildHashrateChartOption([], {});
    assert.equal(option.legend, undefined);
  });
});

test("buildHashrateChartSummary", async (t) => {
  await t.test("names the most recent value", () => {
    const snapshots = transformHistoryData(samplePayload()).snapshots;
    const summary = buildHashrateChartSummary(snapshots);
    assert.match(summary, /13\.70 TH\/s/);
    assert.match(summary, /2 snapshots/);
  });

  await t.test("no data at all produces a specific 'no data' message, not a throw", () => {
    assert.equal(buildHashrateChartSummary([]), "Pool hashrate -- no data available.");
  });
});

test("buildSharesChartOption", async (t) => {
  await t.test("plots two named series, Accepted and Rejected", () => {
    const snapshots = transformHistoryData(samplePayload()).snapshots;
    const option = buildSharesChartOption(snapshots, {});
    assert.equal(option.series.length, 2);
    assert.equal(option.series[0].name, "Accepted");
    assert.equal(option.series[1].name, "Rejected");
    assert.equal(option.series[0].data[0][1], 38800000000);
    assert.equal(option.series[1].data[0][1], 141000000);
  });

  await t.test("a two-series chart has a legend naming both series", () => {
    const option = buildSharesChartOption([], {});
    assert.deepEqual(option.legend.data, ["Accepted", "Rejected"]);
  });

  await t.test("the Y-axis formatter comma-formats large cumulative share counts", () => {
    const option = buildSharesChartOption([], {});
    assert.equal(option.yAxis.axisLabel.formatter(38800000000), "38,800,000,000");
  });
});

test("buildSharesChartSummary", async (t) => {
  await t.test("names the most recent accepted and rejected counts", () => {
    const snapshots = transformHistoryData(samplePayload()).snapshots;
    const summary = buildSharesChartSummary(snapshots);
    assert.match(summary, /38,860,000,000 accepted/);
    assert.match(summary, /141,600,000 rejected/);
  });

  await t.test("no data at all produces a specific message", () => {
    assert.equal(buildSharesChartSummary([]), "Accepted and rejected shares -- no data available.");
  });
});

test("buildDifficultyChartOption", async (t) => {
  await t.test("plots [timestampMs, highestDifficulty] pairs", () => {
    const snapshots = transformHistoryData(samplePayload()).snapshots;
    const option = buildDifficultyChartOption(snapshots, {});
    assert.equal(option.series[0].data[0][1], 241.08e9);
  });

  await t.test("the Y-axis formatter renders a compact difficulty string", () => {
    const option = buildDifficultyChartOption([], {});
    assert.equal(option.yAxis.axisLabel.formatter(241.08e9), "241.08 G");
  });
});

test("buildDifficultyChartSummary", async (t) => {
  await t.test("uses formatSdiff's full comma-separated convention, not the compact axis form", () => {
    const snapshots = transformHistoryData(samplePayload()).snapshots;
    const summary = buildDifficultyChartSummary(snapshots);
    assert.match(summary, /241,080,000,000/);
  });

  await t.test("no data at all produces a specific message", () => {
    assert.equal(buildDifficultyChartSummary([]), "Highest difficulty -- no data available.");
  });
});

test("buildActivityChartOption", async (t) => {
  await t.test("plots two named series, Workers and Users", () => {
    const snapshots = transformHistoryData(samplePayload()).snapshots;
    const option = buildActivityChartOption(snapshots, {});
    assert.equal(option.series[0].name, "Workers");
    assert.equal(option.series[1].name, "Users");
    assert.equal(option.series[0].data[0][1], 4);
    assert.equal(option.series[1].data[0][1], 3);
  });

  await t.test("has a legend naming both series", () => {
    const option = buildActivityChartOption([], {});
    assert.deepEqual(option.legend.data, ["Workers", "Users"]);
  });

  await t.test("the Y-axis formatter comma-formats worker/user counts", () => {
    const option = buildActivityChartOption([], {});
    assert.equal(option.yAxis.axisLabel.formatter(1234), "1,234");
  });
});

test("buildActivityChartSummary", async (t) => {
  await t.test("names the most recent worker and user counts", () => {
    const snapshots = transformHistoryData(samplePayload()).snapshots;
    const summary = buildActivityChartSummary(snapshots);
    assert.match(summary, /4 workers/);
    assert.match(summary, /3 users/);
  });

  await t.test("no data at all produces a specific message", () => {
    assert.equal(buildActivityChartSummary([]), "Worker and user counts -- no data available.");
  });
});

test("buildHistorySpec", async (t) => {
  await t.test("loading state renders skeletons, no chart panels", () => {
    const spec = buildHistorySpec({ status: "loading" });
    assert.ok(findByClassName(spec, "history-page__loading"));
    assert.equal(findByClassName(spec, "chart-panel"), null);
  });

  await t.test("error state (no data) renders only the error banner, with historical-service wording", () => {
    const error = new FetchApiError("x", { endpoint: "/historical_data", kind: "network" });
    const spec = buildHistorySpec({ status: "error", data: null, error, isStale: false });
    const banner = findByClassName(spec, "error-banner");
    assert.ok(banner);
    const message = banner.children.find((c) => c.className === "error-banner__message");
    assert.match(message.text, /historical statistics service/);
    assert.equal(findByClassName(spec, "chart-panel"), null);
  });

  await t.test("empty state (no snapshots at all) renders EmptyState, no chart panels", () => {
    const data = transformHistoryData([]);
    const spec = buildHistorySpec({ status: "empty", data, error: null, isStale: false });
    assert.ok(findByClassName(spec, "empty-state"));
    assert.equal(findByClassName(spec, "chart-panel"), null);
  });

  await t.test("empty state with a concurrent fetch error shows the error banner above the empty-state message", () => {
    // A reachable combination: a cached, previously-empty payload plus
    // a concurrent fetch failure. Both the error banner and the
    // "no historical data" message must render together, not one
    // silently replacing the other.
    const data = transformHistoryData([]);
    const error = new FetchApiError("x", { endpoint: "/historical_data", kind: "network" });
    const spec = buildHistorySpec({ status: "empty", data, error, isStale: false });
    assert.ok(findByClassName(spec, "error-banner"));
    assert.ok(findByClassName(spec, "empty-state"));
  });

  await t.test("an unrecognized status throws rather than silently rendering the success branch", () => {
    assert.throws(() => buildHistorySpec({ status: "not-a-real-status" }), /unrecognized status/);
  });

  await t.test("success renders exactly four chart panels", () => {
    const data = transformHistoryData(samplePayload());
    const spec = buildHistorySpec({ status: "success", data, error: null, isStale: false });
    const panels = findAllByClassName(spec, "chart-panel");
    assert.equal(panels.length, 4);
  });

  await t.test("success + error (cached fallback) shows the error banner above the live content", () => {
    const data = transformHistoryData(samplePayload());
    const error = new FetchApiError("x", { endpoint: "/historical_data", kind: "http", status: 503 });
    const spec = buildHistorySpec({ status: "success", data, error, isStale: false });
    assert.ok(findByClassName(spec, "error-banner"));
    assert.equal(findAllByClassName(spec, "chart-panel").length, 4);
  });

  await t.test("success + isStale (no error) shows a warning banner naming the latest snapshot's own recency", () => {
    const data = transformHistoryData(samplePayload());
    const spec = buildHistorySpec({ status: "success", data, error: null, isStale: true });
    const banner = findByClassName(spec, "error-banner");
    assert.equal(banner.children[0].className, "icon icon-warning error-banner__icon");
    const message = banner.children.find((c) => c.className === "error-banner__message");
    assert.match(message.text, /most recent snapshot/);
  });
});

test("mount/unmount lifecycle (no DOM emulation)", async (t) => {
  t.afterEach(() => unmount());

  function fakeContainer() {
    return {};
  }

  function fakeCanvasNodes() {
    return [{ slot: 0 }, { slot: 1 }, { slot: 2 }, { slot: 3 }];
  }

  await t.test("renders loading synchronously, then the fetch result once it resolves", async () => {
    // render() returns null, not fakeCanvasNodes() -- this test only
    // asserts on the rendered *spec* content (which is unaffected by
    // what render() returns), not chart handle creation. Returning
    // null skips history.js's chart-creation branch entirely, which
    // would otherwise call the real (DOM-dependent) readThemeTokens
    // default, since no readThemeTokensImpl override is supplied here.
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return null;
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => samplePayload() });

    mount(fakeContainer(), { fetchImpl, render });

    assert.equal(renders.length, 1);
    assert.ok(findByClassName(renders[0], "history-page__loading"));

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(renders.length, 2);
    assert.equal(findAllByClassName(renders[1], "chart-panel").length, 4);
  });

  await t.test("throws on a second mount() without an intervening unmount()", () => {
    const render = () => null;
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => samplePayload() });

    mount(fakeContainer(), { fetchImpl, render });
    assert.throws(() => mount(fakeContainer(), { fetchImpl, render }), /already mounted/);
  });

  await t.test("unmount() before any mount() is a safe no-op", () => {
    assert.doesNotThrow(() => unmount());
  });

  await t.test("unmount() clears the container by rendering an empty page shell", async () => {
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return null;
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => samplePayload() });

    mount(fakeContainer(), { fetchImpl, render });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(renders.length, 2);

    unmount();
    assert.equal(renders.length, 3);
    assert.equal(renders[2].className, "history-page");
    assert.deepEqual(renders[2].children, []);
  });

  await t.test(
    "a stale mount's in-flight fetch cannot affect a newer mount after unmount()+remount()",
    async () => {
      let releaseOldFetch;
      const oldGate = new Promise((resolve) => {
        releaseOldFetch = resolve;
      });
      const oldFetchImpl = async () => {
        await oldGate;
        return { ok: true, status: 200, json: async () => samplePayload() };
      };
      const oldRenders = [];
      const oldRender = (target, spec) => {
        oldRenders.push(spec);
        return null;
      };

      mount(fakeContainer(), { fetchImpl: oldFetchImpl, render: oldRender });
      assert.equal(oldRenders.length, 1);

      unmount();

      const newRenders = [];
      const newRender = (target, spec) => {
        newRenders.push(spec);
        return null;
      };
      const newFetchImpl = async () => ({ ok: true, status: 200, json: async () => samplePayload() });

      mount(fakeContainer(), { fetchImpl: newFetchImpl, render: newRender });
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(newRenders.length, 2);

      releaseOldFetch();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(newRenders.length, 2, "a stale mount's late-resolving fetch must not render into a newer mount");
    },
  );

  await t.test("unmount() disposes all four active chart instances, not just one", async () => {
    const disposeCalls = [];
    const render = () => fakeCanvasNodes();
    const createChartImpl = () => ({
      update() {},
      dispose() {
        disposeCalls.push(true);
      },
    });
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => samplePayload() });
    const readThemeTokensImpl = () => ({});

    mount(fakeContainer(), { fetchImpl, render, createChartImpl, readThemeTokensImpl });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(disposeCalls.length, 0);
    unmount();
    assert.equal(disposeCalls.length, 4);
  });

  await t.test(
    "one chart's creation failure does not prevent the other three from being created, and is reported via onChartError",
    async () => {
      const chartErrors = [];
      const createdSlots = [];
      const render = () => fakeCanvasNodes();
      // The third chart (index 2, "difficulty" -- see CHART_DEFS'
      // fixed order in history.js) always throws; the other three
      // must still be created despite it.
      let callIndex = -1;
      const createChartImpl = () => {
        callIndex += 1;
        if (callIndex === 2) {
          throw new Error("simulated ECharts init failure");
        }
        createdSlots.push(callIndex);
        return { update() {}, dispose() {} };
      };
      const fetchImpl = async () => ({ ok: true, status: 200, json: async () => samplePayload() });
      const readThemeTokensImpl = () => ({});
      const onChartError = (error, context) => chartErrors.push({ message: error.message, context });

      mount(fakeContainer(), {
        fetchImpl,
        render,
        createChartImpl,
        readThemeTokensImpl,
        onChartError,
      });
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      assert.deepEqual(createdSlots, [0, 1, 3], "the three non-failing charts must still be created despite the middle one throwing");
      assert.equal(chartErrors.length, 1);
      assert.equal(chartErrors[0].context, "difficulty");
      assert.match(chartErrors[0].message, /simulated ECharts init failure/);
    },
  );

  await t.test(
    "a same-status poll tick updates all four existing charts in place, rather than disposing and recreating them",
    async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });

      const disposeCalls = [];
      const updateCalls = [];
      let createCalls = 0;
      const render = () => fakeCanvasNodes();
      const createChartImpl = () => {
        createCalls += 1;
        return {
          update(option) {
            updateCalls.push(option);
          },
          dispose() {
            disposeCalls.push(true);
          },
        };
      };
      const fetchImpl = async () => ({ ok: true, status: 200, json: async () => samplePayload() });
      const readThemeTokensImpl = () => ({});
      const flush = () => new Promise((resolve) => setImmediate(resolve));

      mount(fakeContainer(), { fetchImpl, render, createChartImpl, readThemeTokensImpl, intervalMs: 1000 });
      await flush();
      await flush();
      assert.equal(createCalls, 4, "all four charts are created on the first success render");
      assert.equal(disposeCalls.length, 0);

      t.mock.timers.tick(1000);
      await flush();
      await flush();
      assert.equal(createCalls, 4, "a same-status poll tick must reuse all four charts, not recreate any of them");
      assert.equal(disposeCalls.length, 0);
      assert.equal(updateCalls.length, 4, "each of the four charts gets exactly one update() call");

      unmount();
      assert.equal(disposeCalls.length, 4);
    },
  );

  await t.test("a real status change (success -> empty) disposes all four charts, never calls update()", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    const disposeCalls = [];
    const render = () => fakeCanvasNodes();
    const createChartImpl = () => ({
      update() {
        throw new Error("update() must not be called across a status change");
      },
      dispose() {
        disposeCalls.push(true);
      },
    });
    const readThemeTokensImpl = () => ({});
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      const payload = call === 1 ? samplePayload() : [];
      return { ok: true, status: 200, json: async () => payload };
    };
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    mount(fakeContainer(), { fetchImpl, render, createChartImpl, readThemeTokensImpl, intervalMs: 1000 });
    await flush();
    await flush();
    assert.equal(disposeCalls.length, 0);

    t.mock.timers.tick(1000);
    await flush();
    await flush();
    assert.equal(disposeCalls.length, 4);

    unmount();
    assert.equal(disposeCalls.length, 4, "unmount() must not double-dispose already-disposed charts");
  });

  await t.test("repaints all four charts when the active theme changes, but not for an unrelated state.js change", async () => {
    const updateCalls = [];
    const render = () => fakeCanvasNodes();
    const createChartImpl = () => ({
      update(option) {
        updateCalls.push(option);
      },
      dispose() {},
    });
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => samplePayload() });
    const readThemeTokensImpl = () => ({ accent: "#000000" });

    mount(fakeContainer(), { fetchImpl, render, createChartImpl, readThemeTokensImpl });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(updateCalls.length, 0);

    setState({ searchQuery: "alice" });
    assert.equal(updateCalls.length, 0, "an unrelated state.js change must not repaint the charts");

    setState({ theme: "dark" });
    assert.equal(updateCalls.length, 4, "a real theme change must repaint all four charts");

    setState({ searchQuery: "" });
  });

  await t.test("no polling is started when intervalMs is omitted", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    let renderCount = 0;
    const render = () => {
      renderCount += 1;
      return null;
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => samplePayload() });
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    mount(fakeContainer(), { fetchImpl, render });
    await flush();
    await flush();
    assert.equal(renderCount, 2);

    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(renderCount, 2, "without intervalMs, mount() must not poll");
  });

  await t.test("polling stops after unmount()", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    let renderCount = 0;
    const render = () => {
      renderCount += 1;
      return null;
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => samplePayload() });
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    mount(fakeContainer(), { fetchImpl, render, intervalMs: 1000 });
    await flush();
    await flush();
    assert.equal(renderCount, 2);

    t.mock.timers.tick(1000);
    await flush();
    await flush();
    assert.equal(renderCount, 3);

    unmount();
    assert.equal(renderCount, 4, "unmount() itself renders once more, to clear the container");

    t.mock.timers.tick(1000);
    await flush();
    assert.equal(renderCount, 4, "no further renders after unmount() stops polling");
  });

  await t.test("an invalid staleAfterMs is dropped, not passed through to fail deep inside getStaleness", async () => {
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return null;
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => samplePayload() });

    mount(fakeContainer(), { fetchImpl, render, staleAfterMs: NaN });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(renders.length, 2);
    assert.equal(findAllByClassName(renders[1], "chart-panel").length, 4);
  });

  await t.test(
    "isValidHistoricalData rejects a non-array response as a genuine schema error, not silently treated as empty",
    async () => {
      const renders = [];
      const render = (target, spec) => {
        renders.push(spec);
        return null;
      };
      const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ not: "an array" }) });

      mount(fakeContainer(), { fetchImpl, render });
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      const last = renders[renders.length - 1];
      assert.ok(findByClassName(last, "error-banner"));
    },
  );

  await t.test("mount() does NOT write into core/state.js's analytics/analyticsFetchedAt fields", async () => {
    setState({ analytics: null, analyticsFetchedAt: null });
    const render = () => null;
    const payload = samplePayload();
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => payload });

    mount(fakeContainer(), { fetchImpl, render });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(
      getState().analytics,
      null,
      "historical_data.json has a different, single-consumer shape and must never overwrite the shared analytics.json slot",
    );
    assert.equal(getState().analyticsFetchedAt, null);
  });
});
