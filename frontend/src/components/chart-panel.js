// docs/ARCHITECTURE.md Section 5/17: wraps a chart in a Card, with a
// canvas mount point for charts/chart.js's createChart, and a
// mandatory accessible summary -- Section 17 states plainly that
// "each chart-panel.js instance is paired with an adjacent accessible
// summary," not that it may be, so a missing summary is treated as a
// contract violation and throws, matching this codebase's established
// fail-loudly precedent (badge.js's unknown variant, router.js's
// buildHash missing param). The canvas node itself is aria-hidden --
// ECharts renders to canvas/SVG with no inherent screen-reader
// semantics of its own -- and the summary paragraph is the actual
// accessible content, visually hidden but always present.

import { el } from "../core/dom.js";
import { cardSpec } from "./card.js";

export function chartPanelSpec({ title, summary, className, footer } = {}) {
  if (!summary || typeof summary !== "string") {
    throw new Error("chartPanelSpec: a non-empty string summary is required (docs/ARCHITECTURE.md Section 17)");
  }

  const classes = ["chart-panel"];
  if (className) classes.push(className);

  return cardSpec({
    title,
    footer,
    className: classes.join(" "),
    children: [
      el("div", {
        className: "chart-panel__canvas",
        attrs: { "aria-hidden": "true" },
      }),
      el("p", {
        className: "chart-panel__summary visually-hidden",
        text: summary,
      }),
    ],
  });
}
