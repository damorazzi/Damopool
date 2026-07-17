// Shared formatting helpers -- docs/ARCHITECTURE.md Section 6.
//
// Every function here returns null for a value it cannot format
// (missing, malformed, or the "unknown" timestamp sentinel documented
// in docs/ARCHITECTURE.md Section 25) rather than a placeholder
// string -- callers render the null case through the EmptyState
// component (docs/ARCHITECTURE.md Section 16), keeping "no value"
// presentation in one place instead of scattered fallback strings.

export function formatSdiff(sdiff) {
  if (!Number.isFinite(sdiff)) {
    return null;
  }
  return sdiff.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatPercentage(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

// Absolute local time, e.g. "09:41" -- matches the ticker/wireframe
// display in docs/ARCHITECTURE.md Section 22.
export function formatTimestamp(isoString) {
  const date = parseTimestamp(isoString);
  if (date === null) return null;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

// Relative time, e.g. "2m ago" -- used for both the live ticker
// (docs/DESIGN_SYSTEM.md Section 10.8) and the "data as of Xm ago"
// staleness indicator (docs/ARCHITECTURE.md Section 15).
export function formatRelativeTime(isoString, now = new Date()) {
  const then = parseTimestamp(isoString);
  if (then === null) return null;

  const diffMs = now.getTime() - then.getTime();
  // A small future tolerance absorbs ordinary clock skew, but with a
  // symmetric lower bound -- without one, a timestamp arbitrarily far
  // in the future (a timezone bug, a corrupted createdate, a badly
  // wrong clock) would also read as "just now," which is a worse
  // failure mode than showing nothing, since it looks correct.
  if (diffMs < -60000) return null;
  if (diffMs < 60000) return "just now";

  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

// docs/ARCHITECTURE.md Section 25: best_share_today/best_share_ever's
// timestamp can be the literal string "unknown" when the underlying
// share had no valid createdate -- treated the same as a missing
// value by every formatter above, not as a parseable date.
function parseTimestamp(isoString) {
  if (!isoString || isoString === "unknown") return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}
