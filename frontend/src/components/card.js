// docs/DESIGN_SYSTEM.md Section 10.3: base container for most content.
// Header/footer are optional slots; the "highlight" variant is a modifier
// class only -- the actual --glow-accent treatment lives in card.css
// (styles are out of scope for this file), reserved per Section 2/3's
// restraint principle for a small number of meaningful cards, never a
// general emphasis tool.

import { el } from "../core/dom.js";

// title/footer accept a plain string (rendered via textContent -- safe
// for untrusted values like a workername used as a card title), a
// single spec, or an array of specs, so a caller needing richer footer
// markup (e.g. staleness text plus an icon) is not forced into a string.
function isSpec(value) {
  return typeof value === "object" && value !== null && typeof value.tag === "string";
}

function slot(className, content) {
  if (content === undefined || content === null) return null;
  if (typeof content === "string") {
    return el("div", { className, text: content });
  }
  const items = Array.isArray(content) ? content : [content];
  for (const item of items) {
    if (!isSpec(item)) {
      // A raw number/boolean/plain-object here would otherwise reach
      // specToDom's document.createElement(spec.tag) with an
      // undefined tag, producing malformed DOM instead of a clear
      // failure at the point the bad value was actually passed in.
      throw new Error("card: title/footer must be a string, a spec, or an array of specs");
    }
  }
  return el("div", { className, children: items });
}

export function cardSpec({
  title,
  footer,
  highlight = false,
  className,
  children = [],
} = {}) {
  const classes = ["card"];
  if (highlight) classes.push("card--highlight");
  if (className) classes.push(className);

  const parts = [];
  const header = slot("card__header", title);
  if (header) parts.push(header);

  parts.push(
    el("div", {
      className: "card__body",
      children: Array.isArray(children) ? children : [children],
    })
  );

  const footerNode = slot("card__footer", footer);
  if (footerNode) parts.push(footerNode);

  return el("div", { className: classes.join(" "), children: parts });
}
