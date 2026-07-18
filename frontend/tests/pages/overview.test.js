import test from "node:test";
import assert from "node:assert/strict";
import {
  route,
  transformOverviewData,
  isOverviewEmpty,
  deriveOverviewState,
  buildPoolWindowsChartOption,
  buildPoolWindowsChartSummary,
  buildOverviewSpec,
  mount,
  unmount,
} from "../../src/pages/overview.js";
import { getState, setState } from "../../src/core/state.js";
import { FetchApiError } from "../../src/core/api.js";

function fullPayload(overrides = {}) {
  return {
    metadata: { schema_version: "1.1", generated_at: new Date().toISOString(), ...overrides.metadata },
    pool: {
      accepted_count: 1000,
      rejected_count: 5,
      best_share_today: { username: "alice", workername: "rig1", sdiff: 512.5, timestamp: "unknown" },
      best_share_ever: { username: "bob", workername: "rig2", sdiff: 2048, timestamp: "unknown" },
      rolling_windows: {
        "15m": { accepted: 10, rejected: 0, average_sdiff: 100, share_frequency_per_minute: 0.5 },
        "1h": { accepted: 40, rejected: 1, average_sdiff: 120, share_frequency_per_minute: 0.6 },
        "24h": { accepted: 900, rejected: 4, average_sdiff: 110, share_frequency_per_minute: 0.6 },
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

// Recursively finds the first spec node (or the node itself) whose
// className list includes the given class -- specs are plain objects
// (core/dom.js's el()), so this needs no DOM at all. Matches on the
// space-separated class list, not exact equality, since several
// components compose classes (e.g. chartPanelSpec's "card chart-panel").
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
  await t.test("matches router.js's routes-array shape", () => {
    assert.equal(route.pattern, "/");
    assert.equal(typeof route.name, "string");
  });
});

test("transformOverviewData", async (t) => {
  await t.test("extracts the fields this page renders", () => {
    const payload = fullPayload();
    const data = transformOverviewData(payload);
    assert.equal(data.generatedAt, payload.metadata.generated_at);
    assert.equal(data.acceptedCount, 1000);
    assert.equal(data.rejectedCount, 5);
    assert.deepEqual(data.bestShareToday, payload.pool.best_share_today);
    assert.deepEqual(data.bestShareEver, payload.pool.best_share_ever);
    assert.deepEqual(data.rollingWindows, payload.pool.rolling_windows);
  });

  await t.test("degrades gracefully when pool/metadata fields are missing", () => {
    const data = transformOverviewData({ metadata: {}, pool: {} });
    assert.equal(data.generatedAt, null);
    assert.equal(data.acceptedCount, undefined);
    assert.equal(data.bestShareToday, null);
    assert.deepEqual(data.rollingWindows, {});
  });
});

test("isOverviewEmpty", async (t) => {
  await t.test("a pool with accepted shares is not empty", () => {
    assert.equal(isOverviewEmpty({ accepted_count: 1 }), false);
  });

  await t.test("a pool with a best-share-ever but zero recent counts is not empty", () => {
    assert.equal(
      isOverviewEmpty({ accepted_count: 0, rejected_count: 0, best_share_ever: { sdiff: 1 } }),
      false,
    );
  });

  await t.test("zero counts and no best shares is empty", () => {
    assert.equal(
      isOverviewEmpty({ accepted_count: 0, rejected_count: 0, best_share_today: null, best_share_ever: null }),
      true,
    );
  });

  await t.test("a missing/null pool is empty", () => {
    assert.equal(isOverviewEmpty(null), true);
    assert.equal(isOverviewEmpty(undefined), true);
  });
});

// describeFetchError itself is now core/errors.js's own export, tested
// directly in tests/core/errors.test.js -- this page's error-state
// tests (buildOverviewSpec, below) confirm the integration (the error
// banner renders whatever it returns) without re-testing its branching
// logic here a second time.

test("deriveOverviewState", async (t) => {
  await t.test("no payload at all is status error with no data", () => {
    const state = deriveOverviewState({ payload: null, error: new Error("boom") });
    assert.equal(state.status, "error");
    assert.equal(state.data, null);
    assert.ok(state.error);
  });

  await t.test("a genuinely empty pool is status empty", () => {
    const payload = fullPayload({
      pool: { accepted_count: 0, rejected_count: 0, best_share_today: null, best_share_ever: null },
    });
    const state = deriveOverviewState({ payload });
    assert.equal(state.status, "empty");
    assert.ok(state.data);
  });

  await t.test("real data is status success", () => {
    const state = deriveOverviewState({ payload: fullPayload() });
    assert.equal(state.status, "success");
    assert.equal(state.error, null);
  });

  await t.test("an error alongside a cached (still valid) payload keeps status success/empty and carries the error", () => {
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "network" });
    const state = deriveOverviewState({ payload: fullPayload(), error });
    assert.equal(state.status, "success");
    assert.equal(state.error, error);
  });

  await t.test("isStale is normalized to a boolean and defaults to false", () => {
    assert.equal(deriveOverviewState({ payload: fullPayload() }).isStale, false);
    assert.equal(deriveOverviewState({ payload: fullPayload(), isStale: true }).isStale, true);
    assert.equal(deriveOverviewState({ payload: fullPayload(), isStale: null }).isStale, false);
  });
});

test("buildPoolWindowsChartOption", async (t) => {
  await t.test("maps each rolling window's average_sdiff into series data, in 15m/1h/24h order", () => {
    const option = buildPoolWindowsChartOption(fullPayload().pool.rolling_windows);
    assert.deepEqual(option.series[0].data, [100, 120, 110]);
    assert.deepEqual(option.xAxis.data, ["15 min", "1 hour", "24 hours"]);
  });

  await t.test("a missing window becomes a null data point, not zero or a throw", () => {
    const option = buildPoolWindowsChartOption({ "1h": { average_sdiff: 50 } });
    assert.deepEqual(option.series[0].data, [null, 50, null]);
  });

  await t.test("null/undefined rolling_windows produces an all-null series", () => {
    assert.deepEqual(buildPoolWindowsChartOption(null).series[0].data, [null, null, null]);
    assert.deepEqual(buildPoolWindowsChartOption(undefined).series[0].data, [null, null, null]);
  });

  await t.test("theme fragments are threaded through to the option", () => {
    const theme = { accentColor: "#ffd700", backgroundColor: "transparent" };
    const option = buildPoolWindowsChartOption({}, theme);
    assert.equal(option.series[0].itemStyle.color, "#ffd700");
    assert.equal(option.backgroundColor, "transparent");
  });
});

test("buildPoolWindowsChartSummary", async (t) => {
  await t.test("describes every window's value in the accessible summary text", () => {
    const summary = buildPoolWindowsChartSummary(fullPayload().pool.rolling_windows);
    assert.match(summary, /15 min/);
    assert.match(summary, /1 hour/);
    assert.match(summary, /24 hours/);
  });

  await t.test("a missing window reads as 'no data', not a blank or NaN", () => {
    const summary = buildPoolWindowsChartSummary({});
    assert.match(summary, /15 min: no data/);
  });
});

test("buildOverviewSpec", async (t) => {
  await t.test("loading state renders skeletons, no stat tiles or chart", () => {
    const spec = buildOverviewSpec({ status: "loading" });
    assert.ok(findByClassName(spec, "overview-page__loading"));
    assert.equal(findByClassName(spec, "tile-grid").attrs["aria-busy"], "true");
    assert.equal(findByClassName(spec, "chart-panel"), null);
  });

  await t.test("error state (no data) renders only the error banner", () => {
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "network" });
    const spec = buildOverviewSpec({ status: "error", data: null, error, isStale: false });
    const banner = findByClassName(spec, "error-banner");
    assert.ok(banner);
    assert.match(banner.children[1].text, /connection/);
    assert.equal(findByClassName(spec, "tile-grid"), null);
    assert.equal(findByClassName(spec, "chart-panel"), null);
  });

  await t.test("empty state renders EmptyState, not stat tiles or a chart", () => {
    const data = transformOverviewData(fullPayload());
    const spec = buildOverviewSpec({ status: "empty", data, error: null, isStale: false });
    assert.ok(findByClassName(spec, "empty-state"));
    assert.equal(findByClassName(spec, "tile-grid"), null);
    assert.equal(findByClassName(spec, "chart-panel"), null);
  });

  await t.test("success state renders stat tiles and a chart panel, no banner", () => {
    const data = transformOverviewData(fullPayload());
    const spec = buildOverviewSpec({ status: "success", data, error: null, isStale: false });
    assert.ok(findByClassName(spec, "tile-grid"));
    assert.ok(findByClassName(spec, "chart-panel"));
    assert.equal(findByClassName(spec, "error-banner"), null);
  });

  await t.test("success + error (cached fallback) shows the error banner above the live content", () => {
    const data = transformOverviewData(fullPayload());
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "http", status: 503 });
    const spec = buildOverviewSpec({ status: "success", data, error, isStale: false });
    assert.ok(findByClassName(spec, "error-banner"));
    assert.ok(findByClassName(spec, "tile-grid"), "cached content must stay visible under the banner");
  });

  await t.test("success + isStale (no error) shows a warning banner, not the error icon", () => {
    const data = transformOverviewData(fullPayload());
    const spec = buildOverviewSpec({ status: "success", data, error: null, isStale: true });
    const banner = findByClassName(spec, "error-banner");
    assert.ok(banner);
    assert.equal(banner.children[0].className, "icon icon-warning error-banner__icon");
    assert.match(banner.children[1].text, /stale/);
  });

  await t.test("an error takes precedence over a stale flag -- only one banner, not two", () => {
    const data = transformOverviewData(fullPayload());
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "network" });
    const spec = buildOverviewSpec({ status: "success", data, error, isStale: true });
    const page = spec.children.filter((c) => c.className === "error-banner");
    assert.equal(page.length, 1);
  });

  await t.test("every state renders the page heading", () => {
    for (const state of [
      { status: "loading" },
      { status: "error", data: null, error: null, isStale: false },
    ]) {
      const spec = buildOverviewSpec(state);
      assert.equal(spec.children[0].tag, "h1");
      assert.equal(spec.children[0].text, "Overview");
    }
  });

  await t.test("stat tile values come from formatted sdiff/counts, missing values show as null through to the component", () => {
    const data = transformOverviewData(fullPayload({ pool: { accepted_count: 42 } }));
    const spec = buildOverviewSpec({ status: "success", data, error: null, isStale: false });
    const tileGrid = findByClassName(spec, "tile-grid");
    const values = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__value").text);
    assert.equal(values[0], "42");
  });

  await t.test("an unrecognized status throws rather than silently rendering the success branch", () => {
    assert.throws(
      () => buildOverviewSpec({ status: "not-a-real-status" }),
      /unrecognized status/,
    );
  });
});

test("mount/unmount lifecycle (no DOM emulation)", async (t) => {
  t.afterEach(() => unmount());

  function fakeContainer() {
    return {};
  }

  await t.test("renders loading synchronously, then the fetch result once it resolves", async () => {
    const container = fakeContainer();
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return null;
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(container, { fetchImpl, render });

    // Synchronous: the loading spec is rendered before fetchEndpoint's
    // promise has had a chance to resolve.
    assert.equal(renders.length, 1);
    assert.ok(findByClassName(renders[0], "overview-page__loading"));

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(renders.length, 2);
    assert.ok(findByClassName(renders[1], "tile-grid"));
  });

  await t.test("throws on a second mount() without an intervening unmount()", () => {
    const container = fakeContainer();
    const render = () => null;
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(container, { fetchImpl, render });
    assert.throws(() => mount(container, { fetchImpl, render }), /already mounted/);
  });

  await t.test("unmount() before any mount() is a safe no-op", () => {
    assert.doesNotThrow(() => unmount());
  });

  await t.test("a fetch that resolves after unmount() does not trigger a render", async () => {
    const container = fakeContainer();
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return null;
    };

    let releaseFetch;
    const gate = new Promise((resolve) => {
      releaseFetch = resolve;
    });
    const fetchImpl = async () => {
      await gate;
      return { ok: true, status: 200, json: async () => fullPayload() };
    };

    mount(container, { fetchImpl, render });
    assert.equal(renders.length, 1); // the synchronous loading render

    unmount(); // itself renders once more, to clear the container
    assert.equal(renders.length, 2);

    releaseFetch();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(renders.length, 2, "no render should happen for a fetch that resolves post-unmount");
  });

  await t.test(
    "a stale mount's in-flight fetch cannot affect a newer mount after unmount()+remount()",
    async () => {
      const container = fakeContainer();

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

      mount(container, { fetchImpl: oldFetchImpl, render: oldRender });
      assert.equal(oldRenders.length, 1); // loading only -- fetch never resolved

      unmount(); // torn down while the fetch above is still in flight

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

      mount(container, { fetchImpl: newFetchImpl, render: newRender });
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(newRenders.length, 2, "new mount's own loading + success renders");

      // The stale mount's fetch finally resolves -- it must be inert.
      releaseOldFetch();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(
        newRenders.length,
        2,
        "a stale mount's late-resolving fetch must not render into a newer mount",
      );
    },
  );

  await t.test("mount() writes the fetched payload into core/state.js so shell.js's staleness text can read it", async () => {
    const container = fakeContainer();
    const render = () => null;
    const payload = fullPayload();
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => payload });

    mount(container, { fetchImpl, render });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(getState().analytics, payload);
    assert.equal(typeof getState().analyticsFetchedAt, "string");
  });

  await t.test("a total failure (no cache) does not overwrite state.js with null", async () => {
    const container = fakeContainer();
    const render = () => null;
    const fetchImpl = async () => {
      throw new TypeError("Failed to fetch");
    };

    mount(container, { fetchImpl, render, staleAfterMs: undefined });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    // state.js is a module singleton with leftover values from earlier
    // tests in this file -- the only thing worth asserting here is that
    // a null-payload result was never itself written into it.
    assert.notEqual(getState().analytics, null);
  });

  await t.test("polling: renders again on each tick, stops after unmount()", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    const container = fakeContainer();
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return null;
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    mount(container, { fetchImpl, render, intervalMs: 1000 });
    await flush();
    await flush();
    assert.equal(renders.length, 2, "synchronous loading render + first fetch result");

    t.mock.timers.tick(1000);
    await flush();
    await flush();
    assert.equal(renders.length, 3);

    unmount(); // stops polling, and renders once more to clear the container
    assert.equal(renders.length, 4);

    t.mock.timers.tick(1000);
    await flush();
    assert.equal(renders.length, 4, "no further renders after unmount() stops polling");
  });

  await t.test("no polling is started when intervalMs is omitted", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    const container = fakeContainer();
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return null;
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    mount(container, { fetchImpl, render });
    await flush();
    await flush();
    assert.equal(renders.length, 2);

    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(renders.length, 2, "without intervalMs, mount() must not poll");
  });

  await t.test("unmount() disposes the active chart instance", async () => {
    const container = fakeContainer();
    const disposeCalls = [];
    // A fake canvas marker and a fake createChartImpl -- neither
    // touches real DOM/ECharts.
    const render = () => ({ fakeCanvas: true });
    const createChartImpl = () => ({
      update() {},
      dispose() {
        disposeCalls.push(true);
      },
    });
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });
    const readThemeTokensImpl = () => ({});

    mount(container, { fetchImpl, render, createChartImpl, readThemeTokensImpl });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(disposeCalls.length, 0, "not disposed yet -- still mounted");
    unmount();
    assert.equal(disposeCalls.length, 1);
  });

  await t.test(
    "a same-status poll tick updates the existing chart in place, rather than disposing and recreating it",
    async (t) => {
      // docs/ARCHITECTURE.md Section 16 point 1 / Section 20:
      // background refreshes update in place with no visible reload --
      // a dispose()+recreate on every poll tick would flash the
      // canvas-rendered chart on every refresh.
      t.mock.timers.enable({ apis: ["setTimeout"] });

      const container = fakeContainer();
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

      mount(container, { fetchImpl, render, createChartImpl, readThemeTokensImpl, intervalMs: 1000 });
      await flush();
      await flush();
      assert.equal(createCalls, 1, "the chart is created once, on the first real data render");
      assert.equal(disposeCalls.length, 0);
      assert.equal(updateCalls.length, 0);

      t.mock.timers.tick(1000);
      await flush();
      await flush();
      assert.equal(createCalls, 1, "a same-status poll tick must reuse the existing chart, not recreate it");
      assert.equal(disposeCalls.length, 0, "the chart must not be disposed by a same-status poll tick");
      assert.equal(updateCalls.length, 1, "a same-status poll tick must call update() with fresh data");

      unmount();
      assert.equal(disposeCalls.length, 1, "unmount() still disposes the chart exactly once");
    },
  );

  await t.test("a real status change (success -> empty) disposes the chart, never calls update()", async (t) => {
    // Unlike the reuse test above, this must actually drive a second
    // render through a *different* status via a real poll tick -- a
    // single-fetch test would never exercise renderState's dispose
    // branch at all.
    t.mock.timers.enable({ apis: ["setTimeout"] });

    const container = fakeContainer();
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

    mount(container, { fetchImpl, render, createChartImpl, readThemeTokensImpl, intervalMs: 1000 });
    await flush();
    await flush();
    assert.equal(disposeCalls.length, 0, "the chart exists after the first (success) render");

    t.mock.timers.tick(1000);
    await flush();
    await flush();
    assert.equal(disposeCalls.length, 1, "success -> empty must dispose the chart, not update it");

    unmount();
    assert.equal(disposeCalls.length, 1, "unmount() must not double-dispose an already-disposed chart");
  });

  await t.test("repaints the chart when the active theme changes, but not for an unrelated state.js change", async () => {
    const container = fakeContainer();
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

    mount(container, { fetchImpl, render, createChartImpl, readThemeTokensImpl });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(updateCalls.length, 0, "no repaint yet -- the chart was just created, not toggled");

    setState({ searchQuery: "alice" });
    assert.equal(updateCalls.length, 0, "an unrelated state.js change must not repaint the chart");

    const before = getState().theme;
    setState({ theme: before === "light" ? "dark" : "light" });
    assert.equal(updateCalls.length, 1, "an actual theme change must repaint the chart");

    setState({ theme: getState().theme });
    assert.equal(updateCalls.length, 1, "setting the same theme again must not repaint the chart a second time");
  });

  await t.test("an invalid staleAfterMs is dropped, not passed through to fail deep inside getStaleness", async () => {
    const container = fakeContainer();
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return null;
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(container, { fetchImpl, render, staleAfterMs: NaN });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(renders.length, 2);
    assert.ok(
      findByClassName(renders[1], "tile-grid"),
      "a malformed staleAfterMs must not surface as a fetch/network error",
    );
  });

  await t.test("unmount() clears the container by rendering an empty page shell", async () => {
    const container = fakeContainer();
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return null;
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(container, { fetchImpl, render });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(renders.length, 2);

    unmount();
    assert.equal(renders.length, 3);
    assert.equal(renders[2].className, "overview-page");
    assert.deepEqual(renders[2].children, []);
  });
});
