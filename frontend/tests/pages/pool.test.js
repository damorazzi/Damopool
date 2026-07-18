import test from "node:test";
import assert from "node:assert/strict";
import {
  route,
  transformPoolData,
  isPoolEmpty,
  describeFetchError,
  derivePoolState,
  buildPercentilesChartOption,
  buildPercentilesChartSummary,
  buildRollingWindowsRows,
  buildPoolSpec,
  mount,
  unmount,
} from "../../src/pages/pool.js";
import { getState, setState } from "../../src/core/state.js";
import { FetchApiError } from "../../src/core/api.js";

function fullPayload(overrides = {}) {
  return {
    metadata: { schema_version: "1.1", generated_at: new Date().toISOString(), ...overrides.metadata },
    pool: {
      accepted_count: 1000,
      rejected_count: 5,
      invalid_result_count: 2,
      average_sdiff: 105.5,
      median_sdiff: 100,
      min_sdiff: 1,
      max_sdiff: 2048,
      percentiles: { p50: 100, p90: 512, p99: 1500 },
      best_share_today: { username: "alice", workername: "rig1", sdiff: 512.5, timestamp: "unknown" },
      best_share_ever: { username: "bob", workername: "rig2", sdiff: 2048, timestamp: "unknown" },
      rolling_windows: {
        "15m": { accepted: 10, rejected: 0, average_sdiff: 100, share_frequency_per_minute: 0.5 },
        "1h": { accepted: 40, rejected: 1, average_sdiff: 120, share_frequency_per_minute: 0.6 },
        "24h": { accepted: 900, rejected: 4, average_sdiff: 110, share_frequency_per_minute: 0.65 },
      },
      ...overrides.pool,
    },
    users: {},
    workers: {},
    daily_bests: {},
    live_ticker: [],
    ...overrides,
  };
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

test("route", async (t) => {
  await t.test("matches router.js's routes-array shape and is distinct from Overview's", () => {
    assert.equal(route.pattern, "/pool");
    assert.equal(route.name, "pool");
  });
});

test("transformPoolData", async (t) => {
  await t.test("extracts the fields this page renders", () => {
    const payload = fullPayload();
    const data = transformPoolData(payload);
    assert.equal(data.generatedAt, payload.metadata.generated_at);
    assert.equal(data.acceptedCount, 1000);
    assert.equal(data.rejectedCount, 5);
    assert.equal(data.invalidResultCount, 2);
    assert.equal(data.averageSdiff, 105.5);
    assert.equal(data.medianSdiff, 100);
    assert.equal(data.minSdiff, 1);
    assert.equal(data.maxSdiff, 2048);
    assert.deepEqual(data.percentiles, { p50: 100, p90: 512, p99: 1500 });
    assert.deepEqual(data.rollingWindows, payload.pool.rolling_windows);
  });

  await t.test("degrades gracefully when pool/metadata/percentiles fields are missing", () => {
    const data = transformPoolData({ metadata: {}, pool: {} });
    assert.equal(data.generatedAt, null);
    assert.equal(data.acceptedCount, undefined);
    assert.deepEqual(data.percentiles, { p50: undefined, p90: undefined, p99: undefined });
    assert.deepEqual(data.rollingWindows, {});
  });
});

test("isPoolEmpty", async (t) => {
  await t.test("a pool with accepted shares is not empty", () => {
    assert.equal(isPoolEmpty({ accepted_count: 1 }), false);
  });

  await t.test("zero counts and no best shares is empty", () => {
    assert.equal(
      isPoolEmpty({ accepted_count: 0, rejected_count: 0, best_share_today: null, best_share_ever: null }),
      true,
    );
  });

  await t.test("a missing/null pool is empty", () => {
    assert.equal(isPoolEmpty(null), true);
    assert.equal(isPoolEmpty(undefined), true);
  });
});

test("describeFetchError", async (t) => {
  await t.test("network, http, schema, unknown, and no-error cases", () => {
    assert.equal(describeFetchError(null), "Something went wrong.");
    assert.match(
      describeFetchError(new FetchApiError("x", { endpoint: "/analytics.json", kind: "network" })),
      /connection/,
    );
    assert.match(
      describeFetchError(new FetchApiError("x", { endpoint: "/analytics.json", kind: "http", status: 500 })),
      /HTTP 500/,
    );
    assert.match(
      describeFetchError(new FetchApiError("x", { endpoint: "/analytics.json", kind: "schema" })),
      /unexpected format/,
    );
    assert.ok(
      describeFetchError(new FetchApiError("x", { endpoint: "/analytics.json", kind: "unknown" })).length > 0,
    );
  });
});

test("derivePoolState", async (t) => {
  await t.test("no payload at all is status error with no data", () => {
    const state = derivePoolState({ payload: null, error: new Error("boom") });
    assert.equal(state.status, "error");
    assert.equal(state.data, null);
    assert.ok(state.error);
  });

  await t.test("a genuinely empty pool is status empty", () => {
    const payload = fullPayload({
      pool: { accepted_count: 0, rejected_count: 0, best_share_today: null, best_share_ever: null },
    });
    const state = derivePoolState({ payload });
    assert.equal(state.status, "empty");
  });

  await t.test("real data is status success", () => {
    const state = derivePoolState({ payload: fullPayload() });
    assert.equal(state.status, "success");
    assert.equal(state.error, null);
  });

  await t.test("an error alongside a cached (still valid) payload keeps status success and carries the error", () => {
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "network" });
    const state = derivePoolState({ payload: fullPayload(), error });
    assert.equal(state.status, "success");
    assert.equal(state.error, error);
  });

  await t.test("isStale is normalized to a boolean and defaults to false", () => {
    assert.equal(derivePoolState({ payload: fullPayload() }).isStale, false);
    assert.equal(derivePoolState({ payload: fullPayload(), isStale: true }).isStale, true);
    assert.equal(derivePoolState({ payload: fullPayload(), isStale: null }).isStale, false);
  });
});

test("buildPercentilesChartOption", async (t) => {
  await t.test("maps p50/p90/p99 into series data, in that order", () => {
    const option = buildPercentilesChartOption(fullPayload().pool.percentiles);
    assert.deepEqual(option.series[0].data, [100, 512, 1500]);
    assert.deepEqual(option.xAxis.data, ["p50", "p90", "p99"]);
  });

  await t.test("a missing percentile becomes a null data point, not zero or a throw", () => {
    const option = buildPercentilesChartOption({ p90: 50 });
    assert.deepEqual(option.series[0].data, [null, 50, null]);
  });

  await t.test("null/undefined percentiles produces an all-null series", () => {
    assert.deepEqual(buildPercentilesChartOption(null).series[0].data, [null, null, null]);
    assert.deepEqual(buildPercentilesChartOption(undefined).series[0].data, [null, null, null]);
  });

  await t.test("theme fragments are threaded through to the option", () => {
    const theme = { accentColor: "#ffd700", backgroundColor: "transparent" };
    const option = buildPercentilesChartOption({}, theme);
    assert.equal(option.series[0].itemStyle.color, "#ffd700");
    assert.equal(option.backgroundColor, "transparent");
  });
});

test("buildPercentilesChartSummary", async (t) => {
  await t.test("describes every percentile's value in the accessible summary text", () => {
    const summary = buildPercentilesChartSummary(fullPayload().pool.percentiles);
    assert.match(summary, /p50/);
    assert.match(summary, /p90/);
    assert.match(summary, /p99/);
  });

  await t.test("a missing percentile reads as 'no data'", () => {
    const summary = buildPercentilesChartSummary({});
    assert.match(summary, /p50: no data/);
  });
});

test("buildRollingWindowsRows", async (t) => {
  await t.test("produces one formatted row per window, in 15m/1h/24h order", () => {
    const rows = buildRollingWindowsRows(fullPayload().pool.rolling_windows);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].window, "15 min");
    assert.equal(rows[0].accepted, "10");
    assert.equal(rows[0].rejected, "0");
    assert.equal(rows[0].frequency, "0.50");
    assert.equal(rows[2].window, "24 hours");
    assert.equal(rows[2].frequency, "0.65");
  });

  await t.test("a missing window's row has null fields, not a throw", () => {
    const rows = buildRollingWindowsRows({ "1h": { accepted: 5, rejected: 0, average_sdiff: 10, share_frequency_per_minute: 0.1 } });
    assert.equal(rows[0].accepted, null);
    assert.equal(rows[0].avgSdiff, null);
    assert.equal(rows[1].accepted, "5");
  });

  await t.test("null/undefined rollingWindows produces three all-null rows, not a throw", () => {
    const rows = buildRollingWindowsRows(null);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].accepted, null);
  });
});

test("buildPoolSpec", async (t) => {
  await t.test("loading state renders skeletons, no stat tiles, chart, or table", () => {
    const spec = buildPoolSpec({ status: "loading" });
    assert.ok(findByClassName(spec, "pool-page__loading"));
    assert.ok(findByClassName(spec, "tile-grid"));
    assert.equal(findByClassName(spec, "chart-panel"), null);
    assert.equal(findByClassName(spec, "data-table"), null);
  });

  await t.test("error state (no data) renders only the error banner", () => {
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "network" });
    const spec = buildPoolSpec({ status: "error", data: null, error, isStale: false });
    const banner = findByClassName(spec, "error-banner");
    assert.ok(banner);
    assert.match(banner.children[1].text, /connection/);
    assert.equal(findByClassName(spec, "tile-grid"), null);
  });

  await t.test("empty state renders EmptyState, not stat tiles, chart, or table", () => {
    const data = transformPoolData(fullPayload());
    const spec = buildPoolSpec({ status: "empty", data, error: null, isStale: false });
    assert.ok(findByClassName(spec, "empty-state"));
    assert.equal(findByClassName(spec, "tile-grid"), null);
    assert.equal(findByClassName(spec, "chart-panel"), null);
    assert.equal(findByClassName(spec, "data-table"), null);
  });

  await t.test("success state renders stat tiles, a chart panel, and the rolling-windows table", () => {
    const data = transformPoolData(fullPayload());
    const spec = buildPoolSpec({ status: "success", data, error: null, isStale: false });
    assert.ok(findByClassName(spec, "tile-grid"));
    assert.ok(findByClassName(spec, "chart-panel"));
    assert.ok(findByClassName(spec, "data-table"));
    assert.equal(findByClassName(spec, "error-banner"), null);
  });

  await t.test("success + error (cached fallback) shows the error banner above the live content", () => {
    const data = transformPoolData(fullPayload());
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "http", status: 503 });
    const spec = buildPoolSpec({ status: "success", data, error, isStale: false });
    assert.ok(findByClassName(spec, "error-banner"));
    assert.ok(findByClassName(spec, "data-table"), "cached content must stay visible under the banner");
  });

  await t.test("success + isStale (no error) shows a warning banner, not the error icon", () => {
    const data = transformPoolData(fullPayload());
    const spec = buildPoolSpec({ status: "success", data, error: null, isStale: true });
    const banner = findByClassName(spec, "error-banner");
    assert.equal(banner.children[0].className, "icon icon-warning error-banner__icon");
    assert.match(banner.children[1].text, /stale/);
  });

  await t.test("an unrecognized status throws rather than silently rendering the success branch", () => {
    assert.throws(() => buildPoolSpec({ status: "not-a-real-status" }), /unrecognized status/);
  });

  await t.test("stat tile values come from formatted sdiff/counts", () => {
    const data = transformPoolData(fullPayload({ pool: { accepted_count: 42 } }));
    const spec = buildPoolSpec({ status: "success", data, error: null, isStale: false });
    const tileGrid = findByClassName(spec, "tile-grid");
    const values = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__value").text);
    assert.equal(values[0], "42");
    assert.equal(tileGrid.children.length, 7);
  });

  await t.test("the rolling-windows table has all three window rows", () => {
    const data = transformPoolData(fullPayload());
    const spec = buildPoolSpec({ status: "success", data, error: null, isStale: false });
    const table = findByClassName(spec, "data-table");
    const tbody = table.children.find((c) => c.tag === "tbody");
    assert.equal(tbody.children.length, 3);
  });
});

test("mount/unmount lifecycle (no DOM emulation)", async (t) => {
  t.afterEach(() => unmount());

  function fakeContainer() {
    return {};
  }

  await t.test("renders loading synchronously, then the fetch result once it resolves", async () => {
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return null;
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render });

    assert.equal(renders.length, 1);
    assert.ok(findByClassName(renders[0], "pool-page__loading"));

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(renders.length, 2);
    assert.ok(findByClassName(renders[1], "data-table"));
  });

  await t.test("throws on a second mount() without an intervening unmount()", () => {
    const render = () => null;
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render });
    assert.throws(() => mount(fakeContainer(), { fetchImpl, render }), /already mounted/);
  });

  await t.test("unmount() before any mount() is a safe no-op", () => {
    assert.doesNotThrow(() => unmount());
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
        return { ok: true, status: 200, json: async () => fullPayload({ pool: { accepted_count: 111 } }) };
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
      const newFetchImpl = async () => ({
        ok: true,
        status: 200,
        json: async () => fullPayload({ pool: { accepted_count: 222 } }),
      });

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

  await t.test("mount() writes the fetched payload into core/state.js", async () => {
    const render = () => null;
    const payload = fullPayload();
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => payload });

    mount(fakeContainer(), { fetchImpl, render });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(getState().analytics, payload);
    assert.equal(typeof getState().analyticsFetchedAt, "string");
  });

  await t.test("polling: renders again on each tick, stops after unmount()", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return null;
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    mount(fakeContainer(), { fetchImpl, render, intervalMs: 1000 });
    await flush();
    await flush();
    assert.equal(renders.length, 2);

    t.mock.timers.tick(1000);
    await flush();
    await flush();
    assert.equal(renders.length, 3);

    unmount();
    assert.equal(renders.length, 4);

    t.mock.timers.tick(1000);
    await flush();
    assert.equal(renders.length, 4, "no further renders after unmount() stops polling");
  });

  await t.test("no polling is started when intervalMs is omitted", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return null;
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    mount(fakeContainer(), { fetchImpl, render });
    await flush();
    await flush();
    assert.equal(renders.length, 2);

    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(renders.length, 2, "without intervalMs, mount() must not poll");
  });

  await t.test("an invalid staleAfterMs is dropped, not passed through to fail deep inside getStaleness", async () => {
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return null;
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render, staleAfterMs: NaN });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(renders.length, 2);
    assert.ok(findByClassName(renders[1], "data-table"));
  });

  await t.test("unmount() clears the container by rendering an empty page shell", async () => {
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return null;
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(renders.length, 2);

    unmount();
    assert.equal(renders.length, 3);
    assert.equal(renders[2].className, "pool-page");
    assert.deepEqual(renders[2].children, []);
  });

  await t.test("unmount() disposes the active chart instance", async () => {
    const disposeCalls = [];
    const render = () => ({ fakeCanvas: true });
    const createChartImpl = () => ({
      update() {},
      dispose() {
        disposeCalls.push(true);
      },
    });
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });
    const readThemeTokensImpl = () => ({});

    mount(fakeContainer(), { fetchImpl, render, createChartImpl, readThemeTokensImpl });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(disposeCalls.length, 0);
    unmount();
    assert.equal(disposeCalls.length, 1);
  });

  await t.test(
    "a same-status poll tick updates the existing chart in place, rather than disposing and recreating it",
    async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });

      const disposeCalls = [];
      const updateCalls = [];
      let createCalls = 0;
      const render = () => ({ fakeCanvas: true });
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
      const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });
      const readThemeTokensImpl = () => ({});
      const flush = () => new Promise((resolve) => setImmediate(resolve));

      mount(fakeContainer(), { fetchImpl, render, createChartImpl, readThemeTokensImpl, intervalMs: 1000 });
      await flush();
      await flush();
      assert.equal(createCalls, 1);
      assert.equal(disposeCalls.length, 0);

      t.mock.timers.tick(1000);
      await flush();
      await flush();
      assert.equal(createCalls, 1, "a same-status poll tick must reuse the existing chart, not recreate it");
      assert.equal(disposeCalls.length, 0);
      assert.equal(updateCalls.length, 1);

      unmount();
      assert.equal(disposeCalls.length, 1);
    },
  );

  await t.test("a real status change (success -> empty) disposes the chart, never calls update()", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    const disposeCalls = [];
    const render = () => ({ fakeCanvas: true });
    const createChartImpl = () => ({
      update() {
        throw new Error("update() must not be called across a status change");
      },
      dispose() {
        disposeCalls.push(true);
      },
    });
    const readThemeTokensImpl = () => ({});
    const emptyPayload = fullPayload({
      pool: { accepted_count: 0, rejected_count: 0, best_share_today: null, best_share_ever: null },
    });
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      const payload = call === 1 ? fullPayload() : emptyPayload;
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
    assert.equal(disposeCalls.length, 1);

    unmount();
    assert.equal(disposeCalls.length, 1, "unmount() must not double-dispose an already-disposed chart");
  });

  await t.test("a real status change (empty -> success) creates a fresh chart, does not call update()", async (t) => {
    // The companion of the success->empty test above: an empty->success
    // transition must go through createChartImpl (there was no prior
    // chart to reuse), not chartHandle.update() on a handle that never
    // existed.
    t.mock.timers.enable({ apis: ["setTimeout"] });

    const disposeCalls = [];
    let createCalls = 0;
    const render = () => ({ fakeCanvas: true });
    const createChartImpl = () => {
      createCalls += 1;
      return {
        update() {
          throw new Error("update() must not be called when there was no prior chart to reuse");
        },
        dispose() {
          disposeCalls.push(true);
        },
      };
    };
    const readThemeTokensImpl = () => ({});
    const emptyPayload = fullPayload({
      pool: { accepted_count: 0, rejected_count: 0, best_share_today: null, best_share_ever: null },
    });
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      const payload = call === 1 ? emptyPayload : fullPayload();
      return { ok: true, status: 200, json: async () => payload };
    };
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    mount(fakeContainer(), { fetchImpl, render, createChartImpl, readThemeTokensImpl, intervalMs: 1000 });
    await flush();
    await flush();
    assert.equal(createCalls, 0, "no chart is created while the page is empty");

    t.mock.timers.tick(1000);
    await flush();
    await flush();
    assert.equal(createCalls, 1, "the first success render after being empty must create a fresh chart");
    assert.equal(disposeCalls.length, 0, "there was no prior chart to dispose");

    unmount();
    assert.equal(disposeCalls.length, 1);
  });

  await t.test("repaints the chart when the active theme changes, but not for an unrelated state.js change", async () => {
    const updateCalls = [];
    const render = () => ({ fakeCanvas: true });
    const createChartImpl = () => ({
      update(option) {
        updateCalls.push(option);
      },
      dispose() {},
    });
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });
    const readThemeTokensImpl = () => ({ accent: "#000000" });

    mount(fakeContainer(), { fetchImpl, render, createChartImpl, readThemeTokensImpl });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(updateCalls.length, 0);

    setState({ searchQuery: "alice" });
    assert.equal(updateCalls.length, 0, "an unrelated state.js change must not repaint the chart");

    const before = getState().theme;
    setState({ theme: before === "light" ? "dark" : "light" });
    assert.equal(updateCalls.length, 1);

    setState({ theme: getState().theme });
    assert.equal(updateCalls.length, 1, "setting the same theme again must not repaint the chart a second time");
  });
});
