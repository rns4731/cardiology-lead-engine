"""Derived views over a scored universe, for the web app's drill-down pages.

Everything a page shows -- rollups, related cardiologists, candidate-group fit,
per-signal validation, threshold sensitivity -- is computed here, once, from the
same functions the CLI uses. The browser only renders it; it never re-implements
scoring or viability.

The hidden outcome label (`will_move_24mo`) is read ONLY to produce aggregates
(move rates, precision, recall). It is never attached to an individual record.
"""
from __future__ import annotations

from collections import Counter, defaultdict

import numpy as np
import pandas as pd

from engine.evaluate import _auc, auc_ci
from engine.clustering import (
    _READY,
    DEFAULT_MIN_SCORE,
    MAX_STARTER_SIZE,
    MIN_GROUP_SIZE,
    cohort_viability,
    form_cohorts,
    slugify,
)
from engine.generate_data import METRO_COORDS, SUBSPECIALTIES
from engine.scoring import FACTOR_LABELS, REASON_FLOOR, WEIGHTS, contributions, timing_parts

LABEL = "will_move_24mo"
# smallest group an outcome aggregate (a move rate, precision, recall) may describe.
# Smaller cells -- or two nested published sets closer than this -- would let a reader
# work out individual outcomes by subtraction (see disclosure_control).
MIN_N = 20
SUBSPECIALTY_ORDER = list(SUBSPECIALTIES)
TIMING_ORDER = ["Now", "Near", "Later", "Watch"]
RELATED_K = 5


def short_bucket(bucket: str) -> str:
    """'Now (0-3 mo)' -> 'Now'."""
    return bucket.split(" (")[0]


def contribution_matrix(scored: pd.DataFrame) -> pd.DataFrame:
    rows = [contributions(r) for _, r in scored.iterrows()]
    # explicit columns: an empty frame still yields a (0 x 10) matrix, not a KeyError
    return pd.DataFrame(rows, index=scored.index, columns=list(WEIGHTS))


def _counts(values, order) -> dict:
    c = Counter(values)
    return {k: int(c.get(k, 0)) for k in order}


def _rate(y: pd.Series):
    """Move rate, withheld below MIN_N (an n=1 'rate' is that person's outcome)."""
    return round(float(y.mean()), 4) if len(y) >= MIN_N else None


def bin_counts(values: np.ndarray, bins: int) -> np.ndarray:
    """Counts over [i/bins, (i+1)/bins), last bin closed. Exact edges like 0.6 land in
    their own bin (np.histogram's float edges put 0.6 in the bin below)."""
    idx = np.floor(np.round(np.asarray(values, dtype=float) * bins, 9)).astype(int)
    return np.bincount(np.clip(idx, 0, bins - 1), minlength=bins)


# ----------------------------------------------------------------------- related
def related_leads(scored: pd.DataFrame, contrib: pd.DataFrame, k: int = RELATED_K,
                  labels: dict | None = None) -> dict:
    """Per npi: colleagues (same employer), similar (signal profile), and complements
    (best other-subspecialty candidates in the metro).

    Similarity is cosine over contributions *standardized within the metro*. Raw
    contributions share large always-on components (career stage, subspecialty,
    productivity), which makes every pair look ~97% alike; standardizing first
    compares what is distinctive about each profile. The `why` names the signals two
    people are both unusually high on.
    """
    keys = list(contrib.columns)
    out = {}
    for _, grp in scored.groupby("metro"):
        npis = grp["npi"].to_numpy()
        props = grp["propensity_score"].to_numpy()
        emps = grp["employer"].to_numpy()
        subs = grp["subspecialty"].to_numpy()
        m = contrib.loc[grp.index].to_numpy(dtype=float)
        sd = m.std(axis=0)
        sd[sd < 1e-9] = 1.0  # constant column (float noise ~1e-15 isn't variation)
        z = (m - m.mean(axis=0)) / sd
        norms = np.linalg.norm(z, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        unit = z / norms
        sim = unit @ unit.T
        by_prop = np.lexsort((npis, -props))  # propensity desc, npi asc

        def shared(i: int, j: int) -> str:
            both = [(min(z[i, c], z[j, c]), c) for c in range(len(keys))
                    if z[i, c] > 0.5 and z[j, c] > 0.5]
            if not both:
                return f"{max(sim[i, j], 0):.0%} profile match"
            top = [(labels or FACTOR_LABELS)[keys[c]] for _, c in sorted(both, reverse=True)[:2]]
            return "Both high: " + " + ".join(top)

        for i in range(len(npis)):
            colleagues = [j for j in by_prop if j != i and emps[j] == emps[i]][:k]
            taken = set(colleagues) | {i}
            similar = [j for j in np.argsort(-sim[i], kind="stable") if j not in taken][:k]
            complements, seen = [], set()
            for j in by_prop:
                if j == i or subs[j] == subs[i] or subs[j] in seen:
                    continue
                complements.append(j)
                seen.add(subs[j])
                if len(complements) == len(SUBSPECIALTY_ORDER) - 1:
                    break
            out[int(npis[i])] = {
                "colleagues": [{"npi": int(npis[j]), "why": "Same employer"} for j in colleagues],
                "similar": [{"npi": int(npis[j]), "why": shared(i, j)} for j in similar],
                "complements": [{"npi": int(npis[j]), "why": "Top-ranked in their subspecialty"}
                                for j in complements],
            }
    return out


# -------------------------------------------------------------- candidate groups
def candidate_groups(scored: pd.DataFrame, cohorts: list[dict],
                     min_score: int = DEFAULT_MIN_SCORE) -> dict:
    """Per npi: every cohort in their metro, with status and the viability change.

    status: member | eligible (qualified, on the bench) | member_elsewhere (qualified,
    already in another cohort here) | below_floor. mode: "join" when the cohort has
    room, "swap" when it is full -- then delta is the best one-for-one swap, since the
    builder never forms a cohort above MAX_STARTER_SIZE.
    """
    by_npi = scored.set_index("npi")
    member_of = {n: c["id"] for c in cohorts for n in c["members"]}
    by_metro = defaultdict(list)
    base = {}
    for c in cohorts:
        by_metro[c["metro"]].append(c)
        mem = by_npi.loc[c["members"]]
        base[c["id"]] = (mem["propensity_score"].tolist(), mem["subspecialty"].tolist(),
                         mem["timing_bucket"].tolist())

    def fit(cid: str, p: float, sub: str, b: str) -> tuple[str, float]:
        ps, ss, bs = base[cid]
        before = cohort_viability(ps, ss, bs)["score"]
        if len(ps) < MAX_STARTER_SIZE:
            return "join", cohort_viability(ps + [p], ss + [sub], bs + [b])["score"] - before
        best = max(cohort_viability(ps[:i] + [p] + ps[i + 1:], ss[:i] + [sub] + ss[i + 1:],
                                    bs[:i] + [b] + bs[i + 1:])["score"] for i in range(len(ps)))
        return "swap", best - before

    order = {"member": 0, "eligible": 1, "member_elsewhere": 2, "below_floor": 3}
    out = {}
    for npi, row in by_npi.iterrows():
        rows = []
        for c in by_metro.get(row["metro"], []):
            if npi in c["members"]:
                rows.append({"group": c["id"], "status": "member", "delta": 0.0})
                continue
            mode, delta = fit(c["id"], row["propensity_score"], row["subspecialty"], row["timing_bucket"])
            qualified = row["propensity_score"] >= min_score
            status = ("below_floor" if not qualified
                      else "member_elsewhere" if npi in member_of else "eligible")
            rows.append({"group": c["id"], "status": status, "mode": mode,
                         "delta": round(delta, 1),
                         "gap": 0.0 if qualified else round(min_score - row["propensity_score"], 1)})
        rows.sort(key=lambda r: (order[r["status"]], -r["delta"]))
        out[int(npi)] = rows
    return out


# -------------------------------------------------------------------- signals
def signal_stats(scored: pd.DataFrame, contrib: pd.DataFrame, bins: int = 10) -> dict:
    """Per signal: how often it fires, how much it contributes, and whether physicians
    with it active actually moved more often (against the hidden label)."""
    y = scored[LABEL]
    out = {}
    for key, w in WEIGHTS.items():
        c = contrib[key]
        active = c >= w * REASON_FLOOR  # same rule that surfaces a reason
        rate_a, rate_i = _rate(y[active]), _rate(y[~active])
        hist = bin_counts((c / w).clip(0, 1).to_numpy(), bins)
        n_pos = int(y.sum())
        auc = _auc(y.to_numpy(), c.to_numpy())
        by_metro = []
        for metro, idx in scored.groupby("metro").groups.items():
            by_metro.append({
                "metro": metro, "slug": slugify(metro),
                "mean": round(float(c.loc[idx].mean()), 2),
                "active_share": round(float(active.loc[idx].mean()), 3),
            })
        top = (scored.assign(_c=c).sort_values(["_c", "propensity_score", "npi"],
                                               ascending=[False, False, True]).head(12))
        out[key] = {
            "active_share": round(float(active.mean()), 4),
            "active_count": int(active.sum()),
            "mean_contribution": round(float(c.mean()), 2),
            "move_rate_active": rate_a,
            "move_rate_inactive": rate_i,
            "lift": round(rate_a / rate_i, 2) if rate_a is not None and rate_i else None,
            # standalone rank quality of this one signal vs the outcome (0.5 = none);
            # threshold-free, so it treats binary and continuous signals alike. The 95%
            # interval says whether this sample can tell it apart from chance at all.
            "auc": round(auc, 3),
            "auc_ci": [round(v, 3) for v in auc_ci(auc, n_pos, len(y) - n_pos)],
            # how many independent units the signal actually varies across: a metro-level
            # signal has 8 data points, not 1,200
            "units": _units(scored, key, c),
            "hist": [{"x0": round(i / bins, 2), "x1": round((i + 1) / bins, 2),
                      "count": int(hist[i])} for i in range(bins)],
            "by_metro": sorted(by_metro, key=lambda r: -r["mean"]),
            "top": [int(n) for n in top["npi"]],
        }
    return out


def _units(scored: pd.DataFrame, key: str, c: pd.Series) -> dict:
    from engine.signals import SIGNALS

    level = SIGNALS[key]["level"]
    if level == "metro":
        return {"level": level, "total": int(scored["metro"].nunique()),
                "varying": int(scored.loc[c > 0, "metro"].nunique())}
    if level == "employer":
        return {"level": level, "total": int(scored["employer"].nunique()),
                "varying": int(scored.loc[c > 0, "employer"].nunique())}
    return {"level": level, "total": int(len(scored)), "varying": int((c > 0).sum())}


# ------------------------------------------------------------------ sensitivity
def threshold_sweep(scored: pd.DataFrame, floors=range(40, 81, 5)) -> list[dict]:
    """Volume vs. precision trade-off across propensity floors."""
    y = scored[LABEL]
    positives = int(y.sum())
    out = []
    for f in floors:
        q = scored[scored["propensity_score"] >= f]
        cohorts = form_cohorts(scored, min_score=f)
        out.append({
            "floor": int(f),
            "qualified": int(len(q)),
            "precision": _rate(q[LABEL]),
            "recall": (round(int(q[LABEL].sum()) / positives, 4)
                       if positives and len(q) >= MIN_N else None),
            "groups": len(cohorts),
            "viable_metros": len({c["metro"] for c in cohorts}),
            "grouped": sum(len(c["members"]) for c in cohorts),
        })
    return out


# --------------------------------------------------------------------- rollups
def _hist(scores: pd.Series, bins: int = 20) -> list[dict]:
    h, e = np.histogram(scores, bins=bins, range=(0, 100))
    return [{"x0": int(e[i]), "x1": int(e[i + 1]), "count": int(h[i])} for i in range(bins)]


def metro_rollups(scored: pd.DataFrame, cohorts: list[dict],
                  min_score: int = DEFAULT_MIN_SCORE) -> list[dict]:
    grouped = {n for c in cohorts for n in c["members"]}
    out = []
    for metro, grp in scored.groupby("metro"):
        q = grp[grp["propensity_score"] >= min_score]
        cs = sorted((c for c in cohorts if c["metro"] == metro), key=lambda c: c["metro_rank"])
        city, state = [p.strip() for p in metro.rsplit(",", 1)]
        lat, lon = METRO_COORDS.get(metro, (None, None))
        out.append({
            "slug": slugify(metro), "metro": metro, "city": city, "state": state,
            "lat": lat, "lon": lon,
            "total": int(len(grp)),
            "qualified": int(len(q)),
            "grouped": int(q["npi"].isin(grouped).sum()),
            "bench": int((~q["npi"].isin(grouped)).sum()),
            "gap_to_viable": max(0, MIN_GROUP_SIZE - int(len(q))),
            "avg_propensity": round(float(grp["propensity_score"].mean()), 1),
            "top_score": round(float(grp["propensity_score"].max()), 1),
            # undefined (not 0%) when nobody qualifies
            "ready_share": round(float(q["timing_bucket"].isin(_READY).mean()), 3) if len(q) else None,
            "best_viability": cs[0]["viability"] if cs else None,
            "independent_groups": int(grp["independent_groups_metro"].iloc[0]),
            "groups": [c["id"] for c in cs],
            "systems": sorted({slugify(e) for e in grp["employer"]}),
            "timing": _counts(grp["timing_bucket"].map(short_bucket), TIMING_ORDER),
            "timing_qualified": _counts(q["timing_bucket"].map(short_bucket), TIMING_ORDER),
            "mix": _counts(grp["subspecialty"], SUBSPECIALTY_ORDER),
            "mix_qualified": _counts(q["subspecialty"], SUBSPECIALTY_ORDER),
            "hist": _hist(grp["propensity_score"]),
        })
    return sorted(out, key=lambda m: (-(m["best_viability"] or 0), -m["qualified"]))


def system_rollups(scored: pd.DataFrame, cohorts: list[dict],
                   min_score: int = DEFAULT_MIN_SCORE) -> list[dict]:
    out = []
    for (metro, employer), grp in scored.groupby(["metro", "employer"]):
        q = grp[grp["propensity_score"] >= min_score]
        first = grp.iloc[0]
        out.append({
            "slug": slugify(employer), "name": employer,
            "metro": metro, "metro_slug": slugify(metro),
            "total": int(len(grp)), "qualified": int(len(q)),
            "avg_propensity": round(float(grp["propensity_score"].mean()), 1),
            "event": first["disruption_event"],
            "event_months_ago": int(first["disruption_recency_months"])
            if first["disruption_event"] != "none" else None,
            "groups": [c["id"] for c in cohorts
                       if c["metro"] == metro and set(c["members"]) & set(grp["npi"])],
            "anchors": [c["id"] for c in cohorts
                        if c["metro"] == metro and c["anchor_employer"] == employer],
            "timing": _counts(grp["timing_bucket"].map(short_bucket), TIMING_ORDER),
            "mix": _counts(grp["subspecialty"], SUBSPECIALTY_ORDER),
        })
    slugs = [s["slug"] for s in out]
    assert len(slugs) == len(set(slugs)), "hospital-system slugs must be unique"
    return sorted(out, key=lambda s: -s["qualified"])


def disclosure_control(metrics: dict, sweep: list[dict], operating_floor: int) -> tuple[dict, list[dict]]:
    """Withhold outcome aggregates that would reveal individual outcomes.

    Precision@k and every sweep row describe *prefixes of one ranking* (top-n sets). Two
    published prefixes of sizes a < b reveal, by subtraction, the movers among the b-a
    leads between them -- so keep only aggregates over >= MIN_N leads whose sizes are
    pairwise >= MIN_N apart (equal sizes are the same set). Priority: the headline
    top-25, then the operating floor, then other top-k, then other floors by distance
    from the operating floor. Withheld values become None with a reason.
    """
    metrics = {**metrics, "precision": dict(metrics["precision"]), "lift": dict(metrics["lift"]),
               "lift_ci": dict(metrics["lift_ci"]), "withheld": {}}
    sweep = [dict(r) for r in sweep]
    cands = [("k", "25")]
    cands += [("floor", r) for r in sweep if r["floor"] == operating_floor]
    cands += [("k", k) for k in metrics["precision"] if k != "25"]
    cands += [("floor", r) for r in sorted(sweep, key=lambda r: abs(r["floor"] - operating_floor))
              if r["floor"] != operating_floor]
    kept: list[int] = []
    for kind, ref in cands:
        size = int(ref) if kind == "k" else ref["qualified"]
        value = metrics["precision"].get(ref) if kind == "k" else ref["precision"]
        if value is None:
            reason = f"fewer than {MIN_N} leads"
        else:
            clash = next((s for s in kept if 0 < abs(s - size) < MIN_N), None)
            reason = (f"fewer than {MIN_N} leads" if size < MIN_N
                      else f"within {MIN_N} leads of another published figure (n={clash})"
                      if clash is not None else None)
        if reason is None:
            kept.append(size)
        elif kind == "k":
            metrics["precision"][ref] = metrics["lift"][ref] = metrics["lift_ci"][ref] = None
            metrics["withheld"][ref] = reason
        else:
            ref["precision"] = ref["recall"] = None
            ref["withheld"] = reason
    return metrics, sweep


def cohort_details(scored: pd.DataFrame, cohorts: list[dict]) -> list[dict]:
    """Cohorts plus the per-member aggregates their pages chart."""
    by_npi = scored.set_index("npi")
    out = []
    for c in cohorts:
        mem = by_npi.loc[c["members"]]
        out.append({
            **c,
            "metro_slug": slugify(c["metro"]),
            "anchor_slug": slugify(c["anchor_employer"]),
            "avg_propensity": round(float(mem["propensity_score"].mean()), 1),
            "timing": _counts(mem["timing_bucket"].map(short_bucket), TIMING_ORDER),
            "mix": _counts(mem["subspecialty"], SUBSPECIALTY_ORDER),
            "systems": _counts(mem["employer"], sorted(set(mem["employer"]))),
        })
    return out


def lead_ranks(scored: pd.DataFrame) -> pd.DataFrame:
    """Overall rank/percentile and in-metro rank for every lead."""
    s = scored["propensity_score"]
    return pd.DataFrame({
        "rank_overall": s.rank(ascending=False, method="min").astype(int),
        "percentile": (s.rank(pct=True, method="max") * 100).round(1),
        "rank_in_metro": scored.groupby("metro")["propensity_score"]
                               .rank(ascending=False, method="min").astype(int),
    }, index=scored.index)


def timing_matrix(scored: pd.DataFrame) -> list[dict]:
    return [timing_parts(r) for _, r in scored.iterrows()]
