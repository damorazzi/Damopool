// Phase E Milestone 29: the Share Difficulty Distribution Histogram's
// spec-building shell -- a chart-panel.js instance plus a "1 Day" /
// "Total (Lifetime)" dataset toggle in the footer slot. One component,
// reused byte-identical on Overview, User Detail, and Worker Detail
// (Human Approval Brief) -- only `title`/`summary`/`activeDataset`
// differ per call site; the page module owns fetching the right
// difficulty_histogram scope and wiring the toggle buttons' click
// listeners (the same "component builds the spec, the page wires the
// DOM events" split already established by search-box.js).

import { el } from "../core/dom.js";
import { chartPanelSpec } from "./chart-panel.js";
import { HISTOGRAM_DATASETS } from "../charts/histogram-chart.js";

export function datasetToggleSpec(activeDataset) {
  return el("div", {
    className: "dataset-toggle",
    attrs: { role: "group", "aria-label": "Dataset" },
    children: HISTOGRAM_DATASETS.map(({ key, label }) => {
      const isActive = key === activeDataset;
      return el("button", {
        className: `dataset-toggle__button${isActive ? " dataset-toggle__button--active" : ""}`,
        attrs: {
          type: "button",
          "data-dataset": key,
          "aria-pressed": isActive ? "true" : "false",
        },
        text: label,
      });
    }),
  });
}

export function histogramPanelSpec({ title, summary, activeDataset, className } = {}) {
  const classes = ["histogram-panel"];
  if (className) classes.push(className);

  return chartPanelSpec({
    title,
    summary,
    className: classes.join(" "),
    footer: datasetToggleSpec(activeDataset),
  });
}
