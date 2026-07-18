// Centralized error/staleness classification -- docs/ARCHITECTURE.md
// Section 6. core/api.js calls into this module rather than each page
// classifying fetch failures or payload shape itself.

// A network failure (DNS, connection refused, offline) surfaces as a
// TypeError from fetch(); an HTTP error status does not throw and is
// handled by the caller before this function is reached. Anything
// else (a thrown non-Error, an unexpected exception) is "unknown"
// rather than guessed at.
export function classifyFetchError(error) {
  if (error instanceof TypeError) return "network";
  return "unknown";
}

// docs/ARCHITECTURE.md Section 25's top-level keys. Checking for their
// presence, rather than pinning an exact schema_version string, keeps
// this working across backward-compatible backend additions without
// needing a version constant duplicated from the Python source of
// truth (analytics_builder.py) -- a duplicated constant would have no
// way to stay in sync given the project's no-build-step decision
// (docs/ARCHITECTURE.md Section 3.3).
const REQUIRED_KEYS = [
  "metadata",
  "pool",
  "users",
  "workers",
  "daily_bests",
  "live_ticker",
];

// docs/ARCHITECTURE.md Section 16 names "wrong schema_version" as a
// case this layer must catch. Checking only the major version (the
// part before the first ".") rather than an exact string match is the
// compromise: a minor/patch bump (e.g. "1.1" -> "1.2") is assumed
// backward-compatible and passes, but a major bump (e.g. "1.x" ->
// "2.0") is treated as a breaking change this frontend was not built
// against. This still hardcodes one value, but one that only changes
// on a deliberate breaking change, not on every schema addition.
const SUPPORTED_SCHEMA_MAJOR_VERSION = "1";

export function validateSchema(payload) {
  if (payload === null || typeof payload !== "object") {
    return { valid: false, reason: "not-an-object" };
  }
  const missing = REQUIRED_KEYS.filter((key) => !(key in payload));
  if (missing.length > 0) {
    return { valid: false, reason: `missing-keys:${missing.join(",")}` };
  }
  const version = payload.metadata && payload.metadata.schema_version;
  if (typeof version !== "string") {
    return { valid: false, reason: "missing-schema-version" };
  }
  const major = version.split(".")[0];
  if (major !== SUPPORTED_SCHEMA_MAJOR_VERSION) {
    return { valid: false, reason: `unsupported-schema-version:${version}` };
  }
  return { valid: true, reason: null };
}

// docs/ARCHITECTURE.md Section 15's staleness detection: compares
// metadata.generated_at against the current time. thresholdMs has no
// approved default yet -- analytics_builder.py has no cron schedule
// (docs/ARCHITECTURE.md Section 2/15's open infrastructure gap), so
// there is no real regeneration cadence to derive a threshold from.
// Callers must pass an explicit finite thresholdMs; omitting it throws
// rather than silently evaluating "not stale" (undefined compared
// with > is always false), which would otherwise be the worst failure
// mode for a staleness indicator.
export function getStaleness(generatedAtIso, now, thresholdMs) {
  if (!Number.isFinite(thresholdMs)) {
    throw new TypeError("getStaleness requires a finite thresholdMs");
  }
  // generatedAtIso is documented as an ISO string; anything else is
  // malformed input. Checking the type up front, rather than only
  // null/undefined, also catches new Date(x)'s other silent numeric
  // coercions -- new Date(0) and new Date(false) both produce the
  // Unix epoch (a *valid* date), not NaN, which would otherwise slip
  // past the NaN guard below the same way null originally did.
  if (typeof generatedAtIso !== "string") {
    return { ageMs: null, isStale: true };
  }
  const generatedAt = new Date(generatedAtIso);
  if (Number.isNaN(generatedAt.getTime())) {
    return { ageMs: null, isStale: true };
  }
  const ageMs = now.getTime() - generatedAt.getTime();
  // Exactly at the threshold is not yet stale -- staleness means the
  // data is *older* than the threshold, not merely as old as it.
  return { ageMs, isStale: ageMs > thresholdMs };
}

// Maps a core/api.js FetchApiError (or an unknown thrown value) to a
// short, specific message for a page's error banner -- docs/
// ARCHITECTURE.md Section 16 point 2. Extracted here from what were
// three identical page-level copies (overview.js, pool.js, users.js)
// once a fourth page needed the same logic (Workers) -- each of those
// three copies explicitly named this exact trigger, and named
// DEVELOPMENT_PROCESS.md Section 5 (changing a previously-shipped
// file is Permanent Human Governance) as the reason the extraction
// waited for that point rather than happening the first time the
// duplication appeared. This move is purely mechanical: identical
// behaviour, one definition instead of four.
export function describeFetchError(error) {
  if (!error) return "Something went wrong.";
  if (error.kind === "network") return "Could not reach the analytics service. Check your connection.";
  if (error.kind === "http") {
    const status = error.status ? ` (HTTP ${error.status})` : "";
    return `The analytics service returned an error${status}.`;
  }
  if (error.kind === "schema") return "The analytics data is in an unexpected format.";
  return "Something went wrong loading analytics data.";
}
