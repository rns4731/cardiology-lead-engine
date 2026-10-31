---
name: add-signal
description: Add, remove, or reweight a propensity signal end to end — generator field with provenance, scoring factor and weight, plain-language reason, signal catalog entry, export, UI, and validation of the impact. Use when the user wants to change what drives the score or how much a signal counts.
argument-hint: "<signal key> [weight]"
---

# Add or change a signal

A signal touches six places. Miss one and either the score stops being explainable or a
page breaks. Work in this order.

## 1. Decide, in writing, before code
- **What real-world behavior** does it capture, and **which public dataset** would supply
  it in production (NPPES, PECOS, CMS utilization, Open Payments, news)? If none, it's
  relationship data — keep its weight small.
- **Transform to 0–1** (the factor). Weights are points; factor × weight ≤ weight.
- **New weights** for all signals — they must still sum to 100. Prefer taking points from
  signals with the weakest standalone AUC (see `/synthetic/signals`).

## 2. Engine
1. `engine/generate_data.py::_synth_row` — simulate the raw field and its normalized
   factor; update the module docstring's provenance table. **Do not** change RNG draw order
   for existing fields unless you accept that every number moves.
   - Decide whether the *latent* outcome should depend on it (the `logit`). Adding it there
     makes it genuinely predictive in the synthetic world; not adding it makes it a
     placebo — a useful honesty test, but say which you did.
2. `engine/scoring.py` — add to `WEIGHTS` (rebalance to 100), `contributions()` factor map,
   `FACTOR_LABELS`, and a reason branch in `_reasons()` that fires at `REASON_FLOOR`.
3. `engine/signals.py` — catalog entry: `rationale`, `formula` (must match the code
   exactly), `source`, `public`. The module asserts the catalog covers exactly `WEIGHTS`.

## 3. Tests & locks
- `.venv/bin/python -m pytest` — `test_weights_sum_to_100`, contribution-sum and
  bound tests cover the new signal automatically.
- If the seed-42 numbers move, `test_seed42_metrics_locked` and `test_build_groups_golden`
  fail **on purpose**: confirm the new numbers are intended, update those tests, then update
  every place that quotes them — `README.md`, `docs/approach.md`, `.claude/CLAUDE.md`
  (invariant 8). Never loosen the tolerance to dodge this.

## 4. Data + UI
- `/export-data` (offline is fine). `bundle_check` verifies contribution keys = weights.
- The web app is data-driven: the signal appears on the dashboard bar list, signals index,
  its own `/signals/<key>` page, and every cardiologist's "Why this score" with no TS change.
  Only touch `types.ts` if you added a new *per-lead attribute* to display.
- `npm --prefix web test` — the route test visits every signal page.

## 5. Report the impact
State before → after: AUC, lift@25, base rate, cohorts formed, the new signal's standalone
AUC and move-rate lift, and which cardiologists' ranks moved most. A signal with standalone
AUC ≈ 0.5 adds nothing on its own — say so.
