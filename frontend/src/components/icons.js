// docs/DESIGN_SYSTEM.md Section 8: a small, hand-picked set of inline SVG
// icons, stroke-based (2px stroke), single colour via currentColor. Pure
// spec-builders only -- no DOM APIs here, matching every other
// spec-builder in this codebase (core/dom.js's specToDom is the only
// place a spec becomes a real node, including the SVG-namespace elements
// this module produces specs for).
//
// Scope: exactly the icon names that have a real call site in shipped
// code today. docs/DESIGN_SYSTEM.md Section 8 also names sort-ascending,
// sort-descending, and copy; none has a call site anywhere in this
// codebase (no sortable table, no copy-to-clipboard control has been
// built), so none is implemented here -- matching this project's own
// "add it when a page that actually needs it exists" convention
// (data-table.js's and search-box.js's own module comments). trophy,
// chart, user, and worker were added to shell/live-feed-events.js's
// FEED_EVENT_TYPES registry at Milestone 27 but were never added to
// Section 8's documented icon list -- closed here and in that section.

import { el } from "../core/dom.js";

function svgIcon(children) {
  return el("svg", {
    attrs: {
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      focusable: "false",
    },
    children,
  });
}

function line(x1, y1, x2, y2) {
  return el("line", { attrs: { x1, y1, x2, y2 } });
}

function circle(cx, cy, r, extra = {}) {
  return el("circle", { attrs: { cx, cy, r, ...extra } });
}

function polyline(points) {
  return el("polyline", { attrs: { points } });
}

function path(d, extra = {}) {
  return el("path", { attrs: { d, ...extra } });
}

// A tiny filled dot (fill: currentColor, no stroke) for the "i" in the
// info glyph and the "!" dot in the warning glyph -- both are small
// filled shapes, not strokes, matching how a real dot renders at 2px
// stroke width without becoming an oversized circle outline.
function dot(cx, cy) {
  return circle(cx, cy, 1, { fill: "currentColor", stroke: "none" });
}

export const ICONS = {
  search: () => svgIcon([circle(11, 11, 7), line(21, 21, 16.65, 16.65)]),

  close: () => svgIcon([line(6, 6, 18, 18), line(18, 6, 6, 18)]),

  "trend-up": () =>
    svgIcon([polyline("3 17 9 11 13 15 21 7"), polyline("14 7 21 7 21 14")]),

  "trend-down": () =>
    svgIcon([polyline("3 7 9 13 13 9 21 17"), polyline("21 10 21 17 14 17")]),

  info: () => svgIcon([circle(12, 12, 10), line(12, 16, 12, 12), dot(12, 8)]),

  warning: () =>
    svgIcon([path("M12 2 L2 21 L22 21 Z"), line(12, 9, 12, 13), dot(12, 17)]),

  error: () => svgIcon([circle(12, 12, 10), line(15, 9, 9, 15), line(9, 9, 15, 15)]),

  "external-link": () =>
    svgIcon([
      path("M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"),
      polyline("15 3 21 3 21 9"),
      line(10, 14, 21, 3),
    ]),

  // A generic sun/theme glyph -- deliberately not state-reactive (the
  // toggle button's aria-pressed already communicates the current
  // theme; this icon labels the control, not the current state, per
  // the existing single "icon icon-theme" class used regardless of
  // theme in shell.js).
  theme: () =>
    svgIcon([
      circle(12, 12, 5),
      line(12, 1, 12, 3),
      line(12, 21, 12, 23),
      line(4.22, 4.22, 5.64, 5.64),
      line(18.36, 18.36, 19.78, 19.78),
      line(1, 12, 3, 12),
      line(21, 12, 23, 12),
      line(4.22, 19.78, 5.64, 18.36),
      line(18.36, 5.64, 19.78, 4.22),
    ]),

  trophy: () =>
    svgIcon([
      path("M8 21h8"),
      path("M12 17v4"),
      path("M7 4h10v4a5 5 0 0 1-10 0V4z"),
      path("M7 5H4a2 2 0 0 0 0 4h1.5"),
      path("M17 5h3a2 2 0 0 0 0 4h-1.5"),
    ]),

  chart: () => svgIcon([line(4, 20, 4, 10), line(12, 20, 12, 4), line(20, 20, 20, 14)]),

  user: () =>
    svgIcon([circle(12, 8, 4), path("M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2")]),

  worker: () =>
    svgIcon([
      el("rect", { attrs: { x: 4, y: 4, width: 16, height: 16, rx: 2 } }),
      line(9, 1, 9, 4),
      line(15, 1, 15, 4),
      line(9, 20, 9, 23),
      line(15, 20, 15, 23),
    ]),
};

// Returns an array (zero or one element) suitable for spreading directly
// into an el() children list -- callers append this into an existing
// "icon icon-<name>" span's children rather than replacing the span
// itself, so the existing base.css `.icon`/`.icon:empty` sizing and
// hide-when-empty behaviour is unaffected for any icon name this
// registry doesn't (yet) cover. Returning an array rather than a
// possibly-null spec means a caller can always safely write
// `children: [...iconChildren(name)]` without a null-check, even where
// `name` is computed from data (e.g. a future feed-event type with no
// matching icon) rather than a fixed literal.
export function iconChildren(name) {
  const build = ICONS[name];
  return build ? [build()] : [];
}
