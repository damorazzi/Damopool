#!/usr/bin/env python3
"""
Independent test suite for parse_share_analytics.py and pool_statistics.py.

Uses only synthetic/hand-crafted sharelog fixture data written to a scratch
temp directory. Never touches /home/damopool/ckpool-solo/ckpool/logs.

Run with:
    python3 -m unittest -v tests.test_analytics
"""
import datetime
import json
import math
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import parse_share_analytics as psa
import pool_statistics as ps


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
# parse_share_analytics.py: malformed / truncated JSON handling
# ---------------------------------------------------------------------------
class TestMalformedJson(TempLogDirMixin, unittest.TestCase):
    def test_blank_lines_and_whitespace_are_skipped(self):
        self.write_sharelog("a.sharelog", [
            "",
            "   ",
            json.dumps(make_share()),
            "",
        ])
        shares = list(psa.iter_shares(self.tmpdir))
        self.assertEqual(len(shares), 1)

    def test_truncated_json_line_is_skipped_not_crashing(self):
        good = json.dumps(make_share(username="good"))
        truncated = json.dumps(make_share(username="bad"))[:20]  # cut mid-object
        self.write_sharelog("a.sharelog", [truncated, good])
        shares = list(psa.iter_shares(self.tmpdir))
        self.assertEqual(len(shares), 1)
        self.assertEqual(shares[0]["username"], "good")

    def test_garbage_non_json_line_is_skipped(self):
        self.write_sharelog("a.sharelog", [
            "not json at all {{{",
            json.dumps(make_share(username="good")),
        ])
        shares = list(psa.iter_shares(self.tmpdir))
        self.assertEqual(len(shares), 1)

    def test_missing_fields_yield_none(self):
        self.write_sharelog("a.sharelog", [json.dumps({"username": "u1"})])
        shares = list(psa.iter_shares(self.tmpdir))
        self.assertEqual(len(shares), 1)
        self.assertIsNone(shares[0]["sdiff"])
        self.assertIsNone(shares[0]["result"])
        self.assertIsNone(shares[0]["createdate"])

    # -- FIX VERIFICATION: non-object JSON lines (scalar/null/list) --------
    def test_valid_json_scalar_non_object_line_is_skipped_not_crashing(self):
        """
        FIX VERIFIED: a sharelog line that is syntactically valid JSON but is
        not a JSON object (bare number) is now skipped via the added
        `if not isinstance(record, dict): continue` guard, and shares before
        and after it are still processed. Previously this raised
        AttributeError and killed the whole run (Blocking finding #1).
        """
        self.write_sharelog("a.sharelog", [
            json.dumps(make_share(username="before_scalar")),
            "42",
            json.dumps(make_share(username="after_scalar")),
        ])
        shares = list(psa.iter_shares(self.tmpdir))
        usernames = [s["username"] for s in shares]
        self.assertEqual(usernames, ["before_scalar", "after_scalar"])

    def test_valid_json_null_line_is_skipped_not_crashing(self):
        self.write_sharelog("a.sharelog", [
            json.dumps(make_share(username="before_null")),
            "null",
            json.dumps(make_share(username="after_null")),
        ])
        shares = list(psa.iter_shares(self.tmpdir))
        usernames = [s["username"] for s in shares]
        self.assertEqual(usernames, ["before_null", "after_null"])

    def test_valid_json_list_line_is_skipped_not_crashing(self):
        self.write_sharelog("a.sharelog", [
            json.dumps(make_share(username="before_list")),
            "[1,2,3]",
            json.dumps(make_share(username="after_list")),
        ])
        shares = list(psa.iter_shares(self.tmpdir))
        usernames = [s["username"] for s in shares]
        self.assertEqual(usernames, ["before_list", "after_list"])

    def test_valid_json_string_scalar_line_is_skipped_not_crashing(self):
        self.write_sharelog("a.sharelog", [
            json.dumps(make_share(username="before_str")),
            json.dumps("just a string"),
            json.dumps(make_share(username="after_str")),
        ])
        shares = list(psa.iter_shares(self.tmpdir))
        usernames = [s["username"] for s in shares]
        self.assertEqual(usernames, ["before_str", "after_str"])

    def test_empty_sharelog_file(self):
        self.write_sharelog("empty.sharelog", [])
        shares = list(psa.iter_shares(self.tmpdir))
        self.assertEqual(shares, [])

    def test_no_sharelog_files_at_all(self):
        # tmpdir exists but has zero .sharelog files
        shares = list(psa.iter_shares(self.tmpdir))
        self.assertEqual(shares, [])

    def test_nonexistent_logs_dir(self):
        shares = list(psa.iter_shares(os.path.join(self.tmpdir, "does_not_exist")))
        self.assertEqual(shares, [])


# ---------------------------------------------------------------------------
# pool_statistics.py: result=true/false/invalid handling
# ---------------------------------------------------------------------------
class TestResultHandling(unittest.TestCase):
    def test_result_true_counts_accepted(self):
        stats = ps.compute_pool_statistics([make_share(result=True)])
        self.assertEqual(stats["accepted_count"], 1)
        self.assertEqual(stats["rejected_count"], 0)
        self.assertEqual(stats["invalid_result_count"], 0)

    def test_result_false_counts_rejected(self):
        stats = ps.compute_pool_statistics([make_share(result=False)])
        self.assertEqual(stats["accepted_count"], 0)
        self.assertEqual(stats["rejected_count"], 1)
        self.assertEqual(stats["invalid_result_count"], 0)

    def test_result_missing_is_invalid(self):
        stats = ps.compute_pool_statistics([make_share(result=None)])
        self.assertEqual(stats["invalid_result_count"], 1)
        self.assertEqual(stats["accepted_count"], 0)
        self.assertEqual(stats["rejected_count"], 0)

    def test_result_string_true_is_invalid_not_accepted(self):
        # CKPool sharelog always encodes JSON booleans, but a corrupted or
        # non-conformant line could contain a string instead.
        stats = ps.compute_pool_statistics([make_share(result="true")])
        self.assertEqual(stats["invalid_result_count"], 1)
        self.assertEqual(stats["accepted_count"], 0)

    def test_result_int_1_is_invalid_not_accepted(self):
        stats = ps.compute_pool_statistics([make_share(result=1)])
        self.assertEqual(stats["invalid_result_count"], 1)

    def test_result_int_0_is_invalid_not_rejected(self):
        stats = ps.compute_pool_statistics([make_share(result=0)])
        self.assertEqual(stats["invalid_result_count"], 1)
        self.assertEqual(stats["rejected_count"], 0)


# ---------------------------------------------------------------------------
# pool_statistics.py: sdiff validation
# ---------------------------------------------------------------------------
class TestSdiffValidation(unittest.TestCase):
    def test_valid_positive_float(self):
        self.assertTrue(ps.is_valid_sdiff(1.5))

    def test_valid_positive_int(self):
        self.assertTrue(ps.is_valid_sdiff(5))

    def test_zero_is_invalid(self):
        self.assertFalse(ps.is_valid_sdiff(0))

    def test_negative_is_invalid(self):
        self.assertFalse(ps.is_valid_sdiff(-3.2))

    def test_nan_is_invalid(self):
        self.assertFalse(ps.is_valid_sdiff(float("nan")))

    def test_infinity_is_invalid(self):
        self.assertFalse(ps.is_valid_sdiff(float("inf")))
        self.assertFalse(ps.is_valid_sdiff(float("-inf")))

    def test_bool_true_is_invalid_despite_being_int_subclass(self):
        self.assertFalse(ps.is_valid_sdiff(True))

    def test_bool_false_is_invalid(self):
        self.assertFalse(ps.is_valid_sdiff(False))

    def test_string_is_invalid(self):
        self.assertFalse(ps.is_valid_sdiff("1.5"))

    def test_none_is_invalid(self):
        self.assertFalse(ps.is_valid_sdiff(None))

    def test_accepted_share_with_invalid_sdiff_still_counts_as_accepted(self):
        """
        NOTE (Minor, previously reported, unchanged by this fix round): a
        share with result=True but an invalid sdiff (e.g. negative) is still
        counted in accepted_count, but is silently excluded from
        average/median/percentiles/min/max/best-share tracking.
        """
        stats = ps.compute_pool_statistics([make_share(result=True, sdiff=-5)])
        self.assertEqual(stats["accepted_count"], 1)
        self.assertIsNone(stats["average_sdiff"])
        self.assertIsNone(stats["min_sdiff"])
        self.assertIsNone(stats["best_share_ever"])

    def test_nan_via_json_parsing_is_rejected(self):
        # Python's json module accepts the non-standard NaN/Infinity tokens
        # by default; confirm they still get filtered out downstream.
        record = json.loads('{"sdiff": NaN}')
        self.assertFalse(ps.is_valid_sdiff(record["sdiff"]))
        record2 = json.loads('{"sdiff": Infinity}')
        self.assertFalse(ps.is_valid_sdiff(record2["sdiff"]))


# ---------------------------------------------------------------------------
# pool_statistics.py: createdate parsing / nanosecond ordering
# ---------------------------------------------------------------------------
class TestCreatedateParsing(unittest.TestCase):
    def test_valid_createdate(self):
        self.assertEqual(ps.parse_createdate("1700000000,123456789"), (1700000000, 123456789))

    def test_missing_comma_is_invalid(self):
        self.assertIsNone(ps.parse_createdate("1700000000"))

    def test_non_numeric_seconds_is_invalid(self):
        self.assertIsNone(ps.parse_createdate("abc,123"))

    def test_non_numeric_nanos_is_invalid(self):
        self.assertIsNone(ps.parse_createdate("123,xyz"))

    def test_negative_seconds_is_invalid(self):
        self.assertIsNone(ps.parse_createdate("-5,100"))

    def test_negative_nanos_is_invalid(self):
        self.assertIsNone(ps.parse_createdate("123,-5"))

    def test_nanos_out_of_range_is_invalid(self):
        self.assertIsNone(ps.parse_createdate("123,1000000000"))

    def test_nanos_at_max_boundary_is_valid(self):
        self.assertEqual(ps.parse_createdate("123,999999999"), (123, 999999999))

    def test_none_createdate_is_invalid(self):
        self.assertIsNone(ps.parse_createdate(None))

    def test_non_string_createdate_is_invalid(self):
        self.assertIsNone(ps.parse_createdate(1700000000.123456789))
        self.assertIsNone(ps.parse_createdate(1700000000))

    def test_extra_commas_is_invalid_not_crashing(self):
        self.assertIsNone(ps.parse_createdate("123,456,789"))

    # -- FIX VERIFICATION: out-of-range createdate seconds ------------------
    def test_huge_seconds_value_is_now_rejected_not_crashing(self):
        """
        FIX VERIFIED: parse_createdate now rejects seconds above
        MAX_TIMESTAMP_SECONDS (253,402,300,799 / 9999-12-31T23:59:59 UTC)
        and returns None instead of passing an unrepresentable value through
        to datetime.fromtimestamp(). Previously this crashed
        createdate_to_utc() with OSError (Blocking finding #3).
        """
        self.assertIsNone(ps.parse_createdate("99999999999999999,0"))

    def test_seconds_at_max_boundary_is_valid(self):
        self.assertIsNotNone(ps.parse_createdate(f"{ps.MAX_TIMESTAMP_SECONDS},0"))

    def test_seconds_one_past_max_boundary_is_invalid(self):
        self.assertIsNone(ps.parse_createdate(f"{ps.MAX_TIMESTAMP_SECONDS + 1},0"))

    def test_huge_seconds_value_no_longer_crashes_full_pipeline(self):
        """
        FIX VERIFIED: a share with an out-of-range createdate no longer
        crashes compute_pool_statistics(). Since createdate now parses to
        None, the share is treated the same as any other
        malformed-createdate share: excluded from best_share_today (no
        date to compare against `today`), but still eligible for
        best_share_ever (sdiff-only ranking) with timestamp "unknown".
        This matches the pre-existing behavior for other malformed
        createdate strings, which is a sensible, consistent outcome.
        """
        share = make_share(result=True, sdiff=10.0, createdate="99999999999999999,0")
        stats = ps.compute_pool_statistics([share], today=datetime.date(2026, 7, 16))
        self.assertIsNone(stats["best_share_today"])
        self.assertIsNotNone(stats["best_share_ever"])
        self.assertEqual(stats["best_share_ever"]["sdiff"], 10.0)
        self.assertEqual(stats["best_share_ever"]["timestamp"], "unknown")
        # accepted_count/rejected_count/invalid_result_count should be sane
        self.assertEqual(stats["accepted_count"], 1)
        self.assertEqual(stats["rejected_count"], 0)
        self.assertEqual(stats["invalid_result_count"], 0)

    def test_huge_seconds_does_not_incorrectly_win_a_tie_via_timestamp(self):
        """
        Cross-check: an out-of-range-createdate share tied on sdiff with a
        share that has a valid timestamp should NOT displace the valid one,
        since its parsed createdate is None (matches the documented "no
        valid timestamp never displaces" tie-break rule).
        """
        good = make_share(username="valid_ts", sdiff=10.0, createdate="1700000000,0")
        bad = make_share(username="huge_ts", sdiff=10.0, createdate="99999999999999999,0")
        stats = ps.compute_pool_statistics([good, bad])
        self.assertEqual(stats["best_share_ever"]["username"], "valid_ts")

    def test_createdate_sort_key_orders_by_nanosecond(self):
        earlier = (1700000000, 100)
        later = (1700000000, 200)
        same_sec_but_less = (1700000000, 999999998)
        self.assertLess(ps.createdate_sort_key(earlier), ps.createdate_sort_key(later))
        self.assertLess(ps.createdate_sort_key(later), ps.createdate_sort_key(same_sec_but_less))

    def test_accepted_share_with_malformed_createdate_excluded_from_today_but_not_ever(self):
        share = make_share(result=True, sdiff=10.0, createdate="not-a-timestamp")
        stats = ps.compute_pool_statistics([share], today=datetime.date(2026, 7, 16))
        self.assertIsNone(stats["best_share_today"])
        self.assertIsNotNone(stats["best_share_ever"])
        self.assertEqual(stats["best_share_ever"]["timestamp"], "unknown")
        self.assertEqual(stats["best_share_ever"]["sdiff"], 10.0)


# ---------------------------------------------------------------------------
# _BestTracker: tie-break logic, best_share_today vs best_share_ever
# ---------------------------------------------------------------------------
class TestBestTracker(unittest.TestCase):
    def test_higher_sdiff_wins(self):
        t = ps._BestTracker()
        t.consider(make_share(username="low"), 5.0, (100, 0))
        t.consider(make_share(username="high"), 10.0, (50, 0))
        self.assertEqual(t.to_dict()["username"], "high")
        self.assertEqual(t.to_dict()["sdiff"], 10.0)

    def test_lower_sdiff_never_wins(self):
        t = ps._BestTracker()
        t.consider(make_share(username="high"), 10.0, (50, 0))
        t.consider(make_share(username="low"), 5.0, (100, 0))
        self.assertEqual(t.to_dict()["username"], "high")

    def test_exact_tie_earliest_timestamp_wins(self):
        t = ps._BestTracker()
        t.consider(make_share(username="later"), 10.0, (1700000100, 0))
        t.consider(make_share(username="earlier"), 10.0, (1700000000, 0))
        self.assertEqual(t.to_dict()["username"], "earlier")

    def test_exact_tie_nanosecond_level_ordering(self):
        t = ps._BestTracker()
        t.consider(make_share(username="later_ns"), 10.0, (1700000000, 500))
        t.consider(make_share(username="earlier_ns"), 10.0, (1700000000, 100))
        self.assertEqual(t.to_dict()["username"], "earlier_ns")

    def test_tie_with_no_timestamp_on_incoming_share_does_not_displace(self):
        t = ps._BestTracker()
        t.consider(make_share(username="has_ts"), 10.0, (1700000000, 0))
        t.consider(make_share(username="no_ts"), 10.0, None)
        self.assertEqual(t.to_dict()["username"], "has_ts")

    def test_tie_first_share_with_no_timestamp_IS_displaced_by_later_timestamped_tie(self):
        """
        FINDING (Minor, previously reported, unchanged by this fix round):
        documented docstring behavior says "a share with no valid timestamp
        never displaces an existing best" -- but this only applies to the
        incoming share. If the existing best has no timestamp, a later
        share with an exact sdiff tie AND a valid timestamp WILL displace
        it.
        """
        t = ps._BestTracker()
        t.consider(make_share(username="first_no_ts"), 10.0, None)
        self.assertEqual(t.to_dict()["username"], "first_no_ts")
        t.consider(make_share(username="second_with_ts"), 10.0, (1700000000, 0))
        self.assertEqual(t.to_dict()["username"], "second_with_ts")

    def test_first_share_becomes_best_even_with_no_timestamp(self):
        t = ps._BestTracker()
        t.consider(make_share(username="only"), 10.0, None)
        d = t.to_dict()
        self.assertEqual(d["username"], "only")
        self.assertEqual(d["timestamp"], "unknown")

    def test_empty_tracker_to_dict_is_none(self):
        t = ps._BestTracker()
        self.assertIsNone(t.to_dict())


class TestBestShareTodayVsEver(unittest.TestCase):
    def test_today_and_ever_split_across_utc_day_boundary(self):
        today = datetime.date(2026, 7, 16)
        # 2026-07-15 23:59:59 UTC
        yesterday_ts = int(datetime.datetime(2026, 7, 15, 23, 59, 59, tzinfo=datetime.timezone.utc).timestamp())
        # 2026-07-16 00:00:01 UTC
        today_ts = int(datetime.datetime(2026, 7, 16, 0, 0, 1, tzinfo=datetime.timezone.utc).timestamp())

        shares = [
            make_share(username="yesterday_best", sdiff=50.0, createdate=f"{yesterday_ts},0"),
            make_share(username="today_best", sdiff=20.0, createdate=f"{today_ts},0"),
        ]
        stats = ps.compute_pool_statistics(shares, today=today)
        # best_share_ever should be the higher sdiff regardless of day
        self.assertEqual(stats["best_share_ever"]["username"], "yesterday_best")
        # best_share_today should only consider shares that fall on `today`
        self.assertEqual(stats["best_share_today"]["username"], "today_best")

    def test_no_shares_today_best_today_is_none(self):
        today = datetime.date(2026, 7, 16)
        yesterday_ts = int(datetime.datetime(2026, 7, 15, 12, 0, 0, tzinfo=datetime.timezone.utc).timestamp())
        shares = [make_share(sdiff=50.0, createdate=f"{yesterday_ts},0")]
        stats = ps.compute_pool_statistics(shares, today=today)
        self.assertIsNone(stats["best_share_today"])
        self.assertIsNotNone(stats["best_share_ever"])


# ---------------------------------------------------------------------------
# Percentiles / median
# ---------------------------------------------------------------------------
class TestPercentiles(unittest.TestCase):
    def test_percentile_empty(self):
        self.assertIsNone(ps.percentile([], 50))

    def test_percentile_single_value(self):
        self.assertEqual(ps.percentile([7.0], 50), 7.0)
        self.assertEqual(ps.percentile([7.0], 99), 7.0)

    def test_median_odd_count(self):
        self.assertEqual(ps.median([1.0, 2.0, 3.0]), 2.0)

    def test_median_even_count_interpolates(self):
        self.assertEqual(ps.median([1.0, 2.0, 3.0, 4.0]), 2.5)

    def test_p90_known_value(self):
        values = sorted([float(i) for i in range(1, 11)])  # 1..10
        # rank = 0.9 * 9 = 8.1 -> between index 8 (value 9) and 9 (value 10)
        self.assertAlmostEqual(ps.percentile(values, 90), 9.1)

    def test_full_pipeline_percentiles(self):
        shares = [make_share(sdiff=float(i), createdate=f"{1700000000+i},0") for i in range(1, 11)]
        stats = ps.compute_pool_statistics(shares)
        self.assertEqual(stats["min_sdiff"], 1.0)
        self.assertEqual(stats["max_sdiff"], 10.0)
        self.assertEqual(stats["average_sdiff"], 5.5)
        self.assertEqual(stats["median_sdiff"], 5.5)
        self.assertAlmostEqual(stats["percentiles"]["p90"], 9.1)


# ---------------------------------------------------------------------------
# Empty dataset handling for full compute_pool_statistics
# ---------------------------------------------------------------------------
class TestEmptyDataset(unittest.TestCase):
    def test_empty_iterable_no_crash_all_none(self):
        stats = ps.compute_pool_statistics([])
        self.assertEqual(stats["accepted_count"], 0)
        self.assertEqual(stats["rejected_count"], 0)
        self.assertEqual(stats["invalid_result_count"], 0)
        self.assertIsNone(stats["average_sdiff"])
        self.assertIsNone(stats["median_sdiff"])
        self.assertIsNone(stats["min_sdiff"])
        self.assertIsNone(stats["max_sdiff"])
        self.assertIsNone(stats["percentiles"]["p50"])
        self.assertIsNone(stats["percentiles"]["p90"])
        self.assertIsNone(stats["percentiles"]["p99"])
        self.assertIsNone(stats["best_share_today"])
        self.assertIsNone(stats["best_share_ever"])

    def test_all_shares_invalid_result_no_crash(self):
        shares = [make_share(result=None), make_share(result="bad")]
        stats = ps.compute_pool_statistics(shares)
        self.assertEqual(stats["invalid_result_count"], 2)
        self.assertEqual(stats["accepted_count"], 0)
        self.assertIsNone(stats["best_share_ever"])


if __name__ == "__main__":
    unittest.main()
