#!/usr/bin/env python3

import json
import math
from datetime import datetime, timezone

from parse_share_analytics import LOGS_DIR, iter_shares


# datetime.fromtimestamp's practical ceiling on this platform; used to reject
# out-of-range createdate values before they reach datetime.fromtimestamp().
MAX_TIMESTAMP_SECONDS = 253_402_300_799  # 9999-12-31T23:59:59 UTC


def parse_createdate(raw):
    if not isinstance(raw, str) or "," not in raw:
        return None
    seconds_part, _, nanos_part = raw.partition(",")
    try:
        seconds = int(seconds_part)
        nanoseconds = int(nanos_part)
    except ValueError:
        return None
    if not (0 <= seconds <= MAX_TIMESTAMP_SECONDS) or not (0 <= nanoseconds <= 999_999_999):
        return None
    return (seconds, nanoseconds)


def createdate_sort_key(createdate):
    seconds, nanoseconds = createdate
    return seconds * 1_000_000_000 + nanoseconds


def createdate_to_utc(createdate):
    seconds, _ = createdate
    return datetime.fromtimestamp(seconds, tz=timezone.utc)


def is_valid_result(value):
    return isinstance(value, bool)


def is_valid_sdiff(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return math.isfinite(value) and value > 0


def percentile(sorted_values, pct):
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = (pct / 100) * (len(sorted_values) - 1)
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return sorted_values[lower]
    fraction = rank - lower
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * fraction


def median(sorted_values):
    return percentile(sorted_values, 50)


class _BestTracker:
    """Tracks the best (highest-sdiff) share seen. On an exact sdiff tie,
    the earliest valid timestamp wins; a share with no valid timestamp
    never displaces an existing best."""

    def __init__(self):
        self.share = None
        self.sdiff = None
        self.createdate = None

    def consider(self, share, sdiff, createdate):
        if self.share is None or sdiff > self.sdiff:
            self._set(share, sdiff, createdate)
            return

        if sdiff < self.sdiff:
            return

        # Exact tie.
        if createdate is None:
            return
        if self.createdate is None or createdate_sort_key(createdate) < createdate_sort_key(self.createdate):
            self._set(share, sdiff, createdate)

    def _set(self, share, sdiff, createdate):
        self.share = share
        self.sdiff = sdiff
        self.createdate = createdate

    def to_dict(self):
        if self.share is None:
            return None
        return {
            "username": self.share["username"],
            "workername": self.share["workername"],
            "sdiff": self.sdiff,
            "timestamp": createdate_to_utc(self.createdate).isoformat() if self.createdate else "unknown",
        }


def compute_pool_statistics(shares, today=None):
    if today is None:
        today = datetime.now(timezone.utc).date()

    accepted_count = 0
    rejected_count = 0
    invalid_result_count = 0
    accepted_sdiffs = []

    best_today = _BestTracker()
    best_ever = _BestTracker()

    for share in shares:
        result = share.get("result")
        if not is_valid_result(result):
            invalid_result_count += 1
            continue

        if not result:
            rejected_count += 1
            continue

        accepted_count += 1

        sdiff = share.get("sdiff")
        if not is_valid_sdiff(sdiff):
            continue
        accepted_sdiffs.append(sdiff)

        createdate = parse_createdate(share.get("createdate"))

        best_ever.consider(share, sdiff, createdate)

        if createdate is not None and createdate_to_utc(createdate).date() == today:
            best_today.consider(share, sdiff, createdate)

    accepted_sdiffs.sort()
    has_sdiffs = bool(accepted_sdiffs)

    return {
        "accepted_count": accepted_count,
        "rejected_count": rejected_count,
        "invalid_result_count": invalid_result_count,
        "average_sdiff": (sum(accepted_sdiffs) / len(accepted_sdiffs)) if has_sdiffs else None,
        "median_sdiff": median(accepted_sdiffs) if has_sdiffs else None,
        "min_sdiff": accepted_sdiffs[0] if has_sdiffs else None,
        "max_sdiff": accepted_sdiffs[-1] if has_sdiffs else None,
        "percentiles": {
            "p50": percentile(accepted_sdiffs, 50) if has_sdiffs else None,
            "p90": percentile(accepted_sdiffs, 90) if has_sdiffs else None,
            "p99": percentile(accepted_sdiffs, 99) if has_sdiffs else None,
        },
        "best_share_today": best_today.to_dict(),
        "best_share_ever": best_ever.to_dict(),
    }


def main():
    stats = compute_pool_statistics(iter_shares(LOGS_DIR))
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
