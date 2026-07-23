import test from "node:test";
import assert from "node:assert/strict";
import {
  route,
  transformUserDetailData,
  deriveUserDetailState,
  formatWorkerRow,
  buildUserDetailSpec,
  mount,
  unmount,
} from "../../src/pages/user-detail.js";
import { getState, setState } from "../../src/core/state.js";
import { FetchApiError } from "../../src/core/api.js";
import { truncateAddress, truncateWorkername } from "../../src/core/format.js";
import { BUCKET_COUNT } from "../../src/charts/histogram-chart.js";

function emptyBucketData() {
  return { bucket_counts: new Array(BUCKET_COUNT).fill(0), bucket_best: new Array(BUCKET_COUNT).fill(null) };
}

function fullPayload(overrides = {}) {
  return {
    metadata: { schema_version: "1.3", generated_at: new Date().toISOString(), ...overrides.metadata },
    pool: { network_difficulty: 127170500429035.2, ...overrides.pool },
    users: {
      alice: {
        accepted_count: 1000,
        rejected_count: 5,
        average_sdiff: 105.5,
        best_share_ever: { username: "alice", workername: "rig1", sdiff: 2048, timestamp: "unknown" },
        workers: ["rig1", "rig2"],
        hashrate_1m: 11200000000000,
        hashrate_24h: 10400000000000,
        difficulty_histogram: { "1d": emptyBucketData(), total: emptyBucketData() },
        ...overrides.aliceRecord,
      },
      ...overrides.users,
    },
    workers: {
      rig1: { is_active: true, accepted_count: 500, last_share_at: new Date().toISOString() },
      rig2: { is_active: false, accepted_count: 20, last_share_at: null },
      ...overrides.workers,
    },
    daily_bests: {
      "2026-07-17": {
        users: {
          alice: {
            current_daily_best: { username: "alice", workername: "rig1", sdiff: 400, timestamp: "unknown" },
            previous_daily_best: { username: "alice", workername: "rig1", sdiff: 300, timestamp: "unknown" },
            improvement_amount: 100,
            improvement_percentage: 33.3,
          },
        },
      },
      "2026-07-18": {
        users: {
          alice: {
            current_daily_best: { username: "alice", workername: "rig1", sdiff: 512.5, timestamp: "unknown" },
            previous_daily_best: { username: "alice", workername: "rig1", sdiff: 400, timestamp: "unknown" },
            improvement_amount: 112.5,
            improvement_percentage: 28.1,
          },
        },
      },
      ...overrides.daily_bests,
    },
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
  await t.test("is a dynamic route with a :username segment", () => {
    assert.equal(route.pattern, "/users/:username");
    assert.equal(route.name, "user-detail");
  });
});

test("transformUserDetailData", async (t) => {
  await t.test("extracts the subject's own record, cross-references their workers, and picks the latest daily best", () => {
    const data = transformUserDetailData(fullPayload(), "alice");
    assert.equal(data.username, "alice");
    assert.equal(data.acceptedCount, 1000);
    assert.equal(data.workerRows.length, 2);
    assert.equal(data.workerRows[0].workername, "rig1");
    assert.equal(data.workerRows[0].isActive, true);
    assert.equal(data.workerRows[1].isActive, false);
    // The later date (2026-07-18) must win, not the earlier one.
    assert.equal(data.currentDailyBest.sdiff, 512.5);
    assert.equal(data.previousDailyBest.sdiff, 400);
    assert.equal(data.improvementAmount, 112.5);
    assert.equal(data.improvementPercentage, 28.1);
  });

  await t.test("Phase E Milestone 28: extracts hashrate_1m/hashrate_24h as hashrate1m/hashrate24h", () => {
    const data = transformUserDetailData(fullPayload(), "alice");
    assert.equal(data.hashrate1m, 11200000000000);
    assert.equal(data.hashrate24h, 10400000000000);
  });

  await t.test("missing native hashrate fields pass through as undefined, not a throw", () => {
    const data = transformUserDetailData(fullPayload({ aliceRecord: { hashrate_1m: undefined, hashrate_24h: undefined } }), "alice");
    assert.equal(data.hashrate1m, undefined);
    assert.equal(data.hashrate24h, undefined);
  });

  await t.test("Phase E Milestone 29: extracts this user's own difficulty_histogram and the pool-wide network_difficulty", () => {
    const payload = fullPayload();
    const data = transformUserDetailData(payload, "alice");
    assert.deepEqual(data.difficultyHistogram, payload.users.alice.difficulty_histogram);
    assert.equal(data.networkDifficulty, 127170500429035.2);
  });

  await t.test("a missing difficulty_histogram on this user's record degrades to an empty (all-zero) shape", () => {
    const data = transformUserDetailData(fullPayload({ aliceRecord: { difficulty_histogram: undefined } }), "alice");
    assert.ok(data.difficultyHistogram["1d"].bucket_counts.every((c) => c === 0));
  });

  await t.test("returns null when the username has no record at all -- the not-found signal", () => {
    assert.equal(transformUserDetailData(fullPayload(), "nonexistent"), null);
  });

  await t.test("a worker listed under the user but absent from the top-level workers dict degrades safely", () => {
    const data = transformUserDetailData(
      fullPayload({ aliceRecord: { workers: ["ghost-worker"] } }),
      "alice",
    );
    assert.equal(data.workerRows.length, 1);
    assert.equal(data.workerRows[0].isActive, false);
    assert.equal(data.workerRows[0].acceptedCount, undefined);
  });

  await t.test("no daily_bests entry for this user on the latest date is null, not a throw", () => {
    const data = transformUserDetailData(
      fullPayload({ daily_bests: { "2026-07-18": { users: {} } } }),
      "alice",
    );
    assert.equal(data.currentDailyBest, null);
    assert.equal(data.improvementAmount, null);
  });

  await t.test("no daily_bests at all is null, not a throw", () => {
    const data = transformUserDetailData(fullPayload({ daily_bests: {} }), "alice");
    assert.equal(data.currentDailyBest, null);
    assert.equal(data.improvementPercentage, null);
  });

  await t.test("an inherited/prototype key on the workers dict is never picked up via iteration", () => {
    const workers = Object.create({ inherited: { is_active: true } });
    workers.rig1 = { is_active: false, accepted_count: 1 };
    const data = transformUserDetailData(
      fullPayload({ aliceRecord: { workers: ["rig1"] }, workers }),
      "alice",
    );
    assert.equal(data.workerRows.length, 1);
    assert.equal(data.workerRows[0].workername, "rig1");
  });

  // Regression tests for a real, easily-triggered defect a Code
  // Reviewer round found: username/workername are URL-supplied,
  // fully attacker-controlled text (docs/ARCHITECTURE.md Section 18)
  // used as a *direct bracket key* into a plain object literal --
  // dict["constructor"] resolves through the prototype chain to the
  // real Object constructor (truthy) even when no such *own* key
  // exists, which would otherwise flip a nonexistent user's page from
  // "not-found" to a blank "success". These names are exactly the
  // Object.prototype members that make a bare `dict[key]` lookup
  // unsafe for attacker-supplied keys.
  await t.test("a username matching an Object.prototype member name is correctly not-found, not success", () => {
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      assert.equal(
        transformUserDetailData(fullPayload(), name),
        null,
        `"${name}" must not resolve through the prototype chain as if it were a real user`,
      );
    }
  });

  await t.test("a workername matching an Object.prototype member name does not leak a phantom worker record", () => {
    const data = transformUserDetailData(
      fullPayload({ aliceRecord: { workers: ["constructor"] } }),
      "alice",
    );
    assert.equal(data.workerRows.length, 1);
    assert.equal(data.workerRows[0].workername, "constructor");
    assert.equal(data.workerRows[0].isActive, false, "must not pick up Object's own truthy properties as worker data");
    assert.equal(data.workerRows[0].acceptedCount, undefined);
  });

  await t.test("a daily_bests lookup for a real user named after an Object.prototype member is null, not a phantom entry", () => {
    // Unlike the two tests above, this user genuinely exists (so
    // transformUserDetailData proceeds past its own not-found guard)
    // -- specifically isolating findLatestDailyBest's own
    // usersForDate[username] lookup, which has no real entry for this
    // date and must not resolve through the prototype chain either.
    const data = transformUserDetailData(
      fullPayload({
        users: { constructor: { accepted_count: 1, rejected_count: 0, workers: [] } },
        daily_bests: { "2026-07-18": { users: {} } },
      }),
      "constructor",
    );
    assert.ok(data, "the user itself exists, so this must not be null");
    assert.equal(data.currentDailyBest, null);
    assert.equal(data.improvementAmount, null);
  });
});

test("deriveUserDetailState", async (t) => {
  await t.test("no payload at all is status error with no data", () => {
    const state = deriveUserDetailState({ payload: null, username: "alice", error: new Error("boom") });
    assert.equal(state.status, "error");
    assert.equal(state.data, null);
  });

  await t.test("a payload with no record for this username is status not-found", () => {
    const state = deriveUserDetailState({ payload: fullPayload(), username: "nonexistent" });
    assert.equal(state.status, "not-found");
    assert.equal(state.username, "nonexistent");
  });

  await t.test("a real record is status success", () => {
    const state = deriveUserDetailState({ payload: fullPayload(), username: "alice" });
    assert.equal(state.status, "success");
  });

  await t.test("an error alongside a cached (still valid) record keeps status success and carries the error", () => {
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "network" });
    const state = deriveUserDetailState({ payload: fullPayload(), username: "alice", error });
    assert.equal(state.status, "success");
    assert.equal(state.error, error);
  });
});

test("formatWorkerRow", async (t) => {
  await t.test("formats counts and relative time for display, passes isActive through raw", () => {
    const data = transformUserDetailData(fullPayload(), "alice");
    const formatted = formatWorkerRow(data.workerRows[0]);
    assert.equal(formatted.workername, "rig1");
    assert.equal(formatted.isActive, true);
    assert.equal(formatted.accepted, "500");
  });
});

test("buildUserDetailSpec", async (t) => {
  await t.test("loading state shows the header (with username) and skeletons, no real table/chart", () => {
    const spec = buildUserDetailSpec({ status: "loading", username: "alice" });
    assert.ok(findByClassName(spec, "user-detail-page__loading"));
    const heading = findByClassName(spec, "user-detail-page__title");
    assert.match(heading.text, /alice/);
    // tile-grid IS present during loading -- the skeleton itself
    // reuses that class for layout consistency with the real stat
    // tiles it previews (matching overview.js's/pool.js's own
    // precedent) -- what must be absent is the real DataTable/chart.
    assert.equal(findByClassName(spec, "data-table"), null);
    assert.equal(findByClassName(spec, "chart-panel"), null);
  });

  await t.test("Code Review finding (Milestone 28): loading-skeleton tile count matches the real success-state tile count, so there is no layout shift when data arrives", () => {
    const loadingTileCount = findByClassName(
      buildUserDetailSpec({ status: "loading", username: "alice" }),
      "tile-grid",
    ).children.length;
    const data = transformUserDetailData(fullPayload(), "alice");
    const successTileCount = findByClassName(
      buildUserDetailSpec({ status: "success", data, username: "alice", error: null, isStale: false }),
      "tile-grid",
    ).children.length;
    assert.equal(loadingTileCount, successTileCount);
  });

  await t.test("error state (no data) renders the header and only the error banner", () => {
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "network" });
    const spec = buildUserDetailSpec({ status: "error", data: null, username: "alice", error, isStale: false });
    assert.ok(findByClassName(spec, "error-banner"));
    assert.match(findByClassName(spec, "user-detail-page__title").text, /alice/);
  });

  await t.test("not-found state names the specific username, not a generic message", () => {
    const spec = buildUserDetailSpec({
      status: "not-found",
      data: null,
      username: "nonexistent",
      error: null,
      isStale: false,
    });
    assert.ok(findByClassName(spec, "empty-state"));
    const message = findByClassName(spec, "empty-state__message");
    assert.ok(message.text.includes(truncateAddress("nonexistent")));
  });

  await t.test("success renders the back-link, stat tiles (including the daily-improvement trend), the worker table, and the histogram panel", () => {
    const data = transformUserDetailData(fullPayload(), "alice");
    const spec = buildUserDetailSpec({ status: "success", data, username: "alice", error: null, isStale: false });

    const backLink = findByClassName(spec, "user-detail-page__back-link");
    assert.equal(backLink.attrs.href, "#/users");

    const tileGrid = findByClassName(spec, "tile-grid");
    assert.equal(tileGrid.children.length, 9);

    // "Daily Improvement" is the third tile; its trend direction/label
    // must reflect a positive improvement_percentage.
    const improvementTile = tileGrid.children[2];
    const trend = findByClassName(improvementTile, "stat-tile__trend--up");
    assert.ok(trend, "a positive improvement_percentage must render the 'up' trend");

    assert.ok(findByClassName(spec, "split-layout"));
    assert.ok(findByClassName(spec, "data-table"));
    assert.ok(findByClassName(spec, "histogram-panel"));
    assert.equal(findByClassName(findByClassName(spec, "histogram-panel"), "card__header").text, "User Share Difficulty Histogram");
    assert.equal(findByClassName(spec, "error-banner"), null);
  });

  await t.test("Phase E Milestone 28 (Human's clarification: individual User Detail, not the Users table): Pool User Hashrate (1m)/(24h) tiles render with compact-formatted values", () => {
    const data = transformUserDetailData(fullPayload(), "alice");
    const spec = buildUserDetailSpec({ status: "success", data, username: "alice", error: null, isStale: false });
    const tileGrid = findByClassName(spec, "tile-grid");
    const labels = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__label").text);
    const values = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__value").text);
    assert.equal(values[labels.indexOf("Pool User Hashrate (1m)")], "11.2T");
    assert.equal(values[labels.indexOf("Pool User Hashrate (24h)")], "10.4T");
  });

  await t.test("Human requirement: a missing native hashrate degrades to a placeholder, never an estimate or a crash", () => {
    const data = transformUserDetailData(fullPayload({ aliceRecord: { hashrate_1m: null, hashrate_24h: null } }), "alice");
    const spec = buildUserDetailSpec({ status: "success", data, username: "alice", error: null, isStale: false });
    const tileGrid = findByClassName(spec, "tile-grid");
    const labels = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__label").text);
    const values = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__value").text);
    assert.equal(values[labels.indexOf("Pool User Hashrate (1m)")], "--");
    assert.equal(values[labels.indexOf("Pool User Hashrate (24h)")], "--");
  });

  await t.test("the worker table's workername cell reuses workernameCellSpec: truncated text, full value via title/aria-label, correct link", () => {
    const raw = "bc1qmleyaz5gj0fxsayvk7mrgfcx8rel0qnscwnm88.OctaxeDamo";
    const data = transformUserDetailData(
      fullPayload({ aliceRecord: { workers: [raw] }, workers: { [raw]: { is_active: true, accepted_count: 1, last_share_at: null } } }),
      "alice",
    );
    const spec = buildUserDetailSpec({ status: "success", data, username: "alice", error: null, isStale: false });
    const table = findByClassName(spec, "data-table");
    const tbody = table.children.find((c) => c.tag === "tbody");
    const link = tbody.children[0].children[0].children[0];
    assert.equal(link.tag, "a");
    assert.equal(link.text, truncateWorkername(raw));
    assert.equal(link.attrs.href, `#/workers/${encodeURIComponent(raw)}`);
    assert.equal(link.attrs.title, raw, "the full untruncated workername stays available via title");
    assert.equal(link.attrs["aria-label"], raw, "and via aria-label, for assistive tech that doesn't announce title");
  });

  await t.test("a negative improvement_percentage renders the 'down' trend", () => {
    const data = transformUserDetailData(
      fullPayload({ daily_bests: { "2026-07-18": { users: { alice: { improvement_amount: -50, improvement_percentage: -10 } } } } }),
      "alice",
    );
    const spec = buildUserDetailSpec({ status: "success", data, username: "alice", error: null, isStale: false });
    const tileGrid = findByClassName(spec, "tile-grid");
    const improvementTile = tileGrid.children[2];
    assert.ok(findByClassName(improvementTile, "stat-tile__trend--down"));
  });

  await t.test("exactly 0% improvement renders no trend at all -- not misleadingly 'up'", () => {
    const data = transformUserDetailData(
      fullPayload({ daily_bests: { "2026-07-18": { users: { alice: { improvement_amount: 0, improvement_percentage: 0 } } } } }),
      "alice",
    );
    const spec = buildUserDetailSpec({ status: "success", data, username: "alice", error: null, isStale: false });
    const tileGrid = findByClassName(spec, "tile-grid");
    const improvementTile = tileGrid.children[2];
    assert.equal(findByClassName(improvementTile, "stat-tile__trend--up"), null);
    assert.equal(findByClassName(improvementTile, "stat-tile__trend--down"), null);
  });

  await t.test("no daily-best data at all renders the improvement tile with no trend, not a crash", () => {
    const data = transformUserDetailData(fullPayload({ daily_bests: {} }), "alice");
    const spec = buildUserDetailSpec({ status: "success", data, username: "alice", error: null, isStale: false });
    const tileGrid = findByClassName(spec, "tile-grid");
    const improvementTile = tileGrid.children[2];
    assert.equal(findByClassName(improvementTile, "stat-tile__trend--up"), null);
    assert.equal(findByClassName(improvementTile, "stat-tile__trend--down"), null);
  });

  await t.test("a user with no workers renders EmptyState instead of an empty table", () => {
    const data = transformUserDetailData(fullPayload({ aliceRecord: { workers: [] } }), "alice");
    const spec = buildUserDetailSpec({ status: "success", data, username: "alice", error: null, isStale: false });
    assert.ok(findByClassName(spec, "empty-state"));
    assert.equal(findByClassName(spec, "data-table"), null);
  });

  await t.test("success + error (cached fallback) shows the error banner above the live content", () => {
    const data = transformUserDetailData(fullPayload(), "alice");
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "http", status: 503 });
    const spec = buildUserDetailSpec({ status: "success", data, username: "alice", error, isStale: false });
    assert.ok(findByClassName(spec, "error-banner"));
    assert.ok(findByClassName(spec, "data-table"));
  });

  await t.test("success + isStale (no error) shows a warning banner, not the error icon", () => {
    const data = transformUserDetailData(fullPayload(), "alice");
    const spec = buildUserDetailSpec({ status: "success", data, username: "alice", error: null, isStale: true });
    const banner = findByClassName(spec, "error-banner");
    assert.equal(banner.children[0].className, "icon icon-warning error-banner__icon");
  });

  await t.test("an unrecognized status throws rather than silently rendering the success branch", () => {
    assert.throws(() => buildUserDetailSpec({ status: "not-a-real-status", username: "alice" }), /unrecognized status/);
  });

  await t.test("a malicious username in the URL passes through the heading as text, never markup", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const spec = buildUserDetailSpec({ status: "loading", username: raw });
    const heading = findByClassName(spec, "user-detail-page__title");
    assert.equal(heading.text, `User: ${truncateAddress(raw)}`);
    assert.equal(heading.tag, "h1");
    assert.equal(heading.attrs.title, raw);
    assert.equal(heading.attrs["aria-label"], `User: ${raw}`);
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

  await t.test("throws if params.username is missing", () => {
    const render = () => fakeRenderResult();
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });
    assert.throws(() => mount(fakeContainer(), { fetchImpl, render, params: {} }), /params\.username is required/);
    assert.throws(() => mount(fakeContainer(), { fetchImpl, render }), /params\.username is required/);
  });

  await t.test("renders loading synchronously (with the username already known), then the fetch result", async () => {
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return fakeRenderResult();
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render, params: { username: "alice" } });

    assert.equal(renders.length, 1);
    assert.match(findByClassName(renders[0], "user-detail-page__title").text, /alice/);

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(renders.length, 2);
    assert.ok(findByClassName(renders[1], "data-table"));
  });

  await t.test("throws on a second mount() without an intervening unmount()", () => {
    const render = () => fakeRenderResult();
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render, params: { username: "alice" } });
    assert.throws(
      () => mount(fakeContainer(), { fetchImpl, render, params: { username: "alice" } }),
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

    mount(fakeContainer(), { fetchImpl, render, params: { username: "alice" } });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(renders.length, 2);

    unmount();
    assert.equal(renders.length, 3);
    assert.equal(renders[2].className, "user-detail-page");
  });

  await t.test(
    "a stale mount's in-flight fetch cannot affect a newer mount (e.g. navigating alice -> bob) after unmount()+remount()",
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

      mount(fakeContainer(), { fetchImpl: oldFetchImpl, render: oldRender, params: { username: "alice" } });
      assert.equal(oldRenders.length, 1);

      unmount();

      const newRenders = [];
      const newRender = (target, spec) => {
        newRenders.push(spec);
        return fakeRenderResult();
      };
      const newFetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

      mount(fakeContainer(), { fetchImpl: newFetchImpl, render: newRender, params: { username: "bob" } });
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

    mount(fakeContainer(), { fetchImpl, render, params: { username: "alice" } });
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

    mount(fakeContainer(), { fetchImpl, render, createChartImpl, readThemeTokensImpl, params: { username: "alice" } });
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
        params: { username: "alice" },
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

    mount(fakeContainer(), { fetchImpl, render, createChartImpl, readThemeTokensImpl, params: { username: "alice" } });
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

    mount(fakeContainer(), { fetchImpl, render, params: { username: "alice" } });
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

    mount(fakeContainer(), { fetchImpl, render, staleAfterMs: NaN, params: { username: "alice" } });
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

    mount(fakeContainer(), { fetchImpl, render, createChartImpl, readThemeTokensImpl, params: { username: "alice" } });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(updateCalls.length, 0);
    toggleButtons[1].listeners.click();
    assert.equal(updateCalls.length, 1, "clicking a different dataset must update the existing chart, not recreate it");
  });
});
