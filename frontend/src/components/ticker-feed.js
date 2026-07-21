// docs/DESIGN_SYSTEM.md Section 10.8 / docs/ARCHITECTURE.md Section 17:
// a vertical list of live-ticker entries inside a Card, each showing
// username/workername, current vs. previous daily best, the
// improvement figure (coloured text + trend-up icon -- a live-ticker
// entry always represents a new best, per analytics.json's schema
// comment "sorted newest first" alongside pages/ticker.js's own
// improvement_percentage > 0 gate, so unlike stat-tile.js's
// bidirectional trend there is no "down" case to render here), and a
// relative timestamp.
//
// Section 17 requires new entries to be announced to screen readers.
// The `<ul>` list itself is NOT the aria-live host -- it is fully
// rebuilt on every render (the same pure-spec-rebuild approach every
// other page in this project uses for its non-canvas/non-input
// markup), and a live region only reliably announces a mutation on a
// node that persists in the DOM; putting aria-live on a node that is
// itself destroyed and recreated every render does not reliably
// announce anything. Instead, a separate, dedicated, visually-hidden
// `.ticker-feed__announcer` element carries `aria-live="polite"` --
// pages/ticker.js preserves that one specific node across a same-
// status render (the same node-swap technique already used for a chart
// canvas/search input elsewhere in this project) and sets its
// textContent imperatively, only on a render that found a genuinely
// new entry, via its own pure buildAnnouncementText. This component
// only renders the (initially empty) placeholder element; it owns no
// announcement text itself.
//
// A caller marks an entry `isNew: true` (pages/ticker.js's own pure
// markNewEntries, diffed against the previous poll) to get the
// one-cycle fade/slide-in + glow-accent highlight Section 10.8
// describes, via a single CSS class present only on the render where
// the entry is new -- not a persistent state this component tracks
// itself, since every render is already a fresh spec.
// `styles/components/ticker-feed.css` (Phase E Milestone 20)
// implements that animation.
//
// username/workername reach the DOM exclusively through el()'s `text`
// field (specToDom -> textContent, never innerHTML) and `attrs.href`
// (setAttribute, never string-concatenated markup) -- the same
// untrusted-free-text handling as every other page rendering these
// fields (docs/ARCHITECTURE.md Section 18).
//
// Section 10.8's literal text names only workername for the entry;
// username is also rendered (as an identically-styled mono link) since
// without it there would be no way to tell which pool user a given
// entry belongs to -- a deliberate, necessary extension of the spec,
// not an unexamined addition.
//
// Truncated the same way as users.js's/workers.js's own list-page cell
// specs (Phase E Milestone 25/26) -- href stays built from the full
// value (unaffected), and title/aria-label carry the full value for
// hover/assistive-tech access, matching that established pattern
// exactly rather than inventing a different one for this page.

import { el } from "../core/dom.js";
import { cardSpec } from "./card.js";
import { truncateAddress, truncateWorkername } from "../core/format.js";

function entrySpec(entry) {
  const classes = ["ticker-feed__entry"];
  if (entry.isNew) classes.push("ticker-feed__entry--new");

  const trend = entry.improvementLabel
    ? el("div", {
        className: "ticker-feed__trend ticker-feed__trend--up",
        children: [
          el("span", { className: "icon icon-trend-up", attrs: { "aria-hidden": "true" } }),
          el("span", { className: "ticker-feed__trend-value", text: entry.improvementLabel }),
        ],
      })
    : null;

  return el("li", {
    className: classes.join(" "),
    children: [
      el("div", {
        className: "ticker-feed__identity",
        children: [
          el("a", {
            className: "ticker-feed__username mono",
            attrs: { href: entry.usernameHref, title: entry.username, "aria-label": entry.username },
            text: truncateAddress(entry.username),
          }),
          el("a", {
            className: "ticker-feed__workername mono",
            attrs: { href: entry.workernameHref, title: entry.workername, "aria-label": entry.workername },
            text: truncateWorkername(entry.workername),
          }),
        ],
      }),
      el("div", {
        className: "ticker-feed__bests",
        children: [
          el("span", { className: "ticker-feed__current-best", text: entry.currentBestLabel }),
          el("span", { className: "ticker-feed__previous-best", text: `was ${entry.previousBestLabel}` }),
        ],
      }),
      trend,
      el("span", { className: "ticker-feed__timestamp", text: entry.timestampLabel }),
    ].filter(Boolean),
  });
}

export function tickerFeedSpec({ title, entries = [], className } = {}) {
  const classes = ["ticker-feed"];
  if (className) classes.push(className);

  return cardSpec({
    title,
    className: classes.join(" "),
    children: [
      el("div", {
        className: "ticker-feed__announcer visually-hidden",
        attrs: { "aria-live": "polite" },
      }),
      el("ul", {
        className: "ticker-feed__list",
        children: entries.map(entrySpec),
      }),
    ],
  });
}
