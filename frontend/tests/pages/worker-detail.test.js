import test from "node:test";
import assert from "node:assert/strict";
import {
  route,
  transformWorkerDetailData,
  deriveWorkerDetailState,
  buildWorkerDetailSpec,
  mount,
  unmount,
} from "../../src/pages/worker-detail.js";
import { getState, setState } from "../../src/core/state.js";
import { FetchApiError } from "../../src/core/api.js";
import { truncateWorkername } from "../../src/core/format.js";
import { BUCKET_COUNT } from "../../src/charts/histogram-chart.js";

function emptyBucketData() {
  return { bucket_counts: new Array(BUCKET_COUNT).fill(0), bucket_best: new Array(BUCKET_COUNT).fill(null) };
}

function fullPayload(overrides = {}) {
  return {
    metadata: { schema_version: "1.4", generated_at: new Date().toISOString(), ...overrides.metadata },
    pool: { network_difficulty: 127170500429035.2, ...overrides.pool },
    users: {},
    workers: {
      rig1: {
        agent: "cgminer/4.11.1",
        is_active: true,
        first_share_at: new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString(),
        last_share_at: new Date(Date.now() - 5 * 60_000).toISOString(),
        accepted_count: 500,
        rejected_count: 2,
        invalid_result_count: 1,
        average_sdiff: 105.5,
        median_sdiff: 100,
        min_sdiff: 1,
        max_sdiff: 2048,
        best_share_today: { username: "alice", workername: "rig1", sdiff: 512.5, timestamp: "unknown" },
        best_share_ever: { username: "alice", workername: "rig1", sdiff: 2048, timestamp: "unknown" },
        hashrate_1m: 5000000000000,
        hashrate_24h: 6000000000000,
        difficulty_histogram: { "1d": emptyBucketData(), total: emptyBucketData() },
        block_progress: {
          best_share_difficulty: 28_600_000_000,
          network_difficulty: 126_000_000_000_000,
          progress_percent: 0.0227,
          still_needed_multiplier: 4406,
        },
        ...overrides.rig1Record,
      },
      ...overrides.workers,
    },
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
  await t.test("is a dynamic route with a :workername segment", () => {
    assert.equal(route.pattern, "/workers/:workername");
    assert.equal(route.name, "worker-detail");
  });
});

test("transformWorkerDetailData", async (t) => {
  await t.test("extracts the subject's own record", () => {
    const data = transformWorkerDetailData(fullPayload(), "rig1");
    assert.equal(data.workername, "rig1");
    assert.equal(data.agent, "cgminer/4.11.1");
    assert.equal(data.isActive, true);
    assert.equal(data.acceptedCount, 500);
    assert.equal(data.invalidResultCount, 1);
    assert.equal(data.minSdiff, 1);
    assert.equal(data.maxSdiff, 2048);
  });

  await t.test("returns null when the workername has no record at all -- the not-found signal", () => {
    assert.equal(transformWorkerDetailData(fullPayload(), "nonexistent"), null);
  });

  await t.test("Phase E Milestone 28: extracts hashrate_1m/hashrate_24h as hashrate1m/hashrate24h", () => {
    const data = transformWorkerDetailData(fullPayload(), "rig1");
    assert.equal(data.hashrate1m, 5000000000000);
    assert.equal(data.hashrate24h, 6000000000000);
  });

  await t.test("missing native hashrate fields pass through as undefined, not a throw", () => {
    const data = transformWorkerDetailData(
      fullPayload({ rig1Record: { hashrate_1m: undefined, hashrate_24h: undefined } }),
      "rig1",
    );
    assert.equal(data.hashrate1m, undefined);
    assert.equal(data.hashrate24h, undefined);
  });

  await t.test("Phase E Milestone 29: extracts this worker's own difficulty_histogram and the pool-wide network_difficulty", () => {
    const payload = fullPayload();
    const data = transformWorkerDetailData(payload, "rig1");
    assert.deepEqual(data.difficultyHistogram, payload.workers.rig1.difficulty_histogram);
    assert.equal(data.networkDifficulty, 127170500429035.2);
  });

  await t.test("a missing difficulty_histogram on this worker's record degrades to an empty (all-zero) shape", () => {
    const data = transformWorkerDetailData(fullPayload({ rig1Record: { difficulty_histogram: undefined } }), "rig1");
    assert.ok(data.difficultyHistogram["1d"].bucket_counts.every((c) => c === 0));
  });

  await t.test("Phase E Milestone 30: extracts this worker's own block_progress verbatim", () => {
    const payload = fullPayload();
    const data = transformWorkerDetailData(payload, "rig1");
    assert.deepEqual(data.blockProgress, payload.workers.rig1.block_progress);
  });

  await t.test("a missing block_progress on this worker's record degrades to an all-null shape", () => {
    const data = transformWorkerDetailData(fullPayload({ rig1Record: { block_progress: undefined } }), "rig1");
    assert.deepEqual(data.blockProgress, {
      best_share_difficulty: null,
      network_difficulty: null,
      progress_percent: null,
      still_needed_multiplier: null,
    });
  });

  await t.test("degrades gracefully when fields are missing", () => {
    const data = transformWorkerDetailData({ metadata: {}, workers: { rig1: {} } }, "rig1");
    assert.equal(data.agent, null);
    assert.equal(data.isActive, false);
    assert.equal(data.firstShareAt, null);
    assert.equal(data.bestShareToday, null);
  });

  await t.test("a workername matching an Object.prototype member name is correctly not-found, not a phantom record", () => {
    // Same class of risk as user-detail.js's username lookup:
    // workername is URL-supplied, fully attacker-controlled text used
    // as a direct bracket key -- applying the lesson from that
    // milestone's own review finding proactively here.
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      assert.equal(
        transformWorkerDetailData(fullPayload(), name),
        null,
        `"${name}" must not resolve through the prototype chain as if it were a real worker`,
      );
    }
  });

  await t.test("a genuinely existing worker named after an Object.prototype member is found correctly", () => {
    const data = transformWorkerDetailData(
      fullPayload({ workers: { constructor: { accepted_count: 1, is_active: false } } }),
      "constructor",
    );
    assert.ok(data, "a real own key named 'constructor' must not be treated as not-found");
    assert.equal(data.workername, "constructor");
    assert.equal(data.acceptedCount, 1);
  });
});

test("deriveWorkerDetailState", async (t) => {
  await t.test("no payload at all is status error with no data", () => {
    const state = deriveWorkerDetailState({ payload: null, workername: "rig1", error: new Error("boom") });
    assert.equal(state.status, "error");
    assert.equal(state.data, null);
  });

  await t.test("a payload with no record for this workername is status not-found", () => {
    const state = deriveWorkerDetailState({ payload: fullPayload(), workername: "nonexistent" });
    assert.equal(state.status, "not-found");
    assert.equal(state.workername, "nonexistent");
  });

  await t.test("a real record is status success", () => {
    const state = deriveWorkerDetailState({ payload: fullPayload(), workername: "rig1" });
    assert.equal(state.status, "success");
  });

  await t.test("an error alongside a cached (still valid) record keeps status success and carries the error", () => {
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "network" });
    const state = deriveWorkerDetailState({ payload: fullPayload(), workername: "rig1", error });
    assert.equal(state.status, "success");
    assert.equal(state.error, error);
  });
});

test("buildWorkerDetailSpec", async (t) => {
  await t.test("loading state shows the header (with workername) and skeletons, no real chart", () => {
    const spec = buildWorkerDetailSpec({ status: "loading", workername: "rig1" });
    assert.ok(findByClassName(spec, "worker-detail-page__loading"));
    const heading = findByClassName(spec, "worker-detail-page__title");
    assert.match(heading.text, /rig1/);
    assert.equal(findByClassName(spec, "chart-panel"), null);
  });

  await t.test("Code Review finding (Milestone 28): loading-skeleton tile count matches the real success-state tile count, so there is no layout shift when data arrives", () => {
    const loadingTileCount = findByClassName(
      buildWorkerDetailSpec({ status: "loading", workername: "rig1" }),
      "tile-grid",
    ).children.length;
    const data = transformWorkerDetailData(fullPayload(), "rig1");
    const successTileCount = findByClassName(
      buildWorkerDetailSpec({ status: "success", data, workername: "rig1", error: null, isStale: false }),
      "tile-grid",
    ).children.length;
    assert.equal(loadingTileCount, successTileCount);
  });

  await t.test("error state (no data) renders the header and only the error banner", () => {
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "network" });
    const spec = buildWorkerDetailSpec({ status: "error", data: null, workername: "rig1", error, isStale: false });
    assert.ok(findByClassName(spec, "error-banner"));
    assert.match(findByClassName(spec, "worker-detail-page__title").text, /rig1/);
  });

  await t.test("not-found state names the specific workername, not a generic message", () => {
    const spec = buildWorkerDetailSpec({
      status: "not-found",
      data: null,
      workername: "nonexistent",
      error: null,
      isStale: false,
    });
    assert.ok(findByClassName(spec, "empty-state"));
    const message = findByClassName(spec, "empty-state__message");
    assert.ok(message.text.includes(truncateWorkername("nonexistent")));
  });

  await t.test("success renders the back-link, all 15 stat tiles, and the histogram panel -- no DataTable/split-layout", () => {
    const data = transformWorkerDetailData(fullPayload(), "rig1");
    const spec = buildWorkerDetailSpec({ status: "success", data, workername: "rig1", error: null, isStale: false });

    const backLink = findByClassName(spec, "worker-detail-page__back-link");
    assert.equal(backLink.attrs.href, "#/workers");

    const tileGrid = findByClassName(spec, "tile-grid");
    assert.equal(tileGrid.children.length, 15);

    assert.ok(findByClassName(spec, "histogram-panel"));
    assert.equal(
      findByClassName(findByClassName(spec, "histogram-panel"), "card__header").text,
      "Worker Share Difficulty Histogram",
    );
    assert.equal(findByClassName(spec, "data-table"), null, "worker-detail.js has no DataTable per Section 5");
    assert.equal(findByClassName(spec, "split-layout"), null, "worker-detail.js has no split-layout per Section 5");
    assert.equal(findByClassName(spec, "error-banner"), null);
  });

  await t.test("Phase E Milestone 30: renders the Block Progress panel with correctly formatted values", () => {
    const data = transformWorkerDetailData(fullPayload(), "rig1");
    const spec = buildWorkerDetailSpec({ status: "success", data, workername: "rig1", error: null, isStale: false });
    const panel = findByClassName(spec, "block-progress-panel");
    assert.ok(panel, "expected a Block Progress panel on Worker Detail");
    assert.equal(findByClassName(panel, "card__header").text, "Block Progress");

    const tiles = findAllByClassName(panel, "stat-tile");
    const labels = tiles.map((tile) => findByClassName(tile, "stat-tile__label").text);
    const values = tiles.map((tile) => findByClassName(tile, "stat-tile__value").text);
    assert.deepEqual(labels, ["Current Network Difficulty", "Best Share", "Block Progress", "Still Needed"]);
    assert.equal(values[0], "126T");
    assert.equal(values[1], "28.6G");
    assert.equal(values[2], "0.0227%");
    assert.equal(values[3], "×4,406");
  });

  await t.test("Phase E Milestone 28: Worker Hashrate (1m)/(24h) tiles render with compact-formatted values", () => {
    const data = transformWorkerDetailData(fullPayload(), "rig1");
    const spec = buildWorkerDetailSpec({ status: "success", data, workername: "rig1", error: null, isStale: false });
    const tileGrid = findByClassName(spec, "tile-grid");
    const labels = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__label").text);
    const values = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__value").text);
    assert.equal(values[labels.indexOf("Worker Hashrate (1m)")], "5T");
    assert.equal(values[labels.indexOf("Worker Hashrate (24h)")], "6T");
  });

  await t.test("Human requirement: a missing native hashrate degrades to a placeholder, never an estimate or a crash", () => {
    const data = transformWorkerDetailData(fullPayload({ rig1Record: { hashrate_1m: null, hashrate_24h: null } }), "rig1");
    const spec = buildWorkerDetailSpec({ status: "success", data, workername: "rig1", error: null, isStale: false });
    const tileGrid = findByClassName(spec, "tile-grid");
    const labels = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__label").text);
    const values = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__value").text);
    assert.equal(values[labels.indexOf("Worker Hashrate (1m)")], "--");
    assert.equal(values[labels.indexOf("Worker Hashrate (24h)")], "--");
  });

  await t.test("the Status tile reflects is_active correctly in both directions", () => {
    const activeData = transformWorkerDetailData(fullPayload(), "rig1");
    const activeSpec = buildWorkerDetailSpec({ status: "success", data: activeData, workername: "rig1", error: null, isStale: false });
    const activeValue = findByClassName(activeSpec, "tile-grid").children[0];
    assert.equal(findByClassName(activeValue, "stat-tile__value").text, "Active");

    const inactiveData = transformWorkerDetailData(
      fullPayload({ rig1Record: { is_active: false } }),
      "rig1",
    );
    const inactiveSpec = buildWorkerDetailSpec({ status: "success", data: inactiveData, workername: "rig1", error: null, isStale: false });
    const inactiveValue = findByClassName(inactiveSpec, "tile-grid").children[0];
    assert.equal(findByClassName(inactiveValue, "stat-tile__value").text, "Inactive");
  });

  await t.test("success + error (cached fallback) shows the error banner above the live content", () => {
    const data = transformWorkerDetailData(fullPayload(), "rig1");
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "http", status: 503 });
    const spec = buildWorkerDetailSpec({ status: "success", data, workername: "rig1", error, isStale: false });
    assert.ok(findByClassName(spec, "error-banner"));
    assert.ok(findByClassName(spec, "chart-panel"));
  });

  await t.test("success + isStale (no error) shows a warning banner, not the error icon", () => {
    const data = transformWorkerDetailData(fullPayload(), "rig1");
    const spec = buildWorkerDetailSpec({ status: "success", data, workername: "rig1", error: null, isStale: true });
    const banner = findByClassName(spec, "error-banner");
    assert.equal(banner.children[0].className, "icon icon-warning error-banner__icon");
  });

  await t.test("an unrecognized status throws rather than silently rendering the success branch", () => {
    assert.throws(() => buildWorkerDetailSpec({ status: "not-a-real-status", workername: "rig1" }), /unrecognized status/);
  });

  await t.test("a malicious workername in the URL passes through the heading as text, never markup", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const spec = buildWorkerDetailSpec({ status: "loading", workername: raw });
    const heading = findByClassName(spec, "worker-detail-page__title");
    assert.equal(heading.text, `Worker: ${truncateWorkername(raw)}`);
    assert.equal(heading.tag, "h1");
    assert.equal(heading.attrs.title, raw);
    assert.equal(heading.attrs["aria-label"], `Worker: ${raw}`);
  });
});

test("mount/unmount lifecycle (no DOM emulation)", async (t) => {
  t.afterEach(() => unmount());

  function fakeContainer() {
    return {};
  }

  // Milestone 29's defaultRender contract returns { canvasNode,
  // toggleButtonNodes } rather than a bare canvas node.
  function fakeRenderResult(canvasNode = null, toggleButtonNodes = []) {
    return { canvasNode, toggleButtonNodes };
  }

  await t.test("throws if params.workername is missing", () => {
    const render = () => fakeRenderResult();
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });
    assert.throws(() => mount(fakeContainer(), { fetchImpl, render, params: {} }), /params\.workername is required/);
    assert.throws(() => mount(fakeContainer(), { fetchImpl, render }), /params\.workername is required/);
  });

  await t.test("renders loading synchronously (with the workername already known), then the fetch result", async () => {
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return fakeRenderResult();
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render, params: { workername: "rig1" } });

    assert.equal(renders.length, 1);
    assert.match(findByClassName(renders[0], "worker-detail-page__title").text, /rig1/);

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(renders.length, 2);
    assert.ok(findByClassName(renders[1], "chart-panel"));
  });

  await t.test("throws on a second mount() without an intervening unmount()", () => {
    const render = () => fakeRenderResult();
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render, params: { workername: "rig1" } });
    assert.throws(
      () => mount(fakeContainer(), { fetchImpl, render, params: { workername: "rig1" } }),
      /already mounted/,
    );
  });

  await t.test("unmount() before any mount() is a safe no-op", () => {
    assert.doesNotThrow(() => unmount());
  });

  await t.test("unmount() clears the container by rendering an empty page shell", async () => {
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return fakeRenderResult();
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render, params: { workername: "rig1" } });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(renders.length, 2);

    unmount();
    assert.equal(renders.length, 3);
    assert.equal(renders[2].className, "worker-detail-page");
  });

  await t.test(
    "a stale mount's in-flight fetch cannot affect a newer mount (e.g. navigating rig1 -> rig2) after unmount()+remount()",
    async () => {
      let releaseOldFetch;
      const oldGate = new Promise((resolve) => {
        releaseOldFetch = resolve;
      });
      const oldFetchImpl = async () => {
        await oldGate;
        return { ok: true, status: 200, json: async () => fullPayload() };
      };
      const oldRenders = [];
      const oldRender = (target, spec) => {
        oldRenders.push(spec);
        return fakeRenderResult();
      };

      mount(fakeContainer(), { fetchImpl: oldFetchImpl, render: oldRender, params: { workername: "rig1" } });
      assert.equal(oldRenders.length, 1);

      unmount();

      const newRenders = [];
      const newRender = (target, spec) => {
        newRenders.push(spec);
        return fakeRenderResult();
      };
      const newFetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

      mount(fakeContainer(), { fetchImpl: newFetchImpl, render: newRender, params: { workername: "rig2" } });
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
    const render = () => fakeRenderResult();
    const payload = fullPayload();
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => payload });

    mount(fakeContainer(), { fetchImpl, render, params: { workername: "rig1" } });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(getState().analytics, payload);
    assert.equal(typeof getState().analyticsFetchedAt, "string");
  });

  await t.test("unmount() disposes the active chart instance", async () => {
    const disposeCalls = [];
    const render = () => fakeRenderResult({ fakeCanvas: true });
    const createChartImpl = () => ({
      update() {},
      dispose() {
        disposeCalls.push(true);
      },
    });
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });
    const readThemeTokensImpl = () => ({});

    mount(fakeContainer(), { fetchImpl, render, createChartImpl, readThemeTokensImpl, params: { workername: "rig1" } });
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

      mount(fakeContainer(), {
        fetchImpl,
        render,
        createChartImpl,
        readThemeTokensImpl,
        intervalMs: 1000,
        params: { workername: "rig1" },
      });
      await flush();
      await flush();
      assert.equal(createCalls, 1);

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

  await t.test("repaints the chart when the active theme changes, but not for an unrelated state.js change", async () => {
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

    mount(fakeContainer(), { fetchImpl, render, createChartImpl, readThemeTokensImpl, params: { workername: "rig1" } });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(updateCalls.length, 0);

    setState({ searchQuery: "irrelevant" });
    assert.equal(updateCalls.length, 0, "an unrelated state.js change must not repaint the chart");

    const before = getState().theme;
    setState({ theme: before === "light" ? "dark" : "light" });
    assert.equal(updateCalls.length, 1);

    setState({ theme: getState().theme });
    assert.equal(updateCalls.length, 1, "setting the same theme again must not repaint the chart a second time");
    setState({ searchQuery: "" });
  });

  await t.test("no polling is started when intervalMs is omitted", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    let renderCount = 0;
    const render = () => {
      renderCount += 1;
      return fakeRenderResult();
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    mount(fakeContainer(), { fetchImpl, render, params: { workername: "rig1" } });
    await flush();
    await flush();
    assert.equal(renderCount, 2);

    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(renderCount, 2, "without intervalMs, mount() must not poll");
  });

  await t.test("an invalid staleAfterMs is dropped, not passed through to fail deep inside getStaleness", async () => {
    let renderCount = 0;
    const render = () => {
      renderCount += 1;
      return fakeRenderResult();
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render, staleAfterMs: NaN, params: { workername: "rig1" } });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(renderCount, 2);
  });

  // Phase E Milestone 29: the dataset-toggle wiring.
  await t.test("clicking the 'Total' toggle button switches the active dataset and updates the chart in place", async () => {
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

    mount(fakeContainer(), { fetchImpl, render, createChartImpl, readThemeTokensImpl, params: { workername: "rig1" } });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(updateCalls.length, 0);
    toggleButtons[1].listeners.click();
    assert.equal(updateCalls.length, 1, "clicking a different dataset must update the existing chart, not recreate it");
  });
});
