"""Back-test and fit: would the real signals, as they stood in October 2022, have picked out
who moved by October 2024?

    .venv/bin/python -m engine.backtest        # offline; writes data/cache/backtest.json

Rules fixed before looking at any result:
  - Prediction date T0 = the 2022-10-08 CMS snapshot. Every signal uses only what was known
    then: billing groups and history up to T0, 2022 Medicare billing, Open Payments 2021
    (published mid-2022), CMS ownership changes before T0. Employer disruption uses CMS
    ownership records only -- news before T0 was not searched in this stage.
  - Population: cardiologists in the seven states who were hospital-based by 2022 billing
    (at most 20% of services in office settings), not already in an independent-style group
    at T0, and still listed at T1.
  - Outcome: by the 2024-10-24 snapshot they appear in an independent-style group they were
    not in at T0 (the same inferred rule as the signals). A billing switch to office-dominant
    by 2024 is reported as a cross-check only.
  - Model: L2 logistic regression on the nine signals with a value (contract window has no
    data). Doctors missing any signal are left out, not imputed.
  - Verdict: out-of-fold AUC (5-fold, fixed seed) must have a 95% interval above 0.5.
    Otherwise the weights are not used and the app says the back-test failed.

Caveats stated with the result: the outcome is inferred; mover counts swing with the window
chosen (12 to 56 across windows), so some "moves" may be CMS listing artifacts; 2024 work-RVU
values are applied to 2022 billing (2022 files are no longer published); Open Payments 2021
is the current CMS copy, including corrections made after T0.
"""
from __future__ import annotations

import json
import os
from datetime import date

import numpy as np
import pandas as pd

from engine.evaluate import _auc, auc_ci, wilson
from engine.insights import MIN_N

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "cache", "backtest.json")
T0, T1 = "2022-10-08", "2024-10-24"
ASOF0 = date(2022, 10, 8)
L2 = 1.0
FOLDS, SEED, BOOT = 5, 42, 300
KS = (50, 100)


def _fit(X: np.ndarray, y: np.ndarray, l2: float = L2) -> np.ndarray:
    """L2 logistic regression by Newton steps. Returns [intercept, coefs...]."""
    Xb = np.hstack([np.ones((len(X), 1)), X])
    w = np.zeros(Xb.shape[1])
    R = np.eye(Xb.shape[1]) * l2
    R[0, 0] = 0
    for _ in range(100):
        p = 1 / (1 + np.exp(-Xb @ w))
        step = np.linalg.solve((Xb * (p * (1 - p))[:, None]).T @ Xb + R, Xb.T @ (p - y) + R @ w)
        w -= step
        if np.abs(step).max() < 1e-10:
            break
    return w


def _folds(y: np.ndarray, k: int, seed: int) -> np.ndarray:
    """Stratified fold ids: movers spread evenly across folds."""
    rng = np.random.default_rng(seed)
    f = np.zeros(len(y), dtype=int)
    for cls in (0, 1):
        idx = np.flatnonzero(y == cls)
        rng.shuffle(idx)
        f[idx] = np.arange(len(idx)) % k
    return f


def _oof(X: np.ndarray, y: np.ndarray, seed: int) -> np.ndarray:
    f = _folds(y, FOLDS, seed)
    out = np.zeros(len(y))
    for k in range(FOLDS):
        w = _fit(X[f != k], y[f != k])
        out[f == k] = X[f == k] @ w[1:] + w[0]
    return out


def points(beta: np.ndarray) -> tuple[list[int], list[int]]:
    """Integer weights summing to 100 (largest remainder) and each signal's fitted direction.
    A score is then a sum of per-signal points that ranks exactly like the fitted model."""
    mag = np.abs(beta)
    raw = 100 * mag / (mag.sum() or 1)
    w = np.floor(raw).astype(int)
    for i in np.argsort(-(raw - w))[: 100 - w.sum()]:
        w[i] += 1
    return [int(v) for v in w], [1 if b >= 0 else -1 for b in beta]


def score(values: dict, features: list[str], weights: list[int], signs: list[int]) -> tuple[float | None, dict]:
    """Points per signal (oriented by the fitted direction). None when any input is missing."""
    if any(values.get(f) is None for f in features):
        return None, {}
    parts = {f: round(w * (values[f] if s > 0 else 1 - values[f]), 2) for f, w, s in zip(features, weights, signs)}
    return round(sum(parts.values()), 1), parts


def run() -> dict:
    from engine.cms_directory import load_directory
    from engine.open_payments import load_payments
    from engine.public_fetch import load
    from engine.real_data import TYPE_MAP
    from engine.real_signals import STATUS, Directory, compute, office_share, work_rvus
    from engine.wrvu import load_work_rvu

    raw = load(offline=True)
    shares = {int(y): office_share(raw["svc"][y]) for y in raw["svc"]}
    d = load_directory()
    full = Directory(d, shares)
    past = Directory({**d, "snapshots": {k: v for k, v in d["snapshots"].items() if k <= T0}}, shares)
    assert past.latest == T0, past.latest

    prv = pd.DataFrame(raw["prv"]["2022"]).drop_duplicates("Rndrng_NPI").set_index("Rndrng_NPI")
    s22, s24 = shares[2022], shares[2024]
    pop, y, cross = [], [], []
    excluded = {"already_independent_style": 0, "not_listed_at_t1": 0}
    for n, groups in full.groups[T0].items():
        if n not in s22.index or s22[n] > 0.2 or n not in prv.index or prv.at[n, "Rndrng_Prvdr_Type"] not in TYPE_MAP:
            continue
        if any(full.style[T0].get(p) == "independent-style" for p in groups):
            excluded["already_independent_style"] += 1
            continue
        if n not in full.groups[T1]:
            excluded["not_listed_at_t1"] += 1
            continue
        pop.append(n)
        y.append(int(any(full.style[T1].get(p) == "independent-style" for p in full.groups[T1][n] - groups)))
        cross.append(None if n not in s24.index else int(s24[n] >= 0.5))

    npis = [int(n) for n in pop]
    work = load_work_rvu()["work"]
    values, _ = compute(
        npis,
        subspecialty={int(n): TYPE_MAP[prv.at[n, "Rndrng_Prvdr_Type"]] for n in pop},
        city={int(n): (str(prv.at[n, "Rndrng_Prvdr_City"]).upper().strip(), prv.at[n, "Rndrng_Prvdr_State_Abrvtn"]) for n in pop},
        directory=past, wrvu=work_rvus(raw["svc"]["2022"], work), payments=load_payments(2021), news=None,
        chow=raw.get("chow", []), asof=ASOF0, cms_only=True)

    features = [k for k in STATUS if STATUS[k][0] != "none"]
    rows = [(i, [values[n][f] for f in features]) for i, n in enumerate(npis)]
    keep = [i for i, v in rows if all(x is not None for x in v)]
    X = np.array([rows[i][1] for i in keep], dtype=float)
    Y = np.array([y[i] for i in keep])
    C = [cross[i] for i in keep]
    n_pos, n_neg = int(Y.sum()), int(len(Y) - Y.sum())

    oof = _oof(X, Y, SEED)
    auc = _auc(Y, oof)
    lo, hi = auc_ci(auc, n_pos, n_neg)
    repeats = [round(_auc(Y, _oof(X, Y, s)), 3) for s in range(1, 21)]
    order = np.argsort(-oof, kind="stable")
    base = Y.mean()
    topk = {}
    for k in KS:
        if k < MIN_N or k > len(Y):
            continue
        hits = int(Y[order[:k]].sum())
        ci = wilson(hits, k)
        topk[str(k)] = {"hits": hits, "precision": round(hits / k, 3), "lift": round(hits / k / base, 2),
                        "liftCi": [round(ci[0] / base, 2), round(ci[1] / base, 2)]}

    w = _fit(X, Y)
    beta = w[1:]
    rng = np.random.default_rng(SEED)
    boot = []
    for _ in range(BOOT):
        idx = rng.integers(0, len(Y), len(Y))
        if Y[idx].sum() < 3:
            continue
        boot.append(_fit(X[idx], Y[idx])[1:])
    boot = np.array(boot)
    weights, signs = points(beta)

    per_signal = []
    for j, f in enumerate(features):
        a = _auc(Y, X[:, j])
        per_signal.append({
            "key": f, "coef": round(float(beta[j]), 3),
            "coefCi": [round(float(np.percentile(boot[:, j], 2.5)), 3), round(float(np.percentile(boot[:, j], 97.5)), 3)],
            "sameSignShare": round(float(np.mean(np.sign(boot[:, j]) == np.sign(beta[j]))), 2),
            "weight": weights[j], "direction": "higher → more likely" if signs[j] > 0 else "lower → more likely",
            "auc": round(a, 3), "aucCi": [round(v, 3) for v in auc_ci(a, n_pos, n_neg)],
            "mean": round(float(X[:, j].mean()), 3),
        })

    ci_ok = [i for i, c in enumerate(C) if c is not None]
    cross_auc = _auc(np.array([C[i] for i in ci_ok]), oof[ci_ok]) if ci_ok else None
    cross_pos = int(sum(C[i] for i in ci_ok))
    passed = bool(lo > 0.5)
    return {
        "t0": T0, "t1": T1, "asof": ASOF0.isoformat(), "features": features,
        "population": {"listed": len(pop), "used": int(len(Y)), "missingASignal": len(pop) - len(keep),
                       "positives": n_pos, "baseRate": round(float(base), 4), **excluded},
        "outcome": ("Appears in an independent-style group (inferred rule) between the Oct 2022 and Oct 2024 CMS "
                    "snapshots that they were not in before"),
        "model": f"L2 logistic regression (lambda {L2}) on {len(features)} signals; {FOLDS}-fold out-of-fold validation",
        "metrics": {"auc": round(auc, 3), "aucCi": [round(lo, 3), round(hi, 3)],
                    "aucRepeats": [min(repeats), max(repeats)], "topK": topk},
        "verdict": {"passed": passed,
                    "rule": "Out-of-fold AUC's 95% interval must sit above 0.5 (chance).",
                    "text": (f"Better than chance: AUC {auc:.2f} (95% CI {lo:.2f}–{hi:.2f})." if passed else
                             f"Not distinguishable from chance: AUC {auc:.2f} (95% CI {lo:.2f}–{hi:.2f}). "
                             "Scores are not shown.")},
        "weights": dict(zip(features, weights)), "signs": dict(zip(features, signs)),
        "intercept": round(float(w[0]), 3), "signals": per_signal,
        "crossCheck": {"outcome": "Switched to office-dominant Medicare billing (2022 → 2024)",
                       "positives": cross_pos, "n": len(ci_ok),
                       "auc": round(cross_auc, 3) if cross_auc is not None else None,
                       "aucCi": [round(v, 3) for v in auc_ci(cross_auc, cross_pos, len(ci_ok) - cross_pos)]
                       if cross_auc is not None and cross_pos else None},
        "caveats": [
            "The outcome is inferred from CMS billing-group listings and the independent-style rule, not confirmed moves.",
            "Mover counts swing from 12 to 56 depending on the window chosen, so some moves may be CMS listing artifacts.",
            "Employer disruption here uses CMS ownership-change records only; news before Oct 2022 was not searched.",
            "2024 work-RVU values are applied to 2022 billing; CMS no longer publishes the 2022 files.",
            "Open Payments 2021 is CMS's current copy, which includes corrections made after Oct 2022.",
        ],
    }


def load_backtest() -> dict | None:
    if not os.path.exists(CACHE):
        return None
    with open(CACHE) as f:
        return json.load(f)


if __name__ == "__main__":
    res = run()
    with open(CACHE, "w") as f:
        json.dump(res, f, indent=1)
    p, m = res["population"], res["metrics"]
    print(f"population {p['used']} used ({p['missingASignal']} missing a signal), {p['positives']} moved "
          f"({p['baseRate']:.1%})")
    print(f"out-of-fold AUC {m['auc']} (95% CI {m['aucCi'][0]}–{m['aucCi'][1]}); repeats {m['aucRepeats']}; top-k {m['topK']}")
    print(f"verdict: {res['verdict']['text']}")
    for s in res["signals"]:
        print(f"  {s['key']:<24} weight {s['weight']:>3}  coef {s['coef']:>7} CI {s['coefCi']}  "
              f"same sign {s['sameSignShare']:.0%}  alone AUC {s['auc']} {s['aucCi']}")
    print(f"cross-check (billing switch): {res['crossCheck']}")
