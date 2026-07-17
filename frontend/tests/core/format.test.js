import test from "node:test";
import assert from "node:assert/strict";
import {
  formatSdiff,
  formatPercentage,
  formatTimestamp,
  formatRelativeTime,
} from "../../src/core/format.js";

test("formatSdiff", async (t) => {
  await t.test("formats with thousands separators", () => {
    assert.equal(formatSdiff(12345), "12,345");
  });
  await t.test("rounds to at most 2 fraction digits", () => {
    assert.equal(formatSdiff(1000.5), "1,000.5");
    assert.equal(formatSdiff(1000.567), "1,000.57");
  });
  await t.test("returns null for null/undefined/NaN", () => {
    assert.equal(formatSdiff(null), null);
    assert.equal(formatSdiff(undefined), null);
    assert.equal(formatSdiff(NaN), null);
  });
  await t.test("returns null for wrong-type input", () => {
    assert.equal(formatSdiff("12345"), null);
    assert.equal(formatSdiff({}), null);
    assert.equal(formatSdiff([1, 2]), null);
  });
  await t.test("returns null for Infinity/-Infinity, not a rendered symbol", () => {
    assert.equal(formatSdiff(Infinity), null);
    assert.equal(formatSdiff(-Infinity), null);
  });
  await t.test("formats zero as zero, not null", () => {
    assert.equal(formatSdiff(0), "0");
  });
});

test("formatPercentage", async (t) => {
  await t.test("adds a + sign for positive values", () => {
    assert.equal(formatPercentage(12.34), "+12.3%");
  });
  await t.test("keeps the - sign for negative values, no extra +", () => {
    assert.equal(formatPercentage(-5.2), "-5.2%");
  });
  await t.test("zero gets no sign", () => {
    assert.equal(formatPercentage(0), "0.0%");
  });
  await t.test("rounds to 1 decimal", () => {
    assert.equal(formatPercentage(0.05), "+0.1%");
  });
  await t.test("returns null for null/undefined/NaN/wrong-type", () => {
    assert.equal(formatPercentage(null), null);
    assert.equal(formatPercentage(undefined), null);
    assert.equal(formatPercentage(NaN), null);
    assert.equal(formatPercentage("12"), null);
  });
  await t.test("returns null for Infinity/-Infinity, not a rendered symbol", () => {
    assert.equal(formatPercentage(Infinity), null);
    assert.equal(formatPercentage(-Infinity), null);
  });
});

test("formatTimestamp", async (t) => {
  await t.test("formats a valid ISO string as HH:MM, 24h", () => {
    // Uses the host's local timezone, matching formatTimestamp's own
    // "Absolute local time" contract (format.js) -- this test derives
    // its expected value with the identical un-timezoned formatter
    // call, so it passes regardless of the host's timezone, but it is
    // not a UTC/timezone-stability test.
    const iso = "2026-07-17T09:41:00Z";
    const date = new Date(iso);
    const expected = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
    assert.equal(formatTimestamp(iso), expected);
  });
  await t.test('returns null for the "unknown" sentinel', () => {
    assert.equal(formatTimestamp("unknown"), null);
  });
  await t.test("returns null for null/undefined/malformed strings", () => {
    assert.equal(formatTimestamp(null), null);
    assert.equal(formatTimestamp(undefined), null);
    assert.equal(formatTimestamp("not-a-date"), null);
  });
});

test("formatRelativeTime", async (t) => {
  const now = new Date("2026-07-17T12:00:00Z");

  await t.test("just now for very recent timestamps", () => {
    assert.equal(formatRelativeTime(now.toISOString(), now), "just now");
    const thirtySecAgo = new Date(now.getTime() - 30_000).toISOString();
    assert.equal(formatRelativeTime(thirtySecAgo, now), "just now");
  });

  await t.test("minutes ago", () => {
    const twoMinAgo = new Date(now.getTime() - 2 * 60_000).toISOString();
    assert.equal(formatRelativeTime(twoMinAgo, now), "2m ago");
    const fiftyNineMinAgo = new Date(now.getTime() - 59 * 60_000).toISOString();
    assert.equal(formatRelativeTime(fiftyNineMinAgo, now), "59m ago");
  });

  await t.test("hours ago", () => {
    const oneHrFiveAgo = new Date(now.getTime() - 65 * 60_000).toISOString();
    assert.equal(formatRelativeTime(oneHrFiveAgo, now), "1h ago");
    const twentyThreeHrAgo = new Date(now.getTime() - 23 * 3600_000).toISOString();
    assert.equal(formatRelativeTime(twentyThreeHrAgo, now), "23h ago");
  });

  await t.test("days ago", () => {
    const twoDaysAgo = new Date(now.getTime() - 2 * 86400_000).toISOString();
    assert.equal(formatRelativeTime(twoDaysAgo, now), "2d ago");
  });

  await t.test("small future clock skew still reads as just now", () => {
    const thirtySecFuture = new Date(now.getTime() + 30_000).toISOString();
    assert.equal(formatRelativeTime(thirtySecFuture, now), "just now");
  });

  await t.test("large future timestamps return null, not just now", () => {
    const oneHourFuture = new Date(now.getTime() + 3600_000).toISOString();
    assert.equal(formatRelativeTime(oneHourFuture, now), null);
  });

  await t.test('returns null for "unknown", null, malformed', () => {
    assert.equal(formatRelativeTime("unknown", now), null);
    assert.equal(formatRelativeTime(null, now), null);
    assert.equal(formatRelativeTime("garbage", now), null);
  });
});
