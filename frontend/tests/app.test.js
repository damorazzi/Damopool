import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROUTES, notFoundSpec, decideNavigation } from "../src/app.js";
import { route as overviewRoute } from "../src/pages/overview.js";
import { route as poolRoute } from "../src/pages/pool.js";
import { matchRoute } from "../src/core/router.js";
import { THEME_STORAGE_KEY } from "../src/shell/shell.js";

test("ROUTES", async (t) => {
  await t.test("includes both pages' routes, unmodified", () => {
    assert.equal(ROUTES.length, 2);
    assert.equal(ROUTES[0], overviewRoute);
    assert.equal(ROUTES[1], poolRoute);
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

  await t.test("an unknown path does not match", () => {
    assert.equal(matchRoute("/does-not-exist", ROUTES), null);
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
});
