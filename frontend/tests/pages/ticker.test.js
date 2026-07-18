import test from "node:test";
import assert from "node:assert/strict";
import {
  route,
  transformTickerData,
  isTickerEmpty,
  deriveTickerState,
  tickerEntryKey,
  markNewEntries,
  buildAnnouncementText,
  buildTickerSpec,
  mount,
  unmount,
} from "../../src/pages/ticker.js";
import { getState, setState } from "../../src/core/state.js";
import { FetchApiError } from "../../src/core/api.js";

function fullPayload(overrides = {}) {
  return {
    metadata: { schema_version: "1.1", generated_at: new Date().toISOString(), ...overrides.metadata },
    pool: {},
    users: {},
    workers: {},
    daily_bests: {},
    live_ticker: [
      {
        username: "alice",
        workername: "rig1",
        current_daily_best: { sdiff: 512.5, timestamp: new Date(Date.now() - 2 * 60_000).toISOString() },
        previous_daily_best: { sdiff: 400, timestamp: new Date(Date.now() - 3 * 3_600_000).toISOString() },
        improvement_amount: 112.5,
        improvement_percentage: 28.1,
        timestamp: new Date(Date.now() - 2 * 60_000).toISOString(),
      },
      {
        username: "bob",
        workername: "rig2",
        current_daily_best: { sdiff: 200, timestamp: new Date(Date.now() - 10 * 60_000).toISOString() },
        previous_daily_best: null,
        improvement_amount: null,
        improvement_percentage: null,
        timestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
      },
    ],
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

function entryIdentity(entryLi) {
  const identity = entryLi.children.find((c) => (c.className || "").includes("ticker-feed__identity"));
  return { username: identity.children[0].text, workername: identity.children[1].text };
}

// Fixed, literal timestamps -- not fullPayload()'s own Date.now()-
// relative ones, which would recompute to a slightly different string
// on every call and make alice/bob look like a *different* entry (a
// different tickerEntryKey) on a later poll than the first, defeating
// any "already seen" comparison a multi-poll test needs to prove.
const STABLE_LIVE_TICKER = [
  {
    username: "alice",
    workername: "rig1",
    current_daily_best: { sdiff: 512.5, timestamp: "2026-07-18T09:58:00.000Z" },
    previous_daily_best: { sdiff: 400, timestamp: "2026-07-18T06:00:00.000Z" },
    improvement_amount: 112.5,
    improvement_percentage: 28.1,
    timestamp: "2026-07-18T09:58:00.000Z",
  },
  {
    username: "bob",
    workername: "rig2",
    current_daily_best: { sdiff: 200, timestamp: "2026-07-18T09:50:00.000Z" },
    previous_daily_best: null,
    improvement_amount: null,
    improvement_percentage: null,
    timestamp: "2026-07-18T09:50:00.000Z",
  },
];
const CAROL_ENTRY = {
  username: "carol",
  workername: "rig3",
  current_daily_best: { sdiff: 999, timestamp: "2026-07-18T10:05:00.000Z" },
  previous_daily_best: null,
  improvement_amount: null,
  improvement_percentage: null,
  timestamp: "2026-07-18T10:05:00.000Z",
};

function fakeAnnouncerNode() {
  return { textContent: "" };
}

test("route", async (t) => {
  await t.test("matches router.js's routes-array shape and is distinct from every other page's", () => {
    assert.equal(route.pattern, "/ticker");
    assert.equal(route.name, "ticker");
  });
});

test("transformTickerData", async (t) => {
  await t.test("builds one entry per live_ticker item, preserving the backend's own order", () => {
    const data = transformTickerData(fullPayload());
    assert.equal(data.entries.length, 2);
    assert.equal(data.entries[0].username, "alice");
    assert.equal(data.entries[1].username, "bob");
  });

  await t.test("does not re-sort -- the schema's own 'sorted newest first' order is trusted as-is", () => {
    const reversed = fullPayload();
    reversed.live_ticker = [...reversed.live_ticker].reverse();
    const data = transformTickerData(reversed);
    assert.equal(data.entries[0].username, "bob");
    assert.equal(data.entries[1].username, "alice");
  });

  await t.test("a null previous_daily_best/improvement fields pass through as null, not a throw", () => {
    const data = transformTickerData(fullPayload());
    const bob = data.entries[1];
    assert.equal(bob.previousDailyBest, null);
    assert.equal(bob.improvementAmount, null);
    assert.equal(bob.improvementPercentage, null);
  });

  await t.test("degrades gracefully when live_ticker is missing or not an array", () => {
    assert.deepEqual(transformTickerData({ metadata: {} }).entries, []);
    assert.deepEqual(transformTickerData({ metadata: {}, live_ticker: null }).entries, []);
    assert.deepEqual(transformTickerData({ metadata: {}, live_ticker: {} }).entries, []);
  });

  await t.test("generatedAt falls back to null when metadata is missing", () => {
    assert.equal(transformTickerData({ live_ticker: [] }).generatedAt, null);
  });

  await t.test("an entry with a missing/empty username or workername is dropped, not thrown on", () => {
    const payload = fullPayload({
      live_ticker: [
        { username: "", workername: "rig1", timestamp: "2026-07-18T10:00:00Z" },
        { username: "alice", workername: undefined, timestamp: "2026-07-18T10:00:00Z" },
        { username: null, workername: "rig1", timestamp: "2026-07-18T10:00:00Z" },
        { username: "carol", workername: "rig3", timestamp: "2026-07-18T10:00:00Z" },
      ],
    });
    const data = transformTickerData(payload);
    assert.equal(data.entries.length, 1);
    assert.equal(data.entries[0].username, "carol");
  });
});

test("isTickerEmpty", async (t) => {
  await t.test("at least one entry is not empty", () => {
    assert.equal(isTickerEmpty(fullPayload()), false);
  });

  await t.test("zero entries, or a missing/malformed live_ticker, is empty", () => {
    assert.equal(isTickerEmpty({ live_ticker: [] }), true);
    assert.equal(isTickerEmpty({}), true);
    assert.equal(isTickerEmpty({ live_ticker: "not-an-array" }), true);
  });

  await t.test("a live_ticker whose entries are all malformed (no valid username/workername) is empty", () => {
    assert.equal(isTickerEmpty({ live_ticker: [{ username: "", workername: "rig1" }] }), true);
  });
});

test("deriveTickerState", async (t) => {
  await t.test("no payload at all is status error with no data", () => {
    const state = deriveTickerState({ payload: null, error: new Error("boom") });
    assert.equal(state.status, "error");
    assert.equal(state.data, null);
  });

  await t.test("zero entries is status empty", () => {
    const state = deriveTickerState({ payload: fullPayload({ live_ticker: [] }) });
    assert.equal(state.status, "empty");
  });

  await t.test("real data is status success", () => {
    const state = deriveTickerState({ payload: fullPayload() });
    assert.equal(state.status, "success");
  });

  await t.test("an error alongside a cached payload keeps status success and carries the error", () => {
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "network" });
    const state = deriveTickerState({ payload: fullPayload(), error });
    assert.equal(state.status, "success");
    assert.equal(state.error, error);
  });
});

test("tickerEntryKey", async (t) => {
  await t.test("is a deterministic composite of username, workername, and timestamp", () => {
    const entry = { username: "alice", workername: "rig1", timestamp: "2026-07-18T10:00:00.000Z" };
    assert.equal(tickerEntryKey(entry), tickerEntryKey({ ...entry }));
    assert.equal(
      tickerEntryKey(entry),
      JSON.stringify(["alice", "rig1", "2026-07-18T10:00:00.000Z"]),
    );
  });

  await t.test("two entries differing only by timestamp get distinct keys", () => {
    const a = { username: "alice", workername: "rig1", timestamp: "2026-07-18T10:00:00.000Z" };
    const b = { username: "alice", workername: "rig1", timestamp: "2026-07-18T11:00:00.000Z" };
    assert.notEqual(tickerEntryKey(a), tickerEntryKey(b));
  });

  await t.test("a username/workername split at a shared delimiter does not collide (JSON.stringify, not string-join)", () => {
    const a = { username: "a::b", workername: "c", timestamp: "2026-07-18T10:00:00.000Z" };
    const b = { username: "a", workername: "b::c", timestamp: "2026-07-18T10:00:00.000Z" };
    assert.notEqual(tickerEntryKey(a), tickerEntryKey(b));
  });
});

test("markNewEntries", async (t) => {
  const entries = transformTickerData(fullPayload()).entries;

  await t.test("null previousKeys (first paint) marks every entry isNew: false", () => {
    const marked = markNewEntries(entries, null);
    assert.equal(marked.length, 2);
    assert.ok(marked.every((e) => e.isNew === false));
  });

  await t.test("an empty Set (a genuine previous poll with nothing in it) marks every entry isNew: true", () => {
    const marked = markNewEntries(entries, new Set());
    assert.ok(marked.every((e) => e.isNew === true));
  });

  await t.test("only a key absent from previousKeys is marked new", () => {
    const previousKeys = new Set([tickerEntryKey(entries[0])]);
    const marked = markNewEntries(entries, previousKeys);
    assert.equal(marked[0].isNew, false);
    assert.equal(marked[1].isNew, true);
  });

  await t.test("does not mutate the input entries", () => {
    const before = entries.map((e) => ({ ...e }));
    markNewEntries(entries, new Set());
    assert.deepEqual(entries, before);
  });
});

test("buildAnnouncementText", async (t) => {
  const entries = transformTickerData(fullPayload()).entries;

  await t.test("no isNew entries produces an empty string, not a throw", () => {
    const marked = markNewEntries(entries, null);
    assert.equal(buildAnnouncementText(marked), "");
  });

  await t.test("one new entry produces one sentence naming its username and workername", () => {
    const marked = markNewEntries(entries, new Set());
    const text = buildAnnouncementText([marked[0]]);
    assert.equal(text, "New best share by alice on rig1.");
  });

  await t.test("multiple new entries are joined, one sentence per entry", () => {
    const marked = markNewEntries(entries, new Set());
    const text = buildAnnouncementText(marked);
    assert.equal(text, "New best share by alice on rig1. New best share by bob on rig2.");
  });

  await t.test("only isNew entries are included, not the whole list", () => {
    const marked = markNewEntries(entries, new Set([tickerEntryKey(entries[0])]));
    const text = buildAnnouncementText(marked);
    assert.equal(text, "New best share by bob on rig2.");
  });

  await t.test("a malicious username/workername is not treated as markup -- this is plain text, not a spec", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const text = buildAnnouncementText([{ username: raw, workername: raw, isNew: true }]);
    assert.equal(text, `New best share by ${raw} on ${raw}.`);
  });
});

test("buildTickerSpec", async (t) => {
  await t.test("loading state renders skeletons, no ticker feed", () => {
    const spec = buildTickerSpec({ status: "loading" });
    assert.ok(findByClassName(spec, "ticker-page__loading"));
    assert.equal(findByClassName(spec, "ticker-feed"), null);
  });

  await t.test("error state (no data) renders only the error banner", () => {
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "network" });
    const spec = buildTickerSpec({ status: "error", data: null, error, isStale: false });
    assert.ok(findByClassName(spec, "error-banner"));
    assert.equal(findByClassName(spec, "ticker-feed"), null);
  });

  await t.test("empty state (no entries at all) renders EmptyState, no ticker feed", () => {
    const data = transformTickerData(fullPayload({ live_ticker: [] }));
    const spec = buildTickerSpec({ status: "empty", data, error: null, isStale: false });
    assert.ok(findByClassName(spec, "empty-state"));
    assert.equal(findByClassName(spec, "ticker-feed"), null);
  });

  await t.test("an unrecognized status throws rather than silently rendering the success branch", () => {
    assert.throws(() => buildTickerSpec({ status: "not-a-real-status" }), /unrecognized status/);
  });

  await t.test("success + error (cached fallback) shows the error banner above the live content", () => {
    const data = transformTickerData(fullPayload());
    const error = new FetchApiError("x", { endpoint: "/analytics.json", kind: "http", status: 503 });
    const spec = buildTickerSpec({ status: "success", data: markNewEntriesData(data), error, isStale: false });
    assert.ok(findByClassName(spec, "error-banner"));
    assert.ok(findByClassName(spec, "ticker-feed"));
  });

  function markNewEntriesData(data) {
    return { ...data, entries: data.entries.map((e) => ({ ...e, isNew: false })) };
  }

  await t.test("success renders one entry per ticker item, correctly linked and formatted", () => {
    const data = markNewEntriesData(transformTickerData(fullPayload()));
    const spec = buildTickerSpec({ status: "success", data, error: null, isStale: false });

    const entries = findAllByClassName(spec, "ticker-feed__entry");
    assert.equal(entries.length, 2);

    const alice = entries[0];
    assert.equal(entryIdentity(alice).username, "alice");
    assert.equal(entryIdentity(alice).workername, "rig1");
    const aliceIdentity = alice.children.find((c) => (c.className || "").includes("ticker-feed__identity"));
    assert.equal(aliceIdentity.children[0].attrs.href, "#/users/alice");
    assert.equal(aliceIdentity.children[1].attrs.href, "#/workers/rig1");

    const aliceBests = alice.children.find((c) => (c.className || "").includes("ticker-feed__bests"));
    assert.equal(aliceBests.children[0].text, "512.5");
    assert.equal(aliceBests.children[1].text, "was 400");

    const aliceTrend = alice.children.find((c) => (c.className || "").includes("ticker-feed__trend"));
    assert.ok(aliceTrend, "a positive improvement_percentage must render a trend");
    assert.equal(aliceTrend.children[1].text, "+28.1%");

    const aliceTimestamp = alice.children.find((c) => (c.className || "") === "ticker-feed__timestamp");
    assert.match(aliceTimestamp.text, /ago$|^just now$/);
  });

  await t.test("an entry with no previous best shows 'First best of the day' and no trend", () => {
    const data = markNewEntriesData(transformTickerData(fullPayload()));
    const spec = buildTickerSpec({ status: "success", data, error: null, isStale: false });

    const entries = findAllByClassName(spec, "ticker-feed__entry");
    const bob = entries[1];
    const bobBests = bob.children.find((c) => (c.className || "").includes("ticker-feed__bests"));
    assert.equal(bobBests.children[1].text, "was First best of the day");

    const bobTrend = bob.children.find((c) => (c.className || "").includes("ticker-feed__trend"));
    assert.equal(bobTrend, undefined, "no improvement_percentage means no trend rendered at all");
  });

  await t.test("an entry marked isNew renders the --new modifier class; others do not", () => {
    const data = transformTickerData(fullPayload());
    data.entries = markNewEntries(data.entries, new Set([tickerEntryKey(data.entries[1])]));
    const spec = buildTickerSpec({ status: "success", data, error: null, isStale: false });

    const entries = findAllByClassName(spec, "ticker-feed__entry");
    assert.equal(entries[0].className, "ticker-feed__entry ticker-feed__entry--new");
    assert.equal(entries[1].className, "ticker-feed__entry");
  });

  await t.test("a dedicated, initially-empty announcer element carries aria-live, not the (fully-rebuilt) list itself", () => {
    const data = markNewEntriesData(transformTickerData(fullPayload()));
    const spec = buildTickerSpec({ status: "success", data, error: null, isStale: false });

    const announcer = findByClassName(spec, "ticker-feed__announcer");
    assert.ok(announcer);
    assert.equal(announcer.attrs["aria-live"], "polite");
    assert.equal(announcer.text, undefined, "the spec never carries announcement text -- mount() sets it imperatively on the persisted node");

    const list = findByClassName(spec, "ticker-feed__list");
    assert.equal(list.attrs["aria-live"], undefined, "the list is rebuilt every render and is not a reliable live-region host");
  });

  await t.test("a malicious username/workername passes through as link text, never markup", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const payload = fullPayload();
    payload.live_ticker = [
      {
        username: raw,
        workername: raw,
        current_daily_best: { sdiff: 1, timestamp: new Date().toISOString() },
        previous_daily_best: null,
        improvement_amount: null,
        improvement_percentage: null,
        timestamp: new Date().toISOString(),
      },
    ];
    const data = markNewEntriesData(transformTickerData(payload));
    const spec = buildTickerSpec({ status: "success", data, error: null, isStale: false });
    const entries = findAllByClassName(spec, "ticker-feed__entry");
    const identity = entryIdentity(entries[0]);
    assert.equal(identity.username, raw);
    assert.equal(identity.workername, raw);
    const identityDiv = entries[0].children.find((c) => (c.className || "").includes("ticker-feed__identity"));
    assert.equal(identityDiv.children[0].tag, "a");
    assert.equal(identityDiv.children[1].tag, "a");
  });
});

test("mount/unmount lifecycle (no DOM emulation)", async (t) => {
  t.afterEach(() => unmount());

  function fakeContainer() {
    return {};
  }

  await t.test("renders loading synchronously, then the fetch result once it resolves", async () => {
    const renders = [];
    const render = (target, spec) => renders.push(spec);
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render });

    assert.equal(renders.length, 1);
    assert.ok(findByClassName(renders[0], "ticker-page__loading"));

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(renders.length, 2);
    assert.ok(findByClassName(renders[1], "ticker-feed"));
  });

  await t.test("throws on a second mount() without an intervening unmount()", () => {
    const render = () => {};
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render });
    assert.throws(() => mount(fakeContainer(), { fetchImpl, render }), /already mounted/);
  });

  await t.test("unmount() before any mount() is a safe no-op", () => {
    assert.doesNotThrow(() => unmount());
  });

  await t.test("unmount() clears the container by rendering an empty page shell (cleanup on unmount)", async () => {
    const renders = [];
    const render = (target, spec) => renders.push(spec);
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(renders.length, 2);

    unmount();
    assert.equal(renders.length, 3);
    assert.equal(renders[2].className, "ticker-page");
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
      const oldRender = (target, spec) => oldRenders.push(spec);

      mount(fakeContainer(), { fetchImpl: oldFetchImpl, render: oldRender });
      assert.equal(oldRenders.length, 1);

      unmount();

      const newRenders = [];
      const newRender = (target, spec) => newRenders.push(spec);
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

  await t.test("the very first successful render never marks any entry as new, even though nothing was seen before", async () => {
    const renders = [];
    const render = (target, spec) => renders.push(spec);
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const glowing = findAllByClassName(renders[1], "ticker-feed__entry--new");
    assert.equal(glowing.length, 0);
  });

  await t.test("a genuinely new entry on a later poll is marked --new; entries seen before are not", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      const liveTicker = call >= 2 ? [CAROL_ENTRY, ...STABLE_LIVE_TICKER] : STABLE_LIVE_TICKER;
      const payload = fullPayload({ live_ticker: liveTicker });
      return { ok: true, status: 200, json: async () => payload };
    };

    const renders = [];
    const render = (target, spec) => renders.push(spec);
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    mount(fakeContainer(), { fetchImpl, render, intervalMs: 1000 });
    await flush();
    await flush();
    assert.equal(renders.length, 2);

    t.mock.timers.tick(1000);
    await flush();
    await flush();
    assert.equal(renders.length, 3);

    const secondPollEntries = findAllByClassName(renders[2], "ticker-feed__entry");
    assert.equal(secondPollEntries.length, 3);
    assert.equal(secondPollEntries[0].className, "ticker-feed__entry ticker-feed__entry--new");
    assert.equal(entryIdentity(secondPollEntries[0]).username, "carol");
    assert.equal(secondPollEntries[1].className, "ticker-feed__entry", "alice was already present -- not new");
    assert.equal(secondPollEntries[2].className, "ticker-feed__entry", "bob was already present -- not new");

    t.mock.timers.tick(1000);
    await flush();
    await flush();
    assert.equal(renders.length, 4);

    const thirdPollEntries = findAllByClassName(renders[3], "ticker-feed__entry");
    assert.equal(
      thirdPollEntries[0].className,
      "ticker-feed__entry",
      "carol was already seen on the previous poll -- must not glow a second time",
    );
  });

  await t.test("the announcer node's textContent stays empty through the first successful render, and reuse is not requested yet", async () => {
    const renderCalls = [];
    const announcer = fakeAnnouncerNode();
    const render = (target, spec, opts) => {
      renderCalls.push(opts);
      return { announcerNode: announcer };
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    mount(fakeContainer(), { fetchImpl, render });
    await flush();
    await flush();

    assert.equal(announcer.textContent, "", "nothing has 'arrived' on a first paint -- there is nothing to announce");
    assert.equal(renderCalls.length, 2);
    assert.equal(renderCalls[0].reuseAnnouncerNode, null, "the loading render has no prior announcer to reuse");
    assert.equal(renderCalls[1].reuseAnnouncerNode, null, "loading -> success is a first paint, not a same-status re-render");
  });

  await t.test(
    "a genuinely new entry's announcement text is set on the persisted announcer node, and reuse is requested from the second success render onward",
    async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });

      let call = 0;
      const fetchImpl = async () => {
        call += 1;
        const liveTicker = call >= 2 ? [CAROL_ENTRY, ...STABLE_LIVE_TICKER] : STABLE_LIVE_TICKER;
        const payload = fullPayload({ live_ticker: liveTicker });
        return { ok: true, status: 200, json: async () => payload };
      };

      const renderCalls = [];
      const announcer = fakeAnnouncerNode();
      const render = (target, spec, opts) => {
        renderCalls.push(opts);
        return { announcerNode: announcer };
      };
      const flush = () => new Promise((resolve) => setImmediate(resolve));

      mount(fakeContainer(), { fetchImpl, render, intervalMs: 1000 });
      await flush();
      await flush();
      assert.equal(announcer.textContent, "");

      t.mock.timers.tick(1000);
      await flush();
      await flush();

      assert.equal(announcer.textContent, "New best share by carol on rig3.");
      assert.equal(
        renderCalls[2].reuseAnnouncerNode,
        announcer,
        "the second success render must request reuse of the same announcer node the previous render returned",
      );

      t.mock.timers.tick(1000);
      await flush();
      await flush();

      assert.equal(announcer.textContent, "", "carol was already seen on the previous poll -- nothing new to announce");
    },
  );

  await t.test("no polling is started when intervalMs is omitted", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    let renderCount = 0;
    const render = () => {
      renderCount += 1;
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
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => fullPayload() });

    mount(fakeContainer(), { fetchImpl, render, staleAfterMs: NaN });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(renderCount, 2);
  });

  await t.test("mount() writes the fetched payload into core/state.js", async () => {
    const render = () => {};
    const payload = fullPayload();
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => payload });

    mount(fakeContainer(), { fetchImpl, render });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(getState().analytics, payload);
    assert.equal(typeof getState().analyticsFetchedAt, "string");
  });
});
