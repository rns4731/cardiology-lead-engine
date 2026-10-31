"""Regression tests from the 2026-10-29 adversarial review (.claude/reviews/).

Each test reproduces a confirmed finding and failed before its fix. Imports live inside
the tests so each one fails on its own.
"""
import json
import re

import numpy as np
import pandas as pd
import pytest


# ---- D1 (S1): no individual outcome recoverable from published aggregates ----------
def _prefix_cells(b):
    """(set size, movers) for every published outcome aggregate over a top-n set."""
    m, out = b["meta"]["metrics"], []
    for k, p in m["precision"].items():
        if p is not None:
            out.append((int(k), round(p * int(k))))
    for r in b["sweep"]:
        if r["precision"] is not None:
            out.append((r["qualified"], round(r["precision"] * r["qualified"])))
    return out


def test_d1_outcome_cells_are_large_and_well_spaced(bundle42):
    from engine.insights import MIN_N

    sizes = sorted({n for n, _ in _prefix_cells(bundle42)})
    assert sizes and all(n >= MIN_N for n in sizes)
    # top-n sets are nested prefixes of one ranking: two sizes closer than MIN_N would
    # reveal the outcome of the few leads between them by subtraction
    assert all(b - a >= MIN_N for a, b in zip(sizes, sizes[1:])), sizes
    n = bundle42["meta"]["metrics"]["n"]
    for s in bundle42["signals"]:
        if s["moveRateActive"] is not None:
            assert s["activeCount"] >= MIN_N
        if s["moveRateInactive"] is not None:
            assert n - s["activeCount"] >= MIN_N


def test_d1_red_team_cells_are_withheld(bundle42):
    sweep = {r["floor"]: r for r in bundle42["sweep"]}
    for f in (60, 65, 70):  # 24, 4 and 1 leads: the cells the attack used
        assert sweep[f]["precision"] is None and sweep[f]["recall"] is None


# ---- C1: displayed readiness agrees with its bucket ---------------------------------
def test_c1_timing_score_agrees_with_bucket(bundle42):
    buckets = bundle42["meta"]["timing"]["buckets"]
    for l in bundle42["leads"]:
        assert next(b["name"] for b in buckets if l["timingScore"] >= b["min"]) == l["timingBucket"], l["npi"]


# ---- C2: a real physician's simulated profile doesn't depend on list position -------
def test_c2_identity_overlay_is_order_independent():
    from engine.generate_data import METROS, generate_from_identities

    ids = pd.DataFrame([{"npi": 1_500_000_000 + i, "name": f"Dr. T {i}", "metro": m,
                         "subspecialty": "Interventional"} for i, m in enumerate(list(METROS) * 15)])
    a = generate_from_identities(ids, seed=1).set_index("npi")
    b = generate_from_identities(ids.iloc[1:].sample(frac=1, random_state=3).reset_index(drop=True),
                                 seed=1).set_index("npi")
    cols = ["employer", "wrvu_percentile", "prior_independent", "disruption_event", "will_move_24mo"]
    pd.testing.assert_frame_equal(a.loc[b.index, cols].sort_index(), b[cols].sort_index())


# ---- C3: headline metrics don't depend on input row order ---------------------------
def test_c3_metrics_order_independent(universe):
    from engine.evaluate import evaluate
    from engine.scoring import score_frame

    assert evaluate(score_frame(universe)) == evaluate(score_frame(universe.iloc[::-1].reset_index(drop=True)))


# ---- C4: candidate status distinguishes bench from other cohorts' members -----------
def test_c4_candidate_status_and_mode(scored, cohorts):
    from engine.clustering import MAX_STARTER_SIZE
    from engine.insights import candidate_groups

    member_of = {n: c["id"] for c in cohorts for n in c["members"]}
    size = {c["id"]: len(c["members"]) for c in cohorts}
    seen_elsewhere = False
    for npi, rows in candidate_groups(scored, cohorts).items():
        for r in rows:
            if r["status"] == "eligible":
                assert npi not in member_of
            if r["status"] == "member_elsewhere":
                seen_elsewhere = True
                assert member_of.get(npi) not in (None, r["group"])
            if r["status"] in ("eligible", "member_elsewhere"):
                assert r["mode"] == ("swap" if size[r["group"]] >= MAX_STARTER_SIZE else "join")
    assert seen_elsewhere  # Columbus has four cohorts


# ---- C5: exact edge values land in the right bin ------------------------------------
def test_c5_bin_edges():
    from engine.insights import bin_counts

    assert bin_counts(np.array([0.0, 0.3, 0.6, 0.7, 1.0]), 10).tolist() == [1, 0, 0, 1, 0, 0, 1, 1, 0, 1]


# ---- C6: the reasons shown are the largest contributions ----------------------------
def test_c6_top_reasons_are_largest(scored):
    from engine.scoring import reason_items

    row = scored[scored["npi"] == 1000001108].iloc[0]
    assert "peer" in row["top_reasons"].lower()
    for _, r in scored.head(300).iterrows():
        pts = [p for p, _ in reason_items(r)]
        assert pts == sorted(pts, reverse=True)


# ---- C7: an undefined share is null, not 0% -----------------------------------------
def test_c7_ready_share_null_when_nobody_qualifies(scored, cohorts):
    from engine.insights import metro_rollups

    assert all(m["ready_share"] is None for m in metro_rollups(scored, [], min_score=101))


# ---- C8: one member is not a shared trigger -----------------------------------------
def test_c8_shared_trigger_needs_two():
    from engine.clustering import form_cohorts
    from engine.generate_data import generate
    from engine.scoring import score_frame

    for c in form_cohorts(score_frame(generate(n=1200, seed=3))):
        assert c["shared_trigger"] is None or c["shared_trigger"]["members"] >= 2


# ---- C9: cohort ids stay unique past 26 per metro -----------------------------------
def test_c9_cohort_ids_unique():
    from engine.clustering import form_cohorts
    from engine.generate_data import generate
    from engine.scoring import score_frame

    ids = [c["id"] for c in form_cohorts(score_frame(generate(n=3000, seed=42)), min_score=40)]
    assert len(ids) == len(set(ids))
    assert all(re.fullmatch(r"[a-z0-9-]+", i) for i in ids)


# ---- C10: a constant column can't manufacture similarity ----------------------------
def test_c10_constant_columns(scored):
    from engine.insights import contribution_matrix, related_leads

    one_sub = scored[scored["subspecialty"] == scored["subspecialty"].mode()[0]]
    r = related_leads(one_sub, contribution_matrix(one_sub))
    assert not any("Subspecialty economics" in i["why"] for v in r.values() for i in v["similar"])


# ---- D2: a partial live fetch never replaces the complete cache ---------------------
def test_d2_partial_fetch_keeps_cache(tmp_path, monkeypatch):
    import engine.export_web as ew
    import engine.nppes_nlm as nl

    full = pd.DataFrame([{"npi": 1, "name": "Dr. A One", "metro": "Austin, TX", "subspecialty": "Interventional"},
                         {"npi": 2, "name": "Dr. B Two", "metro": "Denver, CO", "subspecialty": "Electrophysiology"}])
    cache = tmp_path / "ids.json"
    cache.write_text(json.dumps({"fetchedAt": "2026-01-01T00:00:00+00:00", "failedQueries": [],
                                 "rows": full.to_dict("records")}))
    monkeypatch.setattr(ew, "IDENTITY_CACHE", str(cache))
    partial = full.iloc[:1].copy()
    partial.attrs["failed_queries"] = ["Denver, CO / Cardiovascular @ offset 0: TimeoutError"]
    monkeypatch.setattr(nl, "fetch_identities", lambda **kw: partial)
    ids, prov = ew._real_identities(offline=False)
    assert len(ids) == 2 and prov["fromCache"] is True
    assert prov["liveFailedQueries"]
    assert json.loads(cache.read_text())["rows"] == full.to_dict("records")


# ---- D3 / D4: no invented clinical claims, no collisions with real hospitals --------
def test_d3_no_noninvasive_label():
    from engine.generate_data import SUBSPECIALTIES
    from engine.nppes_nlm import PROBES

    assert not any("Noninvasive" in s for s in SUBSPECIALTIES)
    assert ("Cardiovascular", "Cardiovascular Disease", "General cardiology") in PROBES


def test_d4_system_names_unmistakably_fictional():
    from engine.generate_data import METROS

    for metro, systems in METROS.items():
        for s in systems:
            assert re.fullmatch(rf"{metro.split(',')[0]} System [A-Z]", s), s


# ---- D8: registry names with suffixes -----------------------------------------------
@pytest.mark.parametrize("raw,want", [
    ("TUCKER, PAUL, III", "Dr. Paul Tucker III"),
    ("MAZZAFERRI, ERNEST, JR", "Dr. Ernest Mazzaferri Jr."),
    ("SMITH, JOHN A", "Dr. John Smith"),
    ("O'NEIL, MARY", "Dr. Mary O'Neil"),
])
def test_d8_parse_name(raw, want):
    from engine.nppes_nlm import _parse_name

    assert _parse_name(raw) == want


# ---- D9: a cached bundle from an older schema is not "available" --------------------
def test_d9_old_schema_cache_unavailable(tmp_path, monkeypatch):
    import engine.export_web as ew

    monkeypatch.setattr(ew, "OUT", str(tmp_path))
    (tmp_path / "real").mkdir()
    (tmp_path / "real" / "bundle.json").write_text(json.dumps(
        {"schemaVersion": 1, "source": {"count": 5, "generatedAt": "x"}}))
    entry = ew._cached_entry("real")
    assert entry["available"] is False and "schema" in entry["error"]


# ---- D10: the CLI never writes a simulated outcome next to real identities ----------
def test_d10_real_csv_has_no_label(tmp_path, scored):
    import run

    run.write_outputs(scored, out_dir=str(tmp_path), real=True)
    assert "will_move_24mo" not in pd.read_csv(tmp_path / "leads_scored.csv").columns


# ---- M1 / M5 / M6 / M3: the honest context the copy now relies on -------------------
def test_m1_oracle_ceiling_reported_and_never_per_lead(bundle42):
    m = bundle42["meta"]["metrics"]
    assert m["auc"] <= m["oracleAuc"] <= 1
    assert "latent" not in json.dumps(bundle42["leads"]).lower()


def test_m5_signal_auc_has_ci(bundle42):
    for s in bundle42["signals"]:
        lo, hi = s["aucCi"]
        assert lo < s["auc"] < hi


def test_m6_lift_has_ci(bundle42):
    lo, hi = bundle42["meta"]["metrics"]["liftCi"]["25"]
    assert lo < bundle42["meta"]["metrics"]["lift"]["25"] < hi


def test_m3_timing_inputs_carry_provenance(bundle42):
    src = bundle42["meta"]["timing"]["sources"]
    assert src["contract_window"]["public"] is False and src["noncompete"]["public"] is False
    assert src["trigger_recency"]["public"] is True


# ---- found during the re-attack: contribution_matrix crashed on an empty frame -------
def test_reattack_contribution_matrix_empty(scored):
    from engine.insights import contribution_matrix
    from engine.scoring import WEIGHTS

    m = contribution_matrix(scored.iloc[0:0])
    assert m.shape == (0, len(WEIGHTS)) and list(m.columns) == list(WEIGHTS)


# ---- M1 follow-up: the source description shown under the dashboard title ----------
def test_m1_source_descriptions_do_not_claim_validation():
    from engine.export_web import SOURCES

    for src in SOURCES.values():
        assert "validate the model" not in src["description"]
