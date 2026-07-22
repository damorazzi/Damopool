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


if __name__ == "__main__":
    unittest.main()
