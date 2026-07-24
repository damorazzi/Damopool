// ECharts cannot read CSS custom properties directly -- docs/ARCHITECTURE.md
// Section 8/14 -- so this module reads the resolved values via
// getComputedStyle at chart-init time and builds a matching ECharts
// theme fragment, keeping chart colours in sync with the CSS theme
// without hand-duplicating a colour palette in JavaScript. Deliberately
// minimal: only the style fragments the Overview page's one chart
// actually needs (background, text, axis/split lines, one accent
// colour), not a full ECharts theme registration -- the complete
// charts layer is not being built speculatively (docs/ARCHITECTURE.md
// Section 14 names this module as required infrastructure for any
// chart, but "required" does not mean "build every future chart's
// needs now").

// Pure -- takes already-read token values and shapes them into the
// style fragments charts/*.js option-builders expect. Every input is
// optional; a missing token degrades to no colour override (ECharts'
// own default) rather than a hardcoded fallback colour that could
// silently drift from the design system.
export function buildEChartsTheme({
  textPrimary,
  textSecondary,
  border,
  accent,
  fontFamily,
} = {}) {
  const textColor = textPrimary || undefined;
  const lineColor = border || undefined;

  return {
    backgroundColor: "transparent",
    textStyle: {
      color: textColor,
      fontFamily: fontFamily || undefined,
    },
    axisLine: { lineStyle: { color: lineColor } },
    splitLine: { lineStyle: { color: lineColor } },
    axisLabel: { color: textSecondary || textColor },
    accentColor: accent || undefined,
  };
}

// DOM-dependent glue -- reviewed by reading, the same tradeoff already
// made for router.js's createRouter and shell.js's mountShell.
export function readThemeTokens(root = document.documentElement) {
  const styles = getComputedStyle(root);
  const read = (name) => styles.getPropertyValue(name).trim() || undefined;

  return {
    textPrimary: read("--color-text-primary"),
    textSecondary: read("--color-text-secondary"),
    border: read("--color-border"),
    // --color-accent-text, not the bare fill value: Phase F verified the
    // bare --color-accent value fails 3:1 non-text contrast on light
    // theme (1.32:1/1.40:1 against --color-bg/--color-surface -- see
    // docs/DESIGN_SYSTEM.md Section 13), the same failure already fixed
    // for border/outline use. -text already clears the stricter 4.5:1
    // text threshold on light theme, so it clears 3:1 too, and is
    // identical to the bare value on dark theme, so chart line/marker
    // colours are unaffected there.
    accent: read("--color-accent-text"),
    fontFamily: read("--font-family-base"),
  };
}
