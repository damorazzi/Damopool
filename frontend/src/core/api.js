// The sole fetch boundary -- docs/ARCHITECTURE.md Section 15. No page
// module calls fetch() directly; everything goes through
// fetchEndpoint so caching, retry, and staleness logic live in one
// place, and a future authenticated endpoint (Section 18) only needs
// buildHeaders() changed, not every call site.

import { classifyFetchError, validateSchema, getStaleness } from "./errors.js";

const cache = new Map();
// Tracks the most recently *issued* request per endpoint, so a slower
// older request finishing after a newer one cannot overwrite the
// cache with stale data -- see the race note on cache.set() below.
const latestRequestSeq = new Map();

export class FetchApiError extends Error {
  constructor(message, { status = null, endpoint, kind }) {
    super(message);
    this.name = "FetchApiError";
    this.status = status;
    this.endpoint = endpoint;
    this.kind = kind; // "network" | "http" | "schema" | "unknown"
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A single injection point for a future Authorization header --
// docs/ARCHITECTURE.md Section 15/18. No authenticated endpoint
// exists yet, so this returns an empty object today.
function buildHeaders() {
  return {};
}

// staleAfterMs has no default, deliberately -- the same reasoning as
// errors.js's getStaleness (which this calls): analytics_builder.py
// still has no cron schedule to derive a sensible threshold from.
// Staleness is only computed when a caller explicitly opts in by
// supplying one; omitting it returns {isStale: null, ageMs: null}
// rather than silently picking a number.
function computeStaleness(payload, staleAfterMs) {
  if (staleAfterMs === undefined || staleAfterMs === null) {
    return { isStale: null, ageMs: null };
  }
  const generatedAtIso = payload && payload.metadata && payload.metadata.generated_at;
  return getStaleness(generatedAtIso, new Date(), staleAfterMs);
}

// validate, if supplied, is a function like errors.js's validateSchema
// -- {valid, reason} -- checked against the parsed payload. Schema
// errors are never retried (a broken payload will not fix itself on
// retry, unlike a transient network failure), unlike HTTP/network
// errors, which are retried with exponential backoff.
//
// bypassCache (docs/ARCHITECTURE.md Section 20, Phase E Milestone 23):
// "analytics.json is fetched with normal caching on first load; only
// the polling refetch is cache-busted, once its cadence is actually
// known" -- Milestone 22 established that cadence, but the Nginx
// alias (Milestone 21) sets no Cache-Control header, so without this
// a poll's fetch() could be served from the browser's own HTTP cache
// instead of hitting the network, silently defeating the entire
// point of polling. startPolling (below) always passes this as true;
// a normal, non-polling fetchEndpoint() call leaves it false so first
// load keeps ordinary caching, exactly as Section 20 specifies.
export async function fetchEndpoint(
  endpoint,
  {
    fetchImpl = fetch,
    retries = 2,
    retryDelayMs = 500,
    validate = null,
    staleAfterMs = null,
    bypassCache = false,
  } = {},
) {
  if (!Number.isInteger(retries) || retries < 0) {
    throw new TypeError("fetchEndpoint requires a non-negative integer retries");
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new TypeError("fetchEndpoint requires a non-negative finite retryDelayMs");
  }

  const mySeq = (latestRequestSeq.get(endpoint) || 0) + 1;
  latestRequestSeq.set(endpoint, mySeq);

  let lastError = null;
  const fetchInit = { headers: buildHeaders() };
  if (bypassCache) {
    fetchInit.cache = "no-store";
  }

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(endpoint, fetchInit);
      if (!response.ok) {
        throw new FetchApiError(`HTTP ${response.status} from ${endpoint}`, {
          status: response.status,
          endpoint,
          kind: "http",
        });
      }

      const payload = await response.json();

      if (validate) {
        const result = validate(payload);
        if (!result.valid) {
          throw new FetchApiError(`Invalid payload from ${endpoint}: ${result.reason}`, {
            endpoint,
            kind: "schema",
          });
        }
      }

      const fetchedAt = new Date();
      // Only the most recently *issued* request for this endpoint may
      // write the cache -- otherwise a slower older request finishing
      // after a newer one already succeeded could silently overwrite
      // fresher cached data with stale data. The caller of *this*
      // request still gets its own result regardless.
      if (latestRequestSeq.get(endpoint) === mySeq) {
        cache.set(endpoint, { payload, fetchedAt });
      }
      return {
        payload,
        fetchedAt,
        fromCache: false,
        error: null,
        ...computeStaleness(payload, staleAfterMs),
      };
    } catch (error) {
      lastError = error;
      const kind = error instanceof FetchApiError ? error.kind : classifyFetchError(error);
      if (kind === "schema") break;
      if (attempt < retries) {
        await delay(retryDelayMs * 2 ** attempt);
      }
    }
  }

  // Every retry (if any) is exhausted, or a schema error broke out
  // early. docs/ARCHITECTURE.md Section 16: never render a blank
  // page -- fall back to the last good cached payload if one exists,
  // still reporting the error so the caller can show a staleness/
  // error indicator over it.
  const cached = cache.get(endpoint);
  if (cached) {
    return {
      ...cached,
      fromCache: true,
      error: lastError,
      ...computeStaleness(cached.payload, staleAfterMs),
    };
  }
  return {
    payload: null,
    fetchedAt: null,
    fromCache: false,
    error: lastError,
    isStale: null,
    ageMs: null,
  };
}

export function getCached(endpoint) {
  return cache.get(endpoint) ?? null;
}

export function clearCache() {
  cache.clear();
  latestRequestSeq.clear();
}

// Generic polling machinery -- docs/ARCHITECTURE.md Section 15 calls
// for a "configurable polling interval," deliberately with no default
// here, for the same reason staleAfterMs above has none. Callers must
// supply intervalMs explicitly.
export function startPolling(endpoint, intervalMs, onUpdate, options = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new TypeError("startPolling requires a positive, finite intervalMs");
  }

  const { onError = null, ...fetchOptions } = options;
  // Unconditional, not caller-configurable: every poll tick bypasses
  // the HTTP cache, regardless of what the caller's own fetchOptions
  // say -- this is what Section 20 means by "the polling refetch is
  // cache-busted," not something each page needs to remember to opt
  // into. Spread order matters: this must come after ...fetchOptions
  // so it always wins.
  const pollFetchOptions = { ...fetchOptions, bypassCache: true };

  let stopped = false;
  let timeoutId = null;

  async function tick() {
    if (stopped) return;
    const result = await fetchEndpoint(endpoint, pollFetchOptions);
    if (stopped) return;
    try {
      onUpdate(result);
    } catch (error) {
      // A rendering bug in onUpdate must not silently and permanently
      // kill the poll loop -- report it (if the caller wants to know)
      // and keep polling regardless.
      if (onError) onError(error);
    }
    if (!stopped) {
      timeoutId = setTimeout(tick, intervalMs);
    }
  }

  timeoutId = setTimeout(tick, intervalMs);

  return function stopPolling() {
    stopped = true;
    clearTimeout(timeoutId);
  };
}
