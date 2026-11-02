"""News pipeline + real-signal rules: what keeps model output and inferred labels honest.

Offline: the Claude call is stubbed; bundles and caches are read from disk."""
from __future__ import annotations

import json
import os
from datetime import date

import pytest

from engine.news import extract as ex

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "web", "public", "data")

ARTICLE = {"id": "a1", "title": "Austin System A to be sold", "published": "2026-05-02", "publisher": "Test Wire",
           "text": "Austin System A has signed a definitive agreement to be acquired by an out-of-state operator. "
                   "Austin System B denied reports that it plans layoffs."}
ENTS = [{"id": "Austin System A", "name": "Austin System A"}, {"id": "Austin System B", "name": "Austin System B"}]


def _stub(events):
    return lambda *a, **k: {"relevant": True, "events": events}


def _ev(**kw):
    base = {"entity_id": "Austin System A", "organization_as_written": "Austin System A", "event_type": "acquisition",
            "status": "announced", "event_date": "2026-05", "date_basis": "stated_in_article",
            "evidence_quote": "has signed a definitive agreement to be acquired", "confidence": "high"}
    return {**base, **kw}


def test_quote_must_be_verbatim(monkeypatch):
    monkeypatch.setattr(ex, "call_json", _stub([_ev(), _ev(evidence_quote="agreed to sell itself to a buyer")]))
    good, bad = ex.extract(ARTICLE, ENTS, tag="t")
    assert good["verified"] and good["counted"]
    assert not bad["verified"] and not bad["counted"]
    assert "quote not found verbatim in the article" in bad["rejected"]


def test_denials_rumors_and_out_of_definition_types_never_count(monkeypatch):
    monkeypatch.setattr(ex, "call_json", _stub([
        _ev(entity_id="Austin System B", event_type="layoffs", status="denied",
            evidence_quote="denied reports that it plans layoffs"),
        _ev(event_type="leadership_change"),
        _ev(entity_id="other"),
    ]))
    evs = ex.extract(ARTICLE, ENTS, tag="t")
    assert not any(e["counted"] for e in evs)
    assert any("status is denied" in r for e in evs for r in e["rejected"])


def test_follow_up_coverage_does_not_make_an_event_newer():
    evs = [{"entity_id": "X", "event_type": "merger", "counted": True, "date": "2026-01-10", "article": "a",
            "evidence_quote": "q"},
           {"entity_id": "X", "event_type": "merger", "counted": True, "date": "2026-03-01", "article": "b",
            "evidence_quote": "q"}]
    best = ex.latest_counted(evs, date(2026, 10, 1))["X"]
    assert best["date"] == "2026-01-10" and best["reports"] == 2


def test_events_outside_the_window_are_ignored():
    evs = [{"entity_id": "X", "event_type": "merger", "counted": True, "date": "2021-01-10", "article": "a",
            "evidence_quote": "q"}]
    assert ex.latest_counted(evs, date(2026, 10, 1)) == {}


def test_group_names_tied_to_a_hospital_are_never_independent_style():
    from engine.real_signals import HOSPITAL_WORDS, _tokens

    assert HOSPITAL_WORDS.search("THE PRESBYTERIAN HOSPITAL")
    assert HOSPITAL_WORDS.search("HEALTHTEXAS PROVIDER NETWORK")
    assert _tokens("SETON FAMILY OF DOCTORS") & _tokens("ASCENSION SETON MEDICAL CENTER AUSTIN")
    assert _tokens("ST DAVIDS HEART AND VASCULAR PLLC") & _tokens("ST DAVID'S MEDICAL CENTER")
    assert not _tokens("CARDIOLOGY ASSOCIATES") & _tokens("HEART HOSPITAL")


def _bundle(source):
    path = os.path.join(DATA, source, "bundle.json")
    if not os.path.exists(path):
        pytest.skip(f"{source} bundle not exported")
    with open(path) as f:
        return json.load(f)


def test_fictional_articles_name_no_real_organization():
    from engine.news.fake import REAL_NAMES, _clean, load_fake

    fake = load_fake()
    if fake is None:
        pytest.skip("fictional news not generated")
    for u in fake["universes"].values():
        for a in u["articles"]:
            assert a["fictional"] is True
            assert not _clean(a["title"] + " " + a["text"]), (a["id"], _clean(a["title"] + " " + a["text"]))
            assert a["system"].lower() in (a["title"] + a["text"]).lower()
    assert "Vanderbilt" in REAL_NAMES


def test_simulated_disruption_comes_from_what_the_pipeline_read():
    b = _bundle("synthetic")
    got = {(r["metro"], r["system"]): r["extracted"] for r in b["news"]["comparison"]}
    for l in b["leads"]:
        e = got[(l["metro"], l["employer"])]
        assert (l["disruptionEvent"] is None) == (e is None)
        if e:
            assert l["disruptionEvent"] == e["event"]


def test_real_bundle_ships_no_article_text_and_backs_every_value():
    from engine.bundle_check import validate

    b = _bundle("public")
    assert validate(b) == []
    for a in (b.get("news") or {}).get("articles", []):
        assert "text" not in a and "html" not in a
    cw = next(s for s in b["signals"] if s["key"] == "contract_window")
    assert cw["status"] == "none" and cw["coverage"] == 0
    for l in b["leads"]:
        for k, v in l["values"].items():
            if v is not None:
                assert l["facts"].get(k), (l["npi"], k)


def test_no_api_key_in_any_published_or_cached_file():
    roots = [DATA, os.path.join(ROOT, "data", "cache")]
    for r in roots:
        for dirpath, _, files in os.walk(r):
            for fn in files:
                p = os.path.join(dirpath, fn)
                if fn.endswith((".json", ".gz")):
                    import gzip

                    with (gzip.open(p, "rb") if fn.endswith(".gz") else open(p, "rb")) as f:
                        assert b"sk-ant-" not in f.read(), p


def test_a_year_in_the_quote_dates_the_event(monkeypatch):
    art = {**ARTICLE, "text": ARTICLE["text"] + " Austin System A was acquired by its parent in 2019, officials noted."}
    monkeypatch.setattr(ex, "call_json", _stub([_ev(event_date="2026-05-02", date_basis="publication_date",
                                                     evidence_quote="was acquired by its parent in 2019",
                                                     background=True, temporary=False)]))
    (e,) = ex.extract(art, ENTS, tag="t")
    assert e["date"] == "2019-07-01"
    assert ex.latest_counted([e], date(2026, 10, 1)) == {}  # outside the 36-month window


def test_temporary_closures_never_count(monkeypatch):
    monkeypatch.setattr(ex, "call_json", _stub([_ev(event_type="closure", status="reported", temporary=True)]))
    (e,) = ex.extract(ARTICLE, ENTS, tag="t")
    assert not e["counted"] and "temporary disruption" in e["rejected"]


def test_backtest_score_is_never_imputed_and_parts_sum():
    from engine.backtest import points, score

    w, s = points(__import__("numpy").array([1.0, -0.5, 0.25]))
    assert sum(w) == 100 and s == [1, -1, 1]
    total, parts = score({"a": 0.5, "b": 0.2, "c": 1.0}, ["a", "b", "c"], w, s)
    assert abs(total - sum(parts.values())) < 0.11
    assert score({"a": 0.5, "b": None, "c": 1.0}, ["a", "b", "c"], w, s) == (None, {})


def test_scores_appear_only_behind_a_passing_backtest():
    from engine.backtest import load_backtest

    bt = load_backtest()
    b = _bundle("public")
    if bt is None:
        assert not any(l.get("score") is not None for l in b["leads"])
        return
    assert bt["verdict"]["passed"] == (bt["metrics"]["aucCi"][0] > 0.5)
    assert b["prediction"]["available"] == bt["verdict"]["passed"]
    assert sum(bt["weights"].values()) == 100 and "contract_window" not in bt["weights"]
    assert bt["t0"] < bt["t1"]
