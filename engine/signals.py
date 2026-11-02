"""Catalog of the ten propensity signals: meaning, formula, and real-world source.

The scorer (scoring.py) owns the weights and the arithmetic; this module owns the
*explanation* -- what each signal means, the exact transform applied, and where it
WOULD come from in production, with its true connection status. In Synthetic mode no
signal is connected to data: the values are simulated, and the exporter labels every one
of them "simulated" in the bundle. `level` says what the signal varies
across (individual / employer / metro) -- a metro-level signal has 8 data points, not
1,200, which bounds how much any sample can say about it. The web app's signal pages are
rendered straight from this catalog, so keep `formula` in sync with the transforms
in generate_data._synth_row and scoring.contributions.
"""
from __future__ import annotations

from engine.scoring import FACTOR_LABELS, WEIGHTS

SIGNALS = {
    "disruption": {
        "level": "employer",
        "rationale": "Employer M&A, financial distress, or layoffs is the single biggest "
                     "real-world trigger for a physician to leave. The signal decays as the "
                     "event recedes.",
        "formula": "exp(-months_since_event / 12); 0 when the employer has no event",
        "production_source": "M&A / distress news and filings. Connected in Real data mode: news read by Claude (quotes verified word for word) plus CMS hospital ownership changes, tied to the billing group or affiliated hospitals.",
        "public": True,
    },
    "career_stage": {
        "level": "individual",
        "rationale": "The ~10-22 year sweet spot: established enough to carry a book of "
                     "business, early enough to want to build something.",
        "formula": "exp(-((years_in_practice - 15) / 8)^2)",
        "production_source": "Years in practice (training completion) isn't public. Real data mode uses graduation year from CMS Doctors & Clinicians as a stand-in.",
        "public": True,
    },
    "prior_independent": {
        "level": "individual",
        "rationale": "Has practiced independently before -- dramatically lower friction "
                     "to do it again.",
        "formula": "1 if any prior independent affiliation, else 0",
        "production_source": "Past group affiliations. Connected in Real data mode: CMS Doctors & Clinicians snapshots 2019-2026 (downloaded through a real browser), with \"independent-style\" inferred by a stated rule.",
        "public": True,
    },
    "subspecialty_econ": {
        "level": "individual",
        "rationale": "Procedure-heavy subspecialties (interventional, EP) sustain independent "
                     "economics; advanced heart failure is hospital-dependent.",
        "formula": "lookup: Interventional 1.00, EP 0.95, Imaging 0.65, General cardiology 0.60, AHF 0.35",
        "production_source": "Subspecialty (Medicare provider type; real in Real data mode) with a fixed economics lookup. The lookup values are an assumption. Simulated in Synthetic mode.",
        "public": True,
    },
    "productivity": {
        "level": "individual",
        "rationale": "High work-RVU producers can sustain a practice of their own.",
        "formula": "wRVU percentile / 100",
        "production_source": "All-payer work RVUs are internal data, not public. Real data mode uses Medicare work RVUs (CMS billing x fee-schedule work RVUs) as a stand-in.",
        "public": True,
    },
    "peer_left": {
        "level": "individual",
        "rationale": "A local colleague who just went independent is powerful social proof "
                     "and opens the window now.",
        "formula": "1 if a same-metro peer changed to an independent affiliation recently",
        "production_source": "Colleagues' affiliation changes. Connected in Real data mode: billing-group moves across CMS Doctors & Clinicians snapshots, \"independent-style\" inferred.",
        "public": True,
    },
    "independent_density": {
        "level": "metro",
        "rationale": "An existing independent ecosystem supplies referral and operational "
                     "scaffolding.",
        "formula": "independent cardiology groups in metro / 8 (capped at 1)",
        "production_source": "Independent cardiology groups per city. Inferred in Real data mode from CMS Doctors & Clinicians groups and their billing settings.",
        "public": True,
    },
    "recent_employer_change": {
        "level": "individual",
        "rationale": "Recently moved -- already in motion and more open to another change.",
        "formula": "exp(-months_since_last_employer_change / 18)",
        "production_source": "Employer changes aren't public. Real data mode uses billing-group (reassignment) changes across CMS Doctors & Clinicians snapshots as a stand-in.",
        "public": True,
    },
    "contract_window": {
        "level": "individual",
        "rationale": "A contract renewal is a natural decision point.",
        "formula": "max(0, 1 - months_to_renewal / 24)",
        "production_source": "Not public — would come from relationship conversations.",
        "public": False,
    },
    "industry_engagement": {
        "level": "individual",
        "rationale": "Industry engagement is a proxy for an entrepreneurial posture.",
        "formula": "clip((ln(open_payments_usd + 1) - 5) / 5, 0, 1)",
        "production_source": "CMS Open Payments. Connected in Real data mode (2025 bulk file; 2021 for the back-test).",
        "public": True,
    },
}

assert set(SIGNALS) == set(WEIGHTS), "signal catalog must cover exactly the scored factors"


def catalog() -> list[dict]:
    """Signals ordered by weight, with label + weight merged in."""
    return [
        {"key": k, "label": FACTOR_LABELS[k], "weight": WEIGHTS[k], **SIGNALS[k]}
        for k in sorted(WEIGHTS, key=lambda k: -WEIGHTS[k])
    ]
