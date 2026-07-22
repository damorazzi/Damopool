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

_UNIT_FACTORS = {"H": 1, "K": 1e3, "M": 1e6, "G": 1e9, "T": 1e12, "P": 1e15}
_UNIT_PATTERN = re.compile(r"^([\d.]+)([A-Za-z]*)$")

_EMPTY_HASHRATES = {"hashrate_1m": None, "hashrate_24h": None}


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
