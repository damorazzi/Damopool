import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ROUTES,
  REDIRECTS,
  resolveRedirect,
  notFoundSpec,
  decideNavigation,
  ANALYTICS_POLL_INTERVAL_MS,
  ANALYTICS_STALE_AFTER_MS,
} from "../src/app.js";
import { route as overviewRoute } from "../src/pages/overview.js";
import { route as poolRoute } from "../src/pages/pool.js";
import { route as usersRoute } from "../src/pages/users.js";
import { route as workersRoute } from "../src/pages/workers.js";
import { route as userDetailRoute } from "../src/pages/user-detail.js";
import { route as workerDetailRoute } from "../src/pages/worker-detail.js";
import { route as historyRoute } from "../src/pages/history.js";
import { matchRoute } from "../src/core/router.js";
import { THEME_STORAGE_KEY } from "../src/shell/shell.js";

test("ROUTES", async (t) => {
  await t.test("includes every page's route, unmodified", () => {
    assert.equal(ROUTES.length, 7);
    assert.equal(ROUTES[0], overviewRoute);
    assert.equal(ROUTES[1], poolRoute);
    assert.equal(ROUTES[2], usersRoute);
    assert.equal(ROUTES[3], userDetailRoute);
    assert.equal(ROUTES[4], workersRoute);
    assert.equal(ROUTES[5], workerDetailRoute);
    assert.equal(ROUTES[6], historyRoute);
  });

  await t.test("the root path matches the Overview route, matching router.js's own matching logic", () => {
    const match = matchRoute("/", ROUTES);
    assert.ok(match);
    assert.equal(match.route.name, "overview");
  });

  await t.test("/pool matches the Pool route", () => {
    const match = matchRoute("/pool", ROUTES);
    assert.ok(match);
    assert.equal(match.route.name, "pool");
  });

  await t.test("/users matches the Users route", () => {
    const match = matchRoute("/users", ROUTES);
    assert.ok(match);
    assert.equal(match.route.name, "users");
  });

  await t.test("/workers matches the Workers route", () => {
    const match = matchRoute("/workers", ROUTES);
    assert.ok(match);
    assert.equal(match.route.name, "workers");
  });

  await t.test("/users/:username matches the User Detail route and captures the username", () => {
    const match = matchRoute("/users/alice", ROUTES);
    assert.ok(match);
    assert.equal(match.route.name, "user-detail");
    assert.deepEqual(match.params, { username: "alice" });
  });

  await t.test("the static /users route is not shadowed by the dynamic /users/:username one", () => {
    const match = matchRoute("/users", ROUTES);
    assert.equal(match.route.name, "users");
  });

  await t.test("/workers/:workername matches the Worker Detail route and captures the workername", () => {
    const match = matchRoute("/workers/rig1", ROUTES);
    assert.ok(match);
    assert.equal(match.route.name, "worker-detail");
    assert.deepEqual(match.params, { workername: "rig1" });
  });

  await t.test("the static /workers route is not shadowed by the dynamic /workers/:workername one", () => {
    const match = matchRoute("/workers", ROUTES);
    assert.equal(match.route.name, "workers");
  });

  await t.test("/history matches the History route", () => {
    const match = matchRoute("/history", ROUTES);
    assert.ok(match);
    assert.equal(match.route.name, "history");
  });

  await t.test("/ticker and /search (both retired pages' former routes) no longer match -- both are handled as redirects instead", () => {
    assert.equal(matchRoute("/ticker", ROUTES), null);
    assert.equal(matchRoute("/search", ROUTES), null);
  });

  await t.test("an unknown path does not match", () => {
    assert.equal(matchRoute("/does-not-exist", ROUTES), null);
  });
});

test("REDIRECTS / resolveRedirect", async (t) => {
  await t.test("/ticker redirects to Overview (Phase E Milestone 27: the Ticker page was retired, superseded by the Global Live Feed)", () => {
    assert.equal(resolveRedirect("/ticker"), "/");
  });

  await t.test("/search redirects to Users (Phase E Milestone 27: the Search page was retired, its functionality embedded into Users)", () => {
    assert.equal(resolveRedirect("/search"), "/users");
  });

  await t.test("a path with no registered redirect returns null, not undefined or an empty string", () => {
    assert.equal(resolveRedirect("/does-not-exist"), null);
    assert.equal(resolveRedirect("/pool"), null);
  });

  await t.test("REDIRECTS never targets a path that isn't itself a real, currently-matchable route", () => {
    for (const target of Object.values(REDIRECTS)) {
      assert.ok(matchRoute(target, ROUTES), `redirect target "${target}" must itself resolve to a real route`);
    }
  });

  await t.test("Code Review fix: a trailing slash still resolves the redirect (normalized the same way matchRoute normalizes a real route)", () => {
    assert.equal(resolveRedirect("/ticker/"), "/");
    assert.equal(resolveRedirect("/search/"), "/users");
  });
});

test("notFoundSpec", async (t) => {
  await t.test("renders a heading and message, not a blank page", () => {
    const spec = notFoundSpec();
    assert.equal(spec.tag, "div");
    const heading = spec.children.find((c) => c.tag === "h1");
    assert.ok(heading);
    assert.match(heading.text, /Not Found/);
  });
});

test("decideNavigation", async (t) => {
  await t.test("no match, nothing currently mounted -> not-found, nothing to unmount", () => {
    const decision = decideNavigation(null, null);
    assert.equal(decision.action, "not-found");
    assert.equal(decision.unmountPageName, null);
  });

  await t.test("no match, a page is currently mounted -> not-found, that page must be unmounted", () => {
    const decision = decideNavigation(null, { pageName: "overview", params: {} });
    assert.equal(decision.action, "not-found");
    assert.equal(decision.unmountPageName, "overview");
  });

  await t.test("a match for the page already mounted, same params -> noop, nothing unmounted or remounted", () => {
    const match = { route: { name: "overview", pattern: "/" }, params: {} };
    const decision = decideNavigation(match, { pageName: "overview", params: {} });
    assert.equal(decision.action, "noop");
    assert.equal(decision.unmountPageName, null);
  });

  await t.test("a match for a different page than what's mounted -> mount, old page unmounted first", () => {
    const match = { route: { name: "pool", pattern: "/pool" }, params: {} };
    const decision = decideNavigation(match, { pageName: "overview", params: {} });
    assert.equal(decision.action, "mount");
    assert.equal(decision.pageName, "pool");
    assert.equal(decision.unmountPageName, "overview");
  });

  await t.test("a match when nothing is currently mounted -> mount, nothing to unmount first", () => {
    const match = { route: { name: "overview", pattern: "/" }, params: {} };
    const decision = decideNavigation(match, null);
    assert.equal(decision.action, "mount");
    assert.equal(decision.pageName, "overview");
    assert.equal(decision.unmountPageName, null);
  });

  await t.test("the same route name but different params is a real navigation, not a no-op", () => {
    // The concrete scenario this guards against: a future dynamic
    // route (e.g. users/:username) navigating from one subject to
    // another must not be mistaken for staying on the same page.
    const match = { route: { name: "user-detail", pattern: "/users/:username" }, params: { username: "bob" } };
    const decision = decideNavigation(match, { pageName: "user-detail", params: { username: "alice" } });
    assert.equal(decision.action, "mount");
    assert.equal(decision.pageName, "user-detail");
    assert.deepEqual(decision.params, { username: "bob" });
    assert.equal(decision.unmountPageName, "user-detail");
  });

  await t.test("the same route name and the same params is correctly a no-op", () => {
    const match = { route: { name: "user-detail", pattern: "/users/:username" }, params: { username: "alice" } };
    const decision = decideNavigation(match, { pageName: "user-detail", params: { username: "alice" } });
    assert.equal(decision.action, "noop");
  });

  await t.test("a mount decision carries the matched params through", () => {
    const match = { route: { name: "overview", pattern: "/" }, params: { foo: "bar" } };
    const decision = decideNavigation(match, null);
    assert.deepEqual(decision.params, { foo: "bar" });
  });
});

test("public/app/index.html", async (t) => {
  const html = readFileSync(new URL("../public/app/index.html", import.meta.url), "utf8");

  await t.test("the FOUC-prevention inline script reads the same localStorage key shell.js's resolveTheme uses", () => {
    // Regression coverage for a future drift: if shell.js's
    // THEME_STORAGE_KEY ever changes without this literal being
    // updated too, the inline script would silently start reading the
    // wrong key and reintroduce the flash-of-wrong-theme it exists to
    // prevent -- with no other test able to catch that, since an ES
    // module can't be imported into a non-module inline <script>.
    assert.match(html, new RegExp(`localStorage\\.getItem\\("${THEME_STORAGE_KEY}"\\)`));
  });

  await t.test('contains a <main id="main-content"> element, per shell.js\'s mount contract', () => {
    assert.match(html, /<main id="main-content">/);
  });

  await t.test("imports and calls bootstrap() from app.js", () => {
    assert.match(html, /import\s*\{\s*bootstrap\s*\}\s*from\s*"\.\.\/\.\.\/src\/app\.js"/);
    assert.match(html, /bootstrap\(\);/);
  });

  await t.test("loads card.css and chart-panel.css (Phase E Milestone 18: without these, chart-panel.js's canvas container has no rendered height)", () => {
    assert.match(html, /<link rel="stylesheet" href="\.\.\/\.\.\/src\/styles\/components\/card\.css">/);
    assert.match(html, /<link rel="stylesheet" href="\.\.\/\.\.\/src\/styles\/components\/chart-panel\.css">/);
  });

  await t.test("ECharts is loaded pinned to an exact version with a matching SRI hash and crossorigin (Phase E Milestone 24) -- catches a future accidental revert to the unpinned URL, a version/hash mismatch, or a dropped crossorigin attribute (which would silently fail the script load entirely, not just skip integrity checking)", () => {
    assert.match(
      html,
      /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/echarts@6\.1\.0\/dist\/echarts\.min\.js"\s*\n\s*integrity="sha384-C2iskrW\/uPW46KzOjrvJIQo4YkV8lkD\+QS0CrDN18IIPIpT\/g2USu8bTP3nvmIAD"\s*\n\s*crossorigin="anonymous"><\/script>/,
    );
  });
});

test("Phase E Milestone 23: polling cadence constants", async (t) => {
  await t.test("ANALYTICS_POLL_INTERVAL_MS matches analytics_builder.py's real cron cadence (every 5 minutes)", () => {
    assert.equal(ANALYTICS_POLL_INTERVAL_MS, 5 * 60 * 1000);
  });

  await t.test("ANALYTICS_STALE_AFTER_MS is 3x the poll interval, so the staleness indicator tolerates ~2-3 missed cycles before firing", () => {
    assert.equal(ANALYTICS_STALE_AFTER_MS, 15 * 60 * 1000);
    assert.equal(ANALYTICS_STALE_AFTER_MS, ANALYTICS_POLL_INTERVAL_MS * 3);
  });
});
