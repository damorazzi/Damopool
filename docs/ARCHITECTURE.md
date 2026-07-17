# Damopool Website — Frontend Architecture

**Feature 007, Phase A.** Architecture only. No production frontend code has
been written as part of this document — see `ROADMAP.md` / `PROJECT_LOG.md`
for status.

## 1. Purpose and Scope

Feature 007 replaces the "Daily Best Ticker" proposal with a broader
objective: establish a frontend architecture for a production-quality
Damopool website that can grow, over many future features, into a full
mining platform — without requiring a redesign at any point along the way.

This document is the Phase A deliverable: the complete architecture. It
does not implement any of it. Phase B is independent review of this
document. Phase C (visual design system) and Phase D (implementation)
follow only after separate Human approval of each phase, per the sequence
given in the transition instruction.

The backend is stable and out of scope for redesign. `analytics.json`
(`analytics_builder.py` / `analytics_state.py`, schema version `1.1`) is
the single public data contract this architecture is built around. Nothing
here proposes a backend change beyond the one infrastructure gap noted in
Section 15.

## 2. Current State (verified, not assumed)

- The live site is a single static file, `/var/www/html/index.html`
  (1,270 lines), served by Nginx for `damopool.xyz`. It has no build step,
  no JS modules, inline `<script>` blocks, and no client-side router.
- It already uses ECharts, loaded from a CDN
  (`cdn.jsdelivr.net/npm/echarts`), plus a Google Analytics `gtag.js` tag.
- Nginx (`/etc/nginx/sites-available/default`) currently aliases four JSON
  files directly by path: `/pool_stats`, `/historical_data`,
  `/config_history`, `/config_version_log`, all pointing into
  `ckpool-solo/ckpool/logs/`. There is **no** location block for
  `analytics.json` — it is not currently reachable by the browser at all.
- `parse_pool_stats.py` runs on a 5-minute cron schedule. `analytics_builder.py`
  has **no scheduled execution anywhere** — `analytics.json` does not
  currently exist on disk in the running system. Both gaps are
  infrastructure work, not frontend architecture, and are called out again
  in Section 15 rather than silently assumed away.
- This confirms the current site is not a starting point to extend — it is
  the thing this architecture replaces. It keeps serving, unmodified, until
  an explicit, approved cutover in Phase D (Section 24).

## 3. Foundational Technology Decisions

Each decision below is deliberate, not default. Reasoning is included
because "why" is what makes an architecture reusable rather than just a
file listing.

### 3.1 No JavaScript framework

**Decision:** vanilla JavaScript using native ES modules. No React, Vue,
Svelte, or similar.

**Why:** the entire engineering organisation for this project is one
Engineering Manager performing every delegated role
(`ENGINEERING_ORGANISATION.md` §2). A framework buys team-scale
coordination benefits (component contracts across many contributors) this
project does not need, at the cost of a build toolchain, a dependency
tree, and a version-upgrade treadmill — all things `CLAUDE.md`'s
"avoid unnecessary dependencies" principle and the project's stated
"maintainability before optimisation" priority argue against. Native ES
modules already give real file-level modularity (Section 6) without any
of that cost.

Lightweight middle-ground libraries (for example Alpine.js or htm/preact)
were also considered and set aside for the same reasoning as a full
framework: each is still a dependency with its own version and behaviour
to track, for a problem — routing between roughly a dozen views and
rendering data-driven markup — that native ES modules plus a small
hand-written router (Section 11) already solve without one.

This is revisited, not permanent: if a future feature's complexity
genuinely outgrows this (state complexity, not just page count), that is
itself a major architectural change requiring Human approval under
`DEVELOPMENT_PROCESS.md` §5 — exactly the kind of decision this document
exists to make deliberately rather than by drift.

### 3.2 Keep ECharts

**Decision:** retain ECharts as the charting library rather than replacing
it.

**Why:** it is already proven in production on the current site, it is
capable, and swapping it for another library would be a dependency change
with no functional justification — the opposite of the "avoid unnecessary
dependencies" principle. It is loaded via CDN today; Section 18 addresses
the integrity/versioning follow-up that deserves attention before go-live.

### 3.3 No build step in v1, but a build-ready structure

**Decision:** ship hand-written, unbundled ES modules and CSS files in the
first implementation. Structure the source tree (Section 4) so that
adopting a bundler (for example Vite or esbuild) later is a config
addition, not a reorganisation.

**Why:** a build step is exactly the kind of complexity that should be
justified by an actual need (minification at scale, TypeScript, a large
component count) rather than adopted preemptively. The trade-off is
accepted explicitly in Section 20 (Performance Strategy) rather than
ignored.

### 3.4 Hybrid page architecture: static pages + one dashboard app

**Decision:** public, content-oriented pages (landing page, status page,
documentation, API documentation) are real, separate static HTML files,
served directly by Nginx. The data-driven, frequently-navigated dashboard
(live dashboard, pool/user/worker statistics, ticker, search, historical
charts, and future authenticated pages) is a single-page app mounted at
one entry point, using client-side hash routing between its views.

**Why:** these two halves of the site have different needs. The public
pages benefit from being individually indexable, fast on first paint, and
crawlable (Section 19) — a client-rendered SPA actively hurts that. The
dashboard's views share heavy state (the same fetched `analytics.json`),
are navigated between constantly by a returning user, and have no SEO
value — a SPA avoids re-fetching and re-rendering shared chrome on every
click. This hybrid is a common, well-understood pattern (marketing site +
application) and is not a novel or risky choice.

This is reconciled with the landing page's own live numbers (Section 22's
wireframe shows current hashrate, best share ever, blocks found): the
static markup — headline, nav, copy, footer, and empty placeholders for
those figures — is what loads and is indexed immediately, which is what
"fast first paint" and "crawlable" mean here. The live figures themselves
are a progressive enhancement, fetched by `core/api.js` after first paint
and filled into those placeholders, the same loading-state pattern used
throughout the dashboard (Section 16). Of those three figures, only
`best_share_ever` (`pool.best_share_ever`) is present in `analytics.json`
(Section 25) — hashrate and blocks-found are not part of that contract
and would be fetched from `pool_stats.json` / `historical_data.json`
instead, which `core/api.js` is already permitted to fetch (Section 15).
A crawler indexes the page correctly without ever running any of these
fetches; a human visitor sees the static page immediately and the live
numbers fill in a moment later. This is a stated, deliberate compromise,
not an unaddressed gap.

Both halves share one rendered header/nav/footer (Section 5), so this
split is invisible to a user — it only affects how the two kinds of page
are built and served.

## 4. Directory Structure

This is the target structure. Creating it is Phase D work, not part of
this document.

```
frontend/
  public/                     # served as-is by Nginx (MPA layer)
    index.html                 # Landing page
    status.html                 # Status page
    docs/
      index.html                 # Documentation
      api.html                    # API documentation
    app/
      index.html                  # Dashboard app mount point (single entry)
    robots.txt
    sitemap.xml
    assets/
      img/
      fonts/

  src/                         # source JS/CSS (bundler-ready, unbundled in v1)
    shell/
      shell.js                  # renders shared header/nav/footer/theme toggle
      shell.css

    core/
      router.js                 # hash router for the dashboard app
      state.js                  # minimal pub/sub store
      api.js                    # data layer: fetch, cache, polling, retry
      format.js                 # shared formatting (sdiff, %, dates, durations)
      errors.js                 # centralized error/staleness classification

    charts/
      chart.js                  # ECharts init/resize/teardown wrapper
      theme-echarts.js          # ECharts theme derived from CSS tokens

    pages/                     # one module per dashboard route
      overview.js
      pool.js
      users.js
      user-detail.js
      workers.js
      worker-detail.js
      ticker.js
      search.js
      history.js
      # future, additive only: admin.js, notifications.js,
      # achievements.js, miners.js

    components/                # reusable UI building blocks
      card.js
      data-table.js
      stat-tile.js
      chart-panel.js
      empty-state.js
      loading-skeleton.js
      error-banner.js
      search-box.js
      ticker-feed.js

    styles/
      tokens.css                 # design tokens: colour, spacing, type scale
      theme-dark.css
      theme-light.css
      base.css                    # reset + base element styles
      layout.css
      components/
        card.css
        data-table.css
        nav.css
        stat-tile.css
        ...one file per component, mirroring src/components/
```

Every future page in Section 9's table (admin, notifications, achievements,
miner management) is a new file under `pages/`, wired into `router.js` and
`shell.js`'s nav list. None of them require a structural change to add —
see Section 23 for what "future" means here versus Search and Historical
Analytics, which are already part of this architecture.

## 5. Component Hierarchy

```
shell.js (header, nav, theme toggle, footer)
  |
  +-- [MPA pages]            static HTML, shell injected at runtime
  |     landing / status / docs / api-docs
  |
  +-- app/index.html -> router.js
        |
        +-- overview.js        (Card, StatTile x N, ChartPanel, TickerFeed)
        +-- pool.js             (StatTile x N, ChartPanel, DataTable)
        +-- users.js              (DataTable, SearchBox)
        +-- user-detail.js          (StatTile x N, ChartPanel, DataTable)
        +-- workers.js               (DataTable, SearchBox)
        +-- worker-detail.js           (StatTile x N, ChartPanel)
        +-- ticker.js                    (TickerFeed, EmptyState)
        +-- search.js                     (SearchBox, DataTable)
        +-- history.js                     (ChartPanel x N)

Every page module composes from the same component set (Card, DataTable,
StatTile, ChartPanel, EmptyState, LoadingSkeleton, ErrorBanner) rather
than each page inventing its own markup — this is the primary mechanism
for "every page should appear consistent" (the project philosophy's
explicit requirement).
```

Section 4's four future pages (admin, notifications, achievements, miners)
are deliberately omitted from this diagram, the same way they are marked
`# future, additive only` there rather than listed alongside the pages
above — each will compose from this same component set when built, per
Section 23.

## 6. JavaScript Module Structure

Native ES modules (`import`/`export`), one concern per file, no global
namespace pollution beyond the single dashboard app's router mount. Page
modules (`pages/*.js`) are loaded via dynamic `import()` from
`router.js`, matched against the current route — so the landing page never
downloads dashboard code, and a user who only ever looks at `#/pool` never
downloads `worker-detail.js`. This is the primary lazy-loading mechanism,
elevated to an explicit strategy in Section 20.

`core/api.js` is the only module that calls `fetch()` against
`analytics.json` or the other JSON endpoints. No page module fetches
directly — this keeps caching, retry, and staleness logic in one place and
means a future authenticated endpoint (Section 18) only needs one
injection point (Section 15) rather than an audit of every page.

## 7. CSS Architecture

Hand-written CSS, organized by concern: `tokens.css` (custom properties
only, no selectors), `base.css` (reset + element defaults), `layout.css`
(shell/grid structure), then one file per component under
`styles/components/`, each scoped by a single class prefix matching its
component name (for example `.card`, `.data-table`) to avoid collision
without needing a CSS-in-JS or CSS-modules build step. No CSS framework
(Tailwind, Bootstrap) — consistent with Section 3's dependency principle,
and because Phase C is explicitly building a from-scratch design system,
which a utility-class framework would fight rather than support.

## 8. Theme System

CSS custom properties defined once in `tokens.css`
(`--color-bg`, `--color-surface`, `--color-text`, `--color-accent`, etc.),
overridden per theme in `theme-dark.css` / `theme-light.css`, selected via
a `data-theme="dark"|"light"` attribute on `<html>`. Theme selection
follows one explicit precedence order, checked in this sequence: (1) a
previously-saved `localStorage` choice, if present; (2) otherwise the OS
`prefers-color-scheme` on first visit; (3) otherwise dark, matching the
current site's brand identity. Once a user makes an explicit choice via
the theme toggle, it is written to `localStorage` and wins over the
system preference on every later visit.

ECharts cannot read CSS custom properties directly, so
`charts/theme-echarts.js` reads the resolved values via
`getComputedStyle` at chart-init time and builds a matching ECharts theme
object — this keeps chart colours in sync with the CSS theme without
hand-duplicating a colour palette in JavaScript.

## 9. Page Architecture

| Page | Kind | Route |
|---|---|---|
| Landing | static (MPA) | `/` |
| Status | static (MPA) | `/status.html` |
| Documentation | static (MPA) | `/docs/` |
| API Documentation | static (MPA) | `/docs/api.html` |
| Dashboard Overview | SPA view | `/app/#/` |
| Pool Statistics | SPA view | `/app/#/pool` |
| Users (list) | SPA view | `/app/#/users` |
| User detail | SPA view | `/app/#/users/:username` |
| Workers (list) | SPA view | `/app/#/workers` |
| Worker detail | SPA view | `/app/#/workers/:workername` |
| Share Ticker | SPA view | `/app/#/ticker` |
| Search | SPA view | `/app/#/search` |
| Historical Analytics | SPA view | `/app/#/history` |
| *(future)* Administration | SPA view, auth-gated | `/app/#/admin` |
| *(future)* Notifications | SPA view | `/app/#/notifications` |
| *(future)* Achievements | SPA view | `/app/#/achievements` |
| *(future)* Miner Management | SPA view | `/app/#/miners` |

"Current users" and "Top shares" (from the Website Goals list) are views
within Users and Pool Statistics respectively, not separate pages — they
are slices of data already present in `analytics.json` (`users`,
`pool.best_share_today` / `best_share_ever`), not new data needs.

## 10. Navigation

A single nav list, defined once in `shell.js`, rendered identically on
every page (MPA and SPA alike). MPA pages link to each other and into
`/app/` with normal `<a href>` tags — no client routing needed, no
full-app JS on pages that don't need it. Within the dashboard app,
nav links use `#/...` hashes and are intercepted by `router.js`; the
active route is highlighted from the current hash on every navigation
event.

## 11. Routing

Hash-based client routing inside `/app/` (`#/pool`, `#/users/:username`,
etc.), handled by `core/router.js` listening to `hashchange`. This
requires no Nginx rewrite rule — the browser never sends the hash portion
to the server, so `try_files $uri $uri/ =404` (the current default
location block, unchanged) is sufficient. This was chosen over
path-based routing (`/app/pool`, `/app/users/:username`) specifically to
avoid needing an Nginx SPA-fallback rewrite in Phase D; that avoided
config change is a deliberate simplicity trade-off, not an oversight.

Dynamic route segments (`:username`, `:workername`) carry free-text
values with no charset restriction (Section 18) — either may contain `/`,
`#`, `%`, or other characters meaningful in a URL hash. `router.js`
therefore encodes every dynamic segment with `encodeURIComponent` when
constructing a link or hash, and decodes with `decodeURIComponent` before
matching an incoming hash against a route pattern; route matching itself
always operates on the decoded value, so a username containing an encoded
`/` cannot be misread as an extra path segment.

## 12. Responsive Strategy

Mobile-first CSS. Breakpoints: `480px` (small phones), `768px` (tablets),
`1024px` (small desktop), `1280px` (wide desktop) — defined once as custom
properties in `tokens.css` and referenced from component stylesheets via
`@media` queries. Data tables collapse to stacked cards below `768px`
(each row becomes a labelled card) rather than horizontal scroll or
column-hiding, matching common professional dashboard patterns and
avoiding the accessibility problems of scroll-locked tables. Charts call
ECharts' `resize()` from a `ResizeObserver` on their container, not on
`window.resize` alone, so they also respond correctly to sidebar/nav
collapse rather than only viewport changes.

## 13. State Management

No external state library. `core/state.js` is a minimal pub/sub module
holding: the last-fetched `analytics.json` payload, its fetch timestamp,
the active theme, and any page-local UI state that must survive a route
change (for example a search query). Page modules `subscribe()` on mount
and `unsubscribe()` on teardown. This is deliberately small: the
project's actual state is "one JSON blob, refreshed periodically, plus a
handful of UI preferences" — introducing a Redux-scale store for that
would be complexity with no matching problem.

`analytics.json`'s `users`/`workers` objects are plain JSON dictionaries
keyed by unvalidated free-text usernames/workernames (Section 18).
`state.js` holds the object exactly as `JSON.parse` produced it (safe on
its own) and never merges or spreads it into another object under those
same keys, which is what would risk a `__proto__`/`constructor` key
acting unexpectedly; any future lookup structure derived from these keys
uses a `Map`, not a plain object literal.

## 14. Chart Strategy

`charts/chart.js` wraps ECharts' `init`/`setOption`/`resize`/`dispose`
lifecycle so page modules never call the ECharts API directly — they pass
data and get a managed chart instance back. This keeps the ECharts
dependency isolated to one module (relevant if it is ever swapped — see
Section 3.1's revisit clause, which applies to this decision too) and
guarantees `dispose()` is always called
on route teardown, preventing the memory/canvas leaks that hash-routed
SPAs are prone to when charts aren't explicitly cleaned up. ECharts itself
is imported dynamically only by pages that render a chart, not loaded
globally (Section 6).

## 15. API / Data Layer

`core/api.js` is the sole fetch boundary. Responsibilities:

- Fetch `/analytics.json` (new Nginx location required — see below),
  `/pool_stats`, `/historical_data` where still needed for
  not-yet-migrated data.
- In-memory cache keyed by endpoint, with the fetch timestamp attached.
- Configurable polling interval for `analytics.json`. **Open
  infrastructure gap, not resolved by this document:** polling cadence
  should be driven by how often `analytics.json` is actually regenerated,
  but `analytics_builder.py` currently has no cron schedule at all
  (Section 2) — this must be resolved (a DevOps Engineer placeholder
  concern, `ENGINEERING_ORGANISATION.md` §14) before Phase D go-live, or
  polling will silently refetch an unchanged file.
- Staleness detection: compares `metadata.generated_at` from the fetched
  payload against the current time; a page can use this to show a
  "data as of Xm ago" indicator or a staleness warning, without every page
  reimplementing that comparison.
- Retry with backoff on network failure; on failure, the last good cached
  payload is kept and shown with a visible staleness/error indicator
  (Section 16.2), rather than the UI going blank.
- A single, explicit place to add an `Authorization` header once future
  authenticated endpoints (admin, miner management) exist — named here so
  that when that need arrives, it is a one-file change.

**Required Nginx change (Phase D, not done now):** a new `location`
block aliasing `/analytics.json` to
`/home/damopool/ckpool-solo/ckpool/analytics.json`, mirroring the existing
four JSON aliases exactly (`default_type application/json`). No other
Nginx change is required by the routing strategy (Section 11).

## 16. Error, Loading, and Empty States

Three distinct, deliberately-not-conflated states, each with its own
component:

1. **Loading** (`loading-skeleton.js`) — shown only on first load of a
   view, sized to match the final layout so nothing shifts when data
   arrives. Background polling refreshes update data in place with no
   loading flash — a page the user is already looking at should not
   visibly reload every refresh cycle.
2. **Error** (`error-banner.js`) — a fetch failure or a malformed payload
   (wrong `schema_version`, JSON parse failure). Never renders a blank
   page; if a cached payload exists it stays visible underneath the
   banner. "Wrong `schema_version`" is checked by major version only
   (Phase D, Milestone 2, `core/errors.js`): a minor/patch bump (`1.1`
   to `1.2`) is assumed backward-compatible and passes, only a major
   bump (`1.x` to `2.0`) is treated as the breaking change this
   frontend was not built against — an exact-string match would break
   the frontend on every non-breaking backend schema addition.
3. **Empty** (`empty-state.js`) — valid, successfully-fetched data that is
   legitimately empty for a specific view: a worker whose `best_share_today`
   is `null` and whose `rolling_windows.24h` shows no recent activity, an
   empty `live_ticker` array, a user with no `workers` yet. Each gets a
   short, specific explanatory message — not a generic "no data."

Conflating empty and error states was explicitly identified during the
earlier (superseded) Feature 007 design research as a risk on the current
site; keeping them as separate components is this architecture's fix.

## 17. Accessibility Strategy

- Semantic landmarks (`header`, `nav`, `main`, `footer`) on every page,
  plus a skip-to-content link.
- WCAG AA colour contrast is a hard requirement for both themes in the
  Phase C design system — checked then, not deferred.
- Full keyboard navigability for nav, theme toggle, and search.
- The ticker (`ticker-feed.js`) uses an ARIA live region so new entries
  are announced to screen readers, not just appended visually.
- Charts are canvas-rendered and not screen-reader accessible by default.
  Each `chart-panel.js` instance is paired with an adjacent accessible
  summary (a short text description or a visually-hidden data table) —
  named here as a concrete Phase C/D requirement rather than left
  unaddressed.

## 18. Security Considerations

- `analytics.json` and the existing JSON endpoints are public and
  unauthenticated by design, matching the current site's pattern.
  Publishing usernames is not expected to be a new disclosure in the
  typical solo-CKPool case, where a username is a BTC payout address
  already public on-chain — but this is a domain assumption, not verified
  against this project's actual user base, and it does not fully account
  for the fact that publishing real-time performance data linked to a
  specific address is itself a form of disclosure beyond the bare address
  existing on-chain. This deserves a deliberate decision before Phase D
  go-live, not an assumption carried through unexamined.
- `username` and `workername` are both free text. `username` is
  conventionally a BTC payout address, but nothing in the backend
  (`is_valid_username` / `is_valid_workername` in `user_statistics.py` /
  `worker_statistics.py`) enforces address syntax or any charset
  restriction on either field — both are validated only as non-empty
  strings. Both are therefore untrusted input and must be rendered via
  `textContent` (or an equivalent escaping path) everywhere, never
  `innerHTML` from raw JSON, to prevent stored XSS via a crafted username
  or workername value that later renders as HTML in another visitor's
  browser. This applies to every component that displays either field,
  not just an obvious one.
- No inline `<script>`/`<style>` and no inline event handlers anywhere in
  the architecture (Section 6/7) — this is what makes adopting a strict
  Content-Security-Policy in Phase D a config addition rather than a
  rewrite.
- The ECharts CDN script and the existing Google Analytics tag are the
  only third-party scripts; both should get a Subresource Integrity hash
  in Phase D (currently absent on the live site).
- Future authenticated areas (admin, miner management) are out of scope
  for Feature 007 but the single fetch boundary (Section 15) means adding
  auth headers later touches one file, not every page.

## 19. SEO Considerations

Only the MPA pages (Section 3.4) are SEO targets — this is the section
referenced from there as "crawlable." Each gets its own
`<title>`, meta description, and Open Graph tags; a `sitemap.xml` and
`robots.txt` are added (currently absent). The dashboard app
(`/app/#/...`) is client-rendered, has no per-route server URL, and has no
SEO value as a live data view — it gets a `noindex` meta tag rather than
any investment in server-side rendering, which would be effort spent
solving a problem that doesn't exist here.

## 20. Performance Strategy

- Route-level and chart-level lazy loading via dynamic `import()`
  (Sections 6, 14) — a visitor to the landing page downloads no dashboard
  or charting code.
- No bundling/minification in v1 (Section 3.3), accepted explicitly as a
  v1 trade-off; content-hashed long-lived cache headers on static assets
  are deferred to whenever a build step is adopted, since hand-written
  filenames can't be safely cached-forever without one.
- `analytics.json` is fetched with normal caching on first load; only the
  polling refetch (Section 15) is cache-busted, once its cadence is
  actually known.
- Background refreshes update state in place (Section 16) rather than
  re-rendering a whole view, avoiding unnecessary layout/reflow work on a
  page the user is already reading.
- Shipping many small unbundled files (Section 3.3) has a real
  request-count cost that this trade-off accepts; it is only reasonable
  given the site's actual expected file count (a few dozen small modules,
  not hundreds) and depends on Nginx serving over HTTP/2, where those
  requests multiplex over one connection instead of queuing. Confirming
  (and, if necessary, enabling) HTTP/2 in the Nginx config is a concrete
  Phase D prerequisite, not an assumption.

## 21. Browser Support

Modern evergreen browsers only (current Chrome/Firefox/Safari/Edge) — a
direct consequence of using native ES modules (Section 3.1/3.3) without a
transpilation step. No IE11 or legacy browser support. Stated here as a
deliberate decision, not an oversight.

## 22. Wireframes

Illustrative, not final — Phase C owns actual visual design.

**Landing page**
```
+--------------------------------------------------+
| [Damopool logo]      Home Status Docs   [App ->] |
+--------------------------------------------------+
|                                                    |
|              Damopool — Solo BTC Mining           |
|         [ live pool hashrate headline stat ]      |
|                                                    |
|   [ Best share ever ]  [ Blocks found ]  [ ... ]  |
|                                                    |
|              [ Enter Dashboard -> ]                |
+--------------------------------------------------+
|  Footer: links, generated-at disclosure, GH, etc. |
+--------------------------------------------------+
```

**Dashboard overview (`/app/#/`)**
```
+--------------------------------------------------+
| [logo]  Overview Pool Users Workers Ticker Search |
+--------------------------------------------------+
| [Pool hashrate] [Accepted] [Rejected] [Best today]|
+--------------------------------------------------+
| Pool sdiff chart (24h)     |  Live ticker feed    |
| [        ECharts panel   ] |  user  +12%  09:41   |
|                             |  user  best  09:38   |
+--------------------------------------------------+
| Top users today (table, stacked-card on mobile)   |
+--------------------------------------------------+
```

**User detail (`/app/#/users/:username`)**
```
+--------------------------------------------------+
| [logo]  Overview Pool Users Workers Ticker Search |
+--------------------------------------------------+
| <- Back to Users        username (truncated)      |
+--------------------------------------------------+
| [Current daily best] [Previous] [Improvement %]   |
+--------------------------------------------------+
| Worker list (table)        | sdiff chart (24h)    |
+--------------------------------------------------+
```

## 23. Future Extensibility

Two different kinds of "not yet built" appear in this document, and they
should not be read as the same thing.

The four items with no route, module, or nav entry anywhere in this
architecture — Administration, Notifications, Achievements, and Miner
Management — are genuinely deferred past Feature 007 (Section 4 marks
them `# future, additive only`). Each slots in later as: one new file
under `src/pages/`, one new route in `router.js`, one new nav entry in
`shell.js`, reusing the existing component set (Section 5) and the
existing single fetch boundary (Section 15). None of them require a
change to the directory structure, the state model, the routing strategy,
or the theme system.

Search and Historical Analytics are not in that category — both already
have a route, a page module, and a place in the component hierarchy
(Sections 4, 5, 9) as part of this architecture, and Search is explicitly
named in the suggested Phase D milestone order recorded in
`PROJECT_LOG.md` (2026-07-17: "Core framework, Layout, Navigation,
Dashboard, Charts, Pool pages, User pages, Worker pages, Search, Ticker,
Remaining features"). Whether either actually
ships in Feature 007's first implementation milestones or in a later
"remaining features" pass is an implementation-sequencing decision for
Phase D to make, not an architectural one — the architecture is identical
either way. That is the actual point of this section: extensibility is
demonstrated by the same mechanism (a new page module plus a route plus a
nav entry) regardless of which specific page ships first, which is the
concrete basis for this document's success criterion "capable of
supporting all future website features without requiring redesign" — it
is demonstrated per-feature, not just asserted.

## 24. Deployment and Migration (Phase D concern, described now for completeness)

The current live site (`/var/www/html/index.html`) keeps serving
unmodified until an explicit, separately-approved cutover step within
Phase D. New pages are built and verified at a non-production path first.
Cutover requires, at minimum: the new `location /analytics.json` Nginx
block (Section 15), a decision on `analytics_builder.py`'s missing cron
schedule (Section 15), and an explicit Human-approved deployment step —
consistent with `CLAUDE.md`'s stability-first mandate. No part of this
architecture touches `ckpool.conf`, stops, or starts CKPool; the frontend
is fully decoupled from the pool process.

## 25. Appendix: analytics.json Schema Reference (informative)

Not a redefinition of the contract — `analytics_builder.py` /
`analytics_state.py` remain the source of truth (Section 1). Recorded
here so a Phase C/D implementer does not have to read Python source to
know the shape this architecture is built around, current as of
`schema_version` `"1.1"`:

```
{
  "metadata": {
    "schema_version": "1.1", "generated_at": <ISO8601>, "generator": <str>,
    "source_files_scanned": <int>, "pool_start_date": <date|null>,
    "share_records_processed": <int>
  },
  "pool": {
    "accepted_count", "rejected_count", "invalid_result_count": <int>,
    "average_sdiff", "median_sdiff", "min_sdiff", "max_sdiff": <float|null>,
    "percentiles": {"p50", "p90", "p99": <float|null>},
    "best_share_today": {"username","workername","sdiff","timestamp"} | null,
    "best_share_ever": {...same shape...} | null,
    "rolling_windows": {
      "15m" | "1h" | "24h": {
        "accepted", "rejected": <int>,
        "average_sdiff": <float|null>,
        "share_frequency_per_minute": <float>
      }
    }
  },
  "users": {
    "<username>": {
      ...same scope fields as pool...,
      "workers": [<workername>, ...],
      "rolling_windows": {...}
    }
  },
  "workers": {
    "<workername>": {
      "agent": <str|null>, "first_share_at", "last_share_at": <ISO8601|null>,
      "is_active": <bool>,
      ...same scope fields as pool...,
      "rolling_windows": {...}
    }
  },
  "daily_bests": {
    "<YYYY-MM-DD>": {
      "users": {
        "<username>": {
          "current_daily_best", "previous_daily_best":
            {"username","workername","sdiff","timestamp"} | null,
          "improvement_amount", "improvement_percentage": <float|null>
        }
      }
    }
  },
  "live_ticker": [
    {
      "username", "workername": <str>,
      "current_daily_best": {"sdiff","timestamp"},
      "previous_daily_best": {"sdiff","timestamp"} | null,
      "improvement_amount", "improvement_percentage": <float|null>,
      "timestamp": <ISO8601>
    }
    // ...sorted newest first
  ]
}
```

`daily_bests` holds only today and, where present, yesterday (UTC) —
older history is out of scope for this contract (a separate, not-yet-built
`analytics_history.json`, per `PROJECT_LOG.md`'s 2026-07-15 design
decision).

One nullability nuance not visible in the shape above: `best_share_today`
and `best_share_ever`'s `timestamp` field is normally an ISO8601 string,
but is the literal string `"unknown"` instead if the underlying share had
no valid `createdate` (`pool_statistics.py`'s `_BestTracker.to_dict`) —
UI code reading this field should not assume it always parses as a date.
