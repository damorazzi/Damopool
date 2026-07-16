#!/usr/bin/env python3

import hashlib
import json
import os
import tempfile
from datetime import datetime, timedelta, timezone

from parse_share_analytics import find_sharelog_files
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
from user_statistics import is_valid_username
from worker_statistics import ACTIVE_WINDOW, is_valid_agent, is_valid_workername

STATE_VERSION = 1
STATE_PATH = "/home/damopool/ckpool-solo/ckpool/analytics.state.json"


class StateError(Exception):
    """Base class for analytics.state.json load failures."""


class StateLoadError(StateError):
    """The state file exists but could not be read, parsed, or is
    structurally invalid. Deliberately distinct from "no state file
    exists" (which is the normal, safe first-run case) -- silently
    treating a corrupted-but-present state file as empty would discard
    any historical statistics it alone retained for deleted/rotated-away
    sharelog files, which cannot be reconstructed from the currently
    present source files."""


class StateVersionError(StateError):
    """The state file's version does not match the running STATE_VERSION.
    No implicit migration is performed."""

# The consistency check hashes the file's ENTIRE already-consumed region
# (all `offset` bytes) to detect truncation/replacement that size/mtime/
# inode alone would miss (e.g. an in-place truncate+overwrite that happens
# to keep the same inode). This is deliberately NOT capped at a bounded
# span: capping it (an earlier version of this code capped at 64KB) means
# any content change beyond the cap, within an already-large consumed
# region, goes permanently undetected -- the exact class of bug this check
# exists to catch. Real production sharelog files are currently all under
# 64KB (bounded by CKPool's own rotation behavior), so this costs nothing
# extra today; if that assumption changes, the correctness guarantee must
# still hold rather than silently degrade.

# Recent-tuple retention: covers the largest rolling window (24h) plus
# enough slack to always have all of "yesterday" available for daily_bests,
# even when `now` is just after UTC midnight.
RECENT_TUPLE_RETENTION = timedelta(hours=48)

# window name -> (timedelta, minutes), used for rolling_windows and their
# share_frequency_per_minute denominator. Moved here from analytics_builder.py
# because the incremental merge path is now the primary user.
WINDOWS = {
    "15m": (timedelta(minutes=15), 15),
    "1h": (timedelta(hours=1), 60),
    "24h": (timedelta(hours=24), 1440),
}


def is_within_window(now, timestamp, window_delta):
    delta = now - timestamp
    return timedelta(0) <= delta <= window_delta


# ---------------------------------------------------------------------------
# Fingerprinting / consistency
# ---------------------------------------------------------------------------

def _read_prefix_hash(path, upto):
    with open(path, "rb") as f:
        prefix = f.read(upto)
    return hashlib.sha256(prefix).hexdigest()


def _check_consistency(path, current_stat, stored_fingerprint):
    if (current_stat.st_dev, current_stat.st_ino) != (stored_fingerprint["dev"], stored_fingerprint["ino"]):
        return False
    if current_stat.st_size < stored_fingerprint["size"]:
        return False
    if current_stat.st_mtime_ns < stored_fingerprint["mtime_ns"]:
        return False
    if _read_prefix_hash(path, stored_fingerprint["offset"]) != stored_fingerprint["prefix_hash"]:
        return False
    return True


def _make_fingerprint(path, current_stat, offset):
    return {
        "dev": current_stat.st_dev,
        "ino": current_stat.st_ino,
        "size": current_stat.st_size,
        "mtime_ns": current_stat.st_mtime_ns,
        "offset": offset,
        "prefix_hash": _read_prefix_hash(path, offset),
    }


# ---------------------------------------------------------------------------
# Offset-aware line reading (deliberately duplicates parse_share_analytics.py's
# decode/skip-bad-line/non-dict-JSON pattern rather than modifying that file)
# ---------------------------------------------------------------------------

def _read_new_lines(path, start_offset):
    """Reads from start_offset to EOF, returns (list of raw line bytes for
    every COMPLETE line, new_offset). The cursor only advances to the last
    confirmed newline; a trailing partial line is left for a future run."""
    with open(path, "rb") as f:
        f.seek(start_offset)
        data = f.read()

    last_newline = data.rfind(b"\n")
    if last_newline == -1:
        return [], start_offset

    new_offset = start_offset + last_newline + 1
    lines = data[:last_newline].split(b"\n")
    return lines, new_offset


def _parse_line(raw_line):
    try:
        line = raw_line.decode("utf-8").strip()
    except UnicodeDecodeError:
        return None
    if not line:
        return None
    try:
        record = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(record, dict):
        return None
    return {
        "username": record.get("username"),
        "workername": record.get("workername"),
        "agent": record.get("agent"),
        "diff": record.get("diff"),
        "sdiff": record.get("sdiff"),
        "result": record.get("result"),
        "createdate": record.get("createdate"),
    }


def _within_retention(ts, now):
    return timedelta(0) <= (now - ts) <= RECENT_TUPLE_RETENTION


# ---------------------------------------------------------------------------
# Per-file partial accumulator state
# ---------------------------------------------------------------------------

class _ScopeState:
    """Forever-cumulative statistics for one scope (pool/user/worker),
    contributed by ONE sharelog file. min/max/median/percentiles are
    deliberately NOT tracked here -- they're derived from the merged,
    sorted accepted_sdiffs list at merge time, exactly like
    compute_pool_statistics does, so there's only one code path computing
    them and no risk of a separately-tracked value drifting from it."""

    def __init__(self):
        self.accepted = 0
        self.rejected = 0
        self.invalid_result = 0
        self.sdiff_sum = 0.0
        self.sdiff_count = 0
        self.accepted_sdiffs = []
        self.best = _BestTracker()

    def add(self, share, result, sdiff, sdiff_valid, createdate):
        if not is_valid_result(result):
            self.invalid_result += 1
            return
        if not result:
            self.rejected += 1
            return
        self.accepted += 1
        if not sdiff_valid:
            return
        self.sdiff_sum += sdiff
        self.sdiff_count += 1
        self.accepted_sdiffs.append(sdiff)
        self.best.consider(share, sdiff, createdate)

    def to_state(self):
        best_state = None
        if self.best.share is not None:
            best_state = {
                "share": self.best.share,
                "sdiff": self.best.sdiff,
                "createdate": list(self.best.createdate) if self.best.createdate else None,
            }
        return {
            "accepted": self.accepted,
            "rejected": self.rejected,
            "invalid_result": self.invalid_result,
            "sdiff_sum": self.sdiff_sum,
            "sdiff_count": self.sdiff_count,
            "accepted_sdiffs": self.accepted_sdiffs,
            "best": best_state,
        }

    @classmethod
    def from_state(cls, state):
        obj = cls()
        if state is None:
            return obj
        obj.accepted = state["accepted"]
        obj.rejected = state["rejected"]
        obj.invalid_result = state["invalid_result"]
        obj.sdiff_sum = state["sdiff_sum"]
        obj.sdiff_count = state["sdiff_count"]
        obj.accepted_sdiffs = list(state["accepted_sdiffs"])
        best_state = state.get("best")
        if best_state is not None:
            obj.best.share = best_state["share"]
            obj.best.sdiff = best_state["sdiff"]
            obj.best.createdate = tuple(best_state["createdate"]) if best_state["createdate"] else None
        return obj


def _merge_scope(target, source):
    target.accepted += source.accepted
    target.rejected += source.rejected
    target.invalid_result += source.invalid_result
    target.sdiff_sum += source.sdiff_sum
    target.sdiff_count += source.sdiff_count
    target.accepted_sdiffs.extend(source.accepted_sdiffs)
    if source.best.share is not None:
        target.best.consider(source.best.share, source.best.sdiff, source.best.createdate)


class _UserPartial:
    def __init__(self):
        self.stats = _ScopeState()
        self.workers = set()


class _WorkerPartial:
    def __init__(self):
        self.stats = _ScopeState()
        self.agent = None
        self.first_createdate = None
        self.last_createdate = None


class _FilePartial:
    def __init__(self):
        self.pool = _ScopeState()
        self.users = {}
        self.workers = {}
        self.earliest_createdate = None
        self.recent_tuples = []


def _file_partial_to_state(fp):
    return {
        "pool": fp.pool.to_state(),
        "users": {
            username: {"stats": up.stats.to_state(), "workers": sorted(up.workers)}
            for username, up in fp.users.items()
        },
        "workers": {
            workername: {
                "stats": wp.stats.to_state(),
                "agent": wp.agent,
                "first_createdate": list(wp.first_createdate) if wp.first_createdate else None,
                "last_createdate": list(wp.last_createdate) if wp.last_createdate else None,
            }
            for workername, wp in fp.workers.items()
        },
        "earliest_createdate": list(fp.earliest_createdate) if fp.earliest_createdate else None,
        "recent_tuples": fp.recent_tuples,
    }


def _file_partial_from_state(state):
    fp = _FilePartial()
    if state is None:
        return fp
    fp.pool = _ScopeState.from_state(state.get("pool"))
    for username, ustate in state.get("users", {}).items():
        up = _UserPartial()
        up.stats = _ScopeState.from_state(ustate["stats"])
        up.workers = set(ustate["workers"])
        fp.users[username] = up
    for workername, wstate in state.get("workers", {}).items():
        wp = _WorkerPartial()
        wp.stats = _ScopeState.from_state(wstate["stats"])
        wp.agent = wstate["agent"]
        wp.first_createdate = tuple(wstate["first_createdate"]) if wstate["first_createdate"] else None
        wp.last_createdate = tuple(wstate["last_createdate"]) if wstate["last_createdate"] else None
        fp.workers[workername] = wp
    fp.earliest_createdate = tuple(state["earliest_createdate"]) if state.get("earliest_createdate") else None
    fp.recent_tuples = [list(t) for t in state.get("recent_tuples", [])]
    return fp


def _apply_share_to_partial(fp, share, now):
    username = share.get("username")
    workername = share.get("workername")
    username_valid = is_valid_username(username)
    workername_valid = is_valid_workername(workername)
    result = share.get("result")
    sdiff = share.get("sdiff")
    sdiff_valid = is_valid_sdiff(sdiff)
    createdate = parse_createdate(share.get("createdate"))

    fp.pool.add(share, result, sdiff, sdiff_valid, createdate)

    if username_valid:
        up = fp.users.setdefault(username, _UserPartial())
        up.stats.add(share, result, sdiff, sdiff_valid, createdate)
        if workername_valid:
            up.workers.add(workername)

    if workername_valid:
        wp = fp.workers.setdefault(workername, _WorkerPartial())
        wp.stats.add(share, result, sdiff, sdiff_valid, createdate)
        agent = share.get("agent")
        if is_valid_agent(agent):
            wp.agent = agent
        if createdate is not None:
            if wp.first_createdate is None or createdate_sort_key(createdate) < createdate_sort_key(wp.first_createdate):
                wp.first_createdate = createdate
            if wp.last_createdate is None or createdate_sort_key(createdate) > createdate_sort_key(wp.last_createdate):
                wp.last_createdate = createdate

    if createdate is not None:
        if fp.earliest_createdate is None or createdate_sort_key(createdate) < createdate_sort_key(fp.earliest_createdate):
            fp.earliest_createdate = createdate

        timestamp = createdate_to_utc(createdate)
        if _within_retention(timestamp, now):
            fp.recent_tuples.append([createdate[0], createdate[1], result, sdiff, username, workername])


# ---------------------------------------------------------------------------
# State load/save (atomic)
# ---------------------------------------------------------------------------

def load_state(path=STATE_PATH):
    """Missing state file -> first run, returns a fresh empty state (the
    only case that returns a fresh state). Anything else that prevents
    reading a valid, version-matching state -- including the file
    disappearing between this existence check and the read below (a
    narrow but real TOCTOU race), permission errors, malformed JSON,
    an invalid top-level structure, or a version mismatch -- raises
    StateError rather than silently falling back to empty, so a corrupted
    or incompatible existing state can never be mistaken for "no state"
    and overwritten."""
    if not os.path.exists(path):
        return {"version": STATE_VERSION, "generation": 0, "files": {}}

    try:
        with open(path, "r", encoding="utf-8") as f:
            raw_state = json.load(f)
    except OSError as exc:
        raise StateLoadError(f"could not read state file {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise StateLoadError(f"state file {path} contains malformed JSON: {exc}") from exc

    if not isinstance(raw_state, dict) or not isinstance(raw_state.get("files"), dict):
        raise StateLoadError(f"state file {path} has an invalid top-level structure")

    _FINGERPRINT_KEYS = ("dev", "ino", "size", "mtime_ns", "offset", "prefix_hash")
    for file_path, entry in raw_state["files"].items():
        if not isinstance(entry, dict) or "fingerprint" not in entry or "partial" not in entry:
            raise StateLoadError(
                f"state file {path} has a malformed entry for {file_path!r}: "
                "expected a dict with 'fingerprint' and 'partial' keys"
            )
        fingerprint = entry["fingerprint"]
        if not isinstance(fingerprint, dict) or any(k not in fingerprint for k in _FINGERPRINT_KEYS):
            raise StateLoadError(
                f"state file {path} has a malformed fingerprint for {file_path!r}: "
                f"expected a dict with keys {_FINGERPRINT_KEYS}"
            )
        if not isinstance(entry["partial"], dict):
            raise StateLoadError(f"state file {path} has a malformed partial for {file_path!r}: expected a dict")

    version = raw_state.get("version")
    if not isinstance(version, int) or isinstance(version, bool):
        raise StateVersionError(f"state file {path} has a missing or non-integer version: {version!r}")
    if version != STATE_VERSION:
        raise StateVersionError(
            f"state file {path} has version {version}, but this code expects version {STATE_VERSION}; "
            "no implicit migration is performed"
        )

    return raw_state


def save_state(state, path=STATE_PATH):
    directory = os.path.dirname(path) or "."
    fd, tmp_path = tempfile.mkstemp(prefix=".analytics_state.", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(state, f)
        os.chmod(tmp_path, 0o644)
        os.replace(tmp_path, path)
    except BaseException:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# Per-run update: incrementally read new bytes, update partials, persist
# ---------------------------------------------------------------------------

def update_state(logs_dir, now, state_path=STATE_PATH):
    """The single durability commit point: reads only new bytes from every
    currently-present sharelog file (using stored fingerprints to skip
    unchanged files and detect truncation/replacement), updates per-file
    partials in memory, prunes stale recent_tuples everywhere, then
    atomically persists and returns the updated state. now must be a
    timezone-aware UTC datetime."""
    raw_state = load_state(state_path)
    files_state = raw_state.get("files", {})
    current_files = set(find_sharelog_files(logs_dir))
    changed = False

    for path in current_files:
        try:
            current_stat = os.stat(path)
        except OSError:
            continue

        stored = files_state.get(path)

        # _is_provably_unchanged (dev/ino/size/mtime_ns all identical) is
        # deliberately NOT used to skip verification -- a same-size,
        # same-mtime in-place truncate+overwrite (e.g. on a filesystem with
        # coarse mtime resolution, or backup/restore tooling that preserves
        # timestamps) would then go undetected forever. _check_consistency's
        # prefix-hash re-verification always runs; it's the one thing here
        # that still costs a small read per file per run regardless of
        # whether anything actually changed.
        #
        # Every open()/read() below can race with the file vanishing between
        # this loop's os.stat() and here (a live pool actively rotates
        # sharelog files) -- caught the same way the leading os.stat()
        # failure already is: skip this file for this run, leave its
        # existing state untouched, keep processing the remaining files.
        try:
            consistent = stored is not None and _check_consistency(path, current_stat, stored["fingerprint"])

            if consistent:
                fp = _file_partial_from_state(stored["partial"])
                offset = stored["fingerprint"]["offset"]
            else:
                fp = _FilePartial()
                offset = 0

            new_lines, new_offset = _read_new_lines(path, offset)
        except OSError:
            continue

        if consistent and not new_lines:
            # Verified unchanged and nothing new to read -- covers both a
            # truly static file AND one whose only unread bytes are a
            # persistent, never-completed trailing line (an actively-tailed
            # file's realistic steady state). Either way nothing committed
            # actually changed, so don't touch the fingerprint or partial;
            # only prune recent_tuples against this run's `now`, directly on
            # the raw stored JSON rather than round-tripping the whole
            # partial through the full class hierarchy.
            raw_tuples = stored["partial"].get("recent_tuples", [])
            pruned = [t for t in raw_tuples if _within_retention(createdate_to_utc((t[0], t[1])), now)]
            if len(pruned) != len(raw_tuples):
                new_partial = dict(stored["partial"])
                new_partial["recent_tuples"] = pruned
                files_state[path] = {"fingerprint": stored["fingerprint"], "partial": new_partial}
                changed = True
            continue

        for raw_line in new_lines:
            share = _parse_line(raw_line)
            if share is None:
                continue
            _apply_share_to_partial(fp, share, now)

        fp.recent_tuples = [
            t for t in fp.recent_tuples if _within_retention(createdate_to_utc((t[0], t[1])), now)
        ]

        try:
            fingerprint = _make_fingerprint(path, current_stat, new_offset)
        except OSError:
            continue

        files_state[path] = {
            "fingerprint": fingerprint,
            "partial": _file_partial_to_state(fp),
        }
        changed = True

    # Deleted/rotated-away files: keep their partial (historical stats
    # preserved), just prune recent_tuples for staleness using this run's
    # now, directly on the raw JSON (see the fast path above for why).
    for path, entry in files_state.items():
        if path in current_files:
            continue
        raw_tuples = entry["partial"].get("recent_tuples", [])
        pruned = [t for t in raw_tuples if _within_retention(createdate_to_utc((t[0], t[1])), now)]
        if len(pruned) != len(raw_tuples):
            entry["partial"] = dict(entry["partial"])
            entry["partial"]["recent_tuples"] = pruned
            changed = True

    if not changed:
        # Nothing actually changed this run (the overwhelmingly common
        # case once the pool has been running a while): skip the write
        # entirely rather than re-persisting an identical multi-megabyte
        # state file. Still return a state dict shaped like a fresh load,
        # for the caller to merge from.
        return {
            "version": raw_state.get("version", STATE_VERSION),
            "generation": raw_state.get("generation", 0),
            "files": files_state,
        }

    new_state = {
        "version": STATE_VERSION,
        "generation": raw_state.get("generation", 0) + 1,
        "files": files_state,
    }
    save_state(new_state, state_path)
    return new_state


# ---------------------------------------------------------------------------
# Merge: combine all files' partials into the analytics.json shape
# ---------------------------------------------------------------------------

def _scope_output(scope, best_share_today):
    """best_share_today must already be the final {username, workername,
    sdiff, timestamp} dict (or None), not a tracker -- callers compute it
    differently per scope (see merge_state_to_analytics)."""
    accepted_sdiffs = sorted(scope.accepted_sdiffs)
    has_sdiffs = bool(accepted_sdiffs)
    return {
        "accepted_count": scope.accepted,
        "rejected_count": scope.rejected,
        "invalid_result_count": scope.invalid_result,
        "average_sdiff": (scope.sdiff_sum / scope.sdiff_count) if scope.sdiff_count else None,
        "median_sdiff": median(accepted_sdiffs) if has_sdiffs else None,
        "min_sdiff": accepted_sdiffs[0] if has_sdiffs else None,
        "max_sdiff": accepted_sdiffs[-1] if has_sdiffs else None,
        "percentiles": {
            "p50": percentile(accepted_sdiffs, 50) if has_sdiffs else None,
            "p90": percentile(accepted_sdiffs, 90) if has_sdiffs else None,
            "p99": percentile(accepted_sdiffs, 99) if has_sdiffs else None,
        },
        "best_share_today": best_share_today,
        "best_share_ever": scope.best.to_dict(),
    }


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

        if current is None or previous is None:
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


def merge_state_to_analytics(state, now, today, yesterday):
    """Combines every file's partial into the final pool/users/workers/
    daily_bests/live_ticker shape. now must be timezone-aware UTC;
    today/yesterday must be UTC dates."""

    pool_scope = _ScopeState()
    users_scope = {}
    users_workers = {}
    workers_scope = {}
    workers_agent = {}
    workers_first = {}
    workers_last = {}
    earliest_createdate = None

    pool_windows = _empty_window_set()
    user_windows = {}
    worker_windows = {}

    # best_share_today candidacy rules deliberately mirror
    # pool_statistics.py/worker_statistics.py exactly: pool and worker
    # best-today do NOT require a valid username (only worker requires a
    # valid workername), unlike daily_candidates below which is inherently
    # per-user and requires one.
    pool_best_today = _BestTracker()
    workers_best_today = {}

    daily_candidates = {today: {}, yesterday: {}}

    # Sorted iteration matters for `agent`: the same semantics as the
    # original "most recently seen by iteration order" (files were always
    # processed in find_sharelog_files' sorted order) are preserved by
    # letting the LAST file (in sorted path order) that sets a valid agent
    # for a worker win, rather than comparing timestamps.
    for path in sorted(state["files"].keys()):
        fp = _file_partial_from_state(state["files"][path]["partial"])

        _merge_scope(pool_scope, fp.pool)
        if fp.earliest_createdate is not None:
            if earliest_createdate is None or createdate_sort_key(fp.earliest_createdate) < createdate_sort_key(earliest_createdate):
                earliest_createdate = fp.earliest_createdate

        for username, up in fp.users.items():
            scope = users_scope.setdefault(username, _ScopeState())
            _merge_scope(scope, up.stats)
            users_workers.setdefault(username, set()).update(up.workers)

        for workername, wp in fp.workers.items():
            scope = workers_scope.setdefault(workername, _ScopeState())
            _merge_scope(scope, wp.stats)
            if wp.agent is not None:
                workers_agent[workername] = wp.agent
            if wp.first_createdate is not None:
                if workername not in workers_first or createdate_sort_key(wp.first_createdate) < createdate_sort_key(workers_first[workername]):
                    workers_first[workername] = wp.first_createdate
            if wp.last_createdate is not None:
                if workername not in workers_last or createdate_sort_key(wp.last_createdate) > createdate_sort_key(workers_last[workername]):
                    workers_last[workername] = wp.last_createdate

        for t in fp.recent_tuples:
            seconds, nanos, result, sdiff, username, workername = t
            createdate = (seconds, nanos)
            timestamp = createdate_to_utc(createdate)
            username_valid = is_valid_username(username)
            workername_valid = is_valid_workername(workername)
            result_valid = is_valid_result(result)
            sdiff_valid = is_valid_sdiff(sdiff)
            share = {"username": username, "workername": workername}

            if result_valid:
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

                if result and sdiff_valid and timestamp.date() == today:
                    pool_best_today.consider(share, sdiff, createdate)
                    if workername_valid:
                        workers_best_today.setdefault(workername, _BestTracker()).consider(share, sdiff, createdate)

                if result and sdiff_valid and username_valid:
                    share_date = timestamp.date()
                    if share_date in daily_candidates:
                        daily_candidates[share_date].setdefault(username, []).append((sdiff, createdate, share))

    daily_bests = {}
    for date, users_candidates in daily_candidates.items():
        include = True if date == today else bool(users_candidates)
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

    empty_windows = _window_set_to_dict(_empty_window_set())
    today_users_daily = daily_bests.get(today.isoformat(), {}).get("users", {})

    users_out = {}
    for username, scope in users_scope.items():
        user_best_today = today_users_daily.get(username, {}).get("current_daily_best")
        users_out[username] = {
            **_scope_output(scope, user_best_today),
            "workers": sorted(users_workers.get(username, set())),
            "rolling_windows": _window_set_to_dict(user_windows[username]) if username in user_windows else empty_windows,
        }

    workers_out = {}
    for workername, scope in workers_scope.items():
        last_createdate = workers_last.get(workername)
        last_share_at = createdate_to_utc(last_createdate) if last_createdate else None
        is_active = last_share_at is not None and timedelta(0) <= (now - last_share_at) <= ACTIVE_WINDOW
        first_createdate = workers_first.get(workername)
        worker_best_today = workers_best_today.get(workername)
        workers_out[workername] = {
            "agent": workers_agent.get(workername),
            "first_share_at": createdate_to_utc(first_createdate).isoformat() if first_createdate else None,
            "last_share_at": last_share_at.isoformat() if last_share_at else None,
            "is_active": is_active,
            **_scope_output(scope, worker_best_today.to_dict() if worker_best_today else None),
            "rolling_windows": _window_set_to_dict(worker_windows[workername]) if workername in worker_windows else empty_windows,
        }

    pool_out = {
        **_scope_output(pool_scope, pool_best_today.to_dict()),
        "rolling_windows": _window_set_to_dict(pool_windows),
    }

    share_records_processed = pool_scope.accepted + pool_scope.rejected + pool_scope.invalid_result

    return {
        "pool": pool_out,
        "users": users_out,
        "workers": workers_out,
        "daily_bests": daily_bests,
        "live_ticker": build_live_ticker(daily_bests, today),
        "pool_start_date": createdate_to_utc(earliest_createdate).date().isoformat() if earliest_createdate else None,
        "share_records_processed": share_records_processed,
    }
