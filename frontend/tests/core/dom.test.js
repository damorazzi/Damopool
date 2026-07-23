import test from "node:test";
import assert from "node:assert/strict";
import { el, specToDom } from "../../src/core/dom.js";

// A minimal stand-in for `document`, covering only the surface specToDom
// actually calls (createElement, createElementNS, createTextNode, plus a
// node with setAttribute/appendChild/className/textContent). Not a jsdom
// dependency -- this project deliberately has none -- just enough of a
// fake to prove the SVG-namespace branching added in Phase F (icon set
// milestone) actually does what it claims, per the independent review
// finding that this branch had no automated coverage at all.
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";

class FakeNode {
  constructor(tagName, namespaceURI) {
    this.tagName = tagName;
    this.namespaceURI = namespaceURI;
    this.className = undefined;
    this.attributes = {};
    this.textContent = undefined;
    this.childNodes = [];
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  appendChild(child) {
    this.childNodes.push(child);
    return child;
  }
}

function fakeDocument() {
  return {
    createElement: (tag) => new FakeNode(tag, XHTML_NS),
    createElementNS: (ns, tag) => new FakeNode(tag, ns),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  };
}

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

test("specToDom", async (t) => {
  t.beforeEach(() => {
    globalThis.document = fakeDocument();
  });
  t.afterEach(() => {
    delete globalThis.document;
  });

  await t.test("a bare string spec becomes a text node via createTextNode", () => {
    const node = specToDom("hi");
    assert.equal(node.nodeType, 3);
    assert.equal(node.textContent, "hi");
  });

  await t.test("an ordinary HTML tag is created via createElement, not createElementNS", () => {
    const node = specToDom(el("div", { className: "foo" }));
    assert.equal(node.tagName, "div");
    assert.equal(node.namespaceURI, XHTML_NS);
    assert.equal(node.className, "foo");
    assert.equal(node.attributes.class, undefined);
  });

  await t.test("every SVG tag icons.js actually uses is created via createElementNS with the SVG namespace", () => {
    for (const tag of ["svg", "path", "circle", "line", "polyline", "rect", "g"]) {
      const node = specToDom(el(tag));
      assert.equal(node.namespaceURI, SVG_NS, `${tag} should be namespaced as SVG`);
    }
  });

  await t.test("className on an SVG node is set via setAttribute(\"class\", ...), not .className", () => {
    // SVGElement.className is an SVGAnimatedString on a real DOM, not a
    // plain settable string -- this is the exact bug the namespace-aware
    // branch exists to avoid.
    const node = specToDom(el("svg", { className: "icon-search" }));
    assert.equal(node.attributes.class, "icon-search");
    assert.equal(node.className, undefined);
  });

  await t.test("className on a non-SVG node still uses .className, unaffected by the SVG branch", () => {
    const node = specToDom(el("span", { className: "icon" }));
    assert.equal(node.className, "icon");
    assert.equal(node.attributes.class, undefined);
  });

  await t.test("attrs are set via setAttribute for both namespaces", () => {
    const node = specToDom(el("circle", { attrs: { cx: 11, cy: 11, r: 7 } }));
    assert.equal(node.attributes.cx, 11);
    assert.equal(node.attributes.cy, 11);
    assert.equal(node.attributes.r, 7);
  });

  await t.test("text is assigned as textContent regardless of namespace", () => {
    const node = specToDom(el("span", { text: "hello" }));
    assert.equal(node.textContent, "hello");
  });

  await t.test("children are recursively rendered and appended, each with its own correct namespace", () => {
    const spec = el("span", {
      className: "icon",
      children: [el("svg", { children: [el("circle", { attrs: { r: 1 } })] })],
    });
    const node = specToDom(spec);
    assert.equal(node.namespaceURI, XHTML_NS);
    assert.equal(node.childNodes.length, 1);
    const svgNode = node.childNodes[0];
    assert.equal(svgNode.namespaceURI, SVG_NS);
    assert.equal(svgNode.childNodes.length, 1);
    assert.equal(svgNode.childNodes[0].namespaceURI, SVG_NS);
    assert.equal(svgNode.childNodes[0].attributes.r, 1);
  });
});
