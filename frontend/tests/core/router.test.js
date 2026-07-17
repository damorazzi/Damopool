import test from "node:test";
import assert from "node:assert/strict";
import { parseHash, matchRoute, buildHash } from "../../src/core/router.js";

test("parseHash", async (t) => {
  await t.test("empty/absent hash is the root path", () => {
    assert.equal(parseHash(""), "/");
    assert.equal(parseHash(undefined), "/");
    assert.equal(parseHash(null), "/");
  });
  await t.test('a bare "#" is the root path', () => {
    assert.equal(parseHash("#"), "/");
  });
  await t.test("strips the leading # from a real path", () => {
    assert.equal(parseHash("#/pool"), "/pool");
    assert.equal(parseHash("#/users/alice"), "/users/alice");
  });
  await t.test("a hash-less path is returned as-is", () => {
    assert.equal(parseHash("/pool"), "/pool");
  });
});

const ROUTES = [
  { pattern: "/", name: "overview" },
  { pattern: "/pool", name: "pool" },
  { pattern: "/users", name: "users" },
  { pattern: "/users/:username", name: "user-detail" },
  { pattern: "/workers/:workername", name: "worker-detail" },
];

test("matchRoute", async (t) => {
  await t.test("matches a static route exactly", () => {
    const result = matchRoute("/pool", ROUTES);
    assert.equal(result.route.name, "pool");
    assert.deepEqual(result.params, {});
  });

  await t.test("matches the root path", () => {
    const result = matchRoute("/", ROUTES);
    assert.equal(result.route.name, "overview");
  });

  await t.test("static routes are not shadowed by an overlapping dynamic one", () => {
    // /users (static, listed first) vs /users/:username (dynamic) --
    // different segment counts, so this isn't actually ambiguous, but
    // confirms list order plus segment-count matching both behave.
    const result = matchRoute("/users", ROUTES);
    assert.equal(result.route.name, "users");
  });

  await t.test("first match wins for genuinely colliding same-length routes", () => {
    // Unlike the /users vs /users/:username case above, these two
    // patterns have identical segment counts and can both match the
    // same path -- this is the actual "first match wins" contract the
    // module's own comment documents, exercised directly rather than
    // by a same-segment-count coincidence.
    const collidingRoutes = [
      { pattern: "/users/me", name: "current-user" },
      { pattern: "/users/:username", name: "user-detail" },
    ];
    const staticFirst = matchRoute("/users/me", collidingRoutes);
    assert.equal(staticFirst.route.name, "current-user");

    const dynamicFirst = matchRoute("/users/me", [...collidingRoutes].reverse());
    assert.equal(dynamicFirst.route.name, "user-detail");
    assert.deepEqual(dynamicFirst.params, { username: "me" });
  });

  await t.test("a static pattern segment is compared against the decoded value", () => {
    // docs/ARCHITECTURE.md Section 11: matching operates on the
    // decoded value, not scoped to dynamic segments only -- a
    // percent-encoded "users" should still match the literal /users
    // pattern.
    const result = matchRoute("/%75sers", ROUTES); // %75 == "u"
    assert.equal(result.route.name, "users");
  });

  await t.test("captures a dynamic segment and decodes it", () => {
    const result = matchRoute("/users/alice", ROUTES);
    assert.equal(result.route.name, "user-detail");
    assert.deepEqual(result.params, { username: "alice" });
  });

  await t.test("decodes a username containing an encoded slash", () => {
    // The concrete risk docs/ARCHITECTURE.md Section 11 names: a
    // username containing "/" must not be misread as an extra path
    // segment once encoded.
    const encoded = encodeURIComponent("weird/name");
    const result = matchRoute(`/users/${encoded}`, ROUTES);
    assert.equal(result.route.name, "user-detail");
    assert.deepEqual(result.params, { username: "weird/name" });
  });

  await t.test("decodes a workername containing encoded # and %", () => {
    const raw = "rig#1 100%";
    const encoded = encodeURIComponent(raw);
    const result = matchRoute(`/workers/${encoded}`, ROUTES);
    assert.equal(result.route.name, "worker-detail");
    assert.deepEqual(result.params, { workername: raw });
  });

  await t.test("no match for an unknown path", () => {
    assert.equal(matchRoute("/does-not-exist", ROUTES), null);
  });

  await t.test("no match when segment counts differ", () => {
    assert.equal(matchRoute("/users/alice/extra", ROUTES), null);
  });

  await t.test("malformed percent-encoding is a non-match, not a throw", () => {
    assert.equal(matchRoute("/users/%", ROUTES), null);
  });

  await t.test("leading/trailing/double slashes are tolerated", () => {
    const result = matchRoute("//pool//", ROUTES);
    assert.equal(result.route.name, "pool");
  });

  await t.test("the root pattern only matches the root path, not everything", () => {
    assert.equal(matchRoute("/pool", ROUTES).route.name, "pool");
    assert.notEqual(matchRoute("/pool", ROUTES).route.name, "overview");
  });

  await t.test("a pattern with two dynamic segments captures both", () => {
    const routes = [{ pattern: "/pool/:date/:hour", name: "pool-history-hour" }];
    const result = matchRoute("/pool/2026-07-17/09", routes);
    assert.equal(result.route.name, "pool-history-hour");
    assert.deepEqual(result.params, { date: "2026-07-17", hour: "09" });
  });

  await t.test("a unicode username round-trips through decode", () => {
    const raw = "ééé-池主";
    const result = matchRoute(`/users/${encodeURIComponent(raw)}`, ROUTES);
    assert.equal(result.route.name, "user-detail");
    assert.deepEqual(result.params, { username: raw });
  });
});

test("buildHash", async (t) => {
  await t.test("builds a hash for a static route", () => {
    assert.equal(buildHash("/pool"), "#/pool");
  });

  await t.test("builds and encodes a dynamic segment", () => {
    assert.equal(buildHash("/users/:username", { username: "alice" }), "#/users/alice");
  });

  await t.test("encodes special characters so they round-trip", () => {
    const raw = "weird/name#1 100%";
    const hash = buildHash("/users/:username", { username: raw });
    // Strip the leading "#/users/" the same way matchRoute would see
    // it after parseHash, then confirm matchRoute decodes it back to
    // the original value -- a real round-trip, not just an encode
    // check in isolation.
    const path = parseHash(hash);
    const result = matchRoute(path, ROUTES);
    assert.equal(result.route.name, "user-detail");
    assert.equal(result.params.username, raw);
  });

  await t.test("throws when a required param is missing", () => {
    assert.throws(() => buildHash("/users/:username", {}), /missing param "username"/);
  });

  await t.test("throws for an explicit undefined param, not the literal string \"undefined\"", () => {
    assert.throws(
      () => buildHash("/users/:username", { username: undefined }),
      /missing param "username"/,
    );
  });

  await t.test("throws for an empty-string param rather than dropping it silently", () => {
    // An empty-string segment would otherwise be filtered out by
    // splitPath on the way back through matchRoute, making the param
    // unrecoverable rather than round-tripping.
    assert.throws(
      () => buildHash("/users/:username", { username: "" }),
      /missing param "username"/,
    );
  });
});
