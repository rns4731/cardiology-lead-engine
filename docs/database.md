# Postgres store

Postgres is the engine's system of record. The engine still computes everything and writes
JSON bundles for the web; `engine.db.load` stores those outputs plus the raw public pulls,
so history is kept and outreach outcomes have a home. The web never reads the database.

## Run it

```bash
docker compose up -d db                       # Postgres 17 on localhost:5432 (user/db/password: leads)
.venv/bin/alembic upgrade head                # create / migrate the tables
.venv/bin/python -m engine.db.load            # store raw pulls + every bundle on disk
docker compose exec db psql -U leads leads    # query it
```

In Docker, `docker compose up --build -d` runs `migrate` → `exporter` → `loader` automatically.
`DATABASE_URL` overrides the connection (default `postgresql+psycopg://leads:leads@localhost:5432/leads`).

## Tables

| Group | Table | One row per |
|---|---|---|
| Raw snapshots | `ingest_run` | public pull (`cms_medicare` or `npi_registry`), keyed by content hash |
| | `cms_provider_year` | NPI × Medicare year (name, address, type, volume) |
| | `cms_provider_service` | NPI × HCPCS × place of service |
| | `cms_hospital`, `cms_ownership_change` | hospital (CCN → city); change-of-ownership event |
| | `npi_identity` | cardiologist from the NIH/NLM NPI registry |
| Engine outputs | `export_run` | exported bundle (`synthetic`, `real`, `public`) |
| | `lead`, `lead_contribution` | lead per run; points per signal |
| | `signal`, `cohort`, `cohort_member`, `metro_summary` | signal, candidate cohort, member, metro per run |
| Team input | `outreach_event` | contact attempt and its outcome (`no_response` … `joined`) |
| Views | `current_export_run`, `current_lead` | latest export per source, and its leads |

Every engine-output row keeps its full bundle record as JSONB, so `engine.db.read.bundle()`
rebuilds a bundle exactly; `read.public_raw()` / `read.identities()` do the same for the caches.

## Rules

- **Loads are idempotent.** The same file never makes a second snapshot; a new pull or re-export does.
- **The hidden label is never stored.** The loader runs the bundle validator and refuses any
  lead carrying `will_move_24mo` (`test_hidden_label_is_never_stored`).
- **Schema changes go through Alembic.** Edit `engine/db/models.py`, then
  `alembic revision --autogenerate -m "..."`; `test_models_match_the_migrations` fails until you do.
- **Tests use their own database** (`leads_test`, recreated per run) and skip when Postgres isn't up.

## Example queries

```sql
-- top 10 current synthetic leads
SELECT name, metro, propensity, timing_bucket FROM current_lead
WHERE source_id = 'synthetic' ORDER BY rank LIMIT 10;

-- what drives one lead's score
SELECT signal_key, points FROM lead_contribution c JOIN current_export_run r ON r.id = c.export_run_id
WHERE r.source_id = 'synthetic' AND c.npi = 1000000378 ORDER BY points DESC;

-- record an outreach outcome
INSERT INTO outreach_event (npi, outcome, channel, recorded_by) VALUES (1000000378, 'meeting', 'call', 'rohit');
```
