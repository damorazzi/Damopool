import test from "node:test";
import assert from "node:assert/strict";
import { buildEChartsTheme } from "../../src/charts/theme-echarts.js";

test("buildEChartsTheme", async (t) => {
  await t.test("maps token values into the expected style fragments", () => {
    const theme = buildEChartsTheme({
      textPrimary: "#f5f1e8",
      textSecondary: "#b8ae9c",
      border: "#3a332a",
      accent: "#ffd700",
      fontFamily: "sans-serif",
    });

    assert.equal(theme.backgroundColor, "transparent");
    assert.equal(theme.textStyle.color, "#f5f1e8");
    assert.equal(theme.textStyle.fontFamily, "sans-serif");
    assert.equal(theme.axisLine.lineStyle.color, "#3a332a");
    assert.equal(theme.splitLine.lineStyle.color, "#3a332a");
    assert.equal(theme.axisLabel.color, "#b8ae9c");
    assert.equal(theme.accentColor, "#ffd700");
  });

  await t.test("axisLabel falls back to textPrimary when textSecondary is missing", () => {
    const theme = buildEChartsTheme({ textPrimary: "#111111" });
    assert.equal(theme.axisLabel.color, "#111111");
  });

  await t.test("missing tokens degrade to undefined, not a hardcoded fallback colour", () => {
    const theme = buildEChartsTheme({});
    assert.equal(theme.textStyle.color, undefined);
    assert.equal(theme.axisLine.lineStyle.color, undefined);
    assert.equal(theme.accentColor, undefined);
  });

  await t.test("no arguments at all does not throw", () => {
    assert.doesNotThrow(() => buildEChartsTheme());
  });
});
