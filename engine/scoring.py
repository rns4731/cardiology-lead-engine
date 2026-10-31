"""Transparent propensity + timing scoring for hospital-employed cardiologists.

Design choice: this is an explainable additive model, NOT a black box. The growth
team has to act on and trust every lead, so each score decomposes into weighted,
human-readable reasons. Weights are domain-reasoned (not fit to the hidden label),
which is exactly the position a real team starts from before it has outcome data.

Two outputs per cardiologist:
  * propensity_score (0-100): how likely to move to independent practice in ~24 mo
  * timing_bucket: WHEN the window is open, from trigger-event recency and contract
    / non-compete timing. "Who" is table stakes; "when" is what makes outreach land.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

# propensity weights (sum to 100). Each contributes weight * factor(0..1).
WEIGHTS = {
    "disruption": 18,            # employer M&A / distress -- the strongest trigger
    "career_stage": 14,          # established but not near-retirement
    "prior_independent": 12,     # has done it before
    "subspecialty_econ": 12,     # procedure-heavy -> viable independent economics
    "productivity": 10,          # high wRVU -> can sustain a book of business
    "peer_left": 8,              # a colleague just went independent
    "independent_density": 8,    # local ecosystem / referral scaffolding exists
    "recent_employer_change": 8, # recently moved -> already in motion / unsettled
    "contract_window": 5,        # contract renewal approaching
    "industry_engagement": 5,    # Open Payments activity (entrepreneurial proxy)
}

# only surface a reason when its factor clears this bar (keeps rationale signal-dense)
REASON_FLOOR = 0.40
_REASON_FLOOR = REASON_FLOOR


def reason_items(row: pd.Series) -> list[tuple[float, str]]:
    """Every signal that clears REASON_FLOOR, as (points, plain-language text), largest
    contribution first -- so a truncated list always shows the biggest drivers."""
    c = contributions(row)
    fires = lambda k: c[k] >= WEIGHTS[k] * REASON_FLOOR  # noqa: E731
    items = []
    if fires("disruption"):
        items.append((c["disruption"], f"Employer {row['disruption_event']} "
                      f"~{row['disruption_recency_months']}mo ago ({row['employer']})"))
    if fires("career_stage"):
        items.append((c["career_stage"], f"Career sweet spot ({row['years_in_practice']} yrs in practice)"))
    if fires("prior_independent"):
        items.append((c["prior_independent"], "Prior independent-practice experience"))
    if fires("subspecialty_econ"):
        strength = "strong" if row["sub_econ"] >= 0.9 else "workable"
        items.append((c["subspecialty_econ"], f"{row['subspecialty']} -- {strength} independent economics"))
    if fires("productivity"):
        p = row["wrvu_percentile"]
        level = "High" if p >= 75 else "Above-median" if p >= 50 else "Moderate"
        items.append((c["productivity"], f"{level} productivity (wRVU p{p})"))
    if fires("peer_left"):
        items.append((c["peer_left"], "A local peer recently went independent"))
    if fires("independent_density"):
        items.append((c["independent_density"],
                      f"{row['independent_groups_metro']} independent groups already in metro"))
    if fires("recent_employer_change"):
        items.append((c["recent_employer_change"], f"Changed employer ~{row['recent_change_months']}mo ago"))
    if fires("contract_window"):
        items.append((c["contract_window"], f"Contract renewal in ~{row['contract_renewal_months']}mo"))
    if fires("industry_engagement"):
        items.append((c["industry_engagement"],
                      f"Industry engagement (${row['open_payments_usd']:,.0f} Open Payments)"))
    # stable: equal points keep weight order
    return sorted(items, key=lambda it: -it[0])


def contributions(row: pd.Series) -> dict:
    """Points each factor adds to the propensity score (for the per-lead breakdown)."""
    factors = {
        "disruption": row["disruption_signal"],
        "career_stage": row["career_sweet_spot"],
        "prior_independent": float(row["prior_independent"]),
        "subspecialty_econ": row["sub_econ"],
        "productivity": row["wrvu_percentile"] / 100.0,
        "peer_left": float(row["peer_recently_left"]),
        "independent_density": row["density_norm"],
        "recent_employer_change": row["recent_change_signal"],
        "contract_window": row["contract_window"],
        "industry_engagement": row["op_norm"],
    }
    return {k: round(WEIGHTS[k] * factors[k], 2) for k in WEIGHTS}


# human-friendly labels for the factor keys (used by the dashboard)
FACTOR_LABELS = {
    "disruption": "Employer disruption",
    "career_stage": "Career stage",
    "prior_independent": "Prior independent",
    "subspecialty_econ": "Subspecialty economics",
    "productivity": "Productivity (wRVU)",
    "peer_left": "Peer recently left",
    "independent_density": "Local independent density",
    "recent_employer_change": "Recent employer change",
    "contract_window": "Contract window",
    "industry_engagement": "Industry engagement",
}


TIMING_WEIGHTS = {"trigger_recency": 45, "contract_window": 25, "noncompete": 18, "peer_left": 12}

# where each readiness input would come from in production. Contract and non-compete
# dates are NOT public: on public data alone readiness tops out at 45 + 12 = 57, below
# the "Now" cutoff -- timing at its sharpest needs relationship data.
# Production sources only -- none is connected; in Synthetic / Real-identities modes all
# four inputs are simulated (the exporter adds provenance: "simulated").
TIMING_SOURCES = {
    "trigger_recency": {"public": True, "source": "M&A / distress news and filings — not connected"},
    "contract_window": {"public": False, "source": "Relationship conversations (not public)"},
    "noncompete": {"public": False, "source": "Employment contract terms via relationships (not public)"},
    "peer_left": {"public": True, "source": "Affiliation changes over time — not connected"},
}

TIMING_LABELS = {
    "trigger_recency": "Employer trigger recency",
    "contract_window": "Contract renewal window",
    "noncompete": "Non-compete expiry",
    "peer_left": "Peer recently left",
}

# readiness-score cutoffs, highest first
TIMING_BUCKETS = [(65, "Now (0-3 mo)"), (45, "Near (3-9 mo)"), (25, "Later (9-18 mo)"),
                  (0, "Watch (18 mo+)")]


def timing_parts(row: pd.Series, rounded: bool = True) -> dict:
    """Points each timing component adds to the readiness score."""
    factors = {
        # recent disruption is the hottest timing signal
        "trigger_recency": row["disruption_signal"],
        # contract renewal approaching
        "contract_window": row["contract_window"],
        # non-compete expiring soon (0mo = expired/none -> fully open)
        "noncompete": float(np.clip(1 - row["noncompete_months"] / 24.0, 0, 1)),
        # a peer just left -> window is socially open now
        "peer_left": float(row["peer_recently_left"]),
    }
    pts = {k: TIMING_WEIGHTS[k] * factors[k] for k in TIMING_WEIGHTS}
    return {k: round(v, 2) for k, v in pts.items()} if rounded else pts


def _timing(row: pd.Series) -> tuple[float, str]:
    """Readiness score (0-100) and bucket from trigger recency + contract timing."""
    # sequential += (not sum(), which is compensated on Python 3.12+) to keep
    # bucket boundaries bit-identical to the original accumulation
    score = 0.0
    for pts in timing_parts(row, rounded=False).values():
        score += pts
    score = float(np.clip(score, 0, 100))
    # show one decimal truncated (never rounded up across a cutoff) and bucket from the
    # shown value, so the number on the page always agrees with its window
    shown = math.floor(score * 10) / 10
    bucket = next(name for cutoff, name in TIMING_BUCKETS if shown >= cutoff)
    return shown, bucket


def score_row(row: pd.Series) -> dict:
    """Score one cardiologist. Returns score, timing, and the reason breakdown."""
    contrib = contributions(row)
    score = float(np.clip(sum(contrib.values()), 0, 100))
    timing_score, timing_bucket = _timing(row)
    reasons = [text for _, text in reason_items(row)]
    return {
        "propensity_score": round(score, 1),
        "timing_score": timing_score,
        "timing_bucket": timing_bucket,
        "top_reasons": " | ".join(reasons[:4]) if reasons else "No strong signals",
        "n_reasons": len(reasons),
    }


def score_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Score every row; return df sorted by propensity (desc) with new columns."""
    scored = df.apply(score_row, axis=1, result_type="expand")
    out = pd.concat([df, scored], axis=1)
    # npi breaks ties so the ranking (and everything cut from it) is input-order independent
    return out.sort_values(["propensity_score", "npi"], ascending=[False, True],
                           kind="stable").reset_index(drop=True)


if __name__ == "__main__":
    from engine.generate_data import generate

    d = score_frame(generate())
    cols = ["name", "metro", "subspecialty", "propensity_score", "timing_bucket", "top_reasons"]
    print(d[cols].head(10).to_string(index=False))
