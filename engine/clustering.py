"""Assemble scored leads into viable new-group candidates.

A new medical group is physically local, so geography (metro) is a hard constraint.
A *viable* group also needs enough members, high collective propensity, a workable
subspecialty mix, and timing alignment. `cohort_viability` scores any set of
cardiologists on all four; everything else here is built on that one function.

Two entry points:
  * build_groups  -- one starter group per metro (top-N); used by run.py and app.py
  * form_cohorts  -- partitions each metro's qualified pool into ranked, disjoint
                     cohorts by greedy viability maximization; used by the web app
"""
from __future__ import annotations

import re
from collections import Counter

import numpy as np
import pandas as pd

MIN_GROUP_SIZE = 5     # the Company wants 5+ cardiologists per new group
MAX_STARTER_SIZE = 8   # size of the proposed founding cohort
DEFAULT_MIN_SCORE = 55 # propensity floor to count as a qualified lead
_READY = {"Now (0-3 mo)", "Near (3-9 mo)"}
_N_SUBSPECIALTIES = 5

VIABILITY_WEIGHTS = {"avg_propensity": 0.40, "size": 0.25, "diversity": 0.20, "timing": 0.15}


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _diversity(subs) -> float:
    """Normalized Shannon diversity (0-1) over subspecialties in the cohort."""
    counts = np.array(list(Counter(subs).values()), dtype=float)
    if len(counts) <= 1:
        return 0.0
    p = counts / counts.sum()
    shannon = -(p * np.log(p)).sum()
    return float(shannon / np.log(_N_SUBSPECIALTIES))


def _subspecialty_diversity(subs: pd.Series) -> float:
    return _diversity(subs.tolist())


def cohort_viability(props, subs, buckets, max_size: int = MAX_STARTER_SIZE) -> dict:
    """Viability (0-100) of a cohort plus each weighted component's raw value."""
    n = len(props)
    avg = float(np.mean(props))
    size = min(n / max_size, 1.0)
    div = _diversity(subs)
    ready = sum(b in _READY for b in buckets) / n
    w = VIABILITY_WEIGHTS
    score = (w["avg_propensity"] * (avg / 100.0) + w["size"] * size
             + w["diversity"] * div + w["timing"] * ready) * 100
    return {"avg_propensity": avg, "size": size, "diversity": div, "timing": ready,
            "score": score}


def build_groups(
    scored: pd.DataFrame,
    min_score: int = DEFAULT_MIN_SCORE,
    min_group_size: int = MIN_GROUP_SIZE,
    max_starter_size: int = MAX_STARTER_SIZE,
) -> tuple[pd.DataFrame, dict]:
    """Return (group_summary, members_by_metro) for metros that can seed a group."""
    qualified = scored[scored["propensity_score"] >= min_score]

    groups = []
    members = {}
    for metro, pool in qualified.groupby("metro"):
        if len(pool) < min_group_size:
            continue
        starters = pool.nlargest(max_starter_size, "propensity_score")
        v = cohort_viability(starters["propensity_score"].tolist(),
                             starters["subspecialty"].tolist(),
                             starters["timing_bucket"].tolist(), max_starter_size)

        groups.append(
            {
                "metro": metro,
                "qualified_pool": len(pool),
                "starter_size": len(starters),
                "avg_propensity": round(v["avg_propensity"], 1),
                "subspecialty_mix": ", ".join(
                    f"{k}:{v}" for k, v in starters["subspecialty"].value_counts().items()
                ),
                "subspecialty_diversity": round(v["diversity"], 2),
                "ready_now_or_near": f"{v['timing']:.0%}",
                "viability_score": round(v["score"], 1),
            }
        )
        members[metro] = starters[
            ["name", "subspecialty", "employer", "propensity_score", "timing_bucket", "top_reasons"]
        ].reset_index(drop=True)

    summary = (
        pd.DataFrame(groups)
        .sort_values("viability_score", ascending=False)
        .reset_index(drop=True)
        if groups
        else pd.DataFrame()
    )
    return summary, members


def form_cohorts(
    scored: pd.DataFrame,
    min_score: int = DEFAULT_MIN_SCORE,
    min_size: int = MIN_GROUP_SIZE,
    max_size: int = MAX_STARTER_SIZE,
) -> list[dict]:
    """Partition each metro's qualified pool into disjoint, ranked cohorts.

    Greedy viability maximization: build the strongest cohort first by repeatedly
    adding whichever remaining cardiologist raises the cohort's viability most (ties
    go to the higher propensity), up to `max_size`; then repeat on who is left while
    at least `min_size` remain. Leftovers form the metro's bench.
    """
    qualified = scored[scored["propensity_score"] >= min_score]
    cohorts: list[dict] = []
    for metro, pool in qualified.groupby("metro"):
        pool = pool.sort_values(["propensity_score", "npi"], ascending=[False, True])
        # positional arrays: the inner loop runs O(pool x max_size) times per cohort
        props = pool["propensity_score"].tolist()
        subs = pool["subspecialty"].tolist()
        buckets = pool["timing_bucket"].tolist()
        remaining = list(range(len(pool)))
        rank = 0
        while len(remaining) >= min_size:
            chosen: list[int] = []
            while len(chosen) < max_size and len(chosen) < len(remaining):
                best, best_v = None, -1.0
                for i in remaining:
                    if i in chosen:
                        continue
                    trial = chosen + [i]
                    v = cohort_viability([props[j] for j in trial], [subs[j] for j in trial],
                                         [buckets[j] for j in trial], max_size)["score"]
                    if v > best_v + 1e-9:
                        best, best_v = i, v
                chosen.append(best)
            remaining = [i for i in remaining if i not in chosen]
            cohorts.append(_describe(metro, rank, pool.iloc[chosen], max_size))
            rank += 1
    cohorts.sort(key=lambda c: -c["viability"])
    for i, c in enumerate(cohorts, start=1):
        c["overall_rank"] = i
    return cohorts


def _letters(rank: int) -> str:
    """0 -> A, 25 -> Z, 26 -> AA (bijective base-26), so ids stay unique and alphanumeric."""
    s, n = "", rank + 1
    while n:
        n, rem = divmod(n - 1, 26)
        s = chr(65 + rem) + s
    return s


def _describe(metro: str, rank: int, cohort: pd.DataFrame, max_size: int) -> dict:
    letter = _letters(rank)
    v = cohort_viability(cohort["propensity_score"].tolist(), cohort["subspecialty"].tolist(),
                         cohort["timing_bucket"].tolist(), max_size)
    anchor, anchor_n = Counter(cohort["employer"]).most_common(1)[0]
    events = cohort[cohort["disruption_event"] != "none"]
    trigger = None
    if len(events):
        (emp, ev), n = Counter(zip(events["employer"], events["disruption_event"])).most_common(1)[0]
        if n >= 2:  # one person is not a *shared* trigger
            trigger = {"employer": emp, "event": ev, "members": int(n)}
    return {
        "id": f"{slugify(metro)}-{letter.lower()}",
        "name": f"{metro.split(',')[0]} Cohort {letter}",
        "metro": metro,
        "metro_rank": rank + 1,
        "members": [int(n) for n in cohort["npi"]],
        "viability": round(v["score"], 1),
        "components": {k: round(v[k], 3) for k in VIABILITY_WEIGHTS},
        "anchor_employer": anchor,
        "anchor_share": round(anchor_n / len(cohort), 2),
        "shared_trigger": trigger,
    }


if __name__ == "__main__":
    from engine.generate_data import generate
    from engine.scoring import score_frame

    s = score_frame(generate())
    summary, members = build_groups(s)
    print(summary.to_string(index=False))
    print()
    for c in form_cohorts(s):
        print(f"{c['overall_rank']:>2}. {c['name']:<20} viability {c['viability']:>5}  "
              f"members {len(c['members'])}  anchor {c['anchor_employer']}")
