import test from "node:test";
import assert from "node:assert/strict";
import { errorBannerSpec } from "../../src/components/error-banner.js";

test("errorBannerSpec", async (t) => {
  await t.test("renders the message and defaults to the error icon", () => {
    const spec = errorBannerSpec({ message: "Failed to load analytics.json." });
    assert.equal(spec.tag, "div");
    assert.equal(spec.className, "error-banner");
    assert.equal(spec.attrs.role, "alert");
    assert.equal(spec.children[0].className, "icon icon-error error-banner__icon");
    assert.equal(spec.children[1].text, "Failed to load analytics.json.");
  });

  await t.test("icon: 'warning' selects the warning icon", () => {
    const spec = errorBannerSpec({ message: "Data may be stale.", icon: "warning" });
    assert.equal(spec.children[0].className, "icon icon-warning error-banner__icon");
  });

  await t.test("an unrecognized icon value falls back to error", () => {
    const spec = errorBannerSpec({ message: "x", icon: "skull" });
    assert.equal(spec.children[0].className, "icon icon-error error-banner__icon");
  });

  await t.test("no message provided falls back to a default, not blank/undefined", () => {
    const spec = errorBannerSpec({});
    assert.ok(spec.children[1].text.length > 0);
    assert.notEqual(spec.children[1].text, "undefined");
  });

  await t.test("does not hide or wrap any other content -- only builds the banner itself", () => {
    const spec = errorBannerSpec({ message: "x" });
    assert.equal(spec.children.length, 2);
  });

  await t.test("extra className is appended", () => {
    const spec = errorBannerSpec({ message: "x", className: "pool-page" });
    assert.equal(spec.className, "error-banner pool-page");
  });

  await t.test("message text passes through as text, not markup", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const spec = errorBannerSpec({ message: raw });
    assert.equal(spec.children[1].text, raw);
    assert.equal(spec.children[1].tag, "p");
  });
});
