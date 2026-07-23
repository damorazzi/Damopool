#!/usr/bin/env python3
"""
Regression suite for block_progress.py (Phase E Milestone 30: Block
Progress Analytics) -- a pure, stateless computation, so this file has
no file I/O and no tempfile sandboxes at all, unlike histogram_builder.py/
ckpool_native_stats.py's own test suites.

Run with:
    python3 -m unittest -v tests.test_block_progress
"""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import block_progress as bp


class TestNormalCalculation(unittest.TestCase):
    def test_matches_the_documented_formula(self):
        result = bp.compute_block_progress(28_600_000_000, 126_000_000_000_000)
        self.assertEqual(result["best_share_difficulty"], 28_600_000_000)
        self.assertEqual(result["network_difficulty"], 126_000_000_000_000)
        self.assertAlmostEqual(result["progress_percent"], (28_600_000_000 / 126_000_000_000_000) * 100)
        self.assertAlmostEqual(result["still_needed_multiplier"], 126_000_000_000_000 / 28_600_000_000)

    def test_best_share_equal_to_network_difficulty_is_100_percent_and_multiplier_1(self):
        result = bp.compute_block_progress(500.0, 500.0)
        self.assertAlmostEqual(result["progress_percent"], 100.0)
        self.assertAlmostEqual(result["still_needed_multiplier"], 1.0)

    def test_best_share_exceeding_network_difficulty_is_still_a_plain_ratio_over_100_percent(self):
        # A real, if rare, event (a lucky share genuinely harder than the
        # current network target) -- this module doesn't cap the ratio,
        # it just reports it, matching "not intended to ... estimate
        # probability" (i.e. no artificial ceiling is imposed either).
        result = bp.compute_block_progress(1000.0, 500.0)
        self.assertAlmostEqual(result["progress_percent"], 200.0)
        self.assertAlmostEqual(result["still_needed_multiplier"], 0.5)


class TestMissingInputs(unittest.TestCase):
    def test_missing_best_share_yields_null_ratios_but_keeps_network_difficulty(self):
        result = bp.compute_block_progress(None, 126_000_000_000_000)
        self.assertIsNone(result["best_share_difficulty"])
        self.assertEqual(result["network_difficulty"], 126_000_000_000_000)
        self.assertIsNone(result["progress_percent"])
        self.assertIsNone(result["still_needed_multiplier"])

    def test_missing_network_difficulty_yields_null_ratios_but_keeps_best_share(self):
        result = bp.compute_block_progress(28_600_000_000, None)
        self.assertEqual(result["best_share_difficulty"], 28_600_000_000)
        self.assertIsNone(result["network_difficulty"])
        self.assertIsNone(result["progress_percent"])
        self.assertIsNone(result["still_needed_multiplier"])

    def test_both_missing_yields_an_entirely_null_object(self):
        result = bp.compute_block_progress(None, None)
        self.assertEqual(result, {
            "best_share_difficulty": None,
            "network_difficulty": None,
            "progress_percent": None,
            "still_needed_multiplier": None,
        })


class TestZeroAndNegativeGuards(unittest.TestCase):
    """"Never divide by zero" -- best_share_difficulty is normally always
    > 0 by the time it reaches here (is_valid_sdiff requires it upstream),
    but this function defends independently rather than trusting that
    invariant silently."""

    def test_zero_best_share_difficulty_never_divides_by_zero(self):
        result = bp.compute_block_progress(0, 126_000_000_000_000)
        self.assertIsNone(result["best_share_difficulty"])
        self.assertIsNone(result["progress_percent"])
        self.assertIsNone(result["still_needed_multiplier"])

    def test_zero_network_difficulty_never_divides_by_zero(self):
        result = bp.compute_block_progress(500.0, 0)
        self.assertIsNone(result["network_difficulty"])
        self.assertIsNone(result["progress_percent"])
        self.assertIsNone(result["still_needed_multiplier"])

    def test_negative_best_share_difficulty_is_rejected(self):
        result = bp.compute_block_progress(-500.0, 126_000_000_000_000)
        self.assertIsNone(result["best_share_difficulty"])
        self.assertIsNone(result["progress_percent"])

    def test_negative_network_difficulty_is_rejected(self):
        result = bp.compute_block_progress(500.0, -126_000_000_000_000)
        self.assertIsNone(result["network_difficulty"])
        self.assertIsNone(result["progress_percent"])

    def test_both_zero_is_entirely_null(self):
        result = bp.compute_block_progress(0, 0)
        self.assertEqual(result["progress_percent"], None)
        self.assertEqual(result["still_needed_multiplier"], None)


class TestLargeValues(unittest.TestCase):
    def test_extremely_small_best_share_against_a_huge_network_difficulty(self):
        result = bp.compute_block_progress(1.0, 210_000_000_000_000)
        self.assertAlmostEqual(result["progress_percent"], (1.0 / 210_000_000_000_000) * 100)
        self.assertAlmostEqual(result["still_needed_multiplier"], 210_000_000_000_000)

    def test_extremely_large_but_non_overflowing_values_compute_correctly(self):
        result = bp.compute_block_progress(1e20, 1e14)
        self.assertTrue(math.isfinite(result["progress_percent"]))
        self.assertTrue(math.isfinite(result["still_needed_multiplier"]))
        self.assertAlmostEqual(result["progress_percent"], (1e20 / 1e14) * 100)
        self.assertAlmostEqual(result["still_needed_multiplier"], 1e14 / 1e20)

    def test_a_result_that_would_overflow_to_infinity_is_discarded_as_null_not_emitted(self):
        # 1e300 / 1e-300 overflows a double to inf. Confirm this can
        # never leak into progress_percent -- json.dump would otherwise
        # emit the non-standard "Infinity" token.
        result = bp.compute_block_progress(1e300, 1e-300)
        self.assertIsNone(result["progress_percent"])

    def test_progress_percent_and_still_needed_multiplier_are_nulled_independently_not_as_a_pair(self):
        # Human decision (following a Code Review/Test Engineer split on
        # this exact question): the two ratios are guarded independently.
        # Here the forward ratio (best/network) overflows to inf and is
        # correctly nulled, while the reciprocal ratio (network/best)
        # merely underflows toward 0.0 -- still a real, finite, valid
        # value -- and must survive rather than being discarded just
        # because its sibling's own division happened to overflow.
        result = bp.compute_block_progress(1e300, 1e-300)
        self.assertIsNone(result["progress_percent"])
        self.assertTrue(math.isfinite(result["still_needed_multiplier"]))
        self.assertAlmostEqual(result["still_needed_multiplier"], 0.0)


class TestNonNumericAndNonFiniteInputs(unittest.TestCase):
    def test_nan_best_share_difficulty_is_rejected(self):
        result = bp.compute_block_progress(float("nan"), 126_000_000_000_000)
        self.assertIsNone(result["best_share_difficulty"])
        self.assertIsNone(result["progress_percent"])

    def test_infinite_best_share_difficulty_is_rejected(self):
        result = bp.compute_block_progress(float("inf"), 126_000_000_000_000)
        self.assertIsNone(result["best_share_difficulty"])
        self.assertIsNone(result["progress_percent"])

    def test_infinite_network_difficulty_is_rejected(self):
        result = bp.compute_block_progress(500.0, float("inf"))
        self.assertIsNone(result["network_difficulty"])
        self.assertIsNone(result["progress_percent"])

    def test_string_best_share_difficulty_is_rejected_not_a_crash(self):
        result = bp.compute_block_progress("500", 126_000_000_000_000)
        self.assertIsNone(result["best_share_difficulty"])
        self.assertIsNone(result["progress_percent"])

    def test_bool_is_rejected_despite_being_an_int_subclass(self):
        result = bp.compute_block_progress(True, 126_000_000_000_000)
        self.assertIsNone(result["best_share_difficulty"])
        self.assertIsNone(result["progress_percent"])


class TestOutputShape(unittest.TestCase):
    def test_always_returns_exactly_these_four_keys(self):
        result = bp.compute_block_progress(500.0, 126_000_000_000_000)
        self.assertEqual(set(result.keys()), {
            "best_share_difficulty", "network_difficulty", "progress_percent", "still_needed_multiplier",
        })


if __name__ == "__main__":
    unittest.main()
