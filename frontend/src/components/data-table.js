// docs/DESIGN_SYSTEM.md Section 10.4: a real semantic <table>, with
// numeric columns right-aligned/tabular-nums, that collapses to one
// card-styled block per row below 768px (docs/ARCHITECTURE.md Section
// 12) with each cell shown as a label: value pair. The row-to-card
// collapse is pure CSS (data-table.css's `::before { content:
// attr(data-label) }` on each cell, driven by the `data-label` attrs
// this spec already writes) -- the same DOM serves both breakpoints,
// no separate mobile markup and no JS breakpoint branching.
//
// Explicit table/rowgroup/row/columnheader/cell roles are written on
// every element below, unconditionally (not just at the mobile
// breakpoint). Overriding a table element's CSS `display` away from
// `table`/`table-row`/`table-cell` -- exactly what data-table.css does
// below 768px -- strips the *implicit* table/row/cell roles most
// browsers derive from `display`, breaking screen-reader table
// navigation and the column-header/cell association right at the
// breakpoint this component exists to serve. Explicit roles are
// immune to that: they hold regardless of computed `display`, so
// table semantics (and therefore each cell's associated column
// header) survive the responsive collapse. At the desktop breakpoint
// these roles simply restate the implicit ones already there --
// harmless, standard defensive practice for a component whose CSS
// changes `display` responsively (WAI-ARIA Authoring Practices'
// documented pattern for exactly this case). <thead> stays present at
// every breakpoint (data-table.css visually clips rather than
// display:none's it below 768px) so its real, always-present header
// text remains the actual accessible name path -- the `::before`
// label is a visual affordance for sighted mobile users, not the
// sole carrier of semantic meaning CSS generated content would be too
// unreliable to depend on alone.
//
// Sorting (Section 10.4's "sort-direction icon... once a sort is
// active") is not implemented here -- no page using this component
// yet has data where sorting is meaningful (Pool's rolling-windows
// rows have a fixed, meaningful order: 15m, 1h, 24h). Added when a
// page that actually needs it exists, not speculatively.

import { el } from "../core/dom.js";

function headerCellSpec(column) {
  const classes = ["data-table__h"];
  if (column.align === "right") classes.push("data-table__h--right");
  return el("th", {
    className: classes.join(" "),
    attrs: { scope: "col", role: "columnheader" },
    text: column.label,
  });
}

function bodyCellSpec(column, row) {
  const classes = ["data-table__cell"];
  if (column.align === "right") classes.push("data-table__cell--right");
  // docs/DESIGN_SYSTEM.md Section 5: "values where character ambiguity
  // matters (usernames, workernames, hashes)" use the monospace
  // typeface -- base.css's existing .mono utility class, not a new
  // data-table-specific style. Purely additive/opt-in: a column that
  // doesn't set `mono` renders exactly as before.
  if (column.mono) classes.push("mono");
  const value = row[column.key];
  return el("td", {
    className: classes.join(" "),
    attrs: { "data-label": column.label, role: "cell" },
    // Missing/null is rendered as a placeholder dash, not the string
    // "null"/"undefined" -- matching stat-tile.js's own convention for
    // a per-cell "no value yet" case, distinct from a page-level empty
    // state for "no rows at all" (docs/ARCHITECTURE.md Section 16).
    text: value === undefined || value === null ? "--" : String(value),
  });
}

export function dataTableSpec({ caption, columns, rows = [], className } = {}) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error("dataTableSpec: columns must be a non-empty array");
  }

  const classes = ["data-table"];
  if (className) classes.push(className);

  const children = [];
  if (caption) {
    // Accessible even when a visible title is already provided by a
    // surrounding Card (docs/DESIGN_SYSTEM.md Section 10.3) -- a
    // <caption> is scoped to the table itself, a screen reader
    // announces it when entering table navigation regardless of
    // whether sighted users also see a card title above it.
    children.push(el("caption", { className: "visually-hidden", text: caption }));
  }

  children.push(
    el("thead", {
      attrs: { role: "rowgroup" },
      children: [el("tr", { attrs: { role: "row" }, children: columns.map(headerCellSpec) })],
    }),
    el("tbody", {
      attrs: { role: "rowgroup" },
      children: rows.map((row) =>
        el("tr", {
          attrs: { role: "row" },
          children: columns.map((column) => bodyCellSpec(column, row)),
        }),
      ),
    }),
  );

  return el("div", {
    className: "data-table-wrap",
    // A future wider table (e.g. workers.js) could overflow
    // horizontally at the tablet range where the real <table> layout
    // is active -- tabindex + an accessible name make that scroll
    // region keyboard-reachable now, before a page that actually
    // overflows needs it (WCAG 2.1.1/1.4.10).
    attrs: {
      role: "region",
      tabindex: "0",
      "aria-label": caption || "Data table",
    },
    children: [el("table", { className: classes.join(" "), attrs: { role: "table" }, children })],
  });
}
