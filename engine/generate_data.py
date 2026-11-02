"""Synthetic universe of hospital-employed cardiologists.

Every field is modeled on a *publicly derivable* signal so this prototype maps
cleanly onto a real data pipeline:

    NPI / specialty / practice location   -> NPPES NPI Registry (public)
    subspecialty, employer, affiliation    -> NPPES + CMS PECOS + hospital directories
    productivity (work RVU percentile)      -> CMS Medicare Physician & Other Practitioners
    industry engagement ($)                 -> CMS Open Payments
    system disruption (M&A, distress)       -> news / SEC / state AG filings (modeled)
    peer movement, independent density       -> NPPES affiliation deltas over time (modeled)

No real physician data is used (per the brief: public or synthetic only, no PHI).
A latent `will_move_24mo` label is embedded from the *true* drivers plus noise so
the scorer -- which only sees the observable features -- can be evaluated honestly
(see evaluate.py). The scorer never reads the latent coefficients or the label.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

RNG_SEED = 42

# metro -> hospital systems operating there.
# Deliberately generic placeholder names ("Denver System A"): the generator attaches
# simulated M&A / distress events to each system, so a name must never be mistakable
# for a real organization. (Evocative invented names collided -- "Rocky Mountain
# Regional" is a real VA medical center near Denver.) Keep list lengths stable: they
# drive RNG draws, so changing a count changes every downstream number.
_SYSTEM_COUNTS = {
    "Austin, TX": 3, "Columbus, OH": 3, "Nashville, TN": 3, "Charlotte, NC": 2,
    "Phoenix, AZ": 3, "Tampa, FL": 3, "Denver, CO": 3, "Raleigh, NC": 3,
}
METROS = {m: [f"{m.split(',')[0]} System {chr(65 + i)}" for i in range(n)]
          for m, n in _SYSTEM_COUNTS.items()}

# approximate metro centroids (lat, lon) for mapping
METRO_COORDS = {
    "Austin, TX": (30.27, -97.74), "Columbus, OH": (39.96, -82.99),
    "Nashville, TN": (36.16, -86.78), "Charlotte, NC": (35.23, -80.84),
    "Phoenix, AZ": (33.45, -112.07), "Tampa, FL": (27.95, -82.46),
    "Denver, CO": (39.74, -104.99), "Raleigh, NC": (35.78, -78.64),
}

# subspecialty -> (population share, independent-economics attractiveness 0-1)
# procedure-heavy subspecialties sustain independent practice economics far better.
SUBSPECIALTIES = {
    "Interventional": (0.26, 1.00),
    "Electrophysiology": (0.16, 0.95),
    "General cardiology": (0.34, 0.60),
    "Imaging": (0.16, 0.65),
    "Advanced Heart Failure": (0.08, 0.35),
}

_FIRST = [
    "James", "Mary", "Robert", "Priya", "David", "Linda", "Michael", "Aisha",
    "William", "Elena", "Richard", "Sofia", "Thomas", "Wei", "Daniel", "Grace",
    "Omar", "Nina", "Samuel", "Rosa", "Henry", "Leah", "Carlos", "Maya",
]
_LAST = [
    "Patel", "Nguyen", "Garcia", "Kim", "Johnson", "Okafor", "Rossi", "Chen",
    "Martinez", "Ahmed", "Novak", "Reyes", "Goldberg", "Silva", "Haddad", "Park",
    "Fisher", "Dubois", "Kapoor", "Mueller", "Santos", "Larsson", "Ibrahim", "Tran",
]


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def _synth_row(rng, idx, metro, system, sub, independent_groups_metro, disruption_tuple):
    """Synthesize one cardiologist's identity, behavioral features + hidden label."""
    sub_econ = SUBSPECIALTIES.get(sub, (0.0, 0.60))[1]

    years_in_practice = int(np.clip(rng.normal(16, 8), 1, 38))
    age = int(np.clip(30 + years_in_practice + rng.normal(1, 2), 32, 70))
    tenure_years = int(np.clip(rng.normal(min(years_in_practice, 9), 4), 0, years_in_practice))

    prior_independent = int(rng.random() < 0.22)
    recent_change_months = int(rng.integers(1, 120))  # months since last employer change
    peer_recently_left = int(rng.random() < 0.18)

    wrvu_percentile = int(np.clip(rng.normal(55, 22), 1, 99))
    open_payments_usd = float(np.round(rng.lognormal(7.4, 1.3), 2))

    contract_renewal_months = int(rng.integers(1, 36))
    noncompete_months = int(rng.integers(0, 24))

    event, recency = disruption_tuple
    # disruption signal decays with recency; strongest in the first ~18 months
    disruption_signal = 0.0 if event == "none" else float(np.exp(-recency / 12.0))

    # career "sweet spot": established but not near retirement (~10-22 yrs)
    career_sweet_spot = float(np.exp(-((years_in_practice - 15) / 8.0) ** 2))

    density_norm = independent_groups_metro / 8.0
    op_norm = float(np.clip((np.log(open_payments_usd + 1) - 5) / 5.0, 0, 1))
    recent_change_signal = float(np.exp(-recent_change_months / 18.0))
    contract_window = float(np.clip(1 - contract_renewal_months / 24.0, 0, 1))

    # ---- latent ground truth (the scorer never sees these coefficients) ----
    # intercept tuned for a realistic ~15-20% 24-month move rate; noise sets the
    # irreducible ceiling on how well any scorer can rank (keeps AUC honest).
    signal = (
        -3.80
        + 1.20 * disruption_signal
        + 0.95 * prior_independent
        + 0.85 * sub_econ
        + 0.75 * peer_recently_left
        + 0.65 * career_sweet_spot
        + 0.50 * (wrvu_percentile / 100.0)
        + 0.45 * density_norm
        + 0.40 * recent_change_signal
        + 0.30 * contract_window
        + 0.25 * op_norm
    )
    logit = signal + rng.normal(0, 0.35)
    will_move_24mo = int(rng.random() < _sigmoid(logit))

    return {
        "npi": 1000000000 + idx,  # synthetic is NPPES-shaped
        "name": f"Dr. {rng.choice(_FIRST)} {rng.choice(_LAST)}",
        "metro": metro,
        "employer": system,
        "subspecialty": sub,
        "age": age,
        "years_in_practice": years_in_practice,
        "tenure_years_current_employer": tenure_years,
        "prior_independent": prior_independent,
        "recent_change_months": recent_change_months,
        "peer_recently_left": peer_recently_left,
        "wrvu_percentile": wrvu_percentile,
        "open_payments_usd": open_payments_usd,
        "contract_renewal_months": contract_renewal_months,
        "noncompete_months": noncompete_months,
        "disruption_event": event,
        "disruption_recency_months": recency,
        "disruption_signal": round(disruption_signal, 4),
        "sub_econ": sub_econ,
        "career_sweet_spot": round(career_sweet_spot, 4),
        "density_norm": round(density_norm, 4),
        "op_norm": round(op_norm, 4),
        "recent_change_signal": round(recent_change_signal, 4),
        "contract_window": round(contract_window, 4),
        "independent_groups_metro": independent_groups_metro,
        "will_move_24mo": will_move_24mo,  # hidden label, evaluation only
        # noise-free latent score: the best any ranker could do (oracle ceiling).
        # Evaluation-only, like the label -- never exported per lead.
        "latent_signal": signal,
    }


def _metro_context(rng, metros):
    """Per-metro standing ecosystem + per-(metro,system) disruption events."""
    independent_groups = {m: int(rng.integers(0, 9)) for m in metros}
    disruption = {}
    for m in metros:
        for s in METROS.get(m, ["Regional Health System"]):
            if rng.random() < 0.28:
                event = rng.choice(["acquisition", "merger", "financial distress", "layoffs"])
                recency = int(rng.integers(1, 30))
            else:
                event, recency = "none", 999
            disruption[(m, s)] = (event, recency)
    return independent_groups, disruption


def generate(n: int = 1200, seed: int = RNG_SEED) -> pd.DataFrame:
    """Return a DataFrame of hospital-employed cardiologists with a hidden label."""
    rng = np.random.default_rng(seed)
    metros = list(METROS.keys())
    # give each metro a size weight and a standing independent-group ecosystem
    metro_weight = rng.dirichlet(np.ones(len(metros)) * 2.0)
    independent_groups, disruption = _metro_context(rng, metros)

    subs = list(SUBSPECIALTIES.keys())
    sub_share = np.array([SUBSPECIALTIES[s][0] for s in subs])
    sub_share = sub_share / sub_share.sum()

    rows = []
    for i in range(n):
        metro = rng.choice(metros, p=metro_weight)
        system = rng.choice(METROS[metro])
        sub = rng.choice(subs, p=sub_share)
        rows.append(
            _synth_row(rng, i, metro, system, sub,
                       independent_groups[metro], disruption[(metro, system)])
        )

    df = pd.DataFrame(rows)
    # local pool size: how many hospital-employed peers share the metro
    df["local_peer_count"] = df.groupby("metro")["npi"].transform("count")
    return df


if __name__ == "__main__":
    d = generate()
    print(d.head())
    print(f"\n{len(d)} cardiologists; base move rate = {d.will_move_24mo.mean():.1%}")
