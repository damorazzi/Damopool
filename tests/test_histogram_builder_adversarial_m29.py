#!/usr/bin/env python3
"""
Independent adversarial test pass for histogram_builder.py (Phase E
Milestone 29), written by an independent test engineer per the review
brief dated 2026-07-22. Targets scenarios NOT already covered by
tests/test_histogram_builder.py: full-pipeline boundary edge cases
(0/negative/NaN/Infinity sdiff, huge sdiff), best-share-ever behavior
under a malformed createdate specifically for the NEW per-bucket
bucket_best tracking, incremental-state correctness under truncated
mid-write / same-path rotation / overlapping multi-file input, and
corrupted histogram.state.json handling (both the shallow structural
checks load_state already performs, and a deeper gap where a
structurally-plausible-but-internally-malformed state file is NOT
caught by load_state at all and silently degrades to an empty
contribution instead of raising any exception).

Uses only synthetic fixture data written to tempfile.mkdtemp() sandboxes.
Never touches /home/damopool/ckpool-solo/ckpool/logs or the real
histogram.state.json.

Run with:
    python3 -m unittest -v tests.test_histogram_builder_adversarial_m29
"""
import json
import os
import shutil
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import histogram_builder as hb


def make_share(username="u1", workername="u1.w1", sdiff=1.5, result=True, createdate="1700000000,123456789"):
    return {
        "username": username,
        "workername": workername,
        "sdiff": sdiff,
        "result": result,
        "createdate": createdate,
    }


def cd(epoch_seconds, nanos=0):
    return f"{epoch_seconds},{nanos}"


class TempLogDirMixin:
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_histadv_")
        self.state_path = os.path.join(self.tmpdir, "histogram.state.json")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def write_share_lines(self, name, shares):
        path = os.path.join(self.tmpdir, name)
        lines = [json.dumps(s) for s in shares]
        with open(path, "wb") as f:
            for line in lines:
                f.write(line.encode("utf-8"))
                f.write(b"\n")
        return path

    def write_raw(self, name, raw_bytes):
        path = os.path.join(self.tmpdir, name)
        with open(path, "wb") as f:
            f.write(raw_bytes)
        return path


# ---------------------------------------------------------------------------
# 1. Full-pipeline boundary edge cases (0 / negative / NaN / Infinity / huge)
# ---------------------------------------------------------------------------
class TestFullPipelineSdiffEdgeCases(TempLogDirMixin, unittest.TestCase):
    def test_sdiff_of_exactly_zero_is_excluded_upstream_via_is_valid_sdiff(self):
        # pool_statistics.is_valid_sdiff requires value > 0 -- confirm a
        # real 0 sdiff share never contributes to any bucket at all
        # (neither bucket 0 nor a crash), consistent with best_share_ever
        # semantics elsewhere in the codebase.
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [
            make_share(sdiff=0, createdate=cd(int(now.timestamp()) - 10)),
        ])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 0)
        self.assertEqual(data["users"], {})
        self.assertEqual(data["workers"], {})

    def test_negative_sdiff_is_excluded_upstream(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [
            make_share(sdiff=-500, createdate=cd(int(now.timestamp()) - 10)),
        ])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 0)

    def test_nan_sdiff_via_real_json_line_is_excluded_not_a_crash(self):
        # Python's json module accepts the non-standard NaN/Infinity
        # literals by default (both json.dumps and json.loads) -- a
        # theoretically-possible malformed sharelog line. Confirm the
        # full pipeline (JSON parse -> is_valid_sdiff -> bucket_index)
        # excludes it cleanly rather than crashing on a NaN comparison.
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int(now.timestamp()) - 10)
        raw = (
            json.dumps({"username": "u1", "workername": "u1.w1", "result": True, "createdate": ts})
            .replace("}", ', "sdiff": NaN}')
            + "\n"
        )
        self.write_raw("a.sharelog", raw.encode("utf-8"))
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 0)

    def test_infinity_sdiff_via_real_json_line_is_excluded_not_a_crash(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int(now.timestamp()) - 10)
        raw = (
            json.dumps({"username": "u1", "workername": "u1.w1", "result": True, "createdate": ts})
            .replace("}", ', "sdiff": Infinity}')
            + "\n"
        )
        self.write_raw("a.sharelog", raw.encode("utf-8"))
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 0)

    def test_extremely_large_sdiff_lands_in_the_open_ended_last_bucket(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [
            make_share(sdiff=1e20, createdate=cd(int(now.timestamp()) - 10)),
        ])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(data["pool"]["total"]["bucket_counts"][11], 1)
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 1)

    def test_sdiff_exactly_on_every_boundary_lands_in_the_higher_bucket_end_to_end(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int(now.timestamp()) - 10)
        shares = [make_share(username=f"u{i}", workername=f"u{i}.w", sdiff=b, createdate=ts)
                  for i, b in enumerate(hb.BUCKET_BOUNDARIES)]
        self.write_share_lines("a.sharelog", shares)
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        counts = data["pool"]["total"]["bucket_counts"]
        # Boundary i (0-indexed) must land in bucket i+1, never bucket i --
        # i.e. bucket 0 stays empty (no share is below the first boundary),
        # and each of buckets 1..11 gets exactly the one boundary-valued
        # share that pushed up into it.
        self.assertEqual(counts[0], 0, "bucket 0 must be empty -- every share used here IS a boundary value")
        self.assertEqual(sum(counts), len(hb.BUCKET_BOUNDARIES), "every boundary-valued share must be counted exactly once")
        for i in range(len(hb.BUCKET_BOUNDARIES)):
            self.assertEqual(counts[i + 1], 1, f"bucket {i+1} must hold the boundary-{i} share")


# ---------------------------------------------------------------------------
# 2. best_share_ever (bucket_best) behavior under a malformed createdate --
#    this is NEW terrain: the per-bucket _BestTracker usage introduced by
#    this milestone, distinct from the already-tested per-user/per-worker
#    best_share_ever paths in pool_statistics.py/user_statistics.py.
# ---------------------------------------------------------------------------
class TestBucketBestUnderMalformedCreatedate(TempLogDirMixin, unittest.TestCase):
    def test_malformed_createdate_share_still_counts_and_can_still_be_bucket_best_with_unknown_timestamp(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="alice.rig1", sdiff=42.0, createdate="garbage"),
        ])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        best = data["pool"]["total"]["bucket_best"][0]
        self.assertIsNotNone(best)
        self.assertEqual(best["sdiff"], 42.0)
        self.assertEqual(best["timestamp"], "unknown")

    def test_malformed_createdate_bucket_best_is_excluded_from_1d_but_present_in_total(self):
        # A share with an unparseable createdate can never be placed in
        # the recent_tuples buffer (createdate is None), so it can never
        # appear in the "1d" reconstruction at all -- matching the
        # existing best_share_today/best_share_ever asymmetry already
        # established elsewhere in this codebase.
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="alice.rig1", sdiff=42.0, createdate="not-a-createdate"),
        ])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["1d"]["bucket_counts"]), 0)
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 1)
        self.assertIsNone(data["pool"]["1d"]["bucket_best"][0])
        self.assertIsNotNone(data["pool"]["total"]["bucket_best"][0])

    def test_out_of_range_createdate_seconds_behaves_the_same_as_unparseable(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="alice.rig1", sdiff=42.0,
                       createdate="99999999999999999,0"),
        ])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["1d"]["bucket_counts"]), 0)
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 1)
        self.assertEqual(data["pool"]["total"]["bucket_best"][0]["timestamp"], "unknown")

    def test_a_later_share_with_a_valid_timestamp_displaces_an_exact_sdiff_tie_with_unknown_timestamp(self):
        """Documents inherited _BestTracker tie-break behavior (from
        pool_statistics.py, reused read-only here): once the incumbent
        best in a bucket has createdate=None ("unknown"), ANY later
        exact-sdiff tie with a valid, parseable createdate unconditionally
        displaces it -- the "earliest timestamp wins a tie" rule can only
        ever compare two KNOWN timestamps; a None incumbent always loses.
        This is pre-existing, already-relied-upon behavior of the reused
        _BestTracker class, not something new introduced by this
        milestone -- documented here as regression coverage for this
        module's own NEW bucket-scoped usage of it."""
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int(now.timestamp()) - 10)
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="alice.rig1", sdiff=42.0, createdate="garbage"),
            make_share(username="bob", workername="bob.rig1", sdiff=42.0, createdate=ts),
        ])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        best = data["pool"]["total"]["bucket_best"][0]
        self.assertEqual(best["username"], "bob")
        self.assertNotEqual(best["timestamp"], "unknown")


# ---------------------------------------------------------------------------
# 3. Incremental state correctness under adversarial file conditions
# ---------------------------------------------------------------------------
class TestAdversarialIncrementalState(TempLogDirMixin, unittest.TestCase):
    def test_file_truncated_mid_write_leaves_partial_trailing_line_unconsumed(self):
        """A sharelog file caught mid-write (a partial, unterminated final
        line) between two build_histograms() runs must not have that
        partial line's bytes silently discarded -- the next run, once the
        line is completed, must still pick it up in full."""
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int(now.timestamp()) - 60)
        path = self.write_raw(
            "a.sharelog",
            (json.dumps(make_share(username="alice", workername="alice.rig1", sdiff=500, createdate=ts)) + "\n").encode(),
        )
        # Simulate a write-in-progress: append a partial, unterminated line.
        with open(path, "ab") as f:
            f.write(b'{"username": "bob", "workername": "bob.rig1", "sdiff": 999')

        data1 = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data1["pool"]["total"]["bucket_counts"]), 1, "the partial trailing line must not be counted yet")
        self.assertNotIn("bob", data1["users"])

        # A second run with STILL no new complete lines must not
        # re-process or lose anything (idempotent no-op).
        data1b = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data1b["pool"]["total"]["bucket_counts"]), 1)

        # Now the write completes -- the previously-partial line must be
        # read in full, not permanently skipped.
        with open(path, "ab") as f:
            f.write((
                ', "result": true, "createdate": "' + ts.split(",", 1)[0] + ',' + ts.split(",", 1)[1] + '"}\n'
            ).encode())
        data2 = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data2["pool"]["total"]["bucket_counts"]), 2)
        self.assertIn("bob", data2["users"])

    def test_no_op_run_never_rewrites_state_file_when_only_an_incomplete_trailing_line_persists(self):
        """Mirrors the already-fixed analytics_state.py defect (a
        permanently-incomplete trailing line forcing a state rewrite on
        every single run forever) -- confirms histogram_builder.py does
        NOT have the same regression: build_histograms() run repeatedly
        against a file whose only "new" bytes are a persistent, never-
        completed trailing line must not rewrite histogram.state.json on
        every run."""
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        path = self.write_raw(
            "a.sharelog",
            (json.dumps(make_share(createdate=cd(int(now.timestamp()) - 60))) + "\n").encode(),
        )
        with open(path, "ab") as f:
            f.write(b'{"partial_line_that_never_completes"')

        hb.build_histograms(self.tmpdir, now, state_path=self.state_path)  # baseline
        inodes = []
        for _ in range(3):
            hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
            inodes.append(os.stat(self.state_path).st_ino)
        self.assertEqual(len(set(inodes)), 1,
                          f"state file was rewritten every run ({inodes}) despite no committed change")

    def test_sharelog_file_replaced_at_the_same_path_with_different_content_is_detected_as_inconsistent(self):
        """A sharelog file rotated/replaced in place (same path, new
        inode/content -- e.g. a copy-truncate style rotation) must be
        detected via the dev/ino fingerprint check and re-read fresh from
        offset 0, rather than misapplying the old byte offset to
        unrelated new content.

        NOTE (finding for the lead, not a code fix attempted here): the
        forever-cumulative "Total" bucket counts already contributed by
        the OLD file (under its old inode, at this same path) are
        silently discarded when this happens -- there is no mechanism to
        preserve a since-rotated-away file's historical contribution once
        a *new* file reappears at the identical path. This is the same
        tradeoff analytics_state.py's own fingerprinting already accepts
        (a new inode is indistinguishable from "this path's old content
        was replaced" vs "this is a brand new, previously-never-seen
        file"), and is very likely not reachable given the real
        production /logs layout (ckpool writes one distinctly-named
        *.sharelog file per client/session inside numbered directories,
        never truncating/replacing an existing file in place) -- but it
        is a real, demonstrable behavior worth flagging explicitly since
        Milestone 29's docstring markets "Total" as literally
        forever-cumulative."""
        now1 = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        path = self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="alice.rig1", sdiff=500,
                       createdate=cd(int(now1.timestamp()) - 1000)),
        ])
        data1 = hb.build_histograms(self.tmpdir, now1, state_path=self.state_path)
        self.assertEqual(sum(data1["pool"]["total"]["bucket_counts"]), 1)
        self.assertIn("alice", data1["users"])

        # Replace the file at the SAME path with unrelated new content
        # (os.remove + re-create guarantees a new inode on virtually
        # every real filesystem, simulating copy-truncate rotation).
        os.remove(path)
        time.sleep(0.01)
        now2 = now1 + timedelta(minutes=5)
        self.write_share_lines("a.sharelog", [
            make_share(username="carol", workername="carol.rig1", sdiff=25000,
                       createdate=cd(int(now2.timestamp()) - 10)),
        ])
        data2 = hb.build_histograms(self.tmpdir, now2, state_path=self.state_path)

        # New content is correctly read.
        self.assertIn("carol", data2["users"])
        # Old content's contribution to "Total" is gone -- confirms the
        # documented gap above rather than silently assuming it survives.
        self.assertNotIn("alice", data2["users"],
                          "documents that a same-path file replacement discards the old file's "
                          "prior forever-cumulative contribution -- see docstring above")

    def test_multiple_sharelog_files_with_disjoint_shares_all_contribute_to_the_same_totals(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int(now.timestamp()) - 60)
        self.write_share_lines("a_first.sharelog", [
            make_share(username="alice", workername="alice.rig1", sdiff=500, createdate=ts),
        ])
        self.write_share_lines("m_middle.sharelog", [
            make_share(username="alice", workername="alice.rig2", sdiff=25000, createdate=ts),
        ])
        self.write_share_lines("z_last.sharelog", [
            make_share(username="bob", workername="bob.rig1", sdiff=500, createdate=ts),
        ])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 3)
        self.assertEqual(data["users"]["alice"]["total"]["bucket_counts"][0], 1)
        self.assertEqual(data["users"]["alice"]["total"]["bucket_counts"][1], 1)
        self.assertEqual(data["users"]["bob"]["total"]["bucket_counts"][0], 1)
        # Pool-scope bucket 0 must combine BOTH alice's and bob's bucket-0 shares.
        self.assertEqual(data["pool"]["total"]["bucket_counts"][0], 2)

    def test_restarting_from_corrupted_state_json_raises_a_load_error_not_silent_bad_data(self):
        with open(self.state_path, "w") as f:
            f.write("{not valid json")
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.build_histograms(self.tmpdir, datetime.now(timezone.utc), state_path=self.state_path)

    def test_state_json_with_non_dict_top_level_raises_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump([1, 2, 3], f)
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.build_histograms(self.tmpdir, datetime.now(timezone.utc), state_path=self.state_path)

    def test_state_json_missing_version_raises_version_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"files": {}}, f)
        with self.assertRaises(hb.HistogramStateVersionError):
            hb.build_histograms(self.tmpdir, datetime.now(timezone.utc), state_path=self.state_path)

    def test_state_json_with_wrong_version_raises_version_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": 999, "files": {}}, f)
        with self.assertRaises(hb.HistogramStateVersionError):
            hb.build_histograms(self.tmpdir, datetime.now(timezone.utc), state_path=self.state_path)

    def test_state_json_entry_missing_fingerprint_key_raises_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": 1, "files": {"/some/path.sharelog": {"partial": {}}}}, f)
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.build_histograms(self.tmpdir, datetime.now(timezone.utc), state_path=self.state_path)

    def test_state_json_with_malformed_fingerprint_missing_keys_raises_load_error(self):
        with open(self.state_path, "w") as f:
            json.dump({
                "version": 1,
                "files": {"/some/path.sharelog": {"fingerprint": {"dev": 1}, "partial": {}}},
            }, f)
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.build_histograms(self.tmpdir, datetime.now(timezone.utc), state_path=self.state_path)

    def test_deeply_malformed_but_structurally_shallow_valid_partial_now_raises_load_error(self):
        """Was a MAJOR FINDING (silent empty-scope degradation) -- now
        fixed: load_state() validates a "partial"'s internal shape via
        _validate_partial_state/_validate_scope_state, not just that it
        IS a dict. A partial missing "pool"/"users"/"workers"/
        "recent_tuples" (or a scope missing a well-formed "counts"/
        "best") now raises HistogramStateLoadError immediately at load
        time, rather than build_histograms() silently succeeding with an
        all-zero/empty contribution for a path no longer present on disk
        to be re-scanned. This test constructs a state file entry for a
        path that is NOT currently present on disk (the realistic "this
        sharelog rotated away, but its historical entry is carried
        forward forever" case) whose "partial" is a dict but is missing
        every key _file_partial_from_state actually reads.
        """
        with open(self.state_path, "w") as f:
            json.dump({
                "version": 1,
                "files": {
                    "/some/rotated-away/path.sharelog": {
                        "fingerprint": {
                            "dev": 1, "ino": 1, "size": 10, "mtime_ns": 1, "offset": 0, "prefix_hash": "x",
                        },
                        # "partial" is *a* dict but is missing the
                        # "pool"/"users"/"workers"/"recent_tuples" keys
                        # _file_partial_from_state expects.
                        "partial": {"unexpected_shape": True},
                    },
                },
            }, f)

        # No currently-present sharelog files at all in this run.
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.build_histograms(self.tmpdir, datetime.now(timezone.utc), state_path=self.state_path)


if __name__ == "__main__":
    unittest.main()
