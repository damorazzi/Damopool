#!/usr/bin/env python3
"""
Independent test suite for user_statistics.py (Feature 003 - User Statistics).

Uses only synthetic/hand-crafted sharelog fixture data written to a scratch
temp directory. Never touches /home/damopool/ckpool-solo/ckpool/logs.

Run with:
    python3 -m unittest -v tests.test_user_statistics
"""
import datetime
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import parse_share_analytics as psa
import user_statistics as us


def make_share(username="u1", workername="u1.w1", agent="agent", diff=1,
                sdiff=1.5, result=True, createdate="1700000000,123456789"):
    return {
        "username": username,
        "workername": workername,
        "agent": agent,
        "diff": diff,
        "sdiff": sdiff,
        "result": result,
        "createdate": createdate,
    }


class TempLogDirMixin:
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_test_")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def write_sharelog(self, name, lines):
        path = os.path.join(self.tmpdir, name)
        with open(path, "w", encoding="utf-8") as f:
            for line in lines:
                f.write(line)
                if not line.endswith("\n"):
                    f.write("\n")
        return path


# ---------------------------------------------------------------------------
# Username validation / grouping
# ---------------------------------------------------------------------------
class TestUsernameValidation(unittest.TestCase):
    def test_valid_string_username_creates_entry(self):
        stats = us.compute_user_statistics([make_share(username="alice")])
        self.assertIn("alice", stats)

    def test_missing_username_key_excluded(self):
        share = make_share()
        del share["username"]
        stats = us.compute_user_statistics([share])
        self.assertEqual(stats, {})

    def test_none_username_excluded(self):
        stats = us.compute_user_statistics([make_share(username=None)])
        self.assertEqual(stats, {})

    def test_empty_string_username_excluded(self):
        stats = us.compute_user_statistics([make_share(username="")])
        self.assertEqual(stats, {})

    def test_int_username_excluded(self):
        stats = us.compute_user_statistics([make_share(username=42)])
        self.assertEqual(stats, {})

    def test_list_username_excluded(self):
        stats = us.compute_user_statistics([make_share(username=["alice"])])
        self.assertEqual(stats, {})

    def test_dict_username_excluded(self):
        stats = us.compute_user_statistics([make_share(username={"a": 1})])
        self.assertEqual(stats, {})

    def test_bool_username_excluded(self):
        # bool is technically an int subclass but not a str, so should be excluded.
        stats = us.compute_user_statistics([make_share(username=True)])
        self.assertEqual(stats, {})

    def test_whitespace_only_username_should_be_excluded(self):
        """
        UPDATED SPEC (per lead direction following Minor finding #1):
        valid usernames must be strings that are non-empty *after stripping
        whitespace*. A username of "   " or "\\t" is whitespace-only and must
        be excluded entirely, just like "".

        is_valid_username() strips only for the validity check; the
        username stored in the returned dict/best_share records remains
        unstripped (see test_valid_username_with_surrounding_whitespace_is_not_altered).
        """
        stats = us.compute_user_statistics([make_share(username="   ")])
        self.assertEqual(stats, {}, "whitespace-only username must not create an entry")

        stats_tab = us.compute_user_statistics([make_share(username="\t\t")])
        self.assertEqual(stats_tab, {}, "whitespace-only (tab) username must not create an entry")

    def test_valid_username_with_surrounding_whitespace_is_not_altered(self):
        """
        Guard against an overly-aggressive fix: a username that is valid
        (non-empty after stripping) but has incidental leading/trailing
        whitespace, e.g. " alice ", must be preserved verbatim as the dict
        key and in best_share records -- stripping must be validation-only,
        never applied to the stored/returned username.
        """
        stats = us.compute_user_statistics([make_share(username=" alice ", sdiff=5.0)])
        self.assertIn(" alice ", stats)
        self.assertNotIn("alice", stats)
        self.assertEqual(stats[" alice "]["best_share_ever"]["username"], " alice ")

    def test_distinct_users_get_separate_entries_no_cross_contamination(self):
        shares = [
            make_share(username="alice", sdiff=10.0, result=True),
            make_share(username="bob", sdiff=20.0, result=True),
            make_share(username="alice", sdiff=5.0, result=False),
        ]
        stats = us.compute_user_statistics(shares)
        self.assertEqual(set(stats.keys()), {"alice", "bob"})
        self.assertEqual(stats["alice"]["accepted_count"], 1)
        self.assertEqual(stats["alice"]["rejected_count"], 1)
        self.assertEqual(stats["bob"]["accepted_count"], 1)
        self.assertEqual(stats["bob"]["rejected_count"], 0)
        self.assertEqual(stats["alice"]["max_sdiff"], 10.0)
        self.assertEqual(stats["bob"]["max_sdiff"], 20.0)

    def test_mixed_valid_and_invalid_usernames_in_same_batch(self):
        shares = [
            make_share(username="alice", sdiff=10.0),
            make_share(username=None, sdiff=999.0),
            make_share(username="", sdiff=999.0),
            make_share(username=123, sdiff=999.0),
            make_share(username="bob", sdiff=20.0),
        ]
        stats = us.compute_user_statistics(shares)
        self.assertEqual(set(stats.keys()), {"alice", "bob"})
        # confirm the excluded shares' huge sdiff never leaked into anyone's stats
        self.assertEqual(stats["alice"]["max_sdiff"], 10.0)
        self.assertEqual(stats["bob"]["max_sdiff"], 20.0)


# ---------------------------------------------------------------------------
# Per-user independence under malformed data
# ---------------------------------------------------------------------------
class TestPerUserIndependence(unittest.TestCase):
    def test_bad_sdiff_for_one_user_does_not_affect_other(self):
        shares = [
            make_share(username="alice", sdiff=-5, result=True),   # invalid sdiff
            make_share(username="bob", sdiff=10.0, result=True),
        ]
        stats = us.compute_user_statistics(shares)
        self.assertEqual(stats["alice"]["accepted_count"], 1)
        self.assertIsNone(stats["alice"]["average_sdiff"])
        self.assertIsNone(stats["alice"]["best_share_ever"])
        self.assertEqual(stats["bob"]["accepted_count"], 1)
        self.assertEqual(stats["bob"]["average_sdiff"], 10.0)
        self.assertIsNotNone(stats["bob"]["best_share_ever"])

    def test_bad_createdate_for_one_user_does_not_affect_other(self):
        today = datetime.date(2026, 7, 16)
        good_ts = int(datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc).timestamp())
        shares = [
            make_share(username="alice", sdiff=10.0, createdate="not-a-timestamp"),
            make_share(username="bob", sdiff=20.0, createdate=f"{good_ts},0"),
        ]
        stats = us.compute_user_statistics(shares, today=today)
        self.assertIsNone(stats["alice"]["best_share_today"])
        self.assertIsNotNone(stats["alice"]["best_share_ever"])
        self.assertEqual(stats["alice"]["best_share_ever"]["timestamp"], "unknown")
        self.assertIsNotNone(stats["bob"]["best_share_today"])
        self.assertEqual(stats["bob"]["best_share_today"]["username"], "bob")

    def test_invalid_result_for_one_user_does_not_affect_other(self):
        shares = [
            make_share(username="alice", result="not-a-bool"),
            make_share(username="bob", result=True, sdiff=5.0),
        ]
        stats = us.compute_user_statistics(shares)
        self.assertEqual(stats["alice"]["invalid_result_count"], 1)
        self.assertEqual(stats["alice"]["accepted_count"], 0)
        self.assertEqual(stats["bob"]["accepted_count"], 1)
        self.assertEqual(stats["bob"]["invalid_result_count"], 0)


# ---------------------------------------------------------------------------
# invalid_result-only user
# ---------------------------------------------------------------------------
class TestInvalidResultOnlyUser(unittest.TestCase):
    def test_user_with_only_invalid_results_gets_all_none_stats(self):
        shares = [
            make_share(username="alice", result=None),
            make_share(username="alice", result="true"),
            make_share(username="alice", result=1),
        ]
        stats = us.compute_user_statistics(shares)
        self.assertIn("alice", stats)
        a = stats["alice"]
        self.assertEqual(a["invalid_result_count"], 3)
        self.assertEqual(a["accepted_count"], 0)
        self.assertEqual(a["rejected_count"], 0)
        self.assertIsNone(a["average_sdiff"])
        self.assertIsNone(a["median_sdiff"])
        self.assertIsNone(a["min_sdiff"])
        self.assertIsNone(a["max_sdiff"])
        self.assertIsNone(a["percentiles"]["p50"])
        self.assertIsNone(a["percentiles"]["p90"])
        self.assertIsNone(a["percentiles"]["p99"])
        self.assertIsNone(a["best_share_today"])
        self.assertIsNone(a["best_share_ever"])


# ---------------------------------------------------------------------------
# best_share_today vs best_share_ever, per user
# ---------------------------------------------------------------------------
class TestBestSharePerUser(unittest.TestCase):
    def test_two_users_each_have_own_best_today_no_interference(self):
        today = datetime.date(2026, 7, 16)
        ts = int(datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc).timestamp())
        shares = [
            make_share(username="alice", sdiff=5.0, createdate=f"{ts},0"),
            make_share(username="alice", sdiff=50.0, createdate=f"{ts+1},0"),
            make_share(username="bob", sdiff=100.0, createdate=f"{ts},0"),
            make_share(username="bob", sdiff=3.0, createdate=f"{ts+1},0"),
        ]
        stats = us.compute_user_statistics(shares, today=today)
        self.assertEqual(stats["alice"]["best_share_today"]["sdiff"], 50.0)
        self.assertEqual(stats["alice"]["best_share_today"]["username"], "alice")
        self.assertEqual(stats["bob"]["best_share_today"]["sdiff"], 100.0)
        self.assertEqual(stats["bob"]["best_share_today"]["username"], "bob")

    def test_best_share_ever_only_drawn_from_own_users_shares(self):
        # bob has a much higher sdiff than alice; alice's best_share_ever
        # must never be bob's share.
        shares = [
            make_share(username="alice", sdiff=5.0, createdate="1700000000,0"),
            make_share(username="bob", sdiff=999.0, createdate="1700000000,0"),
        ]
        stats = us.compute_user_statistics(shares)
        self.assertEqual(stats["alice"]["best_share_ever"]["sdiff"], 5.0)
        self.assertEqual(stats["alice"]["best_share_ever"]["username"], "alice")
        self.assertEqual(stats["bob"]["best_share_ever"]["sdiff"], 999.0)
        self.assertEqual(stats["bob"]["best_share_ever"]["username"], "bob")

    def test_best_share_ever_persists_across_day_boundary_per_user(self):
        today = datetime.date(2026, 7, 16)
        yesterday_ts = int(datetime.datetime(2026, 7, 15, 12, 0, 0, tzinfo=datetime.timezone.utc).timestamp())
        shares = [make_share(username="alice", sdiff=50.0, createdate=f"{yesterday_ts},0")]
        stats = us.compute_user_statistics(shares, today=today)
        self.assertIsNone(stats["alice"]["best_share_today"])
        self.assertIsNotNone(stats["alice"]["best_share_ever"])
        self.assertEqual(stats["alice"]["best_share_ever"]["sdiff"], 50.0)

    def test_best_share_ever_under_malformed_createdate_per_user(self):
        """
        A user's only accepted, valid-sdiff share has a malformed createdate.
        It must still win best_share_ever (sdiff-only ranking) with
        timestamp "unknown", and must not be excluded outright, matching
        pool-wide behavior.
        """
        shares = [make_share(username="alice", sdiff=42.0, createdate="garbage")]
        stats = us.compute_user_statistics(shares, today=datetime.date(2026, 7, 16))
        self.assertIsNone(stats["alice"]["best_share_today"])
        self.assertIsNotNone(stats["alice"]["best_share_ever"])
        self.assertEqual(stats["alice"]["best_share_ever"]["sdiff"], 42.0)
        self.assertEqual(stats["alice"]["best_share_ever"]["timestamp"], "unknown")

    def test_out_of_range_createdate_seconds_per_user(self):
        shares = [make_share(username="alice", sdiff=7.0, createdate="99999999999999999,0")]
        stats = us.compute_user_statistics(shares, today=datetime.date(2026, 7, 16))
        self.assertIsNone(stats["alice"]["best_share_today"])
        self.assertIsNotNone(stats["alice"]["best_share_ever"])
        self.assertEqual(stats["alice"]["best_share_ever"]["timestamp"], "unknown")


# ---------------------------------------------------------------------------
# Percentile / median / sdiff-stats correctness per user
# ---------------------------------------------------------------------------
class TestPerUserPercentiles(unittest.TestCase):
    def test_full_pipeline_percentiles_per_user(self):
        shares = [make_share(username="alice", sdiff=float(i), createdate=f"{1700000000+i},0")
                  for i in range(1, 11)]
        shares += [make_share(username="bob", sdiff=100.0, createdate="1700000000,0")]
        stats = us.compute_user_statistics(shares)
        self.assertEqual(stats["alice"]["min_sdiff"], 1.0)
        self.assertEqual(stats["alice"]["max_sdiff"], 10.0)
        self.assertEqual(stats["alice"]["average_sdiff"], 5.5)
        self.assertEqual(stats["alice"]["median_sdiff"], 5.5)
        self.assertAlmostEqual(stats["alice"]["percentiles"]["p90"], 9.1)
        self.assertEqual(stats["bob"]["min_sdiff"], 100.0)
        self.assertEqual(stats["bob"]["max_sdiff"], 100.0)

    def test_many_users_varying_volumes(self):
        shares = []
        for i in range(1, 6):
            shares.append(make_share(username="heavy", sdiff=float(i), createdate=f"{1700000000+i},0"))
        shares.append(make_share(username="light", sdiff=3.0, createdate="1700000000,0"))
        stats = us.compute_user_statistics(shares)
        self.assertEqual(stats["heavy"]["accepted_count"], 5)
        self.assertEqual(stats["light"]["accepted_count"], 1)
        self.assertEqual(stats["light"]["median_sdiff"], 3.0)
        self.assertEqual(stats["heavy"]["median_sdiff"], 3.0)


# ---------------------------------------------------------------------------
# Empty dataset handling
# ---------------------------------------------------------------------------
class TestEmptyDataset(unittest.TestCase):
    def test_empty_iterable_returns_empty_dict(self):
        stats = us.compute_user_statistics([])
        self.assertEqual(stats, {})

    def test_all_shares_have_invalid_usernames_returns_empty_dict(self):
        shares = [make_share(username=None), make_share(username=""), make_share(username=5)]
        stats = us.compute_user_statistics(shares)
        self.assertEqual(stats, {})


# ---------------------------------------------------------------------------
# End-to-end: parse_share_analytics.iter_shares() -> compute_user_statistics()
# ---------------------------------------------------------------------------
class TestEndToEnd(TempLogDirMixin, unittest.TestCase):
    def test_malformed_lines_do_not_crash_and_do_not_misattribute(self):
        self.write_sharelog("a.sharelog", [
            json.dumps(make_share(username="alice", sdiff=10.0)),
            "not json at all {{{",
            "42",
            "null",
            "[1,2,3]",
            json.dumps(make_share(username="alice", sdiff=20.0))[:15],  # truncated
            json.dumps(make_share(username="bob", sdiff=30.0)),
            json.dumps({"username": "carol"}),  # missing result/sdiff/createdate
            json.dumps(make_share(username=None, sdiff=999.0)),  # excluded user
        ])
        shares = list(psa.iter_shares(self.tmpdir))
        stats = us.compute_user_statistics(shares)

        self.assertEqual(set(stats.keys()), {"alice", "bob", "carol"})
        self.assertEqual(stats["alice"]["accepted_count"], 1)
        self.assertEqual(stats["alice"]["max_sdiff"], 10.0)
        self.assertEqual(stats["bob"]["accepted_count"], 1)
        self.assertEqual(stats["bob"]["max_sdiff"], 30.0)
        # carol's share has missing result -> invalid_result_count, no sdiff stats
        self.assertEqual(stats["carol"]["invalid_result_count"], 1)
        self.assertEqual(stats["carol"]["accepted_count"], 0)
        self.assertIsNone(stats["carol"]["average_sdiff"])
        # the excluded-username share's huge sdiff must not appear anywhere
        for username, u in stats.items():
            if u["max_sdiff"] is not None:
                self.assertNotEqual(u["max_sdiff"], 999.0)

    def test_empty_logs_dir_end_to_end(self):
        shares = list(psa.iter_shares(self.tmpdir))
        stats = us.compute_user_statistics(shares)
        self.assertEqual(stats, {})


# ---------------------------------------------------------------------------
# Confirm pool_statistics.py dependency reuse (not duplicated/reimplemented)
# ---------------------------------------------------------------------------
class TestDependencyReuse(unittest.TestCase):
    def test_user_statistics_imports_helpers_from_pool_statistics_module(self):
        import pool_statistics as ps
        self.assertIs(us._BestTracker, ps._BestTracker)
        self.assertIs(us.is_valid_result, ps.is_valid_result)
        self.assertIs(us.is_valid_sdiff, ps.is_valid_sdiff)
        self.assertIs(us.parse_createdate, ps.parse_createdate)
        self.assertIs(us.createdate_to_utc, ps.createdate_to_utc)
        self.assertIs(us.median, ps.median)
        self.assertIs(us.percentile, ps.percentile)


if __name__ == "__main__":
    unittest.main()
