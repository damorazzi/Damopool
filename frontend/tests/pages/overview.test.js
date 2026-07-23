import test from "node:test";
import assert from "node:assert/strict";
import {
  route,
  transformOverviewData,
  isOverviewEmpty,
  deriveOverviewState,
  buildOverviewSpec,
  mount,
  unmount,
} from "../../src/pages/overview.js";
import { getState, setState } from "../../src/core/state.js";
import { FetchApiError } from "../../src/core/api.js";
import { BUCKET_COUNT } from "../../src/charts/histogram-chart.js";

function emptyBucketData() {
  return { bucket_counts: new Array(BUCKET_COUNT).fill(0), bucket_best: new Array(BUCKET_COUNT).fill(null) };
}

function fullPayload(overrides = {}) {
  return {
    metadata: { schema_version: "1.4", generated_at: new Date().toISOString(), ...overrides.metadata },
    pool: {
      accepted_count: 1000,
      rejected_count: 5,
      best_share_today: { username: "alice", workername: "rig1", sdiff: 512.5, timestamp: "unknown" },
      best_share_ever: { username: "bob", workername: "rig2", sdiff: 2048, timestamp: "unknown" },
      hashrate_1m: 13400000000000,
      hashrate_24h: 12500000000000,
      network_difficulty: 127170500429035.2,
      difficulty_histogram: { "1d": emptyBucketData(), total: emptyBucketData() },
      block_progress: {
        best_share_difficulty: 28_600_000_000,
        network_difficulty: 126_000_000_000_000,
        progress_percent: 0.0227,
        still_needed_multiplier: 4406,
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

function findAllByClassName(spec, className, acc = []) {
  if (!spec || typeof spec !== "object") return acc;
  const classes = (spec.className || "").split(" ");
  if (classes.includes(className)) acc.push(spec);
  for (const child of spec.children || []) {
    findAllByClassName(child, className, acc);
  }
  return acc;
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
  });

  await t.test("Phase E Milestone 28: extracts hashrate_1m/hashrate_24h as hashrate1m/hashrate24h", () => {
    const payload = fullPayload();
    const data = transformOverviewData(payload);
    assert.equal(data.hashrate1m, 13400000000000);
    assert.equal(data.hashrate24h, 12500000000000);
  });

  await t.test("Phase E Milestone 29: extracts difficulty_histogram and network_difficulty verbatim", () => {
    const payload = fullPayload();
    const data = transformOverviewData(payload);
    assert.deepEqual(data.difficultyHistogram, payload.pool.difficulty_histogram);
    assert.equal(data.networkDifficulty, 127170500429035.2);
  });

  await t.test("a missing difficulty_histogram degrades to an empty (all-zero) shape, never a missing key", () => {
    const data = transformOverviewData({ metadata: {}, pool: {} });
    assert.deepEqual(Object.keys(data.difficultyHistogram).sort(), ["1d", "total"]);
    assert.ok(data.difficultyHistogram["1d"].bucket_counts.every((c) => c === 0));
  });

  await t.test("Phase E Milestone 30: extracts block_progress verbatim", () => {
    const payload = fullPayload();
    const data = transformOverviewData(payload);
    assert.deepEqual(data.blockProgress, payload.pool.block_progress);
  });

  await t.test("a missing block_progress degrades to an all-null shape, never a missing key", () => {
    const data = transformOverviewData({ metadata: {}, pool: {} });
    assert.deepEqual(data.blockProgress, {
      best_share_difficulty: null,
      network_difficulty: null,
      progress_percent: null,
      still_needed_multiplier: null,
    });
  });

  await t.test("degrades gracefully when pool/metadata fields are missing", () => {
    const data = transformOverviewData({ metadata: {}, pool: {} });
    assert.equal(data.generatedAt, null);
    assert.equal(data.acceptedCount, undefined);
    assert.equal(data.bestShareToday, null);
    assert.equal(data.hashrate1m, undefined);
    assert.equal(data.hashrate24h, undefined);
    assert.equal(data.networkDifficulty, undefined);
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

test("buildOverviewSpec", async (t) => {
  await t.test("loading state renders skeletons, no stat tiles or chart", () => {
    const spec = buildOverviewSpec({ status: "loading" });
    assert.ok(findByClassName(spec, "overview-page__loading"));
    assert.equal(findByClassName(spec, "tile-grid").attrs["aria-busy"], "true");
    assert.equal(findByClassName(spec, "chart-panel"), null);
  });

  await t.test("Code Review finding (Milestone 28): loading-skeleton tile count matches the real success-state tile count, so there is no layout shift when data arrives", () => {
    const loadingTileCount = findByClassName(buildOverviewSpec({ status: "loading" }), "tile-grid").children.length;
    const data = transformOverviewData(fullPayload());
    const successTileCount = findByClassName(
      buildOverviewSpec({ status: "success", data, error: null, isStale: false }),
      "tile-grid",
    ).children.length;
    assert.equal(loadingTileCount, successTileCount);
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

  await t.test("success state renders stat tiles and the histogram panel, no banner", () => {
    const data = transformOverviewData(fullPayload());
    const spec = buildOverviewSpec({ status: "success", data, error: null, isStale: false });
    assert.ok(findByClassName(spec, "tile-grid"));
    assert.ok(findByClassName(spec, "chart-panel"));
    assert.ok(findByClassName(spec, "histogram-panel"));
    assert.ok(findByClassName(spec, "dataset-toggle"));
    assert.equal(findByClassName(spec, "error-banner"), null);
  });

  await t.test("Phase E Milestone 29: histogram panel titled 'Pool Share Difficulty Histogram'", () => {
    const data = transformOverviewData(fullPayload());
    const spec = buildOverviewSpec({ status: "success", data, error: null, isStale: false });
    const panel = findByClassName(spec, "histogram-panel");
    assert.equal(findByClassName(panel, "card__header").text, "Pool Share Difficulty Histogram");
  });

  await t.test("Phase E Milestone 30: renders the Block Progress panel with correctly formatted values", () => {
    const data = transformOverviewData(fullPayload());
    const spec = buildOverviewSpec({ status: "success", data, error: null, isStale: false });
    const panel = findByClassName(spec, "block-progress-panel");
    assert.ok(panel, "expected a Block Progress panel on the Overview page");
    assert.equal(findByClassName(panel, "card__header").text, "Block Progress");

    const tiles = findAllByClassName(panel, "stat-tile");
    const labels = tiles.map((tile) => findByClassName(tile, "stat-tile__label").text);
    const values = tiles.map((tile) => findByClassName(tile, "stat-tile__value").text);
    assert.deepEqual(labels, ["Current Network Difficulty", "Best Share", "Block Progress", "Still Needed"]);
    assert.equal(values[0], "126T");
    // formatCompactSdiff uses this project's own established SI-style
    // "G" (Giga) rather than "B" (Billion) -- the Human brief's own
    // illustrative example used "28.6B", but the explicit instruction
    // ("Use the existing difficulty formatter") takes precedence over
    // that example's exact letter, matching every other difficulty
    // value already shown across this app.
    assert.equal(values[1], "28.6G");
    assert.equal(values[2], "0.0227%");
    assert.equal(values[3], "×4,406");
  });

  await t.test("Phase E Milestone 30: a scope with no best share or network difficulty renders '--' placeholders, not a crash", () => {
    const data = transformOverviewData(fullPayload({
      pool: {
        block_progress: {
          best_share_difficulty: null,
          network_difficulty: null,
          progress_percent: null,
          still_needed_multiplier: null,
        },
      },
    }));
    const spec = buildOverviewSpec({ status: "success", data, error: null, isStale: false });
    const panel = findByClassName(spec, "block-progress-panel");
    const tiles = findAllByClassName(panel, "stat-tile");
    const values = tiles.map((tile) => findByClassName(tile, "stat-tile__value").text);
    assert.deepEqual(values, ["--", "--", "--", "--"]);
  });

  await t.test("defaults to the '1 Day' dataset when histogramDataset is not supplied", () => {
    const data = transformOverviewData(fullPayload());
    const spec = buildOverviewSpec({ status: "success", data, error: null, isStale: false });
    const toggle = findByClassName(spec, "dataset-toggle");
    const activeButton = toggle.children.find((b) => b.className.includes("--active"));
    assert.equal(activeButton.attrs["data-dataset"], "1d");
  });

  await t.test("honors an explicit histogramDataset selection ('total')", () => {
    const data = transformOverviewData(fullPayload());
    const spec = buildOverviewSpec({ status: "success", data, error: null, isStale: false, histogramDataset: "total" });
    const toggle = findByClassName(spec, "dataset-toggle");
    const activeButton = toggle.children.find((b) => b.className.includes("--active"));
    assert.equal(activeButton.attrs["data-dataset"], "total");
    assert.match(findByClassName(spec, "chart-panel__summary").text, /Total \(Lifetime\)/);
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

  await t.test("Phase E Milestone 28: Pool Hashrate (1m)/(24h) tiles render with compact-formatted values", () => {
    const data = transformOverviewData(fullPayload());
    const spec = buildOverviewSpec({ status: "success", data, error: null, isStale: false });
    const tileGrid = findByClassName(spec, "tile-grid");
    const labels = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__label").text);
    const values = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__value").text);
    const oneMinIndex = labels.indexOf("Pool Hashrate (1m)");
    const oneDayIndex = labels.indexOf("Pool Hashrate (24h)");
    assert.ok(oneMinIndex !== -1, "expected a Pool Hashrate (1m) tile");
    assert.ok(oneDayIndex !== -1, "expected a Pool Hashrate (24h) tile");
    assert.equal(values[oneMinIndex], "13.4T");
    assert.equal(values[oneDayIndex], "12.5T");
  });

  await t.test("Human requirement: a missing native hashrate degrades to a placeholder, never an estimate or a crash", () => {
    const data = transformOverviewData(fullPayload({ pool: { hashrate_1m: null, hashrate_24h: null } }));
    const spec = buildOverviewSpec({ status: "success", data, error: null, isStale: false });
    const tileGrid = findByClassName(spec, "tile-grid");
    const labels = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__label").text);
    const values = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__value").text);
    assert.equal(values[labels.indexOf("Pool Hashrate (1m)")], "--");
    assert.equal(values[labels.indexOf("Pool Hashrate (24h)")], "--");
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

  // Milestone 29's defaultRender contract returns { canvasNode,
  // toggleButtonNodes } rather than a bare canvas node -- every fake
  // render below that used to return `null`/a bare marker object now
  // returns this shape instead.
  function fakeRenderResult(canvasNode = null, toggleButtonNodes = []) {
    return { canvasNode, toggleButtonNodes };
  }

  await t.test("renders loading synchronously, then the fetch result once it resolves", async () => {
    const container = fakeContainer();
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return fakeRenderResult();
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
    const render = () => fakeRenderResult();
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
      return fakeRenderResult();
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
        return fakeRenderResult();
      };

      mount(container, { fetchImpl: oldFetchImpl, render: oldRender });
      assert.equal(oldRenders.length, 1); // loading only -- fetch never resolved

      unmount(); // torn down while the fetch above is still in flight

      const newRenders = [];
      const newRender = (target, spec) => {
        newRenders.push(spec);
        return fakeRenderResult();
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
    const render = () => fakeRenderResult();
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
    const render = () => fakeRenderResult();
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
      return fakeRenderResult();
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
      return fakeRenderResult();
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
    const render = () => fakeRenderResult({ fakeCanvas: true });
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
      const render = () => fakeRenderResult({ fakeCanvas: true });
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
    const render = () => fakeRenderResult({ fakeCanvas: true });
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
    const render = () => fakeRenderResult({ fakeCanvas: true });
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
      return fakeRenderResult();
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
      return fakeRenderResult();
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

  // Phase E Milestone 29: the dataset-toggle wiring.
  await t.test("clicking the 'Total' toggle button switches the active dataset and updates the chart in place", async () => {
    const container = fakeContainer();
    const updateCalls = [];
    let toggleButtons = [];

    function fakeButtonNode(datasetKey) {
      return {
        listeners: {},
        getAttribute(name) {
          return name === "data-dataset" ? datasetKey : null;
        },
        addEventListener(type, fn) {
          this.listeners[type] = fn;
        },
      };
    }

    const render = () => {
      toggleButtons = [fakeButtonNode("1d"), fakeButtonNode("total")];
      return fakeRenderResult({ fakeCanvas: true }, toggleButtons);
    };
    const createChartImpl = () => ({
      update(option) {
        updateCalls.push(option);
      },
      dispose() {},
    });
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });
    const readThemeTokensImpl = () => ({});

    mount(container, { fetchImpl, render, createChartImpl, readThemeTokensImpl });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(updateCalls.length, 0, "no update yet -- chart was just created");

    toggleButtons[1].listeners.click();
    assert.equal(updateCalls.length, 1, "clicking a different dataset must update the existing chart, not recreate it");
  });

  await t.test("clicking the already-active dataset button is a no-op", async () => {
    const container = fakeContainer();
    const updateCalls = [];
    let toggleButtons = [];

    function fakeButtonNode(datasetKey) {
      return {
        listeners: {},
        getAttribute(name) {
          return name === "data-dataset" ? datasetKey : null;
        },
        addEventListener(type, fn) {
          this.listeners[type] = fn;
        },
      };
    }

    const render = () => {
      toggleButtons = [fakeButtonNode("1d"), fakeButtonNode("total")];
      return fakeRenderResult({ fakeCanvas: true }, toggleButtons);
    };
    const createChartImpl = () => ({
      update(option) {
        updateCalls.push(option);
      },
      dispose() {},
    });
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });
    const readThemeTokensImpl = () => ({});

    mount(container, { fetchImpl, render, createChartImpl, readThemeTokensImpl });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    toggleButtons[0].listeners.click(); // already "1d", the default
    assert.equal(updateCalls.length, 0, "clicking the currently-active dataset must not trigger an update");
  });
});
