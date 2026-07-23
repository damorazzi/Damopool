#!/usr/bin/env python3
"""
Independent adversarial test pass for histogram_builder.py (Phase E
Milestone 29) -- focused specifically on the "1d" vs "total" dataset
divergence across a REAL multi-run timeline with an advancing `now`,
per the review brief dated 2026-07-22. Not already covered by
tests/test_histogram_builder.py (whose 1d-vs-total test only calls
build_histograms() ONCE with both an old and a recent share already
present -- it never advances `now` across multiple runs to watch a
share genuinely age out of "1d" while the sharelog file itself is
never rewritten).

Uses only synthetic fixture data written to tempfile.mkdtemp() sandboxes.
Never touches /home/damopool/ckpool-solo/ckpool/logs or the real
histogram.state.json.

Run with:
    python3 -m unittest -v tests.test_histogram_1d_total_timeline_m29
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
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_hist1dtotal_")
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


class TestOneDayAgingOutAcrossMultipleRuns(TempLogDirMixin, unittest.TestCase):
    def test_a_share_ages_out_of_1d_across_runs_while_staying_forever_in_total(self):
        """Real timeline: run 1 happens at T0 with a share created 1 hour
        earlier -- present in both "1d" and "total". The sharelog file is
        NEVER rewritten after this. Run 2 happens at T0+23h (share is
        24h old -- still within the 25h RECENT_TUPLE_RETENTION slack, so
        still in "1d"). Run 3 happens at T0+26h (share is now 27h old --
        outside the 25h retention window) -- must have dropped out of
        "1d" but still be counted, unchanged, in "total"."""
        t0 = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        share_ts = int((t0 - timedelta(hours=1)).timestamp())
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="alice.rig1", sdiff=500, createdate=cd(share_ts)),
        ])

        data_run1 = hb.build_histograms(self.tmpdir, t0, state_path=self.state_path)
        self.assertEqual(sum(data_run1["pool"]["1d"]["bucket_counts"]), 1, "run1: share is 1h old, must be in 1d")
        self.assertEqual(sum(data_run1["pool"]["total"]["bucket_counts"]), 1)

        t_run2 = t0 + timedelta(hours=23)
        data_run2 = hb.build_histograms(self.tmpdir, t_run2, state_path=self.state_path)
        self.assertEqual(sum(data_run2["pool"]["1d"]["bucket_counts"]), 1,
                          "run2: share is 24h old, still within the 25h retention slack -- must remain in 1d")
        self.assertEqual(sum(data_run2["pool"]["total"]["bucket_counts"]), 1)

        t_run3 = t0 + timedelta(hours=26)
        data_run3 = hb.build_histograms(self.tmpdir, t_run3, state_path=self.state_path)
        self.assertEqual(sum(data_run3["pool"]["1d"]["bucket_counts"]), 0,
                          "run3: share is 27h old, outside the 25h retention window -- must have aged out of 1d")
        self.assertEqual(sum(data_run3["pool"]["total"]["bucket_counts"]), 1,
                          "run3: total must be unaffected by aging -- forever cumulative")
        # Per-user/per-worker scopes must show the exact same divergence.
        self.assertEqual(sum(data_run3["users"]["alice"]["1d"]["bucket_counts"]), 0)
        self.assertEqual(sum(data_run3["users"]["alice"]["total"]["bucket_counts"]), 1)
        self.assertEqual(sum(data_run3["workers"]["alice.rig1"]["1d"]["bucket_counts"]), 0)
        self.assertEqual(sum(data_run3["workers"]["alice.rig1"]["total"]["bucket_counts"]), 1)

    def test_bucket_best_for_1d_also_clears_once_its_only_contributing_share_ages_out(self):
        t0 = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        share_ts = int((t0 - timedelta(hours=1)).timestamp())
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="alice.rig1", sdiff=500, createdate=cd(share_ts)),
        ])
        data_run1 = hb.build_histograms(self.tmpdir, t0, state_path=self.state_path)
        self.assertIsNotNone(data_run1["pool"]["1d"]["bucket_best"][0])
        self.assertIsNotNone(data_run1["pool"]["total"]["bucket_best"][0])

        t_run2 = t0 + timedelta(hours=26)
        data_run2 = hb.build_histograms(self.tmpdir, t_run2, state_path=self.state_path)
        self.assertIsNone(data_run2["pool"]["1d"]["bucket_best"][0],
                           "1d's own bucket_best must clear once its only contributing share ages out")
        self.assertIsNotNone(data_run2["pool"]["total"]["bucket_best"][0],
                              "total's bucket_best must remain forever, unaffected by 1d aging")

    def test_mixed_ages_across_three_runs_with_new_shares_appended_between_runs(self):
        """A more realistic timeline: the sharelog file keeps growing
        (new shares appended between runs, as a live file would), while
        an older share simultaneously ages out of "1d". Confirms both
        effects compose correctly rather than one masking the other."""
        t0 = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        old_ts = int((t0 - timedelta(hours=1)).timestamp())
        path = self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="alice.rig1", sdiff=500, createdate=cd(old_ts)),
        ])
        hb.build_histograms(self.tmpdir, t0, state_path=self.state_path)

        # 26 hours later: the old share has aged out of 1d. A NEW share
        # is appended, freshly within the window.
        t1 = t0 + timedelta(hours=26)
        new_ts_1 = int((t1 - timedelta(minutes=5)).timestamp())
        with open(path, "a") as f:
            f.write(json.dumps(make_share(username="bob", workername="bob.rig1", sdiff=25000, createdate=cd(new_ts_1))) + "\n")
        data_run2 = hb.build_histograms(self.tmpdir, t1, state_path=self.state_path)
        self.assertEqual(sum(data_run2["pool"]["1d"]["bucket_counts"]), 1, "only bob's fresh share should be in 1d now")
        self.assertEqual(data_run2["pool"]["1d"]["bucket_counts"][1], 1)
        self.assertEqual(sum(data_run2["pool"]["total"]["bucket_counts"]), 2, "total must have both alice's and bob's shares")

        # Another 26 hours later: bob's share (now itself old) also ages
        # out; a third share (carol) is added.
        t2 = t1 + timedelta(hours=26)
        new_ts_2 = int((t2 - timedelta(minutes=5)).timestamp())
        with open(path, "a") as f:
            f.write(json.dumps(make_share(username="carol", workername="carol.rig1", sdiff=2100000, createdate=cd(new_ts_2))) + "\n")
        data_run3 = hb.build_histograms(self.tmpdir, t2, state_path=self.state_path)
        self.assertEqual(sum(data_run3["pool"]["1d"]["bucket_counts"]), 1, "only carol's fresh share should be in 1d now")
        self.assertEqual(data_run3["pool"]["1d"]["bucket_counts"][3], 1)
        self.assertEqual(sum(data_run3["pool"]["total"]["bucket_counts"]), 3, "total must have all three shares forever")


if __name__ == "__main__":
    unittest.main()
