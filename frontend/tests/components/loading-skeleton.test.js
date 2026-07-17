import test from "node:test";
import assert from "node:assert/strict";
import { loadingSkeletonSpec } from "../../src/components/loading-skeleton.js";

test("loadingSkeletonSpec", async (t) => {
  await t.test("defaults to a single block-shaped skeleton", () => {
    const spec = loadingSkeletonSpec();
    assert.equal(spec.tag, "div");
    assert.equal(spec.className, "loading-skeleton loading-skeleton--block");
  });

  await t.test("named shape hint becomes a modifier class", () => {
    assert.equal(loadingSkeletonSpec({ shape: "tile" }).className, "loading-skeleton loading-skeleton--tile");
    assert.equal(loadingSkeletonSpec({ shape: "row" }).className, "loading-skeleton loading-skeleton--row");
    assert.equal(loadingSkeletonSpec({ shape: "text" }).className, "loading-skeleton loading-skeleton--text");
  });

  await t.test("unrecognized shape is dropped, not passed through as an arbitrary class", () => {
    const spec = loadingSkeletonSpec({ shape: "hexagon" });
    assert.equal(spec.className, "loading-skeleton");
  });

  await t.test("numeric width/height become px lengths on the style attr", () => {
    const spec = loadingSkeletonSpec({ width: 120, height: 32 });
    assert.equal(spec.attrs.style, "width:120px;height:32px");
  });

  await t.test("string width/height are passed through as CSS lengths", () => {
    const spec = loadingSkeletonSpec({ width: "100%", height: "2rem" });
    assert.equal(spec.attrs.style, "width:100%;height:2rem");
  });

  await t.test("no width/height means no style attr at all", () => {
    const spec = loadingSkeletonSpec({ shape: "tile" });
    assert.equal(spec.attrs.style, undefined);
  });

  await t.test("a malformed width/height string produces no style attr rather than being passed through", () => {
    const spec = loadingSkeletonSpec({ width: "100px; background:url(evil)", height: "2rem" });
    // Only the valid height should survive; the malformed width must
    // not reach the style attribute in any form.
    assert.equal(spec.attrs.style, "height:2rem");
    assert.ok(!spec.attrs.style.includes("evil"));
  });

  await t.test("a negative numeric width/height produces no style attr", () => {
    const spec = loadingSkeletonSpec({ width: -10 });
    assert.equal(spec.attrs.style, undefined);
  });

  await t.test("is decorative -- aria-hidden", () => {
    assert.equal(loadingSkeletonSpec().attrs["aria-hidden"], "true");
  });

  await t.test("count > 1 produces a group of repeated blocks matching the shape hint", () => {
    const spec = loadingSkeletonSpec({ shape: "row", count: 3 });
    assert.equal(spec.className, "loading-skeleton-group");
    assert.equal(spec.attrs["aria-busy"], "true");
    assert.equal(spec.children.length, 3);
    for (const child of spec.children) {
      assert.equal(child.className, "loading-skeleton loading-skeleton--row");
    }
  });

  await t.test("count of 0, negative, or non-integer falls back to a single skeleton", () => {
    assert.equal(loadingSkeletonSpec({ count: 0 }).className, "loading-skeleton loading-skeleton--block");
    assert.equal(loadingSkeletonSpec({ count: -1 }).className, "loading-skeleton loading-skeleton--block");
    assert.equal(loadingSkeletonSpec({ count: 1.5 }).className, "loading-skeleton loading-skeleton--block");
  });
});
