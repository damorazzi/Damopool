import test from "node:test";
import assert from "node:assert/strict";
import { liveFeedSpec } from "../../src/components/live-feed.js";
import { truncateAddress, truncateWorkername } from "../../src/core/format.js";

function findAllByClassName(spec, className) {
  const results = [];
  (function walk(node) {
    if (!node || typeof node !== "object") return;
    const classes = (node.className || "").split(" ");
    if (classes.includes(className)) results.push(node);
    for (const child of node.children || []) walk(child);
  })(spec);
  return results;
}

function findByClassName(spec, className) {
  return findAllByClassName(spec, className)[0] || null;
}

function sampleEvent(overrides = {}) {
  return {
    type: "personal_best",
    timestamp: "2026-07-21T00:00:00+00:00",
    href: "#/workers/alice.rig1",
    detail: "alice.rig1",
    ...overrides,
  };
}

test("liveFeedSpec", async (t) => {
  await t.test("no events: shows the calm empty message, not an empty scrolling track", () => {
    const spec = liveFeedSpec({ events: [] });
    assert.ok(findByClassName(spec, "live-feed__empty"));
    assert.equal(findByClassName(spec, "live-feed__viewport"), null);
  });

  await t.test("carries an aria-label identifying the region", () => {
    const spec = liveFeedSpec({ events: [] });
    assert.equal(spec.attrs["aria-label"], "Live pool activity");
  });

  await t.test("has a visually-hidden aria-live announcer, matching ticker-feed.js's established pattern", () => {
    const spec = liveFeedSpec({ events: [] });
    const announcer = findByClassName(spec, "live-feed__announcer");
    assert.ok(announcer);
    assert.equal(announcer.className, "live-feed__announcer visually-hidden");
    assert.equal(announcer.attrs["aria-live"], "polite");
  });

  await t.test("with events: the track renders each event twice (real copy + aria-hidden duplicate) for the seamless CSS loop", () => {
    const spec = liveFeedSpec({ events: [sampleEvent()] });
    const items = findAllByClassName(spec, "live-feed__item");
    assert.equal(items.length, 2);
  });

  await t.test("the duplicate <li> carries its own modifier class so reduced-motion CSS can hide it outright", () => {
    const spec = liveFeedSpec({ events: [sampleEvent()] });
    const items = findAllByClassName(spec, "live-feed__item");
    assert.equal(items[0].className, "live-feed__item live-feed__item--priority-1");
    assert.equal(items[1].className, "live-feed__item live-feed__item--priority-1 live-feed__item--duplicate");
  });

  await t.test("the real copy is focusable and not aria-hidden; the duplicate is aria-hidden and unfocusable", () => {
    const spec = liveFeedSpec({ events: [sampleEvent()] });
    const links = findAllByClassName(spec, "live-feed__link");
    assert.equal(links.length, 2);
    const [real, duplicate] = links;
    assert.equal(real.attrs["aria-hidden"], undefined);
    assert.equal(real.attrs.tabindex, undefined);
    assert.equal(duplicate.attrs["aria-hidden"], "true");
    assert.equal(duplicate.attrs.tabindex, "-1");
  });

  await t.test("each item links to event.href, exactly as supplied (already buildHash-encoded by the caller)", () => {
    const spec = liveFeedSpec({ events: [sampleEvent({ href: "#/users/weird%2Fname" })] });
    const link = findByClassName(spec, "live-feed__link");
    assert.equal(link.attrs.href, "#/users/weird%2Fname");
  });

  await t.test("renders the registered label and priority class for a known event type", () => {
    const spec = liveFeedSpec({ events: [sampleEvent({ type: "new_user" })] });
    const item = findByClassName(spec, "live-feed__item");
    assert.equal(item.className, "live-feed__item live-feed__item--priority-3");
    const label = findByClassName(spec, "live-feed__label");
    assert.equal(label.text, "New User");
  });

  await t.test("personal_best and best_ever are priority 1", () => {
    const bestEver = findByClassName(liveFeedSpec({ events: [sampleEvent({ type: "best_ever" })] }), "live-feed__item");
    assert.equal(bestEver.className, "live-feed__item live-feed__item--priority-1");
  });

  await t.test("an unrecognized event type falls back to priority 3 and its own type string as the label, rather than throwing", () => {
    const spec = liveFeedSpec({ events: [sampleEvent({ type: "totally_unknown" })] });
    const item = findByClassName(spec, "live-feed__item");
    assert.equal(item.className, "live-feed__item live-feed__item--priority-3");
    const label = findByClassName(spec, "live-feed__label");
    assert.equal(label.text, "totally_unknown");
  });

  await t.test("detail text (an attacker-influenceable username/workername) passes through as text, never markup", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const spec = liveFeedSpec({ events: [sampleEvent({ detail: raw })] });
    const detail = findByClassName(spec, "live-feed__detail");
    assert.equal(detail.text, truncateWorkername(raw));
    assert.equal(detail.tag, "span");
  });

  await t.test("Human-reported bug, fixed: a long workername-shaped detail (personal_best/best_ever/best_today/new_worker) is visually truncated via truncateWorkername, full value kept on the link's title/aria-label", () => {
    const long = "bc1qmleyaz5gj0fxsayvk7mrgfcx8rel0qnscwnm88.OctaxeDamo";
    for (const type of ["personal_best", "best_ever", "best_today", "new_worker"]) {
      const spec = liveFeedSpec({ events: [sampleEvent({ type, detail: long })] });
      const detail = findByClassName(spec, "live-feed__detail");
      assert.equal(detail.text, truncateWorkername(long), `type ${type}`);
      const link = findByClassName(spec, "live-feed__link");
      assert.ok(link.attrs.title.includes(long), `type ${type} title must carry the full value`);
      assert.ok(link.attrs["aria-label"].includes(long), `type ${type} aria-label must carry the full value`);
    }
  });

  await t.test("Human-reported bug, fixed: a long username-shaped detail (new_user) is visually truncated via truncateAddress instead, not truncateWorkername", () => {
    const long = "bc1qmleyaz5gj0fxsayvk7mrgfcx8rel0qnscwnm88";
    const spec = liveFeedSpec({ events: [sampleEvent({ type: "new_user", detail: long })] });
    const detail = findByClassName(spec, "live-feed__detail");
    assert.equal(detail.text, truncateAddress(long));
  });

  await t.test("the link's title/aria-label combine the event label and the full detail value, so a screen reader never reads the truncated ellipsis text instead", () => {
    const long = "bc1qmleyaz5gj0fxsayvk7mrgfcx8rel0qnscwnm88.OctaxeDamo";
    const spec = liveFeedSpec({ events: [sampleEvent({ type: "personal_best", detail: long })] });
    const link = findByClassName(spec, "live-feed__link");
    assert.equal(link.attrs.title, `New Personal Best: ${long}`);
    assert.equal(link.attrs["aria-label"], `New Personal Best: ${long}`);
  });

  await t.test("the duplicate (aria-hidden) copy carries no title -- it's already removed from the accessibility tree", () => {
    const spec = liveFeedSpec({ events: [sampleEvent({ detail: "bc1qmleyaz5gj0fxsayvk7mrgfcx8rel0qnscwnm88.OctaxeDamo" })] });
    const links = findAllByClassName(spec, "live-feed__link");
    assert.equal(links[1].attrs.title, undefined);
  });

  await t.test("Human-reported bug, fixed: a personal_best event with current/previous sdiff and a positive improvement shows both values plus a trend-up indicator", () => {
    const spec = liveFeedSpec({
      events: [sampleEvent({ type: "personal_best", currentSdiff: 999, previousSdiff: 400, improvementPercentage: 149.75 })],
    });
    const current = findByClassName(spec, "live-feed__current-best");
    const previous = findByClassName(spec, "live-feed__previous-best");
    const trendValue = findByClassName(spec, "live-feed__trend-value");
    assert.equal(current.text, "999");
    assert.equal(previous.text, "was 400");
    assert.equal(trendValue.text, "+149.8%");
    assert.ok(findByClassName(spec, "live-feed__trend"));
  });

  await t.test("no previousSdiff (first best of the day): shows the current sdiff, no 'was X' text, no trend indicator", () => {
    const spec = liveFeedSpec({
      events: [sampleEvent({ type: "personal_best", currentSdiff: 999, previousSdiff: null, improvementPercentage: null })],
    });
    assert.ok(findByClassName(spec, "live-feed__current-best"));
    assert.equal(findByClassName(spec, "live-feed__previous-best"), null);
    assert.equal(findByClassName(spec, "live-feed__trend"), null);
  });

  await t.test("an exactly-zero or negative improvementPercentage shows no trend indicator, matching user-detail.js's own 'no misleading up-arrow' rule", () => {
    const zero = liveFeedSpec({ events: [sampleEvent({ type: "personal_best", currentSdiff: 999, improvementPercentage: 0 })] });
    assert.equal(findByClassName(zero, "live-feed__trend"), null);
    const negative = liveFeedSpec({ events: [sampleEvent({ type: "personal_best", currentSdiff: 999, improvementPercentage: -10 })] });
    assert.equal(findByClassName(negative, "live-feed__trend"), null);
  });

  await t.test("best_ever/best_today show only the current sdiff -- no 'was X', no trend indicator, since analytics.json has no previous value for either", () => {
    for (const type of ["best_ever", "best_today"]) {
      const spec = liveFeedSpec({ events: [sampleEvent({ type, currentSdiff: 999999, previousSdiff: null, improvementPercentage: null })] });
      assert.ok(findByClassName(spec, "live-feed__current-best"), `type ${type}`);
      assert.equal(findByClassName(spec, "live-feed__previous-best"), null, `type ${type}`);
      assert.equal(findByClassName(spec, "live-feed__trend"), null, `type ${type}`);
    }
  });

  await t.test("new_user/new_worker (no sdiff data at all) show no stats block, no throw", () => {
    for (const type of ["new_user", "new_worker"]) {
      assert.doesNotThrow(() => liveFeedSpec({ events: [sampleEvent({ type })] }), `type ${type}`);
      const spec = liveFeedSpec({ events: [sampleEvent({ type })] });
      assert.equal(findByClassName(spec, "live-feed__current-best"), null, `type ${type}`);
    }
  });

  await t.test("the stats figures are included in the link's title/aria-label, not just the label and detail", () => {
    const spec = liveFeedSpec({
      events: [sampleEvent({ type: "personal_best", detail: "alice.rig1", currentSdiff: 999, previousSdiff: 400, improvementPercentage: 149.75 })],
    });
    const link = findByClassName(spec, "live-feed__link");
    assert.equal(link.attrs.title, "New Personal Best: alice.rig1, 999, was 400, +149.8%");
  });

  await t.test("icon span is aria-hidden -- the label text carries the meaning", () => {
    const spec = liveFeedSpec({ events: [sampleEvent()] });
    const icon = findByClassName(spec, "live-feed__icon");
    assert.equal(icon.attrs["aria-hidden"], "true");
  });

  await t.test("multiple events preserve order within each half of the duplicated track", () => {
    const events = [sampleEvent({ detail: "first" }), sampleEvent({ detail: "second" })];
    const spec = liveFeedSpec({ events });
    const details = findAllByClassName(spec, "live-feed__detail").map((n) => n.text);
    assert.deepEqual(details, ["first", "second", "first", "second"]);
  });
});
