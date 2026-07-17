import test from "node:test";
import assert from "node:assert/strict";
import { getState, setState, subscribe } from "../../src/core/state.js";

test("state.js", async (t) => {
  await t.test("getState returns the default shape", () => {
    const state = getState();
    assert.deepEqual(state, {
      analytics: null,
      analyticsFetchedAt: null,
      theme: null,
      searchQuery: "",
    });
  });

  await t.test("setState updates only the keys provided", () => {
    setState({ theme: "dark" });
    assert.equal(getState().theme, "dark");
    assert.equal(getState().searchQuery, "");
  });

  await t.test("setState ignores keys outside the whitelist", () => {
    setState({ notARealKey: "should be dropped", theme: "light" });
    const state = getState();
    assert.equal(state.theme, "light");
    assert.equal("notARealKey" in state, false);
  });

  await t.test(
    "setState(analyticsPayload) does not spread the payload's own keys onto state",
    () => {
      // Regression test for the exact caller mistake the whitelist
      // guards against: passing the fetched payload directly instead
      // of wrapping it as { analytics: payload }.
      const payload = {
        metadata: {},
        pool: {},
        users: {},
        workers: {},
        daily_bests: {},
        live_ticker: [],
      };
      setState(payload);
      const state = getState();
      assert.equal(state.analytics, null, "analytics should be untouched");
      assert.equal("metadata" in state, false);
      assert.equal("pool" in state, false);
    },
  );

  await t.test("getState returns a copy, not the live reference", () => {
    setState({ theme: "dark" });
    const snapshot = getState();
    snapshot.theme = "mutated-locally";
    assert.equal(getState().theme, "dark", "mutating the returned object must not affect internal state");
  });

  await t.test("subscribe is notified on setState, with the new state", () => {
    let received = null;
    let callCount = 0;
    const unsubscribe = subscribe((state) => {
      received = state;
      callCount += 1;
    });

    setState({ searchQuery: "alice" });

    assert.equal(callCount, 1);
    assert.equal(received.searchQuery, "alice");

    unsubscribe();
    setState({ searchQuery: "bob" });
    assert.equal(callCount, 1, "listener must not fire after unsubscribe");
  });

  await t.test("analytics payload is held by reference, never merged", () => {
    const payload = { users: { alice: { __proto__: "not actually dangerous here" } } };
    setState({ analytics: payload });
    assert.equal(getState().analytics, payload, "must be the same reference, not a copy");
  });
});
