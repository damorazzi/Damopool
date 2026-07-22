import test from "node:test";
import assert from "node:assert/strict";
import { transformTickerData, tickerEntryKey, markNewEntries } from "../../src/core/live-ticker.js";

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
