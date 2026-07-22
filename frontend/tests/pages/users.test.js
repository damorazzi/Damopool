import test from "node:test";
import assert from "node:assert/strict";
import {
  route,
  transformUsersData,
  isUsersEmpty,
  deriveUsersState,
  filterUsersByQuery,
  formatUserRow,
  buildUsersSpec,
  mount,
  unmount,
} from "../../src/pages/users.js";
import { getState, setState } from "../../src/core/state.js";
import { FetchApiError } from "../../src/core/api.js";
import { truncateAddress } from "../../src/core/format.js";

function fullPayload(overrides = {}) {
  return {
    metadata: { schema_version: "1.1", generated_at: new Date().toISOString(), ...overrides.metadata },
    pool: {},
    users: {
      bob: {
        accepted_count: 500,
        rejected_count: 2,
        average_sdiff: 80,
        best_share_today: { username: "bob", workername: "rig1", sdiff: 300, timestamp: "unknown" },
        best_share_ever: { username: "bob", workername: "rig1", sdiff: 900, timestamp: "unknown" },
        workers: ["rig1", "rig2"],
      },
      alice: {
        accepted_count: 1000,
        rejected_count: 5,
        average_sdiff: 105.5,
        best_share_today: { username: "alice", workername: "rig1", sdiff: 512.5, timestamp: "unknown" },
        best_share_ever: { username: "alice", workername: "rig1", sdiff: 2048, timestamp: "unknown" },
        workers: ["rig1"],
      },
      ...overrides.users,
    },
    workers: {},
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
  await t.test("matches router.js's routes-array shape and is distinct from Overview's/Pool's", () => {
    assert.equal(route.pattern, "/users");
    assert.equal(route.name, "users");
  });
});

test("transformUsersData", async (t) => {
  await t.test("builds one row per dictionary entry, sorted alphabetically by username", () => {
    const data = transformUsersData(fullPayload());
    assert.equal(data.rows.length, 2);
    assert.equal(data.rows[0].username, "alice");
    assert.equal(data.rows[1].username, "bob");
    assert.equal(data.rows[0].acceptedCount, 1000);
    assert.equal(data.rows[0].workerCount, 1);
    assert.equal(data.rows[1].workerCount, 2);
  });

  await t.test("reads the dictionary only via Object.entries -- an inherited/prototype key is never picked up", () => {
    // Regression test for docs/ARCHITECTURE.md Section 13's warning:
    // a plain object literal used as a lookup table can pick up
    // unexpected inherited keys via for...in; Object.entries cannot.
    const users = Object.create({ inherited: { accepted_count: 1, workers: [] } });
    users.alice = { accepted_count: 1, rejected_count: 0, average_sdiff: 1, workers: [] };
    const data = transformUsersData({ metadata: {}, users });
    assert.equal(data.rows.length, 1);
    assert.equal(data.rows[0].username, "alice");
  });

  await t.test("degrades gracefully when users/metadata/workers fields are missing", () => {
    const data = transformUsersData({ metadata: {}, users: { alice: {} } });
    assert.equal(data.generatedAt, null);
    assert.equal(data.rows[0].workerCount, 0);
    assert.equal(data.rows[0].bestShareToday, null);
  });

  await t.test("no users at all produces an empty rows array, not a throw", () => {
    assert.deepEqual(transformUsersData({ metadata: {}, users: {} }).rows, []);
    assert.deepEqual(transformUsersData({ metadata: {} }).rows, []);
  });

  await t.test("Milestone 27: also returns workerRows, reusing workers.js's own transform over the same payload", () => {
    const data = transformUsersData(fullPayload({ workers: { rig1: { is_active: true, accepted_count: 1, last_share_at: null } } }));
    assert.equal(data.workerRows.length, 1);
    assert.equal(data.workerRows[0].workername, "rig1");
  });
});

test("isUsersEmpty", async (t) => {
  await t.test("at least one user is not empty", () => {
    assert.equal(isUsersEmpty(fullPayload()), false);
  });

  await t.test("zero users is empty", () => {
    assert.equal(isUsersEmpty({ users: {} }), true);
    assert.equal(isUsersEmpty({}), true);
  });
});

// describeFetchError itself is now core/errors.js's own export, tested
// directly in tests/core/errors.test.js -- this page's error-state
// tests (buildUsersSpec, below) confirm the integration without
// re-testing its branching logic here a second time.

test("deriveUsersState", async (t) => {
  await t.test("no payload at all is status error with no data", () => {
    const state = deriveUsersState({ payload: null, error: new Error("boom") });
    assert.equal(state.status, "error");
    assert.equal(state.data, null);
  });

  await t.test("zero users is status empty", () => {
    const state = deriveUsersState({ payload: fullPayload({ users: {} }) });
    assert.equal(state.status, "empty");
  });

  await t.test("real data is status success", () => {
    const state = deriveUsersState({ payload: fullPayload() });
    assert.equal(state.status, "success");
  });

  await t.test("an error alongside a cached payload keeps status success and carries the error", () => {
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "network" });
    const state = deriveUsersState({ payload: fullPayload(), error });
    assert.equal(state.status, "success");
    assert.equal(state.error, error);
  });
});

test("filterUsersByQuery", async (t) => {
  const rows = transformUsersData(fullPayload()).rows;

  await t.test("an empty or whitespace-only query returns every row unchanged", () => {
    assert.deepEqual(filterUsersByQuery(rows, ""), rows);
    assert.deepEqual(filterUsersByQuery(rows, "   "), rows);
    assert.deepEqual(filterUsersByQuery(rows, undefined), rows);
  });

  await t.test("matches a case-insensitive substring of the username", () => {
    assert.deepEqual(filterUsersByQuery(rows, "ALI").map((r) => r.username), ["alice"]);
    assert.deepEqual(filterUsersByQuery(rows, "b").map((r) => r.username), ["bob"]);
  });

  await t.test("leading/trailing whitespace in the query is trimmed before matching", () => {
    assert.deepEqual(filterUsersByQuery(rows, "  alice  ").map((r) => r.username), ["alice"]);
  });

  await t.test("no match returns an empty array, not a throw", () => {
    assert.deepEqual(filterUsersByQuery(rows, "nonexistent-user"), []);
  });
});

test("formatUserRow", async (t) => {
  await t.test("formats counts and sdiff values for display", () => {
    const row = transformUsersData(fullPayload()).rows[0]; // alice
    const formatted = formatUserRow(row);
    assert.equal(formatted.username, "alice");
    assert.equal(formatted.accepted, "1,000");
    assert.equal(formatted.workerCount, "1");
  });

  await t.test("missing best-share data formats as null (a placeholder dash downstream), not a throw", () => {
    const formatted = formatUserRow({
      username: "x",
      workerCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      averageSdiff: NaN,
      bestShareToday: null,
      bestShareEver: null,
    });
    assert.equal(formatted.bestToday, null);
    assert.equal(formatted.bestEver, null);
  });
});

test("buildUsersSpec", async (t) => {
  await t.test("loading state renders skeletons, no search box or table", () => {
    const spec = buildUsersSpec({ status: "loading" });
    assert.ok(findByClassName(spec, "users-page__loading"));
    assert.equal(findByClassName(spec, "search-box"), null);
    assert.equal(findByClassName(spec, "data-table"), null);
  });

  await t.test("error state (no data) renders only the error banner", () => {
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "network" });
    const spec = buildUsersSpec({ status: "error", data: null, error, isStale: false });
    assert.ok(findByClassName(spec, "error-banner"));
    assert.equal(findByClassName(spec, "search-box"), null);
  });

  await t.test("empty state (no users at all) renders EmptyState, no search box", () => {
    const data = transformUsersData(fullPayload({ users: {} }));
    const spec = buildUsersSpec({ status: "empty", data, error: null, isStale: false });
    assert.ok(findByClassName(spec, "empty-state"));
    assert.equal(findByClassName(spec, "search-box"), null);
  });

  await t.test("success with no query renders the search box and the full table", () => {
    const data = transformUsersData(fullPayload());
    const spec = buildUsersSpec({ status: "success", data, error: null, isStale: false, searchQuery: "" });
    assert.ok(findByClassName(spec, "search-box"));
    const table = findByClassName(spec, "data-table");
    assert.ok(table);
    const tbody = table.children.find((c) => c.tag === "tbody");
    assert.equal(tbody.children.length, 2);
  });

  await t.test("success with a matching query renders a filtered table, search box stays", () => {
    const data = transformUsersData(fullPayload());
    const spec = buildUsersSpec({ status: "success", data, error: null, isStale: false, searchQuery: "ali" });
    assert.ok(findByClassName(spec, "search-box"));
    const table = findByClassName(spec, "data-table");
    const tbody = table.children.find((c) => c.tag === "tbody");
    assert.equal(tbody.children.length, 1);
  });

  await t.test("success with a non-matching query renders a 'no matches' message, search box stays visible", () => {
    const data = transformUsersData(fullPayload());
    const spec = buildUsersSpec({
      status: "success",
      data,
      error: null,
      isStale: false,
      searchQuery: "nonexistent",
    });
    assert.ok(findByClassName(spec, "search-box"), "the search box must stay so the user can clear/edit it");
    assert.ok(findByClassName(spec, "empty-state"));
    assert.equal(findByClassName(spec, "data-table"), null);
    const emptyMessage = findByClassName(spec, "empty-state__message");
    assert.match(emptyMessage.text, /nonexistent/);
  });

  await t.test("success + error (cached fallback) shows the error banner above the live content", () => {
    const data = transformUsersData(fullPayload());
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "http", status: 503 });
    const spec = buildUsersSpec({ status: "success", data, error, isStale: false, searchQuery: "" });
    assert.ok(findByClassName(spec, "error-banner"));
    assert.ok(findByClassName(spec, "data-table"));
  });

  await t.test("an unrecognized status throws rather than silently rendering the success branch", () => {
    assert.throws(() => buildUsersSpec({ status: "not-a-real-status" }), /unrecognized status/);
  });

  await t.test("each row's username links to its user-detail page, correctly encoded", () => {
    const data = transformUsersData(fullPayload());
    const spec = buildUsersSpec({ status: "success", data, error: null, isStale: false, searchQuery: "" });
    const table = findByClassName(spec, "data-table");
    const tbody = table.children.find((c) => c.tag === "tbody");
    const usernameCell = tbody.children[0].children[0]; // alice, sorted first
    assert.equal(usernameCell.tag, "td");
    assert.equal(usernameCell.className, "data-table__cell mono");
    const link = usernameCell.children[0];
    assert.equal(link.tag, "a");
    assert.equal(link.text, "alice");
    assert.equal(link.attrs.href, "#/users/alice");
  });

  await t.test("a username needing encoding (/, #, %) round-trips through the link href", () => {
    const raw = "weird/name#1 100%";
    const data = transformUsersData({ metadata: {}, users: { [raw]: { accepted_count: 1, workers: [] } } });
    const spec = buildUsersSpec({ status: "success", data, error: null, isStale: false, searchQuery: "" });
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

  await t.test("a malicious username passes through the link as text, never markup, even truncated", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const data = transformUsersData({ metadata: {}, users: { [raw]: { accepted_count: 1, workers: [] } } });
    const spec = buildUsersSpec({ status: "success", data, error: null, isStale: false, searchQuery: "" });
    const table = findByClassName(spec, "data-table");
    const tbody = table.children.find((c) => c.tag === "tbody");
    const link = tbody.children[0].children[0].children[0];
    assert.equal(link.text, truncateAddress(raw));
    assert.equal(link.tag, "a");
  });

  await t.test("a markup-like search query passes through the 'no matches' message as text, never markup", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const data = transformUsersData(fullPayload());
    const spec = buildUsersSpec({ status: "success", data, error: null, isStale: false, searchQuery: raw });
    const message = findByClassName(spec, "empty-state__message");
    assert.equal(message.text, `No matches found for "${raw}".`);
    assert.equal(message.tag, "p");
  });

  await t.test("Milestone 27: a query matching only a worker (no user) shows the Workers panel, no Users panel, no empty-state", () => {
    const data = transformUsersData(fullPayload({ workers: { superminer: { is_active: true, accepted_count: 1, last_share_at: null } } }));
    const spec = buildUsersSpec({ status: "success", data, error: null, isStale: false, searchQuery: "superminer" });
    assert.equal(findByClassName(spec, "empty-state"), null);
    const workersCard = findByClassName(spec, "data-table");
    assert.ok(workersCard);
    const caption = findByClassName(spec, "data-table__caption") || findByClassName(spec, "data-table__caption--visually-hidden");
    // The single visible table present must be the workers-results one,
    // not a coincidentally-empty Users table -- assert via the card
    // title text rather than assuming table identity from position.
    const cardTitles = (function collect(node, out = []) {
      if (!node || typeof node !== "object") return out;
      if ((node.className || "").includes("card__header")) out.push(node.text ?? (node.children && node.children[0] && node.children[0].text));
      for (const child of node.children || []) collect(child, out);
      return out;
    })(spec);
    assert.deepEqual(cardTitles, ["Workers"]);
  });

  await t.test("Milestone 27: a query matching both a user and a worker shows both panels wrapped together", () => {
    // "alice" (from the base fixture) matches a user; give a worker a
    // name that also contains "alice" so the same query matches both.
    const both = transformUsersData(
      fullPayload({ workers: { "alice-rig9": { is_active: true, accepted_count: 1, last_share_at: null } } }),
    );
    const spec = buildUsersSpec({ status: "success", data: both, error: null, isStale: false, searchQuery: "alice" });
    const results = findByClassName(spec, "users-page__results");
    assert.ok(results, "expected the two-panel results wrapper when both a user and a worker match");
    assert.equal(results.children.length, 2);
  });

  await t.test("Milestone 27: an empty query never shows a Workers panel, even if a worker exists", () => {
    const data = transformUsersData(fullPayload({ workers: { rig1: { is_active: true, accepted_count: 1, last_share_at: null } } }));
    const spec = buildUsersSpec({ status: "success", data, error: null, isStale: false, searchQuery: "" });
    assert.equal(findByClassName(spec, "users-page__results"), null);
    assert.equal(findByClassName(spec, "empty-state"), null);
  });

  await t.test("the search box placeholder/label now mention both usernames and workers", () => {
    const data = transformUsersData(fullPayload());
    const spec = buildUsersSpec({ status: "success", data, error: null, isStale: false, searchQuery: "" });
    const input = findByClassName(spec, "search-box__input");
    assert.equal(input.attrs.placeholder, "Search users or workers");
    assert.equal(input.attrs["aria-label"], "Search users or workers");
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
    assert.ok(findByClassName(renders[0], "users-page__loading"));

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
    assert.equal(renders[2].className, "users-page");
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
    const inputCalls = [];
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
    assert.equal(renderCount, 2, "loading render + first success render");

    // Fire the (single) attached 'input' listener directly, simulating
    // a keystroke -- if the listener were attached more than once,
    // firing it once would still only append once here since we're
    // calling the handler function directly, so instead assert the
    // listener reference itself is stable across the poll tick below.
    const listenerAfterFirstRender = persistentInput.listeners.input;
    assert.equal(typeof listenerAfterFirstRender, "function");

    t.mock.timers.tick(1000);
    await flush();
    await flush();
    assert.equal(renderCount, 3, "the poll tick triggers another render");
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

  await t.test("mount() reads back a previously-set state.searchQuery rather than always starting blank", async () => {
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
