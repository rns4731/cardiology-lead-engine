---
name: export-data
description: Regenerate the web app's JSON bundles from the Python engine (Synthetic and Real data), validate them, and refresh the running app. Use after any change under engine/, when bundles are missing or stale, when the bundle schema changes, or when the user asks to refresh or re-pull the data.
argument-hint: "[--offline] [--source synthetic|public|all]"
---

# Export data bundles

```bash
.venv/bin/python -m engine.export_web --offline   # default during development
.venv/bin/python -m engine.export_web             # also re-pulls the CMS records (network)
.venv/bin/python -m engine.bundle_check           # validate what's on disk
```

Outputs: `web/public/data/{synthetic,public}/bundle.json` and `web/public/data/manifest.json`.
The dev server serves them directly — reload the browser; no rebuild needed.

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
