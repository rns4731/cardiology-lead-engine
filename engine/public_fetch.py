"""Pull the public CMS data behind the "Real data" source (data.cms.gov data API).

    .venv/bin/python -m engine.public_fetch        # network; refreshes the cache

  Medicare Physician & Other Practitioners - by Provider      2014, 2018, 2021-2024
  Medicare Physician & Other Practitioners - by Provider and Service   2022, 2024
  Hospital Change of Ownership (2016-2026) and Hospital Enrollments (CCN -> city)

A few columns are kept, gzipped to data/cache/public_raw.json.gz so the bundle can be
rebuilt offline (Docker included). engine/real_data.py currently reads only the 2024
by-provider and by-service files (identity, billing address, provider type, place of
service); the other years and the ownership-change files are cached but unused, because
no signal may be filled with a stand-in. Public provider-level data only; no PHI.
(CMS's provider-data and Open Payments APIs refused this client with 403s, so group
affiliations and industry payments are unavailable.)
"""
from __future__ import annotations

import gzip
import json
import os
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "cache", "public_raw.json.gz")
API = "https://data.cms.gov/data-api/v1/dataset/{}/data"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

STATES = ["TX", "OH", "TN", "NC", "AZ", "FL", "CO"]
TYPES = ["Cardiology", "Interventional Cardiology", "Clinical Cardiac Electrophysiology",
         "Advanced Heart Failure and Transplant Cardiology"]
PRV = {2014: "100d9e00-03cd-4105-9f58-27f9bf9ab773", 2018: "900850df-c9a9-47ce-a9e0-d0ceae5a811f",
       2021: "44e0a489-666c-4ea4-a1a2-360b6cdc19db", 2022: "21555c17-ec1b-4e74-b2c6-925c6cbb3147",
       2023: "8ba584c6-a43a-4b0b-a35a-eb9a59e3a571", 2024: "8889d81e-2ee7-448f-8713-f071038289b5"}
SVC = {2022: "e650987d-01b7-4f09-b75e-b0b075afbf98", 2024: "92396110-2aed-4d63-a6a2-5d6207d46a29"}
CHOW = "c04031db-54ce-461c-85d1-d2613d71f167"
HOSP = "f6f6505c-e8b0-4d57-b258-e2b94133aaf2"

PRV_COLS = ["Rndrng_NPI", "Rndrng_Prvdr_Last_Org_Name", "Rndrng_Prvdr_First_Name", "Rndrng_Prvdr_St1",
            "Rndrng_Prvdr_City", "Rndrng_Prvdr_State_Abrvtn", "Rndrng_Prvdr_Zip5", "Rndrng_Prvdr_Type",
            "Tot_Benes", "Tot_Srvcs", "Tot_Mdcr_Alowd_Amt"]
SVC_COLS = ["Rndrng_NPI", "HCPCS_Cd", "Place_Of_Srvc", "Tot_Srvcs", "Avg_Mdcr_Alowd_Amt"]
CHOW_COLS = ["CCN - BUYER", "CCN - SELLER", "EFFECTIVE DATE", "CHOW TYPE TEXT",
             "ORGANIZATION NAME - BUYER", "ORGANIZATION NAME - SELLER"]
HOSP_COLS = ["CCN", "CITY", "STATE"]


def _get(dataset: str, params: dict) -> list[dict]:
    url = API.format(dataset) + "?" + urllib.parse.urlencode(params, safe="[]")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)
    return []


def _pull(dataset: str, filters: dict, cols: list[str]) -> list[dict]:
    rows, offset = [], 0
    base = {f"filter[{k}]": v for k, v in filters.items()}
    while True:
        page = _get(dataset, {**base, "size": 5000, "offset": offset})
        rows += [{c: r.get(c) for c in cols} for r in page]
        if len(page) < 5000:
            return rows
        offset += 5000


def fetch() -> dict:
    jobs = []
    for year, ds in PRV.items():
        cols = PRV_COLS if year >= 2021 else ["Rndrng_NPI"]
        jobs += [("prv", year, ds, {"Rndrng_Prvdr_State_Abrvtn": s, "Rndrng_Prvdr_Type": t}, cols)
                 for s in STATES for t in TYPES]
    for year, ds in SVC.items():
        jobs += [("svc", year, ds, {"Rndrng_Prvdr_State_Abrvtn": s, "Rndrng_Prvdr_Type": t}, SVC_COLS)
                 for s in STATES for t in TYPES]
    jobs += [("hosp", 0, HOSP, {"STATE": s}, HOSP_COLS) for s in STATES]
    jobs.append(("chow", 0, CHOW, {}, CHOW_COLS))

    out: dict = {"prv": {}, "svc": {}, "hosp": [], "chow": []}
    with ThreadPoolExecutor(max_workers=6) as ex:
        results = list(ex.map(lambda j: (j, _pull(j[2], j[3], j[4])), jobs))
    for (kind, year, _, _, _), rows in results:
        if kind in ("prv", "svc"):
            out[kind].setdefault(str(year), []).extend(rows)
        else:
            out[kind].extend(rows)
    out["fetchedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return out


def load(offline: bool = True) -> dict:
    """Cached raw pulls; fetch (and cache) when not offline or when no cache exists."""
    if offline:
        if not os.path.exists(CACHE):
            raise RuntimeError("no cached public data -- run: python -m engine.public_fetch (network)")
        with gzip.open(CACHE, "rt") as f:
            return json.load(f)
    raw = fetch()
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with gzip.open(CACHE, "wt") as f:
        json.dump(raw, f, separators=(",", ":"))
    return raw


if __name__ == "__main__":
    t = time.time()
    raw = load(offline=False)
    print(f"fetched in {time.time() - t:.0f}s -> {os.path.relpath(CACHE, ROOT)} "
          f"({os.path.getsize(CACHE) / 1e6:.1f} MB)")
    for y, rows in sorted(raw["prv"].items()):
        print(f"  by-provider {y}: {len(rows):>6} rows")
    for y, rows in sorted(raw["svc"].items()):
        print(f"  by-service  {y}: {len(rows):>6} rows")
    print(f"  hospitals {len(raw['hosp'])}  ownership changes {len(raw['chow'])}")
