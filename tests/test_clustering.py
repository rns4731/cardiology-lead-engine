"""Group formation: size bounds, disjointness, determinism, and a golden lock on the
legacy build_groups output (the Streamlit app and run.py depend on it)."""
import pytest

from engine.clustering import (
    DEFAULT_MIN_SCORE,
    MAX_STARTER_SIZE,
    MIN_GROUP_SIZE,
    build_groups,
    cohort_viability,
    form_cohorts,
)


def test_cohort_sizes(cohorts):
    assert cohorts, "seed-42 universe should form at least one cohort"
    for c in cohorts:
        assert MIN_GROUP_SIZE <= len(c["members"]) <= MAX_STARTER_SIZE


def test_cohorts_are_disjoint(cohorts):
    members = [n for c in cohorts for n in c["members"]]
    assert len(members) == len(set(members))


def test_members_qualify_and_share_a_metro(scored, cohorts):
    by_npi = scored.set_index("npi")
    for c in cohorts:
        mem = by_npi.loc[c["members"]]
        assert (mem["metro"] == c["metro"]).all()
        assert (mem["propensity_score"] >= DEFAULT_MIN_SCORE).all()


def test_viability_recomputes(scored, cohorts):
    by_npi = scored.set_index("npi")
    for c in cohorts:
        mem = by_npi.loc[c["members"]]
        v = cohort_viability(mem["propensity_score"].tolist(), mem["subspecialty"].tolist(),
                             mem["timing_bucket"].tolist())
        assert v["score"] == pytest.approx(c["viability"], abs=0.051)


def test_ranked_by_viability(cohorts):
    v = [c["viability"] for c in cohorts]
    assert v == sorted(v, reverse=True)
    assert [c["overall_rank"] for c in cohorts] == list(range(1, len(cohorts) + 1))


def test_deterministic(scored, cohorts):
    assert form_cohorts(scored) == cohorts


def test_higher_floor_never_grows_qualified_pool(scored):
    sizes = [sum(len(c["members"]) for c in form_cohorts(scored, min_score=f))
             for f in (45, 55, 65)]
    assert sizes == sorted(sizes, reverse=True)


def test_diversity_bounds():
    one = cohort_viability([60] * 5, ["Interventional"] * 5, ["Now"] * 5)
    assert one["diversity"] == 0.0
    five = cohort_viability([60] * 5, ["Interventional", "Electrophysiology", "Imaging",
                                       "General/Noninvasive", "Advanced Heart Failure"],
                            ["Now (0-3 mo)"] * 5)
    assert five["diversity"] == pytest.approx(1.0)
    assert 0 <= five["score"] <= 100


def test_build_groups_golden(scored):
    """Locks the seed-42 legacy output; a change here changes the Streamlit demo."""
    summary, members = build_groups(scored)
    got = dict(zip(summary["metro"], summary["viability_score"]))
    assert got == {"Phoenix, AZ": 78.3, "Columbus, OH": 75.6, "Denver, CO": 55.1,
                   "Austin, TX": 50.2}
    assert all(len(m) <= MAX_STARTER_SIZE for m in members.values())
