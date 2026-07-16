#!/usr/bin/env python3

import json
import os
import tempfile
from datetime import datetime, timedelta, timezone

from parse_share_analytics import LOGS_DIR, find_sharelog_files, parse_sharelog_file
from pool_statistics import (
    compute_pool_statistics,
    createdate_sort_key,
    createdate_to_utc,
    is_valid_result,
    is_valid_sdiff,
    parse_createdate,
)
from user_statistics import compute_user_statistics, is_valid_username
from worker_statistics import compute_worker_statistics, is_valid_workername

SCHEMA_VERSION = "1.1"
GENERATOR = "analytics_builder.py"
ANALYTICS_OUTPUT_PATH = "/home/damopool/ckpool-solo/ckpool/analytics.json"

# window name -> (timedelta, minutes) used for rolling_windows and their
# share_frequency_per_minute denominator.
WINDOWS = {
    "15m": (timedelta(minutes=15), 15),
    "1h": (timedelta(hours=1), 60),
    "24h": (timedelta(hours=24), 1440),
}


def is_within_window(now, timestamp, window_delta):
    delta = now - timestamp
    return timedelta(0) <= delta <= window_delta


class _WindowAccumulator:
    def __init__(self):
        self.accepted = 0
        self.rejected = 0
        self.sdiff_sum = 0.0
        self.sdiff_count = 0

    def to_dict(self, window_minutes):
        average_sdiff = (self.sdiff_sum / self.sdiff_count) if self.sdiff_count else None
        frequency = (self.accepted + self.rejected) / window_minutes
        return {
            "accepted": self.accepted,
            "rejected": self.rejected,
            "average_sdiff": average_sdiff,
            "share_frequency_per_minute": frequency,
        }


def _empty_window_set():
    return {name: _WindowAccumulator() for name in WINDOWS}


def _window_set_to_dict(window_set):
    return {name: window_set[name].to_dict(minutes) for name, (_, minutes) in WINDOWS.items()}


class _DailyBestTracker:
    """Tracks the running current/previous same-day best for one user on one
    date. Candidates must be added in chronological (createdate) order."""

    def __init__(self):
        self.current = None
        self.current_sdiff = None
        self.current_createdate = None
        self.previous = None
        self.previous_sdiff = None
        self.previous_createdate = None

    def add(self, share, sdiff, createdate):
        if self.current is None or sdiff > self.current_sdiff:
            self.previous = self.current
            self.previous_sdiff = self.current_sdiff
            self.previous_createdate = self.current_createdate
            self.current = share
            self.current_sdiff = sdiff
            self.current_createdate = createdate

    def to_dict(self):
        def record(share, sdiff, createdate):
            if share is None:
                return None
            return {
                "username": share["username"],
                "workername": share["workername"],
                "sdiff": sdiff,
                "timestamp": createdate_to_utc(createdate).isoformat(),
            }

        current = record(self.current, self.current_sdiff, self.current_createdate)
        previous = record(self.previous, self.previous_sdiff, self.previous_createdate)

        if current is None:
            improvement_amount = None
            improvement_percentage = None
        elif previous is None:
            improvement_amount = None
            improvement_percentage = None
        else:
            improvement_amount = current["sdiff"] - previous["sdiff"]
            improvement_percentage = (improvement_amount / previous["sdiff"]) * 100

        return {
            "current_daily_best": current,
            "previous_daily_best": previous,
            "improvement_amount": improvement_amount,
            "improvement_percentage": improvement_percentage,
        }


def compute_temporal_analytics(shares, now, today, yesterday):
    """Single combined pass computing everything that needs per-share
    timestamp inspection: rolling windows (pool/users/workers),
    users.<username>.workers, metadata.pool_start_date, and the daily-best
    candidate collection for daily_bests/live_ticker.

    now must be a timezone-aware UTC datetime and today/yesterday must be
    UTC dates -- is_within_window's subtraction requires now to match the
    UTC-aware timestamps produced by createdate_to_utc."""

    pool_windows = _empty_window_set()
    user_windows = {}
    worker_windows = {}

    user_workers = {}

    earliest_createdate = None

    # date (as date object) -> username -> list of (sdiff, createdate, share)
    daily_candidates = {today: {}, yesterday: {}}

    for share in shares:
        username = share.get("username")
        workername = share.get("workername")
        username_valid = is_valid_username(username)
        workername_valid = is_valid_workername(workername)

        if username_valid and workername_valid:
            user_workers.setdefault(username, set()).add(workername)

        createdate = parse_createdate(share.get("createdate"))
        if createdate is not None:
            if earliest_createdate is None or createdate_sort_key(createdate) < createdate_sort_key(earliest_createdate):
                earliest_createdate = createdate

        result = share.get("result")
        if not is_valid_result(result):
            continue

        sdiff = share.get("sdiff")
        sdiff_valid = is_valid_sdiff(sdiff)

        if createdate is not None:
            timestamp = createdate_to_utc(createdate)

            for window_name, (window_delta, _minutes) in WINDOWS.items():
                if not is_within_window(now, timestamp, window_delta):
                    continue

                acc = pool_windows[window_name]
                if result:
                    acc.accepted += 1
                    if sdiff_valid:
                        acc.sdiff_sum += sdiff
                        acc.sdiff_count += 1
                else:
                    acc.rejected += 1

                if username_valid:
                    user_acc = user_windows.setdefault(username, _empty_window_set())[window_name]
                    if result:
                        user_acc.accepted += 1
                        if sdiff_valid:
                            user_acc.sdiff_sum += sdiff
                            user_acc.sdiff_count += 1
                    else:
                        user_acc.rejected += 1

                if workername_valid:
                    worker_acc = worker_windows.setdefault(workername, _empty_window_set())[window_name]
                    if result:
                        worker_acc.accepted += 1
                        if sdiff_valid:
                            worker_acc.sdiff_sum += sdiff
                            worker_acc.sdiff_count += 1
                    else:
                        worker_acc.rejected += 1

            if result and sdiff_valid and username_valid:
                share_date = timestamp.date()
                if share_date in daily_candidates:
                    daily_candidates[share_date].setdefault(username, []).append((sdiff, createdate, share))

    daily_bests = {}
    for date, users_candidates in daily_candidates.items():
        if date == today:
            include = True
        else:
            include = bool(users_candidates)
        if not include:
            continue

        users_out = {}
        for username, candidates in users_candidates.items():
            candidates.sort(key=lambda c: createdate_sort_key(c[1]))
            tracker = _DailyBestTracker()
            for sdiff, createdate, share in candidates:
                tracker.add(share, sdiff, createdate)
            users_out[username] = tracker.to_dict()

        daily_bests[date.isoformat()] = {"users": users_out}

    return {
        "rolling_windows": {
            "pool": _window_set_to_dict(pool_windows),
            "users": {name: _window_set_to_dict(ws) for name, ws in user_windows.items()},
            "workers": {name: _window_set_to_dict(ws) for name, ws in worker_windows.items()},
        },
        "user_workers": {name: sorted(workers) for name, workers in user_workers.items()},
        "pool_start_date": createdate_to_utc(earliest_createdate).date().isoformat() if earliest_createdate else None,
        "daily_bests": daily_bests,
    }


def build_live_ticker(daily_bests, today):
    today_key = today.isoformat()
    today_entry = daily_bests.get(today_key)
    if not today_entry:
        return []

    ticker = []
    for username, user_daily in today_entry["users"].items():
        current = user_daily["current_daily_best"]
        if current is None:
            continue
        previous = user_daily["previous_daily_best"]
        # Deliberately reduced to {sdiff, timestamp} here, unlike
        # daily_bests' current/previous_daily_best (which also carry
        # username/workername) -- the ticker entry already promotes
        # username/workername to its own top level, so repeating them
        # inside these nested objects would be redundant.
        ticker.append({
            "username": username,
            "workername": current["workername"],
            "current_daily_best": {"sdiff": current["sdiff"], "timestamp": current["timestamp"]},
            "previous_daily_best": (
                {"sdiff": previous["sdiff"], "timestamp": previous["timestamp"]} if previous else None
            ),
            "improvement_amount": user_daily["improvement_amount"],
            "improvement_percentage": user_daily["improvement_percentage"],
            "timestamp": current["timestamp"],
        })

    ticker.sort(key=lambda entry: entry["timestamp"], reverse=True)
    return ticker


def build_analytics(logs_dir=None, now=None):
    """now, if supplied, must be a timezone-aware UTC datetime (see
    compute_temporal_analytics); the default is datetime.now(timezone.utc)."""
    if logs_dir is None:
        logs_dir = LOGS_DIR
    if now is None:
        now = datetime.now(timezone.utc)
    today = now.date()
    yesterday = today - timedelta(days=1)

    # find_sharelog_files is called once here (not via iter_shares, which
    # would re-glob internally) so source_files_scanned and the share list
    # it produces are always consistent with each other.
    source_files = find_sharelog_files(logs_dir)
    shares = [share for path in source_files for share in parse_sharelog_file(path)]

    pool_stats = compute_pool_statistics(shares, today=today)
    user_stats = compute_user_statistics(shares, today=today)
    worker_stats = compute_worker_statistics(shares, today=today, now=now)
    temporal = compute_temporal_analytics(shares, now=now, today=today, yesterday=yesterday)

    empty_windows = _window_set_to_dict(_empty_window_set())

    users_out = {}
    for username, stats in user_stats.items():
        users_out[username] = {
            **stats,
            "workers": temporal["user_workers"].get(username, []),
            "rolling_windows": temporal["rolling_windows"]["users"].get(username, empty_windows),
        }

    workers_out = {}
    for workername, stats in worker_stats.items():
        workers_out[workername] = {
            **stats,
            "rolling_windows": temporal["rolling_windows"]["workers"].get(workername, empty_windows),
        }

    metadata = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now.isoformat(),
        "generator": GENERATOR,
        "source_files_scanned": len(source_files),
        "pool_start_date": temporal["pool_start_date"],
        "share_records_processed": len(shares),
    }

    return {
        "metadata": metadata,
        "pool": {**pool_stats, "rolling_windows": temporal["rolling_windows"]["pool"]},
        "users": users_out,
        "workers": workers_out,
        "daily_bests": temporal["daily_bests"],
        "live_ticker": build_live_ticker(temporal["daily_bests"], today),
    }


def write_analytics(data, path):
    directory = os.path.dirname(path) or "."
    fd, tmp_path = tempfile.mkstemp(prefix=".analytics.", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
        # mkstemp creates the file 0600 (owner-only); analytics.json is
        # meant to be read by other processes (e.g. a future webserver), so
        # widen it to world-readable before the atomic replace.
        os.chmod(tmp_path, 0o644)
        os.replace(tmp_path, path)
    except BaseException:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise


def main():
    data = build_analytics()
    write_analytics(data, ANALYTICS_OUTPUT_PATH)
    print(f"Wrote {ANALYTICS_OUTPUT_PATH}")


if __name__ == "__main__":
    main()
