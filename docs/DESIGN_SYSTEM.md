# Damopool Design System

**Feature 007, Phase C.** Visual design only — the complete design system
and component library, produced before any individual page design, per
explicit instruction. No frontend code has been written. Implementation
(Phase D) is a separate, later step requiring its own approval.

## 1. Purpose and Scope

This document is the single source of visual truth for the Damopool
website: colour, typography, spacing, elevation, iconography, motion, and
a full component library. It supplies the actual values that
`docs/ARCHITECTURE.md`'s theme system (Section 8) and CSS architecture
(Section 7) described mechanically but did not specify.

The governing rule for everything that follows, stated once here so it
does not need repeating per component: **every future page is assembled
from this component library. No page introduces its own one-off styling.**
A new page that needs a visual treatment not covered here means this
document needs a new component, not a page-level exception — the
consistency this produces ("every page should appear consistent",
`docs/ARCHITECTURE.md` Section 5) is a direct, mechanical consequence of
this rule being followed, not something achieved by discipline alone.

Individual page layouts are Phase D's job, done by composing these
components. This document defines the vocabulary; it does not use it to
draw pages, beyond the three illustrative wireframes already in
`docs/ARCHITECTURE.md` Section 22, which are referenced at several points
below (Sections 10.1, 10.5, 10.11, and 11) but not redrawn here.

## 2. Design Principles

- **Professional over decorative.** Damopool is a production financial
  tool (it displays real mining performance and, indirectly, payout
  activity) wearing the visual language of a commercial dashboard, not a
  hobby project.
- **Readability first.** Numeric data is the product. Every decision
  below — type scale, contrast, spacing, table design — is checked
  against "can a user scan this table of sdiff values quickly and
  correctly," not just "does this look good."
- **Consistency through reuse, not convention.** Section 1's rule is
  enforced structurally: a shared component library, not a style guide
  people are expected to remember.
- **Restraint.** The current site's brand identity (Section 3) is real
  and worth keeping, but its heaviest expression — a glow/outline effect
  applied to nearly every heading, label, button, and input on the page —
  reads as clutter at commercial-product scale. This document keeps the
  identity and narrows where its strongest effects are actually used.
- **Accessibility is a requirement, not a finishing touch.** Every colour
  pairing in Section 4 is contrast-checked against WCAG AA before being
  included, not asserted and checked later.

## 3. Brand Identity and Visual Language

The current live site (`/var/www/html/index.html`) already has a real,
recognizable identity, verified directly against its CSS rather than
assumed: a gold/amber accent (`--primary: #ffd700`), a darker background
on individual boxed/card elements (`--background: #3f3838`), and a
neon-glow motif (an animated `text-shadow` pulse, `boxGlow`) — but the
page canvas itself (`body { background: var(--light-bg) }`,
`--light-bg: #696969`) is a medium grey with white text, not dark. Only
the boxed content sits on a dark background; the page around it does
not. This design system keeps the gold accent, the dark boxed-surface
convention, and the glow-as-accent motif — because they are real and
already associated with the product — but its own page canvas
(`--color-bg: #12100d`, Section 4.1) is considerably darker than the live
site's actual grey page background. This is a deliberate departure, not
an extension of what's there today: a near-black canvas throughout (not
just inside boxes) is judged to read as more consistently professional
at commercial-product scale than a mid-grey canvas with darker boxes
floating on it, but it is worth being explicit that this is a change to
the page-level colour, not merely a continuation of it.

The current site applies a `text-stroke` outline to every `h1`, `h2`,
`p`, `label`, `button`, and `input` on the page; the animated
`text-shadow` pulse (`neonPulse`) is narrower in practice, applied only
to the page's main heading and modal headings, not broadly to labels,
buttons, and inputs the way the outline is. At commercial-product scale,
with many more pages and much more on-screen data than the current
single page, applying either effect that broadly would read as visual
noise around every number a user is trying to read. This design system
keeps the glow (in its `--glow-accent` form, Section 7) as a *highlight*
effect — reserved for a small number of meaningful moments (a new best
share, a live ticker entry arriving, an active focus ring) — rather than
a baseline treatment applied to ordinary text and controls. This is a
direct application of the "avoid visual clutter, prioritise readability"
instruction, applied to a specific, concrete decision rather than left as
a general aspiration.

## 4. Design Tokens: Colour

Two themes, dark (default) and light, both built from named semantic
roles rather than direct colour references anywhere in component
markup — a component says `background: var(--color-surface)`, never
`background: #1e1a15` — so a future palette adjustment is a token-file
change (per `docs/ARCHITECTURE.md` Section 8's `data-theme` mechanism),
not a hunt through every component's CSS.

### 4.1 Dark theme (default)

| Token | Value | Role |
|---|---|---|
| `--color-bg` | `#12100d` | Page background |
| `--color-surface` | `#1e1a15` | Card, table, panel background |
| `--color-surface-raised` | `#26211a` | Hover / elevated surface |
| `--color-border` | `#3a332a` | Default borders, dividers |
| `--color-text-primary` | `#f5f1e8` | Primary text |
| `--color-text-secondary` | `#b8ae9c` | Secondary/muted text, labels |
| `--color-accent` | `#ffd700` | Brand accent — links, primary buttons, active states, headline numbers |
| `--color-success` | `#4caf50` | Positive values, "active" status, improvement |
| `--color-danger` | `#e05252` | Errors, rejected shares, destructive actions |

### 4.2 Light theme

| Token | Value | Role |
|---|---|---|
| `--color-bg` | `#faf8f3` | Page background |
| `--color-surface` | `#ffffff` | Card, table, panel background |
| `--color-surface-raised` | `#f0ece1` | Hover / elevated surface |
| `--color-border` | `#ddd6c7` | Default borders, dividers |
| `--color-text-primary` | `#1e1a15` | Primary text |
| `--color-text-secondary` | `#6b6152` | Secondary/muted text, labels |
| `--color-accent` | `#ffd700` | Large surfaces only (button fills, icons) — see 4.3 for text use |
| `--color-accent-text` | `#8a6d00` | Accent used as text/links — darkened for AA on a light background |
| `--color-success` | `#2e7d32` | Non-text fill (dots, borders) — see 4.3, identical to `-text` on light theme |
| `--color-success-text` | `#2e7d32` | Text/links — darkened for AA on a light background |
| `--color-danger` | `#e05252` | Non-text fill only (dots, borders) — see 4.3 for text use |
| `--color-danger-text` | `#c62828` | Text/links — darkened for AA on a light background |

### 4.3 Why the light theme has separate `-text` tokens, and why `--color-success` is one exception

Pure `#ffd700` gold has excellent contrast on the dark background (13.5:1
— see Section 13) but poor contrast on a light background: it is a bright
colour, and bright-on-light fails WCAG AA for text. The dark theme has no
equivalent problem (gold reads fine on `#12100d` and `#1e1a15` alike), so
this asymmetry is real, not an oversight — `--color-accent` is safe to
use as a background fill in both themes (a gold button with dark text on
top), but text/links rendered *in* accent colour must use the darkened
`-text` variant on light theme specifically.

The same fill/text split applies to `--color-success` and
`--color-danger`, measured the same way (Section 13 covers text use;
non-text/fill use only needs the lower 3:1 WCAG threshold for UI
components, separately verified for this document): on light theme,
`--color-danger`'s dark-theme value (`#e05252`) clears 3:1 against both
light backgrounds (3.60:1 / 3.82:1) so it stays usable as a border or
status-dot fill, but falls short of 4.5:1 for text (3.60:1 / 3.82:1
again — the same numbers, since text and non-text use the identical
pairing), which is why `--color-danger-text` exists as a separately
darkened value. `--color-success`'s dark-theme value (`#4caf50`) is the
one case where this split isn't possible: on light theme it fails even
the lower 3:1 non-text threshold (2.62:1 / 2.78:1), so there is no
usable "bright fill" shade left to offer — `--color-success` and
`--color-success-text` are therefore the same darkened value
(`#2e7d32`) on light theme, both tokens kept only so every component in
Section 10 can consistently reference "`--color-success` for fills,
`--color-success-text` for text" without needing to know this one colour
is an exception.

### 4.4 Chart categorical palette

For multi-series ECharts panels (`docs/ARCHITECTURE.md` Section 14),
reusing the current site's already-established chart colours for
continuity:

| Series | Colour | Note |
|---|---|---|
| 1 (primary, e.g. current) | `--color-accent` (`#ffd700`) | Matches brand accent |
| 2 | `#87ceeb` | Existing site's line colour |
| 3 | `#ff7f50` | Existing site's item colour |
| 4 (e.g. previous/comparison) | `#ffa500` | Existing site's dashed-line colour |
| 5 | `--color-success` (`#4caf50`) | Reused rather than adding a sixth new colour |

**Open item, not resolved here:** series 3 (`#ff7f50`, coral) and series 4
(`#ffa500`, orange) are close enough in hue that they may not be reliably
distinguishable for red-green colour-blind users. This palette is
inherited from the live site rather than invented, so it is flagged
rather than silently kept — a colour-blindness simulation pass on the
actual rendered charts is recommended before or during Phase D, with the
fallback being to differentiate series 3/4 by line style (solid vs
dashed, already used for the current/previous distinction on the live
site) rather than by hue alone.

## 5. Design Tokens: Typography

**Type faces.** No web font — a system font stack, consistent with
`docs/ARCHITECTURE.md`'s "avoid unnecessary dependencies" principle
(Section 3.1) and its performance strategy (Section 20): a font file is
a render-blocking dependency with no functional justification here.

```
--font-family-base: -apple-system, BlinkMacSystemFont, "Segoe UI",
  Roboto, Helvetica, Arial, sans-serif;
--font-family-mono: ui-monospace, "SF Mono", "Cascadia Code", "Consolas",
  "Roboto Mono", monospace;
```

`--font-family-mono` is used specifically for values where character
ambiguity matters and alignment matters: usernames/workernames (a
Bitcoin address or a hand-typed worker name, where `0`/`O` and `1`/`l`
confusion is a real usability problem), and any raw hash value. It is
**not** used for ordinary numeric stats (sdiff, percentages, counts) —
those use `--font-family-base` with `font-variant-numeric: tabular-nums`
instead, which gives column alignment in tables without loading or
declaring a second typeface as the default number treatment.

**Type scale** (base 16px, applied via `rem` so it respects a user's
browser font-size setting):

| Token | Size | Typical use |
|---|---|---|
| `--font-size-xs` | 0.75rem (12px) | Table meta text, timestamps |
| `--font-size-sm` | 0.875rem (14px) | Secondary text, labels |
| `--font-size-base` | 1rem (16px) | Body text |
| `--font-size-md` | 1.125rem (18px) | Card titles |
| `--font-size-lg` | 1.25rem (20px) | Section headings |
| `--font-size-xl` | 1.5rem (24px) | Page headings |
| `--font-size-2xl` | 2rem (32px) | Stat tile primary value |
| `--font-size-3xl` | 2.5rem (40px) | Landing page headline only |

**Weights:** `--font-weight-regular: 400`, `--font-weight-medium: 500`
(stat values, active nav item), `--font-weight-semibold: 600` (headings,
card titles), `--font-weight-bold: 700` (landing headline only — used
sparingly, per Section 2's restraint principle).

**Line heights:** `--line-height-tight: 1.2` (headings),
`--line-height-base: 1.5` (body copy), `--line-height-compact: 1.4`
(table cells, dense UI).

## 6. Design Tokens: Spacing

A 4px base unit, consistent with `docs/ARCHITECTURE.md`'s responsive
breakpoints being defined as tokens rather than hard-coded (Section 12):

```
--space-1: 4px;   --space-2: 8px;   --space-3: 12px;  --space-4: 16px;
--space-5: 24px;  --space-6: 32px;  --space-7: 48px;  --space-8: 64px;
```

Rule of thumb: `--space-2`/`--space-3` for internal component padding
(button padding, table cell padding), `--space-4`/`--space-5` for gaps
between related elements (stat tiles in a row), `--space-6` and above for
separation between distinct sections of a page.

## 7. Design Tokens: Radius, Border, Elevation

```
--radius-sm: 4px;    /* inputs, badges, small buttons */
--radius-md: 8px;    /* cards, panels, buttons */
--radius-lg: 12px;   /* large containers, chart panels */
--radius-full: 9999px; /* pills, status badges */

--border-width: 1px;
--border-color: var(--color-border);
```

On a dark background, `box-shadow` for elevation reads poorly (shadows
need a lighter surrounding colour to be visible against). Elevation is
therefore expressed primarily through `--color-surface-raised` (a
lightness step, not a shadow) plus the existing `--border-color`, for
both themes — consistent, not theme-conditional. The one exception is
the "highlight" glow described in Section 3: a low-opacity, accent-
coloured `box-shadow` reserved for a small, named set of moments (new
best share, active focus ring, a ticker entry that just arrived), defined
once as `--glow-accent: 0 0 12px rgba(255, 215, 0, 0.35)` and applied only
by the specific components in Section 10 that call for it — never as a
default card or button treatment.

## 8. Iconography

No icon font, no external icon library (same dependency reasoning as
Section 5) — a small, hand-picked set of inline SVG icons, stroke-based
(2px stroke, matching a clean, modern outline aesthetic), single colour
via `currentColor` so every icon automatically inherits its container's
text or accent colour in either theme with no separate icon-colour
tokens needed.

Sizes: `--icon-size-sm: 16px`, `--icon-size-md: 20px` (default, matches
inline text), `--icon-size-lg: 24px` (standalone/nav icons).

Icon set needed for Feature 007's scope (v1; more added additively as
later features need them, never requiring a different icon system):
search, sort-ascending/sort-descending, trend-up/trend-down (daily-best
improvement), status-dot (worker active/inactive), theme (sun/moon
toggle), external-link, copy (for copying a username/address), close,
info, warning, error, chevron (expand/collapse, pagination), hamburger
(mobile nav toggle, Section 10.7).

## 9. Motion and Animation

```
--duration-fast: 120ms;   /* hover, focus */
--duration-base: 200ms;   /* most transitions */
--duration-slow: 320ms;   /* ticker entry arrival, route/view transitions */
--ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
```

Motion is used for state feedback (hover, focus, loading), not
decoration: button/link hover, focus-ring appearance, skeleton-to-content
swap on load (`docs/ARCHITECTURE.md` Section 16), and a new live-ticker
entry's arrival (a brief fade-and-slight-slide using `--duration-slow`
and `--ease-standard`, plus the `--glow-accent` highlight from Section 7
for one cycle).

Every animation defined here has a reduced form behind
`prefers-reduced-motion: reduce` — slide/fade transitions collapse to an
instant, opacity-only change (or no transition at all for the ticker
entry). This is new scope introduced at Phase C, not an existing
`docs/ARCHITECTURE.md` decision being implemented — Architecture Section
17 (Accessibility Strategy) does not mention reduced motion, so this
document is the first place that requirement is recorded, not a
restatement of one made earlier.

## 10. Component Library

Each component is specified by its states (not just its default
appearance) — the actual, common failure mode this section prevents is a
"default" mockup that never says what a disabled button, an empty table,
or a focused input actually looks like, leaving that to be improvised
per-page later.

### 10.1 Buttons

Variants: **primary** (solid `--color-accent` fill, dark text for
contrast, for the single most important action on a view), **secondary**
(transparent fill, `--color-accent` border, text in `--color-accent`
(dark theme) / `--color-accent-text` (light theme) — the border can stay
the brighter fill colour on both themes since a border is a non-text
element (3:1 threshold), but the text inside the button follows the same
theme-conditional rule as every other text use of accent colour, Section
4.3), **ghost** (no border, text-only, same theme-conditional colour rule
as secondary — this is also the variant used for a back-link/breadcrumb,
e.g. the User Detail wireframe's "← Back to Users",
`docs/ARCHITECTURE.md` Section 22), **danger** (`--color-danger` fill —
reserved for future destructive actions, e.g. admin/miner-management in
later features, not used anywhere in Feature 007's own scope).

Sizes: sm (`--space-2` vertical / `--space-3` horizontal padding, `
--font-size-sm`), md (default — `--space-3`/`--space-4`, `--font-size-base`),
lg (`--space-4`/`--space-5`, `--font-size-md`).

States: default; hover (`--color-surface-raised`-equivalent lightening,
`--duration-fast`); focus-visible (a visible 2px `--color-accent` outline
with `2px` offset — never removed, only restyled, per
`docs/ARCHITECTURE.md` Section 17's accessibility strategy); active
(slight scale/darken); disabled (`0.5` opacity, no
hover/active response, `cursor: not-allowed`); loading (label replaced by
a small inline spinner, button remains its committed width so the layout
doesn't shift).

### 10.2 Forms and Inputs

Text input and the search box (`docs/ARCHITECTURE.md`'s `search-box.js`)
share one base style: `--color-surface` background, `--border-color`
border, `--radius-sm`, `--space-2`/`--space-3` padding. Search box adds a
leading search icon (Section 8) and, once a query is entered, a trailing
clear ("×") icon button.

States: default; focus (border becomes `--color-accent`, plus the same
focus-visible outline as buttons); error (border becomes `--color-danger`
— a non-text border use, same value in both themes, Section 4.3 — with a
short helper text below in `--color-danger` (dark theme) /
`--color-danger-text` (light theme), since helper text is a text use);
disabled (`0.5` opacity, `--color-surface` stays flat, no focus
response).

### 10.3 Cards

The base container for most content: `--color-surface` background,
`--border-color` border, `--radius-md`, `--space-4` internal padding.
Optional header slot (title, `--font-size-md`/`--font-weight-semibold`,
bottom border) and optional footer slot (meta text, e.g. "data as of Xm
ago" staleness indicator from `docs/ARCHITECTURE.md` Section 15).

**Highlight variant**: adds the `--glow-accent` box-shadow and an
accent-coloured border, reserved for a small number of meaningful cards —
"today's best share," a newly-arrived ticker entry's card form — never
used as a general emphasis tool, per Section 2/3's restraint principle.

### 10.4 Data Tables

Header row: `--color-surface-raised` background, `--font-size-xs`
uppercase labels in `--color-text-secondary`, `--font-weight-medium`.
Body rows: `--color-surface` background, `--border-color` bottom border
per row (no zebra striping — a clean, low-noise table reads better at
this data density than alternating row colours, and it keeps the
`--glow-accent` highlight visually meaningful by not competing with
another background-colour signal). Row hover: `--color-surface-raised`.
Numeric columns: right-aligned, `tabular-nums`. Sortable column headers
get a small sort-direction icon (Section 8) that appears on hover and
persists once a sort is active.

**Mobile collapse** (below `768px`, matching
`docs/ARCHITECTURE.md` Section 12): each row becomes its own card
(Section 10.3's base card style), with each column rendered as a
`label: value` pair stacked vertically inside it, rather than horizontal
scroll or column-hiding.

### 10.5 Stat Tiles

A card variant purpose-built for a single headline number (pool
hashrate, accepted count, best share today): label at
`--font-size-sm`/`--color-text-secondary` above or below a large value at
`--font-size-2xl`/`--font-weight-medium` with `tabular-nums`. An optional
trend indicator (a small trend-up/trend-down icon from Section 8 plus a
percentage, in `--color-success`/`--color-danger` (dark theme) or
`--color-success-text`/`--color-danger-text` (light theme) — this is
coloured text, so it follows the 4.5:1 text rule, Section 4.3) sits
beside the value for anything with a meaningful daily comparison (the
daily-best improvement figures from `docs/ARCHITECTURE.md`'s
live-ticker/daily-bests data). The Landing page's single headline figure
(`docs/ARCHITECTURE.md` Section 22's "live pool hashrate headline stat")
is this same component at `--font-size-3xl` rather than a separate,
uncovered treatment — the larger size is Section 5's landing-headline-only
exception, not a different component.

### 10.6 Chart Panels

A card (Section 10.3) wrapping an ECharts instance
(`docs/ARCHITECTURE.md` Section 14). The ECharts theme object
(`charts/theme-echarts.js`) reads `--color-text-primary`,
`--color-text-secondary`, `--color-border`, and the Section 4.4
categorical palette via `getComputedStyle`, so chart colours always match
the active theme without a separate chart-specific colour definition.
Axis lines use `--color-border`; axis labels use `--color-text-secondary`
at `--font-size-xs`. Per `docs/ARCHITECTURE.md` Section 17, every chart
panel is paired with an adjacent accessible summary — rendered as
visually-hidden text within the same card, not a separate component.

### 10.7 Navigation

A header that stays pinned to the top of the viewport while the page
scrolls, so navigation stays reachable while scrolling a long table or
chart — chosen deliberately over a header that scrolls away with the
page, since the dashboard's primary content (tables, charts) is often
taller than one viewport. Contains: logo/wordmark, the nav link list
(`docs/ARCHITECTURE.md` Section 10), and the theme toggle, at `--space-4`
height padding.

Active link: text in `--color-accent` (dark theme) / `--color-accent-text`
(light theme) plus a `2px` bottom border in `--color-accent` (a border is
non-text, so it can stay the brighter fill colour on both themes,
Section 4.3) — no background pill, keeping the header visually quiet
per Section 2's restraint principle. Below `768px`, the nav link list
collapses behind a hamburger control (Section 8's icon set) into a
full-width dropdown panel using `--color-surface` and
`--duration-base`/`--ease-standard` for the open/close transition.

### 10.8 Ticker Feed

A vertical list of entries inside a card, each entry: workername
(`--font-family-mono`, per Section 5), the improvement figure (coloured
text, so it follows Section 4.3's rule — `--color-success` on dark theme,
`--color-success-text` on light theme — plus a trend-up icon), and a
relative timestamp
(`--font-size-xs`, `--color-text-secondary`). The container is an ARIA
live region (`docs/ARCHITECTURE.md` Section 17); a newly-arrived entry
gets the fade/slide-in motion from Section 9 plus one cycle of the
`--glow-accent` highlight (Section 7), then settles into the plain entry
style — so the "new arrival" signal is temporary and doesn't accumulate
into a permanently glowing list.

### 10.9 Badges / Status Indicators

Small `--radius-full` pills, `--font-size-xs`, used for worker
`is_active` status (`--color-success` dot + "Active" / muted
`--color-text-secondary` dot + "Inactive", per
`docs/ARCHITECTURE.md`'s `workers` schema) and for share result where a
compact indicator is needed: `--color-success` dot + "Accepted" /
`--color-danger` dot + "Rejected" — both dots are non-text fills, so the
same values are used in both themes (Section 4.3). Not used as a general
"put a colour on it" device — restricted to genuine binary/small-enum
status fields already present in `analytics.json`.

### 10.10 Loading, Empty, and Error States

Visual treatment for the three states `docs/ARCHITECTURE.md` Section 16
already defines behaviourally:

- **Loading skeleton**: `--color-surface-raised` blocks matching the
  final content's approximate shape and size (a stat tile skeleton is
  tile-shaped, a table skeleton is row-shaped), with a slow, subtle
  opacity pulse (`--duration-slow`, looping) — never a spinner for
  skeleton loading, spinners are reserved for button-loading state
  (Section 10.1) where there's no layout to preview.
- **Empty state**: centred icon (Section 8's `info` icon, `--icon-size-lg`,
  `--color-text-secondary`) plus a short message in
  `--font-size-sm`/`--color-text-secondary`, inside the same card
  container the real content would otherwise occupy — so an empty view
  doesn't collapse to a jarringly different layout.
- **Error banner**: full-width, `--color-danger` left border (`3px`) on a
  `--color-surface` background, `warning`/`error` icon (Section 8), the
  error message, and — if a cached payload exists
  (`docs/ARCHITECTURE.md` Section 15/16) — the stale content remains
  visible below the banner rather than being hidden.

### 10.11 Footer

Part of the shared shell (`docs/ARCHITECTURE.md` Section 5, `shell.js`),
rendered once and shown on every page — MPA and SPA alike, matching how
the header is shared (Section 10.7). `--color-bg` background (matching
the page canvas rather than `--color-surface`, so the footer reads as
part of the page rather than a card), a `1px` top `--color-border`
divider, `--space-6` vertical padding, content in
`--font-size-sm`/`--color-text-secondary`. Contains, per the Landing
wireframe (`docs/ARCHITECTURE.md` Section 22, "links, generated-at
disclosure, GH, etc."): a small set of ghost-button-style text links
(Section 10.1), the same "data as of Xm ago" staleness text used
elsewhere (Section 10.3's card footer slot, `docs/ARCHITECTURE.md`
Section 15), and an external link (Section 8's `external-link` icon) to
the project's public repository.

## 11. Responsive Layout Grids

Matches `docs/ARCHITECTURE.md` Section 12's breakpoints exactly (this
document supplies layout column counts, not new breakpoints):

| Breakpoint | Range | Grid |
|---|---|---|
| Mobile | `< 480px` | 1 column, `--space-4` page margin |
| Small tablet | `480–768px` | 1 column, `--space-5` page margin, stat tiles may pair 2-up |
| Tablet | `768–1024px` | 2 columns for card/tile grids, tables un-collapse to full rows, `--space-6` page margin |
| Desktop | `1024–1280px` | Up to 3–4 columns for stat-tile rows, two-column layout for chart+side-panel views (per the `docs/ARCHITECTURE.md` Section 22 wireframes), `--space-6` page margin |
| Wide desktop | `≥ 1280px` | Same column structure as Desktop with a `1280px` max-content-width and centred page margins, rather than stretching content edge-to-edge on very wide screens |

## 12. Theming Mechanics (recap, values only)

The mechanism itself — `data-theme` attribute, `localStorage`
persistence, `prefers-color-scheme` fallback, precedence order — is
already fully specified in `docs/ARCHITECTURE.md` Section 8 and is not
redefined here. This document is what populates `tokens.css` (Sections
5–9's theme-independent values — typography, spacing, radius/elevation,
icons, motion), `theme-dark.css` (Section 4.1's colour values), and
`theme-light.css` (Section 4.2's colour values) once Phase D begins.

## 13. Accessibility Verification

Every text/background colour pairing used anywhere in Section 4 was
computed against the WCAG 2.1 relative-luminance formula (not estimated),
using the actual token hex values above:

**Dark theme:**

| Pairing | Ratio | AA (4.5:1) |
|---|---|---|
| text-primary on bg | 16.85:1 | Pass |
| text-secondary on bg | 8.66:1 | Pass |
| accent on bg | 13.54:1 | Pass |
| accent on surface | 12.34:1 | Pass |
| success on bg | 6.83:1 | Pass |
| danger on bg | 4.97:1 | Pass |
| text-primary on surface | 15.35:1 | Pass |
| text-secondary on surface | 7.89:1 | Pass |

**Light theme:**

| Pairing | Ratio | AA (4.5:1) |
|---|---|---|
| text-primary on bg | 16.30:1 | Pass |
| text-secondary on bg | 5.72:1 | Pass |
| accent-text on bg | 4.64:1 | Pass |
| accent-text on surface | 4.92:1 | Pass |
| success-text on bg | 4.83:1 | Pass |
| danger-text on bg | 5.30:1 | Pass |
| text-primary on surface | 17.30:1 | Pass |
| text-secondary on surface | 6.07:1 | Pass |

Every pairing passes WCAG AA; several dark-theme pairings also pass the
stricter AAA (7:1) threshold. `accent-text` on light theme (4.64:1,
4.92:1) is the closest to the AA floor — this is expected, since it was
deliberately darkened just enough to clear AA while staying visually
identifiable as "the gold accent, on a light background" (Section 4.3);
it has no further margin, so it should not be darkened for any other
reason without re-checking this number.

The tables above cover text/background pairs (4.5:1 threshold). A
narrower, separate check was done for the non-text (3:1) fill uses
introduced in Section 4.3 — `--color-danger`'s dark-theme value on light
backgrounds (3.60:1 / 3.82:1, both pass) and `--color-success`'s
dark-theme value on light backgrounds (2.62:1 / 2.78:1, both fail,
which is why light theme's `--color-success` uses the darkened value
instead, per Section 4.3). Not covered by either check, and not yet
verified (explicitly out of scope for this document, flagged rather than
assumed): non-text contrast for `--color-accent` used as a border (button
borders, the active-nav underline, focus rings, Section 10.1/10.7), and
colour-blindness simulation of the chart palette (Section 4.4's open
item) and of the success/danger colour pairing used together (e.g. a
table showing both accepted and rejected counts side-by-side) —
recommended as Phase D verification steps before go-live, consistent
with how `docs/ARCHITECTURE.md` handles its own open infrastructure
items.

## 14. Consistency Governance

Restating Section 1's rule as an explicit, checkable practice for Phase D:
a new page is built by selecting from the components in Section 10 and
the layout grid in Section 11 — never by writing new component-level CSS
for that page. If an upcoming page (one of `docs/ARCHITECTURE.md`
Section 9's future-marked pages, or a page within Feature 007's own
scope) appears to need something not in Section 10, that is itself a
signal to extend this document with a new, reusable component —
reviewed the same way this document was — rather
than to solve it locally on one page. This is what makes "every future
page inherits a consistent design language" true by construction rather
than by ongoing manual effort.

## 15. Relationship to `docs/ARCHITECTURE.md`

This document supplies values and visual specification; it does not
redecide anything `docs/ARCHITECTURE.md` already decided. Specifically
unchanged and not revisited here: the `data-theme` theming mechanism
(Architecture Section 8), the component *file* structure and naming
(Architecture Sections 4–5), the CSS file organisation
(Architecture Section 7), and the breakpoint values themselves
(Architecture Section 12, reused by this document's Section 11). Where
this document and `docs/ARCHITECTURE.md` describe the same thing from
different angles (for example, empty/loading/error states — behaviour in
Architecture Section 16, visual treatment in this document's Section
10.10), they are written to be read together, not as two competing
sources.
