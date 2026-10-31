# Adversarial review — 2026-10-29 — full review (first pass)

## Scope
- Files: all — `engine/`, `web/src/`, `docs/approach.md`, `README.md`.
- Change brief: first review of the complete build — engine (scoring, timing, greedy cohort
  formation, insights, export, validator, NIH/NLM ingestion) and the multi-page React app with a
  synthetic/real toggle. All 12 invariants in scope.
- Baseline: `scripts/smoke.sh --fast` → green (41 pytest, 82 vitest, both bundles valid).
- Process: 4 red teams in parallel (correctness, data integrity, frontend, methodology) → judge.
  The judge agent was stopped before writing verdicts; the orchestrator judged instead by
  re-running every red-team repro (`scratchpad/review/judge/verify.py` + the red teams' scripts).
  Project agents were run as general-purpose agents loading their `.claude/agents/*.md`
  definitions (agents created mid-session aren't registered until restart).

## Summary
39 findings raised → 37 unique (D7 = C1; M8 merged into D1). **All 37 reproduced and confirmed;
none rejected.** One additional bug found during the re-attack (empty-frame crash).

| | S1 | S2 | S3 |
|---|---|---|---|
| Confirmed | 3 | 18 | 16 (+1 found in re-attack) |
| Plausible | 0 | 0 | 0 |
| Rejected | 0 | 0 | 0 |

## Confirmed findings — all fixed
Regression tests: engine `tests/test_review_2026_10_29.py` (26), web `web/src/test/review.test.tsx` (16).
Each failed before its fix (23 red / 2 control-green engine; 12 red / 1 control-green web).

| ID | Finding | Sev | Fix | Test / evidence |
|---|---|---|---|---|
| D1+M8 | Individual hidden outcomes recoverable from small-n / nested aggregates (5/5 recovered, incl. lead #1) | S1 | `insights.disclosure_control`: aggregates ≥20 leads, nested top-n sets ≥20 apart; precision@50 + small sweep cells withheld with reasons; `bundle_check` rule; UI prints "withheld" | `test_d1_*`, `M8/D1` web test; adapted attack recovers **0** in both bundles |
| M1 | Validation framed as independent; outcome shares the scorer's hypotheses | S1 | Copy rewritten everywhere ("tests the pipeline, not the hypotheses"); oracle ceiling (0.627) reported; random-holdout plan | `test_m1_oracle_*` |
| M2 | "Viable/formed" cohorts; only 1/7 would yield 5 movers | S1 | "Candidate" cohorts; slate math from the bundle (41% → ~3.2 founders; ~13 to approach) on landing + every cohort page; "beats" removed | `M2` web test |
| C1+D7 | Readiness shown 65.0 but bucket "Near" | S2 | truncate to 1 decimal and bucket from the shown value; UI `toFixed(1)` | `test_c1_*`; validator rule |
| C2 | Real profiles depended on API row order (1,081/1,086 changed on one drop) | S2 | per-identity `(seed,npi)` and per-metro RNG streams | `test_c2_*`; re-attack: **0/1,086** change |
| C3 | precision@k depended on input order under ties | S2 | deterministic `(score desc, npi asc)` ranking | `test_c3_*`; reversed input identical |
| C4 | Other cohorts' members listed as "eligible"; Δ for 9-member cohorts | S2 | `member_elsewhere` status; best-swap Δ for full cohorts (`mode`) | `test_c4_*`; columbus-oh-d: **0** |
| C5 | np.histogram float edges binned 0.6 one bin low | S2 | `bin_counts` integer binning | `test_c5_*`; econ 0.6–0.7 bin now 599 |
| D2 | Partial fetch overwrote complete cache silently | S2 | keep cache on partial fetch; `liveFailedQueries`; banner discloses failures | `test_d2_*`; re-attack cache 1087→1087 |
| D3 | 700 real physicians labeled "Noninvasive" with a Real badge | S2 | "General cardiology" everywhere (synthetic too; numbers unchanged) | `test_d3_*` |
| D4 | "Rocky Mountain Regional" = a real VA medical center, given simulated layoffs | S2 | placeholder names `{City} System A–C` (RNG unchanged) | `test_d4_*` (pattern, not denylist) |
| D5 | Real-mode outcome metrics unlabeled | S2 | "(simulated outcome)" on signals subtitle, signal page, dashboard signals chart | `D5` web test |
| D6 | Reasons stated simulated facts about real people | S2 | "Top reasons" card carries a Simulated pill in real mode | `D6` web test |
| M3 | Timing needs non-public data; "every field public" claim | S2 | `TIMING_SOURCES` provenance in bundle; UI marks relationship-data inputs; "public-only max 57" stated; doc claim corrected | `test_m3_*` |
| M4 | Timing windows unvalidated | S2 | stated on landing, dashboard "Act now", approach §3; pilot metric named | copy |
| M5 | Per-signal verdicts were sampling noise (flipped across seeds) | S2 | AUC 95% CI (Hanley–McNeil); verdict only if CI excludes 0.5; "inconclusive ≠ no effect"; effective units (employer/metro) shown | `test_m5_*`, `M5` web test |
| M6 | 2.24× quoted without uncertainty | S2 | lift 95% Wilson CI (1.36–3.20×) on landing/dashboard/signals; "≈2×" in docs; 50-seed range in approach | `test_m6_*` |
| M7 | Score read as probability | S2 | "Mean propensity score — a rank, not a probability" | copy |
| F1 | 54.8 displayed "55" yet "below the 55 floor"; readiness 64.9 shown "65" | S2 | `scoreInt` (never rounds up); gaps/readiness one decimal | `F1` web test; live: shows 54 |
| F2 | "Off vs on" for a 0.6/1.0 signal; null rate drawn as empty bar | S2 | `isBinary` = only end bins; null rows omitted with an explanation | `F2` web test; live verified |
| C6 | Top-4 reasons cut in weight order, not size | S3 | `reason_items` sorted by contribution; honest productivity/economics wording | `test_c6_*` |
| C7 | readyShare 0% when undefined | S3 | `null` | `test_c7_*`; validator rule |
| C8 | "Shared trigger" with one member | S3 | require ≥2 | `test_c8_*` |
| C9 | Cohort ids broke past 26 | S3 | bijective base-26 letters; unique-id validator rule | `test_c9_*` |
| C10 | Constant column manufactured similarity | S3 | `sd < 1e-9` guard | `test_c10_*`; 938 → 0 |
| D8 | Name suffixes dropped / garbled | S3 | suffix-aware `_parse_name`; `raw_name` cached; live re-fetch | `test_d8_*`; 49 → 0 garbled |
| D9 | Old-schema cache marked available; app didn't check | S3 | `_cached_entry` schema check; app rejects mismatched bundles | `test_d9_*` |
| D10 | `run.py --real` wrote the label next to real names | S3 | `write_outputs` drops evaluation columns for real | `test_d10_*` |
| M9 | "Likely to move together" for colleagues | S3 | "Same employer, ranked by score" (+ trigger only when present) | copy |
| F3 | Failed fetch sticky, error page had no links | S3 | Try again + links; auto-retry on navigation | live: recovers on nav |
| F4 | 4/5 nav links hidden at 400px | S3 | own row below md, wraps | live: 5/5 visible |
| F5 | First header click sorted the wrong way | S3 | natural directions; third click restores caller order | `F5` web test |
| F6 | Back always jumped to top | S3 | per-entry scroll save/restore after paint | live: 1015 → 1015 |
| F7 | Cohort-card bars color-only; location map lacked table twin | S3 | value legends; ChartFrame + table | live verified |
| F8 | Value text below AA contrast | S3 | slate-600 (Tailwind v4 slate-500 is only 4.1:1) | live: 7.58:1 |
| F9 | Real mode showed unmeasured subspecialties as 0 | S3 | bundle lists present subspecialties; UI uses them | `F9` web test |
| F10 | `?page=abc` broke the pager | S3 | `parsePage` | `F10` web test |
| RA1 | (re-attack) `contribution_matrix` crashed on an empty frame | S3 | explicit columns | `test_reattack_contribution_matrix_empty` |

## Re-attack (red teams' own exploits re-run against the fixes)
- D1 attack adapted to skip withheld cells (what a real attacker would do): **0 labels recovered**
  in synthetic and real (was 5/5).
- Correctness repros: C2 0/1,086 changed & cohorts 48/48 stable; C1 64.9→Near; C3 identical under
  reversal; C4 0; C9 no bad ids; C10 0.
- Frontend probes live in Chrome: three first-attempt fixes were **incomplete** and were redone —
  F4 (Signals still clipped → wrap), F8 (4.14:1 → slate-600, 7.58:1), F6 (browser restore clamps →
  app-managed restore), plus F3 retry-on-navigate.

## Residual risk
- Disclosure control proves top-n prefix sets and per-signal partitions are safe pairwise; it does
  not formally rule out every linear combination across many signal partitions. The red team's
  combined attack (prefixes + partitions + chained differences) recovers nothing. Outcome is
  simulated, so the exposure is to simulated statements.
- Secondary caption text uses slate-500 (≈4.1:1), below AA for small text; values were fixed.
- Map city labels render ≈7px at 400px width (viewBox scaling); the table twin carries the data.
- One `scripts/smoke.sh` run hung in vitest with idle workers; not reproducible in 3 reruns.
  `maxWorkers: 4` added as a guard, cause unconfirmed.
- Real-mode numbers changed with the per-identity RNG fix (expected; they are simulated).

## Verification
- `scripts/smoke.sh` → pytest **67 passed** · both bundles OK · typecheck OK · vitest **98 passed**
  · build OK · 13/13 pages clean in Chrome at 1440px **and** 400px (overflow guard added).
- Locked seed-42 metrics unchanged: AUC 0.621, lift@25 2.24×, base 19.7%; Streamlit golden output
  unchanged.
