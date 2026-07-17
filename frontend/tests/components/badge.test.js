import test from "node:test";
import assert from "node:assert/strict";
import { badgeSpec } from "../../src/components/badge.js";

test("badgeSpec", async (t) => {
  await t.test("active worker: success modifier, dot, and 'Active' label", () => {
    const spec = badgeSpec({ variant: "active" });
    assert.equal(spec.tag, "span");
    assert.equal(spec.className, "badge badge--success");
    assert.equal(spec.children[0].className, "badge__dot");
    assert.equal(spec.children[1].text, "Active");
  });

  await t.test("inactive worker: neutral modifier and 'Inactive' label", () => {
    const spec = badgeSpec({ variant: "inactive" });
    assert.equal(spec.className, "badge badge--neutral");
    assert.equal(spec.children[1].text, "Inactive");
  });

  await t.test("accepted share: success modifier and 'Accepted' label", () => {
    const spec = badgeSpec({ variant: "accepted" });
    assert.equal(spec.className, "badge badge--success");
    assert.equal(spec.children[1].text, "Accepted");
  });

  await t.test("rejected share: danger modifier and 'Rejected' label", () => {
    const spec = badgeSpec({ variant: "rejected" });
    assert.equal(spec.className, "badge badge--danger");
    assert.equal(spec.children[1].text, "Rejected");
  });

  await t.test("an unrecognized variant throws rather than silently mislabeling as inactive", () => {
    assert.throws(() => badgeSpec({ variant: "bogus" }), /unknown variant "bogus"/);
  });

  await t.test("no variant at all throws", () => {
    assert.throws(() => badgeSpec(), /unknown variant/);
  });

  await t.test("label text passes through as text, not markup", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const spec = badgeSpec({ variant: "active", label: raw });
    assert.equal(spec.children[1].text, raw);
    assert.equal(spec.children[1].tag, "span");
  });

  await t.test("an explicit label overrides the variant's default text", () => {
    const spec = badgeSpec({ variant: "accepted", label: "OK" });
    assert.equal(spec.children[1].text, "OK");
  });

  await t.test("dot is aria-hidden -- the label text carries the meaning", () => {
    const spec = badgeSpec({ variant: "active" });
    assert.equal(spec.children[0].attrs["aria-hidden"], "true");
  });

  await t.test("extra className is appended", () => {
    const spec = badgeSpec({ variant: "active", className: "worker-row" });
    assert.equal(spec.className, "badge badge--success worker-row");
  });
});
