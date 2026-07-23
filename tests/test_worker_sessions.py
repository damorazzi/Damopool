#!/usr/bin/env python3
"""
Regression suite for worker_sessions.py (Phase E Milestone 31: Worker
Session Accepted/Rejected Counts).

Uses only synthetic fixture data written to tempfile.mkdtemp() sandboxes.
Never touches /home/damopool/ckpool-solo/ckpool/logs or the real
worker_sessions.state.json.

Run with:
    python3 -m unittest -v tests.test_worker_sessions
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


def cd(epoch_seconds, nanos=0):
    return f"{epoch_seconds},{nanos}"


def share(workername="alice.rig1", enonce1="e1", clientid=1, result=True, createdate=None):
    return {"workername": workername, "enonce1": enonce1, "clientid": clientid, "result": result, "createdate": createdate}


class TempLogDirMixin:
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_wsess_")
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
# 1. Basic session detection
# ---------------------------------------------------------------------------
class TestBasicSessionDetection(TempLogDirMixin, unittest.TestCase):
    def test_single_connection_worker_accumulates_one_session(self):
        self.write_share_lines("a.sharelog", [
            share(createdate=cd(1700000000)),
            share(createdate=cd(1700000010), result=True),
            share(createdate=cd(1700000020), result=False),
        ])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(result["alice.rig1"]["session_accepted_count"], 2)
        self.assertEqual(result["alice.rig1"]["session_rejected_count"], 1)
        self.assertEqual(
            result["alice.rig1"]["session_started_at"],
            datetime.fromtimestamp(1700000000, tz=timezone.utc).isoformat(),
        )

    def test_a_worker_with_no_shares_at_all_is_absent_not_a_crash(self):
        self.write_share_lines("a.sharelog", [])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(result, {})


# ---------------------------------------------------------------------------
# 2. The core amendment scenario: recycled clientid, distinguished by enonce1
# ---------------------------------------------------------------------------
class TestRecycledClientidDistinguishedByEnonce1(TempLogDirMixin, unittest.TestCase):
    def test_same_clientid_reused_with_a_different_enonce1_is_a_new_session(self):
        self.write_share_lines("a.sharelog", [
            share(enonce1="X", clientid=7, result=True, createdate=cd(1700000000)),
            share(enonce1="X", clientid=7, result=True, createdate=cd(1700000010)),
            share(enonce1="Y", clientid=49, result=True, createdate=cd(1700001000)),
            share(enonce1="Y", clientid=49, result=False, createdate=cd(1700001010)),
            # clientid recycled back to 7, but a genuinely NEW connection (different enonce1)
            share(enonce1="Z", clientid=7, result=True, createdate=cd(1700002000)),
        ])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        # The current session must be enonce1=Z's own, NOT merged with enonce1=X's
        # earlier clientid=7 session.
        self.assertEqual(result["alice.rig1"]["session_accepted_count"], 1)
        self.assertEqual(result["alice.rig1"]["session_rejected_count"], 0)
        self.assertEqual(
            result["alice.rig1"]["session_started_at"],
            datetime.fromtimestamp(1700002000, tz=timezone.utc).isoformat(),
        )

    def test_clientid_shared_across_different_workernames_never_cross_contaminates(self):
        # The real production case that falsified clientid-only keying:
        # clientid=7 reused by entirely different workernames.
        self.write_share_lines("a.sharelog", [
            share(workername="alice.rig1", enonce1="A1", clientid=7, createdate=cd(1700000000)),
            share(workername="bob.rig1", enonce1="B1", clientid=7, createdate=cd(1700010000)),
        ])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(result["alice.rig1"]["session_accepted_count"], 1)
        self.assertEqual(result["bob.rig1"]["session_accepted_count"], 1)


# ---------------------------------------------------------------------------
# 3. Several concurrent enonce1s interleaving under one workername
# ---------------------------------------------------------------------------
class TestConcurrentConnections(TempLogDirMixin, unittest.TestCase):
    def test_interleaved_concurrent_connections_are_tracked_independently(self):
        self.write_share_lines("a.sharelog", [
            share(enonce1="P", clientid=82, createdate=cd(1700000001)),
            share(enonce1="Q", clientid=83, createdate=cd(1700000002)),
            share(enonce1="P", clientid=82, createdate=cd(1700000003)),
            share(enonce1="Q", clientid=83, createdate=cd(1700000004)),
            share(enonce1="P", clientid=82, createdate=cd(1700000005)),
        ])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        # "Current" is whichever key's own last share is most recent -- here P
        # (last seen at 1700000005), unaffected by Q's interleaved shares.
        self.assertEqual(result["alice.rig1"]["session_accepted_count"], 3)
        self.assertEqual(
            result["alice.rig1"]["session_started_at"],
            datetime.fromtimestamp(1700000001, tz=timezone.utc).isoformat(),
        )

    def test_a_concurrent_client_going_quiet_then_resubmitting_continues_not_resets(self):
        self.write_share_lines("a.sharelog", [
            share(enonce1="P", clientid=82, createdate=cd(1700000000)),
        ])
        ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        # A long quiet gap (no inactivity timeout exists -- must not reset).
        self.append_share_lines(
            os.path.join(self.tmpdir, "a.sharelog"),
            [share(enonce1="P", clientid=82, createdate=cd(1700000000 + 10 * 24 * 3600))],
        )
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(result["alice.rig1"]["session_accepted_count"], 2)
        self.assertEqual(
            result["alice.rig1"]["session_started_at"],
            datetime.fromtimestamp(1700000000, tz=timezone.utc).isoformat(),
            "session_started_at must not move just because of a long quiet gap",
        )


# ---------------------------------------------------------------------------
# 4. Incremental processing across runs/restarts
# ---------------------------------------------------------------------------
class TestIncrementalAcrossRuns(TempLogDirMixin, unittest.TestCase):
    def test_new_shares_appended_between_runs_are_picked_up_correctly(self):
        path = self.write_share_lines("a.sharelog", [share(createdate=cd(1700000000))])
        r1 = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(r1["alice.rig1"]["session_accepted_count"], 1)

        self.append_share_lines(path, [share(createdate=cd(1700000010))])
        r2 = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(r2["alice.rig1"]["session_accepted_count"], 2)

    def test_a_new_connection_appearing_in_a_later_run_correctly_starts_a_new_session(self):
        path = self.write_share_lines("a.sharelog", [share(enonce1="X", clientid=7, createdate=cd(1700000000))])
        ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

        self.append_share_lines(path, [share(enonce1="Y", clientid=49, createdate=cd(1700001000))])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(
            result["alice.rig1"]["session_started_at"],
            datetime.fromtimestamp(1700001000, tz=timezone.utc).isoformat(),
        )

    def test_a_no_op_run_with_no_new_lines_does_not_rewrite_state(self):
        self.write_share_lines("a.sharelog", [share(createdate=cd(1700000000))])
        ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        inode1 = os.stat(self.state_path).st_ino
        ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        inode2 = os.stat(self.state_path).st_ino
        self.assertEqual(inode1, inode2)


# ---------------------------------------------------------------------------
# 5. First-run full-history replay
# ---------------------------------------------------------------------------
class TestFirstRunFullHistoryReplay(TempLogDirMixin, unittest.TestCase):
    def test_first_run_replays_full_history_in_chronological_order_across_files(self):
        # Two files, each containing shares out of "arrival order" relative
        # to each other -- must be globally sorted per workername before
        # replay, not processed file-by-file independently.
        self.write_share_lines("z_last.sharelog", [
            share(enonce1="Y", clientid=49, createdate=cd(1700001000)),
        ])
        self.write_share_lines("a_first.sharelog", [
            share(enonce1="X", clientid=7, createdate=cd(1700000000)),
        ])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        # The chronologically-later share (in z_last.sharelog) must win as
        # "current", regardless of file iteration/glob order.
        self.assertEqual(
            result["alice.rig1"]["session_started_at"],
            datetime.fromtimestamp(1700001000, tz=timezone.utc).isoformat(),
        )

    def test_multiple_historical_reconnects_are_all_correctly_separated_on_first_run(self):
        self.write_share_lines("a.sharelog", [
            share(enonce1="X", clientid=7, result=True, createdate=cd(1700000000)),
            share(enonce1="Y", clientid=49, result=True, createdate=cd(1700001000)),
            share(enonce1="Z", clientid=7, result=True, createdate=cd(1700002000)),
            share(enonce1="Z", clientid=7, result=False, createdate=cd(1700002010)),
        ])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(result["alice.rig1"]["session_accepted_count"], 1)
        self.assertEqual(result["alice.rig1"]["session_rejected_count"], 1)


# ---------------------------------------------------------------------------
# 6. Malformed/invalid share handling
# ---------------------------------------------------------------------------
class TestMalformedShareHandling(TempLogDirMixin, unittest.TestCase):
    def test_missing_workername_is_excluded(self):
        self.write_share_lines("a.sharelog", [share(workername=None, createdate=cd(1700000000))])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(result, {})

    def test_missing_enonce1_is_excluded(self):
        self.write_share_lines("a.sharelog", [share(enonce1=None, createdate=cd(1700000000))])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(result, {})

    def test_empty_string_enonce1_is_excluded(self):
        self.write_share_lines("a.sharelog", [share(enonce1="", createdate=cd(1700000000))])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(result, {})

    def test_malformed_createdate_is_excluded(self):
        self.write_share_lines("a.sharelog", [share(createdate="garbage")])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(result, {})

    def test_missing_createdate_is_excluded(self):
        self.write_share_lines("a.sharelog", [share(createdate=None)])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(result, {})

    def test_invalid_result_still_establishes_and_continues_a_session_but_counts_toward_neither(self):
        self.write_share_lines("a.sharelog", [
            share(result="not-a-bool", createdate=cd(1700000000)),
            share(result=True, createdate=cd(1700000010)),
        ])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(result["alice.rig1"]["session_accepted_count"], 1)
        self.assertEqual(result["alice.rig1"]["session_rejected_count"], 0)
        # session_started_at reflects the FIRST share (even though its
        # result was invalid) since it still proves the connection existed.
        self.assertEqual(
            result["alice.rig1"]["session_started_at"],
            datetime.fromtimestamp(1700000000, tz=timezone.utc).isoformat(),
        )

    def test_missing_or_invalid_clientid_does_not_block_session_tracking(self):
        self.write_share_lines("a.sharelog", [share(clientid=None, createdate=cd(1700000000))])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(result["alice.rig1"]["session_accepted_count"], 1)

    def test_bool_clientid_is_treated_as_invalid_not_a_real_clientid(self):
        self.write_share_lines("a.sharelog", [share(clientid=True, createdate=cd(1700000000))])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        # Still tracks the session (clientid is display-only, not the key).
        self.assertEqual(result["alice.rig1"]["session_accepted_count"], 1)

    def test_malformed_json_line_is_skipped_not_a_crash(self):
        path = os.path.join(self.tmpdir, "a.sharelog")
        with open(path, "w") as f:
            f.write("not valid json\n")
            f.write(json.dumps(share(createdate=cd(1700000000))) + "\n")
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(result["alice.rig1"]["session_accepted_count"], 1)

    def test_invalid_utf8_line_is_skipped_not_a_crash(self):
        path = os.path.join(self.tmpdir, "a.sharelog")
        with open(path, "wb") as f:
            f.write(b"\xff\xfe garbage\n")
            f.write((json.dumps(share(createdate=cd(1700000000))) + "\n").encode("utf-8"))
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(result["alice.rig1"]["session_accepted_count"], 1)


# ---------------------------------------------------------------------------
# 7. empty_worker_session fallback
# ---------------------------------------------------------------------------
class TestEmptyWorkerSession(unittest.TestCase):
    def test_shape(self):
        self.assertEqual(ws.empty_worker_session(), {
            "session_accepted_count": 0,
            "session_rejected_count": 0,
            "session_started_at": None,
        })


# ---------------------------------------------------------------------------
# 8. File truncation/rotation
# ---------------------------------------------------------------------------
class TestFileRotation(TempLogDirMixin, unittest.TestCase):
    def test_file_replaced_at_same_path_is_detected_and_rescanned_from_zero(self):
        path = self.write_share_lines("a.sharelog", [share(enonce1="X", createdate=cd(1700000000))])
        ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

        os.remove(path)
        self.write_share_lines("a.sharelog", [share(enonce1="Y", createdate=cd(1700005000))])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        # Both enonce1 X and Y are now known; "current" is Y (most recent).
        self.assertEqual(
            result["alice.rig1"]["session_started_at"],
            datetime.fromtimestamp(1700005000, tz=timezone.utc).isoformat(),
        )

    def test_partial_trailing_line_is_not_consumed_until_completed(self):
        path = os.path.join(self.tmpdir, "a.sharelog")
        with open(path, "w") as f:
            f.write(json.dumps(share(createdate=cd(1700000000))) + "\n")
            # A valid JSON prefix ending mid-value (no trailing newline) --
            # a write-in-progress snapshot, mirroring histogram_builder.py's
            # own equivalent adversarial test.
            f.write('{"workername": "alice.rig1", "enonce1": "e1", "clientid": 1, "result": true, "createdate": "170000001')
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(result["alice.rig1"]["session_accepted_count"], 1, "the partial trailing line must not be counted yet")

        with open(path, "a") as f:
            f.write('0,0"}\n')  # completes createdate to "1700000010,0" and closes the object
        result2 = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(result2["alice.rig1"]["session_accepted_count"], 2)


# ---------------------------------------------------------------------------
# 9. Multiple workers/users
# ---------------------------------------------------------------------------
class TestMultipleWorkers(TempLogDirMixin, unittest.TestCase):
    def test_multiple_workers_each_get_their_own_independent_session(self):
        self.write_share_lines("a.sharelog", [
            share(workername="alice.rig1", enonce1="A1", result=True, createdate=cd(1700000000)),
            share(workername="alice.rig2", enonce1="A2", result=False, createdate=cd(1700000010)),
            share(workername="bob.rig1", enonce1="B1", result=True, createdate=cd(1700000020)),
        ])
        result = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(result["alice.rig1"]["session_accepted_count"], 1)
        self.assertEqual(result["alice.rig2"]["session_rejected_count"], 1)
        self.assertEqual(result["bob.rig1"]["session_accepted_count"], 1)


# ---------------------------------------------------------------------------
# 10. State validation
# ---------------------------------------------------------------------------
class TestStateValidation(TempLogDirMixin, unittest.TestCase):
    def test_corrupted_json_raises_load_error(self):
        with open(self.state_path, "w") as f:
            f.write("{not valid json")
        with self.assertRaises(ws.WorkerSessionsStateLoadError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_non_dict_top_level_raises_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump([1, 2, 3], f)
        with self.assertRaises(ws.WorkerSessionsStateLoadError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_missing_version_raises_version_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"files": {}, "sessions": {}}, f)
        with self.assertRaises(ws.WorkerSessionsStateVersionError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_wrong_version_raises_version_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": 999, "files": {}, "sessions": {}}, f)
        with self.assertRaises(ws.WorkerSessionsStateVersionError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_malformed_fingerprint_raises_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": 1, "files": {"/some/path": {"dev": 1}}, "sessions": {}}, f)
        with self.assertRaises(ws.WorkerSessionsStateLoadError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_session_entry_missing_required_key_raises_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({
                "version": 1, "files": {},
                "sessions": {"alice.rig1": {"e1": {"clientid": None, "accepted": 0, "rejected": 0}}},
            }, f)
        with self.assertRaises(ws.WorkerSessionsStateLoadError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_negative_accepted_count_raises_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({
                "version": 1, "files": {},
                "sessions": {"alice.rig1": {"e1": {
                    "clientid": None, "session_started_at": [1, 0], "last_seen_createdate": [1, 0],
                    "accepted": -1, "rejected": 0,
                }}},
            }, f)
        with self.assertRaises(ws.WorkerSessionsStateLoadError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_malformed_createdate_shape_raises_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({
                "version": 1, "files": {},
                "sessions": {"alice.rig1": {"e1": {
                    "clientid": None, "session_started_at": ["not-a-number", 0], "last_seen_createdate": [1, 0],
                    "accepted": 0, "rejected": 0,
                }}},
            }, f)
        with self.assertRaises(ws.WorkerSessionsStateLoadError):
            ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)

    def test_a_genuinely_valid_state_file_round_trips_correctly(self):
        self.write_share_lines("a.sharelog", [share(createdate=cd(1700000000))])
        r1 = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        # Reload from the persisted file with no new data -- must be stable.
        r2 = ws.build_worker_sessions(self.tmpdir, state_path=self.state_path)
        self.assertEqual(r1, r2)


if __name__ == "__main__":
    unittest.main()
