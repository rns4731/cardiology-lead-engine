---
name: run-tests
description: The test ladder for this repo — engine unit tests, bundle rebuild + contract validation, TypeScript typecheck, vitest (units, every route for both data sources, a link crawler), production build, and visual QA in real Chrome. Use before calling any change done, after an engine or UI edit, or when the user asks to test, verify, or check the app.
argument-hint: "[--fast]"
---

# Run the tests

```bash
scripts/smoke.sh          # full ladder
scripts/smoke.sh --fast   # skip build + screenshots (inner loop)
```

The ladder runs cheapest-first and stops at the first red rung. Know what each proves so
a green run means something:

| # | Rung | Command | Proves | Typical failure → where to look |
|---|---|---|---|---|
| 1 | Engine unit | `.venv/bin/python -m pytest` | scoring arithmetic, timing cutoffs, label independence, cohort bounds/disjointness/determinism, related/candidate rules, locked seed-42 metrics, one regression per review finding (66) | `test_seed42_metrics_locked` → you changed numbers; intentional? update docs |
| 2 | Rebuild | `python -m engine.export_web --offline` | the current engine produces bundles (real rebuilt from `data/cache/real_identities.json`) | exporter raises `bundle failed validation` → rung 3 explains |
| 3 | Contract | `python -m engine.bundle_check` | referential integrity across leads/groups/metros/systems/signals, no NaN, no label leak, contributions sum to score | a new field the UI dereferences isn't validated → add a rule |
| 4 | Typecheck | `npm --prefix web run typecheck` | `types.ts` and every page agree | shape changed in Python but not in `types.ts` |
| 5 | Web tests | `npm --prefix web test` | lib units; **every page type renders for every exported source** with real ids; not-found paths; **link crawl** from the dashboard reaches all 10 page types with no dead ends (98) | `crawl.test.tsx` → a link points somewhere that 404s |
| 6 | Build | `npm --prefix web run build` | production bundle compiles | — |
| 7 | Visual | `node web/scripts/screenshots.mjs` (dev server up) | 13 pages load in real Chrome with zero console errors and no error boundary; PNGs in `outputs/screens/` | then **look at them** — rung 8 |
| 8 | Eyes | `qa-checklist.md` | what automation can't judge: overlap, truncation, misleading charts, honesty copy | — |

## Rules

- Run rung 1–5 after every meaningful change; the full ladder before a review or demo.
- Real-data rungs skip gracefully when the real bundle doesn't exist; say so in your report
  rather than implying it was tested.
- Network is needed only to *refresh* real identities (`python -m engine.export_web` without
  `--offline`); it requires the sandbox disabled here.
- Rung 7 needs the dev server: `npm --prefix web run dev` (port 5190). For phone width:
  `WIDTH=400 node web/scripts/screenshots.mjs`.
- After screenshots, actually open the PNGs (Read tool) and walk `qa-checklist.md`. Passing
  tests have shipped overlapping map labels and a precision line that plotted missing
  values as 0% — both were caught only by looking.
- Report results faithfully: totals per rung, anything skipped and why.

## Adding tests

Use the `test-engineer` agent or follow its rules: red before green, right layer, minimal
deterministic inputs, assert the user-visible consequence.
