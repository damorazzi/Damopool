import test from "node:test";
import assert from "node:assert/strict";
import {
  route,
  transformSearchData,
  deriveSearchState,
  buildSearchResults,
  buildSearchSpec,
  mount,
  unmount,
} from "../../src/pages/search.js";
import { getState, setState } from "../../src/core/state.js";
import { FetchApiError } from "../../src/core/api.js";
import { truncateAddress } from "../../src/core/format.js";

function fullPayload(overrides = {}) {
  return {
    metadata: { schema_version: "1.1", generated_at: new Date().toISOString(), ...overrides.metadata },
    pool: {},
    users: {
      alice: { accepted_count: 1000, rejected_count: 5, average_sdiff: 105.5, workers: ["rig1"] },
      bob: { accepted_count: 500, rejected_count: 2, average_sdiff: 80, workers: ["rig2"] },
      ...overrides.users,
    },
    workers: {
      rig1: { agent: "cgminer/4.11.1", is_active: true, accepted_count: 500 },
      rig2: { agent: null, is_active: false, accepted_count: 20 },
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
    assert.equal(route.pattern, "/search");
    assert.equal(route.name, "search");
  });
});

test("transformSearchData", async (t) => {
  await t.test("reuses users.js's/workers.js's own transforms rather than re-walking the dictionaries", () => {
    const data = transformSearchData(fullPayload());
    assert.equal(data.userRows.length, 2);
    assert.equal(data.workerRows.length, 2);
    assert.equal(data.userRows.find((r) => r.username === "alice").acceptedCount, 1000);
    assert.equal(data.workerRows.find((r) => r.workername === "rig1").isActive, true);
  });

  await t.test("degrades gracefully with no users/workers/metadata at all", () => {
    const data = transformSearchData({ metadata: {}, users: {}, workers: {} });
    assert.equal(data.generatedAt, null);
    assert.deepEqual(data.userRows, []);
    assert.deepEqual(data.workerRows, []);
  });
});

test("deriveSearchState", async (t) => {
  await t.test("no payload at all is status error with no data", () => {
    const state = deriveSearchState({ payload: null, error: new Error("boom") });
    assert.equal(state.status, "error");
    assert.equal(state.data, null);
  });

  await t.test("real data is always status success, even a genuinely empty pool", () => {
    const state = deriveSearchState({ payload: fullPayload({ users: {}, workers: {} }) });
    assert.equal(state.status, "success");
    assert.deepEqual(state.data.userRows, []);
  });

  await t.test("an error alongside a cached (still valid) payload keeps status success and carries the error", () => {
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "network" });
    const state = deriveSearchState({ payload: fullPayload(), error });
    assert.equal(state.status, "success");
    assert.equal(state.error, error);
  });
});

test("buildSearchResults", async (t) => {
  const data = transformSearchData(fullPayload());

  await t.test("an empty or whitespace-only query has no results and hasQuery: false", () => {
    assert.deepEqual(buildSearchResults(data, ""), { userResults: [], workerResults: [], hasQuery: false });
    assert.deepEqual(buildSearchResults(data, "   "), { userResults: [], workerResults: [], hasQuery: false });
    assert.equal(buildSearchResults(data, undefined).hasQuery, false);
  });

  await t.test("matches users only when the query only matches a username", () => {
    const results = buildSearchResults(data, "alice");
    assert.equal(results.hasQuery, true);
    assert.equal(results.userResults.length, 1);
    assert.equal(results.userResults[0].username, "alice");
    assert.equal(results.workerResults.length, 0);
  });

  await t.test("matches workers only when the query only matches a workername", () => {
    const results = buildSearchResults(data, "rig1");
    assert.equal(results.userResults.length, 0);
    assert.equal(results.workerResults.length, 1);
    assert.equal(results.workerResults[0].workername, "rig1");
  });

  await t.test("mixed results: a query matching both a username and a workername returns both groups", () => {
    const mixedData = transformSearchData(fullPayload({ users: { rig: { accepted_count: 1, workers: [] } } }));
    const results = buildSearchResults(mixedData, "rig");
    assert.equal(results.userResults.length, 1, "the user literally named 'rig' matches");
    assert.equal(results.workerResults.length, 2, "both rig1 and rig2 match");
  });

  await t.test("case-insensitive matching", () => {
    assert.equal(buildSearchResults(data, "ALICE").userResults.length, 1);
    assert.equal(buildSearchResults(data, "RIG1").workerResults.length, 1);
  });

  await t.test("partial substring matching", () => {
    assert.equal(buildSearchResults(data, "lic").userResults.length, 1);
    assert.equal(buildSearchResults(data, "ig").workerResults.length, 2);
  });

  await t.test("no results: a real query matching neither users nor workers", () => {
    const results = buildSearchResults(data, "nonexistent-entity");
    assert.equal(results.hasQuery, true);
    assert.deepEqual(results.userResults, []);
    assert.deepEqual(results.workerResults, []);
  });

  await t.test("leading/trailing whitespace in a non-empty query is trimmed before matching", () => {
    assert.equal(buildSearchResults(data, "  alice  ").userResults.length, 1);
  });
});

test("buildSearchSpec", async (t) => {
  await t.test("loading state renders skeletons, no search box or results", () => {
    const spec = buildSearchSpec({ status: "loading" });
    assert.ok(findByClassName(spec, "search-page__loading"));
    assert.equal(findByClassName(spec, "search-box"), null);
    assert.equal(findByClassName(spec, "data-table"), null);
  });

  await t.test("error state (no data) renders only the error banner", () => {
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "network" });
    const spec = buildSearchSpec({ status: "error", data: null, error, isStale: false });
    assert.ok(findByClassName(spec, "error-banner"));
    assert.equal(findByClassName(spec, "search-box"), null);
  });

  await t.test("an unrecognized status throws rather than silently rendering the success branch", () => {
    assert.throws(() => buildSearchSpec({ status: "not-a-real-status" }), /unrecognized status/);
  });

  await t.test("empty search (no query) shows helpful guidance, not an empty table", () => {
    const data = transformSearchData(fullPayload());
    const spec = buildSearchSpec({ status: "success", data, error: null, isStale: false, searchQuery: "" });
    assert.ok(findByClassName(spec, "search-box"));
    assert.ok(findByClassName(spec, "empty-state"));
    const message = findByClassName(spec, "empty-state__message");
    assert.match(message.text, /Type a username or workername/);
    assert.equal(findByClassName(spec, "data-table"), null);
  });

  await t.test("user-only matches render just the Users group", () => {
    const data = transformSearchData(fullPayload());
    const spec = buildSearchSpec({ status: "success", data, error: null, isStale: false, searchQuery: "alice" });
    const tables = findAllByClassName(spec, "data-table");
    assert.equal(tables.length, 1);
    const tbody = tables[0].children.find((c) => c.tag === "tbody");
    assert.equal(tbody.children.length, 1);
  });

  await t.test("worker-only matches render just the Workers group", () => {
    const data = transformSearchData(fullPayload());
    const spec = buildSearchSpec({ status: "success", data, error: null, isStale: false, searchQuery: "rig1" });
    const tables = findAllByClassName(spec, "data-table");
    assert.equal(tables.length, 1);
  });

  await t.test("mixed matches render both the Users and Workers groups", () => {
    const data = transformSearchData(fullPayload({ users: { rig: { accepted_count: 1, workers: [] } } }));
    const spec = buildSearchSpec({ status: "success", data, error: null, isStale: false, searchQuery: "rig" });
    const tables = findAllByClassName(spec, "data-table");
    assert.equal(tables.length, 2);
  });

  await t.test("no results renders a dedicated 'no matches' message, search box stays visible", () => {
    const data = transformSearchData(fullPayload());
    const spec = buildSearchSpec({
      status: "success",
      data,
      error: null,
      isStale: false,
      searchQuery: "nonexistent-entity",
    });
    assert.ok(findByClassName(spec, "search-box"), "the search box must stay so the user can clear/edit it");
    assert.ok(findByClassName(spec, "empty-state"));
    assert.equal(findByClassName(spec, "data-table"), null);
    const message = findByClassName(spec, "empty-state__message");
    assert.match(message.text, /nonexistent-entity/);
  });

  await t.test("a matching user's username cell links to /users/:username, correctly encoded", () => {
    const data = transformSearchData(fullPayload());
    const spec = buildSearchSpec({ status: "success", data, error: null, isStale: false, searchQuery: "alice" });
    const table = findByClassName(spec, "data-table");
    const tbody = table.children.find((c) => c.tag === "tbody");
    const link = tbody.children[0].children[0].children[0];
    assert.equal(link.tag, "a");
    assert.equal(link.text, "alice");
    assert.equal(link.attrs.href, "#/users/alice");
  });

  await t.test("a matching worker's workername cell links to /workers/:workername, correctly encoded", () => {
    const data = transformSearchData(fullPayload());
    const spec = buildSearchSpec({ status: "success", data, error: null, isStale: false, searchQuery: "rig1" });
    const table = findByClassName(spec, "data-table");
    const tbody = table.children.find((c) => c.tag === "tbody");
    const link = tbody.children[0].children[0].children[0];
    assert.equal(link.tag, "a");
    assert.equal(link.text, "rig1");
    assert.equal(link.attrs.href, "#/workers/rig1");
  });

  await t.test("a username needing encoding (/, #, %) round-trips through the result link href", () => {
    const raw = "weird/name#1 100%";
    const data = transformSearchData(fullPayload({ users: { [raw]: { accepted_count: 1, workers: [] } } }));
    const spec = buildSearchSpec({ status: "success", data, error: null, isStale: false, searchQuery: raw });
    const table = findByClassName(spec, "data-table");
    const tbody = table.children.find((c) => c.tag === "tbody");
    const link = tbody.children[0].children[0].children[0];
    assert.equal(
      link.text,
      truncateAddress(raw),
      "the visible text is the truncated raw username, not the encoded one (Phase E Milestone 25 truncation is orthogonal to href encoding)",
    );
    assert.equal(link.attrs.href, `#/users/${encodeURIComponent(raw)}`);
    assert.equal(link.attrs.title, raw, "the full untruncated username stays available via title");
    assert.equal(link.attrs["aria-label"], raw, "and via aria-label, for assistive tech that doesn't announce title");
  });

  await t.test("success + error (cached fallback) shows the error banner above the live content", () => {
    const data = transformSearchData(fullPayload());
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "http", status: 503 });
    const spec = buildSearchSpec({ status: "success", data, error, isStale: false, searchQuery: "alice" });
    assert.ok(findByClassName(spec, "error-banner"));
    assert.ok(findByClassName(spec, "data-table"), "cached content must stay visible under the banner");
  });

  await t.test("success + isStale (no error) shows a warning banner, not the error icon", () => {
    const data = transformSearchData(fullPayload());
    const spec = buildSearchSpec({ status: "success", data, error: null, isStale: true, searchQuery: "" });
    const banner = findByClassName(spec, "error-banner");
    assert.equal(banner.children[0].className, "icon icon-warning error-banner__icon");
  });

  await t.test("a malicious username passes through the result link as text, never markup, even truncated", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const data = transformSearchData(fullPayload({ users: { [raw]: { accepted_count: 1, workers: [] } } }));
    const spec = buildSearchSpec({ status: "success", data, error: null, isStale: false, searchQuery: raw });
    const table = findByClassName(spec, "data-table");
    const tbody = table.children.find((c) => c.tag === "tbody");
    const link = tbody.children[0].children[0].children[0];
    assert.equal(link.text, truncateAddress(raw));
    assert.equal(link.tag, "a");
  });

  await t.test("a malicious search query passes through the 'no matches' message as text, never markup", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const data = transformSearchData(fullPayload());
    const spec = buildSearchSpec({ status: "success", data, error: null, isStale: false, searchQuery: raw });
    const message = findByClassName(spec, "empty-state__message");
    assert.equal(message.text, `No matches found for "${raw}".`);
    assert.equal(message.tag, "p");
  });
});

test("mount/unmount lifecycle (no DOM emulation)", async (t) => {
  t.afterEach(() => unmount());

  function fakeContainer() {
    return {};
  }

  function fakeInputNode(initial = "") {
    return { value: initial, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, focus() { this.focused = true; } };
  }

  function fakeButtonNode() {
    return { listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
  }

  await t.test("renders loading synchronously, then the fetch result once it resolves", async () => {
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return { searchInputNode: null, clearButtonNode: null };
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render });

    assert.equal(renders.length, 1);
    assert.ok(findByClassName(renders[0], "search-page__loading"));

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(renders.length, 2);
    assert.ok(findByClassName(renders[1], "search-box"));
  });

  await t.test("throws on a second mount() without an intervening unmount()", () => {
    const render = () => ({ searchInputNode: null, clearButtonNode: null });
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render });
    assert.throws(() => mount(fakeContainer(), { fetchImpl, render }), /already mounted/);
  });

  await t.test("unmount() before any mount() is a safe no-op", () => {
    assert.doesNotThrow(() => unmount());
  });

  await t.test("unmount() clears the container by rendering an empty page shell (cleanup on unmount)", async () => {
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      return { searchInputNode: null, clearButtonNode: null };
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(renders.length, 2);

    unmount();
    assert.equal(renders.length, 3);
    assert.equal(renders[2].className, "search-page");
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
        return { ok: true, status: 200, json: async () => fullPayload() };
      };
      const oldRenders = [];
      const oldRender = (target, spec) => {
        oldRenders.push(spec);
        return { searchInputNode: null, clearButtonNode: null };
      };

      mount(fakeContainer(), { fetchImpl: oldFetchImpl, render: oldRender });
      assert.equal(oldRenders.length, 1);

      unmount();

      const newRenders = [];
      const newRender = (target, spec) => {
        newRenders.push(spec);
        return { searchInputNode: null, clearButtonNode: null };
      };
      const newFetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

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

  await t.test("a same-status re-render reuses the search input node and does not double-wire its listener", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    const persistentInput = fakeInputNode("");
    let renderCount = 0;
    const render = () => {
      renderCount += 1;
      return { searchInputNode: persistentInput, clearButtonNode: fakeButtonNode() };
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    mount(fakeContainer(), { fetchImpl, render, intervalMs: 1000 });
    await flush();
    await flush();
    assert.equal(renderCount, 2);

    const listenerAfterFirstRender = persistentInput.listeners.input;
    assert.equal(typeof listenerAfterFirstRender, "function");

    t.mock.timers.tick(1000);
    await flush();
    await flush();
    assert.equal(renderCount, 3);
    assert.equal(
      persistentInput.listeners.input,
      listenerAfterFirstRender,
      "the same reused input node must not be re-wired with a second listener on a same-status re-render",
    );
  });

  await t.test("typing updates the query in core/state.js and re-renders with the new filtered results", async () => {
    let input;
    const renders = [];
    const render = (target, spec) => {
      renders.push(spec);
      if (!input) input = fakeInputNode("");
      return { searchInputNode: input, clearButtonNode: fakeButtonNode() };
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const rendersBeforeTyping = renders.length;
    input.value = "alice";
    input.listeners.input({ target: input });

    assert.equal(getState().searchQuery, "alice");
    assert.equal(renders.length, rendersBeforeTyping + 1, "typing must trigger exactly one re-render");
  });

  await t.test("clearing resets the query, the input's value, and refocuses the input", async () => {
    let input;
    let clearButton;
    const render = (target, spec) => {
      if (!input) input = fakeInputNode("");
      if (!clearButton) clearButton = fakeButtonNode();
      return { searchInputNode: input, clearButtonNode: clearButton };
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    input.value = "alice";
    input.listeners.input({ target: input });
    assert.equal(getState().searchQuery, "alice");

    clearButton.listeners.click();

    assert.equal(getState().searchQuery, "");
    assert.equal(input.value, "");
    assert.equal(input.focused, true);
  });

  await t.test("mount() reads back a previously-set state.searchQuery -- shared with users.js/workers.js", async () => {
    setState({ searchQuery: "bob" });

    let capturedSpec = null;
    const render = (target, spec) => {
      capturedSpec = spec;
      return { searchInputNode: null, clearButtonNode: null };
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const searchBox = findByClassName(capturedSpec, "search-box");
    const input = searchBox.children.find((c) => c.tag === "input");
    assert.equal(input.attrs.value, "bob");

    setState({ searchQuery: "" });
  });

  await t.test("unmount() does not clear state.js's searchQuery -- it must survive a route change", async () => {
    setState({ searchQuery: "alice" });
    const render = () => ({ searchInputNode: null, clearButtonNode: null });
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render });
    unmount();

    assert.equal(getState().searchQuery, "alice");
    setState({ searchQuery: "" });
  });

  await t.test("no polling is started when intervalMs is omitted", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    let renderCount = 0;
    const render = () => {
      renderCount += 1;
      return { searchInputNode: null, clearButtonNode: null };
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });
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
      return { searchInputNode: null, clearButtonNode: null };
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });
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
    let renderCount = 0;
    const render = () => {
      renderCount += 1;
      return { searchInputNode: null, clearButtonNode: null };
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render, staleAfterMs: NaN });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(renderCount, 2);
  });

  await t.test("mount() writes the fetched payload into core/state.js", async () => {
    const render = () => ({ searchInputNode: null, clearButtonNode: null });
    const payload = fullPayload();
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => payload });

    mount(fakeContainer(), { fetchImpl, render });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(getState().analytics, payload);
    assert.equal(typeof getState().analyticsFetchedAt, "string");
  });
});
