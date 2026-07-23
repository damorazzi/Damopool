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

// K/M/G/T/P at powers of 1000 -- the same SI/metric convention already
// established for chart axis labels (pages/history.js's own
// SIZE_UNIT_FACTORS/formatCompactDifficulty, kept local there since an
// axis tick's fixed-width 2-decimal form ("2.50 G") is a different,
// deliberately unabbreviated design goal from this function's prose/
// table use). "G" for Giga, not "B" for Billion -- Intl.NumberFormat's
// built-in `notation: "compact"` uses the wrong convention for a
// mining-difficulty domain (KH/s, MH/s, GH/s, TH/s are the established
// units here, not thousands/millions/billions).
const COMPACT_UNIT_FACTORS = [
  { suffix: "P", factor: 1e15 },
  { suffix: "T", factor: 1e12 },
  { suffix: "G", factor: 1e9 },
  { suffix: "M", factor: 1e6 },
  { suffix: "K", factor: 1e3 },
];

// Trailing zeros trimmed (e.g. "1.00" -> "1", "2.50" -> "2.5") so a
// round number doesn't carry unnecessary precision -- matches the
// "1,000,000 -> 1M" / "2,500,000,000 -> 2.5G" convention this was
// specified against, distinct from formatSdiff's own always-precise
// comma-separated form (still used where a spoken/exact reading
// matters more than compactness, e.g. a chart's accessible summary
// text).
//
// Phase E Milestone 28 (Human decision): extracted into a shared,
// generic core so a second caller (formatHashrate, below) can reuse
// the exact same K/M/G/T/P logic under an honestly-named function --
// "do not call formatCompactSdiff() when formatting hashrates, that
// naming becomes misleading." Both wrappers are one line and behave
// identically for the same numeric input; there is exactly one
// formatting implementation, not two. formatCompactSdiff's own
// behavior (including the M25 rounding-boundary fix below) is
// unchanged by this extraction.
function formatCompactNumber(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  let unit = COMPACT_UNIT_FACTORS.find((u) => Math.abs(value) >= u.factor) || null;
  let scaled = unit ? value / unit.factor : value;
  // The unit above is chosen from the UNROUNDED value, so a value just
  // under a threshold (e.g. 999999.9, picked as "K") can round up to
  // "1000.00" at that unit once toFixed(2) is applied -- which should
  // display as "1M", not "1000K". Re-check the ROUNDED value and
  // promote one unit up if it reached 1000; a second pass can never
  // re-trigger this, since promoting divides by another factor of
  // 1000, so the result is always back down near 1. Found in Code
  // Review (Phase E Milestone 25) with no test in the original 21
  // catching it, since every original test used an exact power of ten.
  if (Math.abs(parseFloat(scaled.toFixed(2))) >= 1000) {
    const currentIndex = unit ? COMPACT_UNIT_FACTORS.indexOf(unit) : COMPACT_UNIT_FACTORS.length;
    const nextUnit = COMPACT_UNIT_FACTORS[currentIndex - 1];
    if (nextUnit) {
      unit = nextUnit;
      scaled = value / unit.factor;
    }
  }
  const fixed = scaled.toFixed(2).replace(/\.?0+$/, "");
  return unit ? `${fixed}${unit.suffix}` : fixed;
}

export function formatCompactSdiff(sdiff) {
  return formatCompactNumber(sdiff);
}

// Hashrate (Phase E Milestone 28): a plain number of hashes/second,
// read verbatim from CKPool's own native statistics (never estimated
// or calculated by this project) -- same K/M/G/T/P compact convention
// as every other number in this app, via the shared core above, not a
// second formatting style.
export function formatHashrate(hashesPerSecond) {
  return formatCompactNumber(hashesPerSecond);
}

// docs/ARCHITECTURE.md Section 18: username/workername are untrusted
// free text with no length limit, and a real BTC address is long
// enough to dominate a table row. Shortens to the first `length`
// characters plus an ellipsis; the caller is responsible for keeping
// the full value available elsewhere (a `title` attribute, the link's
// own href) since this function only affects what's visually shown.
export function truncateAddress(value, length = 7) {
  if (typeof value !== "string" || value.length <= length) {
    return value;
  }
  return `${value.slice(0, length)}…`;
}

// A workername is conventionally "<address>.<worker label>" (e.g.
// "bc1q...OctaxeDamo") -- truncating the whole string the same way
// truncateAddress does would make every worker under the same user
// show an identical truncated prefix, losing the one part that
// actually distinguishes them. This truncates only the address
// portion and keeps the label intact: "bc1qmle…OctaxeDamo", not
// "bc1qmle…" (which would look the same for every worker on that
// account) or "bc1qmle….OctaxeDamo" (a redundant literal "." right
// after the ellipsis).
export function truncateWorkername(value, length = 7) {
  if (typeof value !== "string") {
    return value;
  }
  const dotIndex = value.indexOf(".");
  if (dotIndex === -1) {
    return truncateAddress(value, length);
  }
  const address = value.slice(0, dotIndex);
  const label = value.slice(dotIndex + 1);
  if (address.length <= length) {
    return value;
  }
  return `${address.slice(0, length)}…${label}`;
}

export function formatPercentage(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

// Phase E Milestone 30 (Block Progress Analytics): deliberately distinct
// from formatPercentage above -- that one is signed, fixed-1-decimal
// daily-improvement text; this one is unsigned (a progress ratio is
// never negative by the time it reaches here -- block_progress.py's own
// null-guarding already excludes negative/zero inputs) and uses a
// variable precision so a very small, realistic progress value (a solo
// miner's best share is typically a tiny fraction of a percent of the
// network target) doesn't round away to "0.00%": four decimal places
// below 1%, two decimal places at or above it.
export function formatProgressPercent(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const decimals = Math.abs(value) < 1 ? 4 : 2;
  return `${value.toFixed(decimals)}%`;
}

// "Still Needed" (Block Progress Analytics): how many times larger the
// best share would need to be to reach network difficulty -- rounded to
// the nearest whole number (a fractional multiplier reads as false
// precision here), thousands-separated, prefixed with "x" per the
// Human-approved wording.
export function formatStillNeededMultiplier(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return `×${Math.round(value).toLocaleString("en-US")}`;
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
