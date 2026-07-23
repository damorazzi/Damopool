#!/usr/bin/env python3
"""
Independent adversarial test pass for analytics_builder.py's Milestone 31
integration (worker session fields merged into workers_out only).

Uses only synthetic sharelog fixture data in tempfile.mkdtemp() sandboxes.
Never touches /home/damopool/ckpool-solo/ckpool/logs or any real state/
analytics file.

Run with:
    python3 -m unittest -v tests.test_analytics_builder_worker_sessions_adversarial_m31
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


def cd(epoch_seconds, nanos=0):
    return f"{epoch_seconds},{nanos}"


def make_share(username="u1", workername="u1.w1", agent="agent", diff=1,
                sdiff=1.5, result=True, createdate="1700000000,123456789",
                enonce1="e1", clientid=1):
    return {
        "username": username,
        "workername": workername,
        "agent": agent,
        "diff": diff,
        "sdiff": sdiff,
        "result": result,
        "createdate": createdate,
        "enonce1": enonce1,
        "clientid": clientid,
    }


class TempLogDirMixin:
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_ab_wsess_adv_")
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


class TestPoolUsersNeverGetSessionFields(TempLogDirMixin, unittest.TestCase):
    def test_no_session_prefixed_key_ever_leaks_into_pool_or_users(self):
        now = datetime(2026, 7, 16, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="alice.rig1", enonce1="X", clientid=7,
                       result=True, createdate=cd(int(now.timestamp()) - 100)),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now, state_path=self.state_path)
        pool_session_keys = [k for k in data["pool"] if k.startswith("session_")]
        user_session_keys = [k for k in data["users"]["alice"] if k.startswith("session_")]
        self.assertEqual(pool_session_keys, [])
        self.assertEqual(user_session_keys, [])
        worker_session_keys = {k for k in data["workers"]["alice.rig1"] if k.startswith("session_")}
        self.assertEqual(worker_session_keys, {"session_accepted_count", "session_rejected_count", "session_started_at"})


class TestEveryWorkerAlwaysHasAllThreeFields(TempLogDirMixin, unittest.TestCase):
    def test_a_worker_that_worker_statistics_creates_but_worker_sessions_never_saw_gets_the_zero_fallback(self):
        # A share with a valid workername (so worker_statistics.py creates
        # an entry) but an invalid enonce1 (so worker_sessions.py excludes
        # it entirely) -- the worker must still surface well-formed,
        # all-zero/null session fields, never a missing key or a KeyError.
        now = datetime(2026, 7, 16, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="alice.rig1", enonce1=None,
                       createdate=cd(int(now.timestamp()) - 10)),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now, state_path=self.state_path)
        worker = data["workers"]["alice.rig1"]
        self.assertIn("session_accepted_count", worker)
        self.assertIn("session_rejected_count", worker)
        self.assertIn("session_started_at", worker)
        self.assertEqual(worker["session_accepted_count"], 0)
        self.assertEqual(worker["session_rejected_count"], 0)
        self.assertIsNone(worker["session_started_at"])
        # Sanity: the worker's LIFETIME accepted_count is unaffected and
        # still correctly populated (proves the two systems are additive,
        # not entangled).
        self.assertEqual(worker["accepted_count"], 1)

    def test_many_workers_all_get_the_three_keys_regardless_of_which_had_valid_session_data(self):
        now = datetime(2026, 7, 16, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [
            make_share(username="alice", workername="alice.rig1", enonce1="A1", createdate=cd(int(now.timestamp()) - 10)),
            make_share(username="alice", workername="alice.rig2", enonce1=None, createdate=cd(int(now.timestamp()) - 10)),
            make_share(username="bob", workername="bob.rig1", enonce1="", createdate=cd(int(now.timestamp()) - 10)),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now, state_path=self.state_path)
        for workername in ("alice.rig1", "alice.rig2", "bob.rig1"):
            worker = data["workers"][workername]
            for key in ("session_accepted_count", "session_rejected_count", "session_started_at"):
                self.assertIn(key, worker, f"{workername} missing {key}")


class TestJsonSerializationUnderVariedSessionShapes(TempLogDirMixin, unittest.TestCase):
    def test_full_output_json_serializable_with_many_concurrent_sessions_and_recycled_clientids(self):
        now = datetime(2026, 7, 16, tzinfo=timezone.utc)
        self.write_share_lines("a.sharelog", [
            make_share(workername="alice.rig1", enonce1="X", clientid=7, createdate=cd(1700000000)),
            make_share(workername="alice.rig1", enonce1="Y", clientid=49, createdate=cd(1700001000)),
            make_share(workername="alice.rig1", enonce1="Z", clientid=7, createdate=cd(1700002000)),
            make_share(workername="alice.rig1", enonce1=None, createdate=cd(1700003000)),
        ])
        data = ab.build_analytics(logs_dir=self.tmpdir, now=now, state_path=self.state_path)
        serialized = json.dumps(data)
        reloaded = json.loads(serialized)
        self.assertEqual(
            reloaded["workers"]["alice.rig1"]["session_started_at"],
            data["workers"]["alice.rig1"]["session_started_at"],
        )


class TestUntouchedSiblingModules(unittest.TestCase):
    """Confirms histogram_builder.py, ckpool_native_stats.py,
    block_progress.py, analytics_state.py were NOT modified by this
    milestone, per the required scope (worker_sessions.py is a new,
    standalone module; analytics_builder.py's own diff is the only
    wiring change)."""

    def test_sibling_production_modules_match_git_head(self):
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        sibling_modules = [
            "histogram_builder.py",
            "ckpool_native_stats.py",
            "block_progress.py",
            "analytics_state.py",
        ]
        result = subprocess.run(
            ["git", "diff", "--name-only", "HEAD", "--"] + sibling_modules,
            cwd=repo_root, capture_output=True, text=True, check=True,
        )
        changed = [line for line in result.stdout.splitlines() if line.strip()]
        self.assertEqual(changed, [], f"unexpected diff vs HEAD in sibling modules: {changed}")


if __name__ == "__main__":
    unittest.main()
