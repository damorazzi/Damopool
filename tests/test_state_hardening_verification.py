#!/usr/bin/env python3
"""
Independent verification tests written by the test-engineer agent, NOT part
of the lead engineer's own suite, to probe:
  (1) edge cases around load_state()/STATE_VERSION hardening not covered by
      TestLoadStateHardening / TestStateVersionEnforcement, and
  (2) an adversarial reset scenario combining an exact sdiff tie at the
      reset boundary with a daily_bests candidate spanning the
      today/yesterday UTC boundary right as a file gets truncated.

Uses only synthetic fixture data under tempfile.mkdtemp(). Never touches
/home/damopool/ckpool-solo/ckpool/logs or the real analytics.state.json.
This file only reads production code; it does not modify it.
"""
import datetime
import json
import os
import shutil
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import analytics_state as astate


def cd(epoch_seconds, nanos=0):
    return f"{epoch_seconds},{nanos}"


def share(username="alice", workername="alice.rig1", agent="cgminer",
          result=True, sdiff=5.0, createdate=None):
    return {"username": username, "workername": workername, "agent": agent,
            "diff": 1, "sdiff": sdiff, "result": result, "createdate": createdate}


class SandboxMixin:
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_verify_")
        self.logs_dir = os.path.join(self.tmpdir, "logs")
        os.makedirs(self.logs_dir)
        self.state_path = os.path.join(self.tmpdir, "analytics.state.json")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def write(self, name, lines, mode="w"):
        path = os.path.join(self.logs_dir, name)
        with open(path, mode) as f:
            for line in lines:
                if isinstance(line, dict):
                    line = json.dumps(line)
                if isinstance(line, str):
                    line = line.encode("utf-8") if "b" in mode else line + "\n"
                f.write(line)
        return path


# ---------------------------------------------------------------------------
# Gap-hunting for load_state() hardening / STATE_VERSION enforcement
# ---------------------------------------------------------------------------
class TestLoadStateHardeningGaps(SandboxMixin, unittest.TestCase):
    def test_empty_zero_byte_file_raises_state_load_error(self):
        with open(self.state_path, "w"):
            pass  # zero bytes
        self.assertEqual(os.path.getsize(self.state_path), 0)
        with self.assertRaises(astate.StateLoadError):
            astate.load_state(self.state_path)

    def test_float_version_1_point_0_is_rejected(self):
        # 1.0 is neither `int` nor `bool` in Python -- json.load will decode
        # a JSON number with a decimal point as a Python float, not an int,
        # even though it is numerically equal to STATE_VERSION.
        with open(self.state_path, "w") as f:
            f.write('{"version": 1.0, "generation": 0, "files": {}}')
        with self.assertRaises(astate.StateVersionError):
            astate.load_state(self.state_path)

    def test_negative_version_raises_state_version_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": -1, "generation": 0, "files": {}}, f)
        with self.assertRaises(astate.StateVersionError):
            astate.load_state(self.state_path)

    def test_extremely_large_version_raises_state_version_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": 10**18, "generation": 0, "files": {}}, f)
        with self.assertRaises(astate.StateVersionError):
            astate.load_state(self.state_path)

    def test_genuinely_valid_state_with_empty_files_dict_loads_without_false_positive(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": astate.STATE_VERSION, "generation": 42, "files": {}}, f)
        state = astate.load_state(self.state_path)
        self.assertEqual(state, {"version": astate.STATE_VERSION, "generation": 42, "files": {}})

    def test_genuinely_valid_state_with_extra_unknown_top_level_key_still_loads(self):
        # Forward-compatible-looking extra key should not be treated as
        # structurally invalid (no such requirement is documented, but this
        # confirms the check is scoped to what's actually required: dict +
        # "files" dict + valid version).
        with open(self.state_path, "w") as f:
            json.dump({"version": astate.STATE_VERSION, "generation": 0, "files": {},
                       "some_future_field": 123}, f)
        state = astate.load_state(self.state_path)
        self.assertEqual(state["generation"], 0)

    def test_state_load_error_is_a_state_error(self):
        self.assertTrue(issubclass(astate.StateLoadError, astate.StateError))

    def test_state_version_error_hierarchy(self):
        # Confirm whatever hierarchy the implementation actually chose is at
        # least internally consistent: StateVersionError must be a StateError
        # (so callers catching the base class catch everything), and the
        # code must be self-consistent about whether it is ALSO a
        # StateLoadError specifically.
        self.assertTrue(issubclass(astate.StateVersionError, astate.StateError))
        # Document actual relationship found, rather than assume either way.
        is_subclass_of_load_error = issubclass(astate.StateVersionError, astate.StateLoadError)
        print(f"\n[INFO] StateVersionError is a subclass of StateLoadError: {is_subclass_of_load_error}")

    def test_null_version_explicitly_raises_state_version_error(self):
        with open(self.state_path, "w") as f:
            json.dump({"version": None, "generation": 0, "files": {}}, f)
        with self.assertRaises(astate.StateVersionError):
            astate.load_state(self.state_path)

    def test_files_values_wrong_shape_does_not_raise_at_load_time(self):
        # load_state() only checks the top-level "files" key is a dict; it
        # does NOT validate the shape of each per-file entry. Confirm this
        # doesn't raise at load time (that's deferred/undefined) -- this is
        # an observational test to document current behavior, not assert a
        # requirement either way.
        with open(self.state_path, "w") as f:
            json.dump({"version": astate.STATE_VERSION, "generation": 0,
                       "files": {"/some/path": "not-a-dict-entry"}}, f)
        try:
            state = astate.load_state(self.state_path)
            print("\n[INFO] load_state() does not validate per-file entry shape; "
                  f"loaded files={state['files']!r}")
        except astate.StateLoadError:
            print("\n[INFO] load_state() DOES reject malformed per-file entries")


# ---------------------------------------------------------------------------
# Adversarial: exact sdiff tie at reset boundary, across files, independent
# of processing order.
# ---------------------------------------------------------------------------
class TestTieAtResetBoundary(SandboxMixin, unittest.TestCase):
    def test_tie_break_after_truncation_still_prefers_earliest_timestamp(self):
        """best_share_ever ties must resolve to the earliest timestamp
        (per _BestTracker's documented contract in pool_statistics.py),
        even when one side of the tie is freshly (re)established by a
        truncation/replacement reset processed in a LATER sorted-path
        position than the other side."""
        now = datetime.datetime(2026, 7, 16, 15, 0, 0, tzinfo=datetime.timezone.utc)
        base = int(now.timestamp()) - 10000

        # "a.sharelog" sorts BEFORE "z.sharelog"; ann's share has the
        # EARLIER timestamp of the eventual tie.
        self.write("a.sharelog", [
            share(username="ann", workername="ann.r1", sdiff=77.0, createdate=cd(base + 100)),
        ])
        self.write("z.sharelog", [
            share(username="zoe", workername="zoe.r1", sdiff=50.0, createdate=cd(base + 50)),
        ])
        astate.update_state(self.logs_dir, now, state_path=self.state_path)

        z_path = os.path.join(self.logs_dir, "z.sharelog")
        time.sleep(0.01)
        with open(z_path, "w") as f:
            # Tied sdiff (77.0) but a LATER timestamp than ann's -- must
            # lose the tie-break; ann must remain best_share_ever.
            f.write(json.dumps(share(username="zoe", workername="zoe.r1", sdiff=77.0,
                                      createdate=cd(base + 200))) + "\n")

        state2 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(state2, now, now.date(), now.date() - datetime.timedelta(days=1))

        best = merged["pool"]["best_share_ever"]
        self.assertIsNotNone(best)
        self.assertEqual(best["username"], "ann",
                          f"tie must resolve to earliest timestamp (ann), got {best}")

    def test_tie_break_after_truncation_new_earlier_timestamp_wins(self):
        """Mirror case: the reset file's NEW content has the EARLIER
        timestamp of the tie -- it must win, confirming reset content is
        treated as fully live data for tie-break purposes, not somehow
        stale relative to the untouched file."""
        now = datetime.datetime(2026, 7, 16, 15, 0, 0, tzinfo=datetime.timezone.utc)
        base = int(now.timestamp()) - 10000

        self.write("a.sharelog", [
            share(username="ann", workername="ann.r1", sdiff=77.0, createdate=cd(base + 200)),
        ])
        self.write("z.sharelog", [
            share(username="zoe", workername="zoe.r1", sdiff=50.0, createdate=cd(base + 50)),
        ])
        astate.update_state(self.logs_dir, now, state_path=self.state_path)

        z_path = os.path.join(self.logs_dir, "z.sharelog")
        time.sleep(0.01)
        with open(z_path, "w") as f:
            f.write(json.dumps(share(username="zoe", workername="zoe.r1", sdiff=77.0,
                                      createdate=cd(base + 100))) + "\n")

        state2 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(state2, now, now.date(), now.date() - datetime.timedelta(days=1))

        best = merged["pool"]["best_share_ever"]
        self.assertIsNotNone(best)
        self.assertEqual(best["username"], "zoe",
                          f"tie must resolve to earliest timestamp (zoe, post-reset), got {best}")


# ---------------------------------------------------------------------------
# Adversarial: daily_bests candidate spanning the today/yesterday UTC
# boundary combined with a truncation event on the contributing file.
# ---------------------------------------------------------------------------
class TestDailyBestBoundaryDuringTruncation(SandboxMixin, unittest.TestCase):
    def test_yesterday_contribution_from_untouched_file_survives_truncation_of_a_different_file(self):
        now = datetime.datetime(2026, 7, 16, 0, 10, 0, tzinfo=datetime.timezone.utc)
        today = now.date()
        yesterday = today - datetime.timedelta(days=1)
        yesterday_2358 = int(datetime.datetime(2026, 7, 15, 23, 58, 0, tzinfo=datetime.timezone.utc).timestamp())
        yesterday_2359 = int(datetime.datetime(2026, 7, 15, 23, 59, 0, tzinfo=datetime.timezone.utc).timestamp())
        today_0005 = int(datetime.datetime(2026, 7, 16, 0, 5, 0, tzinfo=datetime.timezone.utc).timestamp())

        # w.sharelog: an UNTOUCHED file with frank's yesterday-boundary
        # share; must survive the truncation of a DIFFERENT file below.
        self.write("w.sharelog", [
            share(username="frank", workername="frank.r1", sdiff=40.0, createdate=cd(yesterday_2358)),
        ])
        # y.sharelog: eve's yesterday-boundary share, which will be wiped
        # out by truncation below (expected, per the documented reset
        # semantics -- this test confirms it does NOT also corrupt or drop
        # frank's independent yesterday entry, and that the post-reset
        # state is internally consistent, not just "doesn't crash").
        y_path = self.write("y.sharelog", [
            share(username="eve", workername="eve.r1", sdiff=41.0, createdate=cd(yesterday_2359)),
        ])

        astate.update_state(self.logs_dir, now, state_path=self.state_path)

        time.sleep(0.01)
        with open(y_path, "w") as f:
            # Entirely different content, now dated TODAY (crossing the
            # boundary as part of the same truncation event).
            f.write(json.dumps(share(username="eve", workername="eve.r2", sdiff=99.0,
                                      createdate=cd(today_0005))) + "\n")

        state2 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(state2, now, today, yesterday)

        yesterday_key = yesterday.isoformat()
        today_key = today.isoformat()

        self.assertIn(yesterday_key, merged["daily_bests"], "frank's untouched yesterday contribution must produce a yesterday key")
        yesterday_users = merged["daily_bests"][yesterday_key]["users"]
        self.assertIn("frank", yesterday_users, "frank's yesterday best must survive an unrelated file's truncation")
        self.assertEqual(yesterday_users["frank"]["current_daily_best"]["sdiff"], 40.0)

        # eve's OLD (pre-truncation, yesterday) contribution must be fully
        # gone -- not lingering as a stale previous_daily_best either.
        self.assertNotIn("eve", yesterday_users,
                          "eve's pre-truncation yesterday share must not survive the truncation of its source file")

        # eve's NEW (post-truncation, today) contribution must be present.
        self.assertIn(today_key, merged["daily_bests"])
        today_users = merged["daily_bests"][today_key]["users"]
        self.assertIn("eve", today_users)
        self.assertEqual(today_users["eve"]["current_daily_best"]["sdiff"], 99.0)
        self.assertIsNone(today_users["eve"]["previous_daily_best"],
                           "eve has only one candidate today; previous_daily_best must be None, not a leftover from yesterday")

        # live_ticker (today only) must reflect eve's new share, not the
        # discarded yesterday one, and must not crash building the ticker.
        ticker_by_user = {entry["username"]: entry for entry in merged["live_ticker"]}
        self.assertIn("eve", ticker_by_user)
        self.assertEqual(ticker_by_user["eve"]["current_daily_best"]["sdiff"], 99.0)
        self.assertNotIn("frank", ticker_by_user, "live_ticker is today-only; frank has no today entry")


if __name__ == "__main__":
    unittest.main()
