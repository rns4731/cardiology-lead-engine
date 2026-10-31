"""Honest evaluation of the scorer against the hidden ground-truth label.

The brief asks "how would you know it's working." Because the synthetic generator
embeds `will_move_24mo` from the true drivers + noise, and the scorer only sees
observable features, these numbers are a real (if simulated) read on quality.

Metrics:
  * coverage        -- share of the universe that gets a score (actionability)
  * base_rate       -- underlying move rate
  * precision@K     -- of the top-K leads, share that actually move (what outreach feels)
  * lift@K          -- precision@K / base_rate (how much better than random targeting)
  * AUC             -- rank quality across the whole list
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def _auc(labels: np.ndarray, scores: np.ndarray) -> float:
    ranks = pd.Series(scores).rank(method="average").values
    n_pos = labels.sum()
    n_neg = len(labels) - n_pos
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    return float((ranks[labels == 1].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))


def _ranked(scored: pd.DataFrame) -> pd.DataFrame:
    """Propensity desc, npi asc: ties at a top-k cut break the same way every time."""
    return scored.sort_values(["propensity_score", "npi"], ascending=[False, True], kind="stable")


def precision_at_k(scored: pd.DataFrame, k: int, label: str = "will_move_24mo") -> float:
    return float(_ranked(scored).head(k)[label].mean())


def wilson(hits: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson interval for a proportion."""
    if n == 0:
        return (float("nan"), float("nan"))
    p = hits / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (float(c - h), float(c + h))


def auc_ci(auc: float, n_pos: int, n_neg: int, z: float = 1.96) -> tuple[float, float]:
    """95% interval for an AUC (Hanley & McNeil 1982 standard error)."""
    q1, q2 = auc / (2 - auc), 2 * auc * auc / (1 + auc)
    se = np.sqrt((auc * (1 - auc) + (n_pos - 1) * (q1 - auc * auc)
                  + (n_neg - 1) * (q2 - auc * auc)) / (n_pos * n_neg))
    return (float(auc - z * se), float(auc + z * se))


def evaluate(scored: pd.DataFrame, label: str = "will_move_24mo", ks=(25, 50, 100, 200)) -> dict:
    labels = scored[label].values
    scores = scored["propensity_score"].values
    base = float(labels.mean())
    out = {
        "n": len(scored),
        "coverage": float((scored["propensity_score"].notna()).mean()),
        "base_rate": base,
        "auc": round(_auc(labels, scores), 3),
    }
    if "latent_signal" in scored:  # noise-free oracle: the ceiling any ranker could reach
        out["oracle_auc"] = round(_auc(labels, scored["latent_signal"].values), 3)
    ranked = _ranked(scored)
    for k in ks:
        if k <= len(scored):
            hits = int(ranked.head(k)[label].sum())
            p = hits / k
            out[f"precision@{k}"] = round(p, 3)
            out[f"lift@{k}"] = round(p / base, 2) if base else float("nan")
            lo, hi = wilson(hits, k)
            out[f"lift_ci@{k}"] = (round(lo / base, 2), round(hi / base, 2)) if base else None
    return out


def format_report(metrics: dict) -> str:
    lines = ["Evaluation (scorer vs. hidden will_move_24mo label)", "-" * 52]
    lines.append(f"  universe size     : {metrics['n']}")
    lines.append(f"  coverage          : {metrics['coverage']:.0%}")
    lines.append(f"  base move rate    : {metrics['base_rate']:.1%}")
    lines.append(f"  AUC               : {metrics['auc']}")
    for k in (25, 50, 100, 200):
        pk, lk = f"precision@{k}", f"lift@{k}"
        if pk in metrics:
            lines.append(f"  precision@{k:<4}    : {metrics[pk]:.1%}   (lift {metrics[lk]}x)")
    return "\n".join(lines)


if __name__ == "__main__":
    from engine.generate_data import generate
    from engine.scoring import score_frame

    s = score_frame(generate())
    print(format_report(evaluate(s)))
