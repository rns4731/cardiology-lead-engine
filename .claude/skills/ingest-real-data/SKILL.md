---
name: ingest-real-data
description: Rules and procedure for the real-identity pipeline — fetching cardiologists from public NPI registries (NIH/NLM Clinical Tables, CMS NPPES), taxonomy mapping, metro coverage, provenance, and what must never be presented as fact. Use when touching engine/nppes_nlm.py or engine/nppes.py, adding metros, changing subspecialty mapping, or when real-mode data looks wrong.
---

# Real-identity ingestion

## Sources
| Source | Module | Status |
|---|---|---|
| NIH/NLM Clinical Tables NPI (`clinicaltables.nlm.nih.gov/api/npi_idv/v3/search`) | `engine/nppes_nlm.py` | **live source** — free, no auth |
| CMS NPPES (`npiregistry.cms.gov/api`) | `engine/nppes.py` | fallback in `run.py --real`; returned NXDOMAIN during the build |

Both expose public provider-directory data only. **No PHI** — never add a source that
contains patient-level data.

## What is real vs simulated (non-negotiable)
Real: NPI, name, practice city/state (→ metro), provider taxonomy (→ subspecialty).
Simulated: employer (fictional systems), every behavioral signal, employer events, the
outcome, therefore every score, cohort and metric. The UI must say so on every `/real/*`
page (banner), per attribute (badges), and on outcome-based metrics ("simulated").

## Taxonomy mapping (`PROBES`)
- Query token → full `provider_type` matcher → canonical subspecialty. The token is broad
  ("Interventional" also returns Interventional *Radiology*); the matcher filters.
- NLM has no cardiac-imaging or advanced-heart-failure taxonomy, and "Nuclear" returns
  Nuclear *Medicine*. Real mode therefore covers Interventional, Electrophysiology and
  General cardiology ("Cardiovascular Disease" — never call it "noninvasive"; the registry
  doesn't say). **Never** map someone into a subspecialty they don't hold to fill the gap;
  the bundle's `meta.subspecialtiesAbsent` makes the UI omit (not zero) the others.
- Before changing a matcher, probe the API and list the distinct `provider_type`s it returns
  (see the probe snippet below) — don't guess spellings.

```bash
.venv/bin/python - <<'EOF'
import json, urllib.parse, urllib.request
API="https://clinicaltables.nlm.nih.gov/api/npi_idv/v3/search"
q="provider_type:Interventional AND addr_practice.city:Columbus AND addr_practice.state:OH"
d=json.loads(urllib.request.urlopen(API+"?"+urllib.parse.urlencode({"terms":"","q":q,"df":"NPI,name.full,provider_type","count":50}),timeout=20).read())
print(d[0], sorted({r[2] for r in d[3]}))
EOF
```

## Completeness
- `fetch_identities` paginates (`PAGE=500`) to fetch **all** matches, not a sample.
- Every failed request is recorded in `failedQueries`; a non-empty list means a partial
  universe — surface it, don't hide it (the real-mode banner does).
- A partial live fetch **never overwrites** a complete identity cache
  (`test_d2_partial_fetch_keeps_cache`); the rebuild uses the cache and records
  `liveFailedQueries`.
- Rows keep `raw_name` so names can be re-parsed; `_parse_name` keeps suffixes (Jr., III).
- Simulated profiles are seeded per `(seed, npi)` and per `(seed, metro)` — a registrant
  joining or leaving must not reshuffle anyone else (`test_c2_identity_overlay_is_order_independent`).
- Coverage is the practice-address **city**, not the metro area; suburbs are excluded.
  Widening to suburbs means listing their cities per metro — document the change.

## Adding a metro
Add it to `METROS` (fictional systems — keep existing list lengths unchanged or every
synthetic number moves) and `METRO_COORDS`; consider a label position in
`web/src/components/charts/USMap.tsx` `LABEL_POS`; then `/export-data` (live) and
`/run-tests`.
