// A minimal spec-tree format plus a renderer -- the shared boundary
// between pure, testable component logic and real DOM. This is where
// docs/ARCHITECTURE.md Section 18's XSS requirement is enforced
// structurally rather than per-component: specToDom is the only place
// text becomes DOM, and it always goes through textContent, never
// innerHTML, so a component author cannot accidentally introduce a
// string-concatenation XSS path even for an untrusted username or
// workername.
//
// el() builds a spec (a plain object, no DOM APIs involved) and is
// fully unit-testable in Node. specToDom(spec) converts a spec into
// real DOM nodes and therefore needs a `document` global -- it is
// reviewed by reading, the same tradeoff already made for router.js's
// createRouter.

export function el(tag, { className, attrs = {}, text, children = [] } = {}) {
  return { tag, className, attrs, text, children };
}

export function specToDom(spec) {
  if (typeof spec === "string") {
    return document.createTextNode(spec);
  }

  const node = document.createElement(spec.tag);

  if (spec.className) {
    node.className = spec.className;
  }

  for (const [key, value] of Object.entries(spec.attrs || {})) {
    node.setAttribute(key, value);
  }

  // textContent, never innerHTML -- the one enforcement point for
  // docs/ARCHITECTURE.md Section 18. Note for icon spans specifically
  // (base.css's `.icon:empty { display: none }`, Phase E Milestone
  // 20): any defined, non-null `text` -- including a falsy value like
  // 0 -- produces a real text node here, so an icon-only element must
  // never be given a `text` value, or it stops matching `:empty` and
  // an unwanted glyph/character renders in what's meant to be an
  // icon-only placeholder. No current call site does this.
  if (spec.text !== undefined && spec.text !== null) {
    node.textContent = spec.text;
  }

  for (const child of spec.children || []) {
    node.appendChild(specToDom(child));
  }

  return node;
}
