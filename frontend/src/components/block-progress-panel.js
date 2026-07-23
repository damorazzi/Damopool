// Phase E Milestone 30: Block Progress Analytics -- an educational, purely
// informational panel (explicit Human requirement: "not intended to
// predict future block finds or estimate probability") showing how a
// scope's own best accepted share compares to the current Bitcoin
// network difficulty. Deliberately a clean information panel, not a
// visualization: no gauge, no progress bar, no animation, no chart --
// four plain values, reusing the existing stat-tile look (docs/
// DESIGN_SYSTEM.md Section 10.5) rather than introducing a new visual
// style.
//
// Two of the four tiles ("Block Progress", "Still Needed") carry an
// explanatory tooltip. stat-tile.js's own statTileSpec has no tooltip
// support and is deliberately left unmodified (Human requirement: no
// existing functionality changed) -- tileSpec below is a small,
// self-contained equivalent producing the identical "card stat-tile"
// markup/classes (so it looks and behaves exactly like every other
// stat tile on the page), with one addition: an optional native `title`
// attribute on the label, the same plain-HTML-tooltip idiom this
// project already uses elsewhere (e.g. live-feed.js's title/aria-label
// pairing) rather than a new custom tooltip UI component.

import { el } from "../core/dom.js";
import { cardSpec } from "./card.js";

function tileSpec({ label, value, tooltip }) {
  const labelAttrs = tooltip ? { title: tooltip } : {};
  return cardSpec({
    className: "stat-tile",
    children: [
      el("div", { className: "stat-tile__label", attrs: labelAttrs, text: label }),
      el("div", {
        className: "stat-tile__value",
        text: value === undefined || value === null ? "--" : String(value),
      }),
    ],
  });
}

// The well-formed all-null fallback shape for a payload predating this
// milestone or missing the field defensively -- mirrors block_progress.py's
// own always-four-keys output, so a page's transform function never has
// a missing key to guard against separately.
export function emptyBlockProgress() {
  return {
    best_share_difficulty: null,
    network_difficulty: null,
    progress_percent: null,
    still_needed_multiplier: null,
  };
}

export function blockProgressPanelSpec({
  networkDifficultyText,
  bestShareText,
  progressPercentText,
  stillNeededText,
} = {}) {
  return cardSpec({
    title: "Block Progress",
    className: "block-progress-panel",
    children: [
      el("div", {
        className: "tile-grid",
        children: [
          tileSpec({ label: "Current Network Difficulty", value: networkDifficultyText }),
          tileSpec({ label: "Best Share", value: bestShareText }),
          tileSpec({
            label: "Block Progress",
            value: progressPercentText,
            tooltip: "The percentage of today's Bitcoin network difficulty reached by your best accepted share.",
          }),
          tileSpec({
            label: "Still Needed",
            value: stillNeededText,
            tooltip: "How many times larger your best accepted share would need to be to equal today's network difficulty.",
          }),
        ],
      }),
    ],
  });
}
