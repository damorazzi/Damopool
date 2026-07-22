// Hash-based router for the dashboard app -- docs/ARCHITECTURE.md
// Section 11. Matching/building logic is pure and DOM-free (fully
// unit-testable in Node); only createRouter's start()/stop() touch
// `window`, since there is no page or route table to wire up yet
// (docs/ARCHITECTURE.md Section 9's pages are later milestones) -- the
// route table is supplied by whichever milestone actually defines it.

export function parseHash(hash) {
  if (!hash || hash === "#") return "/";
  const path = hash.startsWith("#") ? hash.slice(1) : hash;
  return path === "" ? "/" : path;
}

function splitPath(path) {
  return path.split("/").filter((segment) => segment !== "");
}

// Phase E Milestone 27, Code Review finding: app.js's REDIRECTS table
// originally looked up a path with a plain object-key match, which --
// unlike matchRoute below -- doesn't tolerate a trailing slash or
// repeated slashes ("#/ticker/" would silently fail to match "/ticker"
// and fall through to the 404 page instead of redirecting). Exported
// so a lookup table keyed by normalized path (not matched via
// matchRoute's own routes array) can apply the identical normalization
// matchRoute already gives every real route, rather than duplicating
// or drifting from splitPath's own segment-filtering logic.
export function normalizePath(path) {
  return `/${splitPath(path).join("/")}`;
}

// routes: an array of { pattern, ...anything else the caller wants
// attached to the matched route }. First match wins, so static routes
// should be listed before an overlapping dynamic one if both could
// otherwise match the same path -- callers own that ordering, this
// function does not reorder.
export function matchRoute(path, routes) {
  const pathSegments = splitPath(path);

  for (const route of routes) {
    const patternSegments = splitPath(route.pattern);
    if (patternSegments.length !== pathSegments.length) continue;

    const params = {};
    let matched = true;

    for (let i = 0; i < patternSegments.length; i += 1) {
      const patternSegment = patternSegments[i];

      // docs/ARCHITECTURE.md Section 11: "route matching itself
      // always operates on the decoded value" -- not scoped to
      // dynamic segments only, so both branches below compare against
      // the decoded path segment, not the raw one.
      let decodedPathSegment;
      try {
        decodedPathSegment = decodeURIComponent(pathSegments[i]);
      } catch {
        // Malformed percent-encoding (e.g. a stray "%") -- treat as a
        // non-match rather than letting decodeURIComponent throw past
        // this function.
        matched = false;
        break;
      }

      if (patternSegment.startsWith(":")) {
        // Free text (docs/ARCHITECTURE.md Section 18) may contain
        // "/", "#", "%" -- an encoded "/" cannot be misread as an
        // extra path segment, since it was already consumed as one
        // encoded segment by splitPath before decoding here.
        params[patternSegment.slice(1)] = decodedPathSegment;
      } else if (patternSegment !== decodedPathSegment) {
        matched = false;
        break;
      }
    }

    if (matched) return { route, params };
  }

  return null;
}

// The inverse of matchRoute: builds a hash from a pattern and params,
// encoding each dynamic segment so a value containing "/", "#", "%"
// round-trips correctly through matchRoute's decode.
export function buildHash(pattern, params = {}) {
  const segments = splitPath(pattern).map((segment) => {
    if (!segment.startsWith(":")) return segment;
    const key = segment.slice(1);
    const value = params[key];
    // Covers an absent key, an explicit undefined/null value, and an
    // empty string -- an empty-string segment would otherwise be
    // silently dropped by splitPath's own segment filter on the way
    // back through matchRoute, making that param unrecoverable rather
    // than round-tripping.
    if (value === undefined || value === null || value === "") {
      throw new Error(`buildHash: missing param "${key}" for pattern "${pattern}"`);
    }
    return encodeURIComponent(value);
  });
  return `#/${segments.join("/")}`;
}

// DOM-dependent wiring. Not unit-tested in this milestone -- there is
// no browser or DOM emulation available in this project's test setup
// (docs/ARCHITECTURE.md Section 3.3's no-build-step decision extends
// to not adding a DOM-emulation dependency solely for this), so this
// function is reviewed by reading, not executed by a test. The pure
// functions above, which carry the actual matching/encoding logic,
// are fully tested.
export function createRouter(routes, { onNavigate } = {}) {
  function resolve() {
    const path = parseHash(window.location.hash);
    const match = matchRoute(path, routes);
    if (onNavigate) onNavigate(match, path);
    return match;
  }

  function start() {
    window.addEventListener("hashchange", resolve);
    resolve();
  }

  function stop() {
    window.removeEventListener("hashchange", resolve);
  }

  return { start, stop, resolve };
}
