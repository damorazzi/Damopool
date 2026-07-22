// Global Live Feed -- Phase E Milestone 27, docs/DESIGN_SYSTEM.md
// Section 10.8 (superseding the old Ticker Feed spec once
// pages/ticker.js is retired, Phase 3 of this milestone). A permanent,
// shell-owned status band shown on every page (Human Approval Brief
// 2026-07-21: "a permanent application status feed... one of the
// defining features of Damopool," not a replacement for the old
// per-page Ticker in spirit, even though it does supersede that page).
//
// Deliberately NOT wrapped in a Card (unlike ticker-feed.js) -- the
// wireframe in the Approval Brief places this as a full-width band
// directly under the header, above every page's own content, not a
// boxed panel within it.
//
// Marquee technique (Human-approved "Option A" from the investigation
// phase): the track renders `events` twice back-to-back and CSS
// animates a translateX loop from 0% to -50%, landing exactly on the
// start of the second (identical) copy -- the standard seamless-loop
// technique. The second copy is wrapped in aria-hidden so assistive
// tech only ever encounters each event once, not twice. Actual
// looping speed (px/second, so it stays constant regardless of event
// count -- Human: "smoothness is more important than the number of
// events") is computed at DOM-glue time (shell.js), not here -- this
// module has no DOM measurement, only spec-building.
//
// Priority styling (Human's explicit direction, point 8: "should not
// resemble a stock market ticker... professional live operations
// feed... priority communicated subtly... avoid excessive colour,
// flashing or animation") -- a `.live-feed__item--priority-N` class
// per FEED_EVENT_TYPES[type].priority; live-feed.css carries the
// actual subtle treatment (slightly larger icon/gold accent/heavier
// text for priority 1, muted for priority 3). No glow/pulse animation
// on arrival here, unlike ticker-feed.js's one-shot glow -- a
// deliberate simplification for this calmer surface, not an oversight.
//
// Interactive by design (Human point 9: "should feel like a
// navigation component, not simply an animated banner") -- every event
// renders as a real `<a href>` (buildHash-built by live-feed-events.js,
// already encoded), not inert text, following the same untrusted-text
// discipline as every other component rendering a username/workername
// (docs/ARCHITECTURE.md Section 18): `detail` reaches the DOM only via
// el()'s `text` field, never innerHTML.
//
// Bug found by the Human in real browser use (not caught by Code
// Review or the original test suite): `detail` is a full, untruncated
// username/workername -- every other place this project renders either
// field (users.js, workers.js, user-detail.js, worker-detail.js, the
// retired ticker-feed.js) truncates it visually via
// truncateAddress/truncateWorkername (Phase E Milestones 25/26) while
// keeping the full value reachable via `title`/`aria-label`. This
// component was built fresh in Milestone 27 and that convention was
// missed. Fixed: `truncatedDetail` picks the right truncation function
// (new_user carries a username; every other type carries a
// workername), and the outer link's `title`/`aria-label` carry the
// full "label: full value" text so a screen reader never reads the
// truncated ellipsis text instead of the real value -- the same
// title+aria-label rationale Code Review already established for
// users.js's/workers.js's own link cells (title alone isn't reliably
// announced by screen readers).

import { el } from "../core/dom.js";
import { FEED_EVENT_TYPES } from "../shell/live-feed-events.js";
import { truncateAddress, truncateWorkername, formatCompactSdiff, formatPercentage } from "../core/format.js";

function truncatedDetail(event) {
  return event.type === "new_user" ? truncateAddress(event.detail) : truncateWorkername(event.detail);
}

// Human-reported bug, real-browser use: this component originally
// showed only the icon/label/(truncated) detail -- every prior place
// this project has ever shown a "new best" (the retired ticker-feed.js
// itself) also showed the current vs. previous sdiff and an
// improvement percentage with a trend-up indicator, which was simply
// dropped when this component was built from scratch. Restored here,
// reading the same currentSdiff/previousSdiff/improvementPercentage
// fields live-feed-events.js now carries on the event object.
// currentSdiff exists for personal_best/best_ever/best_today;
// previousSdiff/improvementPercentage exist only for personal_best
// (best_ever/best_today have no "previous" value anywhere in
// analytics.json to compare against -- see live-feed-events.js's own
// comment on why those two are deliberately not given one).
function statsChildren(event) {
  const children = [];

  const currentLabel = formatCompactSdiff(event.currentSdiff);
  if (currentLabel) {
    children.push(el("span", { className: "live-feed__current-best", text: currentLabel }));
  }

  const previousLabel = formatCompactSdiff(event.previousSdiff);
  if (previousLabel) {
    children.push(el("span", { className: "live-feed__previous-best", text: `was ${previousLabel}` }));
  }

  // Matches the retired ticker-feed.js's own gating exactly: a
  // meaningful improvement is always positive (an exact 0% or a
  // missing value shows no trend at all, rather than implying progress
  // that didn't happen -- the same "no misleading up-arrow" rule
  // user-detail.js's own daily-improvement tile already applies).
  if (Number.isFinite(event.improvementPercentage) && event.improvementPercentage > 0) {
    children.push(
      el("div", {
        className: "live-feed__trend",
        children: [
          el("span", { className: "icon icon-trend-up", attrs: { "aria-hidden": "true" } }),
          el("span", { className: "live-feed__trend-value", text: formatPercentage(event.improvementPercentage) }),
        ],
      }),
    );
  }

  return children;
}

// The full text behind title/aria-label -- includes the stats, not
// just the label/detail, so a screen reader or hover tooltip conveys
// the same information the visible stats do, not a subset of it.
function fullText(event, label) {
  const parts = [`${label}: ${event.detail}`];
  const currentLabel = formatCompactSdiff(event.currentSdiff);
  if (currentLabel) parts.push(currentLabel);
  const previousLabel = formatCompactSdiff(event.previousSdiff);
  if (previousLabel) parts.push(`was ${previousLabel}`);
  if (Number.isFinite(event.improvementPercentage) && event.improvementPercentage > 0) {
    parts.push(formatPercentage(event.improvementPercentage));
  }
  return parts.join(", ");
}

function eventItemSpec(event, { hidden = false } = {}) {
  const meta = FEED_EVENT_TYPES[event.type];
  const priority = meta ? meta.priority : 3;
  const label = meta ? meta.label : event.type;
  const text = fullText(event, label);

  const classes = ["live-feed__item", `live-feed__item--priority-${priority}`];
  // The duplicate copy only exists to make the CSS -50% loop land
  // seamlessly on identical content (live-feed.css). Under
  // prefers-reduced-motion (where the track stops scrolling and
  // becomes a plain static list), this class lets live-feed.css hide
  // the duplicate outright -- without it, a reduced-motion user would
  // see every event twice in a row.
  if (hidden) classes.push("live-feed__item--duplicate");

  return el("li", {
    className: classes.join(" "),
    children: [
      el("a", {
        className: "live-feed__link",
        attrs: hidden
          ? { href: event.href, tabindex: "-1", "aria-hidden": "true" }
          : { href: event.href, title: text, "aria-label": text },
        children: [
          el("span", {
            className: `icon icon-${meta ? meta.icon : "info"} live-feed__icon`,
            attrs: { "aria-hidden": "true" },
          }),
          el("span", { className: "live-feed__label", text: label }),
          el("span", { className: "live-feed__detail", text: truncatedDetail(event) }),
          ...statsChildren(event),
        ],
      }),
    ],
  });
}

function trackSpec(events) {
  return el("ul", {
    className: "live-feed__track",
    children: [
      ...events.map((event) => eventItemSpec(event)),
      // The duplicate copy that makes the -50% loop land seamlessly on
      // identical content -- aria-hidden and unfocusable so screen
      // readers/keyboard users only ever reach each event once.
      ...events.map((event) => eventItemSpec(event, { hidden: true })),
    ],
  });
}

export function liveFeedSpec({ events = [] } = {}) {
  const hasEvents = events.length > 0;

  return el("div", {
    className: "live-feed",
    attrs: { "aria-label": "Live pool activity" },
    children: [
      el("div", {
        className: "live-feed__announcer visually-hidden",
        attrs: { "aria-live": "polite" },
      }),
      hasEvents
        ? el("div", { className: "live-feed__viewport", children: [trackSpec(events)] })
        : el("p", { className: "live-feed__empty", text: "No recent pool activity yet." }),
    ],
  });
}
