"""Fetch REAL cardiologist identities from the public NPPES NPI Registry API.

Free, no auth, no PHI: https://npiregistry.cms.gov/api/ (public provider directory).
We pull real NPI, name, location, and subspecialty taxonomy, then overlay synthetic
behavioral signals (which are NOT public) via engine.generate_data. This is exactly
how the production pipeline would start: real identities, modeled propensity features.

Network-optional: callers should fall back to the pure-synthetic generator when the
API is unreachable (see run.py --real).
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request

import pandas as pd

from engine.generate_data import METROS

API = "https://npiregistry.cms.gov/api/"

# NPPES taxonomy description -> our canonical subspecialty
TAXONOMY_MAP = {
    "Interventional Cardiology": "Interventional",
    "Clinical Cardiac Electrophysiology": "Electrophysiology",
    "Advanced Heart Failure and Transplant Cardiology": "Advanced Heart Failure",
    "Cardiovascular Disease": "General cardiology",
    "Nuclear Cardiology": "Imaging",
}


def _subspecialty(taxonomies: list[dict]) -> str:
    """Prefer the primary taxonomy; map to a canonical subspecialty."""
    primary = next((t for t in taxonomies if t.get("primary")), None)
    desc = (primary or (taxonomies[0] if taxonomies else {})).get("desc", "")
    return TAXONOMY_MAP.get(desc)  # unmapped taxonomy -> None (skipped, never guessed)


def _query(city: str, state: str, limit: int, skip: int, timeout: int) -> list[dict]:
    params = {
        "version": "2.1",
        "taxonomy_description": "Cardiovascular Disease",  # broad; covers subspecialties
        "city": city,
        "state": state,
        "enumeration_type": "NPI-1",  # individuals, not orgs
        "limit": limit,
        "skip": skip,
    }
    url = API + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode()).get("results", [])


def fetch_identities(per_metro: int = 40, timeout: int = 15) -> pd.DataFrame:
    """Return real cardiologists across the configured metros.

    Raises urllib.error.URLError (or similar) if the API is unreachable -- callers
    decide whether to fall back to synthetic data.
    """
    out = []
    for metro in METROS:
        city, state = [p.strip() for p in metro.rsplit(",", 1)]
        fetched, skip = 0, 0
        while fetched < per_metro:
            batch = _query(city, state, min(200, per_metro - fetched), skip, timeout)
            if not batch:
                break
            for r in batch:
                sub = _subspecialty(r.get("taxonomies", []))
                if sub is None:
                    continue
                basic = r.get("basic", {})
                name = f"Dr. {basic.get('first_name','').title()} {basic.get('last_name','').title()}".strip()
                out.append(
                    {
                        "npi": int(r.get("number", 0)),
                        "name": name,
                        "metro": metro,
                        "subspecialty": sub,
                    }
                )
            fetched += len(batch)
            skip += len(batch)
    df = pd.DataFrame(out).drop_duplicates(subset="npi").reset_index(drop=True)
    if df.empty:
        raise RuntimeError("NPPES returned no records")
    return df


def load_real_universe(per_metro: int = 40, seed: int = 42, timeout: int = 15) -> pd.DataFrame:
    """Real identities + synthetic behavioral overlay -> a scorable universe."""
    from engine.generate_data import generate_from_identities

    identities = fetch_identities(per_metro=per_metro, timeout=timeout)
    return generate_from_identities(identities, seed=seed)


if __name__ == "__main__":
    print(fetch_identities(per_metro=5).head(10).to_string(index=False))
