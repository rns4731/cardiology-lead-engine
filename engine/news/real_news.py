"""Real news about the listed cardiologists' billing groups and affiliated hospitals.

    .venv/bin/python -m engine.news.real_news      # network + Claude; writes data/cache/news_real.json

1. Entities: each listed cardiologist's billing group(s), and affiliated hospitals with at least
   three listed cardiologists, from the latest CMS Doctors & Clinicians snapshot
   (engine/cms_directory.py); duplicates by name merge.
2. Discover: Google News RSS search per entity -- the name plus disruption terms, last 36
   months. Headline, publisher, date and link only.
3. Fetch: each article in real Chrome (Google News links resolve to the publisher only in a
   browser); main text extracted with trafilatura. Paywalled or blocked pages fall back to
   the headline. Full text stays in data/raw/news (git-ignored); the app gets only the link,
   the headline and Claude's short verbatim quote.
4. Read + verify: engine/news/extract.py (same code as the fictional articles).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime

from engine.news.extract import WINDOW_MONTHS, extract
from engine.news.llm import USAGE, LLMError, cost_usd
from engine.public_fetch import UA

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(ROOT, "data", "raw", "news")
CACHE = os.path.join(ROOT, "data", "cache", "news_real.json")
TERMS = ('(layoffs OR "job cuts" OR acquisition OR acquire OR acquired OR merger OR "operating loss" OR '
         'downgrade OR bankruptcy OR closing OR closure OR "chief executive" OR CEO)')
PER_ENTITY = 10
MIN_HOSPITAL_CARDIOLOGISTS = 3   # every billing group is searched; hospitals only when >= 3 listed cardiologists are affiliated
_SUFFIX = re.compile(r"\b(INC|LLC|L L C|PLLC|PC|P C|PA|P A|LLP|LTD|CORP|CORPORATION|CO|COMPANY|THE)\b\.?", re.I)


def clean_name(name: str) -> str:
    n = _SUFFIX.sub(" ", name.replace(",", " ").replace(".", " "))
    return re.sub(r"\s+", " ", n).strip().title()


def entities(universe_npis: set[int], directory: dict) -> list[dict]:
    """Billing groups and affiliated hospitals of the listed cardiologists (latest snapshot)."""
    snap = directory["snapshots"][max(directory["snapshots"])]
    f = directory["fields"]
    names = directory["hospitalNames"]
    by_name: dict[str, dict] = {}

    def add(eid: str, raw_name: str, place: str, npi: int, kind: str):
        key = clean_name(raw_name).lower()
        if len(key) < 4:
            return
        e = by_name.setdefault(key, {"id": eid, "ids": [], "name": clean_name(raw_name), "place": place,
                                     "kinds": set(), "npis": set()})
        if eid not in e["ids"]:
            e["ids"].append(eid)
        e["kinds"].add(kind)
        e["npis"].add(npi)

    for row in snap["rows"]:
        r = dict(zip(f, row))
        npi = int(r["npi"])
        if npi in universe_npis and r["orgPac"] and r["orgName"]:
            add(f"group:{r['orgPac']}", r["orgName"], f"{r['city'].title()}, {r['state']}", npi, "billing group")
    for npi_s, ccns in snap["hospitals"].items():
        npi = int(npi_s)
        if npi not in universe_npis:
            continue
        for ccn in ccns:
            if ccn in names:
                n, city, st = names[ccn][:3]
                add(f"hosp:{ccn}", n, f"{city.title()}, {st}", npi, "affiliated hospital")
    out = []
    for e in by_name.values():
        if "billing group" not in e["kinds"] and len(e["npis"]) < MIN_HOSPITAL_CARDIOLOGISTS:
            continue
        out.append({**e, "kinds": sorted(e["kinds"]), "npis": sorted(e["npis"])})
    return sorted(out, key=lambda e: (-len(e["npis"]), e["name"]))


def _rss(query: str) -> list[dict]:
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": query, "hl": "en-US", "gl": "US", "ceid": "US:en"})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                root = ET.fromstring(r.read())
            break
        except Exception:
            if attempt == 3:
                return []
            time.sleep(2 ** attempt)
    items = []
    for it in root.iter("item"):
        src = it.find("source")
        try:
            pub = parsedate_to_datetime(it.findtext("pubDate")).date().isoformat()
        except Exception:
            pub = None
        title = it.findtext("title") or ""
        publisher = src.text if src is not None else ""
        if publisher and title.endswith(" - " + publisher):
            title = title[: -len(" - " + publisher)]
        items.append({"title": title, "url": it.findtext("link"), "published": pub, "publisher": publisher})
    return items


def discover(ents: list[dict], asof: date) -> list[dict]:
    start = date(asof.year - WINDOW_MONTHS // 12, asof.month, min(asof.day, 28)).isoformat()
    heads: dict[str, dict] = {}

    def one(e):
        time.sleep(0.5)
        return e, _rss(f'"{e["name"]}" {TERMS} after:{start}')

    with ThreadPoolExecutor(max_workers=4) as ex:
        for e, items in ex.map(one, ents):
            for it in items[:PER_ENTITY]:
                hid = hashlib.sha1((it["title"] + "|" + (it["publisher"] or "")).encode()).hexdigest()[:16]
                h = heads.setdefault(hid, {**it, "id": hid, "entities": []})
                if e["id"] not in h["entities"]:
                    h["entities"].append(e["id"])
    return list(heads.values())


def fetch(heads: list[dict]) -> dict[str, dict]:
    os.makedirs(RAW, exist_ok=True)
    todo = os.path.join(RAW, "todo.json")
    pages = os.path.join(RAW, "pages.jsonl")
    with open(todo, "w") as f:
        json.dump([{"id": h["id"], "url": h["url"]} for h in heads], f)
    subprocess.run(["node", os.path.join(ROOT, "scripts", "fetch_pages.cjs"), todo, pages, "6"], check=True)
    import trafilatura

    out = {}
    for line in open(pages):
        rec = json.loads(line)
        text = trafilatura.extract(rec["html"], include_comments=False, include_tables=False) if rec.get("html") else None
        out[rec["id"]] = {"finalUrl": rec.get("finalUrl"), "text": (text or "")[:14000]}
    return out


def run(universe_npis: set[int], directory: dict, asof: date | None = None, refresh: bool = False) -> dict:
    """refresh=False reuses the saved search results (data/raw/news/headlines.json) and fetched pages,
    so re-reading with a new extraction prompt doesn't change which articles are read."""
    saved = os.path.join(RAW, "headlines.json")
    ents = entities(universe_npis, directory)
    if os.path.exists(saved) and not refresh:
        with open(saved) as f:
            snap = json.load(f)
        heads, asof = snap["headlines"], date.fromisoformat(snap["asof"])
    else:
        asof = asof or date.today()
        heads = discover(ents, asof)
        os.makedirs(RAW, exist_ok=True)
        with open(saved, "w") as f:
            json.dump({"asof": asof.isoformat(), "headlines": heads}, f)
    print(f"  {len(ents)} entities -> {len(heads)} distinct headlines")
    pages = fetch(heads)
    ent_by_id = {e["id"]: e for e in ents}
    by_place = defaultdict(list)
    for e in ents:
        by_place[e["place"]].append(e)

    articles = []
    for h in heads:
        p = pages.get(h["id"], {})
        body = p.get("text") or ""
        full = len(body) >= 400
        articles.append({**h, "finalUrl": p.get("finalUrl") or h["url"], "text": body if full else h["title"],
                         "fullText": full, "readError": None})

    def read(a: dict) -> list[dict]:
        places = {ent_by_id[i]["place"] for i in a["entities"]}
        cands = {e["id"]: e for pl in places for e in by_place[pl]}
        for i in a["entities"]:
            cands[i] = ent_by_id[i]
        try:
            return extract(a, [{"id": e["id"], "name": e["name"], "place": e["place"]} for e in cands.values()],
                           tag="real-extract")
        except LLMError as e:  # declined or truncated: the article stays unread, and says so
            a["readError"] = str(e)
            return []

    with ThreadPoolExecutor(max_workers=8) as ex:
        extracted = list(ex.map(read, articles))
    events = [e for es in extracted for e in es]
    for a in articles:
        a.pop("text")  # never ship article text
    return {
        "asof": asof.isoformat(), "model": "claude-opus-5-5",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "entities": ents, "articles": articles, "events": events,
        "stats": {"entities": len(ents), "headlines": len(heads),
                  "fullText": sum(1 for a in articles if a["fullText"]),
                  "headlineOnly": sum(1 for a in articles if not a["fullText"]),
                  "unread": sum(1 for a in articles if a["readError"]),
                  "eventsExtracted": len(events), "verified": sum(1 for e in events if e["verified"]),
                  "counted": sum(1 for e in events if e["counted"])},
    }


def load_real_news() -> dict | None:
    if not os.path.exists(CACHE):
        return None
    with open(CACHE) as f:
        return json.load(f)


if __name__ == "__main__":
    from engine.cms_directory import load_directory
    from engine.real_data import universe_npis

    import sys

    res = run(universe_npis(), load_directory(), refresh="--refresh" in sys.argv)
    with open(CACHE, "w") as f:
        json.dump(res, f, indent=1)
    print(f"  {res['stats']}")
    print(f"LLM calls {USAGE['calls']} (+{USAGE['cached']} cached), ~${cost_usd():.2f} this run")
