"""Derived views: related cardiologists, candidate-group fit, signal stats, sweep."""
from engine.clustering import DEFAULT_MIN_SCORE
from engine.insights import (
    candidate_groups,
    contribution_matrix,
    metro_rollups,
    related_leads,
    signal_stats,
    threshold_sweep,
)
from engine.scoring import WEIGHTS


def test_related_rules(scored):
    rel = related_leads(scored, contribution_matrix(scored))
    by_npi = scored.set_index("npi")
    for npi, r in list(rel.items())[:200]:
        me = by_npi.loc[npi]
        for kind, items in r.items():
            for it in items:
                other = by_npi.loc[it["npi"]]
                assert it["npi"] != npi
                assert other["metro"] == me["metro"]
                if kind == "colleagues":
                    assert other["employer"] == me["employer"]
        comp_subs = [by_npi.loc[i["npi"], "subspecialty"] for i in r["complements"]]
        assert me["subspecialty"] not in comp_subs
        assert len(comp_subs) == len(set(comp_subs))


def test_candidate_status(scored, cohorts):
    cands = candidate_groups(scored, cohorts)
    members = {n: c["id"] for c in cohorts for n in c["members"]}
    by_npi = scored.set_index("npi")
    for npi, rows in cands.items():
        for row in rows:
            if row["status"] == "member":
                assert members.get(npi) == row["group"]
            elif row["status"] == "below_floor":
                assert by_npi.loc[npi, "propensity_score"] < DEFAULT_MIN_SCORE
            else:
                assert by_npi.loc[npi, "propensity_score"] >= DEFAULT_MIN_SCORE


def test_signal_stats_shape(scored):
    stats = signal_stats(scored, contribution_matrix(scored))
    assert set(stats) == set(WEIGHTS)
    for s in stats.values():
        assert sum(h["count"] for h in s["hist"]) == len(scored)
        assert 0 <= s["auc"] <= 1
        assert 0 <= s["active_share"] <= 1


def test_sweep_monotone(scored):
    sweep = threshold_sweep(scored)
    q = [r["qualified"] for r in sweep]
    rec = [r["recall"] for r in sweep if r["recall"] is not None]  # small cells withheld
    assert q == sorted(q, reverse=True)
    assert rec == sorted(rec, reverse=True) and len(rec) >= 3


def test_metro_rollups_account_for_everyone(scored, cohorts):
    ms = metro_rollups(scored, cohorts)
    assert sum(m["total"] for m in ms) == len(scored)
    for m in ms:
        assert m["grouped"] + m["bench"] == m["qualified"]
