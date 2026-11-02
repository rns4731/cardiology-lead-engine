# CLAUDE.md — Independent-Cardiology Lead Engine

Prototype for a PE-backed cardiology platform's growth team: find hospital-employed
cardiologists likely to go independent, **when** their window opens, and how they
cluster into viable founding groups of 5+. Built for a Principal AI Engineer case
exercise — the audience is an executive, so correctness *and* honesty of every number
matter more than feature count.

## Architecture

```
engine/ (Python, numpy+pandas)          web/ (React 18 + TS + Vite + Tailwind v4)
  generate_data.py  synthetic universe    src/lib/data.tsx    fetch + cache bundles, index
  real_data.py      Real data (CMS)       src/lib/paths.ts    every URL; source in the path
  scoring.py        propensity + timing   src/pages/*         one page per entity type
  signals.py        signal catalog        src/components/     links, charts, LeadTable
  clustering.py     cohort formation      src/test/           routes, crawler, lib tests
  insights.py       rollups/related/fit
  evaluate.py       precision/lift/AUC    web/public/data/<source>/bundle.json  ← the contract
  export_web.py     → bundles + manifest  web/public/data/manifest.json
  bundle_check.py   contract validator
  db/               Postgres store: models.py, load.py, read.py, serve.py, migrations/
run.py, app.py (Streamlit — legacy demo, leave as is), tests/ (pytest)
```

Postgres is the engine's system of record (raw pulls + every export run + outreach outcomes);
`engine.db.load` stores what the engine already wrote. In Docker the app is served from it:
nginx proxies `/data/*` to `engine.db.serve`, which returns each source's current export in
the bundle format (the Vite dev server still reads `web/public/data`).
Change `engine/db/models.py` ⇒ add an Alembic revision (`test_models_match_the_migrations`).
See docs/database.md.

Data flows one way: **engine computes everything → JSON bundle → web renders**. Routes are
`/:source/{dashboard,locations[/:slug],systems/:slug,cardiologists[/:npi],groups[/:id],signals[/:key]}`
with `source ∈ {synthetic, public}` (`public` = Real data, its own layout and pages); `/` is the
methodology landing page.

## Commands

```bash
.venv/bin/python -m pytest                          # engine tests (82)
.venv/bin/python -m engine.export_web               # rebuild both bundles (Real data re-pulls CMS: network)
.venv/bin/python -m engine.export_web --offline     # rebuild; Real data from the cached CMS pulls
.venv/bin/python -m engine.bundle_check             # validate bundles on disk
npm --prefix web run typecheck && npm --prefix web test   # TS + vitest (62)
npm --prefix web run dev                            # http://localhost:5190
node web/scripts/screenshots.mjs                    # visual QA in real Chrome (dev server up)
scripts/smoke.sh                                    # the whole ladder, in order
docker compose up --build -d                        # containerized: exporter -> nginx on :8080
docker compose --profile test run --rm tests        # engine suite inside the image
docker compose up -d db && .venv/bin/alembic upgrade head   # Postgres + schema
.venv/bin/python -m engine.db.load                  # store raw pulls + bundles (idempotent)
.venv/bin/alembic revision --autogenerate -m "..."  # after changing engine/db/models.py
```

Docker layout: root `Dockerfile` (targets `engine`, `legacy`), `web/Dockerfile` (node build →
nginx), `web/nginx.conf` (SPA fallback, but `/data/*` must 404 — never HTML), `docker-compose.yml`
(named volume `bundles` shared exporter → web). Bundles are not baked into the web image.

## Invariants — never break these silently

1. **The hidden label never leaves the engine** except as aggregates. The scorer never reads
   `will_move_24mo`; no per-lead field exposes it (`test_scorer_never_reads_the_label`,
   `bundle_check`). Breaking this turns validation into leakage.
2. **One source of truth for logic.** Scoring, viability, cohorts, related, candidate fit
   all live in `engine/`. The browser renders; it never re-implements business math.
3. **Explainable by construction.** `sum(contributions) == propensity` (±0.11 rounding);
   weights sum to 100; each viability component × weight sums to the cohort score.
4. **The bundle contract.** `web/src/types.ts` mirrors `engine/export_web.py`. Field names
   are camelCase; **identifier keys keep engine spelling** (`contributions.career_stage`,
   `meta.weights`, `timingParts`, `components`) — see `ID_KEYED`. Change the shape ⇒ bump
   `SCHEMA_VERSION`, update `types.ts`, `bundle_check.py`, and re-export.
5. **Exporter refuses invalid bundles** (`bundle_check.validate` runs inside `_write`).
6. **Hospital systems use placeholder names** (`{City} System A`). Simulated distress events
   must never attach to anything mistakable for a real organization
   (`test_d4_system_names_unmistakably_fictional`). Keep counts stable — they drive RNG draws.
7. **Never put real names on simulated data.** Real data mode shows real records only, each
   signal labeled by provenance, and scores nothing. A mode that overlaid simulated signals on
   real NPI-registry identities was removed (`test_no_real_identities_on_simulated_signals`):
   a simulated score next to a real physician reads as a fact about them. Never relabel a
   provider into a subspecialty they don't hold.
8. **Seed-42 numbers are locked** (`test_seed42_metrics_locked`, `test_build_groups_golden`):
   AUC 0.621 (oracle ceiling 0.627), lift@25 2.24× (95% CI 1.36–3.20), base rate 19.7%. If they
   move, update docs/approach.md, README and the landing copy.
9. **Data honesty in charts.** Missing/withheld values are omitted and labeled, never plotted
   as 0; every chart has a table twin; text never wears series colors; displayed numbers never
   round across a cutoff (`scoreInt`, truncated readiness).
10. **No PHI, ever.** Public CMS / directory data or synthetic only.
11. **Disclosure control.** Outcome aggregates cover ≥ `MIN_N` (20) leads, and published
    top-n figures are ≥ 20 apart (`insights.disclosure_control`, enforced by `bundle_check`).
12. **Claims match evidence.** The simulated outcome shares the scorer's hypotheses: copy may
    say it tests the pipeline, never that it validates the hypotheses. Cohorts are
    "candidate" slates; single-signal verdicts need a 95% interval that excludes 0.5.

## Conventions

- Python: module docstring says *why*; constants UPPER_CASE at top; pure functions over
  DataFrames; `slugify` from `engine.clustering` for every id; no new deps without reason.
- TS: strict; pages read data only via `useData()`; every entity name renders through
  `components/links.tsx` (that's what makes everything drill-downable); URLs only via
  `lib/paths.ts`; filters live in the URL so they're shareable.
- Design: `.claude/skills/design-system/SKILL.md` (tokens, validated palettes, chart rules).

## Gotchas learned the hard way

- Python ≥3.12 `sum()` on floats is *compensated* — differs from sequential `+=` in the last
  bit and can flip a `round()` or a bucket boundary. `scoring._timing` accumulates with `+=`.
- `camel()` once renamed signal ids (`career_stage`→`careerStage`) and broke every lookup;
  the validator caught it. Identifier dicts are listed in `ID_KEYED`.
- `useAsync` results are tagged with their path; otherwise a source switch briefly serves the
  previous source's data under the new URLs.
- `useParams()` in a parent layout route can't see child params — the nav parses the path.
- `LeadTable` resets pagination on a content *signature*, not array identity.
- jsdom: `import.meta.url` isn't `file:` — tests resolve from `process.cwd()`.
- Network calls (live export, npm/pip install) need the sandbox disabled in this env.
- `np.histogram` float edges put exact values like 0.6 in the bin below — use `bin_counts`.
- `toFixed(0)` rounds 54.8 to "55" and 64.9 to "65": next to a 55 floor or a 65 cutoff that
  contradicts the label. Use `scoreInt` / one decimal.
- Project agents in `.claude/agents/` load at session start; mid-session they can be run as
  general-purpose agents that read their definition file first.

## Workflows (skills & agents in this folder)

| When | Use |
|---|---|
| Change or add a scoring signal | `/add-signal` |
| Regenerate data after any engine change | `/export-data` |
| Add a page / entity to the app | `/add-page` |
| Any UI or chart work | `/design-system` |
| Before calling work done | `/run-tests` |
| Before merging anything non-trivial | `/adversarial-review` (red-team agents → judge → fix) |
| Before the debrief | `/demo-prep` |

Agents: `red-team-correctness`, `red-team-data-integrity`, `red-team-frontend`,
`red-team-methodology`, `review-judge`, `test-engineer` — orchestrated by `/adversarial-review`.
