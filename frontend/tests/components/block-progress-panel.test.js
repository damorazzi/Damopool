import test from "node:test";
import assert from "node:assert/strict";
import { blockProgressPanelSpec } from "../../src/components/block-progress-panel.js";

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

test("blockProgressPanelSpec", async (t) => {
  await t.test("titled 'Block Progress'", () => {
    const spec = blockProgressPanelSpec({});
    assert.equal(findByClassName(spec, "card__header").text, "Block Progress");
  });

  await t.test("renders exactly four stat tiles, in order", () => {
    const spec = blockProgressPanelSpec({
      networkDifficultyText: "126T",
      bestShareText: "28.6B",
      progressPercentText: "0.0227%",
      stillNeededText: "×4,406",
    });
    const tiles = findAllByClassName(spec, "stat-tile");
    assert.equal(tiles.length, 4);

    const labels = tiles.map((tile) => findByClassName(tile, "stat-tile__label").text);
    assert.deepEqual(labels, ["Current Network Difficulty", "Best Share", "Block Progress", "Still Needed"]);

    const values = tiles.map((tile) => findByClassName(tile, "stat-tile__value").text);
    assert.deepEqual(values, ["126T", "28.6B", "0.0227%", "×4,406"]);
  });

  await t.test("null/missing values render as the '--' placeholder, not 'null'/'undefined'", () => {
    const spec = blockProgressPanelSpec({});
    const tiles = findAllByClassName(spec, "stat-tile");
    const values = tiles.map((tile) => findByClassName(tile, "stat-tile__value").text);
    assert.deepEqual(values, ["--", "--", "--", "--"]);
  });

  await t.test("'Block Progress' and 'Still Needed' labels carry explanatory tooltips via the title attribute", () => {
    const spec = blockProgressPanelSpec({});
    const tiles = findAllByClassName(spec, "stat-tile");
    const blockProgressLabel = findByClassName(tiles[2], "stat-tile__label");
    const stillNeededLabel = findByClassName(tiles[3], "stat-tile__label");
    assert.equal(
      blockProgressLabel.attrs.title,
      "The percentage of today's Bitcoin network difficulty reached by your best accepted share.",
    );
    assert.equal(
      stillNeededLabel.attrs.title,
      "How many times larger your best accepted share would need to be to equal today's network difficulty.",
    );
  });

  await t.test("'Current Network Difficulty' and 'Best Share' labels carry no tooltip", () => {
    const spec = blockProgressPanelSpec({});
    const tiles = findAllByClassName(spec, "stat-tile");
    assert.equal(findByClassName(tiles[0], "stat-tile__label").attrs.title, undefined);
    assert.equal(findByClassName(tiles[1], "stat-tile__label").attrs.title, undefined);
  });

  await t.test("no gauge/progress-bar/chart elements -- a plain information panel only", () => {
    const spec = blockProgressPanelSpec({});
    assert.equal(findByClassName(spec, "chart-panel"), null);
    assert.equal(findByClassName(spec, "chart-panel__canvas"), null);
  });
});
