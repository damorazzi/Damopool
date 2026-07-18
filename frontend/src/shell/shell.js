// Shared application shell -- docs/ARCHITECTURE.md Section 4/5/10: one
// module renders the header (logo, nav, theme toggle) and footer
// identically on every page, MPA and SPA alike. A page provides its own
// <main id="main-content"> content; mountShell() inserts the header
// immediately before it and the footer after it -- shell.js never
// touches or owns <main> itself (Section 5's component hierarchy draws
// that boundary at the shell, not inside it).
//
// Split the same way as router.js/dom.js: buildHeaderSpec/buildFooterSpec
// and every other function up to mountShell are pure spec-builders (no
// DOM APIs), fully unit-tested. mountShell itself -- reading
// localStorage/matchMedia, appending real nodes, wiring click listeners
// -- is DOM-dependent and reviewed by reading, the same tradeoff already
// made for router.js's createRouter and dom.js's specToDom.

import { el, specToDom } from "../core/dom.js";
import { parseHash } from "../core/router.js";
import { formatRelativeTime } from "../core/format.js";
import { getState, setState, subscribe } from "../core/state.js";

const THEME_STORAGE_KEY = "damopool-theme";

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
// Overview / User Detail wireframes (Section 22).
export const APP_NAV_ITEMS = [
  { id: "overview", label: "Overview", hash: "#/" },
  { id: "pool", label: "Pool", hash: "#/pool" },
  { id: "users", label: "Users", hash: "#/users" },
  { id: "workers", label: "Workers", hash: "#/workers" },
  { id: "ticker", label: "Ticker", hash: "#/ticker" },
  { id: "search", label: "Search", hash: "#/search" },
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
          // header's trailing edge regardless of which breakpoint's
          // in-flow siblings differ (the nav toggle is only in-flow
          // below 768px, the nav list only above it) -- two separate
          // auto margins on siblings would instead split the free
          // space between them.
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

// Mounts the shared header and footer around `target`'s existing
// content. `target` is expected to already contain the page's own
// <main id="main-content">; mountShell inserts the header immediately
// before it and appends the footer after it, and never touches anything
// in between.
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
  const footerNode = specToDom(buildFooterSpec({ analyticsFetchedAt: getState().analyticsFetchedAt }));

  target.insertBefore(headerNode, target.firstChild);
  target.appendChild(footerNode);

  wireThemeToggle(headerNode);
  wireNavToggle(headerNode);
  wireFooterStaleness(footerNode);

  return { header: headerNode, footer: footerNode };
}
