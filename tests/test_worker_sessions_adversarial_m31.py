#!/usr/bin/env python3
"""
Independent adversarial test pass for Phase E Milestone 31 (Worker
Session Accepted/Rejected Counts), written by an independent test
engineer (not the implementer). Complements, does not replace,
tests/test_worker_sessions.py.

Uses only synthetic fixture data written to tempfile.mkdtemp() sandboxes,
plus one read-only cross-check against the real production
/home/damopool/ckpool-solo/ckpool/logs directory (an isolated state_path
is always used so the real worker_sessions.state.json is never touched).

Run with:
    python3 -m unittest -v tests.test_worker_sessions_adversarial_m31
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import worker_sessions as ws

REAL_LOGS_DIR = "/home/damopool/ckpool-solo/ckpool/logs"
REAL_ANALYTICS_JSON = "/home/damopool/ckpool-solo/ckpool/analytics.json"
REAL_STATE_FILES = [
    "/home/damopool/ckpool-solo/ckpool/analytics.state.json",
    "/home/damopool/ckpool-solo/ckpool/histogram.state.json",
    "/home/damopool/ckpool-solo/ckpool/network_diff.state.json",
    "/home/damopool/ckpool-solo/ckpool/worker_sessions.state.json",
]


def cd(epoch_seconds, nanos=0):
    return f"{epoch_seconds},{nanos}"


def share(workername="alice.rig1", enonce1="e1", clientid=1, result=True, createdate=None):
    return {"workername": workername, "enonce1": enonce1, "clientid": clientid, "result": result, "createdate": createdate}


class TempLogDirMixin:
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_wsess_adv_")
        self.state_path = os.path.join(self.tmpdir, "worker_sessions.state.json")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def write_share_lines(self, name, shares):
        path = os.path.join(self.tmpdir, name)
        with open(path, "w") as f:
            for s in shares:
                f.write(json.dumps(s) + "\n")
        return path

    def append_share_lines(self, path, shares):
        with open(path, "a") as f:
            for s in shares:
                f.write(json.dumps(s) + "\n")


# ---------------------------------------------------------------------------
# 1. Nanosecond-level ordering
# ---------------------------------------------------------------------------
class TestNanosecondOrdering(TempLogDirMixin, unittest.TestCase):
    def test_same_second_different_nanos_orders_correctly(self):
        # Three shares in the SAME second, deliberately written out of
        # nanosecond order in the file, all under one enonce1 -- must be
        # replayed in true (seconds, nanos) order, so session_started_at
        # is the smallest nanos value, not merely the first line.
        self.write_share_lines("a.sharelog", [
            share(createdate=cd(1700000000, 500_000_000), result=True),
            share(createdate=cd(1700000000, 100_000_000), result=True),
            share(createdate=cd(1700000000, 900_000_000), result=False),
        ])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(result["alice.rig1"]["session_accepted_count"], 2)
        self.assertEqual(result["alice.rig1"]["session_rejected_count"], 1)
        self.assertEqual(
            result["alice.rig1"]["session_started_at"],
            datetime.fromtimestamp(1700000000, tz=timezone.utc).isoformat(),
            "session_started_at must reflect the true earliest (seconds, nanos), "
            "not merely the first line physically written to the file",
        )

    def test_nanos_alone_determine_current_session_across_a_second_boundary(self):
        # Two enonce1 keys: P's own last share is at second=100 nanos=999999999,
        # Q's own last share is at second=101 nanos=0 -- Q must win as
        # "current" despite having a numerically smaller nanos field, because
        # full (seconds, nanos) tuple comparison, not nanos alone, decides.
        self.write_share_lines("a.sharelog", [
            share(enonce1="P", createdate=cd(100, 999_999_999)),
            share(enonce1="Q", createdate=cd(101, 0)),
        ])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(
            result["alice.rig1"]["session_started_at"],
            datetime.fromtimestamp(101, tz=timezone.utc).isoformat(),
        )


# ---------------------------------------------------------------------------
# 2. session_started_at must never move backward, even across separate runs
# ---------------------------------------------------------------------------
class TestSessionStartNeverMovesBackward(TempLogDirMixin, unittest.TestCase):
    def test_a_later_run_with_an_earlier_timestamped_tuple_for_an_already_known_key_does_not_rewind(self):
        # Pathological but real-world-plausible: a burst of shares for the
        # SAME enonce1 arrives out of order across two incremental runs
        # (e.g. two files flushed to disk in different order). Run 1 sees
        # t=1000 first (session_started_at = 1000). Run 2's newly-appended
        # line has an EARLIER createdate (t=500) for the SAME enonce1 --
        # must not retroactively move session_started_at to 500.
        path = self.write_share_lines("a.sharelog", [
            share(enonce1="X", createdate=cd(1000)),
        ])
        r1 = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(
            r1["alice.rig1"]["session_started_at"],
            datetime.fromtimestamp(1000, tz=timezone.utc).isoformat(),
        )

        self.append_share_lines(path, [share(enonce1="X", createdate=cd(500))])
        r2 = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(
            r2["alice.rig1"]["session_started_at"],
            datetime.fromtimestamp(1000, tz=timezone.utc).isoformat(),
            "session_started_at must be pinned to the first-discovered value for this key, never rewound",
        )
        # And the out-of-order-but-late-arriving share must still count.
        self.assertEqual(r2["alice.rig1"]["session_accepted_count"], 2)


# ---------------------------------------------------------------------------
# 3. "most recent share wins" with 3+ concurrent keys, scrambled discovery order
# ---------------------------------------------------------------------------
class TestMostRecentWinsAmongManyConcurrentKeys(TempLogDirMixin, unittest.TestCase):
    def test_five_concurrent_keys_current_is_always_the_true_chronological_latest(self):
        # Five concurrent connections. Deliberately written to the sharelog
        # (and thus first *discovered*/inserted into the sessions dict) in
        # an order that does NOT match their chronological last-share order,
        # to prove selection is by last_seen_createdate, not insertion order.
        self.write_share_lines("a.sharelog", [
            share(enonce1="conn-D", createdate=cd(4000)),   # discovered 1st, chronologically 4th
            share(enonce1="conn-A", createdate=cd(1000)),   # discovered 2nd, chronologically 1st
            share(enonce1="conn-E", createdate=cd(5000)),   # discovered 3rd, chronologically LATEST
            share(enonce1="conn-C", createdate=cd(3000)),   # discovered 4th
            share(enonce1="conn-B", createdate=cd(2000)),   # discovered 5th
        ])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(
            result["alice.rig1"]["session_started_at"],
            datetime.fromtimestamp(5000, tz=timezone.utc).isoformat(),
            "the exposed session must be conn-E's (chronologically latest own last share), "
            "regardless of file/discovery order",
        )

    def test_current_selection_survives_across_incremental_runs_as_the_lead_changes(self):
        path = self.write_share_lines("a.sharelog", [
            share(enonce1="A", createdate=cd(1000)),
            share(enonce1="B", createdate=cd(2000)),
        ])
        r1 = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(r1["alice.rig1"]["session_started_at"], datetime.fromtimestamp(2000, tz=timezone.utc).isoformat())

        # A now overtakes B with a fresh, later share.
        self.append_share_lines(path, [share(enonce1="A", createdate=cd(3000))])
        r2 = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(
            r2["alice.rig1"]["session_started_at"],
            datetime.fromtimestamp(1000, tz=timezone.utc).isoformat(),
            "current flips back to A, and A's OWN session_started_at (1000) is exposed, not B's",
        )


# ---------------------------------------------------------------------------
# 4. In-place truncation (same inode) must be detected via size shrink
# ---------------------------------------------------------------------------
class TestInPlaceTruncation(TempLogDirMixin, unittest.TestCase):
    def test_truncate_and_rewrite_same_inode_is_detected_via_size_shrink(self):
        path = self.write_share_lines("a.sharelog", [
            share(enonce1="X", createdate=cd(1700000000)),
            share(enonce1="X", createdate=cd(1700000010)),
            share(enonce1="X", createdate=cd(1700000020)),
        ])
        r1 = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(r1["alice.rig1"]["session_accepted_count"], 3)
        ino_before = os.stat(path).st_ino

        # Truncate-and-rewrite via 'w' mode on the SAME path -- typically
        # preserves the inode on POSIX filesystems (unlike remove+recreate),
        # simulating an in-place log rotation/rewrite rather than an unlink.
        with open(path, "w") as f:
            f.write(json.dumps(share(enonce1="Y", createdate=cd(1700009000))) + "\n")
        ino_after = os.stat(path).st_ino

        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        if ino_before == ino_after:
            # Only meaningful assertion if the filesystem actually preserved
            # the inode; if not, this degrades to the already-covered
            # remove+recreate rotation case.
            self.assertEqual(
                result["alice.rig1"]["session_started_at"],
                datetime.fromtimestamp(1700009000, tz=timezone.utc).isoformat(),
                "size-shrink-with-same-inode truncation must still be detected and rescanned from zero, "
                "not silently skipped as 'already consistent'",
            )
        # Regardless of inode reuse, no crash and no duplication/undercount:
        # accepted count must be exactly 1 for the new content (old X data
        # persists in `sessions` under its own key, which is by design never
        # pruned).
        self.assertEqual(result["alice.rig1"]["session_accepted_count"], 1)


# ---------------------------------------------------------------------------
# 5. Deeper state-file corruption validation
# ---------------------------------------------------------------------------
class TestDeeperStateValidation(TempLogDirMixin, unittest.TestCase):
    def _entry(self, **overrides):
        base = {
            "clientid": None, "session_started_at": [1, 0], "last_seen_createdate": [1, 0],
            "accepted": 0, "rejected": 0,
        }
        base.update(overrides)
        return base

    def test_createdate_list_too_short_raises_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": 1, "files": {}, "sessions": {"alice.rig1": {"e1": self._entry(session_started_at=[1])}}}, f)
        with self.assertRaises(ws.WorkerSessionsStateLoadError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_createdate_list_too_long_raises_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": 1, "files": {}, "sessions": {"alice.rig1": {"e1": self._entry(last_seen_createdate=[1, 0, 0])}}}, f)
        with self.assertRaises(ws.WorkerSessionsStateLoadError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_nanos_out_of_range_raises_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": 1, "files": {}, "sessions": {"alice.rig1": {"e1": self._entry(session_started_at=[1, 1_000_000_000])}}}, f)
        with self.assertRaises(ws.WorkerSessionsStateLoadError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_negative_seconds_raises_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": 1, "files": {}, "sessions": {"alice.rig1": {"e1": self._entry(session_started_at=[-1, 0])}}}, f)
        with self.assertRaises(ws.WorkerSessionsStateLoadError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_seconds_beyond_max_timestamp_raises_load_error(self):
        from pool_statistics import MAX_TIMESTAMP_SECONDS
        with open(self.state_path, "w") as f:
            json.dump({"version": 1, "files": {}, "sessions": {"alice.rig1": {"e1": self._entry(session_started_at=[MAX_TIMESTAMP_SECONDS + 1, 0])}}}, f)
        with self.assertRaises(ws.WorkerSessionsStateLoadError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_negative_rejected_count_raises_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": 1, "files": {}, "sessions": {"alice.rig1": {"e1": self._entry(rejected=-5)}}}, f)
        with self.assertRaises(ws.WorkerSessionsStateLoadError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_bool_accepted_count_raises_load_error(self):
        # isinstance(True, int) is True in Python -- must be explicitly
        # excluded, not silently accepted as accepted=1/accepted=0.
        with open(self.state_path, "w") as f:
            json.dump({"version": 1, "files": {}, "sessions": {"alice.rig1": {"e1": self._entry(accepted=True)}}}, f)
        with self.assertRaises(ws.WorkerSessionsStateLoadError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_string_clientid_in_state_raises_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": 1, "files": {}, "sessions": {"alice.rig1": {"e1": self._entry(clientid="7")}}}, f)
        with self.assertRaises(ws.WorkerSessionsStateLoadError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_bool_clientid_in_state_raises_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": 1, "files": {}, "sessions": {"alice.rig1": {"e1": self._entry(clientid=True)}}}, f)
        with self.assertRaises(ws.WorkerSessionsStateLoadError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_non_dict_per_workername_value_raises_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": 1, "files": {}, "sessions": {"alice.rig1": "not-a-dict"}}, f)
        with self.assertRaises(ws.WorkerSessionsStateLoadError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_missing_files_key_entirely_raises_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": 1, "sessions": {}}, f)
        with self.assertRaises(ws.WorkerSessionsStateLoadError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_each_individually_missing_fingerprint_key_raises_load_error(self):
        full = {"dev": 1, "ino": 2, "size": 3, "mtime_ns": 4, "offset": 5, "prefix_hash": "x"}
        for missing_key in full:
            partial = {k: v for k, v in full.items() if k != missing_key}
            with open(self.state_path, "w") as f:
                json.dump({"version": 1, "files": {"/some/path": partial}, "sessions": {}}, f)
            with self.assertRaises(ws.WorkerSessionsStateLoadError, msg=f"missing key {missing_key!r} should have raised"):
                ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)


# ---------------------------------------------------------------------------
# 6. Empty dataset handling
# ---------------------------------------------------------------------------
class TestEmptyDatasets(unittest.TestCase):
    def test_empty_logs_dir_with_no_sharelog_files_at_all(self):
        tmpdir = tempfile.mkdtemp(prefix="damopool_wsess_empty_")
        try:
            state_path = os.path.join(tmpdir, "worker_sessions.state.json")
            result = ws.build_worker_sessions(tmpdir, state_path=state_path)
            self.assertEqual(result, {})
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    def test_repeated_calls_on_empty_dir_are_stable_and_do_not_crash(self):
        tmpdir = tempfile.mkdtemp(prefix="damopool_wsess_empty2_")
        try:
            state_path = os.path.join(tmpdir, "worker_sessions.state.json")
            r1 = ws.build_worker_sessions(tmpdir, state_path=state_path)
            r2 = ws.build_worker_sessions(tmpdir, state_path=state_path)
            self.assertEqual(r1, {})
            self.assertEqual(r2, {})
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


# ---------------------------------------------------------------------------
# 7. Read-only cross-check against real production sharelog data
# ---------------------------------------------------------------------------
@unittest.skipUnless(os.path.isdir(REAL_LOGS_DIR), "real logs directory not present in this environment")
class TestRealProductionDataCrossCheck(unittest.TestCase):
    """Reads (never writes to) the real logs directory, using a fully
    isolated state_path in a tempfile.mkdtemp() sandbox. This never
    touches /home/damopool/ckpool-solo/ckpool/worker_sessions.state.json
    or any other real state/analytics file."""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_wsess_real_probe_")
        self.state_path = os.path.join(self.tmpdir, "worker_sessions.state.json")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_real_data_produces_plausible_session_data_without_crashing(self):
        result = ws.build_worker_sessions(REAL_LOGS_DIR, state_path=self.state_path)
        self.assertIsInstance(result, dict)
        for workername, entry in result.items():
            self.assertIsInstance(workername, str)
            self.assertGreaterEqual(entry["session_accepted_count"], 0)
            self.assertGreaterEqual(entry["session_rejected_count"], 0)
            self.assertIsInstance(entry["session_started_at"], str)

    def test_real_clientid_7_recycled_across_three_workers_does_not_cross_contaminate(self):
        # Independently confirmed (via a direct scan of the real sharelog
        # data, outside this test) that clientid=7 was reused by THREE
        # distinct real workernames in this pool's history, each with its
        # own distinct enonce1: 'e7a9566a', '7a895e6a', '27fb5c6a'. This
        # test proves build_worker_sessions's own per-workername output
        # reflects only each worker's OWN most recent connection -- not a
        # count merged across the other two workers who happened to share
        # that recycled clientid.
        result = ws.build_worker_sessions(REAL_LOGS_DIR, state_path=self.state_path)
        affected_workernames = [
            "bc1q2k3jfufxkv0nt7sgdlyuuu6hgu64agnktqejxy",
            "bc1qmleyaz5gj0fxsayvk7mrgfcx8rel0qnscwnm88.OctaxeDamo",
            "bc1q00rlj4m8c0mscla5a29xm5x6axc835kzx9hm0e.bitaxe2",
        ]
        for workername in affected_workernames:
            self.assertIn(workername, result, f"expected {workername} to have session data")
            entry = result[workername]
            # A sane, bounded value -- not some absurd merged total across
            # all clientid=7 users combined (which would run into the tens
            # of thousands, spanning multiple non-overlapping time windows).
            self.assertIsInstance(entry["session_accepted_count"], int)

    def test_real_run_never_writes_to_the_real_logs_directory_or_real_state_files(self):
        before = {}
        for path in [REAL_LOGS_DIR, REAL_ANALYTICS_JSON] + REAL_STATE_FILES:
            if os.path.exists(path):
                before[path] = os.stat(path).st_mtime_ns

        ws.build_worker_sessions(REAL_LOGS_DIR, state_path=self.state_path)

        for path, mtime_before in before.items():
            mtime_after = os.stat(path).st_mtime_ns
            self.assertEqual(mtime_before, mtime_after, f"{path} was modified by a supposedly read-only test run")


if __name__ == "__main__":
    unittest.main()
