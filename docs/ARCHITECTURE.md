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
dependencies" principle. It is loaded via CDN, pinned to an exact version
with a Subresource Integrity hash as of Phase E Milestone 24; Section 18
records that resolution.

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
throughout the dashboard (Section 16). Of those three figures,
`best_share_ever` (`pool.best_share_ever`) and, as of Phase E Milestone
28, hashrate (`pool.hashrate_1m`/`hashrate_24h` — CKPool's own native
values, see Section 25) are both present in `analytics.json` directly;
only blocks-found remains outside that contract and would need its own
future data source (Section 24's "Explicitly Out of Scope" list names
this and related figures — pool luck, estimated block probability — as
separate future milestones, not part of this one). Code Review (Milestone
28) flagged this section as having gone stale relative to Section 25's
own updated schema reference — reconciled here rather than left
contradictory.
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
      shell.js                  # renders shared header/nav/Global Live Feed/
                                 # footer/theme toggle
      shell.css
      live-feed-events.js        # Milestone 27: pure event-synthesis/diffing
                                  # for the Global Live Feed

    core/
      router.js                 # hash router for the dashboard app
      state.js                  # minimal pub/sub store
      api.js                    # data layer: fetch, cache, polling, retry
      format.js                 # shared formatting (sdiff, %, dates, durations)
      errors.js                 # centralized error/staleness classification
      live-ticker.js            # pure live_ticker helpers (Milestone 27:
                                 # relocated from the retired pages/ticker.js,
                                 # now shared by shell/live-feed-events.js)

    charts/
      chart.js                  # ECharts init/resize/teardown wrapper
      theme-echarts.js          # ECharts theme derived from CSS tokens

    pages/                     # one module per dashboard route
      overview.js
      pool.js
      users.js                  # Milestone 27: search now cross-entity
                                 # (users + workers), absorbing the retired
                                 # search.js's own worker-results panel
      user-detail.js
      workers.js
      worker-detail.js
      history.js
      # Milestone 27 retired ticker.js and search.js (see Section 5/9) --
      # not listed here any more.
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
      live-feed.js               # Milestone 27: superseded ticker-feed.js
                                  # (deleted along with pages/ticker.js)

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
shell.js (header, nav, theme toggle, Global Live Feed, footer)
  |
  +-- [MPA pages]            static HTML, shell injected at runtime
  |     landing / status / docs / api-docs
  |
  +-- app/index.html -> router.js
        |
        +-- overview.js        (Card, StatTile x N, ChartPanel)
        +-- pool.js             (StatTile x N, ChartPanel, DataTable)
        +-- users.js              (DataTable, SearchBox, worker-results sub-view)
        +-- user-detail.js          (StatTile x N, ChartPanel, DataTable)
        +-- workers.js               (DataTable, SearchBox)
        +-- worker-detail.js           (StatTile x N, ChartPanel)
        +-- history.js                  (ChartPanel x N)

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

**Phase E Milestone 27 (Human decision):** the Share Ticker and Search
pages shown in this diagram through Milestone 26 were both retired (see
Section 9). Their replacements are not new pages:

- **Global Live Feed** (`shell/live-feed-events.js` + `components/
  live-feed.js`) is owned by `shell.js`, not a page module — mounted once
  alongside the header/footer and shown on every page regardless of
  route, satisfying the Human's "must remain visible regardless of which
  page is open" requirement without its own polling loop (it reacts to
  the `analytics` field in `core/state.js`, already kept fresh by
  whichever page is currently mounted, per Section 15). It shows five
  event types, each with zero backend/schema changes: New Personal Best
  (reuses `core/live-ticker.js`, relocated from the retired ticker.js),
  New Best Ever, Best Share Today (both diffed client-side from
  `pool.best_share_ever` / `pool.best_share_today`), New User, and New
  Worker (both diffed client-side from the `users`/`workers` dictionary
  keys). A `FEED_EVENT_TYPES` registry (priority, icon, label) is the
  extensibility point for a future event type — Block Found, High
  Difficulty Share, Pool Hashrate Milestone, and Current Network
  Difficulty were all named in the original brief but have no backing
  data source anywhere the frontend can reach today, so none of the four
  were implemented; each is a future milestone's own registry entry, not
  a placeholder here.
  - Marquee technique is the Human-approved "Option A": a CSS keyframe
    loop over a doubled event track (the standard seamless-loop
    technique), constant px/second speed computed from the real,
    rendered track width (not a fixed duration) so it feels the same
    regardless of event count, paused on hover and `:focus-within`, and
    replaced by a static wrapped list under `prefers-reduced-motion`.
    Because every render in this codebase rebuilds its whole subtree
    (Section 6), a poll-driven event arrival visibly resets the scroll
    position — an explicitly accepted trade-off, not a bug, revisited
    only if real usage shows it's a problem (the alternative, true
    incremental DOM patching so the loop never resets, is a materially
    bigger mechanism no other page in this project needs, deliberately
    not built speculatively).
- **Users page search** now matches both usernames and workernames
  (previously usernames only) — a worker match reuses `workerResultsSpec`/
  `WORKER_RESULT_COLUMNS`, relocated verbatim from the retired search.js,
  shown as an additional card alongside (or instead of) the existing
  Users table depending on which entities the query matches. The Users
  table's own existing filter behaviour is unchanged when a query matches
  no workers.

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
| Historical Analytics | SPA view | `/app/#/history` |
| *(future)* Administration | SPA view, auth-gated | `/app/#/admin` |
| *(future)* Notifications | SPA view | `/app/#/notifications` |
| *(future)* Achievements | SPA view | `/app/#/achievements` |
| *(future)* Miner Management | SPA view | `/app/#/miners` |

"Current users" and "Top shares" (from the Website Goals list) are views
within Users and Pool Statistics respectively, not separate pages — they
are slices of data already present in `analytics.json` (`users`,
`pool.best_share_today` / `best_share_ever`), not new data needs.

**Phase E Milestone 27 (Human decision — global feed and navigation
simplification):** the Share Ticker and Search pages, both listed above
through Milestone 26, were retired and removed from this table.
Ticker's content and purpose were absorbed into a permanent, shell-owned
Global Live Feed (Section 5) shown on every page regardless of route,
rather than living on its own page. Search's functionality was embedded
directly into the Users page's own search box (now cross-entity: it
matches both usernames and workernames, per Section 5's
`workerResultsSpec`). `app.js`'s `REDIRECTS` table sends `#/ticker` to
`#/` and `#/search` to `#/users`, so neither retirement leaves a dead
route behind.

## 10. Navigation

A single nav list, defined once in `shell.js`, rendered identically on
every page (MPA and SPA alike). MPA pages link to each other and into
`/app/` with normal `<a href>` tags — no client routing needed, no
full-app JS on pages that don't need it. Within the dashboard app,
nav links use `#/...` hashes and are intercepted by `router.js`; the
active route is highlighted from the current hash on every navigation
event.

**Phase E Milestone 27 (Human decision):** the nav link list collapses
behind a hamburger toggle into a dropdown panel at every viewport
width, not only below 768px as in Milestones 1-26 — reducing the
navigation surface area everywhere, in support of the Global Live Feed
(Section 5) becoming a more prominent, defining element of the page.
The underlying disclosure mechanism (`aria-expanded`, Escape/outside-
click dismiss) is unchanged; only the CSS breakpoint gating it was
removed.

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

- Fetch `/analytics.json`, `/pool_stats`, `/historical_data` where still
  needed for not-yet-migrated data.
- In-memory cache keyed by endpoint, with the fetch timestamp attached.
- Configurable polling interval for `analytics.json`. Resolved in Phase E:
  `analytics_builder.py` now runs on a 5-minute cron schedule (Milestone
  22, mirroring `parse_pool_stats.py`'s own cadence), and `app.js` wires a
  matching 5-minute `intervalMs` into every page's `mount()` call
  (Milestone 23) — polling now genuinely runs in production, where it
  never had before. Every poll-triggered fetch also passes
  `bypassCache: true` (Milestone 23), forcing `cache: "no-store"` so a
  refetch can't be silently served from the browser's own HTTP cache
  instead of hitting the network — the Nginx alias (Milestone 21) sets no
  `Cache-Control` header, so this was a real, not just theoretical, risk
  once a real cadence existed. A normal (non-polling) `fetchEndpoint()`
  call keeps ordinary caching, unaffected.
- Staleness detection: compares `metadata.generated_at` from the fetched
  payload against the current time; a page can use this to show a
  "data as of Xm ago" indicator or a staleness warning, without every page
  reimplementing that comparison. `app.js` now supplies a real
  `staleAfterMs` (15 minutes, 3x the poll interval) alongside `intervalMs`
  (Milestone 23), so this indicator is live in production, not just built.
- Retry with backoff on network failure; on failure, the last good cached
  payload is kept and shown with a visible staleness/error indicator
  (Section 16.2), rather than the UI going blank.
- A single, explicit place to add an `Authorization` header once future
  authenticated endpoints (admin, miner management) exist — named here so
  that when that need arrives, it is a one-file change.

**Nginx change (Phase D concern, done in Phase E Milestone 21):** a
`location = /analytics.json` block aliasing to
`/home/damopool/ckpool-solo/ckpool/analytics.json`, mirroring the existing
four JSON aliases exactly (`default_type application/json`), live in
production and verified end-to-end (cron-generated file served correctly
through the alias). No other Nginx change was required by the routing
strategy (Section 11).

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
- The Global Live Feed (`components/live-feed.js`, superseding
  `ticker-feed.js`/`pages/ticker.js` in Milestone 27) uses an ARIA live
  region so new entries are announced to screen readers, not just
  appended visually. Its continuously-scrolling track pauses on hover
  and `:focus-within` (not hover alone — a moving target cannot be
  reliably tabbed into or clicked otherwise) and is replaced by a
  static, non-scrolling list under `prefers-reduced-motion`. Each event
  is a real link (not inert text), so it participates in normal tab
  order like any other navigation element.
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
  already public on-chain. **Decision (Phase E Milestone 24, Human
  Decision Required item resolved):** publishing real-time performance
  data linked to that address is acceptable as-is, no mitigation
  required before go-live — the domain assumption above is confirmed
  against this project's actual user base, not left as an unverified
  carry-through. This was a deliberate Human decision, not an
  Engineering Manager assumption.
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
- The ECharts CDN script is the dashboard app's only third-party script
  (the Google Analytics tag exists only on the old, not-yet-cutover live
  site, `/var/www/html/index.html` — not this architecture's own entry
  point). Pinned to an exact version (`6.1.0`) with a Subresource
  Integrity hash in Phase E Milestone 24 (`sha384`, computed directly from
  the pinned version's actual bytes, independently cross-confirmed
  against both the browser's own SRI-mismatch error reporting its
  computed hash and the same file extracted from the actual npm registry
  tarball — a source independent of the CDN itself, ruling out a
  CDN-specific tampered build rather than only checking self-consistency
  against jsdelivr alone).
- **Deliberate trade-off, not an oversight (matching this document's own
  convention, e.g. Sections 3.3/20/21):** pinning inverts the previous
  risk. Unpinned `latest` meant the dashboard silently received upstream
  ECharts updates, unverified but always current; pinned means it will
  now silently stay on `6.1.0` indefinitely — including through any
  future disclosed ECharts vulnerability — until someone notices and
  manually repeats the version-bump process (resolve the new version,
  diff/hash it the same way, re-verify in a real browser, and update the
  script tag, its own comment, and this section). No automated dependency
  update or CVE-monitoring process exists for this or any other
  dependency in the project; at this project's current scale (one
  third-party script, one operator) that is judged acceptable, but it is
  recorded here as a real, accepted limitation rather than left
  implicit.
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

**Dashboard overview (`/app/#/`)** — updated Phase E Milestone 27 (Human
decision): the horizontal nav became a hamburger dropdown at every
viewport width, and the Global Live Feed replaced the old Ticker page,
becoming a permanent band shown on every page directly below the
header (not an Overview-page side panel — it's identical on every
route, including this one).
```
+--------------------------------------------------+
| [=] Damopool                                      |
+--------------------------------------------------+
| New Personal Best  user.rig  ...  New Best Ever  ...|   <- Global Live
+--------------------------------------------------+      Feed, scrolling
| [Pool hashrate] [Accepted] [Rejected] [Best today]|
+--------------------------------------------------+
| Pool sdiff chart (24h)                            |
| [        ECharts panel   ]                        |
+--------------------------------------------------+
| Top users today (table, stacked-card on mobile)   |
+--------------------------------------------------+
```

**User detail (`/app/#/users/:username`)** — nav/feed updated the same
way as the Overview wireframe above; this page's own unique content
(the back-link, heading, stat tiles, worker list, chart) is unchanged.
```
+--------------------------------------------------+
| [=] Damopool                                      |
+--------------------------------------------------+
| (Global Live Feed, identical to every other page) |
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
`schema_version` `"1.3"` (Phase E Milestone 29 bumped this from `"1.2"`
— additive, backward-compatible: a new `network_difficulty` field on
`pool`, and a new `difficulty_histogram` field on
`pool`/`users[...]`/`workers[...]`, nothing removed or reshaped):

```
{
  "metadata": {
    "schema_version": "1.3", "generated_at": <ISO8601>, "generator": <str>,
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
    },
    "hashrate_1m", "hashrate_24h": <float|null>,
    "network_difficulty": <float|null>,
    "difficulty_histogram": {
      "1d" | "total": {
        "bucket_counts": [<int> x12],
        "bucket_best": [{"username","workername","sdiff","timestamp"} | null, x12]
      }
    }
  },
  "users": {
    "<username>": {
      ...same scope fields as pool (including hashrate_1m/hashrate_24h,
      difficulty_histogram; no network_difficulty -- pool-only)...,
      "workers": [<workername>, ...],
      "rolling_windows": {...}
    }
  },
  "workers": {
    "<workername>": {
      "agent": <str|null>, "first_share_at", "last_share_at": <ISO8601|null>,
      "is_active": <bool>,
      ...same scope fields as pool (including hashrate_1m/hashrate_24h,
      difficulty_histogram; no network_difficulty -- pool-only)...,
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

`hashrate_1m`/`hashrate_24h` (Phase E Milestone 28) are the one part of
this schema **not** derived from `.sharelog` data at all — every other
field above comes from `analytics_state.py`'s incremental sharelog
processing (Section 1's source of truth). These two are read directly
from CKPool's own native, live-updated statistics files (`logs/pool/
pool.status` for `pool`, `logs/users/<address>` — including its nested
`worker` array — for `users`/`workers`) by a separate, standalone module,
`ckpool_native_stats.py`, and merged in by `analytics_builder.py` after
`analytics_state.py` has already produced everything else. Values are
plain numbers (hashes/second), never CKPool's own formatted strings (e.g.
`"9.84T"`) and never estimated or aggregated by this project's own code —
`null` means CKPool has not yet written a native file for that
user/worker (a brand-new connection, or a transient read timing gap),
not a zero hashrate. Deliberately independent of `analytics_state.py`'s
incremental byte-offset engine: these are small, fully-overwritten
snapshots CKPool keeps current on its own, not append-only logs, so a
full fresh read every `analytics_builder.py` run needs none of that
machinery.

`network_difficulty` (Phase E Milestone 29) is likewise read directly
from CKPool's own logs rather than derived from `.sharelog` data: it's
parsed from the `"Network diff set to <value>"` line `ckpool` itself
writes to `ckpool.log` whenever the network target changes (roughly
every two weeks). `null` only until the first such line has ever
appeared; otherwise it's the last genuine value logged, cached and
carried forward incrementally by `ckpool_native_stats.py` (byte-offset
tracked, same file-rotation-safe pattern as `analytics_state.py`, but a
separate, independently-maintained offset since this reads `ckpool.log`
rather than a `.sharelog` file). Never estimated — a stale-but-real
cached value, never a guess.

`difficulty_histogram` (Phase E Milestone 29) is a frequency
distribution of solved (accepted, valid-`sdiff`) shares across 12 fixed,
permanent logarithmic buckets, generated by a dedicated standalone
module, `histogram_builder.py`, on the same "reads `.sharelog` data
independently of `analytics_state.py`" precedent `ckpool_native_stats.py`
established for hashrates. The bucket boundaries
(`histogram_builder.BUCKET_BOUNDARIES`) are anchored on 21 and each
exactly ×10 the previous (21,000 / 210,000 / 2,100,000 / ... /
210,000,000,000,000), fixed forever so histograms stay directly
comparable across pool/users/workers/time/future software versions —
never generated dynamically or adjusted per dataset. `bucket_counts[i]`
is the count of solved shares whose `sdiff` fell in bucket `i` (bucket 0
is `< 21,000`; bucket 11, the last, is permanently open-ended, `>=
210,000,000,000,000`); `bucket_best[i]` is that bucket's own highest
solved share (or `null` if the bucket is empty), same shape as
`best_share_today`/`best_share_ever`. `"1d"` covers an exact, both-ends-
inclusive trailing 24-hour window (`histogram_builder.py`'s own
`DAY_WINDOW`), recomputed fresh each run -- a share exactly 24h00m00s
old is still included, one exactly 24h00m01s old is not. This is
distinct from `RECENT_TUPLE_RETENTION` (25h), which is only an internal
storage-pruning buffer, never the reported cutoff itself (Code Review,
Milestone 29: an earlier version of this module conflated the two,
silently making "1d" a ~25h window). `"total"` is a forever-cumulative
count that never resets. A user/worker with no solved share at all still
gets a well-formed (all-zero) `difficulty_histogram`, never a missing
key.
