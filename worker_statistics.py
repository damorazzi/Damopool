#!/usr/bin/env python3

import json
from datetime import datetime, timedelta, timezone

from parse_share_analytics import LOGS_DIR, iter_shares
from pool_statistics import (
    _BestTracker,
    createdate_sort_key,
    createdate_to_utc,
    is_valid_result,
    is_valid_sdiff,
    median,
    parse_createdate,
    percentile,
)

# A worker is considered active if its most recent valid share falls within
# this many minutes of `now`. Provisional heuristic matching CLAUDE.md's
# shortest rolling-window granularity (15m); the real rolling-window
# architecture is Feature 005's job, not this module's.
ACTIVE_WINDOW = timedelta(minutes=15)


def is_valid_workername(value):
    return isinstance(value, str) and value.strip() != ""


def is_valid_agent(value):
    return isinstance(value, str) and value.strip() != ""


class _WorkerAccumulator:
    def __init__(self):
        self.accepted_count = 0
        self.rejected_count = 0
        self.invalid_result_count = 0
        self.accepted_sdiffs = []
        self.best_today = _BestTracker()
        self.best_ever = _BestTracker()
        self.agent = None
        self.first_createdate = None
        self.last_createdate = None

    def consider_activity(self, createdate):
        if self.first_createdate is None or createdate_sort_key(createdate) < createdate_sort_key(self.first_createdate):
            self.first_createdate = createdate
        if self.last_createdate is None or createdate_sort_key(createdate) > createdate_sort_key(self.last_createdate):
            self.last_createdate = createdate

    def to_dict(self, now):
        accepted_sdiffs = sorted(self.accepted_sdiffs)
        has_sdiffs = bool(accepted_sdiffs)

        last_share_at = createdate_to_utc(self.last_createdate) if self.last_createdate else None
        is_active = False
        if last_share_at is not None:
            delta = now - last_share_at
            is_active = timedelta(0) <= delta <= ACTIVE_WINDOW

        return {
            "agent": self.agent,
            "first_share_at": createdate_to_utc(self.first_createdate).isoformat() if self.first_createdate else None,
            "last_share_at": last_share_at.isoformat() if last_share_at else None,
            "is_active": is_active,
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


def compute_worker_statistics(shares, today=None, now=None):
    """today and now, if supplied, must be UTC-based (a UTC date and a
    timezone-aware UTC datetime respectively) -- last_share_at is always
    UTC-aware, and is_active's `now - last_share_at` subtraction requires
    matching awareness."""
    if today is None:
        today = datetime.now(timezone.utc).date()
    if now is None:
        now = datetime.now(timezone.utc)

    workers = {}

    for share in shares:
        workername = share.get("workername")
        if not is_valid_workername(workername):
            continue

        acc = workers.get(workername)
        if acc is None:
            acc = _WorkerAccumulator()
            workers[workername] = acc

        # Agent and activity tracking happen before the result check below,
        # deliberately: worker identity/presence is not gated on share
        # validity, only pool-wide/per-entity share statistics are.
        agent = share.get("agent")
        if is_valid_agent(agent):
            acc.agent = agent

        createdate = parse_createdate(share.get("createdate"))
        if createdate is not None:
            acc.consider_activity(createdate)

        result = share.get("result")
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

        acc.best_ever.consider(share, sdiff, createdate)

        if createdate is not None and createdate_to_utc(createdate).date() == today:
            acc.best_today.consider(share, sdiff, createdate)

    return {workername: acc.to_dict(now) for workername, acc in workers.items()}


def main():
    stats = compute_worker_statistics(iter_shares(LOGS_DIR))
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
