"""Scoring invariants: arithmetic, explainability, and label independence."""
import numpy as np
import pytest

from engine.scoring import (
    REASON_FLOOR,
    TIMING_BUCKETS,
    WEIGHTS,
    contributions,
    score_frame,
    score_row,
    timing_parts,
)


def test_weights_sum_to_100():
    assert sum(WEIGHTS.values()) == 100


def test_scores_in_range(scored):
    assert scored["propensity_score"].between(0, 100).all()
    assert scored["timing_score"].between(0, 100).all()


def test_contributions_sum_to_score(scored):
    """Explainability contract: the breakdown shown on a page adds up to the score."""
    for _, r in scored.head(300).iterrows():
        assert sum(contributions(r).values()) == pytest.approx(r["propensity_score"], abs=0.11)


def test_contribution_never_exceeds_its_weight(scored):
    for _, r in scored.head(300).iterrows():
        for k, v in contributions(r).items():
            assert 0 <= v <= WEIGHTS[k] + 1e-9


def test_timing_bucket_matches_cutoffs(scored):
    for _, r in scored.head(400).iterrows():
        total = 0.0
        for v in timing_parts(r, rounded=False).values():
            total += v
        expected = next(name for cut, name in TIMING_BUCKETS if min(total, 100) >= cut)
        assert r["timing_bucket"] == expected


def test_scorer_never_reads_the_label(universe):
    """Flipping the hidden outcome must not change a single score -- if it did, the
    evaluation metrics would be leakage, not validation."""
    flipped = universe.copy()
    flipped["will_move_24mo"] = 1 - flipped["will_move_24mo"]
    a, b = score_frame(universe), score_frame(flipped)
    np.testing.assert_array_equal(a["propensity_score"].values, b["propensity_score"].values)
    np.testing.assert_array_equal(a["timing_bucket"].values, b["timing_bucket"].values)


def test_more_disruption_never_lowers_score(universe):
    row = universe.iloc[0].copy()
    row["disruption_signal"] = 0.0
    low = score_row(row)["propensity_score"]
    row["disruption_signal"] = 1.0
    assert score_row(row)["propensity_score"] >= low


def test_reasons_respect_floor(universe):
    """A reason appears exactly when its signal clears REASON_FLOOR of its weight."""
    row = universe[universe["disruption_event"] != "none"].iloc[0].copy()
    row["prior_independent"] = 0
    row["disruption_signal"] = REASON_FLOOR - 0.01
    below = score_row(row)["top_reasons"]
    row["disruption_signal"] = REASON_FLOOR + 0.01
    above = score_row(row)["top_reasons"]
    assert "Prior independent" not in below
    assert "Employer" not in below
    assert "Employer" in above
