import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  fetchEndpoint,
  getCached,
  clearCache,
  startPolling,
  FetchApiError,
} from "../../src/core/api.js";
import { validateSchema } from "../../src/core/errors.js";

beforeEach(() => clearCache());

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

function fullPayload(overrides = {}) {
  return {
    metadata: { schema_version: "1.1", generated_at: new Date().toISOString(), ...overrides.metadata },
    pool: {},
    users: {},
    workers: {},
    daily_bests: {},
    live_ticker: [],
  };
}

test("fetchEndpoint", async (t) => {
  await t.test("returns the parsed payload on success, and caches it", async () => {
    const payload = fullPayload();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse(payload);
    };

    const result = await fetchEndpoint("/analytics.json", { fetchImpl });

    assert.equal(calls, 1);
    assert.deepEqual(result.payload, payload);
    assert.equal(result.fromCache, false);
    assert.equal(result.error, null);
    assert.ok(result.fetchedAt instanceof Date);
    assert.deepEqual(getCached("/analytics.json").payload, payload);
  });

  await t.test("passes headers through to fetchImpl", async () => {
    let receivedOptions = null;
    const fetchImpl = async (endpoint, options) => {
      receivedOptions = options;
      return jsonResponse(fullPayload());
    };

    await fetchEndpoint("/analytics.json", { fetchImpl });

    assert.ok(receivedOptions, "fetchImpl must be called with an options object");
    assert.deepEqual(receivedOptions.headers, {}, "the single injection point must reach fetchImpl");
  });

  await t.test("bypassCache defaults to false -- a normal (non-polling) fetch does not force cache:no-store, per docs/ARCHITECTURE.md Section 20's 'normal caching on first load'", async () => {
    let receivedOptions = null;
    const fetchImpl = async (endpoint, options) => {
      receivedOptions = options;
      return jsonResponse(fullPayload());
    };

    await fetchEndpoint("/analytics.json", { fetchImpl });

    assert.equal(receivedOptions.cache, undefined);
  });

  await t.test("bypassCache: true adds cache:no-store to the fetch init, per Section 20's 'the polling refetch is cache-busted' (Phase E Milestone 23)", async () => {
    let receivedOptions = null;
    const fetchImpl = async (endpoint, options) => {
      receivedOptions = options;
      return jsonResponse(fullPayload());
    };

    await fetchEndpoint("/analytics.json", { fetchImpl, bypassCache: true });

    assert.equal(receivedOptions.cache, "no-store");
  });

  await t.test("retries a network failure and succeeds on a later attempt", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls < 3) throw new TypeError("Failed to fetch");
      return jsonResponse(fullPayload());
    };

    const result = await fetchEndpoint("/analytics.json", {
      fetchImpl,
      retries: 3,
      retryDelayMs: 1,
    });

    assert.equal(calls, 3);
    assert.equal(result.error, null);
    assert.equal(result.fromCache, false);
  });

  await t.test("backoff delay doubles per attempt", async (t) => {
    const recordedDelays = [];
    const realSetTimeout = globalThis.setTimeout;
    t.mock.method(globalThis, "setTimeout", (fn, ms, ...args) => {
      if (typeof fn === "function" && ms > 0) recordedDelays.push(ms);
      return realSetTimeout(fn, 0, ...args);
    });

    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls < 3) throw new TypeError("Failed to fetch");
      return jsonResponse(fullPayload());
    };

    await fetchEndpoint("/analytics.json", { fetchImpl, retries: 3, retryDelayMs: 500 });

    assert.deepEqual(recordedDelays, [500, 1000]);
  });

  await t.test("a non-TypeError, non-FetchApiError failure is still retried (unknown kind)", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls < 2) {
        return { ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } };
      }
      return jsonResponse(fullPayload());
    };

    const result = await fetchEndpoint("/analytics.json", {
      fetchImpl,
      retries: 2,
      retryDelayMs: 1,
    });

    assert.equal(calls, 2, "an unrecognized error kind must still be retried, not skipped");
    assert.equal(result.error, null);
  });

  await t.test("falls back to the cached payload after exhausting retries", async () => {
    const goodPayload = fullPayload();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(goodPayload);
      throw new TypeError("Failed to fetch");
    };

    // First call populates the cache.
    await fetchEndpoint("/analytics.json", { fetchImpl });

    // Second call fails every attempt, should fall back to cache
    // rather than returning null/throwing.
    const result = await fetchEndpoint("/analytics.json", {
      fetchImpl,
      retries: 1,
      retryDelayMs: 1,
    });

    assert.equal(result.fromCache, true);
    assert.deepEqual(result.payload, goodPayload);
    assert.ok(result.error, "the failure should still be reported alongside the cached data");
  });

  await t.test("returns a null payload with an error if there is no cache to fall back to", async () => {
    const fetchImpl = async () => {
      throw new TypeError("Failed to fetch");
    };

    const result = await fetchEndpoint("/analytics.json", {
      fetchImpl,
      retries: 1,
      retryDelayMs: 1,
    });

    assert.equal(result.payload, null);
    assert.equal(result.fromCache, false);
    assert.ok(result.error instanceof Error);
    assert.equal(result.isStale, null);
    assert.equal(result.ageMs, null);
  });

  await t.test("an HTTP error status is treated as a failure, not a success", async () => {
    const fetchImpl = async () => jsonResponse({}, { ok: false, status: 500 });

    const result = await fetchEndpoint("/analytics.json", {
      fetchImpl,
      retries: 0,
    });

    assert.equal(result.payload, null);
    assert.ok(result.error instanceof FetchApiError);
    assert.equal(result.error.kind, "http");
    assert.equal(result.error.status, 500);
  });

  await t.test("a schema validation failure is not retried", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse({ metadata: {} }); // missing required keys
    };

    const result = await fetchEndpoint("/analytics.json", {
      fetchImpl,
      retries: 3,
      retryDelayMs: 1,
      validate: validateSchema,
    });

    assert.equal(calls, 1, "schema errors must not be retried");
    assert.equal(result.error.kind, "schema");
  });

  await t.test("a valid payload passes an explicit validate function", async () => {
    const fetchImpl = async () => jsonResponse(fullPayload());

    const result = await fetchEndpoint("/analytics.json", {
      fetchImpl,
      validate: validateSchema,
    });

    assert.equal(result.error, null);
  });

  await t.test("rejects a negative retries", async () => {
    await assert.rejects(
      () => fetchEndpoint("/x", { fetchImpl: async () => jsonResponse(fullPayload()), retries: -1 }),
      TypeError,
    );
  });

  await t.test("rejects a non-integer retries", async () => {
    await assert.rejects(
      () => fetchEndpoint("/x", { fetchImpl: async () => jsonResponse(fullPayload()), retries: 1.5 }),
      TypeError,
    );
  });

  await t.test("rejects a negative retryDelayMs", async () => {
    await assert.rejects(
      () =>
        fetchEndpoint("/x", {
          fetchImpl: async () => jsonResponse(fullPayload()),
          retryDelayMs: -1,
        }),
      TypeError,
    );
  });

  await t.test("staleness is not computed unless staleAfterMs is supplied", async () => {
    const fetchImpl = async () => jsonResponse(fullPayload());
    const result = await fetchEndpoint("/analytics.json", { fetchImpl });
    assert.equal(result.isStale, null);
    assert.equal(result.ageMs, null);
  });

  await t.test("staleness is computed from metadata.generated_at when staleAfterMs is supplied", async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const payload = fullPayload({ metadata: { generated_at: fiveMinAgo } });
    const fetchImpl = async () => jsonResponse(payload);

    const fresh = await fetchEndpoint("/analytics.json", { fetchImpl, staleAfterMs: 15 * 60_000 });
    assert.equal(fresh.isStale, false);

    const stale = await fetchEndpoint("/analytics.json", { fetchImpl, staleAfterMs: 60_000 });
    assert.equal(stale.isStale, true);
  });

  await t.test("staleness is also computed for a cache-fallback result", async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const payload = fullPayload({ metadata: { generated_at: fiveMinAgo } });
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(payload);
      throw new TypeError("Failed to fetch");
    };

    await fetchEndpoint("/analytics.json", { fetchImpl });
    const result = await fetchEndpoint("/analytics.json", {
      fetchImpl,
      retries: 0,
      staleAfterMs: 60_000,
    });

    assert.equal(result.fromCache, true);
    assert.equal(result.isStale, true);
  });

  await t.test("a slower older request cannot overwrite a newer request's cached result", async () => {
    // Simulates two overlapping fetches for the same endpoint where
    // the one issued first resolves last.
    const oldPayload = fullPayload({ metadata: { generated_at: "old" } });
    const newPayload = fullPayload({ metadata: { generated_at: "new" } });

    let releaseOld;
    const oldGate = new Promise((resolve) => {
      releaseOld = resolve;
    });

    const oldFetch = async () => {
      await oldGate;
      return jsonResponse(oldPayload);
    };
    const newFetch = async () => jsonResponse(newPayload);

    const oldRequest = fetchEndpoint("/analytics.json", { fetchImpl: oldFetch });
    const newRequest = await fetchEndpoint("/analytics.json", { fetchImpl: newFetch });
    assert.deepEqual(newRequest.payload, newPayload);

    releaseOld();
    const oldResult = await oldRequest;
    // The older request still gets its own (old) result back...
    assert.deepEqual(oldResult.payload, oldPayload);
    // ...but must not have clobbered the cache with stale data.
    assert.deepEqual(getCached("/analytics.json").payload, newPayload);
  });
});

test("getCached / clearCache", async (t) => {
  await t.test("getCached returns null for an endpoint never fetched", () => {
    assert.equal(getCached("/never-fetched"), null);
  });

  await t.test("clearCache empties the cache", async () => {
    const fetchImpl = async () => jsonResponse(fullPayload());
    await fetchEndpoint("/analytics.json", { fetchImpl });
    assert.notEqual(getCached("/analytics.json"), null);

    clearCache();
    assert.equal(getCached("/analytics.json"), null);
  });
});

test("startPolling", async (t) => {
  await t.test("throws for a non-finite or non-positive intervalMs", () => {
    const noop = () => {};
    assert.throws(() => startPolling("/x", 0, noop), TypeError);
    assert.throws(() => startPolling("/x", -100, noop), TypeError);
    assert.throws(() => startPolling("/x", NaN, noop), TypeError);
  });

  await t.test("calls onUpdate on each tick until stopped", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    const fetchImpl = async () => jsonResponse(fullPayload());
    const updates = [];
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    const stop = startPolling(
      "/analytics.json",
      1000,
      (result) => {
        updates.push(result);
      },
      { fetchImpl },
    );

    t.mock.timers.tick(1000);
    await flush();
    await flush();

    t.mock.timers.tick(1000);
    await flush();
    await flush();

    assert.equal(updates.length, 2);

    stop();

    t.mock.timers.tick(1000);
    await flush();
    assert.equal(updates.length, 2, "no further updates after stop()");
  });

  await t.test("every poll tick unconditionally bypasses the HTTP cache, even if the caller's own options don't ask for it (Phase E Milestone 23, docs/ARCHITECTURE.md Section 20)", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    const receivedCacheValues = [];
    const fetchImpl = async (endpoint, options) => {
      receivedCacheValues.push(options.cache);
      return jsonResponse(fullPayload());
    };
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    // Caller passes bypassCache: false explicitly -- startPolling must
    // still force it to true regardless, since this is not meant to be
    // a per-caller opt-in.
    const stop = startPolling("/analytics.json", 1000, () => {}, {
      fetchImpl,
      bypassCache: false,
    });

    t.mock.timers.tick(1000);
    await flush();
    await flush();

    stop();

    assert.equal(receivedCacheValues.length, 1);
    assert.equal(receivedCacheValues[0], "no-store");
  });

  await t.test("stopping mid-flight (during an in-progress tick) suppresses that tick's update", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    let releaseFetch;
    const gate = new Promise((resolve) => {
      releaseFetch = resolve;
    });
    const fetchImpl = async () => {
      await gate;
      return jsonResponse(fullPayload());
    };

    const updates = [];
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    const stop = startPolling("/analytics.json", 1000, (result) => updates.push(result), {
      fetchImpl,
    });

    t.mock.timers.tick(1000); // fires tick(), which is now awaiting the gate
    await flush();

    stop(); // stop while fetchEndpoint is still in-flight
    releaseFetch(); // now let the in-flight fetch resolve
    await flush();
    await flush();

    assert.equal(updates.length, 0, "a tick already stopped mid-flight must not call onUpdate");
  });

  await t.test("an onUpdate that throws does not kill the poll loop", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    const fetchImpl = async () => jsonResponse(fullPayload());
    let updateCalls = 0;
    const errors = [];
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    const stop = startPolling(
      "/analytics.json",
      1000,
      () => {
        updateCalls += 1;
        throw new Error("rendering bug");
      },
      { fetchImpl, onError: (error) => errors.push(error) },
    );

    t.mock.timers.tick(1000);
    await flush();
    await flush();

    t.mock.timers.tick(1000);
    await flush();
    await flush();

    stop();

    assert.equal(updateCalls, 2, "polling must continue after onUpdate throws");
    assert.equal(errors.length, 2);
    assert.equal(errors[0].message, "rendering bug");
  });
});
