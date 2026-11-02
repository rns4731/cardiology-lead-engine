"""The "Real data" source: real public records only. Nothing simulated; no score.

The same ten signals as the synthetic universe (engine/signals.py), each filled from a real
record where one exists, with an honest label per signal (engine/real_signals.py):
real, stand-in, inferred, assumption -- or empty when there is no real source (contract
window). Sources: CMS Medicare utilization (2024), CMS Doctors & Clinicians snapshots
2019-2026 (billing groups, graduation year, hospital affiliations), CMS Open Payments
(2025), CMS work RVUs (CY2024), CMS hospital ownership changes, and news articles read by
Claude with every quote verified verbatim (engine/news/).

Who is listed: cardiologists billing Medicare in 2024 whose billing city is one of the
eight cities and who billed at most 20% of services in office settings -- "hospital-based"
is INFERRED from billing setting, not from employment records.

There are still no weights with a real basis and no real outcome (who actually left), so
score, ranking, timing windows and candidate groups stay blank rather than estimated.
"""
from __future__ import annotations

import string
from collections import defaultdict
from datetime import date, datetime, timezone

import pandas as pd

from engine.clustering import slugify
from engine.generate_data import METRO_COORDS, METROS
from engine.public_fetch import load
from engine.scoring import FACTOR_LABELS
from engine.signals import SIGNALS as CATALOG
from engine.signals import catalog

KIND = "real-data"
YEAR = 2024                  # latest published Medicare year in the cache
HOSPITAL_BASED = 0.2         # inferred hospital-based: <= 20% of services billed in office settings
TYPE_MAP = {
    "Cardiology": "General cardiology",
    "Interventional Cardiology": "Interventional",
    "Clinical Cardiac Electrophysiology": "Electrophysiology",
    "Advanced Heart Failure and Transplant Cardiology": "Advanced Heart Failure",
}

# Why each signal is empty here: what it needs, and what (if anything) was tried.
MISSING = {
    "disruption": "Needs news or filings about the physician's employer (M&A, financial distress, layoffs). "
                  "No news or M&A source is connected, and the employer itself is unknown: CMS hospital-affiliation "
                  "data refused this client (403).",
    "career_stage": "Needs years in practice (training-completion or board-certification year). CMS Doctors & "
                    "Clinicians, which lists graduation year, refused this client (403); no other source is connected.",
    "prior_independent": "Needs the physician's past practice affiliations. CMS Doctors & Clinicians archives refused "
                         "this client (403) and PECOS history was not attempted.",
    "subspecialty_econ": "The subspecialty is real (Medicare provider type), but this signal turns it into an economics "
                         "score with a fixed lookup (Interventional 1.00 … Advanced heart failure 0.35). That lookup is "
                         "an assumption, not data, so the signal is left empty.",
    "productivity": "Needs work RVUs. Medicare allowed amounts are published but are Medicare-only and are not wRVUs; "
                    "using them as a stand-in was declined.",
    "peer_left": "Needs to know which colleagues left to go independent (affiliation history). Only Medicare "
                 "billing addresses are available, and an address change doesn't show who went independent; that "
                 "stand-in was declined.",
    "independent_density": "Needs a count of independent cardiology groups in the metro. CMS Doctors & Clinicians "
                           "group data refused this client (403). Office-setting billing sites don't prove "
                           "independence, so they weren't used.",
    "recent_employer_change": "Needs employment or reassignment history (PECOS, not attempted). A Medicare "
                              "billing-address change isn't an employer change; that stand-in was declined.",
    "contract_window": "Needs employment-contract renewal dates, which aren't public.",
    "industry_engagement": "Needs CMS Open Payments. Its query API refused this client (403).",
}
assert set(MISSING) == set(CATALOG), "every signal needs an explanation"

PREDICTION = ("Signals are filled from real records where they exist (each labeled real, stand-in, inferred or "
              "assumption), but no weights have a real basis and there is no real outcome data (who actually left hospital "
              "employment) to fit or check them against. So score, ranking, timing windows and candidate groups are left "
              "blank rather than estimated.")


PREDICTION_BT = ("Scores use weights fitted in a back-test: signals as of October 2022 against who moved to an "
                 "independent-style group by October 2024 (an inferred outcome). On held-out doctors the score beat "
                 "chance, but it did not predict the billing-switch cross-check, and several fitted directions are the "
                 "opposite of the original hypotheses. Treat the ranking as a lead list to check, not a forecast. "
                 "Timing windows and candidate groups stay blank (contract dates aren't public; no cohort floor has a "
                 "real basis).")
PREDICTION_FAILED = ("A back-test was run (signals as of October 2022 against moves by October 2024) and the fitted score "
                     "did not beat chance on held-out doctors, so no scores are shown.")


def _office_share(svc_rows: list[dict]) -> pd.Series:
    """Share of each NPI's published Medicare services billed with place of service = office."""
    df = pd.DataFrame(svc_rows)
    srv = pd.to_numeric(df["Tot_Srvcs"], errors="coerce").fillna(0.0)
    office = srv.where(df["Place_Of_Srvc"] == "O", 0.0)
    g = pd.DataFrame({"npi": df["Rndrng_NPI"], "srv": srv, "office": office}).groupby("npi").sum()
    g = g[g["srv"] > 0]
    return (g["office"] / g["srv"]).rename("office_share")


def _city_metro() -> dict[tuple[str, str], str]:
    out = {}
    for m in METROS:
        city, state = [p.strip() for p in m.rsplit(",", 1)]
        out[(city.upper(), state)] = m
    return out


def _name(first, last) -> str:
    return " ".join(str(p).strip().title() for p in (first, last) if p and str(p).strip())


def _address(r) -> str:
    # capwords, not title(): "38TH ST" -> "38th St", not "38Th St"
    return f"{string.capwords(str(r['Rndrng_Prvdr_St1']).strip())}, {string.capwords(str(r['Rndrng_Prvdr_City']).strip())}, " \
           f"{r['Rndrng_Prvdr_State_Abrvtn']} {str(r['Rndrng_Prvdr_Zip5'])[:5]}"


def _addr_key(r) -> str:
    return "".join(ch for ch in str(r["Rndrng_Prvdr_St1"]).upper() if ch.isalnum()) + "|" + str(r["Rndrng_Prvdr_Zip5"])[:5]


def _universe(raw: dict) -> tuple[pd.DataFrame, pd.Series]:
    """Inferred hospital-based cardiologists in the eight cities, plus all billing per city."""
    prv = pd.DataFrame(raw["prv"][str(YEAR)]).drop_duplicates("Rndrng_NPI").set_index("Rndrng_NPI")
    df = prv.join(_office_share(raw["svc"][str(YEAR)]), how="inner")
    metro_of = _city_metro()
    df["metro"] = [metro_of.get((str(c).upper().strip(), s)) for c, s in
                   zip(df["Rndrng_Prvdr_City"], df["Rndrng_Prvdr_State_Abrvtn"])]
    in_cities = df[df["metro"].notna()].copy()
    hb = in_cities[in_cities["office_share"] <= HOSPITAL_BASED].copy()
    hb["subspecialty"] = hb["Rndrng_Prvdr_Type"].map(TYPE_MAP)
    hb["name"] = [_name(f, l) for f, l in zip(hb["Rndrng_Prvdr_First_Name"], hb["Rndrng_Prvdr_Last_Org_Name"])]
    hb["addr_key"] = [_addr_key(r) for _, r in hb.iterrows()]
    hb = hb.reset_index().rename(columns={"Rndrng_NPI": "npi"})
    hb["npi"] = hb["npi"].astype(int)
    hb = hb.sort_values(["metro", "Rndrng_Prvdr_Last_Org_Name", "Rndrng_Prvdr_First_Name", "npi"], kind="stable")
    return hb, in_cities.groupby("metro").size()


def universe_npis() -> set[int]:
    hb, _ = _universe(load(offline=True))
    return set(hb["npi"])


def _optional(loader):
    try:
        return loader()
    except RuntimeError:
        return None


def build_public_bundle(offline: bool = True) -> dict:
    from engine.cms_directory import load_directory
    from engine.export_web import SCHEMA_VERSION, news_event_out
    from engine.insights import bin_counts
    from engine.news.real_news import load_real_news
    from engine.open_payments import load_payments
    from engine.real_signals import STATUS, Directory, compute, office_share, work_rvus
    from engine.wrvu import load_work_rvu

    raw = load(offline=offline)
    hb, billing = _universe(raw)

    directory_raw = _optional(load_directory)
    shares = {int(y): office_share(raw["svc"][y]) for y in raw["svc"]}
    directory = Directory(directory_raw, shares) if directory_raw else None
    work = _optional(lambda: load_work_rvu())
    wrvu = work_rvus(raw["svc"][str(YEAR)], work["work"]) if work else None
    payments = _optional(load_payments)
    news = load_real_news()
    asof = date.fromisoformat(news["asof"]) if news else (
        date.fromisoformat(directory.latest) if directory else date.today())
    city = {int(n): (str(c).upper().strip(), st) for n, c, st in
            zip(hb["npi"], hb["Rndrng_Prvdr_City"], hb["Rndrng_Prvdr_State_Abrvtn"])}
    values, facts = compute([int(n) for n in hb["npi"]], subspecialty=dict(zip(hb["npi"], hb["subspecialty"])), city=city,
                            directory=directory, wrvu=wrvu, payments=payments, news=news,
                            chow=raw.get("chow", []), asof=asof)

    at_addr = defaultdict(list)
    for n, a in zip(hb["npi"], hb["addr_key"]):
        at_addr[a].append(int(n))

    # back-test weights, applied only when the back-test beat chance (engine/backtest.py)
    from engine.backtest import load_backtest, score

    bt = load_backtest()
    scored = {}
    if bt and bt["verdict"]["passed"]:
        feats = bt["features"]
        w = [bt["weights"][f] for f in feats]
        sg = [bt["signs"][f] for f in feats]
        # employer disruption enters the score as the back-test measured it: CMS records only
        cms_vals, _ = compute([int(n) for n in hb["npi"]], subspecialty=dict(zip(hb["npi"], hb["subspecialty"])),
                              city=city, directory=directory, wrvu=wrvu, payments=payments, news=None,
                              chow=raw.get("chow", []), asof=asof, cms_only=True)
        for n in hb["npi"]:
            scored[int(n)] = score(cms_vals[int(n)], feats, w, sg)
    ranked = sorted((v[0], n) for n, v in scored.items() if v[0] is not None)
    rank_of = {n: i + 1 for i, (_, n) in enumerate(sorted(ranked, key=lambda t: (-t[0], t[1])))}

    leads = [{
        "npi": int(r["npi"]), "name": r["name"],
        "metro": r["metro"], "metroSlug": slugify(r["metro"]),
        "subspecialty": r["subspecialty"], "providerType": str(r["Rndrng_Prvdr_Type"]),
        "address": _address(r),
        "officeShare": round(float(r["office_share"]), 4),
        "sameAddress": [n for n in at_addr[r["addr_key"]] if n != int(r["npi"])],
        "values": values[int(r["npi"])],
        "facts": facts[int(r["npi"])]["text"],
        "evidence": facts[int(r["npi"])]["evidence"],
        "groups": facts[int(r["npi"])].get("groups", []),
        "hospitals": facts[int(r["npi"])].get("hospitals", []),
        "gradYear": facts[int(r["npi"])].get("grad") or None,
        "score": scored.get(int(r["npi"]), (None, {}))[0],
        "scoreParts": scored.get(int(r["npi"]), (None, {}))[1],
        "scoreRank": rank_of.get(int(r["npi"])),
    } for _, r in hb.iterrows()]

    metros = []
    for m in METROS:
        city, state = [p.strip() for p in m.rsplit(",", 1)]
        here = hb[hb["metro"] == m]
        lat, lon = METRO_COORDS.get(m, (None, None))
        ls = [l for l in leads if l["metro"] == m]
        metros.append({
            "slug": slugify(m), "metro": m, "city": city, "state": state, "lat": lat, "lon": lon,
            "billing": int(billing.get(m, 0)), "total": int(len(here)),
            "mix": {k: int(v) for k, v in here["subspecialty"].value_counts().sort_index().items()},
            "means": {k: (round(sum(l["values"][k] for l in ls if l["values"][k] is not None) /
                                max(1, sum(1 for l in ls if l["values"][k] is not None)), 3)
                          if any(l["values"][k] is not None for l in ls) else None) for k in CATALOG},
        })

    signals = []
    for sg in catalog():
        k = sg["key"]
        status, method = STATUS[k]
        vals = [l["values"][k] for l in leads if l["values"][k] is not None]
        h = bin_counts(vals, 10) if vals else [0] * 10
        signals.append({
            "key": k, "label": FACTOR_LABELS[k], "level": sg["level"], "rationale": sg["rationale"],
            "definition": sg["formula"], "status": status,
            "method": method, "missing": MISSING[k] if status == "none" else None,
            "productionSource": sg["production_source"],
            "coverage": len(vals), "total": len(leads),
            "mean": round(sum(vals) / len(vals), 3) if vals else None,
            "hist": [{"x0": round(j / 10, 2), "x1": round((j + 1) / 10, 2), "count": int(h[j])} for j in range(10)],
        })

    news_block = None
    if news:
        news_block = {
            "asof": news["asof"], "model": news["model"], "stats": news["stats"],
            "articles": [{k: a.get(k) for k in ("id", "title", "publisher", "published", "finalUrl", "fullText", "entities", "readError")}
                         for a in news["articles"]],
            "events": [news_event_out(e) for e in news["events"]],
            "entities": [{"id": e["id"], "name": e["name"], "place": e["place"], "kinds": e["kinds"],
                          "cardiologists": len(e["npis"])} for e in news["entities"]],
        }

    present = sorted(set(hb["subspecialty"]))
    filled = sum(1 for s in signals if s["status"] != "none" and s["coverage"] > 0)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": KIND,
        "source": {
            "id": "public", "label": "Real data",
            "description": (f"{len(leads):,} cardiologists in the eight cities whose {YEAR} Medicare billing is mostly in "
                            f"hospital settings, from public CMS records. {filled} of the ten signals are filled from real "
                            "data (each labeled exact, stand-in, inferred or assumption); nothing is simulated, and "
                            "nothing is scored."),
            "provenance": {
                "identity": f"real (CMS Medicare Physician & Other Practitioners, by Provider, {YEAR})",
                "location": "real (Medicare billing address)",
                "subspecialty": "real (Medicare provider type)",
                "hospital-based": f"inferred from {YEAR} billing setting (at most {HOSPITAL_BASED:.0%} of services in office settings)",
                "billing group, hospitals, graduation year": "real (CMS Doctors & Clinicians snapshots)",
                "signals": "real, stand-in, inferred or assumption per signal; contract window empty",
                "score, timing, groups": "none (no real basis for weights; no real outcome)",
            },
            "count": len(leads),
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "fetchedAt": raw.get("fetchedAt"),
            "asof": asof.isoformat(),
            "directorySnapshots": directory.dates if directory else [],
        },
        "universe": {
            "year": YEAR,
            "threshold": HOSPITAL_BASED,
            "rule": (f"Billing city is one of the eight cities, and at most {HOSPITAL_BASED:.0%} of the physician's "
                     f"{YEAR} Medicare services were billed in an office setting."),
            "caveats": [
                "\"Hospital-based\" is inferred from where services were billed, not from employment records. "
                "A hospital-employed physician can bill in an office, and an independent one in a hospital.",
                "The share uses the service lines CMS publishes; lines with fewer than 11 patients are suppressed.",
                "Medicare only: physicians with no published Medicare services aren't listed.",
                "City means the billing address city exactly; suburbs of the same metro aren't included.",
            ],
            "sources": [
                f"CMS Medicare Physician & Other Practitioners, by Provider and by Provider and Service ({YEAR})",
                "CMS Doctors & Clinicians National Downloadable File and Facility Affiliation snapshots"
                + (f" ({directory.dates[0]} to {directory.dates[-1]})" if directory else ""),
                "CMS Open Payments general payments (2025)",
                "CMS Physician Fee Schedule work RVUs (CY2024)",
                "CMS Hospital Change of Ownership; CMS Hospital General Information",
                "News articles found via Google News, read by Claude (claude-opus-5-5), quotes verified verbatim",
            ],
            "subspecialties": present,
        },
        "prediction": {"available": bool(bt and bt["verdict"]["passed"]),
                       "why": (PREDICTION_BT if bt and bt["verdict"]["passed"] else
                               PREDICTION_FAILED if bt else PREDICTION)},
        "model": ({k: bt[k] for k in ("t0", "t1", "features", "population", "outcome", "model", "metrics", "verdict",
                                       "weights", "signs", "signals", "crossCheck", "caveats")} if bt else None),
        "signals": signals,
        "metros": metros,
        "leads": leads,
        "news": news_block,
    }
