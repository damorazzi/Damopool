#!/usr/bin/env python3

import json
import os
import tempfile
from datetime import datetime, timedelta, timezone

from parse_share_analytics import LOGS_DIR, find_sharelog_files
import analytics_state
import ckpool_native_stats

# Phase E Milestone 28: additive, backward-compatible schema change (two
# new hashrate_1m/hashrate_24h fields on pool/users/workers) -- bumped the
# minor version per this project's own versioning discipline.
SCHEMA_VERSION = "1.2"
GENERATOR = "analytics_builder.py"
ANALYTICS_OUTPUT_PATH = "/home/damopool/ckpool-solo/ckpool/analytics.json"


def build_analytics(logs_dir=None, now=None, state_path=None):
    """now, if supplied, must be a timezone-aware UTC datetime. state_path
    overrides analytics_state.STATE_PATH -- always pass an isolated path in
    tests to avoid touching the real incremental state."""
    if logs_dir is None:
        logs_dir = LOGS_DIR
    if now is None:
        now = datetime.now(timezone.utc)
    if state_path is None:
        state_path = analytics_state.STATE_PATH
    today = now.date()
    yesterday = today - timedelta(days=1)

    state = analytics_state.update_state(logs_dir, now, state_path=state_path)
    merged = analytics_state.merge_state_to_analytics(state, now, today, yesterday)

    source_files = find_sharelog_files(logs_dir)

    # Milestone 28: CKPool's own native hashrate figures, read and merged
    # in here rather than inside analytics_state.py -- deliberately kept
    # separate from that module's sharelog-incremental engine (see
    # ckpool_native_stats.py's own module comment for why). Merged only
    # into users/workers analytics_state.py already produced from
    # sharelog data -- a native file with no sharelog-derived counterpart
    # (implausible in practice, but not assumed impossible) contributes no
    # phantom user/worker entry of its own.
    native = ckpool_native_stats.read_native_hashrates(logs_dir)

    pool_out = {**merged["pool"], **native["pool"]}

    users_out = {}
    for username, record in merged["users"].items():
        user_native = native["users"].get(username, {"hashrate_1m": None, "hashrate_24h": None})
        users_out[username] = {**record, **user_native}

    workers_out = {}
    for workername, record in merged["workers"].items():
        worker_native = native["workers"].get(workername, {"hashrate_1m": None, "hashrate_24h": None})
        workers_out[workername] = {**record, **worker_native}

    metadata = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now.isoformat(),
        "generator": GENERATOR,
        "source_files_scanned": len(source_files),
        "pool_start_date": merged["pool_start_date"],
        "share_records_processed": merged["share_records_processed"],
    }

    return {
        "metadata": metadata,
        "pool": pool_out,
        "users": users_out,
        "workers": workers_out,
        "daily_bests": merged["daily_bests"],
        "live_ticker": merged["live_ticker"],
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
