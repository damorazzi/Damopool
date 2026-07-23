// Independent adversarial pass on formatProgressPercent/
// formatStillNeededMultiplier (Phase E Milestone 30: Block Progress
// Analytics), complementing frontend/tests/core/format.test.js's own
// coverage. Written by an independent test engineer -- targets the exact
// gaps called out in the test brief: the 0.9999/1.0001 boundary
// (confirming which side of "1" gets which precision, and that the
// implementation is self-consistent about it), negative-value crash
// safety, very large percentages, exact half-integer rounding behavior of
// Math.round (round-half-up-towards-+Infinity, NOT banker's rounding),
// and toLocaleString thousands-separator behavior at several magnitudes.

import test from "node:test";
import assert from "node:assert/strict";
import { formatProgressPercent, formatStillNeededMultiplier } from "../../src/core/format.js";

test("formatProgressPercent -- boundary and edge behavior", async (t) => {
  await t.test("exactly 1.0 is on the >=1 side (2 decimals), self-consistent with the documented rule", () => {
    // format.js's own rule: `Math.abs(value) < 1 ? 4 : 2`. At value === 1,
    // `1 < 1` is false, so this must land on the 2-decimal branch.
    assert.equal(formatProgressPercent(1.0), "1.00%");
  });

  await t.test("a value just below 1 uses 4 decimals", () => {
    assert.equal(formatProgressPercent(0.9999), "0.9999%");
  });

  await t.test("a value just above 1 uses 2 decimals", () => {
    assert.equal(formatProgressPercent(1.0001), "1.00%");
  });

  await t.test("negative values do not crash (backend guards should prevent these in practice)", () => {
    assert.equal(formatProgressPercent(-5), "-5.00%");
    assert.equal(formatProgressPercent(-0.5), "-0.5000%");
  });

  await t.test("large percentages (>100%) format with 2 decimals, uncapped", () => {
    assert.equal(formatProgressPercent(500), "500.00%");
    assert.equal(formatProgressPercent(123456.789), "123456.79%");
  });

  await t.test("exactly 0 is on the <1 side (4 decimals)", () => {
    assert.equal(formatProgressPercent(0), "0.0000%");
  });

  await t.test("wrong types (object/array/boolean) return null, never throw", () => {
    assert.equal(formatProgressPercent({}), null);
    assert.equal(formatProgressPercent([1, 2]), null);
    assert.equal(formatProgressPercent(true), null);
  });
});

test("formatStillNeededMultiplier -- rounding and magnitude behavior", async (t) => {
  await t.test("Math.round rounds .5 up towards +Infinity, not banker's rounding -- confirm actual JS semantics", () => {
    // JS Math.round(2.5) === 3, Math.round(-2.5) === -2 (rounds towards
    // +Infinity on ties, unlike IEEE round-half-to-even/"banker's
    // rounding"). This is a language-semantics fact worth pinning down
    // with an explicit test rather than assuming.
    assert.equal(Math.round(2.5), 3);
    assert.equal(Math.round(-2.5), -2);
    assert.equal(formatStillNeededMultiplier(2.5), "×3");
  });

  await t.test("0 formats as ×0", () => {
    assert.equal(formatStillNeededMultiplier(0), "×0");
  });

  await t.test("negative values do not crash (backend guards should prevent these in practice)", () => {
    assert.equal(formatStillNeededMultiplier(-5), "×-5");
  });

  await t.test("thousands separators at several magnitudes", () => {
    assert.equal(formatStillNeededMultiplier(999), "×999");
    assert.equal(formatStillNeededMultiplier(1000), "×1,000");
    assert.equal(formatStillNeededMultiplier(999999), "×999,999");
    assert.equal(formatStillNeededMultiplier(1000000), "×1,000,000");
    assert.equal(formatStillNeededMultiplier(1234567890), "×1,234,567,890");
  });

  await t.test("wrong types (object/array/boolean) return null, never throw", () => {
    assert.equal(formatStillNeededMultiplier({}), null);
    assert.equal(formatStillNeededMultiplier([1, 2]), null);
    assert.equal(formatStillNeededMultiplier(true), null);
  });
});
