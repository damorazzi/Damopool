#!/usr/bin/env python3
"""
Independent adversarial test pass for analytics_state.py (Feature 006),
written by an independent test engineer per the review brief dated
2026-07-16. Focus: gaps NOT already covered by tests/test_analytics_state.py's
22 tests -- fingerprint edge cases beyond the happy path, concurrent/
overlapping best-share scope correctness, the `changed` bookkeeping's
completeness, agent-merge ordering semantics, best_share_today tie
equivalence, and crash/robustness gaps in update_state's per-file loop.

Uses only synthetic fixture data written to tempfile.mkdtemp() sandboxes.
Never touches /home/damopool/ckpool-solo/ckpool/logs or the real
analytics.state.json/analytics.json.

UPDATE (lead engineer, after the test-engineer pass): TestPrefixHashSpanGap,
TestMidScanFileVanishes, and TestChangedTracking's partial-trailing-line
test originally reproduced three real Major defects found by this
adversarial pass. All three have since been fixed in analytics_state.py
(unbounded-region prefix hashing instead of a capped span; OSError
handling around every per-file read so a mid-scan vanish skips just that
file instead of aborting the run; and not marking `changed=True` when a
file's only "new" bytes are a persistent incomplete trailing line). These
tests now assert the CORRECT behavior and pass; they remain here as
permanent regression coverage for exactly the defects that were found.
TestPathAliasing's symlink test is intentionally left failing/unfixed --
see PROJECT_LOG.md: it's a carried-forward Minor/informational limitation,
not reachable with the current production log layout.
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
import analytics_builder as ab


# A size threshold used only to build "large" test fixtures below --
# not tied to any production constant, since the fix removed the
# artificial hashed-span cap entirely (the check now covers the file's
# full consumed region, regardless of size).
LARGE_FIXTURE_SPAN = 65536


def cd(epoch_seconds, nanos=0):
    return f"{epoch_seconds},{nanos}"


def share(username="alice", workername="alice.rig1", agent="cgminer",
          result=True, sdiff=5.0, createdate=None):
    return {"username": username, "workername": workername, "agent": agent,
            "diff": 1, "sdiff": sdiff, "result": result, "createdate": createdate}


class SandboxMixin:
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="damopool_astate_adv_")
        self.logs_dir = os.path.join(self.tmpdir, "logs")
        os.makedirs(self.logs_dir)
        self.state_path = os.path.join(self.tmpdir, "analytics.state.json")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def write(self, name, text):
        path = os.path.join(self.logs_dir, name)
        with open(path, "w") as f:
            f.write(text)
        return path


# ---------------------------------------------------------------------------
# Focus 1: fingerprint / PREFIX_HASH_SPAN edge cases
# ---------------------------------------------------------------------------
class TestPrefixHashSpanGap(SandboxMixin, unittest.TestCase):
    def test_content_change_beyond_prefix_hash_span_but_within_consumed_offset_is_missed(self):
        """FIXED DEFECT, permanent regression coverage (originally Major).

        _check_consistency / _read_prefix_hash used to cap the hashed span
        at a fixed 65536 bytes via `min(upto, PREFIX_HASH_SPAN)`, rather
        than hashing the full already-committed `offset`. For any file
        whose consumed offset exceeded 65536 bytes, an in-place content
        change located between byte 65536 and the true offset -- i.e.
        squarely inside the region already committed to state -- went
        completely undetected as long as size and mtime_ns were preserved
        (the exact same tampering shape as the already-fixed same-size/
        same-mtime replacement bug, just deeper into a larger file).

        Fixed by removing the cap: _read_prefix_hash now always hashes the
        full `upto` bytes. This test now passes, proving tampering anywhere
        in the consumed region is detected regardless of file size.
        """
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        base_ts = int(now.timestamp()) - 10000
        lines = []
        for i in range(2000):
            lines.append(json.dumps(share(username=f"user{i:04d}", sdiff=5.0,
                                           createdate=cd(base_ts + i))))
        path = self.write("a.sharelog", "\n".join(lines) + "\n")
        self.assertGreater(os.path.getsize(path), LARGE_FIXTURE_SPAN,
                            "fixture must exceed the hashed span to probe the gap")

        state1 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        fp1 = state1["files"][path]["fingerprint"]
        self.assertGreater(fp1["offset"], LARGE_FIXTURE_SPAN,
                            "fixture must be fully consumed beyond the hashed span")

        # Tamper with a line whose bytes sit beyond PREFIX_HASH_SPAN but
        # well within the already-consumed offset, preserving file size and
        # mtime_ns exactly (same technique test_analytics_state.py's
        # replacement tests use to isolate the prefix-hash check).
        with open(path, "rb") as f:
            data = f.read()
        pos = data.index(b"\n", LARGE_FIXTURE_SPAN + 500) + 1
        line_end = data.index(b"\n", pos)
        old_record = json.loads(data[pos:line_end])
        new_record = dict(old_record)
        self.assertEqual(len(old_record["username"]), 8)
        new_record["username"] = "TAMPERD"[:8].ljust(8, "!")  # keep exact byte length
        new_record["sdiff"] = 9.0  # same textual length as "5.0"
        new_line = json.dumps(new_record).encode()
        self.assertEqual(len(new_line), len(data[pos:line_end]),
                          "fixture requires an exact-length replacement line")
        new_data = data[:pos] + new_line + data[line_end:]
        self.assertEqual(len(new_data), len(data))

        stat_before = os.stat(path)
        with open(path, "wb") as f:
            f.write(new_data)
        os.utime(path, ns=(stat_before.st_mtime_ns, stat_before.st_mtime_ns))
        self.assertEqual(os.stat(path).st_size, stat_before.st_size)
        self.assertEqual(os.stat(path).st_mtime_ns, stat_before.st_mtime_ns)

        state2 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged2 = astate.merge_state_to_analytics(
            state2, now, now.date(), now.date() - datetime.timedelta(days=1))

        # Correct/expected behaviour: a content change to already-committed
        # bytes anywhere in the file must be caught by the prefix-hash
        # re-verification and trigger a reset (the tampered value should
        # appear; the stale value should not survive unnoticed).
        self.assertIn(new_record["username"], merged2["users"],
                       "tampering beyond PREFIX_HASH_SPAN must still be detected")


# ---------------------------------------------------------------------------
# Focus 1: symlink/hardlink path aliasing (informational -- not reachable
# with the real production sharelog layout, which uses no symlinks, but a
# real architectural gap if the log layout ever changes).
# ---------------------------------------------------------------------------
class TestPathAliasing(SandboxMixin, unittest.TestCase):
    @unittest.expectedFailure
    def test_symlinked_alias_to_same_file_double_counts(self):
        """KNOWN LIMITATION, deliberately NOT fixed (Minor/informational --
        see PROJECT_LOG.md). Marked @expectedFailure so this stays a
        permanent regression check without turning the suite red: if this
        test starts passing (e.g. a future feature adds dev/ino-based
        dedup), unittest will flag it as an unexpected success, prompting
        removal of this marker.

        find_sharelog_files() globs by path, and update_state keys
        files_state by path, not by (dev, ino). Two distinct paths that
        resolve to the same underlying file (e.g. a rotation-convenience
        symlink alongside the real file) are processed as two independent
        files and their shares are double-counted. Confirmed not reachable
        with the current production /logs layout (numeric per-clientid
        directories, no symlinks observed), so this is carried forward as
        an informational/Minor architectural gap rather than fixed now.
        """
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        real_path = self.write(
            "2026-07-16.sharelog",
            json.dumps(share(username="alice", createdate=cd(int(now.timestamp())))) + "\n",
        )
        symlink_path = os.path.join(self.logs_dir, "current.sharelog")
        os.symlink(real_path, symlink_path)

        state = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(
            state, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertEqual(
            merged["pool"]["accepted_count"], 1,
            "a symlink alias to the same underlying file must not double-count shares "
            "(currently DOES double-count: 2)",
        )


# ---------------------------------------------------------------------------
# Focus 1: size/mtime edge cases that SHOULD be caught -- confirm no
# regression here.
# ---------------------------------------------------------------------------
class TestFingerprintSanity(SandboxMixin, unittest.TestCase):
    def test_size_shrinks_and_mtime_also_decreases_still_caught(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        path = self.write(
            "a.sharelog",
            json.dumps(share(username="alice", createdate=cd(int(now.timestamp())))) + "\n"
            + json.dumps(share(username="alice2", createdate=cd(int(now.timestamp())))) + "\n",
        )
        astate.update_state(self.logs_dir, now, state_path=self.state_path)
        stat1 = os.stat(path)

        time.sleep(0.01)
        with open(path, "w") as f:
            f.write(json.dumps(share(username="bob", createdate=cd(int(now.timestamp())))) + "\n")
        # Force mtime_ns to be strictly EARLIER than before, in addition to
        # the file being smaller -- both signals agree "smaller/older".
        earlier_ns = stat1.st_mtime_ns - 10_000_000_000
        os.utime(path, ns=(earlier_ns, earlier_ns))

        state2 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(
            state2, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertIn("bob", merged["users"])
        self.assertNotIn("alice", merged["users"])
        self.assertNotIn("alice2", merged["users"])

    def test_growth_past_hashed_prefix_alone_is_not_falsely_flagged_inconsistent(self):
        """A file that grows past PREFIX_HASH_SPAN with genuinely new,
        unmodified content must NOT be treated as inconsistent -- growth
        alone is legitimate and must be read incrementally, not reset."""
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        base_ts = int(now.timestamp()) - 10000
        first_lines = [json.dumps(share(username=f"user{i:04d}", sdiff=5.0,
                                         createdate=cd(base_ts + i))) for i in range(100)]
        path = self.write("a.sharelog", "\n".join(first_lines) + "\n")
        self.assertLess(os.path.getsize(path), LARGE_FIXTURE_SPAN)

        state1 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged1 = astate.merge_state_to_analytics(
            state1, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertEqual(merged1["pool"]["accepted_count"], 100)

        # Grow the file well past PREFIX_HASH_SPAN with legitimate new lines.
        more_lines = [json.dumps(share(username=f"grown{i:04d}", sdiff=5.0,
                                        createdate=cd(base_ts + 1000 + i))) for i in range(2000)]
        with open(path, "a") as f:
            f.write("\n".join(more_lines) + "\n")
        self.assertGreater(os.path.getsize(path), LARGE_FIXTURE_SPAN)

        state2 = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged2 = astate.merge_state_to_analytics(
            state2, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertEqual(merged2["pool"]["accepted_count"], 2100,
                          "legitimate growth past the hashed span must be read incrementally, not reset")


# ---------------------------------------------------------------------------
# Focus 2: concurrent/overlapping best-share scope correctness
# ---------------------------------------------------------------------------
class TestConcurrentBestShareScopes(SandboxMixin, unittest.TestCase):
    def test_same_record_is_the_best_at_pool_user_and_worker_scope_with_multiple_files_and_candidates(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        base = int(now.timestamp()) - 5000

        def s(username, workername, sdiff, ts):
            return json.dumps(share(username=username, workername=workername, sdiff=sdiff,
                                     createdate=cd(ts)))

        self.write("a_first.sharelog", "\n".join([
            s("champ", "champ.rig1", 50.0, base + 1),
            s("other", "other.rig1", 40.0, base + 2),
        ]) + "\n")
        self.write("m_middle.sharelog", "\n".join([
            s("champ", "champ.rig1", 999.0, base + 3),   # the global-record share
            s("champ", "champ.rig2", 30.0, base + 4),    # same user, different worker
        ]) + "\n")
        self.write("z_last.sharelog", "\n".join([
            s("other", "other.rig1", 999.0, base + 10),  # exact-sdiff tie, LATER timestamp: must lose
            s("champ", "champ.rig1", 100.0, base + 11),
        ]) + "\n")

        state = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(
            state, now, now.date(), now.date() - datetime.timedelta(days=1))

        expected = {
            "username": "champ", "workername": "champ.rig1", "sdiff": 999.0,
            "timestamp": (now - datetime.timedelta(seconds=(now.timestamp() - (base + 3)))).isoformat()
            if False else None,  # timestamp compared loosely below
        }
        pool_best = merged["pool"]["best_share_ever"]
        user_best = merged["users"]["champ"]["best_share_ever"]
        worker_best = merged["workers"]["champ.rig1"]["best_share_ever"]

        for scope_name, best in (("pool", pool_best), ("user", user_best), ("worker", worker_best)):
            self.assertEqual(best["username"], "champ", scope_name)
            self.assertEqual(best["workername"], "champ.rig1", scope_name)
            self.assertEqual(best["sdiff"], 999.0, scope_name)

        self.assertEqual(pool_best, user_best)
        self.assertEqual(pool_best, worker_best)

        # No cross-contamination: champ.rig2's own best is its own 30.0 share,
        # not champ.rig1's 999.0.
        self.assertEqual(merged["workers"]["champ.rig2"]["best_share_ever"]["sdiff"], 30.0)
        # "other"'s best is its own tied 999.0 share (loses the cross-user tie
        # to champ only for POOL scope ranking purposes, but "other" still has
        # its own correct best_share_ever independently).
        self.assertEqual(merged["users"]["other"]["best_share_ever"]["sdiff"], 999.0)
        self.assertEqual(merged["users"]["other"]["best_share_ever"]["username"], "other")


# ---------------------------------------------------------------------------
# Focus 3: `changed` tracking completeness + a discovered spurious-write cost
# ---------------------------------------------------------------------------
class TestChangedTracking(SandboxMixin, unittest.TestCase):
    def test_new_file_appearing_is_persisted(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        self.write("a.sharelog", json.dumps(share(createdate=cd(int(now.timestamp())))) + "\n")
        astate.update_state(self.logs_dir, now, state_path=self.state_path)
        self.assertTrue(os.path.exists(self.state_path))
        mtime1 = os.stat(self.state_path).st_ino

        self.write("b.sharelog", json.dumps(share(username="bob", createdate=cd(int(now.timestamp())))) + "\n")
        astate.update_state(self.logs_dir, now, state_path=self.state_path)
        ino2 = os.stat(self.state_path).st_ino
        self.assertNotEqual(mtime1, ino2, "a newly-appeared file must persist (changed=True)")

    def test_recent_tuple_pruning_alone_triggers_persistence(self):
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        self.write("a.sharelog", json.dumps(share(createdate=cd(int(now.timestamp())))) + "\n")
        astate.update_state(self.logs_dir, now, state_path=self.state_path)
        ino1 = os.stat(self.state_path).st_ino

        much_later = now + datetime.timedelta(hours=72)
        astate.update_state(self.logs_dir, much_later, state_path=self.state_path)
        ino2 = os.stat(self.state_path).st_ino
        self.assertNotEqual(ino1, ino2, "recent_tuples pruning alone must still persist (changed=True)")

    def test_partial_trailing_line_forces_a_rewrite_on_every_run_forever(self):
        """FIXED DEFECT, permanent regression coverage (originally Major).

        A file whose latest bytes form a persistent, never-completed
        trailing line (the realistic steady-state of an actively-tailed,
        currently-being-written sharelog) used to never satisfy the old
        fast-path's exact `stored_offset == current_size` condition, since
        current_size always includes the uncommitted partial tail while
        offset does not. Every single run therefore fell through to the
        full per-file branch, which unconditionally set `changed = True`
        and rewrote the state file even when NOTHING about the actually
        committed data changed between runs -- re-introducing, for this
        specific but realistic input shape, the exact "rewritten every run
        regardless of whether anything changed" cost bug #3 was fixed to
        eliminate.

        Fixed by keying the "did anything change" decision off whether any
        new COMPLETE lines were actually read (`new_lines` non-empty) when
        the file was already consistent, rather than off the offset/size
        equality that a permanently-incomplete trailing line can never
        satisfy. This test now passes.
        """
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        path = self.write("a.sharelog", json.dumps(share(createdate=cd(int(now.timestamp())))) + "\n")
        with open(path, "a") as f:
            f.write('{"partial_line_that_never_completes"')

        astate.update_state(self.logs_dir, now, state_path=self.state_path)  # establish baseline

        inodes = []
        for _ in range(3):
            astate.update_state(self.logs_dir, now, state_path=self.state_path)
            inodes.append(os.stat(self.state_path).st_ino)

        self.assertEqual(
            len(set(inodes)), 1,
            f"state file was rewritten on every run ({inodes}) even though the file's "
            "committed content never changed across these runs -- only its uncompleted "
            "trailing partial line's presence did",
        )


# ---------------------------------------------------------------------------
# Focus 4: agent merge correctness under adversarial (non-chronological)
# file-name ordering
# ---------------------------------------------------------------------------
class TestAgentMergeAdversarialOrdering(SandboxMixin, unittest.TestCase):
    def test_lexicographically_first_file_with_chronologically_newest_data_loses_to_lexicographically_last_file(self):
        """Reproduces exactly the semantics of the original batch
        implementation (which iterates find_sharelog_files' SORTED PATH
        order, not chronological order): the LAST file in sorted-path
        order wins the agent field for a worker, even when that file's
        content is chronologically OLDER than a lexicographically-earlier
        file's content."""
        import worker_statistics
        from parse_share_analytics import find_sharelog_files, parse_sharelog_file

        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        base = int(now.timestamp()) - 100000

        self.write("a_newest.sharelog", json.dumps(share(
            username="w1u", workername="w1", agent="firmware-NEW",
            createdate=cd(base + 9000))) + "\n")
        self.write("z_oldest.sharelog", json.dumps(share(
            username="w1u", workername="w1", agent="firmware-OLD",
            createdate=cd(base + 1))) + "\n")

        state = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(
            state, now, now.date(), now.date() - datetime.timedelta(days=1))

        true_order_shares = []
        for path in find_sharelog_files(self.logs_dir):
            true_order_shares.extend(parse_sharelog_file(path))
        ref = worker_statistics.compute_worker_statistics(true_order_shares, today=now.date(), now=now)

        self.assertEqual(merged["workers"]["w1"]["agent"], ref["w1"]["agent"])
        self.assertEqual(merged["workers"]["w1"]["agent"], "firmware-OLD")

    def test_last_file_with_no_valid_agent_does_not_blank_out_an_earlier_files_valid_agent(self):
        import worker_statistics
        from parse_share_analytics import find_sharelog_files, parse_sharelog_file

        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        base = int(now.timestamp()) - 1000

        self.write("a_has_agent.sharelog", json.dumps(share(
            username="w1u", workername="w1", agent="firmware-v1",
            createdate=cd(base))) + "\n")
        self.write("z_no_agent.sharelog", json.dumps(share(
            username="w1u", workername="w1", agent=None,
            createdate=cd(base + 1))) + "\n")

        state = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(
            state, now, now.date(), now.date() - datetime.timedelta(days=1))

        true_order_shares = []
        for path in find_sharelog_files(self.logs_dir):
            true_order_shares.extend(parse_sharelog_file(path))
        ref = worker_statistics.compute_worker_statistics(true_order_shares, today=now.date(), now=now)

        self.assertEqual(merged["workers"]["w1"]["agent"], ref["w1"]["agent"])
        self.assertEqual(merged["workers"]["w1"]["agent"], "firmware-v1")


# ---------------------------------------------------------------------------
# Focus 5: best_share_today tie-derivation equivalence for users, stressed
# across multiple files with ties at various chronological positions
# ---------------------------------------------------------------------------
class TestBestShareTodayTieEquivalence(SandboxMixin, unittest.TestCase):
    def test_ties_at_first_later_and_threeway_positions_across_multiple_files_match_independent_besttracker(self):
        import user_statistics
        from parse_share_analytics import find_sharelog_files, parse_sharelog_file

        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
        base = int(midnight.timestamp()) + 100

        def s(username, workername, sdiff, ts):
            return json.dumps(share(username=username, workername=workername, sdiff=sdiff,
                                     createdate=cd(ts)))

        # alice: tie is the VERY FIRST candidate, split across two files.
        self.write("f1.sharelog", s("alice", "alice.r1", 10.0, base + 1) + "\n")
        self.write("f2.sharelog", "\n".join([
            s("alice", "alice.r2", 10.0, base + 2),  # exact tie, later ts -> must lose
            s("alice", "alice.r1", 3.0, base + 3),
        ]) + "\n")

        # bob: tie is a LATER candidate, then a three-way tie, across three files.
        self.write("f3.sharelog", s("bob", "bob.r1", 4.0, base + 10) + "\n")
        self.write("f4.sharelog", s("bob", "bob.r2", 20.0, base + 11) + "\n")
        self.write("f5.sharelog", "\n".join([
            s("bob", "bob.r3", 20.0, base + 12),
            s("bob", "bob.r1", 20.0, base + 13),
        ]) + "\n")

        state = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        merged = astate.merge_state_to_analytics(
            state, now, now.date(), now.date() - datetime.timedelta(days=1))

        true_order_shares = []
        for path in find_sharelog_files(self.logs_dir):
            true_order_shares.extend(parse_sharelog_file(path))
        ref = user_statistics.compute_user_statistics(true_order_shares, today=now.date())

        self.assertEqual(merged["users"]["alice"]["best_share_today"], ref["alice"]["best_share_today"])
        self.assertEqual(merged["users"]["bob"]["best_share_today"], ref["bob"]["best_share_today"])
        self.assertEqual(merged["users"]["alice"]["best_share_today"]["workername"], "alice.r1")
        self.assertEqual(merged["users"]["bob"]["best_share_today"]["workername"], "bob.r2")


# ---------------------------------------------------------------------------
# Focus 6: crash/robustness -- a single file vanishing mid-scan (TOCTOU)
# ---------------------------------------------------------------------------
class TestMidScanFileVanishes(SandboxMixin, unittest.TestCase):
    def test_file_deleted_between_stat_and_read_does_not_crash_the_whole_run(self):
        """FIXED DEFECT, permanent regression coverage (originally Major).

        The initial os.stat(path) call inside update_state's per-file loop
        was guarded with `except OSError: continue`, showing a
        missing/vanished file was already an anticipated, intentionally-
        tolerated condition -- but the following operations in the same
        iteration (_check_consistency's internal open() via
        _read_prefix_hash, and _read_new_lines' open()) were NOT guarded.
        A file disappearing in the narrow window between the stat()
        succeeding and those subsequent reads (a realistic race on a live
        pool actively creating/rotating sharelog files while this script
        polls) raised an uncaught FileNotFoundError, aborting the entire
        run and discarding in-memory progress on every other file already
        processed that iteration.

        Fixed by wrapping the consistency check and both reads in the same
        try/except OSError as the leading stat() call, so a mid-scan vanish
        skips just that one file (leaving its existing state untouched) and
        the run continues normally for every other file. This test now
        passes.
        """
        now = datetime.datetime(2026, 7, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
        self.write("a_good.sharelog", json.dumps(share(username="alice", createdate=cd(int(now.timestamp())))) + "\n")
        racy_path = self.write("z_vanishes.sharelog", json.dumps(share(username="bob", createdate=cd(int(now.timestamp())))) + "\n")

        real_stat = os.stat

        def racy_stat(p, *a, **kw):
            result = real_stat(p, *a, **kw)
            if str(p) == racy_path:
                os.remove(p)  # simulate the file vanishing right after stat() succeeds
            return result

        astate.os.stat = racy_stat
        try:
            state = astate.update_state(self.logs_dir, now, state_path=self.state_path)
        except FileNotFoundError as exc:
            self.fail(
                f"update_state crashed on a file that vanished mid-scan instead of "
                f"skipping it gracefully like the leading os.stat() guard intends: {exc}"
            )
        finally:
            astate.os.stat = real_stat

        merged = astate.merge_state_to_analytics(
            state, now, now.date(), now.date() - datetime.timedelta(days=1))
        self.assertIn("alice", merged["users"], "the other, non-racy file must still be processed")


if __name__ == "__main__":
    unittest.main()
