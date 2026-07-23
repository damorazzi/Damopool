// Independent adversarial test pass for Phase E Milestone 31's frontend
// surface (Worker Detail session tiles + caption), complementing (not
// replacing) worker-detail.test.js's own Milestone 31 assertions.
import test from "node:test";
import assert from "node:assert/strict";
import {
  transformWorkerDetailData,
  buildWorkerDetailSpec,
} from "../../src/pages/worker-detail.js";
import { BUCKET_COUNT } from "../../src/charts/histogram-chart.js";

function emptyBucketData() {
  return { bucket_counts: new Array(BUCKET_COUNT).fill(0), bucket_best: new Array(BUCKET_COUNT).fill(null) };
}

function fullPayload(overrides = {}) {
  return {
    metadata: { schema_version: "1.5", generated_at: new Date().toISOString(), ...overrides.metadata },
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
        session_accepted_count: 42,
        session_rejected_count: 1,
        session_started_at: "2026-07-23T14:32:00+00:00",
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

test("Milestone 31 adversarial: Worker Detail session tiles/caption", async (t) => {
  await t.test("a worker with genuinely ZERO session shares renders '0', not a '--' placeholder", () => {
    const data = transformWorkerDetailData(
      fullPayload({ rig1Record: { session_accepted_count: 0, session_rejected_count: 0, session_started_at: null } }),
      "rig1",
    );
    const spec = buildWorkerDetailSpec({ status: "success", data, workername: "rig1", error: null, isStale: false });
    const tileGrid = findByClassName(spec, "tile-grid");
    const labels = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__label").text);
    const values = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__value").text);
    assert.equal(values[labels.indexOf("Session Accepted")], "0");
    assert.equal(values[labels.indexOf("Session Rejected")], "0");
    // And with session_started_at null, no caption at all (covered by
    // worker-detail.test.js too; re-asserted here alongside the zero-count case).
    assert.equal(findByClassName(spec, "worker-detail-page__session-caption"), null);
  });

  await t.test("session fields entirely absent from the payload (older cached analytics.json) degrade to '--', not a throw", () => {
    const payload = fullPayload();
    delete payload.workers.rig1.session_accepted_count;
    delete payload.workers.rig1.session_rejected_count;
    delete payload.workers.rig1.session_started_at;
    const data = transformWorkerDetailData(payload, "rig1");
    assert.doesNotThrow(() => buildWorkerDetailSpec({ status: "success", data, workername: "rig1", error: null, isStale: false }));
    const spec = buildWorkerDetailSpec({ status: "success", data, workername: "rig1", error: null, isStale: false });
    const tileGrid = findByClassName(spec, "tile-grid");
    const labels = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__label").text);
    const values = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__value").text);
    assert.equal(values[labels.indexOf("Session Accepted")], "--");
    assert.equal(values[labels.indexOf("Session Rejected")], "--");
    assert.equal(findByClassName(spec, "worker-detail-page__session-caption"), null);
  });

  await t.test("the session caption is a sibling of tile-grid, never nested inside it (not counted among the 17 tiles)", () => {
    const data = transformWorkerDetailData(fullPayload(), "rig1");
    const spec = buildWorkerDetailSpec({ status: "success", data, workername: "rig1", error: null, isStale: false });
    const tileGrid = findByClassName(spec, "tile-grid");
    const captionInsideGrid = findByClassName(tileGrid, "worker-detail-page__session-caption");
    assert.equal(captionInsideGrid, null, "the caption must not be a tile-grid child");
    assert.equal(tileGrid.children.length, 17, "tile-grid must contain exactly the 17 stat tiles, no caption");
  });

  await t.test("lifetime Accepted/Rejected Shares tiles and Session Accepted/Rejected tiles are four DISTINCT tiles with independent values", () => {
    const data = transformWorkerDetailData(
      fullPayload({ rig1Record: { accepted_count: 500, rejected_count: 2, session_accepted_count: 42, session_rejected_count: 1 } }),
      "rig1",
    );
    const spec = buildWorkerDetailSpec({ status: "success", data, workername: "rig1", error: null, isStale: false });
    const tileGrid = findByClassName(spec, "tile-grid");
    const labels = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__label").text);
    const values = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__value").text);
    // Exactly one tile per label -- proves no accidental merge/overwrite between
    // the lifetime and session pairs.
    assert.equal(labels.filter((l) => l === "Accepted Shares").length, 1);
    assert.equal(labels.filter((l) => l === "Rejected Shares").length, 1);
    assert.equal(labels.filter((l) => l === "Session Accepted").length, 1);
    assert.equal(labels.filter((l) => l === "Session Rejected").length, 1);
    assert.equal(values[labels.indexOf("Accepted Shares")], "500");
    assert.equal(values[labels.indexOf("Rejected Shares")], "2");
    assert.equal(values[labels.indexOf("Session Accepted")], "42");
    assert.equal(values[labels.indexOf("Session Rejected")], "1");
  });

  await t.test("a large session count is thousands-separator formatted just like the lifetime counterpart", () => {
    const data = transformWorkerDetailData(
      fullPayload({ rig1Record: { session_accepted_count: 68517, session_rejected_count: 18 } }),
      "rig1",
    );
    const spec = buildWorkerDetailSpec({ status: "success", data, workername: "rig1", error: null, isStale: false });
    const tileGrid = findByClassName(spec, "tile-grid");
    const labels = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__label").text);
    const values = tileGrid.children.map((tile) => findByClassName(tile, "stat-tile__value").text);
    assert.equal(values[labels.indexOf("Session Accepted")], "68,517");
    assert.equal(values[labels.indexOf("Session Rejected")], "18");
  });
});
