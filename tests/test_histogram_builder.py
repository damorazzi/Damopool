#!/usr/bin/env python3
"""
Test suite for histogram_builder.py (Phase E Milestone 29).

Uses only synthetic/hand-crafted sharelog fixture data written to scratch
temp directories via tempfile.mkdtemp(). Never touches
/home/damopool/ckpool-solo/ckpool/logs and never writes to the real
histogram.state.json.

Run with:
    python3 -m unittest -v tests.test_histogram_builder
"""
import json
import os
import shutil
import sys
import tempfile
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
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_histtest_")
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


# ---------------------------------------------------------------------------
# bucket_index -- the fixed 12-bucket boundary logic
# ---------------------------------------------------------------------------
class TestBucketIndex(unittest.TestCase):
    def test_twelve_buckets_exist(self):
        self.assertEqual(hb.BUCKET_COUNT, 12)
        self.assertEqual(len(hb.BUCKET_BOUNDARIES), 11)

    def test_bucket_0_is_0_to_21000(self):
        self.assertEqual(hb.bucket_index(0), 0)
        self.assertEqual(hb.bucket_index(1), 0)
        self.assertEqual(hb.bucket_index(20999), 0)

    def test_exact_boundary_value_belongs_to_the_upper_bucket(self):
        # [lower, upper) -- the boundary itself belongs to the bucket it starts.
        self.assertEqual(hb.bucket_index(21000), 1)
        self.assertEqual(hb.bucket_index(210000), 2)

    def test_each_of_the_11_finite_boundaries_maps_correctly(self):
        expected = [
            (20999, 0), (21000, 1), (209999, 1), (210000, 2),
            (2099999, 2), (2100000, 3), (20999999, 3), (21000000, 4),
            (209999999, 4), (210000000, 5), (2099999999, 5), (2100000000, 6),
            (20999999999, 6), (21000000000, 7), (209999999999, 7), (210000000000, 8),
            (2099999999999, 8), (2100000000000, 9), (20999999999999, 9), (21000000000000, 10),
            (209999999999999, 10), (210000000000000, 11),
        ]
        for value, expected_idx in expected:
            self.assertEqual(hb.bucket_index(value), expected_idx, f"value={value}")

    def test_bucket_11_is_permanently_open_ended(self):
        self.assertEqual(hb.bucket_index(210000000000000), 11)
        self.assertEqual(hb.bucket_index(10**20), 11)
        self.assertEqual(hb.bucket_index(float("1e300")), 11)

    def test_real_network_difficulty_falls_in_the_last_finite_bucket(self):
        # ~127.17T, per the real ckpool.log value confirmed during
        # investigation -- must land in bucket 10 ([21T, 210T)), not the
        # open-ended bucket 11, per the Human's own design confirmation.
        self.assertEqual(hb.bucket_index(127_170_500_429_035.2), 10)

    def test_invalid_inputs_return_none_not_a_throw(self):
        self.assertIsNone(hb.bucket_index(None))
        self.assertIsNone(hb.bucket_index("21000"))
        self.assertIsNone(hb.bucket_index(True))
        self.assertIsNone(hb.bucket_index(float("nan")))
        self.assertIsNone(hb.bucket_index(float("inf")))
        self.assertIsNone(hb.bucket_index(float("-inf")))


# ---------------------------------------------------------------------------
# _HistogramScope -- per-scope bucket counting + best-share tracking +
# state round-trip
# ---------------------------------------------------------------------------
class TestHistogramScope(unittest.TestCase):
    def test_add_increments_the_correct_bucket_and_tracks_best(self):
        scope = hb._HistogramScope()
        scope.add({"username": "alice", "workername": "alice.rig1"}, 500, (1700000000, 0))
        scope.add({"username": "alice", "workername": "alice.rig1"}, 25000, (1700000100, 0))
        self.assertEqual(scope.counts[0], 1)
        self.assertEqual(scope.counts[1], 1)
        self.assertEqual(sum(scope.counts), 2)

    def test_best_tracker_per_bucket_keeps_the_highest_in_that_bucket_only(self):
        scope = hb._HistogramScope()
        scope.add({"username": "a", "workername": "a.w"}, 100, (1700000000, 0))
        scope.add({"username": "b", "workername": "b.w"}, 500, (1700000100, 0))
        output = scope.to_output()
        self.assertEqual(output["bucket_best"][0]["sdiff"], 500)
        self.assertEqual(output["bucket_best"][0]["username"], "b")

    def test_state_round_trip_preserves_counts_and_best(self):
        scope = hb._HistogramScope()
        scope.add({"username": "alice", "workername": "alice.rig1"}, 999999, (1700000000, 5))
        restored = hb._HistogramScope.from_state(scope.to_state())
        self.assertEqual(restored.counts, scope.counts)
        self.assertEqual(restored.to_output(), scope.to_output())

    def test_empty_scope_output_shape(self):
        output = hb._HistogramScope().to_output()
        self.assertEqual(output["bucket_counts"], [0] * 12)
        self.assertEqual(output["bucket_best"], [None] * 12)

    def test_merge_combines_counts_and_keeps_the_overall_best_per_bucket(self):
        a = hb._HistogramScope()
        a.add({"username": "a", "workername": "a.w"}, 100, (1700000000, 0))
        b = hb._HistogramScope()
        b.add({"username": "b", "workername": "b.w"}, 200, (1700000100, 0))
        target = hb._HistogramScope()
        hb._merge_histogram_scope(target, a)
        hb._merge_histogram_scope(target, b)
        self.assertEqual(target.counts[0], 2)
        self.assertEqual(target.best[0].sdiff, 200)


# ---------------------------------------------------------------------------
# build_histograms end-to-end
# ---------------------------------------------------------------------------
class TestBuildHistogramsEndToEnd(TempLogDirMixin, unittest.TestCase):
    def test_basic_accumulation_pool_user_worker(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="alice.rig1", sdiff=500, createdate=cd(int(now.timestamp()) - 60)),
            make_share(username="alice", workername="alice.rig1", sdiff=25000, createdate=cd(int(now.timestamp()) - 30)),
        ])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(data["pool"]["total"]["bucket_counts"][0], 1)
        self.assertEqual(data["pool"]["total"]["bucket_counts"][1], 1)
        self.assertEqual(data["users"]["alice"]["total"]["bucket_counts"][0], 1)
        self.assertEqual(data["workers"]["alice.rig1"]["total"]["bucket_counts"][1], 1)

    def test_only_accepted_shares_count_rejected_and_invalid_excluded(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int(now.timestamp()) - 60)
        self.write_share_lines("a.sharelog", [
            make_share(sdiff=500, result=True, createdate=ts),
            make_share(sdiff=500, result=False, createdate=ts),
            make_share(sdiff=500, result="garbage", createdate=ts),
            make_share(sdiff=None, result=True, createdate=ts),
        ])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 1)

    def test_1d_dataset_excludes_shares_older_than_retention(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        old_ts = cd(int((now - timedelta(hours=48)).timestamp()))
        recent_ts = cd(int((now - timedelta(hours=1)).timestamp()))
        self.write_share_lines("a.sharelog", [
            make_share(sdiff=500, createdate=old_ts),
            make_share(sdiff=25000, createdate=recent_ts),
        ])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["1d"]["bucket_counts"]), 1)
        self.assertEqual(data["pool"]["1d"]["bucket_counts"][1], 1)
        # "total" must still include both, regardless of age.
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 2)

    def test_total_accumulates_incrementally_across_multiple_runs(self):
        now1 = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        path = self.write_share_lines("a.sharelog", [make_share(sdiff=500, createdate=cd(int(now1.timestamp()) - 10))])
        hb.build_histograms(self.tmpdir, now1, state_path=self.state_path)

        # A second run, a little later, with one more share appended to
        # the SAME file (simulating a live, growing sharelog).
        now2 = now1 + timedelta(minutes=5)
        with open(path, "a") as f:
            f.write(json.dumps(make_share(sdiff=25000, createdate=cd(int(now2.timestamp()) - 10))) + "\n")
        data = hb.build_histograms(self.tmpdir, now2, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 2)
        self.assertEqual(data["pool"]["total"]["bucket_counts"][0], 1)
        self.assertEqual(data["pool"]["total"]["bucket_counts"][1], 1)

    def test_a_share_is_never_double_counted_across_runs_with_no_new_data(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [make_share(sdiff=500, createdate=cd(int(now.timestamp()) - 10))])
        hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 1)

    def test_malformed_sharelog_lines_are_skipped_not_a_crash(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        path = os.path.join(self.tmpdir, "a.sharelog")
        with open(path, "wb") as f:
            f.write(b"not json at all {\n")
            f.write(json.dumps(make_share(sdiff=500, createdate=cd(int(now.timestamp()) - 10))).encode() + b"\n")
            f.write(b"\xff\xfe invalid utf8\n")
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 1)

    def test_completely_empty_logs_dir_no_crash_and_well_formed(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        json.dumps(data)
        self.assertEqual(data["pool"]["1d"]["bucket_counts"], [0] * 12)
        self.assertEqual(data["pool"]["total"]["bucket_counts"], [0] * 12)
        self.assertEqual(data["users"], {})
        self.assertEqual(data["workers"], {})

    def test_invalid_username_excludes_user_scope_but_pool_still_counts(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [
            make_share(username=None, workername="rig1", sdiff=500, createdate=cd(int(now.timestamp()) - 10)),
        ])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 1)
        self.assertEqual(data["users"], {})
        self.assertIn("rig1", data["workers"])

    def test_highest_solved_share_in_bucket_matches_expectation(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int(now.timestamp()) - 10)
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="alice.rig1", sdiff=100, createdate=ts),
            make_share(username="bob", workername="bob.rig1", sdiff=900, createdate=ts),
        ])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        best = data["pool"]["total"]["bucket_best"][0]
        self.assertEqual(best["username"], "bob")
        self.assertEqual(best["sdiff"], 900)


if __name__ == "__main__":
    unittest.main()
