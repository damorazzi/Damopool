import test from "node:test";
import assert from "node:assert/strict";
import { chartPanelSpec } from "../../src/components/chart-panel.js";

test("chartPanelSpec", async (t) => {
  await t.test("renders a card with an aria-hidden canvas and a visually-hidden summary", () => {
    const spec = chartPanelSpec({ title: "Average sdiff", summary: "15 min: 1,024." });
    assert.equal(spec.className, "card chart-panel");

    const body = spec.children.find((child) => child.className === "card__body");
    const [canvas, summary] = body.children;

    assert.equal(canvas.className, "chart-panel__canvas");
    assert.equal(canvas.attrs["aria-hidden"], "true");

    assert.equal(summary.tag, "p");
    assert.equal(summary.className, "chart-panel__summary visually-hidden");
    assert.equal(summary.text, "15 min: 1,024.");
  });

  await t.test("throws when summary is missing -- docs/ARCHITECTURE.md Section 17 requires one", () => {
    assert.throws(() => chartPanelSpec({ title: "x" }), /summary is required/);
    assert.throws(() => chartPanelSpec({ title: "x", summary: "" }), /summary is required/);
    assert.throws(() => chartPanelSpec({}), /summary is required/);
  });

  await t.test("appends an extra className alongside chart-panel", () => {
    const spec = chartPanelSpec({ summary: "x", className: "overview-page__chart" });
    assert.equal(spec.className, "card chart-panel overview-page__chart");
  });

  await t.test("passes title/footer through to cardSpec unchanged", () => {
    const spec = chartPanelSpec({ title: "My Chart", footer: "data as of 2m ago", summary: "x" });
    const header = spec.children.find((child) => child.className === "card__header");
    const footer = spec.children.find((child) => child.className === "card__footer");
    assert.equal(header.text, "My Chart");
    assert.equal(footer.text, "data as of 2m ago");
  });

  await t.test("summary text passes through as text, not markup", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const spec = chartPanelSpec({ summary: raw });
    const body = spec.children.find((child) => child.className === "card__body");
    const [, summary] = body.children;
    assert.equal(summary.text, raw);
    assert.equal(summary.tag, "p");
  });
});
