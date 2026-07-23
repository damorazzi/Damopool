#!/usr/bin/env python3
"""
Independent integration pass on analytics_builder.py's Milestone 30 (Block
Progress Analytics) merge behavior. Complements
tests/test_analytics_builder.py's own TestBlockProgressMerge class -- this
file targets a gap in that class's own coverage: it never exercises MORE
THAN ONE user/worker with genuinely DIFFERENT best-share values in the same
build, which is exactly the scenario a copy-paste/reference bug (accidentally
reusing the pool's or another scope's dict) would slip through undetected.

Also covers: a scope whose best_share_ever is None (never solved) inside a
multi-scope fixture, a missing-network-difficulty end-to-end run, and an
explicit confirmation (via `git diff`/`git status`) that this milestone left
histogram_builder.py / ckpool_native_stats.py / analytics_state.py
untouched, per the milestone's own stated design goal.

Uses only synthetic sharelog fixture data in tempfile.mkdtemp() sandboxes,
exactly like tests/test_analytics_builder.py. Never touches
/home/damopool/ckpool-solo/ckpool/logs or the real analytics.json/
analytics.state.json/histogram.state.json/network_diff.state.json.

Run with:
    python3 -m unittest -v tests.test_block_progress_analytics_builder_independent
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import analytics_builder as ab
import histogram_builder
import ckpool_native_stats
import worker_sessions


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
    return f"{epoch_seconds},{nanos}"


class TempLogDirMixin:
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_bp_ab_iea_")
        self.state_path = os.path.join(self.tmpdir, "analytics.state.json")
        self._orig_histogram_state_path = histogram_builder.STATE_PATH
        self._orig_network_diff_state_path = ckpool_native_stats.NETWORK_DIFF_STATE_PATH
        self._orig_worker_sessions_state_path = worker_sessions.STATE_PATH
        histogram_builder.STATE_PATH = os.path.join(self.tmpdir, "histogram.state.json")
        ckpool_native_stats.NETWORK_DIFF_STATE_PATH = os.path.join(self.tmpdir, "network_diff.state.json")
        worker_sessions.STATE_PATH = os.path.join(self.tmpdir, "worker_sessions.state.json")

    def tearDown(self):
        histogram_builder.STATE_PATH = self._orig_histogram_state_path
        ckpool_native_stats.NETWORK_DIFF_STATE_PATH = self._orig_network_diff_state_path
        worker_sessions.STATE_PATH = self._orig_worker_sessions_state_path
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def write_share_lines(self, name, shares):
        path = os.path.join(self.tmpdir, name)
        with open(path, "w") as f:
            for s in shares:
                f.write(json.dumps(s) + "\n")
        return path

    def write_network_diff_log(self, value):
        # NOTE: ckpool_native_stats.NETWORK_DIFF_PATTERN is `[\d.]+` -- it
        # does NOT match scientific notation ("1e-300"), matching CKPool's
        # own real log format (which never emits scientific notation for
        # this line). Callers needing an extreme magnitude must pass an
        # already-expanded plain-decimal string via write_network_diff_log_raw
        # below rather than a float here.
        with open(os.path.join(self.tmpdir, "ckpool.log"), "w") as f:
            f.write(f"[2026-07-14 23:28:00.690] Network diff set to {value}\n")

    def write_network_diff_log_raw(self, decimal_string):
        with open(os.path.join(self.tmpdir, "ckpool.log"), "w") as f:
            f.write(f"[2026-07-14 23:28:00.690] Network diff set to {decimal_string}\n")


class TestMultiScopeCrossContamination(TempLogDirMixin, unittest.TestCase):
    """The single highest-risk bug class named explicitly in the brief:
    every user AND every worker must get ITS OWN block_progress, never the
    pool's, never a sibling scope's."""

    def test_three_users_with_distinct_best_shares_each_get_their_own_ratio(self):
        now = datetime(2026, 7, 16, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="alice.rig1", createdate=cd(int(now.timestamp())), sdiff=100.0),
            make_share(username="bob", workername="bob.rig1", createdate=cd(int(now.timestamp())), sdiff=200.0),
            make_share(username="carol", workername="carol.rig1", createdate=cd(int(now.timestamp())), sdiff=400.0),
        ])
        self.write_network_diff_log(1000.0)
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now, state_path=self.state_path)

        expectations = {"alice": 100.0, "bob": 200.0, "carol": 400.0}
        for username, sdiff in expectations.items():
            with self.subTest(username=username):
                bpg = data["users"][username]["block_progress"]
                self.assertEqual(bpg["best_share_difficulty"], sdiff,
                                  f"{username}'s block_progress.best_share_difficulty leaked another scope's value")
                self.assertAlmostEqual(bpg["progress_percent"], sdiff / 1000.0 * 100, delta=1e-6)
                workername = f"{username}.rig1"
                wbpg = data["workers"][workername]["block_progress"]
                self.assertEqual(wbpg["best_share_difficulty"], sdiff,
                                  f"{workername}'s block_progress.best_share_difficulty leaked another scope's value")

        # Cross-check: no two users share an object identity or an
        # accidentally-equal-by-copy-paste dict when their inputs genuinely
        # differ.
        bp_dicts = [data["users"][u]["block_progress"] for u in expectations]
        for i in range(len(bp_dicts)):
            for j in range(i + 1, len(bp_dicts)):
                self.assertIsNot(bp_dicts[i], bp_dicts[j])
                self.assertNotEqual(bp_dicts[i], bp_dicts[j])

        # Pool-wide best share is the max across all shares (alice/bob/carol's
        # best is carol's 400.0) and must not equal any single non-max user's.
        pool_bpg = data["pool"]["block_progress"]
        self.assertEqual(pool_bpg["best_share_difficulty"], 400.0)
        self.assertNotEqual(
            pool_bpg["best_share_difficulty"],
            data["users"]["alice"]["block_progress"]["best_share_difficulty"],
        )

    def test_one_worker_never_solved_amid_siblings_that_have(self):
        # Two workers under the same user: rig1 has a share, rig2 never
        # submitted an accepted share (a rejected-only worker) -- rig2's
        # block_progress must be independently null, not copied from rig1.
        now = datetime(2026, 7, 16, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [
            make_share(username="dave", workername="dave.rig1", createdate=cd(int(now.timestamp())), sdiff=250.0, result=True),
            make_share(username="dave", workername="dave.rig2", createdate=cd(int(now.timestamp())), sdiff=250.0, result=False),
        ])
        self.write_network_diff_log(1000.0)
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now, state_path=self.state_path)

        rig1 = data["workers"]["dave.rig1"]["block_progress"]
        rig2 = data["workers"]["dave.rig2"]["block_progress"]
        self.assertEqual(rig1["best_share_difficulty"], 250.0)
        self.assertIsNone(rig2["best_share_difficulty"],
                           "a worker with only rejected shares must not inherit a sibling worker's best_share_difficulty")
        self.assertIsNone(rig2["progress_percent"])
        self.assertIsNone(rig2["still_needed_multiplier"])
        # network_difficulty is still populated for the never-solved worker.
        self.assertAlmostEqual(rig2["network_difficulty"], 1000.0, delta=1)


class TestNonFiniteStress(TempLogDirMixin, unittest.TestCase):
    """Brief requires a contrived scenario stressing the non-finite guard
    end-to-end through the full build_analytics() pipeline, not just
    block_progress.compute_block_progress() in isolation."""

    def test_full_pipeline_json_dumps_cleanly_with_extreme_sdiff_and_network_difficulty(self):
        now = datetime(2026, 7, 16, tzinfo=timezone.utc)
        # An enormous sdiff against a vanishingly small (but individually
        # finite, plain-decimal) network difficulty -- the FORWARD ratio
        # (best/network)*100 overflows a double even though neither input
        # alone does, while the RECIPROCAL ratio (network/best) merely
        # underflows toward 0.0 (still finite). block_progress.py's
        # currently-settled, Human-approved design (see
        # tests/test_block_progress_independent.py's own
        # TestIndependentNullGuard) guards each ratio independently, so
        # progress_percent is expected null here while
        # still_needed_multiplier is expected to survive as a tiny finite
        # value -- this is the full-pipeline equivalent of that same unit
        # -level guarantee, confirming analytics_builder.py's merge layer
        # doesn't add its own (re-)nulling on top of block_progress.py's
        # own per-field guards.
        tiny_network_diff_decimal = "0." + ("0" * 299) + "1"  # == 1e-300
        self.write_share_lines("a.sharelog", [
            make_share(username="eve", workername="eve.rig1", createdate=cd(int(now.timestamp())), sdiff=1e300),
        ])
        self.write_network_diff_log_raw(tiny_network_diff_decimal)
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now, state_path=self.state_path)

        serialized = json.dumps(data)
        self.assertNotIn("Infinity", serialized)
        self.assertNotIn("NaN", serialized)
        reparsed = json.loads(serialized)

        def walk(node):
            if isinstance(node, dict):
                for v in node.values():
                    walk(v)
            elif isinstance(node, list):
                for v in node:
                    walk(v)
            elif isinstance(node, float):
                self.assertTrue(node == node and node not in (float("inf"), float("-inf")),
                                f"non-finite float leaked into analytics output: {node}")

        walk(reparsed)
        # best_share_difficulty itself (not a ratio) is still surfaced even
        # though the derived forward ratio overflowed.
        self.assertEqual(data["users"]["eve"]["block_progress"]["best_share_difficulty"], 1e300)
        self.assertAlmostEqual(data["users"]["eve"]["block_progress"]["network_difficulty"], 1e-300, delta=1e-310)
        self.assertIsNone(data["users"]["eve"]["block_progress"]["progress_percent"])
        # Reciprocal ratio underflows toward (but not to a non-finite)
        # 0.0 -- must survive, per the independent-per-field guard design.
        self.assertTrue(math_isfinite(data["users"]["eve"]["block_progress"]["still_needed_multiplier"]))
        self.assertAlmostEqual(data["users"]["eve"]["block_progress"]["still_needed_multiplier"], 0.0)


def math_isfinite(value):
    import math
    return value is not None and math.isfinite(value)


class TestNoNetworkLogAtAllEndToEnd(TempLogDirMixin, unittest.TestCase):
    def test_no_ckpool_log_file_present_at_all_every_scope_still_well_formed(self):
        now = datetime(2026, 7, 16, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [
            make_share(username="frank", workername="frank.rig1", createdate=cd(int(now.timestamp())), sdiff=42.0),
        ])
        # Deliberately no write_network_diff_log() call -- no ckpool.log at all.
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now, state_path=self.state_path)

        for scope in (data["pool"], data["users"]["frank"], data["workers"]["frank.rig1"]):
            bpg = scope["block_progress"]
            self.assertIsNone(bpg["network_difficulty"])
            self.assertIsNone(bpg["progress_percent"])
            self.assertIsNone(bpg["still_needed_multiplier"])
        self.assertEqual(data["users"]["frank"]["block_progress"]["best_share_difficulty"], 42.0)
        self.assertEqual(data["pool"]["block_progress"]["best_share_difficulty"], 42.0)
        json.dumps(data)


class TestUntouchedProductionModules(unittest.TestCase):
    """Milestone 30's own stated design goal: histogram_builder.py,
    ckpool_native_stats.py, and analytics_state.py should be touched by
    NONE of this milestone's changes. This only inspects the working tree
    via `git diff`/`git status` -- it never writes to or modifies any of
    these files itself."""

    REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    def _git(self, *args):
        return subprocess.run(
            ["git", *args], cwd=self.REPO_ROOT, capture_output=True, text=True, check=True,
        ).stdout

    def test_histogram_builder_not_modified_in_working_tree(self):
        diff = self._git("diff", "--", "histogram_builder.py")
        self.assertEqual(diff.strip(), "", "histogram_builder.py has uncommitted changes -- Milestone 30 should not touch it")

    def test_ckpool_native_stats_not_modified_in_working_tree(self):
        diff = self._git("diff", "--", "ckpool_native_stats.py")
        self.assertEqual(diff.strip(), "", "ckpool_native_stats.py has uncommitted changes -- Milestone 30 should not touch it")

    def test_analytics_state_not_modified_in_working_tree(self):
        diff = self._git("diff", "--", "analytics_state.py")
        self.assertEqual(diff.strip(), "", "analytics_state.py has uncommitted changes -- Milestone 30 should not touch it")

    def test_none_of_the_three_appear_as_untracked_new_files_either(self):
        status = self._git("status", "--porcelain=v1", "--",
                            "histogram_builder.py", "ckpool_native_stats.py", "analytics_state.py")
        self.assertEqual(status.strip(), "")


if __name__ == "__main__":
    unittest.main()
