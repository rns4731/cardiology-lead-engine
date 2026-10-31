# Adversarial review rubric

## 1. Severity

| Sev | Meaning | Examples in this repo |
|---|---|---|
| **S1 — blocks the demo** | A wrong or misleading number an executive would see; a crash; a dead end; data leakage; a false claim about a real person or organization | per-lead label exposed; lift computed on the wrong base; real-mode page without the simulated banner; cohort member below the floor; page throws on a valid id |
| **S2 — wrong but contained** | Incorrect behavior in an edge case or secondary view; a contract drift that hasn't bitten yet | histogram drops edge bins; sort order lost; switch-source lands on a 404; NaN for a metro with 0 qualified |
| **S3 — quality** | Maintainability, clarity, polish, perf that doesn't change numbers | duplicate logic; truncated label; slow export; missing table twin |

Severity is about **impact on what a reader concludes**, not code size.

## 2. Invariants every reviewer checks (from `.claude/CLAUDE.md`)

1. Hidden label `will_move_24mo` never read by the scorer, never per-lead in a bundle.
2. Business logic only in `engine/`; the browser renders.
3. `sum(contributions) == propensity`; weights sum to 100; viability = Σ component × weight.
4. Bundle contract: `types.ts` ⇄ `export_web.py` ⇄ `bundle_check.py`; identifier keys keep
   engine spelling; shape change ⇒ `SCHEMA_VERSION` bump.
5. Exporter validates before writing.
6. Hospital systems fictional; `METROS` list lengths stable.
7. Real mode: only NPI/name/location/subspecialty real; banner + provenance badges present.
8. Seed-42 locked metrics unchanged unless intentionally re-baselined with docs updated.
9. Missing/small-n values never plotted as 0; every chart has a table twin and a legend
   for ≥2 series; text never in series colors; palettes validated.
10. No PHI.

## 3. Finding format (red teams must use exactly this)

```
### <short title>
- Lens: correctness | data-integrity | frontend | methodology
- Location: path/to/file.py:123 (and any others)
- Invariant: #n or "none"
- Claim: one sentence — what is wrong.
- Failure scenario: concrete input/state → observed wrong output.
- Repro: a command, test snippet, or URL + clicks that shows it. Required.
- Suggested severity: S1 | S2 | S3
- Suggested fix (optional): one or two lines.
```

## 4. Judge verdicts

- **CONFIRMED** — the judge ran the repro (or an equivalent) and saw the failure. Include
  the evidence (command + output excerpt).
- **PLAUSIBLE** — mechanism is real but the judge couldn't trigger it with current data
  (e.g. needs a metro with 0 leads). Keep; prefer a synthetic test that triggers it.
- **REJECTED** — repro doesn't fail, the claim misreads the code, it duplicates another
  finding, or it contradicts a deliberate documented decision (cite where).

## 5. Known-deliberate decisions (not findings)

- Modest AUC (~0.62) with strong top-of-list lift — by design (noise term).
- Weights are domain-set, not fitted — learning them on a simulated label would be circular.
- Real mode lacks Imaging / Advanced Heart Failure — NLM taxonomy gap, documented.
- Cohorts can leave a "bench" of qualified-but-unplaced cardiologists.
- `build_groups` (top-N per metro) coexists with `form_cohorts` for the Streamlit app.
- Precision@50 and small sweep cells are **withheld** by disclosure control — not a bug.
- Most single-signal AUCs are "inconclusive at this sample size" — reported honestly, by design.
