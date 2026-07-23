// Independent adversarial pass on block-progress-panel.js (Phase E
// Milestone 30), complementing
// frontend/tests/components/block-progress-panel.test.js. Written by an
// independent test engineer -- targets the one gap called out explicitly
// in the test brief: block-progress-panel.js deliberately does NOT import
// stat-tile.js's statTileSpec (by design, so it can add a `title` tooltip
// attribute stat-tile.js doesn't support) and instead reproduces the
// "card stat-tile" markup locally. A drift between the two markups would
// be a real, easy-to-miss visual/behavioral bug -- this asserts the
// actual className strings produced by each are byte-identical for the
// equivalent no-tooltip case, not just "both contain the substring
// stat-tile".

import test from "node:test";
import assert from "node:assert/strict";
import { blockProgressPanelSpec } from "../../src/components/block-progress-panel.js";
import { statTileSpec } from "../../src/components/stat-tile.js";

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

function findAllByClassName(spec, className, acc = []) {
  if (!spec || typeof spec !== "object") return acc;
  const classes = (spec.className || "").split(" ");
  if (classes.includes(className)) acc.push(spec);
  for (const child of spec.children || []) {
    findAllByClassName(child, className, acc);
  }
  return acc;
}

test("block-progress-panel tile markup is indistinguishable from a real statTileSpec tile", async (t) => {
  await t.test("outer tile className string is byte-identical to statTileSpec's own default output", () => {
    const realTile = statTileSpec({ label: "X", value: "Y" });
    const bpSpec = blockProgressPanelSpec({ networkDifficultyText: "126T" });
    const tiles = findAllByClassName(bpSpec, "stat-tile");
    // The first tile ("Current Network Difficulty") carries no tooltip --
    // its outer wrapper className must match statTileSpec's exactly.
    assert.equal(tiles[0].className, realTile.className,
      `block-progress-panel's tile className ("${tiles[0].className}") has drifted from stat-tile.js's real output ("${realTile.className}")`);
  });

  await t.test("card__body wrapper className matches between the two implementations", () => {
    const realTile = statTileSpec({ label: "X", value: "Y" });
    const bpSpec = blockProgressPanelSpec({ networkDifficultyText: "126T" });
    const tiles = findAllByClassName(bpSpec, "stat-tile");
    const realBody = findByClassName(realTile, "card__body");
    const bpBody = findByClassName(tiles[0], "card__body");
    assert.equal(bpBody.className, realBody.className);
  });

  await t.test("stat-tile__label className matches between the two implementations", () => {
    const realTile = statTileSpec({ label: "X", value: "Y" });
    const bpSpec = blockProgressPanelSpec({ networkDifficultyText: "126T" });
    const tiles = findAllByClassName(bpSpec, "stat-tile");
    const realLabel = findByClassName(realTile, "stat-tile__label");
    const bpLabel = findByClassName(tiles[0], "stat-tile__label");
    assert.equal(bpLabel.className, realLabel.className);
  });

  await t.test("stat-tile__value className matches between the two implementations", () => {
    const realTile = statTileSpec({ label: "X", value: "Y" });
    const bpSpec = blockProgressPanelSpec({ networkDifficultyText: "126T" });
    const tiles = findAllByClassName(bpSpec, "stat-tile");
    const realValue = findByClassName(realTile, "stat-tile__value");
    const bpValue = findByClassName(tiles[0], "stat-tile__value");
    assert.equal(bpValue.className, realValue.className);
  });

  await t.test("statTileSpec itself renders a null value as '--', matching block-progress-panel's own null handling", () => {
    // Cross-check both null-handling implementations agree, since they
    // are two independent code paths doing the same thing (docs/
    // feedback_parallel_code_paths_consistent_defenses.md's own concern
    // class -- an unexplained asymmetry between sibling null-guards is a
    // red flag).
    const realTile = statTileSpec({ label: "X", value: null });
    const bpSpec = blockProgressPanelSpec({});
    const tiles = findAllByClassName(bpSpec, "stat-tile");
    assert.equal(findByClassName(realTile, "stat-tile__value").text, "--");
    assert.equal(findByClassName(tiles[0], "stat-tile__value").text, "--");
  });

  await t.test("all-null input across all four tiles renders '--' with no thrown error and no 'null'/'undefined' string", () => {
    const spec = blockProgressPanelSpec({
      networkDifficultyText: null,
      bestShareText: undefined,
      progressPercentText: null,
      stillNeededText: undefined,
    });
    const values = findAllByClassName(spec, "stat-tile").map((tile) => findByClassName(tile, "stat-tile__value").text);
    assert.deepEqual(values, ["--", "--", "--", "--"]);
    assert.ok(!values.includes("null"));
    assert.ok(!values.includes("undefined"));
  });
});
