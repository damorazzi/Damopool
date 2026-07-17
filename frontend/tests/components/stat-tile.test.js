import test from "node:test";
import assert from "node:assert/strict";
import { statTileSpec } from "../../src/components/stat-tile.js";

function findByClass(spec, className) {
  if (!spec || typeof spec !== "object") return null;
  if (spec.className === className) return spec;
  for (const child of spec.children || []) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}

test("statTileSpec", async (t) => {
  await t.test("is a Card variant (base class card, plus stat-tile)", () => {
    const spec = statTileSpec({ label: "Accepted", value: "1,234" });
    assert.equal(spec.className, "card stat-tile");
  });

  await t.test("renders label and value", () => {
    const spec = statTileSpec({ label: "Best sdiff today", value: "42,000" });
    const label = findByClass(spec, "stat-tile__label");
    const value = findByClass(spec, "stat-tile__value");
    assert.equal(label.text, "Best sdiff today");
    assert.equal(value.text, "42,000");
  });

  await t.test("omitted label renders no label node", () => {
    const spec = statTileSpec({ value: "5" });
    assert.equal(findByClass(spec, "stat-tile__label"), null);
  });

  await t.test("null/undefined value renders a placeholder dash, not 'null'/'undefined'", () => {
    assert.equal(findByClass(statTileSpec({ value: null }), "stat-tile__value").text, "--");
    assert.equal(findByClass(statTileSpec({}), "stat-tile__value").text, "--");
  });

  await t.test("zero is rendered as '0', not the placeholder", () => {
    const spec = statTileSpec({ value: 0 });
    assert.equal(findByClass(spec, "stat-tile__value").text, "0");
  });

  await t.test("no trend data renders no trend node", () => {
    const spec = statTileSpec({ value: "5" });
    assert.equal(findByClass(spec, "stat-tile__trend"), null);
  });

  await t.test("trend up renders trend-up modifier, icon, and label", () => {
    const spec = statTileSpec({ value: "5", trend: { direction: "up", label: "+12.3%" } });
    const trend = findByClass(spec, "stat-tile__trend stat-tile__trend--up");
    assert.ok(trend, "expected a stat-tile__trend--up node");
    const icon = findByClass(trend, "icon icon-trend-up");
    assert.ok(icon);
    const value = findByClass(trend, "stat-tile__trend-value");
    assert.equal(value.text, "+12.3%");
  });

  await t.test("trend down renders trend-down modifier", () => {
    const spec = statTileSpec({ value: "5", trend: { direction: "down", label: "-3.0%" } });
    assert.ok(findByClass(spec, "stat-tile__trend stat-tile__trend--down"));
  });

  await t.test("an unrecognized trend direction is ignored (no trend node)", () => {
    const spec = statTileSpec({ value: "5", trend: { direction: "sideways", label: "0%" } });
    assert.equal(findByClass(spec, "stat-tile__trend"), null);
  });

  await t.test("trend with a direction but no label renders an empty trend-value, not 'undefined'", () => {
    const spec = statTileSpec({ value: "5", trend: { direction: "up" } });
    const value = findByClass(spec, "stat-tile__trend-value");
    assert.equal(value.text, "");
  });

  await t.test("label text passes through as text, not markup", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const spec = statTileSpec({ label: raw, value: "5" });
    assert.equal(findByClass(spec, "stat-tile__label").text, raw);
  });

  await t.test("landing size adds stat-tile--landing modifier", () => {
    const spec = statTileSpec({ value: "5", size: "landing" });
    assert.equal(spec.className, "card stat-tile stat-tile--landing");
  });

  await t.test("highlight variant is forwarded to the underlying Card", () => {
    const spec = statTileSpec({ value: "5", highlight: true });
    assert.equal(spec.className, "card card--highlight stat-tile");
  });
});
