#!/usr/bin/env python3
"""
Independent Test Engineer pass (fresh, post-fix review, Milestone 29):
targets the exact 24h boundary contract of DAY_WINDOW / is_within_window
in histogram_builder.py, which none of the existing test files
(tests/test_histogram_builder.py, tests/test_histogram_builder_adversarial_m29.py,
tests/test_histogram_1d_total_timeline_m29.py) pin down to the *second*.
The existing timeline test only exercises 1h/24h/27h-old shares (hour
granularity); this file specifically nails the exact second-level
boundary the Human Approval Brief and the fix's own docstring describe:

    delta = now - timestamp
    inclusive: timedelta(0) <= delta <= window_delta

i.e. a share exactly 24h00m00s old must still be INCLUDED in "1d"; a
share 24h00m01s old must be EXCLUDED.

Also separately confirms the two-tier relationship between DAY_WINDOW
(24h, the reported cutoff) and RECENT_TUPLE_RETENTION (25h, the wider
storage buffer) by placing a share strictly between the two (e.g. 24h30m
old): it must survive in storage (not have been silently pruned) yet
still be correctly excluded from the reported "1d" bucket.

Uses only synthetic fixture data written to tempfile.mkdtemp() sandboxes.
Never touches /home/damopool/ckpool-solo/ckpool/logs or the real
histogram.state.json.

Run with:
    python3 -m unittest -v tests.test_histogram_24h_boundary_m29_ie
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
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_hist24h_ie_")
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
# Unit-level: is_within_window itself, at exact second granularity
# ---------------------------------------------------------------------------
class TestIsWithinWindowUnit(unittest.TestCase):
    def test_share_at_exactly_now_is_within_window(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        self.assertTrue(hb.is_within_window(now, now, hb.DAY_WINDOW))

    def test_share_23h59m59s_old_is_within_window(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = now - timedelta(hours=23, minutes=59, seconds=59)
        self.assertTrue(hb.is_within_window(now, ts, hb.DAY_WINDOW))

    def test_share_exactly_24h00m00s_old_is_INCLUSIVE_within_window(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = now - timedelta(hours=24)
        self.assertTrue(
            hb.is_within_window(now, ts, hb.DAY_WINDOW),
            "the fix's own contract (timedelta(0) <= delta <= window_delta) is INCLUSIVE at the boundary",
        )

    def test_share_24h00m01s_old_is_excluded(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = now - timedelta(hours=24, seconds=1)
        self.assertFalse(hb.is_within_window(now, ts, hb.DAY_WINDOW))

    def test_share_in_the_future_relative_to_now_is_excluded(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = now + timedelta(seconds=1)
        self.assertFalse(hb.is_within_window(now, ts, hb.DAY_WINDOW))


# ---------------------------------------------------------------------------
# End-to-end through build_histograms: the "1d" cutoff at exact second
# granularity, and the two-tier DAY_WINDOW/RECENT_TUPLE_RETENTION split.
# ---------------------------------------------------------------------------
class TestEndToEndExactSecondBoundary(TempLogDirMixin, unittest.TestCase):
    def test_share_exactly_24h00m00s_old_is_still_counted_in_1d(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int((now - timedelta(hours=24)).timestamp()))
        self.write_share_lines("a.sharelog", [make_share(sdiff=500, createdate=ts)])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["1d"]["bucket_counts"]), 1,
                          "a share exactly 24h00m00s old must be INCLUDED in 1d (inclusive boundary)")
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 1)

    def test_share_24h00m01s_old_is_excluded_from_1d_but_present_in_total(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int((now - timedelta(hours=24, seconds=1)).timestamp()))
        self.write_share_lines("a.sharelog", [make_share(sdiff=500, createdate=ts)])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["1d"]["bucket_counts"]), 0,
                          "a share 24h00m01s old must be EXCLUDED from 1d")
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 1)

    def test_share_23h59m59s_old_is_included_in_1d(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int((now - timedelta(hours=23, minutes=59, seconds=59)).timestamp()))
        self.write_share_lines("a.sharelog", [make_share(sdiff=500, createdate=ts)])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["1d"]["bucket_counts"]), 1)

    def test_share_exactly_at_now_is_included_in_1d(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int(now.timestamp()))
        self.write_share_lines("a.sharelog", [make_share(sdiff=500, createdate=ts)])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["1d"]["bucket_counts"]), 1)

    def test_share_inside_the_25h_storage_buffer_but_outside_the_24h_report_window_is_excluded_from_1d(self):
        """A share 24h30m old: within RECENT_TUPLE_RETENTION's wider 25h
        storage buffer (so it must not have been silently pruned from
        recent_tuples), but outside DAY_WINDOW's exact 24h reporting
        cutoff -- must be excluded from the reported "1d" bucket, while
        still contributing to "total"."""
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int((now - timedelta(hours=24, minutes=30)).timestamp()))
        self.write_share_lines("a.sharelog", [make_share(sdiff=500, createdate=ts)])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["1d"]["bucket_counts"]), 0,
                          "24h30m old is within the 25h storage buffer but outside the exact 24h report window")
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 1)

    def test_share_outside_the_25h_storage_buffer_entirely_is_excluded_from_1d_but_still_in_total(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int((now - timedelta(hours=30)).timestamp()))
        self.write_share_lines("a.sharelog", [make_share(sdiff=500, createdate=ts)])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["1d"]["bucket_counts"]), 0)
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 1)

    def test_boundary_holds_identically_for_user_and_worker_scopes_not_just_pool(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        exactly_24h = cd(int((now - timedelta(hours=24)).timestamp()))
        just_over_24h = cd(int((now - timedelta(hours=24, seconds=1)).timestamp()))
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="alice.rig1", sdiff=500, createdate=exactly_24h),
            make_share(username="bob", workername="bob.rig1", sdiff=500, createdate=just_over_24h),
        ])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["users"]["alice"]["1d"]["bucket_counts"]), 1)
        self.assertEqual(sum(data["users"]["bob"]["1d"]["bucket_counts"]), 0)
        self.assertEqual(sum(data["workers"]["alice.rig1"]["1d"]["bucket_counts"]), 1)
        self.assertEqual(sum(data["workers"]["bob.rig1"]["1d"]["bucket_counts"]), 0)
        # Both remain in "total" regardless.
        self.assertEqual(sum(data["users"]["alice"]["total"]["bucket_counts"]), 1)
        self.assertEqual(sum(data["users"]["bob"]["total"]["bucket_counts"]), 1)


if __name__ == "__main__":
    unittest.main()
