#!/usr/bin/env python3
"""
Independent test suite for analytics_builder.py (Feature 005 - analytics.json).

Written by an independent test engineer. Uses only synthetic/hand-crafted
sharelog fixture data written to scratch temp directories via
tempfile.mkdtemp(). Never touches /home/damopool/ckpool-solo/ckpool/logs and
never writes to /home/damopool/ckpool-solo/ckpool/analytics.json.

Run with:
    python3 -m unittest -v tests.test_analytics_builder
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import analytics_builder as ab


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


def cd(epoch_seconds, nanos=0):
    """Build a createdate string for a given epoch-seconds integer."""
    return f"{epoch_seconds},{nanos}"


class TempLogDirMixin:
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_abtest_")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def write_sharelog(self, name, lines):
        path = os.path.join(self.tmpdir, name)
        with open(path, "wb") as f:
            for line in lines:
                if isinstance(line, str):
                    line = line.encode("utf-8")
                elif isinstance(line, dict):
                    line = (json.dumps(line) + "\n").encode("utf-8")
                f.write(line)
                if not line.endswith(b"\n"):
                    f.write(b"\n")
        return path

    def write_share_lines(self, name, shares):
        """Write a list of share dicts, one JSON object per line."""
        lines = [json.dumps(s) for s in shares]
        return self.write_sharelog(name, lines)


# ---------------------------------------------------------------------------
# 0. Dependency files must remain byte-for-byte unmodified.
# ---------------------------------------------------------------------------
class TestDependenciesUnmodified(unittest.TestCase):
    REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    def _assert_unmodified(self, relpath):
        result = subprocess.run(
            ["git", "diff", "--quiet", "HEAD", "--", relpath],
            cwd=self.REPO_DIR,
        )
        self.assertEqual(
            result.returncode, 0,
            f"{relpath} differs from HEAD; dependency must remain byte-for-byte unmodified",
        )

    def test_parse_share_analytics_unmodified(self):
        self._assert_unmodified("parse_share_analytics.py")

    def test_pool_statistics_unmodified(self):
        self._assert_unmodified("pool_statistics.py")

    def test_user_statistics_unmodified(self):
        self._assert_unmodified("user_statistics.py")

    def test_worker_statistics_unmodified(self):
        self._assert_unmodified("worker_statistics.py")


# ---------------------------------------------------------------------------
# 1. Rolling window correctness
# ---------------------------------------------------------------------------
class TestRollingWindows(TempLogDirMixin, unittest.TestCase):
    def test_share_exactly_at_window_edge_is_included(self):
        now = datetime(2026, 7, 16, 12, 0, 0, tzinfo=timezone.utc)
        now_epoch = int(now.timestamp())
        edge_epoch = now_epoch - 15 * 60  # exactly 15 minutes ago
        self.write_share_lines("a.sharelog", [
            make_share(createdate=cd(edge_epoch), result=True, sdiff=2.0)
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        self.assertEqual(data["pool"]["rolling_windows"]["15m"]["accepted"], 1,
                          "share exactly at the 15m window edge must be included (inclusive boundary)")

    def test_share_one_second_past_window_edge_excluded(self):
        now = datetime(2026, 7, 16, 12, 0, 0, tzinfo=timezone.utc)
        now_epoch = int(now.timestamp())
        past_edge_epoch = now_epoch - 15 * 60 - 1
        self.write_share_lines("a.sharelog", [
            make_share(createdate=cd(past_edge_epoch), result=True, sdiff=2.0)
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        self.assertEqual(data["pool"]["rolling_windows"]["15m"]["accepted"], 0)

    def test_share_exactly_at_now_included(self):
        now = datetime(2026, 7, 16, 12, 0, 0, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [
            make_share(createdate=cd(int(now.timestamp())), result=True, sdiff=2.0)
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        self.assertEqual(data["pool"]["rolling_windows"]["15m"]["accepted"], 1)

    def test_share_in_future_excluded(self):
        now = datetime(2026, 7, 16, 12, 0, 0, tzinfo=timezone.utc)
        future_epoch = int(now.timestamp()) + 60
        self.write_share_lines("a.sharelog", [
            make_share(createdate=cd(future_epoch), result=True, sdiff=2.0)
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        for w in ("15m", "1h", "24h"):
            self.assertEqual(data["pool"]["rolling_windows"][w]["accepted"], 0,
                              f"future share must be excluded from {w} window")

    def test_invalid_result_excluded_from_windows_entirely(self):
        now = datetime(2026, 7, 16, 12, 0, 0, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [
            make_share(createdate=cd(int(now.timestamp())), result="notabool", sdiff=2.0),
            make_share(createdate=cd(int(now.timestamp())), result=None, sdiff=2.0),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        for w in ("15m", "1h", "24h"):
            win = data["pool"]["rolling_windows"][w]
            self.assertEqual(win["accepted"], 0)
            self.assertEqual(win["rejected"], 0)
            self.assertEqual(win["average_sdiff"], None)
            self.assertEqual(win["share_frequency_per_minute"], 0.0)

    def test_average_sdiff_null_when_only_rejected_in_window(self):
        now = datetime(2026, 7, 16, 12, 0, 0, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [
            make_share(createdate=cd(int(now.timestamp())), result=False, sdiff=2.0),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        win = data["pool"]["rolling_windows"]["15m"]
        self.assertEqual(win["rejected"], 1)
        self.assertIsNone(win["average_sdiff"])
        self.assertAlmostEqual(win["share_frequency_per_minute"], 1 / 15)

    def test_pool_user_worker_window_independence(self):
        """A share attributed to the pool window must independently reflect
        into user/worker windows based on THAT share's own username/workername
        validity, not vice-versa."""
        now = datetime(2026, 7, 16, 12, 0, 0, tzinfo=timezone.utc)
        ts = cd(int(now.timestamp()))
        self.write_share_lines("a.sharelog", [
            # valid username, invalid workername
            make_share(username="alice", workername=None, createdate=ts, result=True, sdiff=1.0),
            # invalid username, valid workername
            make_share(username=None, workername="rig1", createdate=ts, result=True, sdiff=2.0),
            # both valid
            make_share(username="bob", workername="rig2", createdate=ts, result=True, sdiff=3.0),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        self.assertEqual(data["pool"]["rolling_windows"]["15m"]["accepted"], 3)
        # alice has a window entry (valid username), rig1 is not a user so no user entry
        self.assertIn("alice", data["users"])
        self.assertEqual(data["users"]["alice"]["rolling_windows"]["15m"]["accepted"], 1)
        self.assertIn("bob", data["users"])
        self.assertEqual(data["users"]["bob"]["rolling_windows"]["15m"]["accepted"], 1)
        # rig1 has a worker window entry (valid workername) though its username was invalid
        self.assertIn("rig1", data["workers"])
        self.assertEqual(data["workers"]["rig1"]["rolling_windows"]["15m"]["accepted"], 1)
        self.assertIn("rig2", data["workers"])
        self.assertEqual(data["workers"]["rig2"]["rolling_windows"]["15m"]["accepted"], 1)
        # user 'alice' had no valid workername on her share -> not in her workers list
        self.assertEqual(data["users"]["alice"]["workers"], [])
        self.assertEqual(data["users"]["bob"]["workers"], ["rig2"])

    def test_user_with_no_shares_in_window_gets_empty_window_defaults(self):
        now = datetime(2026, 7, 16, 12, 0, 0, tzinfo=timezone.utc)
        # Share is only within 24h window, not 15m/1h.
        old_epoch = int(now.timestamp()) - 3 * 3600
        self.write_share_lines("a.sharelog", [
            make_share(username="carol", workername="rig3", createdate=cd(old_epoch), result=True, sdiff=5.0),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        u = data["users"]["carol"]["rolling_windows"]
        self.assertEqual(u["15m"]["accepted"], 0)
        self.assertEqual(u["15m"]["average_sdiff"], None)
        self.assertEqual(u["1h"]["accepted"], 0)
        self.assertEqual(u["24h"]["accepted"], 1)
        self.assertEqual(u["24h"]["average_sdiff"], 5.0)


# ---------------------------------------------------------------------------
# 2. users.<username>.workers
# ---------------------------------------------------------------------------
class TestUserWorkersField(TempLogDirMixin, unittest.TestCase):
    def test_both_valid_populates_workers(self):
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="rig1"),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=datetime(2026, 7, 16, tzinfo=timezone.utc))
        self.assertEqual(data["users"]["alice"]["workers"], ["rig1"])

    def test_invalid_username_excludes_pairing(self):
        self.write_share_lines("a.sharelog", [
            make_share(username=None, workername="rig1"),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=datetime(2026, 7, 16, tzinfo=timezone.utc))
        self.assertEqual(data["users"], {})

    def test_invalid_workername_excludes_pairing_but_user_entry_exists(self):
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername=None),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=datetime(2026, 7, 16, tzinfo=timezone.utc))
        self.assertIn("alice", data["users"])
        self.assertEqual(data["users"]["alice"]["workers"], [])

    def test_no_normalization_whitespace_preserved(self):
        self.write_share_lines("a.sharelog", [
            make_share(username=" alice ", workername=" rig1 "),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=datetime(2026, 7, 16, tzinfo=timezone.utc))
        self.assertIn(" alice ", data["users"])
        self.assertEqual(data["users"][" alice "]["workers"], [" rig1 "])
        self.assertNotIn("alice", data["users"])

    def test_sorted_deduplicated(self):
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="rigZ"),
            make_share(username="alice", workername="rigA"),
            make_share(username="alice", workername="rigA"),
            make_share(username="alice", workername="rigM"),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=datetime(2026, 7, 16, tzinfo=timezone.utc))
        self.assertEqual(data["users"]["alice"]["workers"], ["rigA", "rigM", "rigZ"])

    def test_populated_regardless_of_result_validity(self):
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="rig1", result=False),
            make_share(username="alice", workername="rig2", result="bad"),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=datetime(2026, 7, 16, tzinfo=timezone.utc))
        self.assertEqual(data["users"]["alice"]["workers"], ["rig1", "rig2"])


# ---------------------------------------------------------------------------
# 3. pool_start_date
# ---------------------------------------------------------------------------
class TestPoolStartDate(TempLogDirMixin, unittest.TestCase):
    def test_earliest_across_accepted_rejected_invalid(self):
        self.write_share_lines("a.sharelog", [
            make_share(createdate=cd(1_700_000_300), result=True),
            make_share(createdate=cd(1_700_000_100), result=False),
            make_share(createdate=cd(1_700_000_000), result="garbage"),  # invalid-result, earliest
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=datetime(2026, 7, 16, tzinfo=timezone.utc))
        expected = datetime.fromtimestamp(1_700_000_000, tz=timezone.utc).date().isoformat()
        self.assertEqual(data["metadata"]["pool_start_date"], expected)

    def test_null_when_no_valid_createdate(self):
        self.write_share_lines("a.sharelog", [
            make_share(createdate="garbage"),
            make_share(createdate=None),
            make_share(createdate="99999999999999999999,0"),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=datetime(2026, 7, 16, tzinfo=timezone.utc))
        self.assertIsNone(data["metadata"]["pool_start_date"])

    def test_malformed_createdate_mixed_with_valid_not_selected(self):
        self.write_share_lines("a.sharelog", [
            make_share(createdate=cd(1_700_000_500)),
            make_share(createdate="not-a-createdate"),  # malformed, must not crash/win
            make_share(createdate=cd(-5)),  # out of range (negative seconds)
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=datetime(2026, 7, 16, tzinfo=timezone.utc))
        expected = datetime.fromtimestamp(1_700_000_500, tz=timezone.utc).date().isoformat()
        self.assertEqual(data["metadata"]["pool_start_date"], expected)

    def test_earliest_record_itself_invalid_result_still_counts(self):
        self.write_share_lines("a.sharelog", [
            make_share(createdate=cd(1_700_000_000), result=None),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=datetime(2026, 7, 16, tzinfo=timezone.utc))
        expected = datetime.fromtimestamp(1_700_000_000, tz=timezone.utc).date().isoformat()
        self.assertEqual(data["metadata"]["pool_start_date"], expected)


# ---------------------------------------------------------------------------
# 4. share_records_processed / source_files_scanned
# ---------------------------------------------------------------------------
class TestCounts(TempLogDirMixin, unittest.TestCase):
    def test_counts_against_known_fixture(self):
        good = [make_share(createdate=cd(1_700_000_000 + i)) for i in range(5)]
        lines = [json.dumps(s) for s in good]
        # Insert malformed lines that never become yielded records.
        lines.insert(2, "not json at all {")
        lines.insert(3, "[1,2,3]")  # valid JSON, not an object
        lines.insert(4, "null")     # valid JSON, not an object
        lines.insert(0, "")         # blank line
        path = self.write_sharelog("a.sharelog", lines)
        # Also append an invalid-UTF-8 line manually.
        with open(path, "ab") as f:
            f.write(b"\xff\xfe not valid utf8\n")

        data = ab.build_analytics(logs_dir=self.tmpdir, now=datetime(2026, 7, 16, tzinfo=timezone.utc))
        self.assertEqual(data["metadata"]["share_records_processed"], 5)
        self.assertEqual(data["metadata"]["source_files_scanned"], 1)

    def test_invalid_result_records_are_counted(self):
        self.write_share_lines("a.sharelog", [
            make_share(result=True),
            make_share(result=False),
            make_share(result="neither"),
            make_share(result=None),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=datetime(2026, 7, 16, tzinfo=timezone.utc))
        self.assertEqual(data["metadata"]["share_records_processed"], 4)

    def test_multiple_files_scanned(self):
        self.write_share_lines("a.sharelog", [make_share()])
        self.write_share_lines("b.sharelog", [make_share(), make_share()])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=datetime(2026, 7, 16, tzinfo=timezone.utc))
        self.assertEqual(data["metadata"]["source_files_scanned"], 2)
        self.assertEqual(data["metadata"]["share_records_processed"], 3)


# ---------------------------------------------------------------------------
# 5. daily_bests: date-keying + chronological supersession algorithm
# ---------------------------------------------------------------------------
class TestDailyBests(TempLogDirMixin, unittest.TestCase):
    def test_out_of_order_input_still_chronological(self):
        now = datetime(2026, 7, 16, 20, 0, 0, tzinfo=timezone.utc)
        today_midnight = int(datetime(2026, 7, 16, 0, 0, 0, tzinfo=timezone.utc).timestamp())
        # Later-timestamped LOW share appears BEFORE earlier-timestamped HIGH share in input.
        later_low = make_share(username="alice", sdiff=2.0, createdate=cd(today_midnight + 3600))
        earlier_high = make_share(username="alice", sdiff=10.0, createdate=cd(today_midnight + 1800))
        self.write_share_lines("a.sharelog", [later_low, earlier_high])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        today_key = "2026-07-16"
        entry = data["daily_bests"][today_key]["users"]["alice"]
        # Chronologically: earlier_high (sdiff=10) happens first -> becomes current.
        # Then later_low (sdiff=2) happens second, but 2 < 10, so it does NOT supersede.
        self.assertEqual(entry["current_daily_best"]["sdiff"], 10.0)
        self.assertIsNone(entry["previous_daily_best"])

    def test_out_of_order_input_correct_supersession_when_later_is_higher(self):
        now = datetime(2026, 7, 16, 20, 0, 0, tzinfo=timezone.utc)
        today_midnight = int(datetime(2026, 7, 16, 0, 0, 0, tzinfo=timezone.utc).timestamp())
        # Input order: high-later share first, then low-earlier share.
        high_later = make_share(username="alice", sdiff=10.0, createdate=cd(today_midnight + 3600))
        low_earlier = make_share(username="alice", sdiff=2.0, createdate=cd(today_midnight + 1800))
        self.write_share_lines("a.sharelog", [high_later, low_earlier])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        entry = data["daily_bests"]["2026-07-16"]["users"]["alice"]
        # Chronologically: low_earlier (sdiff=2) first -> current=2.
        # Then high_later (sdiff=10) supersedes -> current=10, previous=2.
        self.assertEqual(entry["current_daily_best"]["sdiff"], 10.0)
        self.assertEqual(entry["previous_daily_best"]["sdiff"], 2.0)
        self.assertAlmostEqual(entry["improvement_amount"], 8.0)
        self.assertAlmostEqual(entry["improvement_percentage"], 400.0)

    def test_three_record_breaking_shares_previous_is_second_to_last(self):
        now = datetime(2026, 7, 16, 20, 0, 0, tzinfo=timezone.utc)
        base = int(datetime(2026, 7, 16, 0, 0, 0, tzinfo=timezone.utc).timestamp())
        shares = [
            make_share(username="alice", sdiff=1.0, createdate=cd(base + 100)),
            make_share(username="alice", sdiff=5.0, createdate=cd(base + 200)),
            make_share(username="alice", sdiff=50.0, createdate=cd(base + 300)),
        ]
        self.write_share_lines("a.sharelog", shares)
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        entry = data["daily_bests"]["2026-07-16"]["users"]["alice"]
        self.assertEqual(entry["current_daily_best"]["sdiff"], 50.0)
        self.assertEqual(entry["previous_daily_best"]["sdiff"], 5.0,
                          "previous must be the share immediately before current, not the very first share")

    def test_exact_sdiff_tie_no_crash(self):
        now = datetime(2026, 7, 16, 20, 0, 0, tzinfo=timezone.utc)
        base = int(datetime(2026, 7, 16, 0, 0, 0, tzinfo=timezone.utc).timestamp())
        shares = [
            make_share(username="alice", sdiff=7.0, createdate=cd(base + 100)),
            make_share(username="alice", sdiff=7.0, createdate=cd(base + 200)),
        ]
        self.write_share_lines("a.sharelog", shares)
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        entry = data["daily_bests"]["2026-07-16"]["users"]["alice"]
        self.assertEqual(entry["current_daily_best"]["sdiff"], 7.0)
        # Sensible / documented behavior: tie does not "overtake", so previous stays None.
        self.assertIsNone(entry["previous_daily_best"])
        self.assertIsNone(entry["improvement_amount"])
        self.assertIsNone(entry["improvement_percentage"])

    def test_invalid_sdiff_excluded_from_candidacy(self):
        now = datetime(2026, 7, 16, 20, 0, 0, tzinfo=timezone.utc)
        base = int(datetime(2026, 7, 16, 0, 0, 0, tzinfo=timezone.utc).timestamp())
        bad_sdiffs = [-1.0, 0, float("nan"), float("inf"), True, "5.0", None]
        shares = []
        for i, bad in enumerate(bad_sdiffs):
            shares.append(make_share(username="alice", sdiff=bad, createdate=cd(base + i), result=True))
        self.write_share_lines("a.sharelog", shares)
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        entry = data["daily_bests"]["2026-07-16"]["users"].get("alice")
        self.assertIsNone(entry, "no valid-sdiff candidates should mean alice has no daily_bests entry at all")

    def test_only_one_candidate_previous_is_null(self):
        now = datetime(2026, 7, 16, 20, 0, 0, tzinfo=timezone.utc)
        base = int(datetime(2026, 7, 16, 0, 0, 0, tzinfo=timezone.utc).timestamp())
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", sdiff=3.0, createdate=cd(base + 100)),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        entry = data["daily_bests"]["2026-07-16"]["users"]["alice"]
        self.assertIsNone(entry["previous_daily_best"])
        self.assertIsNone(entry["improvement_amount"])
        self.assertIsNone(entry["improvement_percentage"])

    def test_today_key_always_present_even_when_empty(self):
        now = datetime(2026, 7, 16, 20, 0, 0, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        self.assertIn("2026-07-16", data["daily_bests"])
        self.assertEqual(data["daily_bests"]["2026-07-16"], {"users": {}})

    def test_yesterday_key_absent_when_no_qualifying_data(self):
        now = datetime(2026, 7, 16, 20, 0, 0, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        self.assertNotIn("2026-07-15", data["daily_bests"])

    def test_yesterday_key_present_when_qualifying_data_exists(self):
        now = datetime(2026, 7, 16, 20, 0, 0, tzinfo=timezone.utc)
        yesterday_ts = int(datetime(2026, 7, 15, 12, 0, 0, tzinfo=timezone.utc).timestamp())
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", sdiff=4.0, createdate=cd(yesterday_ts)),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        self.assertIn("2026-07-15", data["daily_bests"])
        self.assertEqual(data["daily_bests"]["2026-07-15"]["users"]["alice"]["current_daily_best"]["sdiff"], 4.0)

    def test_older_than_yesterday_absent_from_daily_bests(self):
        now = datetime(2026, 7, 16, 20, 0, 0, tzinfo=timezone.utc)
        old_ts = int(datetime(2026, 7, 10, 12, 0, 0, tzinfo=timezone.utc).timestamp())
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", sdiff=4.0, createdate=cd(old_ts)),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        self.assertNotIn("2026-07-10", data["daily_bests"])
        self.assertEqual(len(data["daily_bests"]), 1)  # only today
        # but it should still show up in pool-wide stats
        self.assertEqual(data["pool"]["accepted_count"], 1)
        self.assertIn("alice", data["users"])


# ---------------------------------------------------------------------------
# 7. live_ticker
# ---------------------------------------------------------------------------
class TestLiveTicker(TempLogDirMixin, unittest.TestCase):
    def test_ordering_descending_by_timestamp(self):
        now = datetime(2026, 7, 16, 20, 0, 0, tzinfo=timezone.utc)
        base = int(datetime(2026, 7, 16, 0, 0, 0, tzinfo=timezone.utc).timestamp())
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="w1", sdiff=3.0, createdate=cd(base + 100)),
            make_share(username="bob", workername="w2", sdiff=3.0, createdate=cd(base + 5000)),
            make_share(username="carol", workername="w3", sdiff=3.0, createdate=cd(base + 2000)),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        usernames = [e["username"] for e in data["live_ticker"]]
        self.assertEqual(usernames, ["bob", "carol", "alice"])

    def test_excludes_users_with_no_today_daily_best(self):
        now = datetime(2026, 7, 16, 20, 0, 0, tzinfo=timezone.utc)
        yesterday_ts = int(datetime(2026, 7, 15, 12, 0, 0, tzinfo=timezone.utc).timestamp())
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", sdiff=4.0, createdate=cd(yesterday_ts)),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        self.assertEqual(data["live_ticker"], [])

    def test_field_shape(self):
        now = datetime(2026, 7, 16, 20, 0, 0, tzinfo=timezone.utc)
        base = int(datetime(2026, 7, 16, 0, 0, 0, tzinfo=timezone.utc).timestamp())
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="w1", sdiff=2.0, createdate=cd(base + 100)),
            make_share(username="alice", workername="w2", sdiff=9.0, createdate=cd(base + 200)),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        entry = data["live_ticker"][0]
        self.assertEqual(set(entry.keys()), {
            "username", "workername", "current_daily_best", "previous_daily_best",
            "improvement_amount", "improvement_percentage", "timestamp",
        })
        self.assertEqual(set(entry["current_daily_best"].keys()), {"sdiff", "timestamp"})
        self.assertEqual(set(entry["previous_daily_best"].keys()), {"sdiff", "timestamp"})
        self.assertEqual(entry["workername"], "w2")
        self.assertEqual(entry["current_daily_best"]["sdiff"], 9.0)
        self.assertEqual(entry["previous_daily_best"]["sdiff"], 2.0)


# ---------------------------------------------------------------------------
# 8. write_analytics atomicity
# ---------------------------------------------------------------------------
class TestWriteAnalytics(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_abwrite_")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_normal_write_round_trips(self):
        path = os.path.join(self.tmpdir, "analytics.json")
        data = {"metadata": {"schema_version": "1.1"}, "pool": {}, "users": {},
                "workers": {}, "daily_bests": {}, "live_ticker": []}
        ab.write_analytics(data, path)
        with open(path) as f:
            loaded = json.load(f)
        self.assertEqual(loaded, data)

    def test_no_leftover_temp_file_after_success(self):
        path = os.path.join(self.tmpdir, "analytics.json")
        ab.write_analytics({"a": 1}, path)
        remaining = os.listdir(self.tmpdir)
        self.assertEqual(remaining, ["analytics.json"])

    def test_failure_leaves_no_target_and_no_temp_file(self):
        path = os.path.join(self.tmpdir, "analytics.json")
        # A set() is not JSON-serializable -> json.dump will raise TypeError.
        with self.assertRaises(TypeError):
            ab.write_analytics({"bad": {1, 2, 3}}, path)
        self.assertFalse(os.path.exists(path), "target file must not exist after a failed write")
        remaining = os.listdir(self.tmpdir)
        self.assertEqual(remaining, [], f"no temp file should remain, found: {remaining}")

    def test_failure_does_not_corrupt_existing_target(self):
        path = os.path.join(self.tmpdir, "analytics.json")
        good_data = {"good": True}
        ab.write_analytics(good_data, path)
        with self.assertRaises(TypeError):
            ab.write_analytics({"bad": {1, 2, 3}}, path)
        with open(path) as f:
            loaded = json.load(f)
        self.assertEqual(loaded, good_data, "existing target must survive a failed subsequent write untouched")


# ---------------------------------------------------------------------------
# 9. End-to-end
# ---------------------------------------------------------------------------
class TestEndToEnd(TempLogDirMixin, unittest.TestCase):
    def test_full_output_well_formed_and_consistent(self):
        now = datetime(2026, 7, 16, 20, 0, 0, tzinfo=timezone.utc)
        today_base = int(datetime(2026, 7, 16, 0, 0, 0, tzinfo=timezone.utc).timestamp())
        yesterday_base = int(datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc).timestamp())
        old_base = int(datetime(2026, 7, 1, 0, 0, 0, tzinfo=timezone.utc).timestamp())

        shares = [
            make_share(username="alice", workername="alice.rig1", sdiff=5.0, createdate=cd(today_base + 100), result=True),
            make_share(username="alice", workername="alice.rig1", sdiff=1.0, createdate=cd(today_base + 50), result=False),
            make_share(username="bob", workername="bob.rig1", sdiff=3.0, createdate=cd(yesterday_base + 100), result=True),
            make_share(username="bob", workername="bob.rig1", sdiff=7.0, createdate=cd(old_base + 100), result=True),
            make_share(username="carol", workername="carol.rig1", sdiff=2.0, createdate=cd(today_base + 200), result="garbage"),
        ]
        lines = [json.dumps(s) for s in shares]
        lines.append("not json {{{")
        path1 = self.write_sharelog("file1.sharelog", lines)
        with open(path1, "ab") as f:
            f.write(b"\xff\xfe invalid utf8\n")

        self.write_share_lines("file2.sharelog", [
            make_share(username="dave", workername="dave.rig1", sdiff=9.0, createdate=cd(today_base + 300), result=True),
        ])

        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)

        # Well-formed / JSON-serializable
        serialized = json.dumps(data)
        self.assertIsInstance(serialized, str)
        self.assertEqual(set(data.keys()), {"metadata", "pool", "users", "workers", "daily_bests", "live_ticker"})

        # share_records_processed matches count of valid yielded records (5 + 1 = 6)
        self.assertEqual(data["metadata"]["share_records_processed"], 6)
        self.assertEqual(data["metadata"]["source_files_scanned"], 2)

        # pool_start_date reflects earliest across ALL records (old_base share)
        expected_start = datetime.fromtimestamp(old_base + 100, tz=timezone.utc).date().isoformat()
        self.assertEqual(data["metadata"]["pool_start_date"], expected_start)

        # older-than-yesterday share still counts toward pool/user/worker stats
        self.assertIn("bob", data["users"])
        self.assertEqual(data["users"]["bob"]["accepted_count"], 2)  # yesterday + old
        self.assertIn("bob.rig1", data["workers"])

        # older-than-yesterday share must NOT appear in daily_bests
        self.assertNotIn(datetime.fromtimestamp(old_base, tz=timezone.utc).date().isoformat(), data["daily_bests"])

        # daily_bests only has today + yesterday (2 keys)
        self.assertEqual(set(data["daily_bests"].keys()), {"2026-07-16", "2026-07-15"})

        # carol had invalid result -> no accepted candidacy -> not in today's daily_bests users
        self.assertNotIn("carol", data["daily_bests"]["2026-07-16"]["users"])
        # but carol IS a valid-username, valid-workername pairing -> shows up in users_out workers
        self.assertIn("carol", data["users"])
        self.assertEqual(data["users"]["carol"]["workers"], ["carol.rig1"])

        # live_ticker only contains users with a today entry: alice(accepted, sdiff5) and dave
        ticker_users = {e["username"] for e in data["live_ticker"]}
        self.assertEqual(ticker_users, {"alice", "dave"})



# ---------------------------------------------------------------------------
# 10. Additional edge cases found during independent exploration
# ---------------------------------------------------------------------------
class TestAdditionalEdgeCases(TempLogDirMixin, unittest.TestCase):
    def test_completely_empty_logs_dir_no_crash_and_well_formed(self):
        now = datetime(2026, 7, 16, 12, 0, 0, tzinfo=timezone.utc)
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        json.dumps(data)  # must be serializable
        self.assertEqual(data["metadata"]["share_records_processed"], 0)
        self.assertEqual(data["metadata"]["source_files_scanned"], 0)
        self.assertIsNone(data["metadata"]["pool_start_date"])
        self.assertEqual(data["users"], {})
        self.assertEqual(data["workers"], {})
        self.assertEqual(data["daily_bests"], {"2026-07-16": {"users": {}}})
        self.assertEqual(data["live_ticker"], [])

    def test_naive_now_raises_typeerror(self):
        """FINDING: build_analytics has no documented UTC-awareness contract
        for `now` (unlike compute_worker_statistics, which documents this
        explicitly). Passing a naive datetime crashes with TypeError deep in
        is_within_window's subtraction. Documented here as a regression test
        for the crash; see findings report for severity/recommendation."""
        self.write_share_lines("a.sharelog", [make_share(createdate=cd(1_700_000_000))])
        naive_now = datetime(2026, 7, 16, 12, 0, 0)  # no tzinfo
        with self.assertRaises(TypeError):
            ab.build_analytics(logs_dir=self.tmpdir, now=naive_now)

    def test_daily_best_candidacy_does_not_require_valid_workername(self):
        """Per the 2026-07-16 spec, daily-best candidacy only requires
        result/sdiff/createdate/username validity -- workername is NOT
        checked. Confirms current behavior: an invalid/null workername flows
        through verbatim into daily_bests and live_ticker."""
        now = datetime(2026, 7, 16, 20, 0, 0, tzinfo=timezone.utc)
        base = int(datetime(2026, 7, 16, 0, 0, 0, tzinfo=timezone.utc).timestamp())
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername=None, sdiff=9.0, createdate=cd(base + 100)),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        entry = data["daily_bests"]["2026-07-16"]["users"]["alice"]
        self.assertIsNone(entry["current_daily_best"]["workername"])
        self.assertIsNone(data["live_ticker"][0]["workername"])

    def test_same_second_different_nanosecond_ticker_ordering_not_guaranteed(self):
        """FINDING: live_ticker timestamps are derived from createdate_to_utc,
        which is second-resolution only (nanoseconds dropped). Two different
        users' current_daily_best shares landing in the same second sort as
        ties in the ticker regardless of true nanosecond order, since the
        sort key is the lossy ISO string. Documented as a regression test,
        not asserting a specific tie-break (there isn't a defined one)."""
        now = datetime(2026, 7, 16, 20, 0, 0, tzinfo=timezone.utc)
        base = int(datetime(2026, 7, 16, 0, 0, 0, tzinfo=timezone.utc).timestamp())
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="w1", sdiff=9.0, createdate=cd(base + 100, 900_000_000)),
            make_share(username="bob", workername="w2", sdiff=9.0, createdate=cd(base + 100, 100_000_000)),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now)
        timestamps = {e["username"]: e["timestamp"] for e in data["live_ticker"]}
        # Both collapse to the same second-resolution ISO timestamp.
        self.assertEqual(timestamps["alice"], timestamps["bob"])


if __name__ == "__main__":
    unittest.main()
