#!/usr/bin/env python3
"""
Independent adversarial pass on block_progress.py (Phase E Milestone 30),
written by an independent test engineer reviewing the milestone. This is
intentionally NOT a duplicate of tests/test_block_progress.py -- it targets
gaps in that file's own coverage: -Infinity independently for each input,
wrong-type inputs beyond strings (list/dict/tuple), a genuine post-division
overflow check with both individually-valid inputs, and boolean False
(True is already covered upstream, but only for best_share_difficulty).

PROCESS NOTE: during this test pass, block_progress.py's own null-guarding
for progress_percent/still_needed_multiplier was observed to change twice
in the working tree -- independent-per-field, then briefly an all-or-
nothing paired guard, then back to independent-per-field with a comment
recording "Human decision ... keep progress_percent independent of
still_needed_multiplier" and a new confirming test in the shipped
tests/test_block_progress.py
(test_progress_percent_and_still_needed_multiplier_are_nulled_independently_not_as_a_pair).
This file's own TestIndependentNullGuard below re-confirms that same,
now-settled behavior with different input magnitudes than the shipped
test, as an independent check. Production code changing underneath an
in-progress independent test pass is itself noted as a process finding in
the final report; it is not, by itself, a defect in the final behavior,
which this file confirms is internally consistent and matches its own
docstring.

Run with:
    python3 -m unittest -v tests.test_block_progress_independent
"""
import json
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import block_progress as bp


class TestNegativeInfinity(unittest.TestCase):
    """test_block_progress.py covers +Infinity for both inputs but never
    -Infinity independently -- a distinct code path through
    math.isfinite() (which rejects both) worth confirming explicitly."""

    def test_negative_infinity_best_share_difficulty_is_rejected(self):
        result = bp.compute_block_progress(float("-inf"), 126_000_000_000_000)
        self.assertIsNone(result["best_share_difficulty"])
        self.assertIsNone(result["progress_percent"])
        self.assertIsNone(result["still_needed_multiplier"])
        self.assertEqual(result["network_difficulty"], 126_000_000_000_000)

    def test_negative_infinity_network_difficulty_is_rejected(self):
        result = bp.compute_block_progress(500.0, float("-inf"))
        self.assertIsNone(result["network_difficulty"])
        self.assertIsNone(result["progress_percent"])
        self.assertIsNone(result["still_needed_multiplier"])
        self.assertEqual(result["best_share_difficulty"], 500.0)

    def test_nan_network_difficulty_is_rejected(self):
        # test_block_progress.py covers NaN for best_share_difficulty but
        # never for network_difficulty independently.
        result = bp.compute_block_progress(500.0, float("nan"))
        self.assertIsNone(result["network_difficulty"])
        self.assertIsNone(result["progress_percent"])
        self.assertIsNone(result["still_needed_multiplier"])

    def test_bool_false_network_difficulty_is_rejected_despite_being_int_subclass(self):
        # test_block_progress.py only checks True (and only for
        # best_share_difficulty). False == 0 as an int, so this also
        # doubles as an implicit zero-division guard check for the bool
        # branch specifically.
        result = bp.compute_block_progress(500.0, False)
        self.assertIsNone(result["network_difficulty"])
        self.assertIsNone(result["progress_percent"])
        self.assertIsNone(result["still_needed_multiplier"])

    def test_bool_true_network_difficulty_is_rejected(self):
        result = bp.compute_block_progress(500.0, True)
        self.assertIsNone(result["network_difficulty"])
        self.assertIsNone(result["progress_percent"])


class TestWrongTypesBeyondString(unittest.TestCase):
    """test_block_progress.py only tries a string for best_share_difficulty.
    Confirm list/dict/tuple degrade cleanly (no crash) for BOTH inputs,
    since isinstance(value, (int, float)) should reject all of these but
    a copy-paste slip (e.g. checking only one branch) could let one
    through."""

    @staticmethod
    def _assert_fully_null(result):
        assert result["progress_percent"] is None
        assert result["still_needed_multiplier"] is None

    def test_list_best_share_difficulty(self):
        result = bp.compute_block_progress([500.0], 126_000_000_000_000)
        self.assertIsNone(result["best_share_difficulty"])
        self._assert_fully_null(result)

    def test_dict_best_share_difficulty(self):
        result = bp.compute_block_progress({"sdiff": 500.0}, 126_000_000_000_000)
        self.assertIsNone(result["best_share_difficulty"])
        self._assert_fully_null(result)

    def test_tuple_network_difficulty(self):
        result = bp.compute_block_progress(500.0, (126_000_000_000_000,))
        self.assertIsNone(result["network_difficulty"])
        self._assert_fully_null(result)

    def test_dict_network_difficulty(self):
        result = bp.compute_block_progress(500.0, {"value": 126_000_000_000_000})
        self.assertIsNone(result["network_difficulty"])
        self._assert_fully_null(result)

    def test_none_type_mixed_with_wrong_type_never_raises(self):
        # Must not raise for ANY combination -- exercise a handful in a
        # loop rather than one at a time, confirming the function never
        # raises regardless of which argument is bad.
        bad_values = [None, "500", [500], {"x": 1}, (500,), object(), float("nan"), float("inf"), True, False]
        for a in bad_values:
            for b in bad_values:
                with self.subTest(a=a, b=b):
                    result = bp.compute_block_progress(a, b)
                    self.assertEqual(set(result.keys()), {
                        "best_share_difficulty", "network_difficulty",
                        "progress_percent", "still_needed_multiplier",
                    })


class TestGenuinePostDivisionGuard(unittest.TestCase):
    """The brief specifically calls out: confirm there is a genuine
    POST-division finite check, not merely a pre-division positivity/
    finiteness guard. Both of the following pairs pass the pre-division
    guard (individually positive and finite) but the division result
    itself is degenerate."""

    def test_progress_percent_overflow_from_two_valid_looking_inputs(self):
        # 1e300 * 100 / 1e-300 -> overflows to inf in the multiplication
        # step (percent = (best/network)*100) even though both inputs
        # individually pass math.isfinite() and value > 0.
        result = bp.compute_block_progress(1e300, 1e-300)
        self.assertIsNone(result["progress_percent"])
        # best_share_difficulty/network_difficulty themselves are each
        # individually valid and must still be surfaced, unrelated to
        # the derived ratio's own finiteness.
        self.assertEqual(result["best_share_difficulty"], 1e300)
        self.assertEqual(result["network_difficulty"], 1e-300)
        json.dumps(result)  # must never leak inf into the JSON tree

    def test_still_needed_multiplier_overflow_from_two_valid_looking_inputs(self):
        # network/best = 1e300/1e-300 -> also overflows to inf.
        result = bp.compute_block_progress(1e-300, 1e300)
        self.assertIsNone(result["still_needed_multiplier"])
        json.dumps(result)

    def test_underflow_toward_but_not_at_zero_is_still_a_legitimate_finite_value(self):
        # A ratio that legitimately underflows toward (but not to) zero
        # is still a finite float -- a vanishingly small progress_percent
        # is a valid, meaningful value (an infinitesimally small share
        # versus a huge network difficulty), not something the finite-
        # guard should discard.
        result = bp.compute_block_progress(1.0, 1e300)
        self.assertTrue(math.isfinite(result["progress_percent"]))
        self.assertTrue(math.isfinite(result["still_needed_multiplier"]))
        self.assertGreater(result["progress_percent"], 0.0)


class TestIndependentNullGuard(unittest.TestCase):
    """Confirms the settled, Human-approved design (see this file's own
    module docstring): progress_percent and still_needed_multiplier are
    guarded INDEPENDENTLY of each other -- one overflowing to a
    non-finite value never nulls the other if the other's own division
    stayed finite. Uses different magnitudes than
    tests/test_block_progress.py's own equivalent test
    (test_progress_percent_and_still_needed_multiplier_are_nulled_independently_not_as_a_pair)
    as an independent confirmation, not a duplicate."""

    def test_one_ratio_overflows_while_its_sibling_stays_finite_and_is_kept(self):
        # best=5e-324 (smallest positive subnormal double), network=1.0:
        # percent = (5e-324/1.0)*100 ~ 4.94e-322 -- finite.
        # multiplier = 1.0/5e-324 ~ 2.02e323 -- overflows a double to inf.
        result = bp.compute_block_progress(5e-324, 1.0)
        self.assertTrue(math.isfinite((5e-324 / 1.0) * 100), "sanity check: percent should be finite in isolation")
        self.assertFalse(math.isfinite(1.0 / 5e-324), "sanity check: multiplier should overflow in isolation")
        self.assertIsNotNone(result["progress_percent"],
                              "progress_percent must survive even though its sibling ratio overflowed (independent-guard design)")
        self.assertTrue(math.isfinite(result["progress_percent"]))
        self.assertIsNone(result["still_needed_multiplier"])
        # Raw inputs are always surfaced regardless of ratio finiteness.
        self.assertEqual(result["best_share_difficulty"], 5e-324)
        self.assertEqual(result["network_difficulty"], 1.0)
        json.dumps(result)


class TestExtremeButFiniteValues(unittest.TestCase):
    def test_extremely_small_positive_subnormal_best_share_is_accepted_not_treated_as_zero(self):
        result = bp.compute_block_progress(5e-324, 1e-300)
        self.assertEqual(result["best_share_difficulty"], 5e-324)
        self.assertTrue(math.isfinite(result["progress_percent"]))
        self.assertTrue(math.isfinite(result["still_needed_multiplier"]))

    def test_max_finite_double_network_difficulty(self):
        result = bp.compute_block_progress(1.0, sys.float_info.max)
        self.assertEqual(result["network_difficulty"], sys.float_info.max)
        self.assertTrue(math.isfinite(result["progress_percent"]))
        self.assertTrue(math.isfinite(result["still_needed_multiplier"]))


class TestJsonSerializability(unittest.TestCase):
    def test_every_key_is_json_round_trippable_for_a_battery_of_inputs(self):
        cases = [
            (None, None), (0, 0), (-1, -1), (True, True), (False, False),
            (float("nan"), float("nan")), (float("inf"), float("-inf")),
            (1e300, 1e-300), (1e-300, 1e300), ("x", "y"), (500.0, 126_000_000_000_000),
        ]
        for a, b in cases:
            with self.subTest(a=a, b=b):
                result = bp.compute_block_progress(a, b)
                serialized = json.dumps(result)
                reparsed = json.loads(serialized)
                for key, value in reparsed.items():
                    if isinstance(value, float):
                        self.assertTrue(math.isfinite(value), f"{key}={value} not finite after round-trip")


if __name__ == "__main__":
    unittest.main()
