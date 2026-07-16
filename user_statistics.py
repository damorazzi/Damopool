#!/usr/bin/env python3

import json
from datetime import datetime, timezone

from parse_share_analytics import LOGS_DIR, iter_shares
from pool_statistics import (
    _BestTracker,
    createdate_to_utc,
    is_valid_result,
    is_valid_sdiff,
    median,
    parse_createdate,
    percentile,
)


def is_valid_username(value):
    return isinstance(value, str) and value.strip() != ""


class _UserAccumulator:
    def __init__(self):
        self.accepted_count = 0
        self.rejected_count = 0
        self.invalid_result_count = 0
        self.accepted_sdiffs = []
        self.best_today = _BestTracker()
        self.best_ever = _BestTracker()

    def to_dict(self):
        accepted_sdiffs = sorted(self.accepted_sdiffs)
        has_sdiffs = bool(accepted_sdiffs)
        return {
            "accepted_count": self.accepted_count,
            "rejected_count": self.rejected_count,
            "invalid_result_count": self.invalid_result_count,
            "average_sdiff": (sum(accepted_sdiffs) / len(accepted_sdiffs)) if has_sdiffs else None,
            "median_sdiff": median(accepted_sdiffs) if has_sdiffs else None,
            "min_sdiff": accepted_sdiffs[0] if has_sdiffs else None,
            "max_sdiff": accepted_sdiffs[-1] if has_sdiffs else None,
            "percentiles": {
                "p50": percentile(accepted_sdiffs, 50) if has_sdiffs else None,
                "p90": percentile(accepted_sdiffs, 90) if has_sdiffs else None,
                "p99": percentile(accepted_sdiffs, 99) if has_sdiffs else None,
            },
            "best_share_today": self.best_today.to_dict(),
            "best_share_ever": self.best_ever.to_dict(),
        }


def compute_user_statistics(shares, today=None):
    if today is None:
        today = datetime.now(timezone.utc).date()

    users = {}

    for share in shares:
        username = share.get("username")
        if not is_valid_username(username):
            continue

        result = share.get("result")
        acc = users.setdefault(username, _UserAccumulator())

        if not is_valid_result(result):
            acc.invalid_result_count += 1
            continue

        if not result:
            acc.rejected_count += 1
            continue

        acc.accepted_count += 1

        sdiff = share.get("sdiff")
        if not is_valid_sdiff(sdiff):
            continue
        acc.accepted_sdiffs.append(sdiff)

        createdate = parse_createdate(share.get("createdate"))

        acc.best_ever.consider(share, sdiff, createdate)

        if createdate is not None and createdate_to_utc(createdate).date() == today:
            acc.best_today.consider(share, sdiff, createdate)

    return {username: acc.to_dict() for username, acc in users.items()}


def main():
    stats = compute_user_statistics(iter_shares(LOGS_DIR))
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
