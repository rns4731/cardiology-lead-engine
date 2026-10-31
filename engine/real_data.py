"""The "Real data" source: only what public CMS records actually say. No score.

It uses the same ten signals as the synthetic universe (engine/signals.py). A signal is
filled only from a real source that measures that exact thing, and none is connected:

  - no news / M&A feed (employer disruption); no training or certification dates (career
    stage); no affiliation or reassignment history (prior independent, peer left,
    independent groups, employer change); no wRVUs (productivity); Open Payments refused
    this client (403); contract dates are not public.
  - Subspecialty is real, but the economics score built on it is a fixed lookup -- an
    assumption, not data -- so that signal stays empty too.
  - Stand-ins from Medicare billing (allowed $, billing-address changes, years billing)
    were considered and declined: a proxy is not the signal.

So every signal value is null, and there are no weights, score, ranking, timing windows
or candidate groups. Nothing is simulated or imputed; where data is missing the bundle
says so instead of estimating. What IS real:

  - who: cardiologists billing Medicare in the latest published year (CMS Medicare
    Physician & Other Practitioners, by Provider) whose billing city is one of the
    eight cities;
  - "hospital-based" is INFERRED from billing setting: at most 20% of their Medicare
    services that year were billed with place of service = office (CMS by Provider and
    Service). Billing setting is not employment, and every page says so;
  - name, NPI, billing address and Medicare provider type, as CMS publishes them.
"""
from __future__ import annotations

import string
from collections import defaultdict
from datetime import datetime, timezone

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

PREDICTION = ("No signal has a real source connected, so there is nothing to weight or score. There is also no real "
              "outcome data (who actually left hospital employment), so nothing could be validated. Score, ranking, "
              "timing windows and candidate groups are left blank rather than estimated.")


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


def build_public_bundle(offline: bool = True) -> dict:
    from engine.export_web import SCHEMA_VERSION

    raw = load(offline=offline)
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

    at_addr = defaultdict(list)
    for n, a in zip(hb["npi"], hb["addr_key"]):
        at_addr[a].append(int(n))

    leads = [{
        "npi": int(r["npi"]), "name": r["name"],
        "metro": r["metro"], "metroSlug": slugify(r["metro"]),
        "subspecialty": r["subspecialty"], "providerType": str(r["Rndrng_Prvdr_Type"]),
        "address": _address(r),
        "officeShare": round(float(r["office_share"]), 4),
        "sameAddress": [n for n in at_addr[r["addr_key"]] if n != int(r["npi"])],
        "values": {k: None for k in CATALOG},
    } for _, r in hb.iterrows()]

    billing = in_cities.groupby("metro").size()
    metros = []
    for m in METROS:
        city, state = [p.strip() for p in m.rsplit(",", 1)]
        here = hb[hb["metro"] == m]
        lat, lon = METRO_COORDS.get(m, (None, None))
        metros.append({
            "slug": slugify(m), "metro": m, "city": city, "state": state, "lat": lat, "lon": lon,
            "billing": int(billing.get(m, 0)), "total": int(len(here)),
            "mix": {k: int(v) for k, v in here["subspecialty"].value_counts().sort_index().items()},
        })

    signals = [{
        "key": s["key"], "label": FACTOR_LABELS[s["key"]], "level": s["level"],
        "rationale": s["rationale"], "definition": s["formula"],
        "status": "none", "missing": MISSING[s["key"]], "productionSource": s["production_source"],
    } for s in catalog()]

    present = sorted(set(hb["subspecialty"]))
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": KIND,
        "source": {
            "id": "public", "label": "Real data",
            "description": (f"{len(leads):,} cardiologists in the eight cities whose {YEAR} Medicare billing is "
                            "mostly in hospital settings, from public CMS records. Same ten signals as Synthetic, "
                            "but none has a real source connected, so all are empty and nothing is scored."),
            "provenance": {
                "identity": f"real (CMS Medicare Physician & Other Practitioners, by Provider, {YEAR})",
                "location": "real (Medicare billing address)",
                "subspecialty": "real (Medicare provider type)",
                "hospital-based": f"inferred from {YEAR} billing setting (at most {HOSPITAL_BASED:.0%} of services in office settings)",
                "employer": "unknown (no real source connected)",
                "signals": "none connected; all ten are empty",
                "score, timing, groups": "none (no real basis)",
            },
            "count": len(leads),
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "fetchedAt": raw.get("fetchedAt"),
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
                f"CMS Medicare Physician & Other Practitioners, by Provider ({YEAR})",
                f"CMS Medicare Physician & Other Practitioners, by Provider and Service ({YEAR})",
            ],
            "subspecialties": present,
        },
        "prediction": {"available": False, "why": PREDICTION},
        "signals": signals,
        "metros": metros,
        "leads": leads,
    }
