import test from "node:test";
import assert from "node:assert/strict";
import { FEED_EVENT_TYPES, deriveFeedEvents, accumulateFeedEvents } from "../../src/shell/live-feed-events.js";

function basePayload(overrides = {}) {
  return {
    metadata: { schema_version: "1.1", generated_at: new Date().toISOString() },
    pool: {
      best_share_today: { username: "alice", workername: "alice.rig1", sdiff: 400, timestamp: "2026-07-20T00:00:00+00:00" },
      best_share_ever: { username: "alice", workername: "alice.rig1", sdiff: 2048, timestamp: "2026-07-19T00:00:00+00:00" },
    },
    users: { alice: {} },
    workers: { "alice.rig1": {} },
    daily_bests: {},
    live_ticker: [],
    ...overrides,
  };
}

test("FEED_EVENT_TYPES", async (t) => {
  await t.test("only registers the five Human-approved event types, each with a priority", () => {
    assert.deepEqual(Object.keys(FEED_EVENT_TYPES).sort(), [
      "best_ever",
      "best_today",
      "new_user",
      "new_worker",
      "personal_best",
    ]);
    assert.equal(FEED_EVENT_TYPES.personal_best.priority, 1);
    assert.equal(FEED_EVENT_TYPES.best_ever.priority, 1);
    assert.equal(FEED_EVENT_TYPES.best_today.priority, 3);
    assert.equal(FEED_EVENT_TYPES.new_user.priority, 3);
    assert.equal(FEED_EVENT_TYPES.new_worker.priority, 3);
  });
});

test("deriveFeedEvents", async (t) => {
  await t.test("first call (no previous snapshot), no live_ticker entries: establishes a baseline with zero events, never treats existing best_ever/best_today/users/workers as new", () => {
    const { newEvents, snapshot } = deriveFeedEvents(basePayload(), null);
    assert.deepEqual(newEvents, []);
    assert.equal(snapshot.bestEverKey, "2026-07-19T00:00:00+00:00|2048");
    assert.equal(snapshot.bestTodayKey, "2026-07-20T00:00:00+00:00|400");
    assert.ok(snapshot.userKeys.has("alice"));
    assert.ok(snapshot.workerKeys.has("alice.rig1"));
  });

  await t.test("Code Review fix: first call WITH live_ticker entries seeds newEvents from them (the feed must not start empty when real recent activity already exists)", () => {
    const payload = basePayload({
      live_ticker: [
        {
          username: "alice",
          workername: "alice.rig1",
          current_daily_best: { sdiff: 999, timestamp: "2026-07-21T02:00:00+00:00" },
          previous_daily_best: null,
          timestamp: "2026-07-21T02:00:00+00:00",
        },
      ],
    });
    const { newEvents } = deriveFeedEvents(payload, null);
    assert.equal(newEvents.length, 1);
    assert.equal(newEvents[0].type, "personal_best");
    assert.equal(newEvents[0].href, "#/workers/alice.rig1");
    assert.equal(newEvents[0].timestamp, "2026-07-21T02:00:00+00:00");
  });

  await t.test("first call never seeds best_ever/best_today/new_user/new_worker, only personal_best from live_ticker", () => {
    const payload = basePayload({
      live_ticker: [
        {
          username: "alice",
          workername: "alice.rig1",
          current_daily_best: { sdiff: 999, timestamp: "2026-07-21T02:00:00+00:00" },
          previous_daily_best: null,
          timestamp: "2026-07-21T02:00:00+00:00",
        },
      ],
    });
    const { newEvents } = deriveFeedEvents(payload, null);
    assert.deepEqual(
      newEvents.map((e) => e.type),
      ["personal_best"],
    );
  });

  await t.test("Code Review fix: an empty-string key in payload.users/payload.workers is filtered out, not passed to buildHash (which would throw)", () => {
    const { snapshot } = deriveFeedEvents(basePayload(), null);
    const next = basePayload({
      users: { alice: {}, "": {} },
      workers: { "alice.rig1": {}, "": {} },
    });
    assert.doesNotThrow(() => deriveFeedEvents(next, snapshot));
    const { newEvents } = deriveFeedEvents(next, snapshot);
    assert.equal(newEvents.find((e) => e.type === "new_user" && e.detail === ""), undefined);
    assert.equal(newEvents.find((e) => e.type === "new_worker" && e.detail === ""), undefined);
  });

  await t.test("an unchanged payload between two polls yields zero events", () => {
    const payload = basePayload();
    const { snapshot } = deriveFeedEvents(payload, null);
    const { newEvents } = deriveFeedEvents(payload, snapshot);
    assert.deepEqual(newEvents, []);
  });

  await t.test("a changed pool.best_share_ever fires a best_ever event routed to the Pool page", () => {
    const { snapshot } = deriveFeedEvents(basePayload(), null);
    const next = basePayload({
      pool: {
        best_share_today: basePayload().pool.best_share_today,
        best_share_ever: { username: "bob", workername: "bob.rig9", sdiff: 999999, timestamp: "2026-07-21T00:00:00+00:00" },
      },
    });
    const { newEvents } = deriveFeedEvents(next, snapshot);
    const event = newEvents.find((e) => e.type === "best_ever");
    assert.ok(event, "expected a best_ever event");
    assert.equal(event.href, "#/pool");
    assert.equal(event.detail, "bob.rig9");
    assert.equal(event.timestamp, "2026-07-21T00:00:00+00:00");
  });

  await t.test("a changed pool.best_share_today fires a best_today event, also routed to the Pool page", () => {
    const { snapshot } = deriveFeedEvents(basePayload(), null);
    const next = basePayload({
      pool: {
        best_share_ever: basePayload().pool.best_share_ever,
        best_share_today: { username: "carol", workername: "carol.rig2", sdiff: 5000, timestamp: "2026-07-21T01:00:00+00:00" },
      },
    });
    const { newEvents } = deriveFeedEvents(next, snapshot);
    const event = newEvents.find((e) => e.type === "best_today");
    assert.ok(event, "expected a best_today event");
    assert.equal(event.href, "#/pool");
    assert.equal(event.detail, "carol.rig2");
  });

  await t.test("a new key in payload.users fires a new_user event routed to User Detail, with no fabricated timestamp", () => {
    const { snapshot } = deriveFeedEvents(basePayload(), null);
    const next = basePayload({ users: { alice: {}, dave: {} } });
    const { newEvents } = deriveFeedEvents(next, snapshot);
    const event = newEvents.find((e) => e.type === "new_user");
    assert.ok(event, "expected a new_user event");
    assert.equal(event.href, "#/users/dave");
    assert.equal(event.detail, "dave");
    assert.equal(event.timestamp, null);
  });

  await t.test("a new key in payload.workers fires a new_worker event routed to Worker Detail", () => {
    const { snapshot } = deriveFeedEvents(basePayload(), null);
    const next = basePayload({ workers: { "alice.rig1": {}, "alice.rig2": {} } });
    const { newEvents } = deriveFeedEvents(next, snapshot);
    const event = newEvents.find((e) => e.type === "new_worker");
    assert.ok(event, "expected a new_worker event");
    assert.equal(event.href, "#/workers/alice.rig2");
    assert.equal(event.timestamp, null);
  });

  await t.test("a new live_ticker entry fires a personal_best event routed to Worker Detail", () => {
    const { snapshot } = deriveFeedEvents(basePayload(), null);
    const next = basePayload({
      live_ticker: [
        {
          username: "alice",
          workername: "alice.rig1",
          current_daily_best: { sdiff: 999, timestamp: "2026-07-21T02:00:00+00:00" },
          previous_daily_best: null,
          timestamp: "2026-07-21T02:00:00+00:00",
        },
      ],
    });
    const { newEvents } = deriveFeedEvents(next, snapshot);
    const event = newEvents.find((e) => e.type === "personal_best");
    assert.ok(event, "expected a personal_best event");
    assert.equal(event.href, "#/workers/alice.rig1");
    assert.equal(event.timestamp, "2026-07-21T02:00:00+00:00");
  });

  await t.test("Human-reported bug, fixed: a personal_best event carries currentSdiff/previousSdiff/improvementPercentage, not just the identity fields", () => {
    const { snapshot } = deriveFeedEvents(basePayload(), null);
    const next = basePayload({
      live_ticker: [
        {
          username: "alice",
          workername: "alice.rig1",
          current_daily_best: { sdiff: 999, timestamp: "2026-07-21T02:00:00+00:00" },
          previous_daily_best: { sdiff: 400, timestamp: "2026-07-20T00:00:00+00:00" },
          improvement_amount: 599,
          improvement_percentage: 149.75,
          timestamp: "2026-07-21T02:00:00+00:00",
        },
      ],
    });
    const { newEvents } = deriveFeedEvents(next, snapshot);
    const event = newEvents.find((e) => e.type === "personal_best");
    assert.equal(event.currentSdiff, 999);
    assert.equal(event.previousSdiff, 400);
    assert.equal(event.improvementPercentage, 149.75);
  });

  await t.test("a personal_best event with no previous daily best (first best of the day) carries previousSdiff/improvementPercentage as null, not a throw or a fabricated value", () => {
    const { snapshot } = deriveFeedEvents(basePayload(), null);
    const next = basePayload({
      live_ticker: [
        {
          username: "alice",
          workername: "alice.rig1",
          current_daily_best: { sdiff: 999, timestamp: "2026-07-21T02:00:00+00:00" },
          previous_daily_best: null,
          improvement_amount: null,
          improvement_percentage: null,
          timestamp: "2026-07-21T02:00:00+00:00",
        },
      ],
    });
    const { newEvents } = deriveFeedEvents(next, snapshot);
    const event = newEvents.find((e) => e.type === "personal_best");
    assert.equal(event.currentSdiff, 999);
    assert.equal(event.previousSdiff, null);
    assert.equal(event.improvementPercentage, null);
  });

  await t.test("Human-reported bug, fixed: best_ever/best_today events carry currentSdiff, and deliberately null previousSdiff/improvementPercentage -- no 'previous' value exists in analytics.json to compare against without fabricating one", () => {
    const { snapshot } = deriveFeedEvents(basePayload(), null);
    const next = basePayload({
      pool: {
        best_share_today: basePayload().pool.best_share_today,
        best_share_ever: { username: "bob", workername: "bob.rig9", sdiff: 999999, timestamp: "2026-07-21T00:00:00+00:00" },
      },
    });
    const { newEvents } = deriveFeedEvents(next, snapshot);
    const event = newEvents.find((e) => e.type === "best_ever");
    assert.equal(event.currentSdiff, 999999);
    assert.equal(event.previousSdiff, null);
    assert.equal(event.improvementPercentage, null);
  });

  await t.test("a malformed pool.best_share_ever (missing sdiff/timestamp) never throws and never fires an event", () => {
    const { snapshot } = deriveFeedEvents(basePayload(), null);
    const next = basePayload({ pool: { best_share_today: basePayload().pool.best_share_today, best_share_ever: {} } });
    assert.doesNotThrow(() => deriveFeedEvents(next, snapshot));
    const { newEvents } = deriveFeedEvents(next, snapshot);
    assert.equal(newEvents.find((e) => e.type === "best_ever"), undefined);
  });

  await t.test("a null payload never throws", () => {
    assert.doesNotThrow(() => deriveFeedEvents(null, null));
    const { snapshot } = deriveFeedEvents(null, null);
    assert.equal(snapshot.bestEverKey, null);
    assert.equal(snapshot.userKeys.size, 0);
  });
});

test("accumulateFeedEvents", async (t) => {
  await t.test("prepends new events ahead of existing ones", () => {
    const existing = [{ type: "new_user", detail: "old" }];
    const fresh = [{ type: "new_worker", detail: "new" }];
    const result = accumulateFeedEvents(existing, fresh, 10);
    assert.deepEqual(result, [{ type: "new_worker", detail: "new" }, { type: "new_user", detail: "old" }]);
  });

  await t.test("caps the total length at maxLength, dropping the oldest", () => {
    const existing = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const fresh = [{ id: 4 }];
    const result = accumulateFeedEvents(existing, fresh, 3);
    assert.deepEqual(result, [{ id: 4 }, { id: 1 }, { id: 2 }]);
  });

  await t.test("throws on a non-positive-integer maxLength", () => {
    assert.throws(() => accumulateFeedEvents([], [], 0), TypeError);
    assert.throws(() => accumulateFeedEvents([], [], -1), TypeError);
    assert.throws(() => accumulateFeedEvents([], [], 1.5), TypeError);
  });
});
