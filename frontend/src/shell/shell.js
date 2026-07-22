// Shared application shell -- docs/ARCHITECTURE.md Section 4/5/10: one
// module renders the header (logo, nav, theme toggle), the Global Live
// Feed (Phase E Milestone 27), and the footer identically on every
// page, MPA and SPA alike. A page provides its own
// <main id="main-content"> content; mountShell() inserts the header
// immediately before it, the live feed between the two, and the footer
// after it -- shell.js never touches or owns <main> itself (Section 5's
// component hierarchy draws that boundary at the shell, not inside it).
//
// Split the same way as router.js/dom.js: buildHeaderSpec/buildFooterSpec
// and every other function up to mountShell are pure spec-builders (no
// DOM APIs), fully unit-tested. mountShell itself -- reading
// localStorage/matchMedia, appending real nodes, wiring click listeners
// -- is DOM-dependent and reviewed by reading, the same tradeoff already
// made for router.js's createRouter and dom.js's specToDom. wireLiveFeed
// below is the same DOM-glue tier -- the pure logic it calls into
// (deriveFeedEvents/accumulateFeedEvents, live-feed-events.js) is fully
// unit-tested there instead.
//
// Milestone 27, why the feed lives here and not in its own page module:
// shell.js's mountShell is called exactly once per full page load
// (app.js's bootstrap()) and is never torn down across an internal
// hash-route navigation -- only individual page modules mount/unmount
// per route. That makes this the one place in the app that actually
// satisfies "the feed must remain visible regardless of which page is
// open" without needing its own polling loop: it reacts to
// core/state.js's already-shared `analytics` field, which whichever
// page is currently mounted keeps fresh via its own existing poll
// (Milestone 23) -- zero additional network requests.

import { el, specToDom } from "../core/dom.js";
import { parseHash } from "../core/router.js";
import { formatRelativeTime } from "../core/format.js";
import { getState, setState, subscribe } from "../core/state.js";
import { liveFeedSpec } from "../components/live-feed.js";
import { FEED_EVENT_TYPES, deriveFeedEvents, accumulateFeedEvents } from "./live-feed-events.js";

// Exported so the FOUC-prevention inline script in
// public/app/index.html -- which cannot import this module, since it
// must run synchronously before first paint and an ES module script
// is deferred -- can have its own necessarily-duplicated literal
// pinned against this value by a test, catching a future drift
// between the two instead of silently reintroducing the flash this
// module's resolveTheme() exists to prevent.
export const THEME_STORAGE_KEY = "damopool-theme";

// docs/ARCHITECTURE.md Section 9 route table, MPA half plus the single
// "App" entry point -- docs/ARCHITECTURE.md Section 22's landing
// wireframe ("Home Status Docs [App ->]").
export const MPA_NAV_ITEMS = [
  { id: "home", label: "Home", href: "/" },
  { id: "status", label: "Status", href: "/status.html" },
  { id: "docs", label: "Docs", href: "/docs/" },
  { id: "app", label: "App", href: "/app/" },
];

// docs/ARCHITECTURE.md Section 9 route table, dashboard-app half --
// every top-level (non-detail, non-future) SPA view. Detail routes
// (users/:username, workers/:workername) are reached by drilling down
// from Users/Workers, not from this top nav, matching the Dashboard
// Overview / User Detail wireframes (Section 22). Phase E Milestone
// 27: the Ticker and Search entries were both removed here -- Ticker's
// page was retired, superseded by the shell-owned Global Live Feed
// every page now shows regardless of nav; Search's page was retired,
// its functionality embedded directly into the Users page's own
// search box instead. app.js's REDIRECTS table sends an existing
// "#/ticker"/"#/search" bookmark or link to its replacement instead of
// a dead route, so removing these two entries doesn't strand anyone.
export const APP_NAV_ITEMS = [
  { id: "overview", label: "Overview", hash: "#/" },
  { id: "pool", label: "Pool", hash: "#/pool" },
  { id: "users", label: "Users", hash: "#/users" },
  { id: "workers", label: "Workers", hash: "#/workers" },
  { id: "history", label: "History", hash: "#/history" },
];

// docs/DESIGN_SYSTEM.md Section 10.11's footer link set, plus the
// external link to the project's public repository.
export const FOOTER_LINKS = [
  { id: "home", label: "Home", href: "/" },
  { id: "status", label: "Status", href: "/status.html" },
  { id: "docs", label: "Docs", href: "/docs/" },
  { id: "github", label: "GitHub", href: "https://github.com/damorazzi/Damopool", external: true },
];

// docs/ARCHITECTURE.md Section 8's precedence: (1) a previously-saved
// localStorage choice, (2) otherwise OS prefers-color-scheme, (3)
// otherwise dark. prefersColorScheme is expected to be "light", "dark",
// or null/undefined (no signal available) -- anything other than an
// explicit "light" falls through to dark, matching "otherwise dark" for
// both an explicit dark preference and no preference at all.
export function resolveTheme({ storedTheme, prefersColorScheme } = {}) {
  if (storedTheme === "dark" || storedTheme === "light") return storedTheme;
  return prefersColorScheme === "light" ? "light" : "dark";
}

export function toggleTheme(theme) {
  return theme === "light" ? "dark" : "light";
}

export function themeToggleLabel(theme) {
  return theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
}

// True if `item` is the current page/route. MPA items are matched by
// pathname; APP items are matched by hash, reusing router.js's own
// parseHash so "no hash" / "#" / "#/" are all recognized as the same
// root route rather than reimplementing that normalization here.
export function isNavItemActive(item, location = {}) {
  const { pathname = "/", hash = "" } = location;

  if (item.hash !== undefined) {
    return parseHash(hash) === parseHash(item.hash);
  }

  if (item.href !== undefined) {
    if (item.href === "/") return pathname === "/" || pathname === "/index.html";
    if (item.href === "/app/") return pathname.startsWith("/app/");
    return pathname === item.href;
  }

  return false;
}

// docs/DESIGN_SYSTEM.md Section 10.11: "the same 'data as of Xm ago'
// staleness text used elsewhere." Returns null (render nothing) when
// there is no fetched timestamp yet, matching format.js's own
// null-means-omit convention rather than showing a placeholder string.
export function footerStalenessText(analyticsFetchedAt, now = new Date()) {
  const relative = formatRelativeTime(analyticsFetchedAt, now);
  return relative === null ? null : `Data as of ${relative}`;
}

function navListSpec(navItems, location) {
  return el("ul", {
    className: "shell-header__nav-list",
    children: navItems.map((item) => {
      const href = item.href ?? item.hash;
      if (href === undefined) {
        // Matches router.js's buildHash precedent (throws on a missing
        // param rather than letting a malformed value silently reach
        // the DOM) -- specToDom's setAttribute would otherwise coerce
        // a missing href to the literal string "undefined".
        throw new Error(`navListSpec: nav item "${item.id ?? item.label}" has neither href nor hash`);
      }
      const active = isNavItemActive(item, location);
      const classes = ["shell-header__nav-link"];
      if (active) classes.push("shell-header__nav-link--active");
      return el("li", {
        children: [
          el("a", {
            className: classes.join(" "),
            attrs: {
              href,
              ...(active ? { "aria-current": "page" } : {}),
            },
            text: item.label,
          }),
        ],
      });
    }),
  });
}

// Pure spec-builder -- docs/ARCHITECTURE.md Section 17's skip-link and
// semantic <header>/<nav> landmarks, docs/DESIGN_SYSTEM.md Section 10.7.
export function buildHeaderSpec({ navItems, location, theme }) {
  return el("header", {
    className: "shell-header",
    children: [
      el("a", {
        className: "skip-link",
        attrs: { href: "#main-content" },
        text: "Skip to content",
      }),
      el("div", {
        className: "shell-header__inner page-container",
        children: [
          el("a", {
            className: "shell-header__logo",
            attrs: { href: "/" },
            text: "Damopool",
          }),
          el("nav", {
            className: "shell-header__nav",
            attrs: { id: "shell-nav", "aria-label": "Primary" },
            children: [navListSpec(navItems, location)],
          }),
          // Grouped so a single margin-inline-start: auto on this
          // wrapper (shell.css) keeps both buttons pinned to the
          // header's trailing edge -- two separate auto margins on
          // siblings would instead split the free space between them.
          // (Phase E Milestone 27: the nav toggle is now in-flow at
          // every breakpoint, not just below 768px, but the grouping
          // rationale is unchanged.)
          el("div", {
            className: "shell-header__controls",
            children: [
              el("button", {
                className: "shell-header__nav-toggle",
                attrs: {
                  type: "button",
                  "aria-expanded": "false",
                  "aria-controls": "shell-nav",
                  "aria-label": "Toggle navigation menu",
                },
                children: [
                  el("span", {
                    className: "icon icon-hamburger",
                    attrs: { "aria-hidden": "true" },
                  }),
                ],
              }),
              el("button", {
                className: "shell-header__theme-toggle",
                attrs: {
                  type: "button",
                  "aria-label": themeToggleLabel(theme),
                  "aria-pressed": String(theme === "dark"),
                },
                children: [
                  el("span", {
                    className: "icon icon-theme",
                    attrs: { "aria-hidden": "true" },
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function footerLinkSpec(link) {
  const attrs = { href: link.href };
  if (link.external) {
    attrs.target = "_blank";
    attrs.rel = "noopener noreferrer";
  }

  const children = [el("span", { text: link.label })];
  if (link.external) {
    children.push(
      el("span", { className: "icon icon-external-link", attrs: { "aria-hidden": "true" } }),
    );
  }

  return el("li", {
    children: [el("a", { className: "shell-footer__link", attrs, children })],
  });
}

// Pure spec-builder -- docs/DESIGN_SYSTEM.md Section 10.11. The
// staleness paragraph is always present (never conditionally added or
// removed) so mountShell's later state-driven updates only ever need to
// set its textContent, not insert/remove a node; shell.css hides it via
// `:empty` when there is nothing to show yet.
export function buildFooterSpec({ analyticsFetchedAt, now = new Date() } = {}) {
  return el("footer", {
    className: "shell-footer",
    children: [
      el("div", {
        className: "shell-footer__inner page-container",
        children: [
          el("ul", {
            className: "shell-footer__links",
            children: FOOTER_LINKS.map(footerLinkSpec),
          }),
          el("p", {
            className: "shell-footer__staleness",
            text: footerStalenessText(analyticsFetchedAt, now) ?? "",
          }),
        ],
      }),
    ],
  });
}

function safeGetStoredTheme() {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    // localStorage can throw (private browsing, disabled storage) --
    // fall through to the OS-preference/default step of Section 8's
    // precedence rather than letting shell mounting fail entirely.
    return null;
  }
}

function safeSetStoredTheme(theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Non-fatal: the chosen theme still applies for this page view via
    // the data-theme attribute, it just won't persist across a reload.
  }
}

function getPrefersColorScheme() {
  if (typeof window.matchMedia !== "function") return null;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  setState({ theme });
}

function wireThemeToggle(headerNode) {
  const button = headerNode.querySelector(".shell-header__theme-toggle");
  button.addEventListener("click", () => {
    const next = toggleTheme(getState().theme);
    applyTheme(next);
    safeSetStoredTheme(next);
    button.setAttribute("aria-label", themeToggleLabel(next));
    button.setAttribute("aria-pressed", String(next === "dark"));
  });
}

function wireNavToggle(headerNode) {
  const button = headerNode.querySelector(".shell-header__nav-toggle");
  const nav = headerNode.querySelector(".shell-header__nav");

  function close() {
    nav.classList.remove("is-open");
    button.setAttribute("aria-expanded", "false");
  }

  button.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    button.setAttribute("aria-expanded", String(isOpen));
  });

  // docs/ARCHITECTURE.md Section 11: within the dashboard app, a nav
  // link click is a client-side hashchange, not a full page reload --
  // unlike an MPA link, nothing implicitly dismisses the open dropdown,
  // so it must be closed explicitly on every nav-link activation.
  nav.addEventListener("click", (event) => {
    if (event.target.closest(".shell-header__nav-link")) close();
  });

  // Standard disclosure-widget behaviour (docs/ARCHITECTURE.md Section
  // 17: full keyboard navigability) -- Escape and an outside click both
  // dismiss the open dropdown without requiring the user to re-target
  // the hamburger button itself.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.classList.contains("is-open")) close();
  });
  document.addEventListener("click", (event) => {
    if (!nav.classList.contains("is-open")) return;
    if (nav.contains(event.target) || button.contains(event.target)) return;
    close();
  });
}

// Keeps the footer's staleness text live as state.js's analyticsFetchedAt
// changes (docs/ARCHITECTURE.md Section 15: background refreshes update
// state in place). The shell is mounted once per page and is never torn
// down while that page is open, so -- unlike a page module (Section 13)
// -- this subscription is deliberately never released.
function wireFooterStaleness(footerNode) {
  const node = footerNode.querySelector(".shell-footer__staleness");
  const update = (state) => {
    node.textContent = footerStalenessText(state.analyticsFetchedAt, new Date()) ?? "";
  };
  update(getState());
  subscribe(update);
}

// Milestone 27, Human-approved "Option A": constant px/second scroll
// speed (not a constant duration) so the loop feels the same regardless
// of how many events are currently showing -- "smoothness is more
// important than the number of events." Duration is computed per
// render from the actual track width (below), not hardcoded, since the
// same fixed speed needs a longer duration for a longer track.
// MIN_DURATION_SECONDS keeps a very short (1-2 event) list from
// whipping past unreadably fast. MAX_EVENTS caps the accumulated
// history (live-feed-events.js's accumulateFeedEvents) -- a long-running
// tab would otherwise grow the track without bound; the Human's own
// "reduce the number of visible events rather than making the feed feel
// busy" guidance is exactly this cap, tuned against real browser
// testing rather than picked arbitrarily (see PROJECT_LOG.md).
const LIVE_FEED_MAX_EVENTS = 12;
const LIVE_FEED_PIXELS_PER_SECOND = 60;
const LIVE_FEED_MIN_DURATION_SECONDS = 8;

// Pure-ish (no DOM, but not unit-tested alongside live-feed-events.js's
// other pure functions since it exists solely to feed the DOM-glue
// announcer below, the same "small formatting helper kept next to its
// one caller" precedent as pages/ticker.js's own buildAnnouncementText).
// A generic, per-event-type sentence -- deliberately not naming a
// username/workername beyond what `detail` already is (the same
// untrusted free-text value every other component already handles via
// textContent, here via a plain string join rather than the DOM, since
// this becomes an aria-live node's textContent, not innerHTML).
function buildFeedAnnouncementText(newEvents) {
  return newEvents
    .map((event) => {
      const label = (FEED_EVENT_TYPES[event.type] || {}).label || event.type;
      return `${label}: ${event.detail}.`;
    })
    .join(" ");
}

// Mirrors pages/ticker.js's own DOM-glue: a persisted, visually-hidden
// aria-live announcer node is swapped across renders (a live region
// only reliably announces a mutation on a node that survives in the
// DOM, not a brand-new subtree that happens to already contain text),
// and the actual scroll-loop duration is (re)computed from the real,
// just-rendered track width every time the event list changes -- doing
// this after every full rebuild is what keeps the px/second speed
// constant even though Option A rebuilds the whole track on each poll
// (accepted trade-off: this is also the moment the animation visibly
// restarts, at most once per analytics_builder.py cron cycle).
function wireLiveFeed(feedNode) {
  let accumulatedEvents = [];
  let previousSnapshot = null;
  let lastProcessedPayload = null;
  let announcerNode = feedNode.querySelector(".live-feed__announcer");

  function render() {
    const freshNode = specToDom(liveFeedSpec({ events: accumulatedEvents }));
    const freshAnnouncer = freshNode.querySelector(".live-feed__announcer");
    if (announcerNode && freshAnnouncer && freshAnnouncer.parentNode) {
      freshAnnouncer.parentNode.replaceChild(announcerNode, freshAnnouncer);
    } else {
      announcerNode = freshAnnouncer;
    }

    feedNode.replaceChildren(...freshNode.childNodes);

    const track = feedNode.querySelector(".live-feed__track");
    if (track) {
      const halfWidth = track.scrollWidth / 2;
      const durationSeconds = Math.max(LIVE_FEED_MIN_DURATION_SECONDS, halfWidth / LIVE_FEED_PIXELS_PER_SECOND);
      track.style.setProperty("--live-feed-duration", `${durationSeconds}s`);
    }
  }

  function handleAnalyticsPayload(payload) {
    if (payload === lastProcessedPayload) return;
    lastProcessedPayload = payload;

    // The very first payload seeds the feed from live_ticker's own
    // already-existing content (deriveFeedEvents' own documented
    // behaviour) rather than starting genuinely empty -- announcing
    // all of that as if it just arrived would be as misleading as
    // fabricating it, the same reasoning ticker.js's own
    // markNewEntries(entries, null) convention already established for
    // not announcing on first paint.
    const isFirstPayload = previousSnapshot === null;

    const { newEvents, snapshot } = deriveFeedEvents(payload, previousSnapshot);
    previousSnapshot = snapshot;
    accumulatedEvents = accumulateFeedEvents(accumulatedEvents, newEvents, LIVE_FEED_MAX_EVENTS);

    render();
    if (announcerNode) {
      announcerNode.textContent = isFirstPayload ? "" : buildFeedAnnouncementText(newEvents);
    }
  }

  // Code Review (Milestone 27, Major finding): this subscriber runs
  // inside core/state.js's setState() listener loop, which has no
  // per-listener try/catch of its own -- an uncaught exception here
  // would abort that loop entirely (silently skipping any listener
  // registered after this one, e.g. wireFooterStaleness) and propagate
  // back up through whichever page module's own setState(...) call
  // triggered it, skipping that page's own re-render for the cycle too.
  // A bug in this shell-owned, always-mounted feed must never be able
  // to take down an unrelated page's rendering or another subscriber --
  // the same "a rendering bug must not silently and permanently break
  // things" reasoning core/api.js's startPolling already applies to a
  // failing onUpdate callback.
  function safeHandleAnalyticsPayload(payload) {
    try {
      handleAnalyticsPayload(payload);
    } catch (error) {
      // Matches pages/history.js's own defaultOnChartError convention:
      // console.error, guarded, since this project has no other
      // error-reporting/telemetry mechanism to hook into.
      if (typeof console !== "undefined" && console.error) {
        console.error("shell.js: failed to process a live-feed analytics update", error);
      }
    }
  }

  const initialAnalytics = getState().analytics;
  if (initialAnalytics) safeHandleAnalyticsPayload(initialAnalytics);

  subscribe((state) => {
    if (state.analytics) safeHandleAnalyticsPayload(state.analytics);
  });
}

// Mounts the shared header, live feed, and footer around `target`'s
// existing content. `target` is expected to already contain the page's
// own <main id="main-content">; mountShell inserts the header
// immediately before it, the live feed immediately after the header
// (before whatever was there first -- main, in every real caller), and
// appends the footer after everything, without ever needing to know
// which element actually is <main>.
export function mountShell({
  target = document.body,
  location = { pathname: window.location.pathname, hash: window.location.hash },
  navItems = MPA_NAV_ITEMS,
} = {}) {
  const theme = resolveTheme({
    storedTheme: safeGetStoredTheme(),
    prefersColorScheme: getPrefersColorScheme(),
  });
  applyTheme(theme);

  const headerNode = specToDom(buildHeaderSpec({ navItems, location, theme }));
  const feedNode = specToDom(liveFeedSpec({ events: [] }));
  const footerNode = specToDom(buildFooterSpec({ analyticsFetchedAt: getState().analyticsFetchedAt }));

  target.insertBefore(headerNode, target.firstChild);
  target.insertBefore(feedNode, headerNode.nextSibling);
  target.appendChild(footerNode);

  wireThemeToggle(headerNode);
  wireNavToggle(headerNode);
  wireFooterStaleness(footerNode);
  wireLiveFeed(feedNode);

  return { header: headerNode, feed: feedNode, footer: footerNode };
}
