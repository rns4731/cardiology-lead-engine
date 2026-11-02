# Independent-Cardiology Lead Engine

A prototype for a PE-backed cardiology platform's growth team: **find which
hospital-employed cardiologists are likely to move to independent practice, when their
window opens, and how they cluster into viable founding groups of 5+** — every score
explained, every number drill-downable.

The approach, scope decisions, results and trade-offs are in
[`docs/approach.md`](docs/approach.md).

## Quickstart

Everything runs in Docker; nothing else to install.

```bash
docker compose up --build -d      # export -> Postgres -> api -> nginx
open http://localhost:8080
```

| Service | What it does |
|---|---|
| `db` | Postgres 17 — the engine's system of record (`localhost:5432`, user/db `leads`) |
| `migrate` | one-shot `alembic upgrade head`: creates / migrates the tables |
| `exporter` | one-shot Python engine: builds the Synthetic and Real data bundles into a shared volume (offline, from the committed caches in `data/cache/`) |
| `loader` | one-shot: stores the cached public pulls and every bundle in Postgres (idempotent) |
| `api` | serves `/data/manifest.json` and `/data/<source>/bundle.json` from Postgres (each source's newest export) |
| `web` | nginx serving the production React build; proxies `/data/*` to the api; healthy once `/data/manifest.json` is served from Postgres |
| `tests` *(profile)* | the engine test suite inside the image, against the exported bundles |
| `streamlit` *(profile)* | `docker compose --profile legacy up -d` — the original demo on :8501 |

Everyday commands:

```bash
docker compose up --build -d                    # after any code change: rebuild, re-export, reload
docker compose --profile test run --rm tests    # engine tests (all 84)
docker compose logs exporter loader             # what the one-shot jobs did
docker compose exec db psql -U leads leads      # query the Postgres store (docs/database.md)
docker compose down                             # stop (add -v to drop the data volumes)
```

Bundles and the compact caches of every real input (`data/cache/`) are committed, so the app
builds from a fresh clone without network. To re-pull the CMS Medicare utilization records
(network, ~2 h): `docker compose run --rm exporter python -m engine.export_web`, then
`docker compose run --rm loader`; the api serves the newest stored export, no restart needed.
The other real inputs (CMS Doctors & Clinicians snapshots, Open Payments, news) can't be
refreshed inside Docker; see *Refreshing the real inputs*.

## What's inside

| | |
|---|---|
| **Methodology** (`/`) | the funnel, scope, the ten signals, timing, cohort viability, honest validation |
| **Dashboard** (`/:source/dashboard`) | Synthetic: KPIs, US map, strongest cohorts, act-now list, timing & subspecialty mix, threshold sensitivity, signals. Real data: counts, signal coverage, the back-test and its warnings. Plus the **Real data / Synthetic** toggle |
| **Locations**, **Hospital systems** | per-metro and per-employer pages (hospital systems exist only in Synthetic; real employers aren't known) |
| **Cohorts** | Synthetic: viability breakdown, members, and who would strengthen the cohort (Δ viability). Real data: none formed |
| **Cardiologists** | URL-filterable directory. Synthetic: why this score, why this window, cohorts, related colleagues. Real data: the record behind every signal value, billing group, hospitals, news evidence, back-test score |
| **Signals** | how each signal is computed, where the data comes from, and whether it predicts (Real data: provenance label, coverage, fitted weight) |
| **News** | every article the news pipeline read and what Claude extracted: fictional articles with extraction accuracy (Synthetic), real articles with links and verbatim quotes (Real data) |

**Data modes.** *Synthetic*: 1,200 simulated cardiologists with a hidden 24-month outcome
the scorer never sees — it tests the pipeline (top-25 move rate 44% vs 19.7% base →
**≈2× lift**, 2.24×, 95% CI 1.4–3.2×; AUC 0.621 vs a best achievable 0.627). Because that outcome
is simulated from the model's own hypotheses, it can't validate the hypotheses — only real
outcomes can. Hospital systems are placeholders. No PHI. There is deliberately no mode that
puts real names on simulated signals: a simulated score next to a real physician reads as a
fact about them.

*Real data*: real public records only, nothing simulated. 205 cardiologists in the eight
cities whose 2024 Medicare billing is at most 20% in office settings (CMS Medicare Physician &
Other Practitioners) — "hospital-based" is **inferred** from billing setting, not employment.
Same ten signals and 0–1 formulas as Synthetic, each filled from a real record and labeled by how
directly it measures the signal:

| Signal | Real record | Label |
|---|---|---|
| Employer disruption | CMS hospital change-of-ownership + news read by Claude, for the billing group / affiliated hospitals | stand-in (group/affiliation ≈ employer) |
| Career stage | graduation year (CMS Doctors & Clinicians) | stand-in (not years in practice) |
| Prior independent | billing-group history, Oct 2019 → Oct 2026 snapshots | inferred ("independent-style" rule) |
| Subspecialty economics | Medicare provider type + the fixed lookup | assumption (lookup values) |
| Productivity | Medicare services × CMS work RVUs, 2024 percentile | stand-in (Medicare only) |
| Peer recently left | year-earlier group colleagues now in an independent-style group | inferred |
| Independent density | independent-style cardiology groups billing from the city | inferred |
| Recent employer change | first appearance in a new billing group | stand-in (billing group, not employer) |
| Contract window | — no public source | empty |
| Industry engagement | CMS Open Payments general payments, 2025 | real (exact) |

**Back-test and fit** (`engine/backtest.py`). Signals rebuilt as they stood at the Oct 2022 CMS
snapshot (2022 billing, Open Payments 2021, ownership changes before then; news not searched) for
935 hospital-based cardiologists in seven states; outcome = joined an independent-style group by
the Oct 2024 snapshot (44 did, 4.7%). L2 logistic regression, 5-fold out-of-fold. Rule fixed in
advance: scores appear only if the out-of-fold AUC's 95% interval is above 0.5. It passed (AUC 0.66,
CI 0.57–0.75; top 50 held-out: 10 moved = 20% vs 4.7%), **but** it did not predict the cross-check
outcome (switch to office billing, AUC 0.55, CI 0.47–0.63), and most fitted directions are the
opposite of the original hypotheses (lower productivity and fewer independent groups nearby point
toward moving; three of nine point the expected way, but only industry payments reliably; prior
independent practice leans that way, and career stage barely). The mover count also swings from 12
to 56 depending on the window, so some "moves" may be CMS listing artifacts. Treat the ranking as a
lead list to check, not a forecast. Timing windows and cohorts stay blank.

"Independent-style group" is a stated guess: its cardiologists bill mostly in office settings, its
legal name doesn't say hospital / medical center / health system / university / provider network,
and it shares no distinctive name word with a hospital its members are affiliated with. Some
hospital-owned groups still pass. Only one of the ten signals (industry engagement) is exactly what
it claims to measure; the other eight filled ones are stand-ins, inferences or an assumed lookup.
The 0–1 values come from the Synthetic formulas, which are themselves design assumptions.

**News pipeline** (`engine/news/`). For each listed cardiologist's billing group and affiliated
hospitals, Google News is searched for the last 36 months; each article is opened in real Chrome
(`scripts/fetch_pages.cjs`) and read by Claude (`claude-opus-5-5`, structured output). An event
counts only if Claude's quote appears **word for word** in the article, it's about one of those
organizations, it's reported as fact (not rumored or denied) and it's M&A, financial distress,
layoffs, bankruptcy or closure; follow-up coverage doesn't make an event newer. Article text never
leaves `data/raw/` (git-ignored); the app gets the link, headline and short quote. In Synthetic
mode the same pipeline reads **fictional** articles Claude wrote about the
simulator's own events (plus decoys: denials, routine news, old events, other organizations), and
employer disruption there comes from what it read — with extraction accuracy shown on the News page.

**Refreshing the real inputs** (maintainers only; not needed to run the app). These steps run
on the host, not in Docker: the CMS provider-data host only answers a real browser, the news
pipeline opens articles in Chrome, and both need files the image doesn't carry (`data/raw/`,
`.env`). Needs Python 3.12+ with `requirements.txt` and `requirements-pipeline.txt` (anthropic,
trafilatura), Node 20+ with `npm --prefix web install`, and Google Chrome.

```bash
node scripts/download_cms.cjs data/raw/cms <snapshot zip urls>   # CMS Doctors & Clinicians archive
python -m engine.cms_directory       # -> data/cache/cms_directory.json.gz
python -m engine.wrvu                # -> data/cache/work_rvu_2024.json
python -m engine.open_payments       # streams the 2025 bulk file -> data/cache/open_payments.json
python -m engine.open_payments 2021  # the back-test's pre-2022 payments -> open_payments_2021.json
python -m engine.news.fake           # fictional articles + extraction (Claude) -> data/cache/news_fake.json
python -m engine.news.real_news      # real news (Claude) -> data/cache/news_real.json
python -m engine.backtest            # back-test and fit (offline) -> data/cache/backtest.json
docker compose up --build -d         # re-export from the new caches and serve
```

The Claude key is read from `.env` (`ANTHROPIC_API_KEY`, git- and docker-ignored). Every Claude call
is cached in `data/raw/llm/`, so re-runs are free; bundle rebuilds never call the API.

## Layout

```
engine/        scoring · timing · signals catalog · cohort formation · insights · evaluation
               export_web (bundles) · bundle_check (contract)
               real_data (Real data bundle) · real_signals (the ten signals from real records)
               public_fetch · cms_directory · open_payments · wrvu (real inputs -> data/cache/)
               backtest (fit + held-out test) · news/ (Claude news pipeline) · db/ (Postgres store)
web/           React + TypeScript + Tailwind; src/pages (one per entity; real/ for Real data), src/test
tests/         pytest suite for the engine, the bundle contract, the news rules and the store
scripts/       smoke.sh (test ladder) · download_cms.cjs, fetch_pages.cjs (real-browser fetches)
data/cache/    committed compact inputs; data/raw/ (git-ignored) holds downloads and the Claude cache
.claude/       CLAUDE.md, skills, agents, adversarial review process (see below)
run.py, app.py legacy CLI and Streamlit demo
```

## Testing

```bash
docker compose --profile test run --rm tests    # engine tests, in Docker (all 84)
```

84 engine tests (incl. "flipping the hidden label changes no score", locked headline
metrics, one regression per adversarial-review finding, the news-pipeline rules and the
back-test's no-imputation rule), and a contract validator the exporter runs before writing
(including disclosure control, and for Real data: no value without a stated fact, no scores
without a passing back-test, no article text shipped). The image build itself type-checks and
compiles the web app.

The web tests and the full ladder run on the host (Node 20+ and Python 3.12+), not in Docker:
`npm --prefix web install && npm --prefix web test` runs the 62 web tests — every Synthetic page
type plus a crawler that follows every link from the dashboard and fails on any dead end.
`scripts/smoke.sh` runs the whole ladder (set `PY` to your Python if it isn't `python3`). The
Real data pages have no vitest coverage; `web/scripts/screenshots.mjs` renders five of them in
real Chrome alongside the Synthetic pages.

## Developing with Claude Code

`.claude/` makes the repo's conventions executable:

- `CLAUDE.md` — architecture, commands, the ten invariants, gotchas.
- **Skills:** `/add-signal`, `/export-data`, `/add-page`,
  `/design-system`, `/run-tests`, `/adversarial-review`, `/demo-prep`.
- **Agents:** four red teams (correctness, data integrity, frontend, methodology), a
  `review-judge` that must reproduce every finding, and a `test-engineer` that writes
  failing regression tests before fixes.
- A `PostToolUse` hook reminds Claude to re-export and re-validate after engine edits.
