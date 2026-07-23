// docs/DESIGN_SYSTEM.md Section 10.2: a text input with a leading
// search icon and, once a query is entered, a trailing clear ("x")
// icon button. Pure spec-builder -- the input's live typed value/
// focus/cursor position are DOM state this component has no opinion
// about; the page module that mounts it owns wiring the actual
// 'input'/click listeners and deciding what a query does.
//
// styles/components/search-box.css (Phase E Milestone 20) styles the
// base/focus states. Section 10.2 also documents an `error` state (danger-coloured
// border plus helper text) and a `disabled` state (reduced opacity,
// no focus response) -- neither is implemented here, the same
// "add it when a page that actually needs it exists" deferral
// data-table.js's own module comment already makes for sorting. No
// current page validates a search query or needs to disable this
// input, so there is nothing yet to exercise either state against.

import { el } from "../core/dom.js";
import { iconChildren } from "./icons.js";

export function searchBoxSpec({ value = "", placeholder = "Search", label = "Search", className } = {}) {
  const classes = ["search-box"];
  if (className) classes.push(className);

  const hasValue = Boolean(value);
  const clearAttrs = { type: "button", "aria-label": "Clear search" };
  if (!hasValue) {
    clearAttrs.hidden = "";
    clearAttrs.tabindex = "-1";
  }

  return el("div", {
    className: classes.join(" "),
    children: [
      el("span", {
        className: "icon icon-search search-box__icon",
        attrs: { "aria-hidden": "true" },
        children: [...iconChildren("search")],
      }),
      el("input", {
        className: "search-box__input",
        attrs: {
          type: "text",
          value,
          placeholder,
          "aria-label": label,
        },
      }),
      el("button", {
        className: "search-box__clear",
        attrs: clearAttrs,
        children: [
          el("span", {
            className: "icon icon-close",
            attrs: { "aria-hidden": "true" },
            children: [...iconChildren("close")],
          }),
        ],
      }),
    ],
  });
}
