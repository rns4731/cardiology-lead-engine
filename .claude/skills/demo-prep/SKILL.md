---
name: demo-prep
description: Get the app and narrative ready for the case-study debrief — refresh data, run the full ladder and an adversarial review, launch the app, and rehearse a timed walkthrough with the likely hard questions. Use when the user mentions the debrief, demo, presentation, walkthrough, or "get it ready".
disable-model-invocation: true
---

# Demo prep (debrief with the executive panel)

## T-1 day
1. `.venv/bin/python -m engine.export_web --offline` — confirm the manifest shows both
   sources (Synthetic, Real data) available.
2. `/adversarial-review all` — no open S1/S2.
3. `scripts/smoke.sh` with the dev server up — every rung green; open the screenshots.
4. Confirm the numbers quoted in `docs/approach.md`, `README.md` and the landing page match
   the bundle (`test_seed42_metrics_locked`).
5. Deliverables sent ≥ 2 business days before the debrief: `docs/approach.md` + demo link
   or recording. Disclose AI tool use (Claude Code) — the brief asks for it.

## T-0 setup
```bash
docker compose up --build -d    # http://localhost:8080 — production build, no local toolchain
# or, for live edits: npm --prefix web run dev   (http://localhost:5190)
```
Close other tabs; zoom 100%; bundles already exported (no live network needed).

## Walkthrough (~12 min of the 60)
1. **Landing (2 min)** — the funnel; why identify + assemble; what was deliberately deferred.
2. **Model (2 min)** — explainable by design; weights are domain-set; timing as its own
   output. Click one signal → formula, source, honest standalone AUC.
3. **Validation (1 min)** — hidden outcome, lift@25 vs AUC; the weakest signals named.
4. **Dashboard (3 min)** — map → strongest cohort → "who would strengthen it".
5. **Cardiologist (2 min)** — why this score, why this window, cohorts they could join,
   colleagues/similar/complements.
6. **Toggle to Real data (2 min)** — real CMS records, nine of ten signals filled and
   labeled by provenance, nothing scored: what's knowable today without a real outcome. Why
   there's no "real names + simulated scores" mode: a fake score on a real person reads as fact.

## Hard questions to rehearse
- "How do you know the weights are right?" → they're priors; per-signal AUC shows which to
  revisit; learning waits for real outcomes (fitting to a simulated label is circular).
- "Is 0.62 AUC good?" → irreducible noise by design; the business metric is top-of-list
  lift and, ultimately, groups formed.
- "What breaks with real data?" → employer affiliation and behavioral signals need PECOS,
  Open Payments, utilization joins; contract timing only comes from conversations.
- "What would you build next, and how would you know it worked?" → contact verification +
  outreach loop; measure verified-contact rate, meeting rate, 5+ groups formed.
- "Why not an LLM?" → where it fits: drafting outreach, summarizing news triggers into the
  disruption signal; not for scoring that must be auditable.
