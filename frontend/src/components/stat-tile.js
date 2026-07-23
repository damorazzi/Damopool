// docs/DESIGN_SYSTEM.md Section 10.5: a Card variant for a single
// headline number, with an optional trend indicator.
//
// Theme handling: this component does NOT take a theme parameter and
// does not read core/state.js. docs/DESIGN_SYSTEM.md Section 4.1
// records that theme-dark.css aliases --color-success-text/
// --color-danger-text to their bare counterparts specifically so
// component CSS can reference the "-text" token unconditionally for
// text use and still be correct in both themes, with no
// theme-conditional branch. The trend value is coloured text (Section
// 4.3's 4.5:1 rule), so stat-tile.css colours .stat-tile__trend--up/
// --down with var(--color-success-text)/var(--color-danger-text)
// directly -- that alias is what keeps this function pure with no
// theme input needed.

import { el } from "../core/dom.js";
import { cardSpec } from "./card.js";
import { iconChildren } from "./icons.js";

export function statTileSpec({
  label,
  value,
  trend,
  size = "default",
  highlight = false,
  className,
} = {}) {
  const classes = ["stat-tile"];
  if (size === "landing") classes.push("stat-tile--landing");
  if (className) classes.push(className);

  const children = [];
  if (label !== undefined && label !== null) {
    children.push(el("div", { className: "stat-tile__label", text: label }));
  }

  // Missing/null is treated as "no value yet" and rendered as a
  // placeholder dash rather than the string "null" or "undefined" --
  // distinct from formatSdiff's own null (docs/core/format.js), which a
  // page-level EmptyState is expected to handle before ever reaching
  // this component. This is a defensive fallback for this component in
  // isolation, not a replacement for that pattern.
  const displayValue = value === undefined || value === null ? "--" : String(value);
  children.push(el("div", { className: "stat-tile__value", text: displayValue }));

  if (trend && (trend.direction === "up" || trend.direction === "down")) {
    children.push(
      el("div", {
        className: `stat-tile__trend stat-tile__trend--${trend.direction}`,
        children: [
          el("span", {
            className: `icon icon-trend-${trend.direction}`,
            attrs: { "aria-hidden": "true" },
            children: [...iconChildren(`trend-${trend.direction}`)],
          }),
          el("span", {
            className: "stat-tile__trend-value",
            text: trend.label !== undefined && trend.label !== null ? trend.label : "",
          }),
        ],
      })
    );
  }

  return cardSpec({ highlight, className: classes.join(" "), children });
}
