import test from "node:test";
import assert from "node:assert/strict";
import { ICONS, iconChildren } from "../../src/components/icons.js";

const EXPECTED_NAMES = [
  "search",
  "close",
  "trend-up",
  "trend-down",
  "info",
  "warning",
  "error",
  "external-link",
  "theme",
  "trophy",
  "chart",
  "user",
  "worker",
];

test("icons.js", async (t) => {
  await t.test("implements exactly the 13 icon names that have a real call site today", () => {
    assert.deepEqual(Object.keys(ICONS).sort(), [...EXPECTED_NAMES].sort());
  });

  await t.test("every icon builds a real <svg> spec, stroke-based, single colour via currentColor", () => {
    for (const name of EXPECTED_NAMES) {
      const [spec] = iconChildren(name);
      assert.equal(spec.tag, "svg", `${name} should be an <svg>`);
      assert.equal(spec.attrs.fill, "none");
      assert.equal(spec.attrs.stroke, "currentColor");
      assert.equal(spec.attrs["stroke-width"], "2");
      assert.ok(spec.children.length > 0, `${name} should have at least one child shape`);
    }
  });

  await t.test("every icon uses only the SVG tags core/dom.js's specToDom knows how to namespace", () => {
    const KNOWN_SVG_TAGS = new Set(["svg", "path", "circle", "line", "polyline", "rect", "g"]);
    for (const name of EXPECTED_NAMES) {
      const [spec] = iconChildren(name);
      const walk = (node) => {
        assert.ok(KNOWN_SVG_TAGS.has(node.tag), `${name} used an unlisted SVG tag: ${node.tag}`);
        for (const child of node.children || []) walk(child);
      };
      walk(spec);
    }
  });

  await t.test("iconChildren returns an empty array, not null or a throw, for an unknown name", () => {
    assert.deepEqual(iconChildren("does-not-exist"), []);
    assert.deepEqual(iconChildren(), []);
  });

  await t.test("iconChildren is safe to spread into an el() children list", () => {
    const spread = [...iconChildren("search"), "trailing"];
    assert.equal(spread.length, 2);
    assert.equal(spread[0].tag, "svg");
    assert.equal(spread[1], "trailing");
  });

  await t.test("info and warning each include a filled dot (fill: currentColor, stroke: none), not a stroked outline, for their small mark", () => {
    for (const name of ["info", "warning"]) {
      const [spec] = iconChildren(name);
      const dot = spec.children.find((c) => c.attrs.fill === "currentColor");
      assert.ok(dot, `${name} should have a filled dot child`);
      assert.equal(dot.attrs.stroke, "none");
    }
  });
});
