import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.clustering import form_cohorts  # noqa: E402
from engine.generate_data import generate  # noqa: E402
from engine.scoring import score_frame  # noqa: E402


@pytest.fixture(scope="session")
def universe():
    """The canonical seed-42 synthetic universe (unscored)."""
    return generate(n=1200, seed=42)


@pytest.fixture(scope="session")
def scored(universe):
    return score_frame(universe)


@pytest.fixture(scope="session")
def cohorts(scored):
    return form_cohorts(scored)


@pytest.fixture(scope="session")
def small_bundle():
    """An in-memory bundle from a small universe -- fast contract checks."""
    from engine.export_web import build_bundle

    return build_bundle(generate(n=400, seed=7), "synthetic", {"seed": 7})


@pytest.fixture(scope="session")
def bundle42():
    """The full seed-42 synthetic bundle, built in memory (what the app serves)."""
    from engine.export_web import build_bundle

    return build_bundle(generate(n=1200, seed=42), "synthetic", {"seed": 42})
