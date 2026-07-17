// docs/DESIGN_SYSTEM.md Section 10.10: centred info icon plus a short,
// specific message (Section 16.3 / docs/ARCHITECTURE.md Section 16
// point 3: "not a generic 'no data'"). This component renders inside
// whatever card container the real content would otherwise occupy --
// it does not wrap itself in a Card; the caller keeps the surrounding
// Card and swaps EmptyState in for the body content, so an empty view
// doesn't collapse to a different layout.

import { el } from "../core/dom.js";

// A fallback for the case a caller forgets to pass one -- this is a
// safety net, not an example of an approved message; every real call
// site should pass a specific message per Section 16.3.
const DEFAULT_MESSAGE = "No data available.";

export function emptyStateSpec({ message, className } = {}) {
  const classes = ["empty-state"];
  if (className) classes.push(className);

  return el("div", {
    className: classes.join(" "),
    children: [
      el("span", {
        className: "icon icon-info empty-state__icon",
        attrs: { "aria-hidden": "true" },
      }),
      el("p", {
        className: "empty-state__message",
        text: message || DEFAULT_MESSAGE,
      }),
    ],
  });
}
