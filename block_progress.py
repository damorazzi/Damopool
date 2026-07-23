#!/usr/bin/env python3
"""Phase E Milestone 30: Block Progress Analytics.

An educational feature giving context for how a solo miner's best solved
share compares to the current Bitcoin network difficulty -- "how close"
in a purely descriptive sense. This deliberately does NOT predict future
block finds or estimate probability of finding one; it is a ratio of two
already-known numbers, nothing more.

Unlike histogram_builder.py/ckpool_native_stats.py, this needs no new
data source and no incremental state of its own: best_share_difficulty
comes from best_share_ever (already computed by pool_statistics.py/
user_statistics.py/worker_statistics.py, already merged into
analytics.json by analytics_state.py), and network_difficulty comes from
ckpool_native_stats.read_network_difficulty (Milestone 29). This module
is therefore a single small, pure, stateless computation -- no file I/O,
no incremental byte-offset tracking -- kept as its own module anyway for
the same reason/precedent as histogram_builder.py and
ckpool_native_stats.py: a dedicated module per capability, cleanly
separated from analytics_state.py's own incremental engine, which stays
completely untouched.
"""

import math


def _is_positive_finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def compute_block_progress(best_share_difficulty, network_difficulty):
    """best_share_difficulty is the sdiff of a scope's own best_share_ever
    (None if that scope has never solved a valid-sdiff accepted share).
    network_difficulty is the pool-wide value from
    ckpool_native_stats.read_network_difficulty (None until CKPool has
    ever logged one). Both are passed straight through into the output
    unchanged -- this function only derives progress_percent/
    still_needed_multiplier, never re-estimates either input.

    progress_percent/still_needed_multiplier are null whenever either
    input is missing, non-numeric, non-finite, or not strictly positive
    -- this never divides by zero and never produces NaN/Infinity (a
    strict/browser JSON.parse rejects both non-standard tokens outright,
    the same concern already guarded against in ckpool_native_stats.py
    and histogram_builder.py)."""
    progress_percent = None
    still_needed_multiplier = None

    if _is_positive_finite_number(best_share_difficulty) and _is_positive_finite_number(network_difficulty):
        percent = (best_share_difficulty / network_difficulty) * 100
        multiplier = network_difficulty / best_share_difficulty
        # Deliberately independent guards, not a paired all-or-nothing
        # check (raised in Code Review, resolved by the Human: keep
        # progress_percent independent of still_needed_multiplier). The
        # two ratios can have different overflow/underflow behavior at
        # extreme input magnitudes (e.g. one legitimately underflows
        # toward 0.0 -- still a real, finite, meaningful value -- while
        # its reciprocal overflows past a double's range) -- that's two
        # independent floating-point range limits, not a logical
        # contradiction, so a real, computable value on one side is
        # never discarded just because its sibling's computation
        # happened to exceed range. Each is only ever null because ITS
        # OWN division was non-finite, never because the other one was.
        if math.isfinite(percent):
            progress_percent = percent
        if math.isfinite(multiplier):
            still_needed_multiplier = multiplier

    return {
        "best_share_difficulty": best_share_difficulty if _is_positive_finite_number(best_share_difficulty) else None,
        "network_difficulty": network_difficulty if _is_positive_finite_number(network_difficulty) else None,
        "progress_percent": progress_percent,
        "still_needed_multiplier": still_needed_multiplier,
    }
