"""End-to-end run: generate -> score -> evaluate -> assemble groups.

Usage:
    python run.py                 # default 1200-cardiologist universe
    python run.py --n 2000 --min-score 60 --top 15
Writes ranked leads and group candidates to ./outputs/.
"""
from __future__ import annotations

import argparse
import os

import pandas as pd

from engine.clustering import build_groups
from engine.evaluate import evaluate, format_report
from engine.generate_data import generate
from engine.scoring import score_frame

OUT_DIR = os.path.join(os.path.dirname(__file__), "outputs")


def write_outputs(scored: pd.DataFrame, out_dir: str, real: bool) -> None:
    """Scored leads CSV. Evaluation-only columns never sit next to real identities."""
    os.makedirs(out_dir, exist_ok=True)
    hidden = ["will_move_24mo", "latent_signal"] if real else []
    scored.drop(columns=[c for c in hidden if c in scored]).to_csv(
        os.path.join(out_dir, "leads_scored.csv"), index=False)


def main() -> None:
    ap = argparse.ArgumentParser(description="Independent-cardiology lead engine")
    ap.add_argument("--n", type=int, default=1200, help="universe size")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--min-score", type=int, default=55, help="propensity floor for group members")
    ap.add_argument("--top", type=int, default=10, help="top leads to print")
    ap.add_argument("--real", action="store_true",
                    help="pull REAL cardiologist identities from the public NPPES API "
                         "(falls back to synthetic if offline)")
    ap.add_argument("--per-metro", type=int, default=40, help="real identities per metro (--real)")
    args = ap.parse_args()

    pd.set_option("display.max_colwidth", 60)
    os.makedirs(OUT_DIR, exist_ok=True)

    if args.real:
        print("1/4  fetching REAL cardiologist identities (NIH/NLM, then CMS NPPES) ...")
        df = None
        try:
            from engine.nppes_nlm import load_real_universe as nlm_universe
            df = nlm_universe(seed=args.seed)
        except Exception as e:
            print(f"     NIH/NLM unreachable ({type(e).__name__}); trying CMS NPPES")
            try:
                from engine.nppes import load_real_universe
                df = load_real_universe(per_metro=args.per_metro, seed=args.seed)
            except Exception as e2:
                print(f"     CMS NPPES unreachable ({type(e2).__name__}); falling back to synthetic")
        if df is None:
            df = generate(n=args.n, seed=args.seed)
        else:
            print(f"     got {len(df)} real identities + simulated behavioral overlay")
    else:
        print("1/4  generating synthetic cardiologist universe ...")
        df = generate(n=args.n, seed=args.seed)

    print("2/4  scoring propensity + timing ...")
    scored = score_frame(df)

    print("3/4  evaluating against hidden label ...\n")
    print(format_report(evaluate(scored)))

    print("\n4/4  assembling viable groups (5+ cardiologists) ...\n")
    summary, members = build_groups(scored, min_score=args.min_score)

    print("=" * 70)
    print(f"TOP {args.top} LEADS")
    print("=" * 70)
    cols = ["name", "metro", "subspecialty", "propensity_score", "timing_bucket", "top_reasons"]
    print(scored[cols].head(args.top).to_string(index=False))

    print("\n" + "=" * 70)
    print("GROUP CANDIDATES (ranked by viability)")
    print("=" * 70)
    if summary.empty:
        print("No metro cleared the 5-cardiologist minimum at this threshold.")
    else:
        print(summary.to_string(index=False))
        best = summary.iloc[0]["metro"]
        print(f"\nFounding cohort -- {best}:")
        print(members[best].to_string(index=False))

    # persist
    write_outputs(scored, OUT_DIR, real=args.real)
    if not summary.empty:
        summary.to_csv(os.path.join(OUT_DIR, "group_candidates.csv"), index=False)
        pd.concat(
            [m.assign(metro=k) for k, m in members.items()], ignore_index=True
        ).to_csv(os.path.join(OUT_DIR, "group_members.csv"), index=False)
    print(f"\nWrote CSVs to {OUT_DIR}/")


if __name__ == "__main__":
    main()
