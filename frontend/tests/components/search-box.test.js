import test from "node:test";
import assert from "node:assert/strict";
import { searchBoxSpec } from "../../src/components/search-box.js";

test("searchBoxSpec", async (t) => {
  await t.test("renders an icon, an input, and a clear button", () => {
    const spec = searchBoxSpec({});
    assert.equal(spec.className, "search-box");
    assert.equal(spec.children.length, 3);
    assert.equal(spec.children[0].className, "icon icon-search search-box__icon");
    assert.equal(spec.children[1].tag, "input");
    assert.equal(spec.children[2].className, "search-box__clear");
  });

  await t.test("the input carries value/placeholder/aria-label", () => {
    const spec = searchBoxSpec({ value: "alice", placeholder: "Find a user", label: "Search users" });
    const input = spec.children[1];
    assert.equal(input.attrs.type, "text");
    assert.equal(input.attrs.value, "alice");
    assert.equal(input.attrs.placeholder, "Find a user");
    assert.equal(input.attrs["aria-label"], "Search users");
  });

  await t.test("defaults to an empty value and a generic placeholder/label", () => {
    const spec = searchBoxSpec();
    assert.equal(spec.children[1].attrs.value, "");
    assert.equal(spec.children[1].attrs.placeholder, "Search");
    assert.equal(spec.children[1].attrs["aria-label"], "Search");
  });

  await t.test("the clear button is hidden and unfocusable when there is no query", () => {
    const spec = searchBoxSpec({ value: "" });
    const clearButton = spec.children[2];
    assert.equal(clearButton.attrs.hidden, "");
    assert.equal(clearButton.attrs.tabindex, "-1");
  });

  await t.test("the clear button is visible and focusable once a query is entered", () => {
    const spec = searchBoxSpec({ value: "bob" });
    const clearButton = spec.children[2];
    assert.equal(clearButton.attrs.hidden, undefined);
    assert.equal(clearButton.attrs.tabindex, undefined);
  });

  await t.test("extra className is appended", () => {
    const spec = searchBoxSpec({ className: "users-page__search" });
    assert.equal(spec.className, "search-box users-page__search");
  });

  await t.test("a malicious value passes through as an attribute value, never as markup", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const spec = searchBoxSpec({ value: raw });
    assert.equal(spec.children[1].attrs.value, raw);
  });
});
