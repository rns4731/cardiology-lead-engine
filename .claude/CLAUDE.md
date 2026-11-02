# CLAUDE.md — Independent-Cardiology Lead Engine

Prototype for the growth team of a cardiology platform that partners with cardiologists who want to
practice independently: find hospital-employed
cardiologists likely to go independent, **when** their window opens, and how they
cluster into viable founding groups of 5+. Built for a Principal AI Engineer case
exercise — the audience is an executive, so correctness *and* honesty of every number
matter more than feature count.

## Architecture

```
engine/ (Python, numpy+pandas)          web/ (React 18 + TS + Vite + Tailwind v4)
  generate_data.py  synthetic universe    src/lib/data.tsx    fetch + cache bundles, index
  real_data.py      Real data bundle      src/lib/paths.ts    every URL; source in the path
  real_signals.py   10 signals from real records, labeled exact/stand-in/inferred/assumption
  backtest.py       fit + held-out test on real history (scores only if it beats chance)
  public_fetch.py, cms_directory.py, open_payments.py, wrvu.py   real inputs -> data/cache/
  news/             Claude news pipeline: llm, extract (verify), fake (fictional), real_news
  scoring.py        propensity + timing   src/pages/*         one page per entity type
  signals.py        signal catalog        src/pages/real/     Real data pages (own layout)
  clustering.py     cohort formation      src/components/     links, charts, LeadTable
  insights.py       rollups/related/fit   src/test/           routes, crawler, lib tests
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
`/:source/{dashboard,locations[/:slug],systems/:slug,cardiologists[/:npi],groups[/:id],signals[/:key],news}`
with `source ∈ {synthetic, public}` (`public` = Real data, its own layout and pages); `/` is the
methodology landing page.

## Commands

The app runs and is tested in Docker; there is no project venv.

```bash
docker compose up --build -d                        # build, export, load, serve: :8080 (rerun after any code change)
docker compose --profile test run --rm tests        # engine tests (84), against the exported bundles
docker compose run --rm --no-deps exporter python -m engine.bundle_check   # validate the bundles
docker compose logs exporter loader                 # what the one-shot jobs did
docker compose exec db psql -U leads leads          # query the Postgres store
docker compose run --rm exporter python -m engine.export_web   # re-pull CMS Medicare utilization (network) ...
docker compose run --rm loader                      # ... then store it; the api serves the newest export
docker compose down                                 # stop (-v drops the data volumes)
```

Host-only (any Python 3.12+ with `requirements.txt`; Node 20+). These can't run in Docker
because they write to `data/cache/` or the repo (the image holds a copy of `data/`), need a real
browser, or need `.env`. After changing `data/cache/`, rerun `docker compose up --build -d`.

```bash
npm --prefix web run typecheck && npm --prefix web test   # TS + vitest (62)
npm --prefix web run dev                            # http://localhost:5190 (reads web/public/data)
node web/scripts/screenshots.mjs                    # visual QA in real Chrome (dev server up)
scripts/smoke.sh                                    # the whole ladder (PY=... to pick a Python)
python -m engine.export_web --offline               # write bundles to web/public/data for the dev server
python -m engine.backtest                           # back-test + fit -> data/cache/backtest.json
python -m engine.news.real_news                     # real news via Claude (network + .env key); cached
python -m engine.news.fake                          # fictional articles for Synthetic (Claude); cached
alembic revision --autogenerate -m "..."            # after changing engine/db/models.py (db on :5432)
```

The full refresh of the real inputs (CMS directory downloads, Open Payments, work RVUs) is in the
README under *Refreshing the real inputs*.

Docker layout: root `Dockerfile` (targets `engine`, `legacy`), `web/Dockerfile` (node build →
nginx), `web/nginx.conf` (SPA fallback; `/data/*` proxied to the api, never HTML), `docker-compose.yml`
(exporter writes bundles to the `bundles` volume → loader stores them in Postgres → api serves the
newest export). Bundles are not baked into the web image. `.env` and `data/raw/` never enter an image.

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
   signal labeled by provenance (exact, stand-in, inferred, assumption, none); nothing is imputed.
   It shows scores only when `engine/backtest.py` beat chance on held-out doctors, and always next
   to the back-test's warnings (inferred outcome, failed cross-check). A mode that overlaid simulated signals on
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
13. **News is evidence, not opinion.** An extracted event counts only if Claude's quote is in
    the article word for word, it's reported as fact, it's in the signal's definition and within
    36 months (a year named in the quote overrides the claimed date). Article text never ships;
    the app gets link, headline, quote. Fictional articles name only placeholder systems.
14. **No look-ahead in the back-test.** Every input must predate its prediction date (CMS
    snapshot, billing year, Open Payments year, news). The pass rule is fixed before running.
15. **The Claude key lives only in `.env`** (git- and docker-ignored); never in code, caches,
    bundles or commits (`test_no_api_key_in_any_published_or_cached_file`).

## Conventions

- Python: module docstring says *why*; constants UPPER_CASE at top; pure functions over
  DataFrames; `slugify` from `engine.clustering` for every id; no new deps without reason.
- TS: strict; pages read data only via `useData()` (Real data pages: `useRealData()`); every entity name renders through
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
- Network calls (Docker builds and runs, live export, npm installs, Claude API) need the sandbox disabled in this env.
- `np.histogram` float edges put exact values like 0.6 in the bin below — use `bin_counts`.
- `toFixed(0)` rounds 54.8 to "55" and 64.9 to "65": next to a 55 floor or a 65 cutoff that
  contradicts the label. Use `scoreInt` / one decimal.
- Project agents in `.claude/agents/` load at session start; mid-session they can be run as
  general-purpose agents that read their definition file first.
- data.cms.gov/provider-data and openpaymentsdata.cms.gov refuse non-browser clients (403); the
  same files download fine in real Chrome (`scripts/download_cms.cjs`). download.cms.gov and the
  data.cms.gov data-api answer plain HTTP.
- Doctors & Clinicians layouts differ by vintage: 2019 is `Physician_Compare_National_Downloadable_File`,
  2020 is `mj5m-pzi6.csv`, and up to 2022 hospital affiliations are inline (`hosp_afl_1..5`).
- Google News RSS links only resolve to the publisher inside a browser (`scripts/fetch_pages.cjs`).
- Claude dated old events by the article's date ("acquired in 2019" → 2025) and counted
  power-outage closures until the prompt and the quote-year check were added (`extract-v2`).
  A declined article is recorded as unread; it must never crash the run.

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
