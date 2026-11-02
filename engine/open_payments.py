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
CACHE = os.path.join(ROOT, "data", "cache", "open_payments.json")
YEAR = 2025
URL = ("https://download.cms.gov/openpayments/PGYR2025_P06302026_06032026/"
       "OP_DTL_GNRL_PGYR2025_P06302026_06032026.csv")


def _npis() -> set[str]:
    raw = load(offline=True)
    return {str(r["Rndrng_NPI"]) for rows in raw["prv"].values() for r in rows if r.get("Rndrng_NPI")}


def fetch() -> dict:
    wanted = _npis()
    total, count = defaultdict(float), defaultdict(int)
    nature = defaultdict(lambda: defaultdict(float))
    rows = 0
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
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
        "year": YEAR, "source": URL, "rowsScanned": rows, "npisSearched": len(wanted),
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "payments": {n: {"usd": round(total[n], 2), "count": count[n],
                         "byNature": {k: round(v, 2) for k, v in sorted(nature[n].items(), key=lambda kv: -kv[1])}}
                     for n in total},
    }


def load_payments() -> dict:
    if not os.path.exists(CACHE):
        raise RuntimeError("no Open Payments extract -- run: python -m engine.open_payments (network)")
    with open(CACHE) as f:
        return json.load(f)


if __name__ == "__main__":
    out = fetch()
    with open(CACHE, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"scanned {out['rowsScanned']:,} payment rows; {len(out['payments']):,} of "
          f"{out['npisSearched']:,} cardiologists received general payments in {YEAR} -> {os.path.relpath(CACHE, ROOT)}")
