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

"Independent-style group" is a stated guess: its cardiologists bill mostly in office settings, its
legal name doesn't say hospital / medical center / health system / university / provider network,
and it shares no distinctive name word with a hospital its members are affiliated with. Some
hospital-owned groups still pass. No weights have a real basis and there's no real outcome, so
score, ranking, timing windows and cohorts stay blank.

**News pipeline** (`engine/news/`). For each listed cardiologist's billing group and affiliated
hospitals, Google News is searched for the last 36 months; each article is opened in real Chrome
(`scripts/fetch_pages.cjs`) and read by Claude (`claude-opus-5-5`, structured output). An event
counts only if Claude's quote appears **word for word** in the article, it's about one of those
organizations, it's reported as fact (not rumored or denied) and it's M&A, financial distress,
layoffs, bankruptcy or closure; follow-up coverage doesn't make an event newer. Article text never
leaves `data/raw/` (git-ignored); the app gets the link, headline and short quote. In Synthetic and
Real-identities modes the same pipeline reads **fictional** articles Claude wrote about the
simulator's own events (plus decoys: denials, routine news, old events, other organizations), and
employer disruption there comes from what it read — with extraction accuracy shown on the News page.

Refreshing the real inputs (network; the CMS provider-data host only answers real browsers):

```bash
node scripts/download_cms.cjs data/raw/cms <snapshot zip urls>   # CMS Doctors & Clinicians archive
.venv/bin/python -m engine.cms_directory     # -> data/cache/cms_directory.json.gz
.venv/bin/python -m engine.wrvu              # -> data/cache/work_rvu_2024.json
.venv/bin/python -m engine.open_payments     # streams the 2025 bulk file -> data/cache/open_payments.json
.venv/bin/pip install -r requirements-pipeline.txt   # anthropic, trafilatura
.venv/bin/python -m engine.news.fake         # fictional articles + extraction (Claude) -> data/cache/news_fake.json
.venv/bin/python -m engine.news.real_news    # real news (Claude) -> data/cache/news_real.json
.venv/bin/python -m engine.export_web --offline
```

The Claude key is read from `.env` (`ANTHROPIC_API_KEY`, git- and docker-ignored). Every Claude call
is cached in `data/raw/llm/`, so re-runs are free; bundle rebuilds never call the API.

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
