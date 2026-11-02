---
name: export-data
description: Regenerate the web app's JSON bundles from the Python engine (Synthetic and Real data), validate them, and refresh the running app. Use after any change under engine/, when bundles are missing or stale, when the bundle schema changes, or when the user asks to refresh or re-pull the data.
argument-hint: "[--offline] [--source synthetic|public|all]"
---

# Export data bundles

```bash
docker compose up --build -d                     # rebuild, re-export (offline), load: what :8080 serves
docker compose run --rm --no-deps -v "$PWD/engine:/app/engine:ro" -v "$PWD/web/public/data:/app/web/public/data" exporter
                                                 # write bundles to web/public/data (dev server, web tests)
docker compose run --rm --no-deps exporter python -m engine.bundle_check   # validate the app's bundles
docker compose run --rm exporter python -m engine.export_web && docker compose run --rm loader
                                                 # re-pull CMS Medicare (network), then store it
```

Outputs: `{synthetic,public}/bundle.json` and `manifest.json` — in the `bundles` Docker volume
(loaded into Postgres and served on :8080), or in `web/public/data/` with the host mount above,
which the dev server serves directly (reload the browser; no rebuild needed).

## How the Real data source works
- `engine/real_data.build_public_bundle` builds it from cached CMS pulls
  (`data/cache/public_raw.json.gz` plus the directory, work-RVU, Open Payments, news and
  back-test caches). Without `--offline` it re-pulls the CMS Medicare utilization records first
  (network; sandbox disabled here). The other inputs refresh with their own modules (README,
  *Refreshing the real inputs*); rerun `engine.backtest` after any change to the signals.
- A source that fails to build keeps its previous bundle (manifest `stale: true`) or is
  marked unavailable, and the dashboard toggle disables it.
- There is no mode that puts real names on simulated signals — don't add one back.

## Guarantees and what to check
- `_write` runs `bundle_check.validate` and **refuses to write** an inconsistent bundle — if
  the export raises `bundle failed validation`, read the listed problems; don't bypass.
- Shape change? Bump `SCHEMA_VERSION` in `export_web.py`, update `web/src/types.ts` and
  `bundle_check.py`; `tests/test_export_contract.py::test_bundles_on_disk` fails until the
  on-disk bundles are re-exported.
- Identifier dicts (`ID_KEYED`) keep engine spelling; field names become camelCase.

## After exporting
`scripts/smoke.sh --fast`. Bundle timestamps change on every export — that's expected churn.
