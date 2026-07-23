#!/usr/bin/env python3
"""
Test suite for ckpool_native_stats.py (Phase E Milestone 28).

Uses only synthetic/hand-crafted fixture files written to scratch temp
directories via tempfile.mkdtemp(). Never touches the real
/home/damopool/ckpool-solo/ckpool/logs directory.

Run with:
    python3 -m unittest -v tests.test_ckpool_native_stats
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ckpool_native_stats as cns


class TempLogsDirMixin:
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_cnstest_")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def write_pool_status(self, lines):
        pool_dir = os.path.join(self.tmpdir, "pool")
        os.makedirs(pool_dir, exist_ok=True)
        path = os.path.join(pool_dir, "pool.status")
        with open(path, "w") as f:
            for line in lines:
                f.write(line + "\n")
        return path

    def write_user_file(self, username, data):
        users_dir = os.path.join(self.tmpdir, "users")
        os.makedirs(users_dir, exist_ok=True)
        path = os.path.join(users_dir, username)
        with open(path, "w") as f:
            json.dump(data, f)
        return path


# ---------------------------------------------------------------------------
# _parse_hashrate_string (unit conversion)
# ---------------------------------------------------------------------------
class TestParseHashrateString(unittest.TestCase):
    def test_terahash(self):
        # delta, not places: assertAlmostEqual's default `places=7` rounds
        # the *difference* to 7 decimal places, which is far too strict
        # once the values themselves are in the 1e12+ range -- a literal
        # like 9.84e12 and float("9.84") * 1e12 can differ by a few units
        # in the last place from float multiplication order, well within
        # any real tolerance for this use case.
        self.assertAlmostEqual(cns._parse_hashrate_string("9.84T"), 9.84e12, delta=1)

    def test_gigahash(self):
        self.assertAlmostEqual(cns._parse_hashrate_string("241.08G"), 241.08e9, delta=1)

    def test_petahash(self):
        self.assertAlmostEqual(cns._parse_hashrate_string("1.5P"), 1.5e15, delta=1)

    def test_megahash(self):
        self.assertAlmostEqual(cns._parse_hashrate_string("2.88M"), 2.88e6)

    def test_kilohash(self):
        self.assertAlmostEqual(cns._parse_hashrate_string("500K"), 500e3)

    def test_bare_number_no_unit_suffix(self):
        self.assertAlmostEqual(cns._parse_hashrate_string("0"), 0.0)

    def test_case_insensitive_unit(self):
        self.assertAlmostEqual(cns._parse_hashrate_string("9.84t"), 9.84e12, delta=1)

    def test_none_input_returns_none(self):
        self.assertIsNone(cns._parse_hashrate_string(None))

    def test_non_string_input_returns_none(self):
        self.assertIsNone(cns._parse_hashrate_string(9840000000000))
        self.assertIsNone(cns._parse_hashrate_string(["9.84T"]))

    def test_malformed_string_returns_none_not_a_throw(self):
        self.assertIsNone(cns._parse_hashrate_string("not-a-hashrate"))
        self.assertIsNone(cns._parse_hashrate_string(""))
        self.assertIsNone(cns._parse_hashrate_string("T9.84"))

    def test_unrecognized_unit_suffix_falls_back_to_factor_1(self):
        # Matches parse_pool_stats.py's own parse_unit behavior: an
        # unrecognized unit letter is not an error, just no scaling.
        self.assertAlmostEqual(cns._parse_hashrate_string("42X"), 42.0)


# ---------------------------------------------------------------------------
# read_native_hashrates: pool.status
# ---------------------------------------------------------------------------
class TestPoolStatus(TempLogsDirMixin, unittest.TestCase):
    def test_reads_hashrate_1m_and_24h_from_the_correct_line(self):
        self.write_pool_status([
            json.dumps({"runtime": 60, "lastupdate": 123, "Users": 1, "Workers": 1}),
            json.dumps({"hashrate1m": "22.8T", "hashrate5m": "27.3T", "hashrate1hr": "34.8T", "hashrate1d": "32.8T", "hashrate7d": "33.5T"}),
            json.dumps({"diff": 0.16, "accepted": 1, "rejected": 0}),
        ])
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertAlmostEqual(result["pool"]["hashrate_1m"], 22.8e12, delta=1)
        self.assertAlmostEqual(result["pool"]["hashrate_24h"], 32.8e12, delta=1)

    def test_only_1m_and_24h_surfaced_not_5m_1h_7d(self):
        self.write_pool_status([
            json.dumps({"hashrate1m": "1T", "hashrate5m": "2T", "hashrate1hr": "3T", "hashrate1d": "4T", "hashrate7d": "5T"}),
        ])
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertEqual(set(result["pool"].keys()), {"hashrate_1m", "hashrate_24h"})

    def test_missing_pool_status_file_degrades_to_none_not_a_throw(self):
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertIsNone(result["pool"]["hashrate_1m"])
        self.assertIsNone(result["pool"]["hashrate_24h"])

    def test_malformed_pool_status_lines_degrade_gracefully(self):
        self.write_pool_status(["not json at all {", "[1,2,3]", "null"])
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertIsNone(result["pool"]["hashrate_1m"])
        self.assertIsNone(result["pool"]["hashrate_24h"])

    def test_empty_pool_status_file(self):
        self.write_pool_status([])
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertIsNone(result["pool"]["hashrate_1m"])


# ---------------------------------------------------------------------------
# read_native_hashrates: per-user / per-worker files
# ---------------------------------------------------------------------------
class TestUserAndWorkerFiles(TempLogsDirMixin, unittest.TestCase):
    def test_user_level_hashrate_1m_and_24h(self):
        self.write_user_file("alice", {
            "hashrate1m": "9.84T", "hashrate5m": "9.86T", "hashrate1hr": "10.5T",
            "hashrate1d": "10.4T", "hashrate7d": "7.31T",
            "worker": [],
        })
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertAlmostEqual(result["users"]["alice"]["hashrate_1m"], 9.84e12, delta=1)
        self.assertAlmostEqual(result["users"]["alice"]["hashrate_24h"], 10.4e12, delta=1)

    def test_worker_level_hashrate_nested_under_worker_array(self):
        self.write_user_file("alice", {
            "hashrate1m": "9.84T", "hashrate1d": "10.4T",
            "worker": [
                {"workername": "alice.rig1", "hashrate1m": "5T", "hashrate1d": "6T"},
                {"workername": "alice.rig2", "hashrate1m": "4.84T", "hashrate1d": "4.4T"},
            ],
        })
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertAlmostEqual(result["workers"]["alice.rig1"]["hashrate_1m"], 5e12, delta=1)
        self.assertAlmostEqual(result["workers"]["alice.rig1"]["hashrate_24h"], 6e12, delta=1)
        self.assertAlmostEqual(result["workers"]["alice.rig2"]["hashrate_1m"], 4.84e12, delta=1)

    def test_filename_is_the_username_no_separate_username_field_needed(self):
        self.write_user_file("bc1qtestaddress", {"hashrate1m": "1T", "hashrate1d": "1T", "worker": []})
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertIn("bc1qtestaddress", result["users"])

    def test_multiple_users_all_read(self):
        self.write_user_file("alice", {"hashrate1m": "1T", "hashrate1d": "1T", "worker": []})
        self.write_user_file("bob", {"hashrate1m": "2T", "hashrate1d": "2T", "worker": []})
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertEqual(set(result["users"].keys()), {"alice", "bob"})

    def test_missing_users_dir_degrades_to_empty_dicts_not_a_throw(self):
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertEqual(result["users"], {})
        self.assertEqual(result["workers"], {})

    def test_malformed_user_file_json_degrades_gracefully(self):
        users_dir = os.path.join(self.tmpdir, "users")
        os.makedirs(users_dir, exist_ok=True)
        with open(os.path.join(users_dir, "alice"), "w") as f:
            f.write("not valid json {{{")
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertEqual(result["users"]["alice"], {"hashrate_1m": None, "hashrate_24h": None})

    def test_user_file_that_is_not_a_json_object_degrades_gracefully(self):
        self.write_user_file("alice", [1, 2, 3])
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertEqual(result["users"]["alice"], {"hashrate_1m": None, "hashrate_24h": None})

    def test_worker_entry_missing_workername_is_skipped_not_a_throw(self):
        self.write_user_file("alice", {
            "hashrate1m": "1T", "hashrate1d": "1T",
            "worker": [{"hashrate1m": "5T", "hashrate1d": "6T"}],
        })
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertEqual(result["workers"], {})

    def test_worker_entry_with_empty_string_workername_is_skipped(self):
        self.write_user_file("alice", {
            "hashrate1m": "1T", "hashrate1d": "1T",
            "worker": [{"workername": "", "hashrate1m": "5T", "hashrate1d": "6T"}],
        })
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertEqual(result["workers"], {})

    def test_worker_field_present_but_not_a_list_degrades_gracefully(self):
        self.write_user_file("alice", {"hashrate1m": "1T", "hashrate1d": "1T", "worker": "not-a-list"})
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertEqual(result["users"]["alice"]["hashrate_1m"], 1e12)
        self.assertEqual(result["workers"], {})

    def test_worker_hashrate_missing_defaults_to_none_within_that_worker(self):
        self.write_user_file("alice", {
            "hashrate1m": "1T", "hashrate1d": "1T",
            "worker": [{"workername": "alice.rig1"}],
        })
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertEqual(result["workers"]["alice.rig1"], {"hashrate_1m": None, "hashrate_24h": None})

    def test_a_non_file_entry_in_users_dir_is_skipped(self):
        users_dir = os.path.join(self.tmpdir, "users")
        os.makedirs(os.path.join(users_dir, "a_subdirectory"))
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertEqual(result["users"], {})


# ---------------------------------------------------------------------------
# End-to-end: both file types together
# ---------------------------------------------------------------------------
class TestEndToEnd(TempLogsDirMixin, unittest.TestCase):
    def test_pool_users_and_workers_all_populated_together(self):
        self.write_pool_status([
            json.dumps({"hashrate1m": "22.8T", "hashrate1d": "32.8T"}),
        ])
        self.write_user_file("alice", {
            "hashrate1m": "9.84T", "hashrate1d": "10.4T",
            "worker": [{"workername": "alice.rig1", "hashrate1m": "9.84T", "hashrate1d": "10.4T"}],
        })
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertAlmostEqual(result["pool"]["hashrate_1m"], 22.8e12, delta=1)
        self.assertAlmostEqual(result["users"]["alice"]["hashrate_1m"], 9.84e12, delta=1)
        self.assertAlmostEqual(result["workers"]["alice.rig1"]["hashrate_1m"], 9.84e12, delta=1)

    def test_completely_empty_logs_dir_no_crash_and_well_formed(self):
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertEqual(result, {
            "pool": {"hashrate_1m": None, "hashrate_24h": None},
            "users": {},
            "workers": {},
        })
        json.dumps(result)  # must be JSON-serializable


# ---------------------------------------------------------------------------
# read_network_difficulty (Phase E Milestone 29)
# ---------------------------------------------------------------------------
class TestReadNetworkDifficulty(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_netdifftest_")
        self.state_path = os.path.join(self.tmpdir, "network_diff.state.json")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def write_log(self, lines):
        path = os.path.join(self.tmpdir, "ckpool.log")
        with open(path, "w") as f:
            for line in lines:
                f.write(line + "\n")
        return path

    def test_reads_the_most_recent_network_diff_line(self):
        self.write_log([
            "[2026-07-14 23:28:00.690] Network diff set to 127170500429035.2",
            "[2026-07-19 18:28:17.058] Network diff set to 130000000000000.0",
        ])
        value = cns.read_network_difficulty(self.tmpdir, state_path=self.state_path)
        self.assertAlmostEqual(value, 130000000000000.0, delta=1)

    def test_missing_ckpool_log_degrades_to_none_not_a_throw(self):
        value = cns.read_network_difficulty(self.tmpdir, state_path=self.state_path)
        self.assertIsNone(value)

    def test_no_matching_line_at_all_degrades_to_none(self):
        self.write_log(["[2026-07-14 23:28:00.690] Some unrelated log line"])
        value = cns.read_network_difficulty(self.tmpdir, state_path=self.state_path)
        self.assertIsNone(value)

    def test_incremental_second_run_only_scans_new_bytes_and_updates_on_change(self):
        self.write_log(["[2026-07-14 23:28:00.690] Network diff set to 127170500429035.2"])
        first = cns.read_network_difficulty(self.tmpdir, state_path=self.state_path)
        self.assertAlmostEqual(first, 127170500429035.2, delta=1)

        # Append a new line with a changed value -- simulates a real
        # difficulty adjustment appearing later in the live-growing log.
        with open(os.path.join(self.tmpdir, "ckpool.log"), "a") as f:
            f.write("[2026-07-28 00:00:00.000] Network diff set to 140000000000000.0\n")
        second = cns.read_network_difficulty(self.tmpdir, state_path=self.state_path)
        self.assertAlmostEqual(second, 140000000000000.0, delta=1)

    def test_second_run_with_no_new_matching_lines_keeps_the_cached_value(self):
        self.write_log(["[2026-07-14 23:28:00.690] Network diff set to 127170500429035.2"])
        first = cns.read_network_difficulty(self.tmpdir, state_path=self.state_path)
        with open(os.path.join(self.tmpdir, "ckpool.log"), "a") as f:
            f.write("[2026-07-15 00:00:00.000] Some other unrelated line\n")
        second = cns.read_network_difficulty(self.tmpdir, state_path=self.state_path)
        self.assertEqual(first, second)

    def test_a_trailing_partial_line_is_not_consumed_and_is_reread_next_run(self):
        path = os.path.join(self.tmpdir, "ckpool.log")
        with open(path, "w") as f:
            f.write("[2026-07-14 23:28:00.690] Network diff set to 100000000000000.0\n")
            f.write("[2026-07-19 00:00:00.000] Network diff set to 20000")  # no trailing newline -- incomplete
        value = cns.read_network_difficulty(self.tmpdir, state_path=self.state_path)
        self.assertAlmostEqual(value, 100000000000000.0, delta=1)
        # Complete the line and re-run -- the previously-partial line
        # must now be picked up, not permanently skipped.
        with open(path, "a") as f:
            f.write("0000000000.0\n")
        value2 = cns.read_network_difficulty(self.tmpdir, state_path=self.state_path)
        self.assertAlmostEqual(value2, 200000000000000.0, delta=1)

    def test_file_shrinking_since_last_check_resets_and_rescans(self):
        self.write_log([
            "[2026-07-14 23:28:00.690] Network diff set to 100000000000000.0",
            "[2026-07-19 00:00:00.000] Network diff set to 110000000000000.0",
        ])
        cns.read_network_difficulty(self.tmpdir, state_path=self.state_path)
        # Simulate rotation: a new, smaller file replaces the old one.
        self.write_log(["[2026-07-28 00:00:00.000] Network diff set to 130000000000000.0"])
        value = cns.read_network_difficulty(self.tmpdir, state_path=self.state_path)
        self.assertAlmostEqual(value, 130000000000000.0, delta=1)

    def test_malformed_state_file_degrades_gracefully_not_a_throw(self):
        with open(self.state_path, "w") as f:
            f.write("not valid json {{{")
        self.write_log(["[2026-07-14 23:28:00.690] Network diff set to 127170500429035.2"])
        value = cns.read_network_difficulty(self.tmpdir, state_path=self.state_path)
        self.assertAlmostEqual(value, 127170500429035.2, delta=1)

    def test_empty_ckpool_log_degrades_to_none_not_a_throw(self):
        self.write_log([])
        value = cns.read_network_difficulty(self.tmpdir, state_path=self.state_path)
        self.assertIsNone(value)

    # Code Review finding (Milestone 29, final pass): float() on an
    # arbitrarily long all-digit string (NETWORK_DIFF_PATTERN's own
    # [\d.]+ guarantees no exponent notation, but not a bounded length)
    # can silently overflow to inf with no exception -- json.dump would
    # then emit the non-standard "Infinity" token into analytics.json,
    # which a strict/browser JSON.parse rejects outright. Mirrors
    # _parse_hashrate_string's own already-tested overflow guard
    # (Milestone 28).
    def test_an_overflowing_digit_string_is_discarded_not_cached_as_infinity(self):
        self.write_log([f"[2026-07-14 23:28:00.690] Network diff set to {'9' * 320}.0"])
        value = cns.read_network_difficulty(self.tmpdir, state_path=self.state_path)
        self.assertIsNone(value, "an overflowing match must never be accepted as a cached value")

    def test_an_overflowing_line_does_not_clobber_a_previously_cached_good_value(self):
        self.write_log(["[2026-07-14 23:28:00.690] Network diff set to 127170500429035.2"])
        first = cns.read_network_difficulty(self.tmpdir, state_path=self.state_path)
        self.assertAlmostEqual(first, 127170500429035.2, delta=1)

        with open(os.path.join(self.tmpdir, "ckpool.log"), "a") as f:
            f.write(f"[2026-07-28 00:00:00.000] Network diff set to {'9' * 320}.0\n")
        second = cns.read_network_difficulty(self.tmpdir, state_path=self.state_path)
        self.assertEqual(second, first, "an overflowing new line must keep the last genuine cached value, not None or inf")

    def test_returned_value_is_never_nan_or_infinite_across_a_sweep_of_real_and_adversarial_lines(self):
        candidates = [
            "127170500429035.2",
            "0",
            "0.0",
            "1",
            f"{'9' * 320}.0",
            f"{'1' * 400}",
        ]
        for text in candidates:
            with self.subTest(text=text):
                tmpdir = tempfile.mkdtemp(prefix="damopool_netdiff_sweep_")
                try:
                    state_path = os.path.join(tmpdir, "network_diff.state.json")
                    with open(os.path.join(tmpdir, "ckpool.log"), "w") as f:
                        f.write(f"[2026-07-14 23:28:00.690] Network diff set to {text}\n")
                    value = cns.read_network_difficulty(tmpdir, state_path=state_path)
                    if value is not None:
                        self.assertEqual(value, value, f"{text!r} produced NaN")
                        self.assertNotIn(value, (float("inf"), float("-inf")), f"{text!r} produced +/-inf")
                        json.dumps({"network_difficulty": value})  # must be strict-JSON-serializable
                finally:
                    shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
