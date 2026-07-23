import test from "node:test";
import assert from "node:assert/strict";
import { datasetToggleSpec, histogramPanelSpec } from "../../src/components/histogram-panel.js";

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

test("datasetToggleSpec", async (t) => {
  await t.test("renders exactly two buttons, '1 Day' then 'Total (Lifetime)'", () => {
    const spec = datasetToggleSpec("1d");
    assert.equal(spec.children.length, 2);
    assert.equal(spec.children[0].text, "1 Day");
    assert.equal(spec.children[1].text, "Total (Lifetime)");
    assert.equal(spec.children[0].attrs["data-dataset"], "1d");
    assert.equal(spec.children[1].attrs["data-dataset"], "total");
  });

  await t.test("marks the active dataset via className and aria-pressed", () => {
    const spec = datasetToggleSpec("total");
    assert.equal(spec.children[0].attrs["aria-pressed"], "false");
    assert.ok(!spec.children[0].className.includes("--active"));
    assert.equal(spec.children[1].attrs["aria-pressed"], "true");
    assert.ok(spec.children[1].className.includes("--active"));
  });

  await t.test("is a labelled group for assistive tech", () => {
    const spec = datasetToggleSpec("1d");
    assert.equal(spec.attrs.role, "group");
    assert.equal(spec.attrs["aria-label"], "Dataset");
  });
});

test("histogramPanelSpec", async (t) => {
  await t.test("wraps a chart-panel with the dataset toggle in its footer", () => {
    const spec = histogramPanelSpec({ title: "Pool Share Difficulty Histogram", summary: "summary text", activeDataset: "1d" });
    assert.ok(findByClassName(spec, "chart-panel"));
    assert.ok(findByClassName(spec, "histogram-panel"));
    assert.ok(findByClassName(spec, "chart-panel__canvas"));
    assert.equal(findByClassName(spec, "chart-panel__summary").text, "summary text");
    assert.ok(findByClassName(spec, "dataset-toggle"));
  });

  await t.test("throws without a summary, same contract as the underlying chart-panel.js", () => {
    assert.throws(() => histogramPanelSpec({ title: "x", activeDataset: "1d" }), /summary/);
  });
});
