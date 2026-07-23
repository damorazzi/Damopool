#!/usr/bin/env python3
"""Phase E Milestone 31: Worker Session Accepted/Rejected Counts.

Human Approval Brief (2026-07-23) + amendment: each worker's CURRENT
CONNECTION SESSION accepted/rejected share counts, alongside (never
replacing) the existing lifetime accepted_count/rejected_count. A
"session" is the run of shares submitted by one physical connection
instance, reset only when that connection ends and a new one begins --
never on an inactivity timeout (explicitly out of scope per the brief).

Session-boundary signal: `enonce1` (the stratum extranonce1), NOT
`clientid`. Investigation (2026-07-23) found `clientid` -- a small
connector-slot integer CKPool explicitly recycles ("Connector recycling
client N" in ckpool.log) -- gets reused across entirely unrelated
connections, confirmed against real production data (clientid=7 was
reused by three different USERS in three separate, non-overlapping time
windows). `enonce1` never repeated across any of the 42 distinct
connections in this pool's full history: every enonce1 value mapped to
exactly one workername and one clientid, with 100% field coverage
(zero missing/malformed) across all 195k+ real share records checked.
This matches enonce1's actual protocol purpose -- partitioning each
connection's own nonce search space to prevent hash collisions between
concurrently-mining clients, which would be a CKPool protocol bug to
violate, not merely an inconvenience for this feature. `clientid` is
still recorded (for display/debugging) but is never the disambiguating
key.

Disclosed limitation (Human-approved, not silently assumed): there is
no mathematical proof enonce1 can NEVER repeat over an arbitrarily long
pool lifetime, only that it is protocol-designed for uniqueness and has
never repeated once in this pool's entire observed history. If it ever
did, the failure mode is identical to (and far rarer than) naive
clientid-keying's routine failure: a session's counts/session_started_at
would silently continue an unrelated later connection's, rather than
resetting. No inactivity timeout and no ckpool.log dependency exist to
mitigate this, per explicit Human instruction -- disclosed, not solved.

Deliberately a standalone module, independent of analytics_state.py --
same module-separation precedent as histogram_builder.py/
ckpool_native_stats.py/block_progress.py. Unlike those, session
detection is inherently ORDER-DEPENDENT (a session boundary can only be
found by replaying a workername's own shares in true chronological
order), the opposite of analytics_state.py's/histogram_builder.py's own
forever-cumulative, order-INDEPENDENT per-file accumulation (simple
"+=", commutative, safe to merge in any order). This module's state is
therefore NOT split into independent per-file partials merged
afterward -- every run gathers all newly-read share tuples across every
sharelog file touched this run into one in-memory list, sorts that
batch by createdate per workername, and replays it against a single
persistent global per-(workername, enonce1) session dict. Only the
per-file byte-offset/fingerprint bookkeeping (what's "new" since last
run, and truncation/rotation detection) stays genuinely per-file,
mirroring histogram_builder.py's own proven pattern for that part.

First-run full-history replay falls out of this design for free: with
no state file yet, every sharelog file's offset starts at 0, so the
first run naturally replays this pool's ENTIRE history in chronological
order per workername -- correctly separating every historical instance
of clientid reuse by enonce1, not just prospectively. This is the same
"read sharelog bytes an extra time in exchange for genuine module
isolation" tradeoff already explicitly approved for histogram_builder.py,
not a new one-off migration script.

Reuses (read-only, imported) the same validated helpers analytics_state.py/
histogram_builder.py already rely on -- is_valid_result/is_valid_workername/
parse_createdate/createdate_to_utc/MAX_TIMESTAMP_SECONDS -- rather than
reimplementing validation logic that already exists and is already
trusted elsewhere in this project.
"""

import json
import os
import tempfile

from parse_share_analytics import find_sharelog_files
from pool_statistics import MAX_TIMESTAMP_SECONDS, createdate_to_utc, is_valid_result, parse_createdate
from worker_statistics import is_valid_workername

STATE_VERSION = 1
STATE_PATH = "/home/damopool/ckpool-solo/ckpool/worker_sessions.state.json"


class WorkerSessionsStateError(Exception):
    """Base class for worker_sessions.state.json load failures."""


class WorkerSessionsStateLoadError(WorkerSessionsStateError):
    """The state file exists but could not be read, parsed, or is
    structurally invalid -- distinct from "no state file exists" (the
    normal, safe first-run case, which triggers a full historical
    replay per this module's own design, not an error)."""


class WorkerSessionsStateVersionError(WorkerSessionsStateError):
    """The state file's version does not match the running STATE_VERSION.
    No implicit migration is performed."""


def _is_valid_enonce1(value):
    return isinstance(value, str) and value != ""


def _is_valid_clientid(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _is_valid_seconds(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_TIMESTAMP_SECONDS


def _is_valid_nanos(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 999_999_999


# ---------------------------------------------------------------------------
# Per-line parsing (independent equivalent of analytics_state.py's/
# histogram_builder.py's own _parse_line -- deliberately duplicated
# rather than imported, matching histogram_builder.py's own precedent).
# ---------------------------------------------------------------------------

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
        "workername": record.get("workername"),
        "enonce1": record.get("enonce1"),
        "clientid": record.get("clientid"),
        "result": record.get("result"),
        "createdate": record.get("createdate"),
    }


def _tuple_from_share(share):
    """None if this share cannot participate in session tracking at all
    (invalid workername/enonce1/createdate -- can't determine WHO, WHICH
    connection, or WHEN). A share with an invalid `result` (neither True
    nor False) can still establish/continue a session -- it proves the
    connection is alive at that moment -- but contributes to neither
    accepted nor rejected; is_valid_result is checked at replay time, not
    here."""
    workername = share.get("workername")
    enonce1 = share.get("enonce1")
    if not is_valid_workername(workername) or not _is_valid_enonce1(enonce1):
        return None
    createdate = parse_createdate(share.get("createdate"))
    if createdate is None:
        return None
    clientid = share.get("clientid")
    return {
        "workername": workername,
        "enonce1": enonce1,
        "clientid": clientid if _is_valid_clientid(clientid) else None,
        "result": share.get("result"),
        "createdate": createdate,
    }


# ---------------------------------------------------------------------------
# Deep state validation (Milestone 29/30 lesson applied proactively --
# validate every sibling field's VALUE shape, not just key presence, so
# a malformed state file raises a clean WorkerSessionsStateLoadError
# instead of an uncontrolled crash deep in a later run).
# ---------------------------------------------------------------------------

def _validate_session_entry(entry, context):
    if not isinstance(entry, dict):
        raise WorkerSessionsStateLoadError(f"{context} is not a dict")
    for key in ("clientid", "session_started_at", "last_seen_createdate", "accepted", "rejected"):
        if key not in entry:
            raise WorkerSessionsStateLoadError(f"{context} is missing required key {key!r}")
    if entry["clientid"] is not None and not _is_valid_clientid(entry["clientid"]):
        raise WorkerSessionsStateLoadError(f"{context}['clientid'] is malformed: expected null or a non-bool int")
    for date_key in ("session_started_at", "last_seen_createdate"):
        cd = entry[date_key]
        if (
            not isinstance(cd, list)
            or len(cd) != 2
            or not _is_valid_seconds(cd[0])
            or not _is_valid_nanos(cd[1])
        ):
            raise WorkerSessionsStateLoadError(
                f"{context}['{date_key}'] is malformed: expected [seconds, nanos] with "
                f"0 <= seconds <= {MAX_TIMESTAMP_SECONDS} and 0 <= nanos <= 999999999"
            )
    for count_key in ("accepted", "rejected"):
        value = entry[count_key]
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise WorkerSessionsStateLoadError(f"{context}['{count_key}'] is malformed: expected a non-negative int")


def _validate_sessions_state(sessions, context):
    if not isinstance(sessions, dict):
        raise WorkerSessionsStateLoadError(f"{context} is not a dict")
    for workername, keys in sessions.items():
        if not isinstance(keys, dict):
            raise WorkerSessionsStateLoadError(f"{context}[{workername!r}] is not a dict")
        for enonce1, entry in keys.items():
            _validate_session_entry(entry, f"{context}[{workername!r}][{enonce1!r}]")


# ---------------------------------------------------------------------------
# File consistency / incremental read (independent equivalents of
# analytics_state.py's/histogram_builder.py's own fingerprinting).
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
# State load/save (atomic)
# ---------------------------------------------------------------------------

def load_state(path=STATE_PATH):
    if not os.path.exists(path):
        return {"version": STATE_VERSION, "files": {}, "sessions": {}}

    try:
        with open(path, "r", encoding="utf-8") as f:
            raw_state = json.load(f)
    except OSError as exc:
        raise WorkerSessionsStateLoadError(f"could not read state file {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise WorkerSessionsStateLoadError(f"state file {path} contains malformed JSON: {exc}") from exc

    if not isinstance(raw_state, dict) or not isinstance(raw_state.get("files"), dict):
        raise WorkerSessionsStateLoadError(f"state file {path} has an invalid top-level structure")

    fingerprint_keys = ("dev", "ino", "size", "mtime_ns", "offset", "prefix_hash")
    for file_path, fingerprint in raw_state["files"].items():
        if not isinstance(fingerprint, dict) or any(k not in fingerprint for k in fingerprint_keys):
            raise WorkerSessionsStateLoadError(
                f"state file {path} has a malformed fingerprint for {file_path!r}: expected keys {fingerprint_keys}"
            )

    _validate_sessions_state(raw_state.get("sessions", {}), f"state file {path}'s 'sessions'")

    version = raw_state.get("version")
    if not isinstance(version, int) or isinstance(version, bool):
        raise WorkerSessionsStateVersionError(f"state file {path} has a missing or non-integer version: {version!r}")
    if version != STATE_VERSION:
        raise WorkerSessionsStateVersionError(
            f"state file {path} has version {version}, but this code expects version {STATE_VERSION}; "
            "no implicit migration is performed"
        )

    raw_state.setdefault("sessions", {})
    return raw_state


def save_state(state, path=STATE_PATH):
    directory = os.path.dirname(path) or "."
    fd, tmp_path = tempfile.mkstemp(prefix=".worker_sessions_state.", suffix=".tmp", dir=directory)
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
# Per-run update (gather -> global chronological sort per workername ->
# replay against the single persistent sessions dict) + output shaping.
# ---------------------------------------------------------------------------

def _apply_tuple(sessions, tup):
    workername = tup["workername"]
    enonce1 = tup["enonce1"]
    createdate = tup["createdate"]

    keys = sessions.setdefault(workername, {})
    entry = keys.get(enonce1)
    if entry is None:
        # Never-before-seen (workername, enonce1) -- a genuinely new
        # connection instance. Start a fresh session.
        entry = {
            "clientid": tup["clientid"],
            "session_started_at": list(createdate),
            "last_seen_createdate": list(createdate),
            "accepted": 0,
            "rejected": 0,
        }
        keys[enonce1] = entry
    else:
        # Already-known key -- continue it. session_started_at is set
        # once, on first discovery, and never revised afterward (a
        # later-processed tuple that happens to be chronologically
        # earlier than what's already recorded does not retroactively
        # move the session's start -- the key's mere existence already
        # means this session was already known).
        entry["clientid"] = tup["clientid"] if tup["clientid"] is not None else entry["clientid"]
        if tuple(createdate) > tuple(entry["last_seen_createdate"]):
            entry["last_seen_createdate"] = list(createdate)

    if is_valid_result(tup["result"]):
        if tup["result"]:
            entry["accepted"] += 1
        else:
            entry["rejected"] += 1


def update_worker_sessions_state(logs_dir, state_path=STATE_PATH):
    """Reads only new bytes from every currently-present sharelog file,
    gathers every new valid share tuple across ALL of them into one
    batch, groups by workername, sorts each workername's own batch by
    createdate, and replays it against the single persistent global
    `sessions` dict -- then atomically persists and returns the updated
    state. Files no longer present on disk (rotated away) simply keep
    their last-known fingerprint; their historical contribution to
    `sessions` (already folded in on a prior run) is unaffected, since
    `sessions` is not itself decomposed per-file."""
    raw_state = load_state(state_path)
    files_state = raw_state["files"]
    sessions = raw_state["sessions"]
    current_files = set(find_sharelog_files(logs_dir))

    new_tuples_by_workername = {}
    changed = False

    for path in current_files:
        try:
            current_stat = os.stat(path)
        except OSError:
            continue

        stored = files_state.get(path)
        try:
            consistent = stored is not None and _check_consistency(path, current_stat, stored)
            offset = stored["offset"] if consistent else 0
            new_lines, new_offset = _read_new_lines(path, offset)
        except OSError:
            continue

        if consistent and not new_lines:
            continue

        for raw_line in new_lines:
            share = _parse_line(raw_line)
            if share is None:
                continue
            tup = _tuple_from_share(share)
            if tup is None:
                continue
            new_tuples_by_workername.setdefault(tup["workername"], []).append(tup)

        try:
            files_state[path] = _make_fingerprint(path, current_stat, new_offset)
        except OSError:
            continue
        changed = True

    for workername, tuples in new_tuples_by_workername.items():
        tuples.sort(key=lambda t: tuple(t["createdate"]))
        for tup in tuples:
            _apply_tuple(sessions, tup)

    if not changed:
        return raw_state

    new_state = {"version": STATE_VERSION, "files": files_state, "sessions": sessions}
    save_state(new_state, state_path)
    return new_state


def empty_worker_session():
    """The well-formed, all-zero/null fallback for a worker with no
    session data at all (never submitted a share with a valid
    workername+enonce1+createdate) -- never a missing key."""
    return {"session_accepted_count": 0, "session_rejected_count": 0, "session_started_at": None}


def _session_output(entry):
    return {
        "session_accepted_count": entry["accepted"],
        "session_rejected_count": entry["rejected"],
        "session_started_at": createdate_to_utc(tuple(entry["session_started_at"])).isoformat(),
    }


def build_worker_sessions(logs_dir, state_path=STATE_PATH):
    """Top-level entry point analytics_builder.py calls once per run.
    Returns {workername: {"session_accepted_count", "session_rejected_count",
    "session_started_at"}} for every workername with at least one
    recorded session. For a workername with more than one recorded
    (enonce1) key (past reconnects never pruned, forever-retained -- this
    pool's scale doesn't warrant pruning complexity), the exposed single
    "current" session is whichever key's own last_seen_createdate is the
    most recent -- i.e. whichever connection instance most recently
    submitted a share."""
    state = update_worker_sessions_state(logs_dir, state_path=state_path)
    result = {}
    for workername, keys in state["sessions"].items():
        if not keys:
            continue
        current_entry = max(keys.values(), key=lambda e: tuple(e["last_seen_createdate"]))
        result[workername] = _session_output(current_entry)
    return result
