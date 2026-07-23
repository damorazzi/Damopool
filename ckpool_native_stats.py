#!/usr/bin/env python3
"""Reads CKPool's own native, live-updated statistics files -- deliberately
independent of analytics_state.py's incremental sharelog-processing engine.

Phase E Milestone 28 (Human Approval Brief 2026-07-22): every value here is
read verbatim from CKPool's own internal hashrate tracking, never estimated
or aggregated by this project's code. Two file types, both under the same
LOGS_DIR the rest of the analytics engine already uses:

- logs/pool/pool.status -- pool-wide, written by ckpoold itself. NOT a
  single JSON document -- three independent JSON objects, one per line
  (ckpool's own log-style stats dump). The line carrying "hashrate1m" also
  carries every other hashrate window (5m/15m/1hr/6hr/1d/7d); only 1m and
  1d ("1 day" == the Human's "24 Hour") are surfaced, per explicit
  instruction not to display 5m/1h/7d.
- logs/users/<btc-address> -- one file per user, written by ckpoold
  whenever that user submits a share. Carries the same hashrate fields at
  the user level (top of the file) and, nested in a "worker" array, the
  identical fields per individual worker. The filename itself IS the
  username (no separate "username" field inside).

Unlike sharelog files (append-only, processed incrementally by
analytics_state.py's own byte-offset tracking), both file types here are
small, fully-overwritten snapshots CKPool keeps current on its own -- a
full, fresh read every analytics_builder.py run (every 5 minutes) is
trivially cheap and needs none of that incremental machinery. This module
is intentionally standalone: analytics_state.py is not imported, and
nothing here is woven into its state.

Deliberately not reused from parse_pool_stats.py (that file, and
pool_stats.json's own format, must stay byte-for-byte unmodified per
CLAUDE.md) -- _parse_hashrate_string below is a small, independent
equivalent of that file's own parse_unit, same base-1000 K/M/G/T/P
convention the rest of this project (and the frontend) already use.

Every read degrades gracefully: a missing, unreadable, or malformed file
(a user who hasn't had a native file written yet, a transient read race
with ckpoold's own writes, anything) yields None hashrate values for that
entry rather than raising -- this must never fail the whole analytics
build (explicit Human requirement)."""

import json
import os
import re
import tempfile

_UNIT_FACTORS = {"H": 1, "K": 1e3, "M": 1e6, "G": 1e9, "T": 1e12, "P": 1e15}
_UNIT_PATTERN = re.compile(r"^([\d.]+)([A-Za-z]*)$")

_EMPTY_HASHRATES = {"hashrate_1m": None, "hashrate_24h": None}

# Phase E Milestone 29: the current Bitcoin network difficulty, for the
# histogram's permanent marker. CKPool tracks this internally
# (stratifier.c's stats->network_diff, derived from the block template it
# requests from Bitcoin Core) and logs it -- only when it changes, roughly
# every ~2 weeks matching real difficulty adjustments -- as a plain
# LOGWARNING line in ckpool.log: "Network diff set to 127170500429035.2".
# Confirmed against the real log during investigation; not exposed in any
# snapshot file (pool.status's own "diff" field is a different thing --
# percent-of-network-difficulty-accounted-for, not the value itself).
NETWORK_DIFF_PATTERN = re.compile(r"Network diff set to ([\d.]+)")
NETWORK_DIFF_STATE_PATH = "/home/damopool/ckpool-solo/ckpool/network_diff.state.json"


def _parse_hashrate_string(value):
    """"9.84T" -> 9.84e12. None (not 0) for anything missing/malformed --
    0 would be indistinguishable from a genuine zero hashrate reading."""
    if not isinstance(value, str):
        return None
    match = _UNIT_PATTERN.match(value.strip())
    if not match:
        return None
    number, unit = match.groups()
    try:
        magnitude = float(number)
    except ValueError:
        return None
    if not (magnitude == magnitude) or magnitude in (float("inf"), float("-inf")):
        # NaN/inf can't come from the regex-matched digits themselves, but
        # guard anyway rather than ever letting a non-finite number reach
        # analytics.json (json.dumps would emit invalid "NaN"/"Infinity").
        return None
    result = magnitude * _UNIT_FACTORS.get(unit.upper(), 1)
    # Test Engineer finding (Milestone 28): the guard above only checked
    # `magnitude` -- an extreme but individually-finite numeral (e.g.
    # ~2e295) can still overflow a double once multiplied by the P
    # (1e15) factor, producing float('inf') despite passing that first
    # check. json.dumps would then emit the non-standard "Infinity"
    # token, which a strict/browser JSON.parse (analytics.json's only
    # real consumer) rejects outright. Check the actual return value,
    # not just the input, so this can never slip through regardless of
    # which side of the multiplication overflowed.
    if not (result == result) or result in (float("inf"), float("-inf")):
        return None
    return result


def _read_pool_status(path):
    """pool.status's three lines are independent JSON objects -- read
    every line, use whichever one actually carries hashrate1m (today
    that's the second line, but this doesn't assume a fixed line
    position)."""
    try:
        with open(path, "r") as f:
            lines = f.readlines()
    except (OSError, UnicodeDecodeError):
        # Test Engineer finding (Blocking, Milestone 28): this only
        # caught OSError, unlike _read_user_file's identical read below,
        # which already caught UnicodeDecodeError too. A torn/racy write
        # from ckpoold (this file is live-rewritten, not append-only)
        # leaving invalid UTF-8 mid multi-byte sequence raised
        # uncaught, aborting the entire analytics_builder.py run --
        # directly contradicting this module's own "must never fail the
        # whole build" contract. Now consistent with _read_user_file.
        return dict(_EMPTY_HASHRATES)

    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict) or "hashrate1m" not in obj:
            continue
        return {
            "hashrate_1m": _parse_hashrate_string(obj.get("hashrate1m")),
            "hashrate_24h": _parse_hashrate_string(obj.get("hashrate1d")),
        }
    return dict(_EMPTY_HASHRATES)


def _read_user_file(path):
    """Returns (user_hashrates, worker_hashrates) -- worker_hashrates is
    {workername: {...}} for every entry in this user's own "worker" array
    (each already carries its own full "<address>.<label>" workername,
    matching analytics.json's own convention exactly -- no key-mapping
    needed)."""
    try:
        with open(path, "r") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return dict(_EMPTY_HASHRATES), {}

    if not isinstance(data, dict):
        return dict(_EMPTY_HASHRATES), {}

    user_hashrates = {
        "hashrate_1m": _parse_hashrate_string(data.get("hashrate1m")),
        "hashrate_24h": _parse_hashrate_string(data.get("hashrate1d")),
    }

    worker_hashrates = {}
    workers = data.get("worker")
    if isinstance(workers, list):
        for entry in workers:
            if not isinstance(entry, dict):
                continue
            workername = entry.get("workername")
            if not isinstance(workername, str) or not workername:
                continue
            worker_hashrates[workername] = {
                "hashrate_1m": _parse_hashrate_string(entry.get("hashrate1m")),
                "hashrate_24h": _parse_hashrate_string(entry.get("hashrate1d")),
            }

    return user_hashrates, worker_hashrates


def read_native_hashrates(logs_dir):
    """Pure(-ish) filesystem read: returns
    {"pool": {...}, "users": {username: {...}}, "workers": {workername: {...}}}.
    Every leaf is {"hashrate_1m": float|None, "hashrate_24h": float|None}.
    A logs_dir with no pool/users native files at all (e.g. a fresh test
    fixture) yields an all-None pool entry and empty users/workers dicts,
    never raises."""
    pool = _read_pool_status(os.path.join(logs_dir, "pool", "pool.status"))

    users = {}
    workers = {}
    users_dir = os.path.join(logs_dir, "users")
    try:
        filenames = sorted(os.listdir(users_dir))
    except OSError:
        filenames = []

    for filename in filenames:
        path = os.path.join(users_dir, filename)
        if not os.path.isfile(path):
            continue
        user_hashrates, worker_hashrates = _read_user_file(path)
        users[filename] = user_hashrates
        # Test Engineer finding (Minor, accepted as-is): `workers` is one
        # flat namespace across every user file, keyed only by
        # workername -- if two different files ever claimed the same
        # workername, the one processed last (sorted filename order)
        # would silently win with no diagnostic. Not reachable under
        # normal CKPool operation (workername is conventionally
        # "<owning-address>.<label>", so a genuine cross-user collision
        # on the literal string shouldn't occur), and not worth a
        # collision-detection mechanism for a scenario this improbable --
        # documented here rather than silently left unmentioned.
        workers.update(worker_hashrates)

    return {"pool": pool, "users": users, "workers": workers}


def _load_network_diff_state(state_path):
    try:
        with open(state_path, "r") as f:
            state = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"offset": 0, "network_diff": None}
    if not isinstance(state, dict):
        return {"offset": 0, "network_diff": None}
    offset = state.get("offset")
    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
        offset = 0
    network_diff = state.get("network_diff")
    if network_diff is not None and (not isinstance(network_diff, (int, float)) or isinstance(network_diff, bool)):
        network_diff = None
    return {"offset": offset, "network_diff": network_diff}


def _save_network_diff_state(state_path, state):
    directory = os.path.dirname(state_path) or "."
    fd, tmp_path = tempfile.mkstemp(prefix=".network_diff_state.", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(state, f)
        os.chmod(tmp_path, 0o644)
        os.replace(tmp_path, state_path)
    except BaseException:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise


def read_network_difficulty(logs_dir, state_path=NETWORK_DIFF_STATE_PATH):
    """Reads CKPool's own native network-difficulty log lines
    incrementally -- tracks a byte offset across runs (the same idiom
    histogram_builder.py uses for sharelogs, applied here to ckpool.log,
    which is tens of MB and only ever grows) so this never re-scans the
    whole file on every 5-minute run. Only bytes appended since the last
    run are searched; if none contain the pattern (the overwhelmingly
    common case, since network difficulty changes roughly every ~2
    weeks), the previously cached value is returned unchanged. A file
    that shrank since last check (rotation/truncation) resets the offset
    and rescans the new file from its start.

    Deliberately simpler than histogram_builder.py's sharelog tracking
    (no fingerprint/consistency re-verification): a momentary read race
    on this specific, rare, single-line log message has low real-world
    consequence (the cached value just stays correct until the next
    change, at most one analytics cycle later in the ordinary case) --
    not the same correctness bar as never losing/double-counting an
    individual solved share."""
    log_path = os.path.join(logs_dir, "ckpool.log")

    try:
        current_size = os.path.getsize(log_path)
    except OSError:
        return None

    state = _load_network_diff_state(state_path)
    offset = state["offset"]
    value = state["network_diff"]

    if current_size < offset:
        offset = 0
        value = None

    try:
        with open(log_path, "rb") as f:
            f.seek(offset)
            new_bytes = f.read()
    except OSError:
        return value

    # Only advance past confirmed complete lines -- a trailing partial
    # line (this run landed mid-write) is left for a future run to
    # re-read in full, matching this project's established incremental-
    # read discipline (histogram_builder.py's/analytics_state.py's own
    # _read_new_lines).
    last_newline = new_bytes.rfind(b"\n")
    if last_newline == -1:
        new_offset = offset
        new_text = ""
    else:
        new_offset = offset + last_newline + 1
        new_text = new_bytes[: last_newline + 1].decode("utf-8", errors="replace")

    for match in NETWORK_DIFF_PATTERN.finditer(new_text):
        try:
            candidate = float(match.group(1))
        except ValueError:
            continue
        # Same non-finite guard as _parse_hashrate_string's own (Test
        # Engineer finding, Milestone 28) -- NETWORK_DIFF_PATTERN's
        # [\d.]+ can't itself produce "inf"/"nan" text, but an
        # arbitrarily long/adversarial digit string can still overflow
        # float() to inf with no exception raised. json.dump would then
        # emit the non-standard "Infinity" token, which a strict/browser
        # JSON.parse (analytics.json's only real consumer) rejects
        # outright -- so a non-finite parse is discarded here, keeping
        # whatever value was already cached, rather than ever reaching
        # analytics.json.
        if not (candidate == candidate) or candidate in (float("inf"), float("-inf")):
            continue
        value = candidate

    try:
        _save_network_diff_state(state_path, {"offset": new_offset, "network_diff": value})
    except OSError:
        pass  # best-effort persistence -- a future run will just re-scan a bit more

    return value
