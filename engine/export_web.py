"""Export scored universes as JSON bundles for the React app.

    .venv/bin/python -m engine.export_web                 # synthetic + public
    .venv/bin/python -m engine.export_web --source synthetic
    .venv/bin/python -m engine.export_web --offline       # no network: public is rebuilt
                                                          # from cached CMS pulls

Writes web/public/data/<source>/bundle.json and web/public/data/manifest.json.
The "public" source (Real data) is built by engine/real_data.py from cached CMS pulls:
real records only, signals labeled by provenance, nothing scored. If a source fails to
build, a previously exported bundle is kept and flagged stale rather than lost.

There is deliberately no mode that puts real names on simulated signals: a simulated
score next to a real physician reads as a fact about them.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from engine.clustering import (
    DEFAULT_MIN_SCORE,
    MAX_STARTER_SIZE,
    MIN_GROUP_SIZE,
    VIABILITY_WEIGHTS,
    form_cohorts,
    slugify,
)
from engine.evaluate import evaluate
from engine.generate_data import RNG_SEED, SUBSPECIALTIES, generate
from engine.insights import (
    MIN_N,
    candidate_groups,
    cohort_details,
    contribution_matrix,
    disclosure_control,
    lead_ranks,
    metro_rollups,
    related_leads,
    short_bucket,
    signal_stats,
    system_rollups,
    threshold_sweep,
    timing_matrix,
)
from engine.scoring import (
    REASON_FLOOR,
    TIMING_BUCKETS,
    TIMING_LABELS,
    TIMING_SOURCES,
    TIMING_WEIGHTS,
    WEIGHTS,
    score_frame,
)
from engine.signals import catalog

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "public", "data")
SCHEMA_VERSION = 3

SOURCES = {
    "synthetic": {
        "label": "Synthetic",
        "description": "A fully simulated universe of 1,200 hospital-employed cardiologists "
                       "with a hidden outcome simulated from the model's own hypotheses -- "
                       "it tests the pipeline, not the hypotheses.",
        "provenance": {"identity": "synthetic", "location": "synthetic",
                       "subspecialty": "synthetic", "employer": "synthetic (fictional systems)",
                       "signals": "simulated", "outcome": "simulated"},
    },
    "public": {
        "label": "Real data",
        "description": "Real cardiologists from public CMS Medicare records, hospital-based by billing setting "
                       "(inferred). The same ten signals, filled from real records where they exist and labeled "
                       "by provenance. Scores use weights from a back-test on an inferred outcome (Oct 2022 -> Oct "
                       "2024); they beat chance there but failed the cross-check, so they are leads to check.",
        "provenance": {},
    },
}

_SNAKE = re.compile(r"^[a-z][a-z0-9]*(_[a-z0-9]+)+$")
# dicts keyed by IDENTIFIERS (signal ids, timing/viability component ids), not field
# names: their keys must match ids used elsewhere (e.g. signal.key), so never rename
ID_KEYED = {"weights", "labels", "contributions", "timingParts", "components", "sources",
            "precision", "lift", "liftCi", "withheld"}


def camel(obj, _keep_keys: bool = False):
    """Recursively camelCase snake_case field names; identifier keys are untouched."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            nk = k if _keep_keys or not (isinstance(k, str) and _SNAKE.match(k)) else _to_camel(k)
            out[nk] = camel(v, _keep_keys=nk in ID_KEYED)
        return out
    if isinstance(obj, list):
        return [camel(v) for v in obj]
    return obj


def _to_camel(k: str) -> str:
    head, *rest = k.split("_")
    return head + "".join(p.title() for p in rest)


def _metrics(m: dict) -> dict:
    """Evaluate() output in bundle shape (snake keys; camel() renames them later)."""
    ks = sorted(int(k.split("@")[1]) for k in m if k.startswith("precision@"))
    return {
        "n": int(m["n"]), "coverage": float(m["coverage"]), "base_rate": float(m["base_rate"]),
        "auc": float(m["auc"]),
        "oracle_auc": float(m["oracle_auc"]) if "oracle_auc" in m else None,
        "precision": {str(k): float(m[f"precision@{k}"]) for k in ks},
        "lift": {str(k): float(m[f"lift@{k}"]) for k in ks},
        "lift_ci": {str(k): list(m[f"lift_ci@{k}"]) for k in ks},
    }


def _provenance(key: str) -> dict:
    """What actually produced this signal's values (never the plan)."""
    if key == "disruption":
        return {"provenance": "simulated",
                "source": "Simulated events, written up as fictional news articles and read back by the news pipeline "
                          "(Claude, quotes verified verbatim) -- the value comes from what the pipeline read. See News."}
    return {"provenance": "simulated",
            "source": "Simulated — drawn at random by the generator (engine/generate_data.py); not data about any physician"}


def news_event_out(e: dict) -> dict:
    """One extracted event in bundle shape (shared by real and fictional news)."""
    return {"article": e["article"], "entityId": e["entity_id"], "organization": e["organization_as_written"],
            "type": e["event_type"], "status": e["status"], "date": e["date"], "quote": e["evidence_quote"],
            "verified": e["verified"], "counted": e["counted"], "rejected": e["rejected"]}


def apply_fictional_news(df: pd.DataFrame, universe: str) -> tuple[pd.DataFrame, dict]:
    """Employer disruption as READ from fictional articles by the news pipeline, replacing the
    simulator's own event values (which stay hidden, like the outcome). Returns the frame and
    the bundle's news block."""
    from engine.news.fake import load_fake

    fake = load_fake()
    if fake is None or universe not in fake["universes"]:
        raise RuntimeError("no fictional-news extraction -- run: python -m engine.news.fake (needs the Claude API)")
    u = fake["universes"][universe]
    by = u["bySystem"]
    got = [by.get(f"{m}|{e}") for m, e in zip(df["metro"], df["employer"])]
    df = df.assign(
        disruption_event=[g["event"] if g else "none" for g in got],
        disruption_recency_months=[int(round(g["monthsAgo"])) if g else 999 for g in got],
        disruption_signal=[round(float(np.exp(-g["monthsAgo"] / 12.0)), 4) if g else 0.0 for g in got],
    )
    block = {
        "fictional": True, "asof": fake["asof"], "model": fake["model"], "accuracy": u["accuracy"],
        "articles": [{k: a[k] for k in ("id", "kind", "metro", "system", "title", "text", "published", "publisher")}
                     for a in u["articles"]],
        "events": [news_event_out(e) for e in u["events"]],
        "comparison": [{"metro": r["metro"], "system": r["system"], "truth": r["truth"],
                        "extracted": r["extracted"]} for r in u["comparison"]],
    }
    return df, block


def build_bundle(df: pd.DataFrame, source_id: str, extra: dict | None = None, news: dict | None = None) -> dict:
    scored = score_frame(df)  # sorted by propensity, index 0..n-1
    contrib = contribution_matrix(scored)
    cohorts = form_cohorts(scored)
    member_of = {n: c["id"] for c in cohorts for n in c["members"]}
    related = related_leads(scored, contrib)
    cands = candidate_groups(scored, cohorts)
    ranks = lead_ranks(scored)
    tparts = timing_matrix(scored)
    stats = signal_stats(scored, contrib)
    # outcome aggregates pass disclosure control before anything is published
    metrics, sweep = disclosure_control(_metrics(evaluate(scored)), threshold_sweep(scored),
                                        DEFAULT_MIN_SCORE)
    present = set(scored["subspecialty"])

    leads = []
    for i, r in scored.iterrows():
        npi = int(r["npi"])
        has_event = r["disruption_event"] != "none"
        leads.append({
            "npi": npi, "name": str(r["name"]),
            "metro": r["metro"], "metroSlug": slugify(r["metro"]),
            "employer": r["employer"], "systemSlug": slugify(r["employer"]),
            "subspecialty": r["subspecialty"],
            "propensity": float(r["propensity_score"]),
            "timingScore": float(r["timing_score"]),
            "timingBucket": short_bucket(r["timing_bucket"]),
            "rank": int(ranks.at[i, "rank_overall"]),
            "percentile": float(ranks.at[i, "percentile"]),
            "rankInMetro": int(ranks.at[i, "rank_in_metro"]),
            "age": int(r["age"]), "yearsInPractice": int(r["years_in_practice"]),
            "tenureYears": int(r["tenure_years_current_employer"]),
            "priorIndependent": bool(r["prior_independent"]),
            "peerLeft": bool(r["peer_recently_left"]),
            "wrvuPercentile": int(r["wrvu_percentile"]),
            "openPayments": float(r["open_payments_usd"]),
            "contractMonths": int(r["contract_renewal_months"]),
            "noncompeteMonths": int(r["noncompete_months"]),
            "disruptionEvent": r["disruption_event"] if has_event else None,
            "disruptionMonthsAgo": int(r["disruption_recency_months"]) if has_event else None,
            "independentGroupsMetro": int(r["independent_groups_metro"]),
            "contributions": {k: round(float(v), 2) for k, v in contrib.loc[i].items()},
            "timingParts": tparts[i],
            "reasons": [s for s in str(r["top_reasons"]).split(" | ")
                        if s and s != "No strong signals"],
            "group": member_of.get(npi),
            "candidateGroups": cands[npi],
            "related": related[npi],
        })

    signals = [{**s, **stats[s["key"]], **_provenance(s["key"])} for s in catalog()]
    src = SOURCES[source_id]
    bundle = {
        "schemaVersion": SCHEMA_VERSION,
        "source": {"id": source_id, "label": src["label"], "description": src["description"],
                   "provenance": src["provenance"], "count": len(leads),
                   "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   **(extra or {})},
        "meta": {
            "weights": WEIGHTS,
            "reasonFloor": REASON_FLOOR,
            "operatingFloor": DEFAULT_MIN_SCORE,
            "minN": MIN_N,
            "timing": {"weights": TIMING_WEIGHTS, "labels": TIMING_LABELS,
                       "sources": {k: {**v, "provenance": "simulated"} for k, v in TIMING_SOURCES.items()},
                       "buckets": [{"name": short_bucket(n), "range": n.split("(")[1].rstrip(")"),
                                    "min": c} for c, n in TIMING_BUCKETS]},
            "viability": {"weights": VIABILITY_WEIGHTS, "minGroup": MIN_GROUP_SIZE,
                          "maxSize": MAX_STARTER_SIZE},
            # only subspecialties present in this source -- absent ones aren't "0"
            "subspecialties": [{"name": k, "econ": v[1]} for k, v in SUBSPECIALTIES.items() if k in present],
            "subspecialtiesAbsent": [k for k in SUBSPECIALTIES if k not in present],
            "metrics": metrics,
        },
        "signals": signals,
        "metros": metro_rollups(scored, cohorts),
        "systems": system_rollups(scored, cohorts),
        "groups": cohort_details(scored, cohorts),
        "sweep": sweep,
        "leads": leads,
    }
    out = camel(bundle)
    if news is not None:
        out["news"] = news  # already in bundle shape; article text is fictional
    return out


def _write(source_id: str, bundle: dict) -> str:
    from engine.bundle_check import validate

    problems = validate(bundle)
    if problems:  # never ship an internally inconsistent bundle
        raise ValueError(f"bundle failed validation: {problems[:5]}")
    d = os.path.join(OUT, source_id)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, "bundle.json")
    with open(path, "w") as f:
        json.dump(bundle, f, separators=(",", ":"), allow_nan=False)  # NaN = bug
    return path


def _cached_entry(source_id: str) -> dict:
    """Manifest fields for a bundle already on disk. An old-schema bundle is NOT
    available -- the app would misread it."""
    path = os.path.join(OUT, source_id, "bundle.json")
    if not os.path.exists(path):
        return {"available": False}
    with open(path) as f:
        b = json.load(f)
    if b.get("schemaVersion") != SCHEMA_VERSION:
        return {"available": False,
                "error": f"cached bundle has schema {b.get('schemaVersion')}, app expects {SCHEMA_VERSION}"}
    src = b["source"]
    return {"available": True, "count": src["count"], "generatedAt": src["generatedAt"],
            **({"fetchedAt": src["fetchedAt"]} if "fetchedAt" in src else {}),
            "failedQueries": len(src.get("failedQueries", []))}


def export(sources: list[str], offline: bool = False) -> dict:
    manifest = []
    for sid in SOURCES:
        entry = {"id": sid, "label": SOURCES[sid]["label"],
                 "description": SOURCES[sid]["description"]}
        if sid not in sources:
            entry.update(_cached_entry(sid))
            manifest.append(entry)
            continue
        try:
            if sid == "synthetic":
                df, news = apply_fictional_news(generate(n=1200, seed=RNG_SEED), "synthetic")
                b = build_bundle(df, sid, {"seed": RNG_SEED}, news)
            else:
                from engine.real_data import build_public_bundle
                b = build_public_bundle(offline=offline)
            path = _write(sid, b)
            entry.update(available=True, count=b["source"]["count"],
                         generatedAt=b["source"]["generatedAt"],
                         failedQueries=len(b["source"].get("failedQueries", [])),
                         **({"fetchedAt": b["source"]["fetchedAt"]} if "fetchedAt" in b["source"] else {}))
            print(f"  {sid:<9} {b['source']['count']:>5} leads  "
                  f"{len(b.get('groups', [])):>3} groups  -> {os.path.relpath(path, ROOT)}")
        except Exception as e:  # keep a cached bundle rather than losing it
            cached = _cached_entry(sid)
            entry.update(cached, error=cached.get("error") or f"{type(e).__name__}: {e}",
                         **({"stale": True} if cached["available"] else {}))
            print(f"  {sid:<9} FAILED ({type(e).__name__}: {e})"
                  + ("; kept cached bundle" if cached["available"] else "; toggle will be disabled"))
        manifest.append(entry)

    out = {"schemaVersion": SCHEMA_VERSION, "default": "synthetic", "sources": manifest}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(out, f, indent=2)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Export web data bundles")
    ap.add_argument("--source", choices=[*SOURCES, "all"], default="all")
    ap.add_argument("--offline", action="store_true",
                    help="no network: rebuild public from cached CMS pulls")
    args = ap.parse_args()
    sources = list(SOURCES) if args.source == "all" else [args.source]
    print("exporting web bundles" + (" (offline: public rebuilt from cached CMS pulls)" if args.offline else "") + " ...")
    export(sources, offline=args.offline)


if __name__ == "__main__":
    main()
