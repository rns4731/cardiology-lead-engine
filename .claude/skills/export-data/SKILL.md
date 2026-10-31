---
name: export-data
description: Regenerate the web app's JSON bundles from the Python engine (synthetic and real), validate them, and refresh the running app. Use after any change under engine/, when bundles are missing or stale, when the bundle schema changes, or when the user asks to refresh or re-pull the data.
argument-hint: "[--offline] [--source synthetic|real|all]"
---

# Export data bundles

```bash
.venv/bin/python -m engine.export_web --offline   # default during development
.venv/bin/python -m engine.export_web             # also re-fetches real identities (network)
.venv/bin/python -m engine.bundle_check           # validate what's on disk
```

Outputs: `web/public/data/{synthetic,real}/bundle.json` and `web/public/data/manifest.json`.
The dev server serves them directly — reload the browser; no rebuild needed.

## How the real source works
- Live: `engine/nppes_nlm.fetch_identities()` pulls **every** cardiologist whose practice
  address is in a configured metro city from NIH/NLM Clinical Tables, caches them to
  `data/cache/real_identities.json`, then overlays simulated behavior.
- `--offline`: rebuilds the real bundle from that cache with the *current* engine. Use this
  for every engine change — identities don't change when the scoring does.
- Live fetch failing with a cache present → rebuilds from cache (logged). No cache and no
  network → keeps the previous real bundle (manifest `stale: true`) or marks it unavailable,
  and the dashboard toggle disables it.
- Live fetch needs the sandbox disabled in this environment.

## Guarantees and what to check
- `_write` runs `bundle_check.validate` and **refuses to write** an inconsistent bundle — if
  the export raises `bundle failed validation`, read the listed problems; don't bypass.
- `failedQueries` in the real bundle's `source` must be empty for a complete universe; if
  not, the universe is partial — say so before demoing.
- Shape change? Bump `SCHEMA_VERSION` in `export_web.py`, update `web/src/types.ts` and
  `bundle_check.py`; `tests/test_export_contract.py::test_bundles_on_disk` fails until the
  on-disk bundles are re-exported.
- Identifier dicts (`ID_KEYED`) keep engine spelling; field names become camelCase.

## After exporting
`scripts/smoke.sh --fast`. Bundle timestamps change on every export — that's expected churn.
