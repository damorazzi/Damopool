#!/usr/bin/env python3
"""
Independent test suite for worker_statistics.py (Feature 004 - Worker Statistics).

Written by an independent test engineer. Uses only synthetic/hand-crafted
sharelog fixture data written to a scratch temp directory. Never touches
/home/damopool/ckpool-solo/ckpool/logs.

Run with:
    python3 -m unittest -v tests.test_worker_statistics
"""
import datetime
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import parse_share_analytics as psa
import worker_statistics as ws


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
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_wtest_")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def write_sharelog(self, name, lines):
        path = os.path.join(self.tmpdir, name)
        with open(path, "wb") as f:
            for line in lines:
                if isinstance(line, str):
                    line = line.encode("utf-8")
                f.write(line)
                if not line.endswith(b"\n"):
                    f.write(b"\n")
        return path


# ---------------------------------------------------------------------------
# workername validation / grouping
# ---------------------------------------------------------------------------
class TestWorkernameValidation(unittest.TestCase):
    def test_valid_string_workername_creates_entry(self):
        stats = ws.compute_worker_statistics([make_share(workername="rig1")])
        self.assertIn("rig1", stats)

    def test_missing_workername_key_excluded(self):
        share = make_share()
        del share["workername"]
        stats = ws.compute_worker_statistics([share])
        self.assertEqual(stats, {})

    def test_none_workername_excluded(self):
        stats = ws.compute_worker_statistics([make_share(workername=None)])
        self.assertEqual(stats, {})

    def test_empty_string_workername_excluded(self):
        stats = ws.compute_worker_statistics([make_share(workername="")])
        self.assertEqual(stats, {})

    def test_whitespace_only_workername_excluded_several_variants(self):
        for bad in ["   ", "\t", "\n", " \t \n "]:
            stats = ws.compute_worker_statistics([make_share(workername=bad)])
            self.assertEqual(stats, {}, f"whitespace-only workername {bad!r} must be excluded")

    def test_int_workername_excluded(self):
        stats = ws.compute_worker_statistics([make_share(workername=42)])
        self.assertEqual(stats, {})

    def test_list_workername_excluded(self):
        stats = ws.compute_worker_statistics([make_share(workername=["rig1"])])
        self.assertEqual(stats, {})

    def test_dict_workername_excluded(self):
        stats = ws.compute_worker_statistics([make_share(workername={"a": 1})])
        self.assertEqual(stats, {})

    def test_bool_workername_excluded(self):
        stats = ws.compute_worker_statistics([make_share(workername=True)])
        self.assertEqual(stats, {})
        stats = ws.compute_worker_statistics([make_share(workername=False)])
        self.assertEqual(stats, {})

    def test_valid_workername_with_surrounding_whitespace_preserved_verbatim(self):
        stats = ws.compute_worker_statistics(
            [make_share(workername=" rig1 ", sdiff=5.0)]
        )
        self.assertIn(" rig1 ", stats)
        self.assertNotIn("rig1", stats)
        self.assertEqual(stats[" rig1 "]["best_share_ever"]["workername"], " rig1 ")

    def test_all_invalid_workername_batch_returns_empty_dict(self):
        shares = [
            make_share(workername=None),
            make_share(workername=""),
            make_share(workername="   "),
            make_share(workername=123),
            make_share(workername=["x"]),
            make_share(workername={"x": 1}),
            make_share(workername=True),
        ]
        stats = ws.compute_worker_statistics(shares)
        self.assertEqual(stats, {})

    def test_empty_shares_iterable_returns_empty_dict(self):
        stats = ws.compute_worker_statistics([])
        self.assertEqual(stats, {})

    def test_mixed_valid_and_invalid_workernames_no_leak(self):
        shares = [
            make_share(workername="rig1", sdiff=10.0),
            make_share(workername=None, sdiff=999.0),
            make_share(workername="", sdiff=999.0),
            make_share(workername=123, sdiff=999.0),
            make_share(workername="rig2", sdiff=20.0),
        ]
        stats = ws.compute_worker_statistics(shares)
        self.assertEqual(set(stats.keys()), {"rig1", "rig2"})
        self.assertEqual(stats["rig1"]["max_sdiff"], 10.0)
        self.assertEqual(stats["rig2"]["max_sdiff"], 20.0)


# ---------------------------------------------------------------------------
# Per-worker independence
# ---------------------------------------------------------------------------
class TestPerWorkerIndependence(unittest.TestCase):
    def test_bad_sdiff_for_one_worker_does_not_affect_other(self):
        shares = [
            make_share(workername="rig1", sdiff=-5, result=True),
            make_share(workername="rig2", sdiff=10.0, result=True),
        ]
        stats = ws.compute_worker_statistics(shares)
        self.assertEqual(stats["rig1"]["accepted_count"], 1)
        self.assertIsNone(stats["rig1"]["average_sdiff"])
        self.assertIsNone(stats["rig1"]["best_share_ever"])
        self.assertEqual(stats["rig2"]["accepted_count"], 1)
        self.assertEqual(stats["rig2"]["average_sdiff"], 10.0)

    def test_bad_createdate_for_one_worker_does_not_affect_other(self):
        today = datetime.date(2026, 7, 16)
        good_ts = int(datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc).timestamp())
        shares = [
            make_share(workername="rig1", sdiff=10.0, createdate="not-a-timestamp"),
            make_share(workername="rig2", sdiff=20.0, createdate=f"{good_ts},0"),
        ]
        stats = ws.compute_worker_statistics(shares, today=today)
        self.assertIsNone(stats["rig1"]["best_share_today"])
        self.assertIsNotNone(stats["rig1"]["best_share_ever"])
        self.assertEqual(stats["rig1"]["best_share_ever"]["timestamp"], "unknown")
        self.assertIsNone(stats["rig1"]["first_share_at"])
        self.assertIsNone(stats["rig1"]["last_share_at"])
        self.assertIsNotNone(stats["rig2"]["best_share_today"])
        self.assertIsNotNone(stats["rig2"]["first_share_at"])

    def test_bad_agent_for_one_worker_does_not_affect_other(self):
        shares = [
            make_share(workername="rig1", agent=None),
            make_share(workername="rig2", agent="cgminer/1.0"),
        ]
        stats = ws.compute_worker_statistics(shares)
        self.assertIsNone(stats["rig1"]["agent"])
        self.assertEqual(stats["rig2"]["agent"], "cgminer/1.0")

    def test_invalid_result_for_one_worker_does_not_affect_other(self):
        shares = [
            make_share(workername="rig1", result="not-a-bool"),
            make_share(workername="rig2", result=True, sdiff=5.0),
        ]
        stats = ws.compute_worker_statistics(shares)
        self.assertEqual(stats["rig1"]["invalid_result_count"], 1)
        self.assertEqual(stats["rig1"]["accepted_count"], 0)
        self.assertEqual(stats["rig2"]["accepted_count"], 1)


# ---------------------------------------------------------------------------
# agent tracking
# ---------------------------------------------------------------------------
class TestAgentTracking(unittest.TestCase):
    def test_agent_updates_to_latest_seen_in_iteration_order(self):
        shares = [
            make_share(workername="rig1", agent="firmwareA"),
            make_share(workername="rig1", agent="firmwareB"),
            make_share(workername="rig1", agent="firmwareC"),
        ]
        stats = ws.compute_worker_statistics(shares)
        self.assertEqual(stats["rig1"]["agent"], "firmwareC")

    def test_agent_updates_on_rejected_share(self):
        shares = [
            make_share(workername="rig1", agent="firmwareA", result=True),
            make_share(workername="rig1", agent="firmwareB", result=False),
        ]
        stats = ws.compute_worker_statistics(shares)
        self.assertEqual(stats["rig1"]["agent"], "firmwareB")

    def test_agent_updates_on_invalid_result_share(self):
        shares = [
            make_share(workername="rig1", agent="firmwareA", result=True),
            make_share(workername="rig1", agent="firmwareB", result="not-a-bool"),
        ]
        stats = ws.compute_worker_statistics(shares)
        self.assertEqual(stats["rig1"]["agent"], "firmwareB")

    def test_invalid_agent_does_not_overwrite_previous_valid_agent_none(self):
        shares = [
            make_share(workername="rig1", agent="firmwareA"),
            make_share(workername="rig1", agent=None),
        ]
        stats = ws.compute_worker_statistics(shares)
        self.assertEqual(stats["rig1"]["agent"], "firmwareA")

    def test_invalid_agent_does_not_overwrite_previous_valid_agent_nonstring(self):
        shares = [
            make_share(workername="rig1", agent="firmwareA"),
            make_share(workername="rig1", agent=123),
        ]
        stats = ws.compute_worker_statistics(shares)
        self.assertEqual(stats["rig1"]["agent"], "firmwareA")

    def test_invalid_agent_does_not_overwrite_previous_valid_agent_empty(self):
        shares = [
            make_share(workername="rig1", agent="firmwareA"),
            make_share(workername="rig1", agent=""),
        ]
        stats = ws.compute_worker_statistics(shares)
        self.assertEqual(stats["rig1"]["agent"], "firmwareA")

    def test_invalid_agent_does_not_overwrite_previous_valid_agent_whitespace(self):
        shares = [
            make_share(workername="rig1", agent="firmwareA"),
            make_share(workername="rig1", agent="   "),
        ]
        stats = ws.compute_worker_statistics(shares)
        self.assertEqual(stats["rig1"]["agent"], "firmwareA")

    def test_worker_with_no_valid_agent_ever_has_none(self):
        shares = [
            make_share(workername="rig1", agent=None),
            make_share(workername="rig1", agent=""),
            make_share(workername="rig1", agent="   "),
            make_share(workername="rig1", agent=999),
        ]
        stats = ws.compute_worker_statistics(shares)
        self.assertIsNone(stats["rig1"]["agent"])

    def test_worker_missing_agent_key_entirely_has_none(self):
        share = make_share(workername="rig1")
        del share["agent"]
        stats = ws.compute_worker_statistics([share])
        self.assertIsNone(stats["rig1"]["agent"])


# ---------------------------------------------------------------------------
# first_share_at / last_share_at
# ---------------------------------------------------------------------------
class TestFirstLastShareAt(unittest.TestCase):
    def test_out_of_order_createdates_produce_correct_min_max(self):
        shares = [
            make_share(workername="rig1", createdate="1700000500,0"),
            make_share(workername="rig1", createdate="1700000100,0"),
            make_share(workername="rig1", createdate="1700000900,0"),
            make_share(workername="rig1", createdate="1700000300,0"),
        ]
        stats = ws.compute_worker_statistics(shares)
        first = stats["rig1"]["first_share_at"]
        last = stats["rig1"]["last_share_at"]
        expected_first = ws.createdate_to_utc((1700000100, 0)).isoformat()
        expected_last = ws.createdate_to_utc((1700000900, 0)).isoformat()
        self.assertEqual(first, expected_first)
        self.assertEqual(last, expected_last)

    def test_nanosecond_level_ordering(self):
        # Same second, different nanoseconds -- must use createdate_sort_key,
        # not just second-level comparison.
        shares = [
            make_share(workername="rig1", createdate="1700000000,500000000"),
            make_share(workername="rig1", createdate="1700000000,100000000"),
            make_share(workername="rig1", createdate="1700000000,900000000"),
        ]
        stats = ws.compute_worker_statistics(shares)
        # first/last_share_at only carry second resolution (createdate_to_utc
        # drops nanoseconds), so we verify ordering indirectly via a
        # nanosecond-only difference producing identical ISO timestamps but
        # confirm no crash and correct behavior when combined with
        # second-level differences below.
        self.assertIsNotNone(stats["rig1"]["first_share_at"])
        self.assertIsNotNone(stats["rig1"]["last_share_at"])
        # both isoformat identical since same second; sanity check equality
        self.assertEqual(stats["rig1"]["first_share_at"], stats["rig1"]["last_share_at"])

    def test_nanosecond_ordering_across_second_boundary(self):
        # rig1 second=100 with high nanos should sort before second=101 with
        # low nanos -- basic sanity that seconds dominate nanos correctly,
        # exercising createdate_sort_key.
        shares = [
            make_share(workername="rig1", createdate="1700000101,000000001"),
            make_share(workername="rig1", createdate="1700000100,999999999"),
        ]
        stats = ws.compute_worker_statistics(shares)
        expected_first = ws.createdate_to_utc((1700000100, 999999999)).isoformat()
        expected_last = ws.createdate_to_utc((1700000101, 1)).isoformat()
        self.assertEqual(stats["rig1"]["first_share_at"], expected_first)
        self.assertEqual(stats["rig1"]["last_share_at"], expected_last)

    def test_tied_createdates(self):
        shares = [
            make_share(workername="rig1", createdate="1700000000,0"),
            make_share(workername="rig1", createdate="1700000000,0"),
        ]
        stats = ws.compute_worker_statistics(shares)
        expected = ws.createdate_to_utc((1700000000, 0)).isoformat()
        self.assertEqual(stats["rig1"]["first_share_at"], expected)
        self.assertEqual(stats["rig1"]["last_share_at"], expected)

    def test_worker_with_only_invalid_createdate_has_null_first_and_last(self):
        shares = [
            make_share(workername="rig1", createdate="garbage"),
            make_share(workername="rig1", createdate=None),
        ]
        stats = ws.compute_worker_statistics(shares)
        self.assertIsNone(stats["rig1"]["first_share_at"])
        self.assertIsNone(stats["rig1"]["last_share_at"])

    def test_worker_missing_createdate_key_has_null_first_and_last(self):
        share = make_share(workername="rig1")
        del share["createdate"]
        stats = ws.compute_worker_statistics([share])
        self.assertIsNone(stats["rig1"]["first_share_at"])
        self.assertIsNone(stats["rig1"]["last_share_at"])

    def test_first_last_share_at_updates_on_rejected_share(self):
        shares = [
            make_share(workername="rig1", result=False, createdate="1700000000,0"),
        ]
        stats = ws.compute_worker_statistics(shares)
        self.assertIsNotNone(stats["rig1"]["first_share_at"])
        self.assertIsNotNone(stats["rig1"]["last_share_at"])

    def test_first_last_share_at_updates_on_invalid_result_share(self):
        shares = [
            make_share(workername="rig1", result="not-a-bool", createdate="1700000000,0"),
        ]
        stats = ws.compute_worker_statistics(shares)
        self.assertIsNotNone(stats["rig1"]["first_share_at"])
        self.assertIsNotNone(stats["rig1"]["last_share_at"])

    def test_out_of_range_createdate_does_not_update_first_last_share_at(self):
        # A malformed/out-of-range createdate on an otherwise-accepted share
        # is still eligible for best_share_ever (timestamp "unknown") but
        # per design must NOT update first_share_at/last_share_at, since
        # parse_createdate returned None.
        shares = [
            make_share(workername="rig1", sdiff=42.0, createdate="99999999999999999,0"),
        ]
        stats = ws.compute_worker_statistics(shares, today=datetime.date(2026, 7, 16))
        self.assertIsNone(stats["rig1"]["first_share_at"])
        self.assertIsNone(stats["rig1"]["last_share_at"])
        self.assertIsNotNone(stats["rig1"]["best_share_ever"])
        self.assertEqual(stats["rig1"]["best_share_ever"]["timestamp"], "unknown")

    def test_malformed_createdate_does_not_update_first_last_share_at(self):
        shares = [
            make_share(workername="rig1", sdiff=42.0, createdate="garbage"),
        ]
        stats = ws.compute_worker_statistics(shares, today=datetime.date(2026, 7, 16))
        self.assertIsNone(stats["rig1"]["first_share_at"])
        self.assertIsNone(stats["rig1"]["last_share_at"])
        self.assertIsNotNone(stats["rig1"]["best_share_ever"])
        self.assertEqual(stats["rig1"]["best_share_ever"]["timestamp"], "unknown")

    def test_mixed_valid_and_invalid_createdate_only_valid_counted(self):
        shares = [
            make_share(workername="rig1", createdate="garbage"),
            make_share(workername="rig1", createdate="1700000500,0"),
            make_share(workername="rig1", createdate=None),
        ]
        stats = ws.compute_worker_statistics(shares)
        expected = ws.createdate_to_utc((1700000500, 0)).isoformat()
        self.assertEqual(stats["rig1"]["first_share_at"], expected)
        self.assertEqual(stats["rig1"]["last_share_at"], expected)


# ---------------------------------------------------------------------------
# is_active boundary correctness
# ---------------------------------------------------------------------------
class TestIsActive(unittest.TestCase):
    def _share_at(self, dt, workername="rig1"):
        ts = int(dt.timestamp())
        return make_share(workername=workername, createdate=f"{ts},0")

    def test_exactly_15_minutes_before_now_is_active_inclusive_boundary(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        share_time = now - datetime.timedelta(minutes=15)
        stats = ws.compute_worker_statistics([self._share_at(share_time)], now=now)
        self.assertTrue(stats["rig1"]["is_active"])

    def test_one_second_past_15_minutes_is_inactive(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        share_time = now - datetime.timedelta(minutes=15, seconds=1)
        stats = ws.compute_worker_statistics([self._share_at(share_time)], now=now)
        self.assertFalse(stats["rig1"]["is_active"])

    def test_share_exactly_at_now_is_active(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        stats = ws.compute_worker_statistics([self._share_at(now)], now=now)
        self.assertTrue(stats["rig1"]["is_active"])

    def test_share_in_future_relative_to_now_is_not_active(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        share_time = now + datetime.timedelta(minutes=1)
        stats = ws.compute_worker_statistics([self._share_at(share_time)], now=now)
        self.assertFalse(
            stats["rig1"]["is_active"],
            "a share timestamped in the future relative to now must not count as active",
        )

    def test_share_far_in_future_is_not_active(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        share_time = now + datetime.timedelta(days=1)
        stats = ws.compute_worker_statistics([self._share_at(share_time)], now=now)
        self.assertFalse(stats["rig1"]["is_active"])

    def test_null_last_share_at_is_not_active_no_crash(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        shares = [make_share(workername="rig1", createdate="garbage")]
        stats = ws.compute_worker_statistics(shares, now=now)
        self.assertIsNone(stats["rig1"]["last_share_at"])
        self.assertFalse(stats["rig1"]["is_active"])

    def test_14_minutes_59_seconds_before_now_is_active(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        share_time = now - datetime.timedelta(minutes=14, seconds=59)
        stats = ws.compute_worker_statistics([self._share_at(share_time)], now=now)
        self.assertTrue(stats["rig1"]["is_active"])

    def test_is_active_uses_last_share_at_not_first(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        old_time = now - datetime.timedelta(days=5)
        recent_time = now - datetime.timedelta(minutes=1)
        shares = [self._share_at(old_time), self._share_at(recent_time)]
        stats = ws.compute_worker_statistics(shares, now=now)
        self.assertTrue(stats["rig1"]["is_active"])

    def test_default_now_used_when_not_supplied_recent_share_active(self):
        now_actual = datetime.datetime.now(datetime.timezone.utc)
        recent_time = now_actual - datetime.timedelta(minutes=1)
        ts = int(recent_time.timestamp())
        share = make_share(workername="rig1", createdate=f"{ts},0")
        stats = ws.compute_worker_statistics([share])
        self.assertTrue(stats["rig1"]["is_active"])

    def test_two_workers_independent_is_active(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        recent = now - datetime.timedelta(minutes=1)
        old = now - datetime.timedelta(days=2)
        shares = [self._share_at(recent, "rig_active"), self._share_at(old, "rig_stale")]
        stats = ws.compute_worker_statistics(shares, now=now)
        self.assertTrue(stats["rig_active"]["is_active"])
        self.assertFalse(stats["rig_stale"]["is_active"])


# ---------------------------------------------------------------------------
# best_share_today / best_share_ever / percentiles scoped per worker
# ---------------------------------------------------------------------------
class TestBestSharePerWorker(unittest.TestCase):
    def test_two_workers_each_have_own_best_today_no_interference(self):
        today = datetime.date(2026, 7, 16)
        ts = int(datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc).timestamp())
        shares = [
            make_share(workername="rig1", sdiff=5.0, createdate=f"{ts},0"),
            make_share(workername="rig1", sdiff=50.0, createdate=f"{ts+1},0"),
            make_share(workername="rig2", sdiff=100.0, createdate=f"{ts},0"),
            make_share(workername="rig2", sdiff=3.0, createdate=f"{ts+1},0"),
        ]
        stats = ws.compute_worker_statistics(shares, today=today)
        self.assertEqual(stats["rig1"]["best_share_today"]["sdiff"], 50.0)
        self.assertEqual(stats["rig1"]["best_share_today"]["workername"], "rig1")
        self.assertEqual(stats["rig2"]["best_share_today"]["sdiff"], 100.0)
        self.assertEqual(stats["rig2"]["best_share_today"]["workername"], "rig2")

    def test_best_share_ever_only_drawn_from_own_workers_shares(self):
        shares = [
            make_share(workername="rig1", sdiff=5.0, createdate="1700000000,0"),
            make_share(workername="rig2", sdiff=999.0, createdate="1700000000,0"),
        ]
        stats = ws.compute_worker_statistics(shares)
        self.assertEqual(stats["rig1"]["best_share_ever"]["sdiff"], 5.0)
        self.assertEqual(stats["rig2"]["best_share_ever"]["sdiff"], 999.0)

    def test_best_share_ever_under_malformed_createdate_per_worker(self):
        shares = [make_share(workername="rig1", sdiff=42.0, createdate="garbage")]
        stats = ws.compute_worker_statistics(shares, today=datetime.date(2026, 7, 16))
        self.assertIsNone(stats["rig1"]["best_share_today"])
        self.assertIsNotNone(stats["rig1"]["best_share_ever"])
        self.assertEqual(stats["rig1"]["best_share_ever"]["sdiff"], 42.0)
        self.assertEqual(stats["rig1"]["best_share_ever"]["timestamp"], "unknown")

    def test_best_share_ever_persists_across_day_boundary(self):
        today = datetime.date(2026, 7, 16)
        yesterday_ts = int(datetime.datetime(2026, 7, 15, 12, 0, 0, tzinfo=datetime.timezone.utc).timestamp())
        shares = [make_share(workername="rig1", sdiff=50.0, createdate=f"{yesterday_ts},0")]
        stats = ws.compute_worker_statistics(shares, today=today)
        self.assertIsNone(stats["rig1"]["best_share_today"])
        self.assertIsNotNone(stats["rig1"]["best_share_ever"])
        self.assertEqual(stats["rig1"]["best_share_ever"]["sdiff"], 50.0)

    def test_best_share_record_workername_preserved_verbatim(self):
        shares = [make_share(workername=" rig1 ", sdiff=42.0, createdate="1700000000,0")]
        stats = ws.compute_worker_statistics(shares)
        self.assertEqual(stats[" rig1 "]["best_share_ever"]["workername"], " rig1 ")


class TestInvalidResultOnlyWorker(unittest.TestCase):
    def test_worker_with_only_invalid_results_gets_all_none_sdiff_stats(self):
        shares = [
            make_share(workername="rig1", result=None),
            make_share(workername="rig1", result="true"),
            make_share(workername="rig1", result=1),
        ]
        stats = ws.compute_worker_statistics(shares)
        self.assertIn("rig1", stats)
        w = stats["rig1"]
        self.assertEqual(w["invalid_result_count"], 3)
        self.assertEqual(w["accepted_count"], 0)
        self.assertEqual(w["rejected_count"], 0)
        self.assertIsNone(w["average_sdiff"])
        self.assertIsNone(w["median_sdiff"])
        self.assertIsNone(w["min_sdiff"])
        self.assertIsNone(w["max_sdiff"])
        self.assertIsNone(w["percentiles"]["p50"])
        self.assertIsNone(w["percentiles"]["p90"])
        self.assertIsNone(w["percentiles"]["p99"])
        self.assertIsNone(w["best_share_today"])
        self.assertIsNone(w["best_share_ever"])


class TestPercentilesPerWorker(unittest.TestCase):
    def test_full_pipeline_percentiles_per_worker(self):
        shares = [make_share(workername="rig1", sdiff=float(i), createdate=f"{1700000000+i},0")
                  for i in range(1, 11)]
        shares += [make_share(workername="rig2", sdiff=100.0, createdate="1700000000,0")]
        stats = ws.compute_worker_statistics(shares)
        self.assertEqual(stats["rig1"]["min_sdiff"], 1.0)
        self.assertEqual(stats["rig1"]["max_sdiff"], 10.0)
        self.assertEqual(stats["rig1"]["average_sdiff"], 5.5)
        self.assertEqual(stats["rig1"]["median_sdiff"], 5.5)
        self.assertAlmostEqual(stats["rig1"]["percentiles"]["p90"], 9.1)
        self.assertEqual(stats["rig2"]["min_sdiff"], 100.0)


# ---------------------------------------------------------------------------
# End to end: iter_shares() -> compute_worker_statistics()
# ---------------------------------------------------------------------------
class TestEndToEnd(TempLogDirMixin, unittest.TestCase):
    def test_malformed_lines_mixed_with_good_lines_no_crash(self):
        good1 = '{"username":"u1","workername":"rig1","agent":"cgminer/1","diff":1,"sdiff":2.0,"result":true,"createdate":"1700000000,0"}'
        good2 = '{"username":"u1","workername":"rig2","agent":"cgminer/2","diff":1,"sdiff":3.0,"result":false,"createdate":"1700000100,0"}'
        non_object = '[1,2,3]'
        truncated = '{"username":"u1","workername":"rig1"'
        bad_utf8 = b"\xff\xfe not valid utf8 \x80\x81\n"
        blank = ""

        self.write_sharelog(
            "test.sharelog",
            [good1, non_object, truncated, blank, good2, bad_utf8],
        )

        shares = list(psa.iter_shares(self.tmpdir))
        stats = ws.compute_worker_statistics(shares)

        self.assertEqual(set(stats.keys()), {"rig1", "rig2"})
        self.assertEqual(stats["rig1"]["accepted_count"], 1)
        self.assertEqual(stats["rig1"]["agent"], "cgminer/1")
        self.assertEqual(stats["rig2"]["rejected_count"], 1)
        self.assertEqual(stats["rig2"]["agent"], "cgminer/2")

    def test_multiple_files_aggregate_correctly(self):
        line1 = '{"username":"u1","workername":"rig1","agent":"a1","diff":1,"sdiff":2.0,"result":true,"createdate":"1700000000,0"}'
        line2 = '{"username":"u1","workername":"rig1","agent":"a2","diff":1,"sdiff":9.0,"result":true,"createdate":"1700000200,0"}'
        self.write_sharelog("a.sharelog", [line1])
        self.write_sharelog("b.sharelog", [line2])

        shares = list(psa.iter_shares(self.tmpdir))
        stats = ws.compute_worker_statistics(shares)
        self.assertEqual(stats["rig1"]["accepted_count"], 2)
        self.assertEqual(stats["rig1"]["max_sdiff"], 9.0)
        # files processed in sorted-glob order, so a.sharelog before b.sharelog;
        # agent should reflect the latest one seen (a2 from b.sharelog).
        self.assertEqual(stats["rig1"]["agent"], "a2")


# ---------------------------------------------------------------------------
# Confirm dependency modules are byte-for-byte unmodified
# ---------------------------------------------------------------------------
class TestDependenciesUnmodified(unittest.TestCase):
    def test_pool_statistics_matches_git_head(self):
        import subprocess
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        result = subprocess.run(
            ["git", "diff", "--quiet", "HEAD", "--", "pool_statistics.py"],
            cwd=repo_root,
        )
        self.assertEqual(result.returncode, 0, "pool_statistics.py differs from git HEAD")

    def test_user_statistics_matches_git_head(self):
        import subprocess
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        result = subprocess.run(
            ["git", "diff", "--quiet", "HEAD", "--", "user_statistics.py"],
            cwd=repo_root,
        )
        self.assertEqual(result.returncode, 0, "user_statistics.py differs from git HEAD")


if __name__ == "__main__":
    unittest.main()
