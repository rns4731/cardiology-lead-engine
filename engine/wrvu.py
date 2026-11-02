"""Work RVUs per billing code, from the CMS Physician Fee Schedule relative value file.

    .venv/bin/python -m engine.wrvu        # reads data/raw/cms/rvu24a.zip, writes the cache

Medicare work RVUs for a physician = sum over billing codes of (services billed x the code's
work RVU). The global row (no modifier) carries the full work RVU; the professional (-26)
row has the same work value, so the global row is used. CY2024 values match the 2024
Medicare utilization file they are applied to.
"""
from __future__ import annotations

import csv
import io
import json
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIP = os.path.join(ROOT, "data", "raw", "cms", "rvu24a.zip")
CACHE = os.path.join(ROOT, "data", "cache", "work_rvu_2024.json")
SOURCE = "CMS Physician Fee Schedule relative value file, CY2024 (RVU24A, PPRRVU24_JAN)"


def build() -> dict:
    with zipfile.ZipFile(ZIP) as z:
        name = next(n for n in z.namelist() if n.upper().startswith("PPRRVU") and n.lower().endswith(".csv"))
        rows = list(csv.reader(io.TextIOWrapper(z.open(name), encoding="latin-1")))
    start = next(i for i, r in enumerate(rows) if r and r[0] == "HCPCS") + 1
    glob, other = {}, {}
    for r in rows[start:]:
        if len(r) < 6 or not r[0]:
            continue
        try:
            w = float(r[5])
        except ValueError:
            continue
        (glob if r[1].strip() == "" else other).setdefault(r[0].strip(), w)
    work = {**{k: v for k, v in other.items() if k not in glob}, **glob}
    return {"source": SOURCE, "work": work}


def load_work_rvu() -> dict:
    with open(CACHE) as f:
        return json.load(f)


if __name__ == "__main__":
    out = build()
    with open(CACHE, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(out['work']):,} codes -> {os.path.relpath(CACHE, ROOT)}; 93306={out['work'].get('93306')} 92928={out['work'].get('92928')}")
