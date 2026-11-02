"""Cardiologists' billing groups, graduation year and hospital affiliations over time (real).

    .venv/bin/python -m engine.cms_directory       # reads data/raw/cms/*.zip, writes the cache

Source: CMS Doctors & Clinicians archive snapshots (data.cms.gov/provider-data, archived
monthly; one zip per snapshot) -- the National Downloadable File (each clinician's
graduation year, primary specialty, and every group practice they reassign billing to,
with the group's PAC ID, legal name and size) and the Facility Affiliation file (hospital
CCNs a clinician is affiliated with). The provider-data host refuses non-browser clients,
so the zips are downloaded with a real browser into data/raw/cms/ (git-ignored, ~250 MB
each) and reduced here to a compact cache:

    data/cache/cms_directory.json.gz   cardiology rows only, for NPIs that ever practiced
                                       in the seven states, one block per snapshot date

"Group" here means the billing group (reassignment) CMS lists -- closest public record of
an employer, not the employment contract itself. Hospital affiliation means the clinician
is affiliated with (typically holds privileges at) that hospital, not that it employs them.
"""
from __future__ import annotations

import csv
import gzip
import io
import json
import os
import re
import zipfile
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw", "cms")
CACHE = os.path.join(ROOT, "data", "cache", "cms_directory.json.gz")
STATES = {"TX", "OH", "TN", "NC", "AZ", "FL", "CO"}
_DATE = re.compile(r"doctors-clinicians_(\d{4}-\d{2}-\d{2})\.zip$")

# column-name candidates across snapshot vintages (CMS renamed a few over the years)
COLS = {
    "npi": ["npi"],
    "last": ["provider last name", "lst_nm"],
    "first": ["provider first name", "frst_nm"],
    "grad": ["grd_yr"],
    "spec": ["pri_spec"],
    "org_pac": ["org_pac_id"],
    "org_name": ["facility name", "org_nm"],
    "org_size": ["num_org_mem"],
    "city": ["city/town", "cty"],
    "state": ["state", "st"],
    "addr": ["adr_ln_1"],
    "zip": ["zip code", "zip"],
}
AFF_COLS = {"npi": ["npi"], "type": ["facility_type"],
            "ccn": ["facility affiliations certification number", "facility_afl_ccn"]}


def _is_cardiology(spec: str) -> bool:
    s = spec.upper()
    return "CARDI" in s and "SURGERY" not in s


def _reader(z: zipfile.ZipFile, pattern: str):
    names = [n for n in z.namelist() if re.search(pattern, n, re.I) and n.lower().endswith(".csv")
             and "__MACOSX" not in n]
    if not names:
        return None, None
    f = io.TextIOWrapper(z.open(names[0]), encoding="utf-8", errors="replace", newline="")
    r = csv.reader(f)
    header = [h.strip().lower() for h in next(r)]
    return r, header


def _index(header: list[str], spec: dict) -> dict:
    out = {}
    for key, cands in spec.items():
        out[key] = next((header.index(c) for c in cands if c in header), None)
    return out


def snapshots() -> list[tuple[str, str]]:
    found = []
    for f in sorted(os.listdir(RAW)) if os.path.isdir(RAW) else []:
        m = _DATE.search(f)
        if m:
            found.append((m.group(1), os.path.join(RAW, f)))
    return found


def extract() -> dict:
    snaps = snapshots()
    if not snaps:
        raise RuntimeError("no CMS directory snapshots in data/raw/cms/ -- download them first")
    rows_by_snap, aff_by_snap, keep = {}, {}, set()
    for date, path in snaps:
        with zipfile.ZipFile(path) as z:
            r, h = _reader(z, r"National_?Downloadable|mj5m-pzi6")
            ix = _index(h, COLS)
            # older vintages (<= 2022) list up to five hospital CCNs inline instead of a
            # separate Facility Affiliation file
            inline = [h.index(c) for c in (f"hosp_afl_{i}" for i in range(1, 6)) if c in h]
            aff_inline = []
            rows = []
            for rec in r:
                if len(rec) < len(h):
                    continue
                spec = rec[ix["spec"]]
                if not _is_cardiology(spec):
                    continue
                g = lambda k: rec[ix[k]].strip() if ix[k] is not None else ""  # noqa: E731
                rows.append([g("npi"), g("grad"), spec.strip(), g("org_pac"), g("org_name"), g("org_size"),
                             g("city").upper(), g("state"), g("addr").upper(), g("zip")[:5], g("first"), g("last")])
                if g("state") in STATES:
                    keep.add(g("npi"))
                aff_inline += [[g("npi"), "Hospital", rec[i].strip()] for i in inline if rec[i].strip()]
            rows_by_snap[date] = rows
            r, h = _reader(z, r"Facility_Affiliation")
            aff = aff_inline
            if r is not None:
                ix = _index(h, AFF_COLS)
                for rec in r:
                    if len(rec) < len(h):
                        continue
                    aff.append([rec[ix["npi"]].strip(), rec[ix["type"]].strip() if ix["type"] is not None else "",
                                rec[ix["ccn"]].strip()])
            aff_by_snap[date] = aff
        print(f"  {date}: {len(rows_by_snap[date]):>6} cardiology rows, {len(aff_by_snap[date]):>8} affiliation rows")
    out = {"fields": ["npi", "grad", "spec", "orgPac", "orgName", "orgSize", "city", "state", "addr", "zip", "first", "last"],
           "snapshots": {}}
    for date in sorted(rows_by_snap):
        rows = [r for r in rows_by_snap[date] if r[0] in keep]
        aff = defaultdict(set)
        for npi, typ, ccn in aff_by_snap[date]:
            if npi in keep and ccn and (typ == "" or typ.lower() == "hospital"):
                aff[npi].add(ccn)
        out["snapshots"][date] = {"rows": rows, "hospitals": {n: sorted(c) for n, c in aff.items()}}
    out["hospitalNames"] = _hospital_names()
    return out


def _hospital_names() -> dict:
    """CCN -> (name, city, state, ownership) from CMS Hospital General Information."""
    path = os.path.join(RAW, "Hospital_General_Information.csv")
    if not os.path.exists(path):
        return {}
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        return {r["Facility ID"]: [r["Facility Name"], r["City/Town"], r["State"], r["Hospital Type"], r["Hospital Ownership"]]
                for r in csv.DictReader(f)}


def load_directory() -> dict:
    if not os.path.exists(CACHE):
        raise RuntimeError("no CMS directory cache -- run: python -m engine.cms_directory")
    with gzip.open(CACHE, "rt") as f:
        return json.load(f)


if __name__ == "__main__":
    out = extract()
    with gzip.open(CACHE, "wt") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(out['snapshots'])} snapshots, {len(out['hospitalNames'])} hospital names -> "
          f"{os.path.relpath(CACHE, ROOT)} ({os.path.getsize(CACHE) / 1e6:.1f} MB)")
