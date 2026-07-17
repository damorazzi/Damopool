import test from "node:test";
import assert from "node:assert/strict";
import { emptyStateSpec } from "../../src/components/empty-state.js";

test("emptyStateSpec", async (t) => {
  await t.test("renders an icon and the given message", () => {
    const spec = emptyStateSpec({ message: "This worker has not submitted a share in 24h." });
    assert.equal(spec.tag, "div");
    assert.equal(spec.className, "empty-state");
    assert.equal(spec.children.length, 2);
    assert.equal(spec.children[0].className, "icon icon-info empty-state__icon");
    assert.equal(spec.children[1].className, "empty-state__message");
    assert.equal(spec.children[1].text, "This worker has not submitted a share in 24h.");
  });

  await t.test("icon is aria-hidden (decorative -- the message carries the meaning)", () => {
    const spec = emptyStateSpec({ message: "No workers yet." });
    assert.equal(spec.children[0].attrs["aria-hidden"], "true");
  });

  await t.test("no message provided falls back to a default rather than rendering blank/undefined", () => {
    const spec = emptyStateSpec({});
    assert.equal(typeof spec.children[1].text, "string");
    assert.ok(spec.children[1].text.length > 0);
    assert.notEqual(spec.children[1].text, "undefined");
  });

  await t.test("no options object at all still returns a valid spec", () => {
    const spec = emptyStateSpec();
    assert.equal(spec.className, "empty-state");
    assert.ok(spec.children[1].text.length > 0);
  });

  await t.test("empty string message also falls back to the default", () => {
    const spec = emptyStateSpec({ message: "" });
    assert.notEqual(spec.children[1].text, "");
  });

  await t.test("extra className is appended", () => {
    const spec = emptyStateSpec({ message: "x", className: "ticker" });
    assert.equal(spec.className, "empty-state ticker");
  });

  await t.test("message text passes through as text, not markup", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const spec = emptyStateSpec({ message: raw });
    assert.equal(spec.children[1].text, raw);
    assert.equal(spec.children[1].tag, "p");
  });
});
