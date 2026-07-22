#!/usr/bin/env python3
"""
Independent adversarial test pass on ckpool_native_stats.py / the
Milestone 28 merge logic in analytics_builder.py.

Written by an independent test engineer reviewing the author's own
tests.test_ckpool_native_stats.py and tests.test_analytics_builder.py
(TestNativeHashrateMerge). This file does NOT duplicate that coverage --
it specifically targets scenarios not already exercised: torn/racy writes
(invalid UTF-8 mid multi-byte sequence, truncated lines), unusual-but-real
CKPool hashrate string shapes taken from the live logs/ directory,
numeric-overflow edge cases in unit conversion, symlinks/odd directory
entries under logs/users/, a fully nonexistent logs_dir, and a flat
workers-namespace collision across two different user files.

Uses only synthetic/hand-crafted fixtures written to scratch temp
directories via tempfile.mkdtemp(). Never touches the real
/home/damopool/ckpool-solo/ckpool/logs directory or analytics.json.

This is a new, standalone file -- per this test engineer's own operating
constraints, existing test files (tests/test_ckpool_native_stats.py,
tests/test_analytics_builder.py) and all production source files are
read-only and were not modified.

Run with:
    python3 -m unittest -v tests.test_native_stats_adversarial
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ckpool_native_stats as cns
import analytics_builder as ab


class TempLogsDirMixin:
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_cnsadv_")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def pool_status_path(self):
        pool_dir = os.path.join(self.tmpdir, "pool")
        os.makedirs(pool_dir, exist_ok=True)
        return os.path.join(pool_dir, "pool.status")

    def users_dir(self):
        d = os.path.join(self.tmpdir, "users")
        os.makedirs(d, exist_ok=True)
        return d


# ---------------------------------------------------------------------------
# BUG 1 (Blocking, FIXED): pool.status was opened in text mode with only
# OSError caught. A torn/racy write from ckpoold (or any corruption) that
# leaves an invalid UTF-8 byte sequence in the file raised
# UnicodeDecodeError, which is NOT an OSError subclass -- it propagated
# uncaught, all the way through analytics_builder.build_analytics(),
# aborting the entire analytics run. This directly contradicted the
# module's own docstring ("Every read degrades gracefully ... this must
# never fail the whole analytics build") and non-negotiable Human
# requirement #2. Fixed: _read_pool_status's except clause now also
# catches UnicodeDecodeError, matching _read_user_file's own (already
# correct) handling of the identical corruption.
# ---------------------------------------------------------------------------
class TestPoolStatusInvalidUtf8_FINDING(TempLogsDirMixin, unittest.TestCase):
    def test_pool_status_invalid_utf8_degrades_gracefully_not_a_crash(self):
        path = self.pool_status_path()
        with open(path, "wb") as f:
            f.write(b'{"runtime": 1}\n')
            # 0xff is never a valid UTF-8 start byte -- simulates a torn
            # write / bit corruption mid multi-byte sequence.
            f.write(b'{"hashrate1m": "22.8T", "hashrate1d": "3' + b"\xff\xfe" + b'2.8T"}\n')

        result = cns.read_native_hashrates(self.tmpdir)  # must not raise
        self.assertIsNone(result["pool"]["hashrate_1m"])
        self.assertIsNone(result["pool"]["hashrate_24h"])

    def test_same_invalid_utf8_no_longer_crashes_the_full_analytics_builder_run(self):
        """Confirms the fix is not just contained inside
        ckpool_native_stats.py in isolation -- the fix holds all the way
        through analytics_builder.build_analytics(), which per
        non-negotiable requirement #2 must never abort the whole run due
        to a bad native file."""
        path = self.pool_status_path()
        with open(path, "wb") as f:
            f.write(b'{"hashrate1m": "22.8T", "hashrate1d": "3' + b"\xff\xfe" + b'2.8T"}\n')
        os.makedirs(os.path.join(self.tmpdir, "users"), exist_ok=True)
        state_path = os.path.join(self.tmpdir, "state.json")
        now = datetime(2026, 7, 16, tzinfo=timezone.utc)

        data = ab.build_analytics(logs_dir=self.tmpdir, now=now, state_path=state_path)  # must not raise
        self.assertIsNone(data["pool"]["hashrate_1m"])
        self.assertIsNone(data["pool"]["hashrate_24h"])
        json.dumps(data)  # the whole build must still be well-formed

    def test_contrast_user_file_with_same_corruption_degrades_correctly(self):
        """Same style of corruption in a per-user file does NOT crash --
        _read_user_file's except clause explicitly includes
        UnicodeDecodeError. This proves the pool.status code path is an
        inconsistency/omission, not a fundamental limitation."""
        users_dir = self.users_dir()
        with open(os.path.join(users_dir, "alice"), "wb") as f:
            f.write(b'{"hashrate1m": "1' + b"\xff\xfe" + b'T"}')
        result = cns.read_native_hashrates(self.tmpdir)  # must not raise
        self.assertEqual(result["users"]["alice"], {"hashrate_1m": None, "hashrate_24h": None})


# ---------------------------------------------------------------------------
# BUG 2 (Major, FIXED): _parse_hashrate_string only guarded against
# magnitude being inf/nan BEFORE multiplying by the unit factor. A finite
# (if absurd) numeral that overflows a double once multiplied by 1e12/1e15
# slipped through that guard and returned float('inf'), which json.dumps
# would then serialize as the bare token `Infinity` -- not valid JSON, and
# something a browser's JSON.parse() (the frontend's only consumer of
# analytics.json) throws a SyntaxError on. Fixed: the function now also
# checks the POST-multiplication result for finiteness, not just the
# pre-multiplication magnitude, so an overflow on either side of the
# multiplication degrades to None instead of leaking a non-finite value.
# ---------------------------------------------------------------------------
class TestOverflowProducesInfinity_FINDING(unittest.TestCase):
    def test_extreme_but_finite_magnitude_no_longer_overflows_to_inf_after_unit_scaling(self):
        # magnitude itself (~2e295) is a finite float; only the *product*
        # with the P (1e15) factor would overflow a double's ~1.8e308 max.
        huge_numeral = "2" + "0" * 295
        result = cns._parse_hashrate_string(huge_numeral + "P")
        self.assertIsNone(result)
        # Demonstrate the fix holds downstream too: this must always
        # round-trip through a strict JSON serializer with no non-standard
        # tokens, since it's now None rather than float('inf').
        dumped = json.dumps({"hashrate_1m": result})
        self.assertNotIn("Infinity", dumped)

    def test_realistic_route_end_to_end_via_read_native_hashrates(self):
        """Same overflow scenario, exercised through the public
        read_native_hashrates entry point with a hand-crafted pool.status,
        to show the fix holds through a real file read, not just a unit
        test of the private helper."""
        tmpdir = tempfile.mkdtemp(prefix="damopool_cnsadv_overflow_")
        try:
            pool_dir = os.path.join(tmpdir, "pool")
            os.makedirs(pool_dir)
            huge_numeral = "3" + "0" * 300
            with open(os.path.join(pool_dir, "pool.status"), "w") as f:
                f.write(json.dumps({"hashrate1m": huge_numeral + "P", "hashrate1d": "1T"}) + "\n")
            result = cns.read_native_hashrates(tmpdir)
            self.assertIsNone(result["pool"]["hashrate_1m"])
            # Must now serialize cleanly even under the strict allow_nan=False
            # contract analytics.json should honor -- no ValueError.
            json.dumps(result, allow_nan=False)
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


# ---------------------------------------------------------------------------
# Coverage gap: real hashrate string shapes seen in the live logs/ dir that
# the existing suite didn't specifically pin down -- bare, unit-less
# numerals (ckpool emits "0", "1", "5", "10" with NO K/M/G/T/P suffix at
# all for very small hashrates, confirmed by grepping the live
# logs/users/*/*.status files). Passing, but worth pinning explicitly since
# it's easy to accidentally regress (e.g. someone "fixing" the unrecognized-
# unit fallback and inadvertently only handling single-char units).
# ---------------------------------------------------------------------------
class TestBareUnitlessNumeralsFromRealLogs(unittest.TestCase):
    def test_bare_small_integers_no_unit_suffix(self):
        for raw, expected in [("0", 0.0), ("1", 1.0), ("5", 5.0), ("10", 10.0)]:
            self.assertEqual(cns._parse_hashrate_string(raw), expected)


# ---------------------------------------------------------------------------
# Coverage gap: torn-write simulation for pool.status specifically (valid
# earlier line, truncated/dangling later line missing its closing brace --
# a realistic snapshot of ckpoold rewriting the file while this module
# reads it mid-write). Passes today (json.JSONDecodeError is caught) but
# wasn't explicitly exercised with a *mid-object* truncation (as opposed to
# "not json at all {").
# ---------------------------------------------------------------------------
class TestPoolStatusTornWrite(TempLogsDirMixin, unittest.TestCase):
    def test_hashrate_line_truncated_mid_value_falls_back_to_none(self):
        path = self.pool_status_path()
        with open(path, "w") as f:
            f.write(json.dumps({"runtime": 1}) + "\n")
            # Simulate a read landing exactly mid-rewrite: valid opening,
            # then nothing (file handle closed / truncated by the writer).
            f.write('{"hashrate1m": "22.8T", "hashrate1d": "3')
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertIsNone(result["pool"]["hashrate_1m"])
        self.assertIsNone(result["pool"]["hashrate_24h"])

    def test_valid_hashrate_line_after_a_truncated_line_is_still_found(self):
        """Confirms the per-line independence claimed in the module
        docstring: one garbled line must not prevent a later good line
        from being used."""
        path = self.pool_status_path()
        with open(path, "w") as f:
            f.write('{"hashrate1m": "3' + "\n")  # garbled, dangling
            f.write(json.dumps({"hashrate1m": "9.5T", "hashrate1d": "8T"}) + "\n")
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertAlmostEqual(result["pool"]["hashrate_1m"], 9.5e12, delta=1)

    def test_trailing_dangling_comma_json_object_degrades_not_crashes(self):
        path = self.pool_status_path()
        with open(path, "w") as f:
            f.write('{"hashrate1m": "22.8T", "hashrate1d": "32.8T",}\n')
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertIsNone(result["pool"]["hashrate_1m"])  # trailing comma -> invalid JSON, skipped


# ---------------------------------------------------------------------------
# logs_dir itself missing entirely (not just the pool/ or users/
# subdirectories) -- covers the specific scenario the task called out.
# ---------------------------------------------------------------------------
class TestLogsDirCompletelyMissing(unittest.TestCase):
    def test_wholly_nonexistent_logs_dir_degrades_gracefully(self):
        result = cns.read_native_hashrates("/nonexistent/damopool/path/xyz123")
        self.assertEqual(result, {
            "pool": {"hashrate_1m": None, "hashrate_24h": None},
            "users": {},
            "workers": {},
        })
        json.dumps(result)


# ---------------------------------------------------------------------------
# Unusual directory entries under logs/users/: broken symlink, a symlink
# pointing at a directory, and a symlink pointing at a genuinely valid file
# elsewhere. None of these are exercised by the existing suite (which only
# covers a plain subdirectory as the "non-file entry").
# ---------------------------------------------------------------------------
class TestUsersDirSymlinks(TempLogsDirMixin, unittest.TestCase):
    def test_broken_symlink_is_skipped_not_a_crash(self):
        users_dir = self.users_dir()
        os.symlink("/does/not/exist/target", os.path.join(users_dir, "brokenlink"))
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertEqual(result["users"], {})

    def test_symlink_to_a_directory_is_skipped(self):
        users_dir = self.users_dir()
        target_dir = os.path.join(self.tmpdir, "somedir")
        os.makedirs(target_dir)
        os.symlink(target_dir, os.path.join(users_dir, "dirlink"))
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertEqual(result["users"], {})

    def test_symlink_to_a_real_valid_file_elsewhere_is_followed_and_read(self):
        users_dir = self.users_dir()
        real_file = os.path.join(self.tmpdir, "real_user_data.json")
        with open(real_file, "w") as f:
            json.dump({"hashrate1m": "3T", "hashrate1d": "3T", "worker": []}, f)
        os.symlink(real_file, os.path.join(users_dir, "symlinked_user"))
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertAlmostEqual(result["users"]["symlinked_user"]["hashrate_1m"], 3e12, delta=1)


# ---------------------------------------------------------------------------
# FINDING (Minor): the module-level `workers` dict returned by
# read_native_hashrates() is a single flat namespace keyed only by
# workername, populated via workers.update(...) once per user file in
# os.listdir() sort order. If two different per-user native files (e.g.
# due to file corruption, an operator error, or any future change to how
# workername strings are constructed) both list an entry with the same
# workername string, the second file processed silently overwrites the
# first's hashrate data with no error, warning, or indication of the
# collision. Not currently reachable through normal CKPool operation
# (workername is conventionally "<owning-address>.<label>", so genuine
# cross-user collisions shouldn't occur), but there is no guard against it
# if that assumption is ever violated by upstream data.
# ---------------------------------------------------------------------------
class TestFlatWorkersNamespaceCollision_FINDING(TempLogsDirMixin, unittest.TestCase):
    def test_two_user_files_claiming_the_same_workername_silently_collide(self):
        users_dir = self.users_dir()
        with open(os.path.join(users_dir, "aaa_user"), "w") as f:
            json.dump({
                "hashrate1m": "1T", "hashrate1d": "1T",
                "worker": [{"workername": "shared.rig", "hashrate1m": "1T", "hashrate1d": "1T"}],
            }, f)
        with open(os.path.join(users_dir, "zzz_user"), "w") as f:
            json.dump({
                "hashrate1m": "9T", "hashrate1d": "9T",
                "worker": [{"workername": "shared.rig", "hashrate1m": "9T", "hashrate1d": "9T"}],
            }, f)
        result = cns.read_native_hashrates(self.tmpdir)
        # FINDING: "zzz_user" (sorted last) silently wins; "aaa_user"'s
        # figures for the same workername are lost with no diagnostic.
        self.assertEqual(result["workers"]["shared.rig"]["hashrate_1m"], 9e12)


# ---------------------------------------------------------------------------
# Miscellaneous coverage: pool.status hashrate1m present but not a string
# (int/None), extremely long username-as-filename, and a filename
# containing non-ASCII characters -- all pass today; added for
# completeness/regression pinning, no bugs found here.
# ---------------------------------------------------------------------------
class TestMiscellaneousEdgeCases(TempLogsDirMixin, unittest.TestCase):
    def test_pool_status_hashrate_field_is_an_int_not_a_string(self):
        path = self.pool_status_path()
        with open(path, "w") as f:
            f.write(json.dumps({"hashrate1m": 12345, "hashrate1d": None}) + "\n")
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertIsNone(result["pool"]["hashrate_1m"])
        self.assertIsNone(result["pool"]["hashrate_24h"])

    def test_extremely_long_filename_used_as_username_key(self):
        users_dir = self.users_dir()
        long_name = "bc1q" + ("a" * 240)  # ~244 chars total, within a typical 255-byte filename limit
        with open(os.path.join(users_dir, long_name), "w") as f:
            json.dump({"hashrate1m": "1T", "hashrate1d": "1T", "worker": []}, f)
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertIn(long_name, result["users"])

    def test_non_ascii_filename_in_users_dir(self):
        users_dir = self.users_dir()
        name = "user_é中文"
        with open(os.path.join(users_dir, name), "w") as f:
            json.dump({"hashrate1m": "1T", "hashrate1d": "1T", "worker": []}, f)
        result = cns.read_native_hashrates(self.tmpdir)
        self.assertIn(name, result["users"])

    def test_whitespace_padded_hashrate_string_is_trimmed(self):
        self.assertEqual(cns._parse_hashrate_string("  9.84T  "), 9.84e12)

    def test_negative_numeral_string_rejected_not_negated(self):
        # regex requires [\d.]+ at the start -- a leading '-' can't match,
        # so this degrades to None rather than silently returning a
        # negative hashrate (which would be nonsensical).
        self.assertIsNone(cns._parse_hashrate_string("-5T"))


if __name__ == "__main__":
    unittest.main()
