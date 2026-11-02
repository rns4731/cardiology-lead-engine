"""Industry payments per cardiologist from the CMS Open Payments bulk file (real, exact).

    .venv/bin/python -m engine.open_payments          # network; streams ~GBs once, caches a small extract

Open Payments' query API refuses this client (403), but the published bulk CSV on
download.cms.gov does not. The file is streamed and filtered on the fly to the NPIs of
cardiologists in the cached CMS billing data (seven states), so only a few hundred KB are
kept: data/cache/open_payments.json -- total general payments per NPI for one program year,
with payment count and the split by nature of payment. Research and ownership payments are
separate CMS files and are not included; the signal is general payments only, and says so.
"""
from __future__ import annotations

import csv
import io
import json
import os
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

from engine.public_fetch import UA, load

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
YEAR = 2025
# program year -> bulk general-payments file (2021 is used by the back-test: published mid-2022,
# so it was knowable at the Oct 2022 prediction date; this copy carries later CMS corrections)
URLS = {y: (f"https://download.cms.gov/openpayments/PGYR{y}_P06302026_06032026/"
            f"OP_DTL_GNRL_PGYR{y}_P06302026_06032026.csv") for y in (2021, 2025)}


def cache_path(year: int = YEAR) -> str:
    name = "open_payments.json" if year == YEAR else f"open_payments_{year}.json"
    return os.path.join(ROOT, "data", "cache", name)


CACHE = cache_path()


def _npis() -> set[str]:
    raw = load(offline=True)
    return {str(r["Rndrng_NPI"]) for rows in raw["prv"].values() for r in rows if r.get("Rndrng_NPI")}


def fetch(year: int = YEAR) -> dict:
    wanted = _npis()
    total, count = defaultdict(float), defaultdict(int)
    nature = defaultdict(lambda: defaultdict(float))
    rows = 0
    req = urllib.request.Request(URLS[year], headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r:
        reader = csv.DictReader(io.TextIOWrapper(r, encoding="utf-8", errors="replace", newline=""))
        for row in reader:
            rows += 1
            npi = (row.get("Covered_Recipient_NPI") or "").strip()
            if npi not in wanted:
                continue
            try:
                amt = float(row.get("Total_Amount_of_Payment_USDollars") or 0)
            except ValueError:
                continue
            total[npi] += amt
            count[npi] += 1
            kind = (row.get("Nature_of_Payment_or_Transfer_of_Value") or "Other").strip()
            nature[npi][kind] += amt
    return {
        "year": year, "source": URLS[year], "rowsScanned": rows, "npisSearched": len(wanted),
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "payments": {n: {"usd": round(total[n], 2), "count": count[n],
                         "byNature": {k: round(v, 2) for k, v in sorted(nature[n].items(), key=lambda kv: -kv[1])}}
                     for n in total},
    }


def load_payments(year: int = YEAR) -> dict:
    path = cache_path(year)
    if not os.path.exists(path):
        raise RuntimeError(f"no Open Payments {year} extract -- run: python -m engine.open_payments {year} (network)")
    with open(path) as f:
        return json.load(f)


if __name__ == "__main__":
    import sys

    year = int(sys.argv[1]) if len(sys.argv) > 1 else YEAR
    out = fetch(year)
    with open(cache_path(year), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"scanned {out['rowsScanned']:,} payment rows; {len(out['payments']):,} of "
          f"{out['npisSearched']:,} cardiologists received general payments in {year} -> {os.path.relpath(cache_path(year), ROOT)}")
