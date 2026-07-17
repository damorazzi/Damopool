import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFetchError,
  validateSchema,
  getStaleness,
} from "../../src/core/errors.js";

test("classifyFetchError", async (t) => {
  await t.test("a TypeError is classified as network", () => {
    assert.equal(classifyFetchError(new TypeError("Failed to fetch")), "network");
  });
  await t.test("anything else is unknown", () => {
    assert.equal(classifyFetchError(new Error("boom")), "unknown");
    assert.equal(classifyFetchError("not an error"), "unknown");
    assert.equal(classifyFetchError(null), "unknown");
  });
});

function fullPayload(overrides = {}) {
  return {
    metadata: { schema_version: "1.1" },
    pool: {},
    users: {},
    workers: {},
    daily_bests: {},
    live_ticker: [],
    ...overrides,
  };
}

test("validateSchema", async (t) => {
  await t.test("a complete, current-major-version payload is valid", () => {
    assert.deepEqual(validateSchema(fullPayload()), { valid: true, reason: null });
  });

  await t.test("a minor/patch version bump is still valid", () => {
    const payload = fullPayload({ metadata: { schema_version: "1.9" } });
    assert.deepEqual(validateSchema(payload), { valid: true, reason: null });
  });

  await t.test("a major version bump is invalid", () => {
    const payload = fullPayload({ metadata: { schema_version: "2.0" } });
    const result = validateSchema(payload);
    assert.equal(result.valid, false);
    assert.match(result.reason, /^unsupported-schema-version:/);
  });

  await t.test("missing schema_version is invalid", () => {
    const payload = fullPayload({ metadata: {} });
    assert.deepEqual(validateSchema(payload), {
      valid: false,
      reason: "missing-schema-version",
    });
  });

  await t.test("a missing top-level key is invalid", () => {
    const payload = fullPayload();
    delete payload.users;
    const result = validateSchema(payload);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "missing-keys:users");
  });

  await t.test("multiple missing keys are all reported", () => {
    const payload = fullPayload();
    delete payload.users;
    delete payload.workers;
    const result = validateSchema(payload);
    assert.equal(result.reason, "missing-keys:users,workers");
  });

  await t.test("null, a string, and an array are all not-an-object", () => {
    assert.deepEqual(validateSchema(null), { valid: false, reason: "not-an-object" });
    assert.deepEqual(validateSchema("payload"), {
      valid: false,
      reason: "not-an-object",
    });
    // An array passes typeof === "object" but fails the key check --
    // exercised separately below since it is a different code path.
  });

  await t.test("an array is not-an-object's sibling case: missing every key", () => {
    const result = validateSchema([]);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "missing-keys:metadata,pool,users,workers,daily_bests,live_ticker");
  });
});

test("getStaleness", async (t) => {
  const now = new Date("2026-07-17T12:00:00Z");
  const threshold = 15 * 60 * 1000;

  await t.test("fresh data is not stale", () => {
    const result = getStaleness(now.toISOString(), now, threshold);
    assert.equal(result.isStale, false);
    assert.equal(result.ageMs, 0);
  });

  await t.test("data within the threshold is not stale", () => {
    const tenMinAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
    assert.equal(getStaleness(tenMinAgo, now, threshold).isStale, false);
  });

  await t.test("data older than the threshold is stale", () => {
    const twentyMinAgo = new Date(now.getTime() - 20 * 60_000).toISOString();
    assert.equal(getStaleness(twentyMinAgo, now, threshold).isStale, true);
  });

  await t.test("exactly at the threshold is not stale (strictly greater-than)", () => {
    const exactlyAtThreshold = new Date(now.getTime() - threshold).toISOString();
    assert.equal(getStaleness(exactlyAtThreshold, now, threshold).isStale, false);
  });

  await t.test("a malformed date string is stale with null ageMs", () => {
    assert.deepEqual(getStaleness("garbage", now, threshold), {
      ageMs: null,
      isStale: true,
    });
  });

  await t.test("null generatedAtIso is stale with null ageMs, not epoch math", () => {
    // Regression test: new Date(null) coerces to the Unix epoch (a
    // *valid* date), which would otherwise silently produce a huge
    // ageMs instead of being treated as malformed input.
    assert.deepEqual(getStaleness(null, now, threshold), {
      ageMs: null,
      isStale: true,
    });
  });

  await t.test("undefined generatedAtIso is stale with null ageMs", () => {
    assert.deepEqual(getStaleness(undefined, now, threshold), {
      ageMs: null,
      isStale: true,
    });
  });

  await t.test("omitting thresholdMs throws rather than silently passing", () => {
    assert.throws(() => getStaleness(now.toISOString(), now, undefined), TypeError);
  });

  await t.test("a non-finite thresholdMs throws", () => {
    assert.throws(() => getStaleness(now.toISOString(), now, NaN), TypeError);
    assert.throws(() => getStaleness(now.toISOString(), now, Infinity), TypeError);
  });
});
