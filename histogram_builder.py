#!/usr/bin/env python3
"""Phase E Milestone 29: Share Difficulty Distribution Histogram.

Human Approval Brief (2026-07-22): a permanent, fixed-forever set of 12
logarithmic difficulty buckets (11 finite boundaries, anchored on 21 --
Bitcoin's defining number -- each boundary exactly x10 the previous; the
12th bucket is permanently open-ended above the last boundary), built for
Pool/User/Worker at two datasets ("1d" and "total"). Every bucket count and
per-bucket "highest solved share" comes from real, already-accepted shares
in the .sharelog files -- nothing here is estimated, interpolated, or
fabricated.

Deliberately a standalone module, independent of analytics_state.py --
mirrors that module's own incremental-state architecture (per-sharelog-file
byte-offset tracking with a fingerprint consistency check, a pruned
recent-tuples buffer for the bounded-cost "1 Day" dataset, forever-
cumulative counters for "Total") but reimplements it independently rather
than importing analytics_state.py's private classes, matching the same
module-separation precedent Milestone 28's ckpool_native_stats.py already
established. The cost of this separation is that sharelog bytes get read
twice per run (once by analytics_state.py, once here) -- an explicit,
Human-approved tradeoff in exchange for genuine isolation, not an
oversight.

Reuses (read-only, imported) the same validated helpers analytics_state.py
itself already relies on from pool_statistics.py/user_statistics.py/
worker_statistics.py -- is_valid_username/is_valid_workername/
is_valid_result/is_valid_sdiff/createdate_to_utc/parse_createdate/
_BestTracker -- rather than reimplementing validation
logic that already exists and is already trusted elsewhere in this
project. None of those files, nor analytics_state.py, is modified by this
module.

"Solved share" here means an ACCEPTED share with a valid sdiff -- the same
definition already used for best_share_today/best_share_ever elsewhere in
this codebase, not a new one invented for this feature.
"""

import json
import os
import tempfile
from datetime import timedelta

from parse_share_analytics import find_sharelog_files
from pool_statistics import (
    MAX_TIMESTAMP_SECONDS,
    _BestTracker,
    createdate_to_utc,
    is_valid_result,
    is_valid_sdiff,
    parse_createdate,
)
from user_statistics import is_valid_username
from worker_statistics import is_valid_workername

STATE_VERSION = 1
STATE_PATH = "/home/damopool/ckpool-solo/ckpool/histogram.state.json"

# Fixed, permanent bucket boundaries -- Human Approval Brief, Milestone 29.
# Anchored on 21, each boundary exactly x10 the previous. 11 finite
# boundaries define 12 buckets: bucket i (0-indexed) = [BOUNDARIES[i-1],
# BOUNDARIES[i]) for i in 1..10, bucket 0 = [0, BOUNDARIES[0]), and the
# 12th (last) bucket = [BOUNDARIES[-1], infinity). MUST NEVER be changed,
# reordered, or generated from the dataset -- the entire point is
# permanent comparability across pool/user/worker/date/software version.
# The real Bitcoin network difficulty (~127.17T as of this milestone)
# falls inside the last FINITE bucket ([21T, 210T)); the open-ended 12th
# bucket therefore represents "harder than the current network target" --
# a real, meaningful (if rare) category, not a wasted placeholder.
BUCKET_BOUNDARIES = (
    21_000,
    210_000,
    2_100_000,
    21_000_000,
    210_000_000,
    2_100_000_000,
    21_000_000_000,
    210_000_000_000,
    2_100_000_000_000,
    21_000_000_000_000,
    210_000_000_000_000,
)
BUCKET_COUNT = len(BUCKET_BOUNDARIES) + 1  # 12

# "1 Day" retention: the same two-tier pattern as analytics_state.py's own
# RECENT_TUPLE_RETENTION/WINDOWS split -- this wide value is a STORAGE
# buffer only (how long a tuple stays in the pruned recent_tuples list
# at all), not the reported "1d" cutoff itself. It exists purely so a
# run's own timing jitter never discards a tuple that a later run might
# still need to place within the exact window below.
RECENT_TUPLE_RETENTION = timedelta(hours=25)

# The actual "1 Day" dataset window (Human Approval Brief: "1 Day"),
# applied as an exact cutoff at merge time -- distinct from the wider
# RECENT_TUPLE_RETENTION storage buffer above. Code Review (Milestone
# 29): reusing RECENT_TUPLE_RETENTION's own 25h slack AS the reported
# window (rather than re-filtering to an exact 24h at merge time, the
# way analytics_state.py's own WINDOWS/is_within_window does) silently
# made "1 Day" a ~25-hour window in every run, forever.
DAY_WINDOW = timedelta(hours=24)


def is_within_window(now, timestamp, window_delta):
    delta = now - timestamp
    return timedelta(0) <= delta <= window_delta


class HistogramStateError(Exception):
    """Base class for histogram.state.json load failures."""


class HistogramStateLoadError(HistogramStateError):
    """The state file exists but could not be read, parsed, or is
    structurally invalid -- distinct from "no state file exists" (the
    normal, safe first-run case). Silently treating a corrupted-but-present
    state file as empty would discard forever-cumulative "Total" bucket
    counts for sharelog files no longer present (rotated away), which
    cannot be reconstructed from currently-present source files alone."""


class HistogramStateVersionError(HistogramStateError):
    """The state file's version does not match the running STATE_VERSION.
    No implicit migration is performed."""


def bucket_index(sdiff):
    """Maps a solved share's sdiff to one of the 12 fixed buckets (0-11).
    Returns None for a non-finite/invalid value -- callers only invoke
    this after is_valid_sdiff has already confirmed the value is usable,
    but this stays defensive regardless."""
    if not isinstance(sdiff, (int, float)) or isinstance(sdiff, bool):
        return None
    if sdiff != sdiff or sdiff in (float("inf"), float("-inf")):
        return None
    for i, boundary in enumerate(BUCKET_BOUNDARIES):
        if sdiff < boundary:
            return i
    return len(BUCKET_BOUNDARIES)


# ---------------------------------------------------------------------------
# Per-file partial accumulator state (mirrors analytics_state.py's own
# _ScopeState/_FilePartial pattern, independently implemented)
# ---------------------------------------------------------------------------

class _HistogramScope:
    """Forever-cumulative per-bucket share counts + a best-share tracker
    per bucket, for one scope (pool/user/worker), contributed by ONE
    sharelog file."""

    def __init__(self):
        self.counts = [0] * BUCKET_COUNT
        self.best = [_BestTracker() for _ in range(BUCKET_COUNT)]

    def add(self, share, sdiff, createdate):
        idx = bucket_index(sdiff)
        if idx is None:
            return
        self.counts[idx] += 1
        self.best[idx].consider(share, sdiff, createdate)

    def to_state(self):
        best_state = []
        for tracker in self.best:
            if tracker.share is None:
                best_state.append(None)
            else:
                best_state.append({
                    "share": tracker.share,
                    "sdiff": tracker.sdiff,
                    "createdate": list(tracker.createdate) if tracker.createdate else None,
                })
        return {"counts": list(self.counts), "best": best_state}

    @classmethod
    def from_state(cls, state):
        obj = cls()
        if state is None:
            return obj
        obj.counts = list(state["counts"])
        for i, best_state in enumerate(state.get("best", [])):
            if best_state is None:
                continue
            tracker = obj.best[i]
            tracker.share = best_state["share"]
            tracker.sdiff = best_state["sdiff"]
            tracker.createdate = tuple(best_state["createdate"]) if best_state["createdate"] else None
        return obj

    def to_output(self):
        return {
            "bucket_counts": list(self.counts),
            "bucket_best": [t.to_dict() for t in self.best],
        }


def _merge_histogram_scope(target, source):
    for i in range(BUCKET_COUNT):
        target.counts[i] += source.counts[i]
        if source.best[i].share is not None:
            target.best[i].consider(source.best[i].share, source.best[i].sdiff, source.best[i].createdate)


def _empty_histogram_output():
    return {"bucket_counts": [0] * BUCKET_COUNT, "bucket_best": [None] * BUCKET_COUNT}


def empty_histogram_dataset_pair():
    """Public (no leading underscore): the {"1d": {...}, "total": {...}}
    fallback shape for a user/worker analytics_state.py already produced
    (they've submitted at least one share of *some* kind) but who has no
    entry here (never a single ACCEPTED, valid-sdiff share) -- used by
    analytics_builder.py when merging, so every user/worker in
    analytics.json always has a well-formed difficulty_histogram field,
    never a missing key."""
    return {"1d": _empty_histogram_output(), "total": _empty_histogram_output()}


def _within_retention(ts, now):
    return timedelta(0) <= (now - ts) <= RECENT_TUPLE_RETENTION


class _FilePartial:
    def __init__(self):
        self.pool = _HistogramScope()
        self.users = {}
        self.workers = {}
        self.recent_tuples = []


def _file_partial_to_state(fp):
    return {
        "pool": fp.pool.to_state(),
        "users": {username: scope.to_state() for username, scope in fp.users.items()},
        "workers": {workername: scope.to_state() for workername, scope in fp.workers.items()},
        "recent_tuples": fp.recent_tuples,
    }


def _file_partial_from_state(state):
    fp = _FilePartial()
    if state is None:
        return fp
    fp.pool = _HistogramScope.from_state(state.get("pool"))
    for username, sstate in state.get("users", {}).items():
        fp.users[username] = _HistogramScope.from_state(sstate)
    for workername, sstate in state.get("workers", {}).items():
        fp.workers[workername] = _HistogramScope.from_state(sstate)
    fp.recent_tuples = [list(t) for t in state.get("recent_tuples", [])]
    return fp


def _parse_line(raw_line):
    """Independent equivalent of analytics_state.py's own _parse_line --
    deliberately duplicated rather than imported (that function is private
    to that module)."""
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
        "sdiff": record.get("sdiff"),
        "result": record.get("result"),
        "createdate": record.get("createdate"),
    }


def _apply_share_to_partial(fp, share, now):
    """Only ACCEPTED shares with a valid sdiff count toward the
    histogram -- "solved share difficulty distribution" means accepted
    shares, the same definition best_share_today/best_share_ever already
    use elsewhere in this codebase."""
    result = share.get("result")
    if not is_valid_result(result) or not result:
        return
    sdiff = share.get("sdiff")
    if not is_valid_sdiff(sdiff):
        return

    username = share.get("username")
    workername = share.get("workername")
    createdate = parse_createdate(share.get("createdate"))

    fp.pool.add(share, sdiff, createdate)

    if is_valid_username(username):
        fp.users.setdefault(username, _HistogramScope()).add(share, sdiff, createdate)

    if is_valid_workername(workername):
        fp.workers.setdefault(workername, _HistogramScope()).add(share, sdiff, createdate)

    if createdate is not None:
        timestamp = createdate_to_utc(createdate)
        if _within_retention(timestamp, now):
            fp.recent_tuples.append([createdate[0], createdate[1], sdiff, username, workername])


# ---------------------------------------------------------------------------
# File consistency / incremental read (independent equivalents of
# analytics_state.py's own _read_prefix_hash/_check_consistency/
# _make_fingerprint/_read_new_lines)
# ---------------------------------------------------------------------------

def _read_prefix_hash(path, upto):
    import hashlib
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


def _read_new_lines(path, start_offset):
    with open(path, "rb") as f:
        f.seek(start_offset)
        data = f.read()
    last_newline = data.rfind(b"\n")
    if last_newline == -1:
        return [], start_offset
    new_offset = start_offset + last_newline + 1
    lines = data[:last_newline].split(b"\n")
    return lines, new_offset


# ---------------------------------------------------------------------------
# State load/save (atomic) -- independent equivalents of analytics_state.py's
# own load_state/save_state
# ---------------------------------------------------------------------------

def _is_valid_seconds(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_TIMESTAMP_SECONDS


def _is_valid_nanos(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 999_999_999


def _validate_best_entry(entry, context):
    """Code Review finding (Milestone 29, final pass): the original version
    of this check only confirmed "share"/"sdiff"/"createdate" keys were
    PRESENT, not that their values were the shapes _HistogramScope's own
    to_state()/_BestTracker.to_dict() actually round-trip -- a state file
    that passed the shallow check (e.g. "share": "garbage") would sail
    through load_state() only to raise an uncontrolled TypeError deep
    inside merge_histogram_state()/to_dict() instead of the intended,
    actionable HistogramStateLoadError. This checks the value shapes
    those two functions actually depend on. createdate's seconds/nanos are
    bounded the same way pool_statistics.parse_createdate already bounds
    them (MAX_TIMESTAMP_SECONDS / 0-999999999) -- an in-range-type but
    absurd-magnitude int (e.g. 10**30) would otherwise still overflow
    datetime.fromtimestamp() inside to_dict()/createdate_to_utc with an
    uncontrolled OverflowError (Code Review follow-up finding)."""
    if entry is None:
        return
    if not isinstance(entry, dict) or "share" not in entry or "sdiff" not in entry or "createdate" not in entry:
        raise HistogramStateLoadError(
            f"{context} is malformed: expected None or a dict with 'share'/'sdiff'/'createdate'"
        )
    share = entry["share"]
    if not isinstance(share, dict) or "username" not in share or "workername" not in share:
        raise HistogramStateLoadError(f"{context}['share'] is malformed: expected a dict with 'username'/'workername'")
    sdiff = entry["sdiff"]
    if not isinstance(sdiff, (int, float)) or isinstance(sdiff, bool):
        raise HistogramStateLoadError(f"{context}['sdiff'] is malformed: expected a real number")
    createdate = entry["createdate"]
    if createdate is not None and (
        not isinstance(createdate, list)
        or len(createdate) != 2
        or not _is_valid_seconds(createdate[0])
        or not _is_valid_nanos(createdate[1])
    ):
        raise HistogramStateLoadError(
            f"{context}['createdate'] is malformed: expected None or [seconds, nanos] "
            f"with 0 <= seconds <= {MAX_TIMESTAMP_SECONDS} and 0 <= nanos <= 999999999"
        )


def _validate_scope_state(scope_state, context):
    """Independent Test Engineer finding (Milestone 29): load_state()'s
    original validation only checked that a "partial" value WAS a dict,
    never that its internal shape matched what _HistogramScope.from_state
    actually reads. Every read there uses dict.get(...)-with-a-default,
    so a structurally-shallow-valid-but-internally-wrong "partial" (e.g.
    missing "counts"/"best") silently degraded to an all-zero/empty
    scope instead of raising -- exactly the "corrupted-but-present state
    silently treated as empty" failure mode HistogramStateLoadError's
    own docstring says must never happen. This validates deep enough to
    catch that."""
    if not isinstance(scope_state, dict):
        raise HistogramStateLoadError(f"{context} is not a dict")
    counts = scope_state.get("counts")
    if not isinstance(counts, list) or len(counts) != BUCKET_COUNT or not all(
        isinstance(c, int) and not isinstance(c, bool) and c >= 0 for c in counts
    ):
        raise HistogramStateLoadError(
            f"{context} has a malformed 'counts': expected a list of {BUCKET_COUNT} non-negative ints"
        )
    best = scope_state.get("best")
    if not isinstance(best, list) or len(best) != BUCKET_COUNT:
        raise HistogramStateLoadError(f"{context} has a malformed 'best': expected a list of {BUCKET_COUNT} entries")
    for i, entry in enumerate(best):
        _validate_best_entry(entry, f"{context}['best'][{i}]")


def _validate_partial_state(partial, context):
    if not isinstance(partial, dict):
        raise HistogramStateLoadError(f"{context} is not a dict")
    for key in ("pool", "users", "workers", "recent_tuples"):
        if key not in partial:
            raise HistogramStateLoadError(f"{context} is missing required key {key!r}")
    _validate_scope_state(partial["pool"], f"{context}['pool']")
    if not isinstance(partial["users"], dict):
        raise HistogramStateLoadError(f"{context}['users'] is not a dict")
    for username, sstate in partial["users"].items():
        _validate_scope_state(sstate, f"{context}['users'][{username!r}]")
    if not isinstance(partial["workers"], dict):
        raise HistogramStateLoadError(f"{context}['workers'] is not a dict")
    for workername, sstate in partial["workers"].items():
        _validate_scope_state(sstate, f"{context}['workers'][{workername!r}]")
    if not isinstance(partial["recent_tuples"], list):
        raise HistogramStateLoadError(f"{context}['recent_tuples'] is not a list")
    for i, t in enumerate(partial["recent_tuples"]):
        _validate_recent_tuple(t, f"{context}['recent_tuples'][{i}]")


def _validate_recent_tuple(t, context):
    """Code Review follow-up finding (Milestone 29, second fix round):
    the original recent_tuples check validated element COUNT only, never
    element TYPE. Unlike bucket_best (only read when a bucket's own best
    share is displayed), every recent_tuple's [seconds, nanos] is fed
    unconditionally into createdate_to_utc() on EVERY run that touches
    this file -- in the pruning path (whether or not there are new
    sharelog lines) and in merge_histogram_state()'s own "1d" rebuild --
    so a malformed seconds/nanos here crashed with an uncontrolled
    TypeError/OverflowError far more readily than the bucket_best gap
    this same fix round already closed. sdiff is deliberately not bounds-
    checked beyond "a real number" -- bucket_index() (called via
    _HistogramScope.add()) already defensively handles any sdiff value,
    including out-of-range/non-finite ones, by returning None rather
    than raising. username/workername are also not validated here: they
    are only ever re-wrapped into a fresh {"username":..., "workername":
    ...} dict literal before use (never dict-subscripted from state), so
    no crash is reachable regardless of their type."""
    if not isinstance(t, (list, tuple)) or len(t) != 5:
        raise HistogramStateLoadError(f"{context} is malformed: expected a 5-element sequence")
    seconds, nanos, sdiff, _username, _workername = t
    if not _is_valid_seconds(seconds):
        raise HistogramStateLoadError(
            f"{context}[0] (seconds) is malformed: expected an int in [0, {MAX_TIMESTAMP_SECONDS}]"
        )
    if not _is_valid_nanos(nanos):
        raise HistogramStateLoadError(f"{context}[1] (nanos) is malformed: expected an int in [0, 999999999]")
    if not isinstance(sdiff, (int, float)) or isinstance(sdiff, bool):
        raise HistogramStateLoadError(f"{context}[2] (sdiff) is malformed: expected a real number")


def load_state(path=STATE_PATH):
    if not os.path.exists(path):
        return {"version": STATE_VERSION, "files": {}}

    try:
        with open(path, "r", encoding="utf-8") as f:
            raw_state = json.load(f)
    except OSError as exc:
        raise HistogramStateLoadError(f"could not read state file {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise HistogramStateLoadError(f"state file {path} contains malformed JSON: {exc}") from exc

    if not isinstance(raw_state, dict) or not isinstance(raw_state.get("files"), dict):
        raise HistogramStateLoadError(f"state file {path} has an invalid top-level structure")

    fingerprint_keys = ("dev", "ino", "size", "mtime_ns", "offset", "prefix_hash")
    for file_path, entry in raw_state["files"].items():
        if not isinstance(entry, dict) or "fingerprint" not in entry or "partial" not in entry:
            raise HistogramStateLoadError(
                f"state file {path} has a malformed entry for {file_path!r}: "
                "expected a dict with 'fingerprint' and 'partial' keys"
            )
        fingerprint = entry["fingerprint"]
        if not isinstance(fingerprint, dict) or any(k not in fingerprint for k in fingerprint_keys):
            raise HistogramStateLoadError(
                f"state file {path} has a malformed fingerprint for {file_path!r}: "
                f"expected a dict with keys {fingerprint_keys}"
            )
        _validate_partial_state(entry["partial"], f"state file {path}'s partial for {file_path!r}")

    version = raw_state.get("version")
    if not isinstance(version, int) or isinstance(version, bool):
        raise HistogramStateVersionError(f"state file {path} has a missing or non-integer version: {version!r}")
    if version != STATE_VERSION:
        raise HistogramStateVersionError(
            f"state file {path} has version {version}, but this code expects version {STATE_VERSION}; "
            "no implicit migration is performed"
        )

    return raw_state


def save_state(state, path=STATE_PATH):
    directory = os.path.dirname(path) or "."
    fd, tmp_path = tempfile.mkstemp(prefix=".histogram_state.", suffix=".tmp", dir=directory)
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
# Per-run update + merge (mirrors analytics_state.py's own
# update_state/merge_state_to_analytics split)
# ---------------------------------------------------------------------------

def update_histogram_state(logs_dir, now, state_path=STATE_PATH):
    """now must be a timezone-aware UTC datetime. Reads only new bytes from
    every currently-present sharelog file, updates per-file partials,
    prunes stale recent_tuples everywhere, then atomically persists and
    returns the updated state."""
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

        fp.recent_tuples = [t for t in fp.recent_tuples if _within_retention(createdate_to_utc((t[0], t[1])), now)]

        try:
            fingerprint = _make_fingerprint(path, current_stat, new_offset)
        except OSError:
            continue

        files_state[path] = {
            "fingerprint": fingerprint,
            "partial": _file_partial_to_state(fp),
        }
        changed = True

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
        return {"version": raw_state.get("version", STATE_VERSION), "files": files_state}

    new_state = {"version": STATE_VERSION, "files": files_state}
    save_state(new_state, state_path)
    return new_state


def merge_histogram_state(state, now):
    """Combines every file's partial into the final
    {"pool": {"1d": {...}, "total": {...}}, "users": {...}, "workers": {...}}
    shape. "total" is the forever-cumulative merge of every file's own
    scope; "1d" is recomputed fresh from the union of every file's pruned
    recent_tuples, bucketed against this run's `now`."""
    total_pool = _HistogramScope()
    total_users = {}
    total_workers = {}

    day_pool = _HistogramScope()
    day_users = {}
    day_workers = {}

    for path in sorted(state["files"].keys()):
        fp = _file_partial_from_state(state["files"][path]["partial"])

        _merge_histogram_scope(total_pool, fp.pool)
        for username, scope in fp.users.items():
            _merge_histogram_scope(total_users.setdefault(username, _HistogramScope()), scope)
        for workername, scope in fp.workers.items():
            _merge_histogram_scope(total_workers.setdefault(workername, _HistogramScope()), scope)

        for t in fp.recent_tuples:
            seconds, nanos, sdiff, username, workername = t
            createdate = (seconds, nanos)
            timestamp = createdate_to_utc(createdate)
            # The exact "1 Day" cutoff -- NOT _within_retention (that
            # only governs how long a tuple survives in storage, a
            # wider buffer than the reported window; see DAY_WINDOW's
            # own comment above).
            if not is_within_window(now, timestamp, DAY_WINDOW):
                continue
            share = {"username": username, "workername": workername}
            day_pool.add(share, sdiff, createdate)
            if is_valid_username(username):
                day_users.setdefault(username, _HistogramScope()).add(share, sdiff, createdate)
            if is_valid_workername(workername):
                day_workers.setdefault(workername, _HistogramScope()).add(share, sdiff, createdate)

    all_usernames = set(total_users) | set(day_users)
    all_workernames = set(total_workers) | set(day_workers)

    users_out = {
        username: {
            "1d": (day_users[username].to_output() if username in day_users else _empty_histogram_output()),
            "total": (total_users[username].to_output() if username in total_users else _empty_histogram_output()),
        }
        for username in all_usernames
    }
    workers_out = {
        workername: {
            "1d": (day_workers[workername].to_output() if workername in day_workers else _empty_histogram_output()),
            "total": (total_workers[workername].to_output() if workername in total_workers else _empty_histogram_output()),
        }
        for workername in all_workernames
    }

    return {
        "pool": {"1d": day_pool.to_output(), "total": total_pool.to_output()},
        "users": users_out,
        "workers": workers_out,
    }


def build_histograms(logs_dir, now, state_path=STATE_PATH):
    """Top-level entry point analytics_builder.py calls once per run."""
    state = update_histogram_state(logs_dir, now, state_path=state_path)
    return merge_histogram_state(state, now)
