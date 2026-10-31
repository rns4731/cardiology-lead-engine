"""Fetch REAL cardiologist identities from NIH/NLM's public Clinical Tables NPI API.

Free, no auth, no PHI: https://clinicaltables.nlm.nih.gov/ (NIH National Library of
Medicine). We use this as the live identity source because CMS's own npiregistry.cms.gov
is currently returning NXDOMAIN. Real NPI, name, location, and provider type are pulled
here; the (non-public) behavioral propensity signals are overlaid synthetically via
engine.generate_data.generate_from_identities.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request

import pandas as pd

from engine.generate_data import METROS

API = "https://clinicaltables.nlm.nih.gov/api/npi_idv/v3/search"

# distinguishing query token -> (matcher on full provider_type, canonical subspecialty).
# The NLM index has no cardiac-imaging or advanced-heart-failure taxonomy, and
# "Nuclear" matches Nuclear *Medicine* (not cardiology), so real mode covers three
# subspecialties. We never relabel a provider into a subspecialty they don't hold.
PROBES = [
    ("Interventional", "Interventional Cardiology", "Interventional"),
    ("Electrophysiology", "Electrophysiology", "Electrophysiology"),
    ("Failure", "Advanced Heart Failure", "Advanced Heart Failure"),
    # "Cardiovascular Disease" is general cardiology; it says nothing about invasive vs
    # noninvasive practice, so it must not be labeled "noninvasive"
    ("Cardiovascular", "Cardiovascular Disease", "General cardiology"),
]
PAGE = 500  # API maximum per request


_SUFFIX = {"JR": "Jr.", "JR.": "Jr.", "SR": "Sr.", "SR.": "Sr.", "II": "II", "III": "III", "IV": "IV", "V": "V"}


def _parse_name(full: str) -> str:
    """'LAST, FIRST MIDDLE[, SUFFIX]' -> 'Dr. First Last[ Suffix]'. The suffix matters:
    dropping it can merge a father and son who share a name."""
    parts = [p.strip() for p in full.split(",") if p.strip()]
    if len(parts) < 2:
        return f"Dr. {full.strip().title()}"
    last, first = parts[0].title(), parts[1].split()[0].title()
    suffix = next((_SUFFIX[p.upper()] for p in parts[2:] if p.upper() in _SUFFIX), "")
    return f"Dr. {first} {last}" + (f" {suffix}" if suffix else "")


def _query(city: str, state: str, token: str, offset: int, timeout: int) -> tuple[int, list]:
    q = f"provider_type:{token} AND addr_practice.city:{city} AND addr_practice.state:{state}"
    params = {"terms": "", "q": q, "df": "NPI,name.full,provider_type",
              "count": PAGE, "offset": offset}
    url = API + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        data = json.loads(resp.read().decode())
    return int(data[0]), data[3] or []


def fetch_identities(timeout: int = 20) -> pd.DataFrame:
    """EVERY registered cardiologist whose practice address is in a configured metro's
    city (not a sample). Raises if the API yields nothing at all."""
    rows, failed = [], []
    for metro in METROS:
        city, state = [p.strip() for p in metro.rsplit(",", 1)]
        for token, matcher, sub in PROBES:
            offset, total = 0, None
            while total is None or offset < total:
                try:
                    total, disp = _query(city, state, token, offset, timeout)
                except Exception as e:  # recorded, so a partial universe is never silent
                    failed.append(f"{metro} / {token} @ offset {offset}: {type(e).__name__}")
                    break
                if not disp:
                    break
                for npi, name, ptype in disp:
                    if matcher not in ptype:  # e.g. Interventional Radiology, technologists
                        continue
                    rows.append({"npi": int(npi), "name": _parse_name(name), "raw_name": name,
                                 "metro": metro, "subspecialty": sub})
                offset += len(disp)
    if not rows:
        raise RuntimeError("NLM NPI API returned no cardiologists")
    # a provider listed under two probes keeps the first (more specific) match
    df = pd.DataFrame(rows).drop_duplicates("npi").reset_index(drop=True)
    df.attrs["failed_queries"] = failed
    return df


def load_real_universe(seed: int = 42, timeout: int = 20) -> pd.DataFrame:
    from engine.generate_data import generate_from_identities

    return generate_from_identities(fetch_identities(timeout=timeout), seed=seed)


if __name__ == "__main__":
    d = fetch_identities()
    print(f"{len(d)} real cardiologists")
    print(d.groupby(["metro", "subspecialty"]).size().head(20))
