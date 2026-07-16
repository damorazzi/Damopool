#!/usr/bin/env python3
"""
Regression suite for analytics_state.py (Feature 006 - incremental state
layer), covering the scenarios explicitly required before implementation:
first-run, append, partial-line, truncation, replacement, deletion,
reappearance, and crash-recovery behaviour.

Uses only synthetic fixture data written to tempfile.mkdtemp() sandboxes.
Never touches /home/damopool/ckpool-solo/ckpool/logs or the real
analytics.state.json.
"""
import datetime
import json
import os
import shutil
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import analytics_state as astate
import analytics_builder as ab


def cd(epoch_seconds, nanos=0):
    return f"{epoch_seconds},{nanos}"


def share(username="alice", workername="alice.rig1", agent="cgminer",
          result=True, sdiff=5.0, createdate=None):
    return {"username": username, "workername": workername, "agent": agent,
            "diff": 1, "sdiff": sdiff, "result": result, "createdate": createdate}


class SandboxMixin:
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_astate_")
        self.logs_dir = os.path.join(self.tmpdir, "logs")
        os.makedirs(self.logs_dir)
        self.state_path = os.path.join(self.tmpdir, "analytics.state.json")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def write(self, name, lines, mode="w"):
        path = os.path.join(self.logs_dir, name)
        with open(path, mode) as f:
            for line in lines:
                if isinstance(line, dict):
                    line = json.dumps(line)
                if isinstance(line, str):
                    line = line.encode("utf-8") if "b" in mode else line + "\n"
                f.write(line)
        return path

    def append_raw(self, path, data):
        with open(path, "ab") as f:
            f.write(data)


# ---------------------------------------------------------------------------
# First run
# ---------------------------------------------------------------------------
class TestFirstRun(SandboxMixin, unittest.TestCase):
    def test_no_prior_state_reads_everything(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        path = self.write("a.sharelog", [share(sdiff=5.0, createdate=cd(int(now.timestamp())))])
        state = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        self.assertIn(path, state["files"])
        self.assertEqual(state["files"][path]["fingerprint"]["offset"], os.path.getsize(path))
        merged = astate.merge_state_to_analytics(state, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertEqual(merged["pool"]["accepted_count"], 1)

    def test_empty_logs_dir_no_crash(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        state = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        self.assertEqual(state["files"], {})
        merged = astate.merge_state_to_analytics(state, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertEqual(merged["pool"]["accepted_count"], 0)

    def test_state_file_created_on_disk(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        self.write("a.sharelog", [share(createdate=cd(int(now.timestamp())))])
        astate.update_state(self.logs_dir, now, state_path=self.state_path)
        self.assertTrue(os.path.exists(self.state_path))


# ---------------------------------------------------------------------------
# Append (incremental growth)
# ---------------------------------------------------------------------------
class TestAppend(SandboxMixin, unittest.TestCase):
    def test_only_new_bytes_reprocessed(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        path = self.write("a.sharelog", [share(username="alice", sdiff=5.0, createdate=cd(int(now.timestamp()) - 100))])
        state1 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        offset1 = state1["files"][path]["fingerprint"]["offset"]

        self.append_raw(path, (json.dumps(share(username="bob", sdiff=9.0, createdate=cd(int(now.timestamp()) - 50))) + "\n").encode())
        state2 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        offset2 = state2["files"][path]["fingerprint"]["offset"]
        self.assertGreater(offset2, offset1)

        merged = astate.merge_state_to_analytics(state2, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertEqual(merged["pool"]["accepted_count"], 2)
        self.assertIn("alice", merged["users"])
        self.assertIn("bob", merged["users"])

    def test_fast_path_no_op_run_is_idempotent(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        self.write("a.sharelog", [share(sdiff=5.0, createdate=cd(int(now.timestamp())))])
        state1 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged1 = astate.merge_state_to_analytics(state1, now, now.date(), now.date() - datetime.timedelta(days=1))

        state2 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged2 = astate.merge_state_to_analytics(state2, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertEqual(merged1["pool"]["accepted_count"], merged2["pool"]["accepted_count"])

    def test_append_still_detected_after_a_fast_path_run(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        path = self.write("a.sharelog", [share(sdiff=5.0, createdate=cd(int(now.timestamp())))])
        astate.update_state(self.logs_dir, now, state_path=self.state_path)  # run 1
        astate.update_state(self.logs_dir, now, state_path=self.state_path)  # run 2, fast path (no change)
        self.append_raw(path, (json.dumps(share(sdiff=9.0, createdate=cd(int(now.timestamp())))) + "\n").encode())
        state3 = astate.update_state(self.logs_dir, now, state_path=self.state_path)  # run 3, real append
        merged = astate.merge_state_to_analytics(state3, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertEqual(merged["pool"]["accepted_count"], 2)

    def test_agent_updates_to_latest_across_runs(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        path = self.write("a.sharelog", [share(workername="w1", agent="firmware-v1", createdate=cd(int(now.timestamp())))])
        astate.update_state(self.logs_dir, now, state_path=self.state_path)
        self.append_raw(path, (json.dumps(share(workername="w1", agent="firmware-v2", createdate=cd(int(now.timestamp())))) + "\n").encode())
        state2 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(state2, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertEqual(merged["workers"]["w1"]["agent"], "firmware-v2")


# ---------------------------------------------------------------------------
# Partial-line handling
# ---------------------------------------------------------------------------
class TestPartialLine(SandboxMixin, unittest.TestCase):
    def test_trailing_incomplete_line_not_consumed(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        path = self.write("a.sharelog", [share(sdiff=5.0, createdate=cd(int(now.timestamp())))])
        # Append an incomplete line (no trailing newline).
        self.append_raw(path, b'{"username": "incomplete", "sdiff": 1')
        state = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        offset = state["files"][path]["fingerprint"]["offset"]
        # offset must stop BEFORE the incomplete tail, not at EOF.
        self.assertLess(offset, os.path.getsize(path))
        merged = astate.merge_state_to_analytics(state, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertEqual(merged["pool"]["accepted_count"], 1)

    def test_completed_line_picked_up_next_run_exactly_once(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        path = self.write("a.sharelog", [share(sdiff=5.0, createdate=cd(int(now.timestamp())))])
        self.append_raw(path, json.dumps(share(username="bob", sdiff=8.0, createdate=cd(int(now.timestamp())))).encode())  # no \n yet
        state1 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged1 = astate.merge_state_to_analytics(state1, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertEqual(merged1["pool"]["accepted_count"], 1, "incomplete line must not count yet")

        self.append_raw(path, b"\n")  # complete the line
        state2 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged2 = astate.merge_state_to_analytics(state2, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertEqual(merged2["pool"]["accepted_count"], 2, "completed line must count exactly once")

    def test_multiple_lines_after_partial_all_consumed(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        path = self.write("a.sharelog", [])
        self.append_raw(path, json.dumps(share(username="a", createdate=cd(int(now.timestamp())))).encode() + b"\n")
        self.append_raw(path, json.dumps(share(username="b", createdate=cd(int(now.timestamp())))).encode() + b"\n")
        self.append_raw(path, b'{"partial')  # trailing incomplete
        state = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(state, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertEqual(set(merged["users"].keys()), {"a", "b"})


# ---------------------------------------------------------------------------
# Truncation
# ---------------------------------------------------------------------------
class TestTruncation(SandboxMixin, unittest.TestCase):
    def test_truncation_resets_and_does_not_double_count(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        path = self.write("a.sharelog", [
            share(username="alice", sdiff=5.0, createdate=cd(int(now.timestamp()))),
            share(username="alice", sdiff=6.0, createdate=cd(int(now.timestamp()))),
        ])
        astate.update_state(self.logs_dir, now, state_path=self.state_path)

        time.sleep(0.01)
        with open(path, "w") as f:
            f.write(json.dumps(share(username="carol", sdiff=50.0, createdate=cd(int(now.timestamp())))) + "\n")

        state2 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(state2, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertEqual(merged["pool"]["accepted_count"], 1)
        self.assertNotIn("alice", merged["users"])
        self.assertIn("carol", merged["users"])

    def test_other_files_unaffected_by_one_files_truncation(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        path_a = self.write("a.sharelog", [share(username="alice", sdiff=5.0, createdate=cd(int(now.timestamp())))])
        self.write("b.sharelog", [share(username="bob", sdiff=8.0, createdate=cd(int(now.timestamp())))])
        astate.update_state(self.logs_dir, now, state_path=self.state_path)

        time.sleep(0.01)
        with open(path_a, "w") as f:
            f.write(json.dumps(share(username="carol", sdiff=1.0, createdate=cd(int(now.timestamp())))) + "\n")

        state2 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(state2, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertIn("bob", merged["users"], "file b's contribution must survive file a's truncation")
        self.assertEqual(merged["users"]["bob"]["accepted_count"], 1)


# ---------------------------------------------------------------------------
# Replacement (same/larger size, different content -- the case size/mtime
# alone cannot catch)
# ---------------------------------------------------------------------------
class TestReplacement(SandboxMixin, unittest.TestCase):
    def test_same_size_different_content_detected_via_prefix_hash(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        line_a = json.dumps(share(username="alice", sdiff=5.0, createdate=cd(int(now.timestamp()))))
        line_b = json.dumps(share(username="carol", sdiff=5.0, createdate=cd(int(now.timestamp()))))
        self.assertEqual(len(line_a), len(line_b), "test fixture requires equal-length replacement content")

        path = os.path.join(self.logs_dir, "a.sharelog")
        with open(path, "w") as f:
            f.write(line_a + "\n")
        state1 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        stat1 = os.stat(path)

        # Force identical size AND mtime_ns while swapping content, to prove
        # the prefix-hash check (not size/mtime) is what catches this.
        with open(path, "w") as f:
            f.write(line_b + "\n")
        os.utime(path, ns=(stat1.st_mtime_ns, stat1.st_mtime_ns))
        self.assertEqual(os.path.getsize(path), stat1.st_size)

        state2 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(state2, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertIn("carol", merged["users"])
        self.assertNotIn("alice", merged["users"], "same-size/same-mtime replacement must still be detected via prefix hash")

    def test_dev_ino_change_detected_as_replacement(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        path = os.path.join(self.logs_dir, "a.sharelog")
        with open(path, "w") as f:
            f.write(json.dumps(share(username="alice", createdate=cd(int(now.timestamp())))) + "\n")
        astate.update_state(self.logs_dir, now, state_path=self.state_path)

        os.remove(path)
        time.sleep(0.01)
        with open(path, "w") as f:
            f.write(json.dumps(share(username="dave", createdate=cd(int(now.timestamp())))) + "\n")

        state2 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(state2, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertIn("dave", merged["users"])
        self.assertNotIn("alice", merged["users"])


# ---------------------------------------------------------------------------
# Deletion (historical retention)
# ---------------------------------------------------------------------------
class TestDeletion(SandboxMixin, unittest.TestCase):
    def test_deleted_file_statistics_preserved(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        path = self.write("a.sharelog", [share(username="alice", sdiff=5.0, createdate=cd(int(now.timestamp())))])
        self.write("b.sharelog", [share(username="bob", sdiff=8.0, createdate=cd(int(now.timestamp())))])
        astate.update_state(self.logs_dir, now, state_path=self.state_path)

        os.remove(path)
        state2 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(state2, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertIn("alice", merged["users"], "deleted file's contribution must remain in merged totals")
        self.assertIn("bob", merged["users"])
        self.assertEqual(merged["pool"]["accepted_count"], 2)

    def test_deleted_file_recent_tuples_still_pruned(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        path = self.write("a.sharelog", [share(username="alice", sdiff=5.0, createdate=cd(int(now.timestamp())))])
        astate.update_state(self.logs_dir, now, state_path=self.state_path)
        os.remove(path)

        much_later = now + datetime.timedelta(hours=72)
        state2 = astate.update_state(self.logs_dir, much_later, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(state2, much_later, much_later.date(), much_later.date() - datetime.timedelta(days=1))
        # forever stats survive
        self.assertIn("alice", merged["users"])
        # but the 72h-old share is outside every rolling window now
        for w in ("15m", "1h", "24h"):
            self.assertEqual(merged["pool"]["rolling_windows"][w]["accepted"], 0)


# ---------------------------------------------------------------------------
# Reappearance
# ---------------------------------------------------------------------------
class TestReappearance(SandboxMixin, unittest.TestCase):
    def test_reappearing_identical_file_resumes_incrementally(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        path = self.write("a.sharelog", [share(username="alice", sdiff=5.0, createdate=cd(int(now.timestamp())))])
        state1 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        offset1 = state1["files"][path]["fingerprint"]["offset"]

        # Simulate transient disappearance (e.g. mount hiccup): move away,
        # then move back with byte-identical content and preserved metadata.
        aside = path + ".aside"
        shutil.move(path, aside)
        astate.update_state(self.logs_dir, now, state_path=self.state_path)  # file "gone" this run
        shutil.move(aside, path)

        state3 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        self.assertEqual(state3["files"][path]["fingerprint"]["offset"], offset1)
        merged = astate.merge_state_to_analytics(state3, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertEqual(merged["pool"]["accepted_count"], 1, "must not double count on reappearance")

    def test_reappearing_different_file_at_same_path_is_reset(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        path = self.write("a.sharelog", [share(username="alice", sdiff=5.0, createdate=cd(int(now.timestamp())))])
        astate.update_state(self.logs_dir, now, state_path=self.state_path)

        os.remove(path)
        astate.update_state(self.logs_dir, now, state_path=self.state_path)

        time.sleep(0.01)
        with open(path, "w") as f:
            f.write(json.dumps(share(username="eve", sdiff=1.0, createdate=cd(int(now.timestamp())))) + "\n")

        state3 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(state3, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertIn("eve", merged["users"])
        self.assertNotIn("alice", merged["users"], "a genuinely different file reusing the path must reset, not merge")


# ---------------------------------------------------------------------------
# Crash recovery
# ---------------------------------------------------------------------------
class TestCrashRecovery(SandboxMixin, unittest.TestCase):
    def test_crash_before_state_write_causes_safe_reprocessing_not_loss_or_duplication(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        path = self.write("a.sharelog", [share(username="alice", sdiff=5.0, createdate=cd(int(now.timestamp())))])

        # Simulate a crash: patch save_state to raise, so update_state's
        # atomic write never happens (mirrors an interrupted process).
        original_save = astate.save_state
        astate.save_state = lambda state, path=None: (_ for _ in ()).throw(RuntimeError("simulated crash"))
        try:
            with self.assertRaises(RuntimeError):
                astate.update_state(self.logs_dir, now, state_path=self.state_path)
        finally:
            astate.save_state = original_save

        self.assertFalse(os.path.exists(self.state_path), "no state should have been persisted")

        # Next run must safely reprocess from scratch -- exactly once, not lost, not duplicated.
        state = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(state, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertEqual(merged["pool"]["accepted_count"], 1)

    def test_crash_after_state_write_before_analytics_write_leaves_valid_stale_output(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        self.write("a.sharelog", [share(username="alice", sdiff=5.0, createdate=cd(int(now.timestamp())))])

        analytics_path = os.path.join(self.tmpdir, "analytics.json")
        data1 = ab.build_analytics(logs_dir=self.logs_dir, now=now, state_path=self.state_path)
        ab.write_analytics(data1, analytics_path)

        # State advances (simulating the durable commit), but analytics.json
        # write is simulated as never happening this run.
        path = os.path.join(self.logs_dir, "a.sharelog")
        self.append_raw(path, (json.dumps(share(username="bob", sdiff=9.0, createdate=cd(int(now.timestamp())))) + "\n").encode())
        astate.update_state(self.logs_dir, now, state_path=self.state_path)  # state durably updated
        # (deliberately not writing analytics.json here)

        # Old analytics.json must still be fully valid, just stale.
        with open(analytics_path) as f:
            stale = json.load(f)
        self.assertEqual(stale["pool"]["accepted_count"], 1)

        # Next run recomputes from the already-current state -- no data lost, no reprocessing.
        data3 = ab.build_analytics(logs_dir=self.logs_dir, now=now, state_path=self.state_path)
        self.assertEqual(data3["pool"]["accepted_count"], 2)

    def test_save_state_failure_leaves_no_corrupt_or_partial_file(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        # A set() is not JSON-serializable -- forces json.dump to fail
        # partway through, exercising save_state's own cleanup path.
        with self.assertRaises(TypeError):
            astate.save_state({"bad": {1, 2, 3}}, self.state_path)
        self.assertFalse(os.path.exists(self.state_path))
        # no leftover temp file either
        leftovers = [f for f in os.listdir(self.tmpdir) if f.startswith(".analytics_state.")]
        self.assertEqual(leftovers, [])


# ---------------------------------------------------------------------------
# load_state hardening: a missing state file means first run (fresh empty
# state); anything else that prevents reading a valid, version-matching
# state must raise StateError, never silently fall back to empty, since
# that could discard retained historical statistics for deleted source
# files and/or get overwritten by a subsequent save.
# ---------------------------------------------------------------------------
class TestLoadStateHardening(SandboxMixin, unittest.TestCase):
    def test_missing_file_returns_fresh_empty_state(self):
        state = astate.load_state(self.state_path)
        self.assertEqual(state, {"version": astate.STATE_VERSION, "generation": 0, "files": {}})

    def test_malformed_json_raises_state_load_error_not_silently_empty(self):
        with open(self.state_path, "w") as f:
            f.write("{not valid json")
        with self.assertRaises(astate.StateLoadError):
            astate.load_state(self.state_path)

    def test_valid_json_but_not_an_object_raises_state_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump([1, 2, 3], f)
        with self.assertRaises(astate.StateLoadError):
            astate.load_state(self.state_path)

    def test_missing_files_key_raises_state_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": astate.STATE_VERSION, "generation": 0}, f)
        with self.assertRaises(astate.StateLoadError):
            astate.load_state(self.state_path)

    def test_files_key_wrong_type_raises_state_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": astate.STATE_VERSION, "generation": 0, "files": "nope"}, f)
        with self.assertRaises(astate.StateLoadError):
            astate.load_state(self.state_path)

    def test_malformed_per_file_entry_raises_state_load_error_not_typeerror(self):
        # Independent test-engineer verification pass finding: a
        # well-formed top level with one corrupted per-file entry used to
        # slip past load_state's validation and surface later as a raw,
        # undocumented TypeError deep inside update_state, rather than the
        # promised StateLoadError.
        with open(self.state_path, "w") as f:
            json.dump({"version": astate.STATE_VERSION, "generation": 0,
                       "files": {"/some/path": "not-a-dict-entry"}}, f)
        with self.assertRaises(astate.StateLoadError):
            astate.load_state(self.state_path)

    def test_entry_missing_fingerprint_or_partial_key_raises_state_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": astate.STATE_VERSION, "generation": 0,
                       "files": {"/some/path": {"fingerprint": {}}}}, f)  # missing "partial"
        with self.assertRaises(astate.StateLoadError):
            astate.load_state(self.state_path)

    def test_fingerprint_missing_required_key_raises_state_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": astate.STATE_VERSION, "generation": 0,
                       "files": {"/some/path": {
                           "fingerprint": {"dev": 1, "ino": 2, "size": 3},  # missing mtime_ns/offset/prefix_hash
                           "partial": {},
                       }}}, f)
        with self.assertRaises(astate.StateLoadError):
            astate.load_state(self.state_path)

    def test_malformed_per_file_entry_does_not_crash_update_state_uncontrolled(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        self.write("a.sharelog", [share(createdate=cd(int(now.timestamp())))])
        with open(self.state_path, "w") as f:
            json.dump({"version": astate.STATE_VERSION, "generation": 0,
                       "files": {"/some/path": "not-a-dict-entry"}}, f)
        with self.assertRaises(astate.StateLoadError):
            astate.update_state(self.logs_dir, now, state_path=self.state_path)

    def test_unreadable_file_raises_state_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": astate.STATE_VERSION, "generation": 0, "files": {}}, f)
        os.chmod(self.state_path, 0o000)
        try:
            with self.assertRaises(astate.StateLoadError):
                astate.load_state(self.state_path)
        finally:
            os.chmod(self.state_path, 0o644)  # restore so tearDown can clean up

    def test_file_vanishes_between_exists_check_and_open_raises_not_silently_empty(self):
        import builtins

        with open(self.state_path, "w") as f:
            json.dump({"version": astate.STATE_VERSION, "generation": 0, "files": {}}, f)

        real_open = builtins.open

        def racy_open(path, *a, **kw):
            if path == self.state_path:
                os.remove(path)
            return real_open(path, *a, **kw)

        astate.open = racy_open
        try:
            with self.assertRaises(astate.StateLoadError):
                astate.load_state(self.state_path)
        finally:
            astate.open = real_open

    def test_corrupted_state_is_not_overwritten_by_update_state(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        self.write("a.sharelog", [share(createdate=cd(int(now.timestamp())))])
        with open(self.state_path, "w") as f:
            f.write("corrupted, not valid json at all")

        with self.assertRaises(astate.StateLoadError):
            astate.update_state(self.logs_dir, now, state_path=self.state_path)

        with open(self.state_path) as f:
            self.assertEqual(f.read(), "corrupted, not valid json at all",
                              "a corrupted existing state file must never be overwritten by a failed load")


# ---------------------------------------------------------------------------
# STATE_VERSION enforcement: any mismatch must raise, never migrate
# implicitly, never overwrite the incompatible file.
# ---------------------------------------------------------------------------
class TestStateVersionEnforcement(SandboxMixin, unittest.TestCase):
    def test_missing_version_raises_state_version_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"generation": 0, "files": {}}, f)
        with self.assertRaises(astate.StateVersionError):
            astate.load_state(self.state_path)

    def test_non_integer_version_raises_state_version_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": "1", "generation": 0, "files": {}}, f)
        with self.assertRaises(astate.StateVersionError):
            astate.load_state(self.state_path)

    def test_bool_version_raises_state_version_error(self):
        # bool is an int subclass in Python; must still be rejected.
        with open(self.state_path, "w") as f:
            json.dump({"version": True, "generation": 0, "files": {}}, f)
        with self.assertRaises(astate.StateVersionError):
            astate.load_state(self.state_path)

    def test_older_version_raises_state_version_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": astate.STATE_VERSION - 1, "generation": 0, "files": {}}, f)
        with self.assertRaises(astate.StateVersionError):
            astate.load_state(self.state_path)

    def test_newer_version_raises_state_version_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": astate.STATE_VERSION + 1, "generation": 0, "files": {}}, f)
        with self.assertRaises(astate.StateVersionError):
            astate.load_state(self.state_path)

    def test_matching_version_loads_successfully(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": astate.STATE_VERSION, "generation": 5, "files": {}}, f)
        state = astate.load_state(self.state_path)
        self.assertEqual(state["generation"], 5)

    def test_incompatible_version_file_is_not_overwritten_by_update_state(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        self.write("a.sharelog", [share(createdate=cd(int(now.timestamp())))])
        bad_state = {"version": astate.STATE_VERSION + 1, "generation": 0, "files": {}}
        with open(self.state_path, "w") as f:
            json.dump(bad_state, f)

        with self.assertRaises(astate.StateVersionError):
            astate.update_state(self.logs_dir, now, state_path=self.state_path)

        with open(self.state_path) as f:
            self.assertEqual(json.load(f), bad_state,
                              "an incompatible-version state file must never be overwritten by a failed load")


# ---------------------------------------------------------------------------
# Differential: the incremental merge path must produce the same core
# statistics as the original batch functions (pool_statistics.py/
# user_statistics.py/worker_statistics.py, unmodified) given the same data.
# This is the required proof that "calculation semantics remain unchanged"
# is not just asserted but verified. average_sdiff is compared with a
# tolerance (floating-point summation order differs between per-file
# incremental accumulation and a single-pass batch sum -- inherent,
# harmless, non-associativity of float addition); every other field,
# including percentiles/median/min/max/counts/best-share, must match
# exactly, since those are computed from the SAME merged, sorted list
# either way.
# ---------------------------------------------------------------------------
class TestDifferentialAgainstBatch(SandboxMixin, unittest.TestCase):
    CORE_KEYS = ["accepted_count", "rejected_count", "invalid_result_count", "average_sdiff",
                 "median_sdiff", "min_sdiff", "max_sdiff", "percentiles",
                 "best_share_today", "best_share_ever"]

    @staticmethod
    def _approx_eq(a, b):
        if isinstance(a, float) and isinstance(b, float):
            import math
            return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)
        if isinstance(a, dict) and isinstance(b, dict):
            return set(a.keys()) == set(b.keys()) and all(
                TestDifferentialAgainstBatch._approx_eq(a[k], b[k]) for k in a
            )
        return a == b

    def _assert_matches(self, name, reference, actual, extra_keys=()):
        for key in list(self.CORE_KEYS) + list(extra_keys):
            self.assertTrue(
                self._approx_eq(reference.get(key), actual.get(key)),
                f"{name}.{key} mismatch: batch={reference.get(key)!r} incremental={actual.get(key)!r}",
            )

    def test_incremental_matches_batch_over_randomized_multi_file_multi_run_data(self):
        import random
        import pool_statistics
        import user_statistics
        import worker_statistics
        from parse_share_analytics import find_sharelog_files, parse_sharelog_file

        now = datetime.datetime(2026, 7, 16, 15, 0, 0, tzinfo=datetime.timezone.utc)
        rng = random.Random(20260716)
        usernames = ["alice", "bob", "carol", None, ""]
        workernames = ["rig1", "rig2", "rig3"]
        agents = ["cgminer/1.0", "bosminer/2.0", None]

        def make_share():
            username = rng.choice(usernames)
            workername = f"{username}.{rng.choice(workernames)}" if username else rng.choice(workernames)
            result = rng.choice([True, True, False, None, "bad"])
            sdiff = rng.choice([round(rng.uniform(1, 1000), 4), -5, 0, "bad", None])
            minutes_ago = rng.uniform(0, 60 * 30)
            when = now - datetime.timedelta(minutes=minutes_ago)
            return {"username": username, "workername": workername, "agent": rng.choice(agents),
                    "diff": 1, "sdiff": sdiff, "result": result,
                    "createdate": f"{int(when.timestamp())},{rng.randint(0, 999999999)}"}

        all_shares = [make_share() for _ in range(400)]
        batch1, batch2 = all_shares[:220], all_shares[220:]
        fnames = ["f1.sharelog", "f2.sharelog", "f3.sharelog"]

        def distribute(shares):
            buckets = {name: [] for name in fnames}
            for i, s in enumerate(shares):
                buckets[fnames[i % 3]].append(s)
            return buckets

        for fname, shares in distribute(batch1).items():
            with open(os.path.join(self.logs_dir, fname), "w") as f:
                for s in shares:
                    f.write(json.dumps(s) + "\n")

        astate.update_state(self.logs_dir, now, state_path=self.state_path)
        astate.update_state(self.logs_dir, now, state_path=self.state_path)  # interleaved no-op run

        for fname, shares in distribute(batch2).items():
            with open(os.path.join(self.logs_dir, fname), "a") as f:
                for s in shares:
                    f.write(json.dumps(s) + "\n")

        state = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        today, yesterday = now.date(), now.date() - datetime.timedelta(days=1)
        merged = astate.merge_state_to_analytics(state, now, today, yesterday)

        # Reference must be built from the files in TRUE sorted-path/line
        # order (matching find_sharelog_files), not generation order --
        # order-sensitive fields (agent) are only comparable this way.
        true_order_shares = []
        for path in find_sharelog_files(self.logs_dir):
            true_order_shares.extend(parse_sharelog_file(path))

        ref_pool = pool_statistics.compute_pool_statistics(true_order_shares, today=today)
        ref_users = user_statistics.compute_user_statistics(true_order_shares, today=today)
        ref_workers = worker_statistics.compute_worker_statistics(true_order_shares, today=today, now=now)

        self._assert_matches("pool", ref_pool, merged["pool"])

        for username in set(ref_users) | set(merged["users"]):
            self._assert_matches(f"user:{username}", ref_users.get(username, {}), merged["users"].get(username, {}))

        for workername in set(ref_workers) | set(merged["workers"]):
            self._assert_matches(
                f"worker:{workername}", ref_workers.get(workername, {}), merged["workers"].get(workername, {}),
                extra_keys=("agent", "first_share_at", "last_share_at", "is_active"),
            )

    def test_incremental_matches_batch_and_a_fresh_rebuild_after_truncation_replacement_and_deletion(self):
        """Extends the differential proof across reset behavior specifically
        (Code Reviewer finding: the append-path differential test never
        exercised a reset before its final comparison).

        Three files are put through: A grows normally (a plain append,
        never reset); B is truncated and replaced with entirely different
        content (its old contribution must be fully discarded, not
        merged with the new); C is deleted from disk after run 1 (its
        contribution must be retained under the approved deleted-file
        semantics). The actual incrementally-built state (which lived
        through these reset/deletion events across two runs) is compared
        against TWO independent references built from what the "true"
        final logical dataset should be (A's final content + B's NEW
        content only + C's ORIGINAL pre-deletion content):

        1. pool_statistics.py/user_statistics.py/worker_statistics.py
           (the original, unmodified batch functions) fed that true
           dataset directly -- proves core stats (counts, sdiff stats,
           percentiles, best-share) are correct across reset/deletion.
        2. A FRESH, single-run (no prior incremental history) call to
           update_state()/merge_state_to_analytics() over that same true
           dataset written to a brand-new logs directory -- proves
           rolling_windows/daily_bests/live_ticker (fields the original
           batch functions don't produce, since that logic now lives only
           in the incremental path) are unaffected by having been built
           up through reset/deletion events rather than in one clean pass.
        """
        import pool_statistics
        import user_statistics
        import worker_statistics
        from parse_share_analytics import find_sharelog_files, parse_sharelog_file

        now = datetime.datetime(2026, 7, 16, 15, 0, 0, tzinfo=datetime.timezone.utc)
        today, yesterday = now.date(), now.date() - datetime.timedelta(days=1)
        base = int(now.timestamp()) - 3000

        def s(username, workername, sdiff, ts, result=True):
            return json.dumps(share(username=username, workername=workername, sdiff=sdiff,
                                     result=result, createdate=cd(ts)))

        # --- Run 1: establish A, B, C ---
        path_a = self.write("a_grows.sharelog", [
            s("alice", "alice.r1", 5.0, base + 1),
            s("alice", "alice.r1", 6.0, base + 2),
        ])
        path_b = self.write("b_replaced.sharelog", [
            s("bob", "bob.r1", 50.0, base + 3),
        ])
        path_c = self.write("c_deleted.sharelog", [
            s("carol", "carol.r1", 20.0, base + 4),
            s("carol", "carol.r2", 21.0, base + 5),
        ])
        astate.update_state(self.logs_dir, now, state_path=self.state_path)

        # Capture C's original content BEFORE deleting it -- needed to
        # reconstruct the "true" logical dataset for the reference.
        with open(path_c) as f:
            c_original_content = f.read()

        # --- Mutate: A grows, B is truncated+replaced, C is deleted ---
        self.append_raw(path_a, (s("alice", "alice.r2", 3.0, base + 6) + "\n").encode())

        time.sleep(0.01)
        with open(path_b, "w") as f:
            f.write(s("dave", "dave.r1", 999.0, base + 7) + "\n")  # entirely different content

        os.remove(path_c)

        # --- Run 2: the actual incremental state after these events ---
        state2 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        actual = astate.merge_state_to_analytics(state2, now, today, yesterday)

        # --- Reference dataset: what SHOULD logically be present ---
        # A's current (grown) content + B's NEW content only (old B
        # content must be fully gone) + C's ORIGINAL content (retained
        # despite deletion from disk).
        ref_dir = os.path.join(self.tmpdir, "reference_logs")
        os.makedirs(ref_dir)
        shutil.copy(path_a, os.path.join(ref_dir, "a_grows.sharelog"))
        shutil.copy(path_b, os.path.join(ref_dir, "b_replaced.sharelog"))
        with open(os.path.join(ref_dir, "c_deleted.sharelog"), "w") as f:
            f.write(c_original_content)

        # Reference 1: true batch functions over the true dataset.
        true_order_shares = []
        for path in find_sharelog_files(ref_dir):
            true_order_shares.extend(parse_sharelog_file(path))

        ref_pool = pool_statistics.compute_pool_statistics(true_order_shares, today=today)
        ref_users = user_statistics.compute_user_statistics(true_order_shares, today=today)
        ref_workers = worker_statistics.compute_worker_statistics(true_order_shares, today=today, now=now)

        self._assert_matches("pool (post-reset)", ref_pool, actual["pool"])
        for username in set(ref_users) | set(actual["users"]):
            self._assert_matches(f"user:{username} (post-reset)", ref_users.get(username, {}), actual["users"].get(username, {}))
        for workername in set(ref_workers) | set(actual["workers"]):
            self._assert_matches(
                f"worker:{workername} (post-reset)", ref_workers.get(workername, {}), actual["workers"].get(workername, {}),
                extra_keys=("agent", "first_share_at", "last_share_at", "is_active"),
            )
        # Explicit reset-semantics assertions, not just field equality:
        self.assertNotIn("bob", actual["users"], "b's OLD content must not survive its replacement")
        self.assertIn("dave", actual["users"], "b's NEW content must be present")
        self.assertIn("carol", actual["users"], "c's content must be retained despite deletion from disk")
        self.assertEqual(actual["users"]["alice"]["accepted_count"], 3, "a's grown content must all be present")

        # Reference 2: a fresh, single-run incremental build of the same
        # true dataset, to independently verify rolling_windows/
        # daily_bests/live_ticker (not produced by the batch functions).
        fresh_state_path = os.path.join(self.tmpdir, "fresh.state.json")
        fresh_state = astate.update_state(ref_dir, now, state_path=fresh_state_path)
        fresh = astate.merge_state_to_analytics(fresh_state, now, today, yesterday)

        for scope_key in ("pool",):
            self.assertEqual(
                actual[scope_key]["rolling_windows"], fresh[scope_key]["rolling_windows"],
                f"{scope_key} rolling_windows must be unaffected by having been built through reset/deletion",
            )
        for username in set(fresh["users"]) | set(actual["users"]):
            self.assertEqual(
                actual["users"].get(username, {}).get("rolling_windows"),
                fresh["users"].get(username, {}).get("rolling_windows"),
                f"user:{username} rolling_windows mismatch",
            )
        for workername in set(fresh["workers"]) | set(actual["workers"]):
            self.assertEqual(
                actual["workers"].get(workername, {}).get("rolling_windows"),
                fresh["workers"].get(workername, {}).get("rolling_windows"),
                f"worker:{workername} rolling_windows mismatch",
            )

        self.assertEqual(actual["daily_bests"], fresh["daily_bests"],
                          "daily_bests must be unaffected by having been built through reset/deletion")
        self.assertEqual(actual["live_ticker"], fresh["live_ticker"],
                          "live_ticker must be unaffected by having been built through reset/deletion")


if __name__ == "__main__":
    unittest.main()
