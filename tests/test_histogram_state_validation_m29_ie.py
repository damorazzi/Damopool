#!/usr/bin/env python3
"""
Independent Test Engineer pass (fresh, post-fix review, Milestone 29):
further state-validation adversarial cases for histogram_builder.py's
load_state()/_validate_partial_state()/_validate_scope_state(), beyond
what tests/test_histogram_builder_adversarial_m29.py already covers.
Specifically targets: wrong bucket_counts/bucket_best array LENGTH
(too short and too long, not just "not a list"), negative counts,
non-int counts (float/bool/string), a bucket_best entry that is a dict
but missing one of the three required keys individually, a bucket_best
entry with the wrong outer type (list instead of dict/None), and a
fully well-formed state file round-tripping correctly (positive
control -- confirms the validators are not so strict they reject
genuinely valid output of the module's own to_state()/save_state()).

Uses only synthetic fixture data written to tempfile.mkdtemp() sandboxes.
Never touches /home/damopool/ckpool-solo/ckpool/logs or the real
histogram.state.json.

Run with:
    python3 -m unittest -v tests.test_histogram_state_validation_m29_ie
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


VALID_FINGERPRINT = {"dev": 1, "ino": 1, "size": 10, "mtime_ns": 1, "offset": 0, "prefix_hash": "x"}


def _wrap_partial(partial):
    return {
        "version": 1,
        "files": {
            "/some/path.sharelog": {
                "fingerprint": dict(VALID_FINGERPRINT),
                "partial": partial,
            }
        },
    }


def valid_scope_state():
    return {"counts": [0] * hb.BUCKET_COUNT, "best": [None] * hb.BUCKET_COUNT}


def valid_partial():
    return {
        "pool": valid_scope_state(),
        "users": {"alice": valid_scope_state()},
        "workers": {"alice.rig1": valid_scope_state()},
        "recent_tuples": [[1700000000, 0, 500.0, "alice", "alice.rig1"]],
    }


class TempStatePathMixin:
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_histstate_ie_")
        self.state_path = os.path.join(self.tmpdir, "histogram.state.json")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def write_state(self, state):
        with open(self.state_path, "w") as f:
            json.dump(state, f)


class TestBucketCountsArrayLength(TempStatePathMixin, unittest.TestCase):
    def test_counts_array_too_short_raises(self):
        partial = valid_partial()
        partial["pool"]["counts"] = [0] * (hb.BUCKET_COUNT - 1)
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_counts_array_too_long_raises(self):
        partial = valid_partial()
        partial["pool"]["counts"] = [0] * (hb.BUCKET_COUNT + 1)
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_best_array_too_short_raises(self):
        partial = valid_partial()
        partial["pool"]["best"] = [None] * (hb.BUCKET_COUNT - 1)
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_best_array_too_long_raises(self):
        partial = valid_partial()
        partial["pool"]["best"] = [None] * (hb.BUCKET_COUNT + 1)
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)


class TestBucketCountsElementTypes(TempStatePathMixin, unittest.TestCase):
    def test_negative_count_is_rejected(self):
        """Confirmed as of this test pass: _validate_scope_state checks
        `c >= 0` for every count element (in addition to int-not-bool),
        so a negative bucket count -- structurally well-typed but
        semantically impossible for a real "how many shares landed here"
        counter -- correctly raises HistogramStateLoadError rather than
        loading silently. (Note for the record: earlier in this same
        session, a fresh read of histogram_builder.py showed this check
        WITHOUT the `c >= 0` clause -- the production file changed
        under active concurrent editing partway through this test pass.
        This test pins the CURRENT, observed-at-report-time behavior.)"""
        partial = valid_partial()
        partial["pool"]["counts"] = [-1] + [0] * (hb.BUCKET_COUNT - 1)
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_float_count_raises(self):
        partial = valid_partial()
        partial["pool"]["counts"] = [1.5] + [0] * (hb.BUCKET_COUNT - 1)
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_bool_count_raises(self):
        partial = valid_partial()
        partial["pool"]["counts"] = [True] + [0] * (hb.BUCKET_COUNT - 1)
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_string_count_raises(self):
        partial = valid_partial()
        partial["pool"]["counts"] = ["1"] + [0] * (hb.BUCKET_COUNT - 1)
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_null_count_raises(self):
        partial = valid_partial()
        partial["pool"]["counts"] = [None] + [0] * (hb.BUCKET_COUNT - 1)
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)


class TestBucketBestEntryShape(TempStatePathMixin, unittest.TestCase):
    def test_best_entry_missing_share_key_raises(self):
        partial = valid_partial()
        partial["pool"]["best"][0] = {"sdiff": 1.0, "createdate": [1, 0]}
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_best_entry_missing_sdiff_key_raises(self):
        partial = valid_partial()
        partial["pool"]["best"][0] = {"share": {"username": "a", "workername": "a.w"}, "createdate": [1, 0]}
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_best_entry_missing_createdate_key_raises(self):
        partial = valid_partial()
        partial["pool"]["best"][0] = {"share": {"username": "a", "workername": "a.w"}, "sdiff": 1.0}
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_best_entry_is_a_list_not_a_dict_raises(self):
        partial = valid_partial()
        partial["pool"]["best"][0] = [1, 2, 3]
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_best_entry_is_a_bare_string_raises(self):
        partial = valid_partial()
        partial["pool"]["best"][0] = "not-a-dict-or-null"
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_per_user_scope_malformed_best_entry_also_raises(self):
        partial = valid_partial()
        partial["users"]["alice"]["best"][0] = {"share": None}
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_per_worker_scope_malformed_best_entry_also_raises(self):
        partial = valid_partial()
        partial["workers"]["alice.rig1"]["best"][0] = {"share": None}
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)


class TestDeepBestEntryValidation(TempStatePathMixin, unittest.TestCase):
    """Targets _validate_best_entry specifically: a best entry that
    passes the shallow "has share/sdiff/createdate keys" check but whose
    VALUES don't match what merge_histogram_state()/_BestTracker.to_dict()
    actually depend on -- must still raise HistogramStateLoadError, not
    a raw uncontrolled TypeError deep inside a later merge/to_dict call."""

    def test_share_value_is_not_a_dict_raises(self):
        partial = valid_partial()
        partial["pool"]["best"][0] = {"share": "not-a-dict", "sdiff": 1.0, "createdate": [1, 0]}
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_share_dict_missing_username_raises(self):
        partial = valid_partial()
        partial["pool"]["best"][0] = {"share": {"workername": "a.w"}, "sdiff": 1.0, "createdate": [1, 0]}
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_share_dict_missing_workername_raises(self):
        partial = valid_partial()
        partial["pool"]["best"][0] = {"share": {"username": "a"}, "sdiff": 1.0, "createdate": [1, 0]}
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_sdiff_value_is_a_string_raises(self):
        partial = valid_partial()
        partial["pool"]["best"][0] = {"share": {"username": "a", "workername": "a.w"}, "sdiff": "500", "createdate": [1, 0]}
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_sdiff_value_is_a_bool_raises(self):
        partial = valid_partial()
        partial["pool"]["best"][0] = {"share": {"username": "a", "workername": "a.w"}, "sdiff": True, "createdate": [1, 0]}
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_createdate_with_wrong_element_count_raises(self):
        partial = valid_partial()
        partial["pool"]["best"][0] = {"share": {"username": "a", "workername": "a.w"}, "sdiff": 1.0, "createdate": [1, 0, 0]}
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_createdate_with_non_int_elements_raises(self):
        partial = valid_partial()
        partial["pool"]["best"][0] = {"share": {"username": "a", "workername": "a.w"}, "sdiff": 1.0, "createdate": [1.5, 0]}
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_createdate_of_none_is_valid_unknown_timestamp_sentinel(self):
        """createdate=None is the documented "unknown timestamp" sentinel
        (a share whose createdate was unparseable but which still won its
        bucket) -- must NOT raise."""
        partial = valid_partial()
        partial["pool"]["best"][0] = {"share": {"username": "a", "workername": "a.w"}, "sdiff": 1.0, "createdate": None}
        self.write_state(_wrap_partial(partial))
        loaded = hb.load_state(self.state_path)  # must not raise
        self.assertIsNotNone(loaded)


class TestRecentTuplesShape(TempStatePathMixin, unittest.TestCase):
    def test_recent_tuple_with_wrong_element_count_raises(self):
        partial = valid_partial()
        partial["recent_tuples"] = [[1700000000, 0, 500.0]]  # only 3 elements, needs 5
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_recent_tuples_not_a_list_raises(self):
        partial = valid_partial()
        partial["recent_tuples"] = "not-a-list"
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    # Code Review follow-up finding (Milestone 29, second fix round): the
    # original recent_tuples check validated element COUNT only, never
    # TYPE -- unlike bucket_best (only read on display), a malformed
    # seconds/nanos here reaches createdate_to_utc() unconditionally on
    # EVERY run touching this file (the pruning path and merge's own "1d"
    # rebuild), so this was actually a more reachable crash than the
    # bucket_best gap this same fix round otherwise closed.
    def test_recent_tuple_with_non_numeric_seconds_raises(self):
        partial = valid_partial()
        partial["recent_tuples"] = [["not-a-number", 0, 500.0, "alice", "alice.rig1"]]
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_recent_tuple_with_non_numeric_nanos_raises(self):
        partial = valid_partial()
        partial["recent_tuples"] = [[1700000000, "not-a-number", 500.0, "alice", "alice.rig1"]]
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_recent_tuple_with_out_of_range_seconds_raises(self):
        partial = valid_partial()
        partial["recent_tuples"] = [[10**30, 0, 500.0, "alice", "alice.rig1"]]
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_recent_tuple_with_bool_seconds_raises(self):
        partial = valid_partial()
        partial["recent_tuples"] = [[True, 0, 500.0, "alice", "alice.rig1"]]
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_recent_tuple_with_non_numeric_sdiff_raises(self):
        partial = valid_partial()
        partial["recent_tuples"] = [[1700000000, 0, "not-a-number", "alice", "alice.rig1"]]
        self.write_state(_wrap_partial(partial))
        with self.assertRaises(hb.HistogramStateLoadError):
            hb.load_state(self.state_path)

    def test_a_malformed_recent_tuple_raises_a_clean_load_error_via_build_histograms_not_an_uncontrolled_crash(self):
        """End-to-end confirmation: before this fix, this exact fixture
        would have sailed past load_state() and then raised an
        uncontrolled TypeError deep inside merge_histogram_state()'s "1d"
        rebuild (createdate_to_utc("not-a-number", ...)) -- now it raises
        the intended, actionable HistogramStateLoadError instead, at load
        time, before any merge work happens."""
        partial = valid_partial()
        partial["recent_tuples"] = [["not-a-number", 0, 500.0, "alice", "alice.rig1"]]
        self.write_state(_wrap_partial(partial))
        logdir = tempfile.mkdtemp(prefix="damopool_histstate_ie_recent_")
        try:
            with self.assertRaises(hb.HistogramStateLoadError):
                hb.build_histograms(logdir, datetime.now(timezone.utc), state_path=self.state_path)
        finally:
            shutil.rmtree(logdir, ignore_errors=True)


class TestPositiveControlFullRoundTrip(TempStatePathMixin, unittest.TestCase):
    def test_a_genuinely_valid_state_file_produced_by_the_module_itself_loads_and_round_trips(self):
        now = datetime(2026, 7, 22, 12, 0, 0, tzinfo=timezone.utc)
        logdir = tempfile.mkdtemp(prefix="damopool_histstate_ie_logs_")
        try:
            sharelog_path = os.path.join(logdir, "a.sharelog")
            with open(sharelog_path, "w") as f:
                f.write(json.dumps({
                    "username": "alice", "workername": "alice.rig1", "sdiff": 500,
                    "result": True, "createdate": f"{int(now.timestamp()) - 10},0",
                }) + "\n")
            data1 = hb.build_histograms(logdir, now, state_path=self.state_path)
            self.assertEqual(sum(data1["pool"]["total"]["bucket_counts"]), 1)

            # Now load_state() must succeed against the module's OWN
            # freshly-written state file (positive control -- the
            # validators above must not be so strict they reject valid,
            # self-produced output).
            loaded = hb.load_state(self.state_path)
            self.assertEqual(loaded["version"], hb.STATE_VERSION)

            # A second run against the unchanged file must reload cleanly
            # and not duplicate counts.
            data2 = hb.build_histograms(logdir, now, state_path=self.state_path)
            self.assertEqual(sum(data2["pool"]["total"]["bucket_counts"]), 1)
        finally:
            shutil.rmtree(logdir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
