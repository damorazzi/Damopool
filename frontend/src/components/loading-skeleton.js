// docs/DESIGN_SYSTEM.md Section 10.10: a placeholder shape matching the
// final content's approximate size, to avoid layout shift
// (docs/ARCHITECTURE.md Section 16 point 1). This component therefore
// takes a shape hint and/or explicit width/height from its caller
// rather than inventing a size -- only the caller (a stat-tile view, a
// table view) knows what the real content will look like.

import { el } from "../core/dom.js";

// Named shapes get a modifier class (loading-skeleton--tile etc.) so
// loading-skeleton.css can size each one to match its real
// counterpart without every call site repeating width/height.
const SHAPES = ["tile", "row", "text", "block"];

// A strict CSS-length grammar, not a free-form string -- width/height
// are written into an attrs.style value (specToDom -> setAttribute,
// not textContent), which setAttribute makes safe from markup
// injection, but an unvalidated string would still be an arbitrary
// CSS-injection surface with no enforced contract restricting callers
// to real length values. Any caller passing something else gets no
// inline size at all, rather than a malformed style attribute.
const CSS_LENGTH = /^\d+(\.\d+)?(px|rem|em|%)$/;

function toLength(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return `${value}px`;
  if (typeof value === "string" && CSS_LENGTH.test(value)) return value;
  return null;
}

function skeletonBlock({ shape, width, height, className }) {
  const classes = ["loading-skeleton"];
  if (shape && SHAPES.includes(shape)) classes.push(`loading-skeleton--${shape}`);
  if (className) classes.push(className);

  const attrs = { "aria-hidden": "true" };
  const widthLength = toLength(width);
  const heightLength = toLength(height);
  const styleParts = [];
  if (widthLength) styleParts.push(`width:${widthLength}`);
  if (heightLength) styleParts.push(`height:${heightLength}`);
  if (styleParts.length > 0) attrs.style = styleParts.join(";");

  return el("div", { className: classes.join(" "), attrs });
}

export function loadingSkeletonSpec({
  shape = "block",
  width,
  height,
  count = 1,
  className,
} = {}) {
  const safeCount = Number.isInteger(count) && count > 0 ? count : 1;

  if (safeCount === 1) {
    return skeletonBlock({ shape, width, height, className });
  }

  const children = [];
  for (let i = 0; i < safeCount; i += 1) {
    children.push(skeletonBlock({ shape, width, height }));
  }
  const groupClasses = ["loading-skeleton-group"];
  if (className) groupClasses.push(className);
  return el("div", {
    className: groupClasses.join(" "),
    attrs: { "aria-busy": "true" },
    children,
  });
}
