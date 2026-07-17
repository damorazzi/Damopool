import test from "node:test";
import assert from "node:assert/strict";
import { el } from "../../src/core/dom.js";

test("el", async (t) => {
  await t.test("builds a minimal spec with defaults", () => {
    assert.deepEqual(el("div"), {
      tag: "div",
      className: undefined,
      attrs: {},
      text: undefined,
      children: [],
    });
  });

  await t.test("carries className, attrs, text, and children through untouched", () => {
    const spec = el("span", {
      className: "badge",
      attrs: { "data-status": "active" },
      text: "Active",
      children: [el("i", { className: "icon" })],
    });
    assert.equal(spec.tag, "span");
    assert.equal(spec.className, "badge");
    assert.deepEqual(spec.attrs, { "data-status": "active" });
    assert.equal(spec.text, "Active");
    assert.equal(spec.children.length, 1);
    assert.equal(spec.children[0].tag, "i");
  });

  await t.test("does not escape or transform text -- callers pass raw values", () => {
    // el() itself does no escaping; specToDom's textContent assignment
    // is what makes this safe once rendered. This test documents that
    // boundary rather than asserting escaping happens here.
    const raw = "<script>alert(1)</script>";
    assert.equal(el("div", { text: raw }).text, raw);
  });
});
