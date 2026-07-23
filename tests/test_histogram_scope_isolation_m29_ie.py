#!/usr/bin/env python3
"""
Independent Test Engineer pass (fresh, post-fix review, Milestone 29):
scope-isolation coverage for histogram_builder.py not already nailed by
the existing suite -- specifically:

  * pool histogram includes every accepted share, from every user/worker
  * a user's histogram contains ONLY that user's shares (no leakage)
  * a worker's histogram contains ONLY that worker's shares (no leakage)
  * two different users each having a worker with the literal SAME
    workername string -- confirms (does not silently assume) the
    existing flat-namespace convention already established by
    worker_statistics.py itself (a single `workers = {}` dict keyed only
    by workername, no per-owning-user nesting) -- histogram_builder.py's
    `fp.workers`/`total_workers`/`day_workers` dicts follow the identical
    convention, so a workername collision across two different users
    merges into one shared bucket entry rather than raising or silently
    dropping one side.
  * a user/worker who has submitted shares of some kind (present
    elsewhere in analytics_state.py's own output) but who has NEVER had
    a single ACCEPTED, valid-sdiff share recorded by THIS module returns
    a well-formed all-zero shape via empty_histogram_dataset_pair(),
    never a missing key or a crash -- exercised via analytics_builder.py's
    actual merge path, not just the standalone helper.

Uses only synthetic fixture data written to tempfile.mkdtemp() sandboxes.
Never touches /home/damopool/ckpool-solo/ckpool/logs, analytics.json,
analytics.state.json, histogram.state.json, or network_diff.state.json.

Run with:
    python3 -m unittest -v tests.test_histogram_scope_isolation_m29_ie
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import histogram_builder as hb
import analytics_builder as ab
import worker_sessions


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
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_histscope_ie_")
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


class TestPoolIncludesEverything(TempLogDirMixin, unittest.TestCase):
    def test_pool_histogram_sums_every_users_shares(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int(now.timestamp()) - 10)
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="alice.rig1", sdiff=500, createdate=ts),
            make_share(username="bob", workername="bob.rig1", sdiff=25000, createdate=ts),
            make_share(username="carol", workername="carol.rig1", sdiff=2100000, createdate=ts),
        ])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["pool"]["total"]["bucket_counts"]), 3)
        self.assertEqual(data["pool"]["total"]["bucket_counts"][0], 1)
        self.assertEqual(data["pool"]["total"]["bucket_counts"][1], 1)
        self.assertEqual(data["pool"]["total"]["bucket_counts"][3], 1)


class TestUserIsolation(TempLogDirMixin, unittest.TestCase):
    def test_users_own_histogram_contains_only_their_own_shares(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int(now.timestamp()) - 10)
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="alice.rig1", sdiff=500, createdate=ts),
            make_share(username="alice", workername="alice.rig2", sdiff=25000, createdate=ts),
            make_share(username="bob", workername="bob.rig1", sdiff=2100000, createdate=ts),
        ])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["users"]["alice"]["total"]["bucket_counts"]), 2)
        self.assertEqual(data["users"]["alice"]["total"]["bucket_counts"][0], 1)
        self.assertEqual(data["users"]["alice"]["total"]["bucket_counts"][1], 1)
        self.assertEqual(data["users"]["alice"]["total"]["bucket_counts"][3], 0)
        self.assertEqual(sum(data["users"]["bob"]["total"]["bucket_counts"]), 1)
        self.assertEqual(data["users"]["bob"]["total"]["bucket_counts"][3], 1)
        # No cross-contamination: alice's bucket-3 count must be exactly 0.
        self.assertNotIn("carol", data["users"])


class TestWorkerIsolation(TempLogDirMixin, unittest.TestCase):
    def test_each_workers_histogram_contains_only_its_own_shares(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int(now.timestamp()) - 10)
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="alice.rig1", sdiff=500, createdate=ts),
            make_share(username="alice", workername="alice.rig2", sdiff=25000, createdate=ts),
        ])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        self.assertEqual(sum(data["workers"]["alice.rig1"]["total"]["bucket_counts"]), 1)
        self.assertEqual(data["workers"]["alice.rig1"]["total"]["bucket_counts"][0], 1)
        self.assertEqual(sum(data["workers"]["alice.rig2"]["total"]["bucket_counts"]), 1)
        self.assertEqual(data["workers"]["alice.rig2"]["total"]["bucket_counts"][1], 1)
        # rig1's own histogram must NOT include rig2's bucket-1 share.
        self.assertEqual(data["workers"]["alice.rig1"]["total"]["bucket_counts"][1], 0)


class TestSameWorkernameAcrossTwoUsers(TempLogDirMixin, unittest.TestCase):
    def test_two_different_users_with_the_same_literal_workername_share_one_flat_entry(self):
        """Confirms histogram_builder.py's workers dict follows the SAME
        flat-namespace convention already established by
        worker_statistics.py itself (workers = {}, keyed only by
        workername, no per-owning-user nesting) -- a workername
        collision across two different users merges into ONE shared
        entry that includes both users' shares under that name, rather
        than raising, silently dropping one side, or (incorrectly)
        somehow keeping them separate under an architecture that has no
        per-user key at all for the workers dict."""
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int(now.timestamp()) - 10)
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="shared.rig", sdiff=500, createdate=ts),
            make_share(username="bob", workername="shared.rig", sdiff=25000, createdate=ts),
        ])
        data = hb.build_histograms(self.tmpdir, now, state_path=self.state_path)
        # Exactly one "shared.rig" entry, combining both users' shares --
        # confirmed via total count and per-bucket counts.
        self.assertEqual(sum(data["workers"]["shared.rig"]["total"]["bucket_counts"]), 2)
        self.assertEqual(data["workers"]["shared.rig"]["total"]["bucket_counts"][0], 1)
        self.assertEqual(data["workers"]["shared.rig"]["total"]["bucket_counts"][1], 1)
        # But each user's OWN per-user histogram remains correctly
        # separated (username is still the per-user dict's key).
        self.assertEqual(sum(data["users"]["alice"]["total"]["bucket_counts"]), 1)
        self.assertEqual(sum(data["users"]["bob"]["total"]["bucket_counts"]), 1)


class TestEmptyUserOrWorkerNeverSolvedYieldsAllZeroShape(TempLogDirMixin, unittest.TestCase):
    def test_a_user_who_never_had_an_accepted_valid_sdiff_share_gets_well_formed_empty_histogram_via_analytics_builder(self):
        """Exercises the ACTUAL merge path in analytics_builder.build_analytics
        (not just the standalone empty_histogram_dataset_pair() helper in
        isolation): a user present in analytics_state.py's own merged
        output (they submitted at least one share of *some* kind -- here,
        an explicitly REJECTED share, so analytics_state.py records them
        but histogram_builder.py's "solved shares only" definition never
        does) must still get a fully well-formed difficulty_histogram
        field, never a missing key or a KeyError."""
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int(now.timestamp()) - 10)
        self.write_share_lines("a.sharelog", [
            make_share(username="dave", workername="dave.rig1", sdiff=500, result=False, createdate=ts),
        ])
        analytics_state_path = os.path.join(self.tmpdir, "analytics.state.json")
        network_diff_state_path = os.path.join(self.tmpdir, "network_diff.state.json")
        worker_sessions_state_path = os.path.join(self.tmpdir, "worker_sessions.state.json")
        data = ab.build_analytics(
            logs_dir=self.tmpdir,
            now=now,
            state_path=analytics_state_path,
            histogram_state_path=self.state_path,
            network_diff_state_path=network_diff_state_path,
            worker_sessions_state_path=worker_sessions_state_path,
        )
        self.assertIn("dave", data["users"])
        histogram = data["users"]["dave"]["difficulty_histogram"]
        self.assertEqual(set(histogram.keys()), {"1d", "total"})
        for key in ("1d", "total"):
            self.assertEqual(histogram[key]["bucket_counts"], [0] * hb.BUCKET_COUNT)
            self.assertEqual(histogram[key]["bucket_best"], [None] * hb.BUCKET_COUNT)
        json.dumps(data)  # must remain fully JSON-serializable

    def test_a_worker_who_never_had_an_accepted_valid_sdiff_share_gets_well_formed_empty_histogram(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int(now.timestamp()) - 10)
        self.write_share_lines("a.sharelog", [
            make_share(username="dave", workername="dave.rig1", sdiff=500, result=False, createdate=ts),
        ])
        analytics_state_path = os.path.join(self.tmpdir, "analytics.state.json")
        network_diff_state_path = os.path.join(self.tmpdir, "network_diff.state.json")
        worker_sessions_state_path = os.path.join(self.tmpdir, "worker_sessions.state.json")
        data = ab.build_analytics(
            logs_dir=self.tmpdir,
            now=now,
            state_path=analytics_state_path,
            histogram_state_path=self.state_path,
            network_diff_state_path=network_diff_state_path,
            worker_sessions_state_path=worker_sessions_state_path,
        )
        self.assertIn("dave.rig1", data["workers"])
        histogram = data["workers"]["dave.rig1"]["difficulty_histogram"]
        self.assertEqual(set(histogram.keys()), {"1d", "total"})
        for key in ("1d", "total"):
            self.assertEqual(histogram[key]["bucket_counts"], [0] * hb.BUCKET_COUNT)

    def test_completely_empty_pool_still_has_well_formed_pool_level_difficulty_histogram(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        analytics_state_path = os.path.join(self.tmpdir, "analytics.state.json")
        network_diff_state_path = os.path.join(self.tmpdir, "network_diff.state.json")
        worker_sessions_state_path = os.path.join(self.tmpdir, "worker_sessions.state.json")
        data = ab.build_analytics(
            logs_dir=self.tmpdir,
            now=now,
            state_path=analytics_state_path,
            histogram_state_path=self.state_path,
            network_diff_state_path=network_diff_state_path,
            worker_sessions_state_path=worker_sessions_state_path,
        )
        histogram = data["pool"]["difficulty_histogram"]
        self.assertEqual(set(histogram.keys()), {"1d", "total"})
        self.assertEqual(histogram["1d"]["bucket_counts"], [0] * hb.BUCKET_COUNT)
        self.assertEqual(histogram["total"]["bucket_counts"], [0] * hb.BUCKET_COUNT)
        self.assertIsNone(data["pool"]["network_difficulty"])
        json.dumps(data)


if __name__ == "__main__":
    unittest.main()
