// docs/DESIGN_SYSTEM.md Section 10.10: full-width, danger-left-border
// banner with an icon and the error message. Per docs/ARCHITECTURE.md
// Section 16 point 2, a cached/stale payload stays visible *below* the
// banner rather than being hidden -- that visibility decision belongs
// to the caller (it renders this banner alongside, not instead of, the
// stale content); this component only owns the banner itself, not
// hiding or replacing anything else on the page.

import { el } from "../core/dom.js";

const DEFAULT_MESSAGE = "Something went wrong.";

export function errorBannerSpec({ message, icon = "error", className } = {}) {
  const classes = ["error-banner"];
  if (className) classes.push(className);

  const iconName = icon === "warning" ? "warning" : "error";

  return el("div", {
    className: classes.join(" "),
    attrs: { role: "alert" },
    children: [
      el("span", {
        className: `icon icon-${iconName} error-banner__icon`,
        attrs: { "aria-hidden": "true" },
      }),
      el("p", {
        className: "error-banner__message",
        text: message || DEFAULT_MESSAGE,
      }),
    ],
  });
}
