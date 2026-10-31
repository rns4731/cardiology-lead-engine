"""Metric correctness on hand-checkable inputs."""
import numpy as np
import pandas as pd
import pytest

from engine.evaluate import _auc, evaluate, precision_at_k


def test_auc_extremes():
    y = np.array([0, 0, 1, 1])
    assert _auc(y, np.array([1, 2, 3, 4])) == 1.0
    assert _auc(y, np.array([4, 3, 2, 1])) == 0.0
    assert _auc(y, np.array([1, 1, 1, 1])) == 0.5


def test_auc_single_class_is_nan():
    assert np.isnan(_auc(np.array([1, 1]), np.array([0.2, 0.9])))


def test_precision_at_k():
    df = pd.DataFrame({"npi": [1, 2, 3, 4], "propensity_score": [90, 80, 70, 60],
                       "will_move_24mo": [1, 0, 1, 0]})
    assert precision_at_k(df, 1) == 1.0
    assert precision_at_k(df, 2) == 0.5
    assert precision_at_k(df, 4) == 0.5


def test_seed42_metrics_locked(scored):
    """Headline numbers quoted in the docs and the app. Update the docs if this moves."""
    m = evaluate(scored)
    assert m["base_rate"] == pytest.approx(0.1967, abs=1e-3)
    assert m["auc"] == pytest.approx(0.621, abs=1e-3)
    assert m["precision@25"] == pytest.approx(0.44)
    assert m["lift@25"] == pytest.approx(2.24)
