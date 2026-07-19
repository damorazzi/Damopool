import test from "node:test";
import assert from "node:assert/strict";
import {
  route,
  transformWorkersData,
  isWorkersEmpty,
  deriveWorkersState,
  filterWorkersByQuery,
  formatWorkerRow,
  buildWorkersSpec,
  mount,
  unmount,
} from "../../src/pages/workers.js";
import { getState, setState } from "../../src/core/state.js";
import { FetchApiError } from "../../src/core/api.js";
import { truncateWorkername } from "../../src/core/format.js";

function fullPayload(overrides = {}) {
  return {
    metadata: { schema_version: "1.1", generated_at: new Date().toISOString(), ...overrides.metadata },
    pool: {},
    users: {},
    workers: {
      rig2: {
        agent: null,
        is_active: false,
        last_share_at: null,
        accepted_count: 10,
        rejected_count: 1,
        average_sdiff: 50,
        best_share_today: null,
        best_share_ever: { username: "bob", workername: "rig2", sdiff: 400, timestamp: "unknown" },
      },
      rig1: {
        agent: "cgminer/4.11.1",
        is_active: true,
        last_share_at: new Date(Date.now() - 5 * 60_000).toISOString(),
        accepted_count: 500,
        rejected_count: 2,
        average_sdiff: 105.5,
        best_share_today: { username: "alice", workername: "rig1", sdiff: 512.5, timestamp: "unknown" },
        best_share_ever: { username: "alice", workername: "rig1", sdiff: 2048, timestamp: "unknown" },
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

test("route", async (t) => {
  await t.test("matches router.js's routes-array shape and is distinct from the other pages'", () => {
    assert.equal(route.pattern, "/workers");
    assert.equal(route.name, "workers");
  });
});

test("transformWorkersData", async (t) => {
  await t.test("builds one row per dictionary entry, sorted alphabetically by workername", () => {
    const data = transformWorkersData(fullPayload());
    assert.equal(data.rows.length, 2);
    assert.equal(data.rows[0].workername, "rig1");
    assert.equal(data.rows[1].workername, "rig2");
    assert.equal(data.rows[0].isActive, true);
    assert.equal(data.rows[1].isActive, false);
    assert.equal(data.rows[0].agent, "cgminer/4.11.1");
    assert.equal(data.rows[1].agent, null);
  });

  await t.test("reads the dictionary only via Object.entries -- an inherited/prototype key is never picked up", () => {
    const workers = Object.create({ inherited: { accepted_count: 1, is_active: true } });
    workers.rig1 = { accepted_count: 1, rejected_count: 0, average_sdiff: 1, is_active: false };
    const data = transformWorkersData({ metadata: {}, workers });
    assert.equal(data.rows.length, 1);
    assert.equal(data.rows[0].workername, "rig1");
  });

  await t.test("degrades gracefully when workers/metadata fields are missing", () => {
    const data = transformWorkersData({ metadata: {}, workers: { rig1: {} } });
    assert.equal(data.generatedAt, null);
    assert.equal(data.rows[0].isActive, false);
    assert.equal(data.rows[0].agent, null);
    assert.equal(data.rows[0].lastShareAt, null);
  });

  await t.test("no workers at all produces an empty rows array, not a throw", () => {
    assert.deepEqual(transformWorkersData({ metadata: {}, workers: {} }).rows, []);
    assert.deepEqual(transformWorkersData({ metadata: {} }).rows, []);
  });
});

test("isWorkersEmpty", async (t) => {
  await t.test("at least one worker is not empty", () => {
    assert.equal(isWorkersEmpty(fullPayload()), false);
  });

  await t.test("zero workers is empty", () => {
    assert.equal(isWorkersEmpty({ workers: {} }), true);
    assert.equal(isWorkersEmpty({}), true);
  });
});

test("deriveWorkersState", async (t) => {
  await t.test("no payload at all is status error with no data", () => {
    const state = deriveWorkersState({ payload: null, error: new Error("boom") });
    assert.equal(state.status, "error");
    assert.equal(state.data, null);
  });

  await t.test("zero workers is status empty", () => {
    const state = deriveWorkersState({ payload: fullPayload({ workers: {} }) });
    assert.equal(state.status, "empty");
  });

  await t.test("real data is status success", () => {
    const state = deriveWorkersState({ payload: fullPayload() });
    assert.equal(state.status, "success");
  });

  await t.test("an error alongside a cached payload keeps status success and carries the error", () => {
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "network" });
    const state = deriveWorkersState({ payload: fullPayload(), error });
    assert.equal(state.status, "success");
    assert.equal(state.error, error);
  });
});

test("filterWorkersByQuery", async (t) => {
  const rows = transformWorkersData(fullPayload()).rows;

  await t.test("an empty or whitespace-only query returns every row unchanged", () => {
    assert.deepEqual(filterWorkersByQuery(rows, ""), rows);
    assert.deepEqual(filterWorkersByQuery(rows, "   "), rows);
  });

  await t.test("matches a case-insensitive substring of the workername only, not the agent", () => {
    assert.deepEqual(filterWorkersByQuery(rows, "RIG1").map((r) => r.workername), ["rig1"]);
    // "cgminer" only appears in rig1's agent string, not its
    // workername -- must not match.
    assert.deepEqual(filterWorkersByQuery(rows, "cgminer"), []);
  });

  await t.test("no match returns an empty array, not a throw", () => {
    assert.deepEqual(filterWorkersByQuery(rows, "nonexistent-rig"), []);
  });

  await t.test("leading/trailing whitespace in a non-empty query is trimmed before matching", () => {
    assert.deepEqual(filterWorkersByQuery(rows, "  rig1  ").map((r) => r.workername), ["rig1"]);
  });
});

test("formatWorkerRow", async (t) => {
  await t.test("formats counts/sdiff for display but passes isActive through raw for the Status column's render()", () => {
    const row = transformWorkersData(fullPayload()).rows[0]; // rig1
    const formatted = formatWorkerRow(row);
    assert.equal(formatted.workername, "rig1");
    assert.equal(formatted.isActive, true);
    assert.equal(typeof formatted.isActive, "boolean");
    assert.equal(formatted.accepted, "500");
    assert.match(formatted.lastShare, /ago$|^just now$/);
  });

  await t.test("a null agent/lastShareAt formats as null (a placeholder dash downstream), not a throw", () => {
    const formatted = formatWorkerRow({
      workername: "x",
      isActive: false,
      agent: null,
      lastShareAt: null,
      acceptedCount: 0,
      rejectedCount: 0,
      averageSdiff: NaN,
      bestShareToday: null,
      bestShareEver: null,
    });
    assert.equal(formatted.agent, null);
    assert.equal(formatted.lastShare, null);
    assert.equal(formatted.bestToday, null);
  });
});

test("buildWorkersSpec", async (t) => {
  await t.test("loading state renders skeletons, no search box or table", () => {
    const spec = buildWorkersSpec({ status: "loading" });
    assert.ok(findByClassName(spec, "workers-page__loading"));
    assert.equal(findByClassName(spec, "search-box"), null);
    assert.equal(findByClassName(spec, "data-table"), null);
  });

  await t.test("error state (no data) renders only the error banner", () => {
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "network" });
    const spec = buildWorkersSpec({ status: "error", data: null, error, isStale: false });
    assert.ok(findByClassName(spec, "error-banner"));
    assert.equal(findByClassName(spec, "search-box"), null);
  });

  await t.test("empty state (no workers at all) renders EmptyState, no search box", () => {
    const data = transformWorkersData(fullPayload({ workers: {} }));
    const spec = buildWorkersSpec({ status: "empty", data, error: null, isStale: false });
    assert.ok(findByClassName(spec, "empty-state"));
    assert.equal(findByClassName(spec, "search-box"), null);
  });

  await t.test("success renders the search box and a table with a Badge in the Status column", () => {
    const data = transformWorkersData(fullPayload());
    const spec = buildWorkersSpec({ status: "success", data, error: null, isStale: false, searchQuery: "" });
    assert.ok(findByClassName(spec, "search-box"));
    const table = findByClassName(spec, "data-table");
    const tbody = table.children.find((c) => c.tag === "tbody");
    assert.equal(tbody.children.length, 2);

    // rig1 (row 0, active) and rig2 (row 1, inactive) -- Status is the
    // second column.
    const rig1StatusCell = tbody.children[0].children[1];
    const badge = rig1StatusCell.children[0];
    assert.equal(badge.className, "badge badge--success");
    assert.match(badge.children[1].text, /Active/);

    const rig2StatusCell = tbody.children[1].children[1];
    const inactiveBadge = rig2StatusCell.children[0];
    assert.equal(inactiveBadge.className, "badge badge--neutral");
    assert.match(inactiveBadge.children[1].text, /Inactive/);
  });

  await t.test("success with a matching query renders a filtered table, search box stays", () => {
    const data = transformWorkersData(fullPayload());
    const spec = buildWorkersSpec({ status: "success", data, error: null, isStale: false, searchQuery: "rig1" });
    const table = findByClassName(spec, "data-table");
    const tbody = table.children.find((c) => c.tag === "tbody");
    assert.equal(tbody.children.length, 1);
  });

  await t.test("success with a non-matching query renders a 'no matches' message, search box stays visible", () => {
    const data = transformWorkersData(fullPayload());
    const spec = buildWorkersSpec({
      status: "success",
      data,
      error: null,
      isStale: false,
      searchQuery: "nonexistent",
    });
    assert.ok(findByClassName(spec, "search-box"));
    assert.ok(findByClassName(spec, "empty-state"));
    assert.equal(findByClassName(spec, "data-table"), null);
    const emptyMessage = findByClassName(spec, "empty-state__message");
    assert.match(emptyMessage.text, /nonexistent/);
  });

  await t.test("a markup-like search query passes through the 'no matches' message as text, never markup", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const data = transformWorkersData(fullPayload());
    const spec = buildWorkersSpec({ status: "success", data, error: null, isStale: false, searchQuery: raw });
    const message = findByClassName(spec, "empty-state__message");
    assert.equal(message.text, `No workers match "${raw}".`);
    assert.equal(message.tag, "p");
  });

  await t.test("success + error (cached fallback) shows the error banner above the live content", () => {
    const data = transformWorkersData(fullPayload());
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "http", status: 503 });
    const spec = buildWorkersSpec({ status: "success", data, error, isStale: false, searchQuery: "" });
    assert.ok(findByClassName(spec, "error-banner"));
    assert.ok(findByClassName(spec, "data-table"));
  });

  await t.test("an unrecognized status throws rather than silently rendering the success branch", () => {
    assert.throws(() => buildWorkersSpec({ status: "not-a-real-status" }), /unrecognized status/);
  });

  await t.test("each row's workername links to its worker-detail page, correctly encoded", () => {
    const data = transformWorkersData(fullPayload());
    const spec = buildWorkersSpec({ status: "success", data, error: null, isStale: false, searchQuery: "" });
    const table = findByClassName(spec, "data-table");
    const tbody = table.children.find((c) => c.tag === "tbody");
    const workernameCell = tbody.children[0].children[0]; // rig1, sorted first
    assert.equal(workernameCell.tag, "td");
    assert.equal(workernameCell.className, "data-table__cell mono");
    const link = workernameCell.children[0];
    assert.equal(link.tag, "a");
    assert.equal(link.text, "rig1");
    assert.equal(link.attrs.href, "#/workers/rig1");
  });

  await t.test("a workername needing encoding (/, #, %) round-trips through the link href", () => {
    const raw = "weird/name#1 100%";
    const data = transformWorkersData({ metadata: {}, workers: { [raw]: { accepted_count: 1, is_active: false } } });
    const spec = buildWorkersSpec({ status: "success", data, error: null, isStale: false, searchQuery: "" });
    const table = findByClassName(spec, "data-table");
    const tbody = table.children.find((c) => c.tag === "tbody");
    const link = tbody.children[0].children[0].children[0];
    assert.equal(
      link.text,
      truncateWorkername(raw),
      "the visible text is the truncated raw workername, not the encoded one (Phase E Milestone 25 truncation is orthogonal to href encoding)",
    );
    assert.equal(link.attrs.href, `#/workers/${encodeURIComponent(raw)}`);
    assert.equal(link.attrs.title, raw, "the full untruncated workername stays available via title");
    assert.equal(link.attrs["aria-label"], raw, "and via aria-label, for assistive tech that doesn't announce title");
  });

  await t.test("a malicious workername passes through the link as text, never markup, even truncated", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const data = transformWorkersData({ metadata: {}, workers: { [raw]: { accepted_count: 1, is_active: false } } });
    const spec = buildWorkersSpec({ status: "success", data, error: null, isStale: false, searchQuery: "" });
    const table = findByClassName(spec, "data-table");
    const tbody = table.children.find((c) => c.tag === "tbody");
    const link = tbody.children[0].children[0].children[0];
    assert.equal(link.text, truncateWorkername(raw));
    assert.equal(link.tag, "a");
  });

  await t.test("a malicious agent string passes through as table cell text, never markup", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const data = transformWorkersData({
      metadata: {},
      workers: { rig1: { agent: raw, accepted_count: 1, is_active: false } },
    });
    const spec = buildWorkersSpec({ status: "success", data, error: null, isStale: false, searchQuery: "" });
    const table = findByClassName(spec, "data-table");
    const tbody = table.children.find((c) => c.tag === "tbody");
    // Agent is the third column (Workername, Status, Agent).
    assert.equal(tbody.children[0].children[2].text, raw);
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
    assert.ok(findByClassName(renders[0], "workers-page__loading"));

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(renders.length, 2);
    assert.ok(findByClassName(renders[1], "data-table"));
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

  await t.test("unmount() clears the container by rendering an empty page shell", async () => {
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
    assert.equal(renders[2].className, "workers-page");
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

  await t.test("typing updates the query in core/state.js and re-renders with the new filtered content", async () => {
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
    input.value = "rig1";
    input.listeners.input({ target: input });

    assert.equal(getState().searchQuery, "rig1");
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

    input.value = "rig1";
    input.listeners.input({ target: input });
    assert.equal(getState().searchQuery, "rig1");

    clearButton.listeners.click();

    assert.equal(getState().searchQuery, "");
    assert.equal(input.value, "");
    assert.equal(input.focused, true);
  });

  await t.test("mount() reads back a previously-set state.searchQuery rather than always starting blank", async () => {
    setState({ searchQuery: "rig2" });

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
    assert.equal(input.attrs.value, "rig2");

    setState({ searchQuery: "" });
  });

  await t.test("unmount() does not clear state.js's searchQuery -- it must survive a route change", async () => {
    setState({ searchQuery: "rig1" });
    const render = () => ({ searchInputNode: null, clearButtonNode: null });
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render });
    unmount();

    assert.equal(getState().searchQuery, "rig1");
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
