import test from "node:test";
import assert from "node:assert/strict";
import {
  formatSdiff,
  formatCompactSdiff,
  formatHashrate,
  formatPercentage,
  formatTimestamp,
  formatRelativeTime,
  truncateAddress,
  truncateWorkername,
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

test("formatCompactSdiff (Phase E Milestone 25)", async (t) => {
  await t.test("matches the exact examples this was specified against", () => {
    assert.equal(formatCompactSdiff(1000000), "1M");
    assert.equal(formatCompactSdiff(2500000000), "2.5G");
  });
  await t.test("trims trailing zeros but keeps meaningful precision", () => {
    assert.equal(formatCompactSdiff(82493037.86), "82.49M");
    assert.equal(formatCompactSdiff(1500), "1.5K");
  });
  await t.test("values below 1000 have no unit suffix, still trimmed", () => {
    assert.equal(formatCompactSdiff(500), "500");
    assert.equal(formatCompactSdiff(500.567), "500.57");
  });
  await t.test("a value that rounds up to the next unit's threshold promotes correctly, rather than displaying the wrong unit (Code Review finding, round 1)", () => {
    // The unit is chosen from the UNROUNDED value; toFixed(2) can then
    // round a near-boundary value (e.g. 999999.9, picked as "K") up to
    // "1000.00" at that unit -- which must promote to display "1M",
    // not the misleading "1000K". None of this test block's original
    // assertions used a near-boundary value, only exact powers of ten,
    // so this bug shipped undetected in round 1.
    assert.equal(formatCompactSdiff(999999.9), "1M");
    assert.equal(formatCompactSdiff(999995), "1M");
    assert.equal(formatCompactSdiff(999999.99), "1M");
    // The same promotion applies below the first unit threshold too --
    // a sub-1000 value that rounds up to exactly 1000 promotes to "1K"
    // rather than displaying the unit-less "1000".
    assert.equal(formatCompactSdiff(999.999), "1K");
    assert.equal(formatCompactSdiff(999.995), "1K");
    // A value close to but not reaching the threshold must NOT promote.
    assert.equal(formatCompactSdiff(999949), "999.95K");
    assert.equal(formatCompactSdiff(999950), "999.95K");
    // Promotion applies at every unit boundary, not just K->M, and
    // correctly preserves sign.
    assert.equal(formatCompactSdiff(999999999999.9), "1T");
    assert.equal(formatCompactSdiff(-999999.9), "-1M");
  });
  await t.test("zero formats as \"0\", not null or empty string", () => {
    assert.equal(formatCompactSdiff(0), "0");
  });
  await t.test("negative values keep their sign", () => {
    assert.equal(formatCompactSdiff(-2500000000), "-2.5G");
  });
  await t.test("scales correctly through every unit (K/M/G/T/P)", () => {
    assert.equal(formatCompactSdiff(1e3), "1K");
    assert.equal(formatCompactSdiff(1e6), "1M");
    assert.equal(formatCompactSdiff(1e9), "1G");
    assert.equal(formatCompactSdiff(1e12), "1T");
    assert.equal(formatCompactSdiff(1e15), "1P");
  });
  await t.test("returns null for null/undefined/NaN/Infinity/wrong-type, matching formatSdiff's own contract", () => {
    assert.equal(formatCompactSdiff(null), null);
    assert.equal(formatCompactSdiff(undefined), null);
    assert.equal(formatCompactSdiff(NaN), null);
    assert.equal(formatCompactSdiff(Infinity), null);
    assert.equal(formatCompactSdiff("12345"), null);
  });
});

test("formatHashrate (Phase E Milestone 28)", async (t) => {
  await t.test("matches the exact examples this was specified against, same K/M/G/T convention as sdiff formatting", () => {
    assert.equal(formatHashrate(1000), "1K");
    assert.equal(formatHashrate(1500000), "1.5M");
    assert.equal(formatHashrate(2500000000), "2.5G");
    assert.equal(formatHashrate(6800000000000), "6.8T");
  });

  await t.test("Human decision: shares one implementation with formatCompactSdiff, not a second formatting style -- identical output for the same input, across every unit and edge case", () => {
    const values = [0, 500, 999.999, 999999.9, 1e3, 1e6, 1e9, 1e12, 1e15, -2500000000, 82493037.86];
    for (const value of values) {
      assert.equal(formatHashrate(value), formatCompactSdiff(value), `mismatch for ${value}`);
    }
  });

  await t.test("returns null for null/undefined/NaN/Infinity/wrong-type, matching every other formatter's contract", () => {
    assert.equal(formatHashrate(null), null);
    assert.equal(formatHashrate(undefined), null);
    assert.equal(formatHashrate(NaN), null);
    assert.equal(formatHashrate(Infinity), null);
    assert.equal(formatHashrate("13.4T"), null);
  });
});

test("truncateAddress (Phase E Milestone 25)", async (t) => {
  await t.test("shortens a long address to the first 7 characters plus an ellipsis", () => {
    assert.equal(truncateAddress("bc1qmleyaz5gj0fxsayvk7mrgfcx8rel0qnscwnm88"), "bc1qmle…");
  });
  await t.test("leaves a short value unchanged", () => {
    assert.equal(truncateAddress("alice"), "alice");
  });
  await t.test("a value exactly at the length boundary is not truncated", () => {
    assert.equal(truncateAddress("1234567"), "1234567");
    assert.equal(truncateAddress("12345678"), "1234567…");
  });
  await t.test("length is configurable", () => {
    assert.equal(truncateAddress("abcdefghij", 3), "abc…");
  });
  await t.test("a non-string value passes through unchanged rather than throwing", () => {
    assert.equal(truncateAddress(null), null);
    assert.equal(truncateAddress(undefined), undefined);
  });
});

test("truncateWorkername (Phase E Milestone 25)", async (t) => {
  await t.test("truncates only the address portion, keeping the worker label intact", () => {
    assert.equal(
      truncateWorkername("bc1qmleyaz5gj0fxsayvk7mrgfcx8rel0qnscwnm88.OctaxeDamo"),
      "bc1qmle…OctaxeDamo",
    );
  });
  await t.test("no dot present -- falls back to truncateAddress's own whole-string behaviour", () => {
    assert.equal(truncateWorkername("rig1"), "rig1");
    assert.equal(truncateWorkername("bc1qmleyaz5gj0fxsayvk7mrgfcx8rel0qnscwnm88"), "bc1qmle…");
  });
  await t.test("an already-short address portion is left fully unchanged, dot included", () => {
    assert.equal(truncateWorkername("short.label"), "short.label");
  });
  await t.test("the address portion exactly at the length boundary is not truncated", () => {
    assert.equal(truncateWorkername("1234567.label"), "1234567.label");
  });
  await t.test("only the first dot splits address from label -- a label containing its own dot is preserved verbatim", () => {
    assert.equal(
      truncateWorkername("bc1qmleyaz5gj0fxsayvk7mrgfcx8rel0qnscwnm88.rig.1"),
      "bc1qmle…rig.1",
    );
  });
  await t.test("a non-string value passes through unchanged rather than throwing", () => {
    assert.equal(truncateWorkername(null), null);
    assert.equal(truncateWorkername(undefined), undefined);
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
