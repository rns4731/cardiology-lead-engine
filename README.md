# Independent-Cardiology Lead Engine

A prototype for a PE-backed cardiology platform's growth team: **find which
hospital-employed cardiologists are likely to move to independent practice, when their
window opens, and how they cluster into viable founding groups of 5+** — every score
explained, every number drill-downable.

The approach, scope decisions, results and trade-offs are in
[`docs/approach.md`](docs/approach.md).

## Quickstart

**Docker (recommended)** — nothing to install but Docker:

```bash
docker compose up --build -d      # exporter computes the data, then nginx serves the app
open http://localhost:8080
```

| Service | What it does |
|---|---|
| `db` | Postgres 17 — the engine's system of record (`localhost:5432`, user/db `leads`) |
| `migrate` | one-shot `alembic upgrade head`: creates / migrates the tables |
| `exporter` | one-shot Python engine: scores both universes, writes the JSON bundles to a shared volume (offline; real identities come from the committed cache) |
| `loader` | one-shot: stores the cached public pulls and every bundle in Postgres (idempotent) |
| `api` | serves `/data/manifest.json` and `/data/<source>/bundle.json` from Postgres (each source's current export) |
| `web` | nginx serving the production React build; proxies `/data/*` to the api; healthy once `/data/manifest.json` is served from Postgres |
| `tests` *(profile)* | `docker compose --profile test run --rm tests` — the engine suite inside the image |
| `streamlit` *(profile)* | `docker compose --profile legacy up -d` — the original demo on :8501 |

Re-pull real identities (network): `docker compose run --rm exporter python -m engine.export_web`, then
`docker compose restart web`. Stop: `docker compose down` (add `-v` to drop the data volume).

**Local development:**

```bash
# engine (Python 3.10+)
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m engine.export_web --offline   # build the data bundles

# web app
npm --prefix web install
npm --prefix web run dev                          # → http://localhost:5190
```

Postgres (Docker serves the app from it; optional for local dev) — see [docs/database.md](docs/database.md):

```bash
docker compose up -d db && .venv/bin/alembic upgrade head && .venv/bin/python -m engine.db.load
```

Bundles and the cached real identities are committed, so the app runs from a fresh clone
without network. To re-pull real identities from the NIH/NLM NPI registry, run
`.venv/bin/python -m engine.export_web` (no `--offline`).

## What's inside

| | |
|---|---|
| **Methodology** (`/`) | the funnel, scope, the ten signals, timing, cohort viability, honest validation |
| **Dashboard** (`/:source/dashboard`) | KPIs, US map, strongest cohorts, act-now list, timing & subspecialty mix, threshold sensitivity, signals — plus the **Synthetic / Real identities** toggle |
| **Locations**, **Hospital systems** | per-metro and per-employer pages: cohorts, systems, charts that drill into filtered lists |
| **Cohorts** | viability breakdown, members, and who would strengthen the cohort (Δ viability) |
| **Cardiologists** | URL-filterable directory; each profile shows why this score, why this window, cohorts they could join, related colleagues / similar profiles / complements |
| **Signals** | how each signal is computed, where the data comes from, and whether it predicts on its own |

**Data modes.** *Synthetic*: 1,200 simulated cardiologists with a hidden 24-month outcome
the scorer never sees — it tests the pipeline (top-25 move rate 44% vs 19.7% base →
**≈2× lift**, 2.24×, 95% CI 1.4–3.2×; AUC 0.621 vs a best achievable 0.627). Because that outcome
is simulated from the model's own hypotheses, it can't validate the hypotheses — only real
outcomes can. *Real identities*: all 1,087 cardiologists practicing in the eight cities per
the public NIH/NLM NPI registry; identity, location and subspecialty are real, everything
behavioral is simulated and labeled as such. Hospital systems are placeholders. No PHI.

*Real signals*: real data **and** a real model. Ten signals computed from public CMS data
(Medicare utilization by provider and by service 2014–2024 — volume, procedure mix, place of
service, practice address, tenure — plus acute-care hospital change-of-ownership events), with weights
**fitted** by logistic regression on a real outcome: of 1,171 clearly hospital-based
cardiologists in 7 states in 2022, 83 shifted to office-based billing by 2024 (a proxy for
leaving hospital practice). Out-of-fold AUC 0.65; top-100 lift 2.4×. Weak spots, stated plainly:
the hospital-sale signal is city-wide (affiliation data was blocked), chance-level on its own
(AUC 0.508) and currently zero in all eight metros, so timing windows are almost all "Watch". Scores 205 hospital-based
cardiologists in the eight metros; practice sites are real shared billing addresses. Refresh the
data with `.venv/bin/python -m engine.public_fetch` (slow: the CMS API took ~2 h); rebuilds from
the cache in `data/cache/public_raw.json.gz` are offline and instant.

## Layout

```
engine/        scoring · timing · signals catalog · cohort formation · insights · evaluation
               export_web (bundles) · bundle_check (contract) · nppes_nlm (real identities)
web/           React + TypeScript + Tailwind; src/pages (one per entity), src/test
tests/         pytest suite for the engine and the bundle contract
scripts/       smoke.sh — the full test ladder
.claude/       CLAUDE.md, skills, agents, adversarial review process (see below)
run.py, app.py legacy CLI and Streamlit demo
```

## Testing

```bash
scripts/smoke.sh          # pytest → rebuild → contract → typecheck → vitest → build → screenshots
scripts/smoke.sh --fast   # inner loop
```

66 engine tests (incl. "flipping the hidden label changes no score", locked headline
metrics, and one regression per adversarial-review finding), a contract validator the
exporter runs before writing (including disclosure control), and 98 web tests — every page
type for both data sources plus a crawler that follows every link from the dashboard and
fails on any dead end. Visual QA runs in real Chrome via `web/scripts/screenshots.mjs`.

## Developing with Claude Code

`.claude/` makes the repo's conventions executable:

- `CLAUDE.md` — architecture, commands, the ten invariants, gotchas.
- **Skills:** `/add-signal`, `/export-data`, `/ingest-real-data`, `/add-page`,
  `/design-system`, `/run-tests`, `/adversarial-review`, `/demo-prep`.
- **Agents:** four red teams (correctness, data integrity, frontend, methodology), a
  `review-judge` that must reproduce every finding, and a `test-engineer` that writes
  failing regression tests before fixes.
- A `PostToolUse` hook reminds Claude to re-export and re-validate after engine edits.
