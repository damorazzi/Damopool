// docs/DESIGN_SYSTEM.md Section 10.9: small pill, dot + label, for the
// two genuine binary status fields already in analytics.json --
// docs/ARCHITECTURE.md Section 25's workers[...].is_active, and share
// result (accepted/rejected). Both dots are non-text fills, so they use
// the bare --color-success/--color-danger token in both themes, not the
// "-text" variant (Section 4.3) -- unlike stat-tile.js's trend text,
// there is no theme-conditional concern here at all.
//
// Deliberately not a general "put a colour on it" device (Section
// 10.9's own restriction) -- only the four variants below are exposed.

import { el } from "../core/dom.js";

const VARIANTS = {
  active: { modifier: "success", defaultLabel: "Active" },
  inactive: { modifier: "neutral", defaultLabel: "Inactive" },
  accepted: { modifier: "success", defaultLabel: "Accepted" },
  rejected: { modifier: "danger", defaultLabel: "Rejected" },
};

export function badgeSpec({ variant, label, className } = {}) {
  const entry = VARIANTS[variant];
  if (!entry) {
    // An unrecognized variant (a typo, a future status this component
    // doesn't know about yet) must not silently render as a real,
    // meaningful state -- "Inactive" on a status the caller never
    // actually asked for would be a wrong-but-plausible badge on a
    // page showing live pool/worker data, exactly the kind of
    // mistake this dashboard's "readability first, correctly" design
    // principle (docs/DESIGN_SYSTEM.md Section 2) argues against.
    throw new Error(`badgeSpec: unknown variant "${variant}"`);
  }
  const classes = ["badge", `badge--${entry.modifier}`];
  if (className) classes.push(className);

  return el("span", {
    className: classes.join(" "),
    children: [
      el("span", { className: "badge__dot", attrs: { "aria-hidden": "true" } }),
      el("span", {
        className: "badge__label",
        text: label || entry.defaultLabel,
      }),
    ],
  });
}
