// Dashboard app bootstrap -- docs/ARCHITECTURE.md Section 3.4/4: the
// single entry point (`public/app/index.html`) imports and calls
// `bootstrap()` from here. This module has no side effects at import
// time -- `bootstrap()` must be called explicitly -- so it is safe to
// import from a Node test (`document`/`window` are only ever touched
// inside `bootstrap()` itself, never at module load).
//
// Split the same way as every other DOM-producing module in this
// project: `ROUTES`/`PAGES`/`notFoundSpec`/`decideNavigation` are
// pure and fully unit-tested; `bootstrap()` is the thin DOM glue --
// wiring shell.js's mountShell, core/router.js's createRouter, and
// each matched page module's mount()/unmount() together -- reviewed
// by reading, the same tradeoff already made for createRouter,
// mountShell, and overview.js's own mount()/unmount().

import { el, specToDom } from "./core/dom.js";
import { createRouter } from "./core/router.js";
import { mountShell, APP_NAV_ITEMS } from "./shell/shell.js";
import * as overview from "./pages/overview.js";
import * as pool from "./pages/pool.js";
import * as users from "./pages/users.js";
import * as workers from "./pages/workers.js";
import * as userDetail from "./pages/user-detail.js";
import * as workerDetail from "./pages/worker-detail.js";
import * as search from "./pages/search.js";
import * as ticker from "./pages/ticker.js";

// Every future page (docs/ARCHITECTURE.md Section 23) adds one entry
// to both of these -- its own `route` export and a `{name: module}`
// entry below -- with no other change required here. Pool/Users/
// Workers/Search/Ticker each already had a nav entry waiting in
// shell.js's APP_NAV_ITEMS (Milestone 5 anticipated them all); neither
// detail page does or should -- both are reached by drilling down from
// their list page (username/workername links), not from the top nav,
// matching shell.js's own APP_NAV_ITEMS comment.
export const ROUTES = [
  overview.route,
  pool.route,
  users.route,
  userDetail.route,
  workers.route,
  workerDetail.route,
  search.route,
  ticker.route,
];

const PAGES = {
  [overview.route.name]: overview,
  [pool.route.name]: pool,
  [users.route.name]: users,
  [userDetail.route.name]: userDetail,
  [workers.route.name]: workers,
  [workerDetail.route.name]: workerDetail,
  [search.route.name]: search,
  [ticker.route.name]: ticker,
};

export function notFoundSpec() {
  return el("div", {
    className: "not-found-page",
    children: [
      el("h1", { className: "not-found-page__title", text: "Not Found" }),
      el("p", { text: "This page doesn't exist." }),
    ],
  });
}

function paramsEqual(a = {}, b = {}) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

// Pure decision logic for a router.js onNavigate callback, kept
// separate from the DOM actions it implies (unmounting the previous
// page, mounting the next one, or rendering the not-found fallback) so
// it is testable without a router/DOM instance. `match` is
// matchRoute()'s return shape (`{route, params}` or `null`); `current`
// is `{pageName, params}` for whichever page module is currently
// mounted, or `null` if none is.
//
// Comparing both `pageName` *and* `params` (not just the name) matters
// once a dynamic route exists (router.js already supports named
// segments, e.g. a future `users/:username` detail route) -- without
// the params comparison, navigating from one user's detail page to
// another's would match the same route name and be wrongly treated as
// a no-op, silently freezing the page on its first-ever subject. Every
// route in ROUTES today is static (no params), so this is inert until
// that page exists, but getting the comparison right now costs nothing
// and avoids a real, already-anticipated bug later.
export function decideNavigation(match, current) {
  if (!match) {
    return { action: "not-found", unmountPageName: current ? current.pageName : null };
  }

  const isSamePage =
    current && match.route.name === current.pageName && paramsEqual(match.params, current.params);
  if (isSamePage) {
    // hashchange can fire without the matched route actually changing
    // (e.g. a same-page link); re-mounting would needlessly tear down
    // and rebuild a page that is already showing.
    return { action: "noop", unmountPageName: null };
  }

  return {
    action: "mount",
    pageName: match.route.name,
    params: match.params,
    unmountPageName: current ? current.pageName : null,
  };
}

// Module-scoped, but only to remember what a *previous* bootstrap()
// call left mounted so a later call can tear it down first --
// `activePage`/`activeRouter` are never read or written by anything
// except bootstrap() itself, and are fully reassigned at the top of
// every call. All per-navigation state (`current` in the closure
// below) lives inside bootstrap()'s own function scope, not at module
// scope, so two bootstrap() calls never share the mutable state that
// decideNavigation() reasons about -- resetting a module-level
// variable at the top of a call, as an earlier version of this file
// did, is not the same thing: it makes this file's own bookkeeping
// forget what happened, without actually undoing it, so the *previous*
// call's page module (pages/overview.js's own mount() throws on a
// double mount) would still think it's mounted and reject the new
// call's attempt to mount it again. Tearing down the previous
// instance's router and page module here is what actually fixes that.
let activeRouter = null;
let activePage = null;

export function bootstrap({ target = document.body, mainSelector = "#main-content" } = {}) {
  if (activeRouter) {
    activeRouter.stop();
    if (activePage && PAGES[activePage.pageName]) {
      PAGES[activePage.pageName].unmount();
    }
    activeRouter = null;
    activePage = null;
  }

  mountShell({ target, navItems: APP_NAV_ITEMS });

  const main = target.querySelector(mainSelector);
  if (!main) {
    throw new Error(
      `app.bootstrap: target has no "${mainSelector}" element (docs/ARCHITECTURE.md's shell contract requires one)`,
    );
  }

  function showNotFound() {
    main.replaceChildren(specToDom(notFoundSpec()));
    activePage = null;
  }

  const router = createRouter(ROUTES, {
    onNavigate(match) {
      const decision = decideNavigation(match, activePage);

      if (decision.unmountPageName && PAGES[decision.unmountPageName]) {
        PAGES[decision.unmountPageName].unmount();
      }

      if (decision.action === "noop") return;

      if (decision.action === "not-found") {
        showNotFound();
        return;
      }

      // Guards against a ROUTES/PAGES drift (a route added to one
      // table but not the other, e.g. a future page-addition milestone
      // missing a step) -- without this, a matched route with no
      // PAGES entry would throw from inside the hashchange handler
      // after the previous page was already unmounted, leaving a
      // blank, unrecoverable page with no visible error.
      const page = PAGES[decision.pageName];
      if (!page) {
        showNotFound();
        return;
      }

      // `params` was tracked in this file's own bookkeeping since
      // Milestone 7 but never forwarded, since no page consumed it --
      // user-detail.js is the first to. Harmless for every other page
      // (their mount() options don't destructure `params` at all, so
      // an unused extra key is simply ignored).
      page.mount(main, { params: decision.params });
      activePage = { pageName: decision.pageName, params: decision.params };
    },
  });

  // Assigned before start(), not after -- start() synchronously calls
  // resolve() (router.js), which calls onNavigate for the initial
  // route before start() returns. If a page's mount() ever threw
  // synchronously there, an assignment placed after start() would
  // never run, leaving activeRouter still null/stale and this
  // router's hashchange listener untracked and unstoppable by any
  // later bootstrap() call's teardown.
  activeRouter = router;
  router.start();
  return router;
}
