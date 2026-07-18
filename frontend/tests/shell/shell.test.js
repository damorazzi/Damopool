import test from "node:test";
import assert from "node:assert/strict";
import {
  MPA_NAV_ITEMS,
  APP_NAV_ITEMS,
  FOOTER_LINKS,
  resolveTheme,
  toggleTheme,
  themeToggleLabel,
  isNavItemActive,
  footerStalenessText,
  buildHeaderSpec,
  buildFooterSpec,
} from "../../src/shell/shell.js";

test("resolveTheme", async (t) => {
  await t.test("a saved localStorage choice always wins", () => {
    assert.equal(resolveTheme({ storedTheme: "light", prefersColorScheme: "dark" }), "light");
    assert.equal(resolveTheme({ storedTheme: "dark", prefersColorScheme: "light" }), "dark");
  });

  await t.test("falls back to OS preference when nothing is stored", () => {
    assert.equal(resolveTheme({ storedTheme: null, prefersColorScheme: "light" }), "light");
  });

  await t.test("defaults to dark when neither a stored choice nor a light OS preference exists", () => {
    assert.equal(resolveTheme({ storedTheme: null, prefersColorScheme: "dark" }), "dark");
    assert.equal(resolveTheme({ storedTheme: null, prefersColorScheme: null }), "dark");
    assert.equal(resolveTheme({}), "dark");
    assert.equal(resolveTheme(), "dark");
  });

  await t.test("an invalid stored value is ignored, not trusted as-is", () => {
    assert.equal(resolveTheme({ storedTheme: "sepia", prefersColorScheme: "light" }), "light");
  });
});

test("toggleTheme", async (t) => {
  await t.test("flips between the two themes", () => {
    assert.equal(toggleTheme("dark"), "light");
    assert.equal(toggleTheme("light"), "dark");
  });
});

test("themeToggleLabel", async (t) => {
  await t.test("describes the theme the toggle will switch to", () => {
    assert.equal(themeToggleLabel("dark"), "Switch to light theme");
    assert.equal(themeToggleLabel("light"), "Switch to dark theme");
  });
});

test("isNavItemActive", async (t) => {
  await t.test("matches an MPA item by exact pathname", () => {
    assert.equal(isNavItemActive({ href: "/status.html" }, { pathname: "/status.html" }), true);
    assert.equal(isNavItemActive({ href: "/status.html" }, { pathname: "/docs/" }), false);
  });

  await t.test("the root MPA item also matches /index.html", () => {
    assert.equal(isNavItemActive({ href: "/" }, { pathname: "/" }), true);
    assert.equal(isNavItemActive({ href: "/" }, { pathname: "/index.html" }), true);
    assert.equal(isNavItemActive({ href: "/" }, { pathname: "/status.html" }), false);
  });

  await t.test("the app entry point matches any path under /app/", () => {
    assert.equal(isNavItemActive({ href: "/app/" }, { pathname: "/app/" }), true);
    assert.equal(isNavItemActive({ href: "/app/" }, { pathname: "/app/index.html" }), true);
    assert.equal(isNavItemActive({ href: "/app/" }, { pathname: "/" }), false);
  });

  await t.test("matches an APP item by hash, reusing parseHash's normalization", () => {
    assert.equal(isNavItemActive({ hash: "#/pool" }, { hash: "#/pool" }), true);
    assert.equal(isNavItemActive({ hash: "#/" }, { hash: "" }), true);
    assert.equal(isNavItemActive({ hash: "#/" }, { hash: "#" }), true);
    assert.equal(isNavItemActive({ hash: "#/pool" }, { hash: "#/users" }), false);
  });

  await t.test("an item with neither href nor hash is never active", () => {
    assert.equal(isNavItemActive({ label: "x" }, { pathname: "/", hash: "" }), false);
  });

  await t.test("missing location fields default to the root path/empty hash", () => {
    assert.equal(isNavItemActive({ href: "/" }, {}), true);
    assert.equal(isNavItemActive({ hash: "#/" }, {}), true);
  });
});

test("footerStalenessText", async (t) => {
  const now = new Date("2026-07-18T12:00:00Z");

  await t.test("wraps a formatted relative time", () => {
    const fetchedAt = new Date(now.getTime() - 5 * 60000).toISOString();
    assert.equal(footerStalenessText(fetchedAt, now), "Data as of 5m ago");
  });

  await t.test("returns null when there is nothing to show yet", () => {
    assert.equal(footerStalenessText(null, now), null);
    assert.equal(footerStalenessText(undefined, now), null);
    assert.equal(footerStalenessText("unknown", now), null);
  });
});

test("nav and footer link data", async (t) => {
  await t.test("MPA nav includes the App entry point", () => {
    assert.ok(MPA_NAV_ITEMS.some((item) => item.href === "/app/"));
  });

  await t.test("every MPA item has an href and every APP item has a hash", () => {
    for (const item of MPA_NAV_ITEMS) {
      assert.equal(typeof item.href, "string");
      assert.equal(item.hash, undefined);
    }
    for (const item of APP_NAV_ITEMS) {
      assert.equal(typeof item.hash, "string");
      assert.equal(item.href, undefined);
    }
  });

  await t.test("nav item ids are unique within each list", () => {
    for (const list of [MPA_NAV_ITEMS, APP_NAV_ITEMS, FOOTER_LINKS]) {
      const ids = list.map((item) => item.id);
      assert.equal(new Set(ids).size, ids.length);
    }
  });

  await t.test("the GitHub footer link is external", () => {
    const github = FOOTER_LINKS.find((link) => link.id === "github");
    assert.equal(github.external, true);
    assert.match(github.href, /^https:\/\/github\.com\//);
  });
});

// inner.children is [logo, nav, controls]; controls.children is
// [nav-toggle button, theme-toggle button] -- grouped together
// (shell.css) so a single auto margin keeps both pinned to the
// header's trailing edge at every breakpoint.
function headerParts(spec) {
  const inner = spec.children[1];
  const [logo, nav, controls] = inner.children;
  const [navToggle, themeToggle] = controls.children;
  return { inner, logo, nav, controls, navToggle, themeToggle };
}

test("buildHeaderSpec", async (t) => {
  const location = { pathname: "/status.html", hash: "" };

  await t.test("renders a skip-link first, then logo/nav/controls", () => {
    const spec = buildHeaderSpec({ navItems: MPA_NAV_ITEMS, location, theme: "dark" });
    assert.equal(spec.tag, "header");
    assert.equal(spec.className, "shell-header");
    assert.equal(spec.children[0].className, "skip-link");
    assert.equal(spec.children[0].attrs.href, "#main-content");

    const { logo, nav, controls, navToggle, themeToggle } = headerParts(spec);
    assert.equal(logo.tag, "a");
    assert.equal(logo.text, "Damopool");
    assert.equal(nav.tag, "nav");
    assert.equal(controls.className, "shell-header__controls");
    assert.equal(navToggle.className, "shell-header__nav-toggle");
    assert.equal(themeToggle.className, "shell-header__theme-toggle");
  });

  await t.test("marks the matching MPA nav item active with aria-current", () => {
    const spec = buildHeaderSpec({ navItems: MPA_NAV_ITEMS, location, theme: "dark" });
    const navList = headerParts(spec).nav.children[0];
    const links = navList.children.map((li) => li.children[0]);

    const status = links.find((a) => a.text === "Status");
    assert.equal(status.className, "shell-header__nav-link shell-header__nav-link--active");
    assert.equal(status.attrs["aria-current"], "page");

    const home = links.find((a) => a.text === "Home");
    assert.equal(home.className, "shell-header__nav-link");
    assert.equal(home.attrs["aria-current"], undefined);
  });

  await t.test("marks the matching APP nav item active by hash, end to end", () => {
    // Unlike the MPA case above, this exercises isNavItemActive's hash
    // branch through buildHeaderSpec itself, not just isNavItemActive
    // in isolation.
    const spec = buildHeaderSpec({ navItems: APP_NAV_ITEMS, location: { hash: "#/pool" }, theme: "dark" });
    const navList = headerParts(spec).nav.children[0];
    const links = navList.children.map((li) => li.children[0]);

    const pool = links.find((a) => a.text === "Pool");
    assert.equal(pool.className, "shell-header__nav-link shell-header__nav-link--active");
    assert.equal(pool.attrs["aria-current"], "page");

    const overview = links.find((a) => a.text === "Overview");
    assert.equal(overview.className, "shell-header__nav-link");
    assert.equal(overview.attrs["aria-current"], undefined);
  });

  await t.test("nav link hrefs come from href for MPA items and hash for APP items", () => {
    const mpaSpec = buildHeaderSpec({ navItems: MPA_NAV_ITEMS, location, theme: "dark" });
    const mpaLinks = headerParts(mpaSpec).nav.children[0].children.map((li) => li.children[0]);
    assert.ok(mpaLinks.some((a) => a.attrs.href === "/docs/"));

    const appSpec = buildHeaderSpec({ navItems: APP_NAV_ITEMS, location: { hash: "#/pool" }, theme: "dark" });
    const appLinks = headerParts(appSpec).nav.children[0].children.map((li) => li.children[0]);
    assert.ok(appLinks.some((a) => a.attrs.href === "#/pool"));
  });

  await t.test("navListSpec throws for a nav item with neither href nor hash", () => {
    assert.throws(
      () => buildHeaderSpec({ navItems: [{ id: "broken", label: "Broken" }], location, theme: "dark" }),
      /neither href nor hash/,
    );
  });

  await t.test("the theme toggle's aria-label and aria-pressed match the given theme", () => {
    const dark = headerParts(buildHeaderSpec({ navItems: MPA_NAV_ITEMS, location, theme: "dark" }));
    assert.equal(dark.themeToggle.attrs["aria-label"], "Switch to light theme");
    assert.equal(dark.themeToggle.attrs["aria-pressed"], "true");

    const light = headerParts(buildHeaderSpec({ navItems: MPA_NAV_ITEMS, location, theme: "light" }));
    assert.equal(light.themeToggle.attrs["aria-label"], "Switch to dark theme");
    assert.equal(light.themeToggle.attrs["aria-pressed"], "false");
  });

  await t.test("icon spans are aria-hidden", () => {
    const spec = buildHeaderSpec({ navItems: MPA_NAV_ITEMS, location, theme: "dark" });
    const { navToggle, themeToggle } = headerParts(spec);
    assert.equal(navToggle.children[0].attrs["aria-hidden"], "true");
    assert.equal(themeToggle.children[0].attrs["aria-hidden"], "true");
  });
});

test("buildFooterSpec", async (t) => {
  await t.test("renders every footer link", () => {
    const spec = buildFooterSpec({ analyticsFetchedAt: null });
    const inner = spec.children[0];
    const linkList = inner.children[0];
    assert.equal(linkList.children.length, FOOTER_LINKS.length);
  });

  await t.test("the staleness paragraph is present but empty when there is no fetch yet", () => {
    const spec = buildFooterSpec({ analyticsFetchedAt: null });
    const staleness = spec.children[0].children[1];
    assert.equal(staleness.className, "shell-footer__staleness");
    assert.equal(staleness.text, "");
  });

  await t.test("the staleness paragraph carries the formatted text when a fetch exists", () => {
    const now = new Date("2026-07-18T12:00:00Z");
    const fetchedAt = new Date(now.getTime() - 2 * 60000).toISOString();
    const spec = buildFooterSpec({ analyticsFetchedAt: fetchedAt, now });
    assert.equal(spec.children[0].children[1].text, "Data as of 2m ago");
  });

  await t.test("the external GitHub link carries target/rel and an icon; internal links do not", () => {
    const spec = buildFooterSpec({ analyticsFetchedAt: null });
    const linkAnchors = spec.children[0].children[0].children.map((li) => li.children[0]);

    const github = linkAnchors.find((a) => a.attrs.href.includes("github.com"));
    assert.equal(github.attrs.target, "_blank");
    assert.equal(github.attrs.rel, "noopener noreferrer");
    assert.equal(github.children.length, 2);

    const home = linkAnchors.find((a) => a.attrs.href === "/");
    assert.equal(home.attrs.target, undefined);
    assert.equal(home.children.length, 1);
  });
});
