import test from "node:test";
import assert from "node:assert/strict";
import { cardSpec } from "../../src/components/card.js";

test("cardSpec", async (t) => {
  await t.test("base container with no header/footer", () => {
    const spec = cardSpec({ children: [{ tag: "p", text: "hi" }] });
    assert.equal(spec.tag, "div");
    assert.equal(spec.className, "card");
    assert.equal(spec.children.length, 1);
    assert.equal(spec.children[0].className, "card__body");
    assert.equal(spec.children[0].children[0].text, "hi");
  });

  await t.test("string title renders via text, not concatenated markup", () => {
    const spec = cardSpec({ title: "Pool Statistics" });
    const header = spec.children[0];
    assert.equal(header.className, "card__header");
    assert.equal(header.text, "Pool Statistics");
  });

  await t.test("string footer renders via text", () => {
    const spec = cardSpec({ footer: "data as of 2m ago" });
    const footer = spec.children[spec.children.length - 1];
    assert.equal(footer.className, "card__footer");
    assert.equal(footer.text, "data as of 2m ago");
  });

  await t.test("header/body/footer order when all three present", () => {
    const spec = cardSpec({ title: "Title", footer: "Footer", children: [] });
    assert.deepEqual(
      spec.children.map((c) => c.className),
      ["card__header", "card__body", "card__footer"]
    );
  });

  await t.test("highlight variant adds card--highlight modifier", () => {
    const plain = cardSpec({});
    const highlighted = cardSpec({ highlight: true });
    assert.equal(plain.className, "card");
    assert.equal(highlighted.className, "card card--highlight");
  });

  await t.test("extra className is appended", () => {
    const spec = cardSpec({ className: "stat-tile" });
    assert.equal(spec.className, "card stat-tile");
  });

  await t.test("a spec (not a string) title/footer is nested, not stringified", () => {
    const titleSpec = { tag: "span", text: "icon+label" };
    const spec = cardSpec({ title: titleSpec });
    assert.equal(spec.children[0].children[0], titleSpec);
  });

  await t.test("username-like text in title/footer never becomes markup", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const spec = cardSpec({ title: raw, footer: raw, children: [{ tag: "p", text: raw }] });
    assert.equal(spec.children[0].text, raw);
    assert.equal(spec.children[1].children[0].text, raw);
    assert.equal(spec.children[2].text, raw);
    // el() never HTML-escapes -- specToDom's textContent assignment is
    // the enforcement point (core/dom.js), so this test only documents
    // that the raw string passes through untouched as a `text` field,
    // never as part of a concatenated string.
  });
});
