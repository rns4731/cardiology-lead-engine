"""Fictional news articles for the simulated modes, read back by the real pipeline.

    .venv/bin/python -m engine.news.fake          # writes data/cache/news_fake.json (LLM; cached)

The simulator already decides which (fictional) hospital systems had an employer event
and how long ago. Here Claude writes short local-news articles about those events, plus
distractors that must NOT produce an event -- denials of rumors, routine good news, an
event too old to count, and another organization's layoffs that mention the system in
passing. Then the same extractor used on real news reads every article, and its output
(not the simulator's truth) feeds the employer-disruption signal in Synthetic mode. Because the truth is known, extraction accuracy is measured.

Safety: every article only names the placeholder systems ("Austin System A"); people
appear by role only; a deny-list check rejects any text naming a real health system in
these metros. Articles are flagged fictional in the data and stamped so in the app.
"""
from __future__ import annotations

import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import numpy as np

from engine.news.extract import COUNTED_TYPES, extract, latest_counted, months_between
from engine.news.llm import USAGE, call_json, cost_usd

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(ROOT, "data", "cache", "news_fake.json")
SIM_ASOF = date(2026, 10, 1)   # the simulated "today" the fictional articles are dated against
OLD_MONTHS = 48                # an event this old is outside the 36-month window

# real organizations that a generated article must never name (health systems and big
# employers in or near the eight metros, national operators, and local outlets)
REAL_NAMES = [
    "HCA", "Ascension", "Seton", "St. David", "Baylor", "Scott & White", "Dell Seton", "Texas Health",
    "OhioHealth", "Mount Carmel", "Ohio State", "Wexner", "Nationwide Children",
    "Vanderbilt", "TriStar", "Saint Thomas", "Centennial", "Ascension Saint Thomas",
    "Atrium", "Novant", "Advocate", "Banner", "HonorHealth", "Dignity", "Abrazo", "Valleywise", "Mayo",
    "Tampa General", "BayCare", "AdventHealth", "Moffitt", "St. Joseph", "Orlando Health",
    "UCHealth", "HealthONE", "Centura", "CommonSpirit", "Intermountain", "Denver Health", "SCL Health",
    "Presbyterian/St. Luke", "WakeMed", "Duke", "UNC", "Rex", "Tenet", "Community Health Systems",
    "Kaiser", "Sutter", "Providence", "Trinity Health", "Steward", "Prospect Medical",
    "Austin American-Statesman", "Columbus Dispatch", "Tennessean", "Charlotte Observer", "Arizona Republic",
    "Tampa Bay Times", "Denver Post", "News & Observer", "Becker's", "Modern Healthcare",
]

GEN_SYSTEM = """You write short fictional local health-business news articles for a software test of a news-reading pipeline.

Hard rules:
- Name no real organization, publication, product, or person. The ONLY organization names you may use are the exact names given to you. Refer to any other party generically ("an out-of-state hospital operator", "a local software company").
- Refer to people only by role ("the system's chief executive", "a hospital spokesperson"). Never invent personal names.
- No real street addresses, no real hospital names, no real union or regulator names.
- Write 150 to 280 words in plain news style: a headline and a body of 3 to 5 short paragraphs. Include the date the article describes where natural.
- Follow the scenario exactly; do not add events the scenario doesn't contain."""

GEN_SCHEMA = {"type": "object", "properties": {"title": {"type": "string"}, "body": {"type": "string"}},
              "required": ["title", "body"], "additionalProperties": False}

EVENT_TEXT = {
    "acquisition": "has signed a definitive agreement to be acquired by a larger out-of-state hospital operator (do not name the buyer)",
    "merger": "has announced a merger with another regional health system from outside the metro (do not name the partner)",
    "financial distress": "has reported steep operating losses and had its credit rating downgraded, and is reviewing costs",
    "layoffs": "has announced layoffs of several hundred employees, including administrative and some clinical support roles",
}
TYPE_MAP = {"acquisition": "acquisition", "merger": "merger", "financial distress": "financial_distress",
            "layoffs": "layoffs"}
BACK = {v: k for k, v in TYPE_MAP.items()}


def _when(months_ago: float, salt: int) -> date:
    return SIM_ASOF - timedelta(days=int(round(months_ago * 30.44)) - salt % 9)


def specs(universe: str, frame) -> list[dict]:
    """Article scenarios for one simulated universe, from its generated frame."""
    ev = (frame.groupby(["metro", "employer"])[["disruption_event", "disruption_recency_months"]].first()
          .reset_index().sort_values(["metro", "employer"]))
    rng = np.random.default_rng(1 if universe == "synthetic" else 2)
    out = []
    for metro, grp in ev.groupby("metro", sort=True):
        city = metro.split(",")[0]
        quiet = []
        for _, r in grp.iterrows():
            sysname, e, mo = r["employer"], r["disruption_event"], int(r["disruption_recency_months"])
            base = {"universe": universe, "metro": metro, "city": city, "system": sysname}
            if e != "none":
                out.append({**base, "kind": "report", "event": e, "monthsAgo": mo,
                            "truth": {"event": e, "monthsAgo": mo}})
                out.append({**base, "kind": "followup", "event": e, "monthsAgo": max(0, mo - 2),
                            "truth": {"event": e, "monthsAgo": mo}})
            else:
                quiet.append(sysname)
        for i, sysname in enumerate(quiet):
            base = {"universe": universe, "metro": metro, "city": city, "system": sysname, "truth": None}
            kind = ["denial", "routine", "other_org"][int(rng.integers(0, 3))] if i == 0 else \
                ["routine", "other_org"][int(rng.integers(0, 2))]
            out.append({**base, "kind": kind, "event": str(rng.choice(list(EVENT_TEXT))), "monthsAgo": int(rng.integers(1, 30))})
        if quiet and rng.random() < 0.5:
            sysname = quiet[-1]
            out.append({"universe": universe, "metro": metro, "city": city, "system": sysname, "kind": "old",
                        "event": str(rng.choice(list(EVENT_TEXT))), "monthsAgo": OLD_MONTHS + int(rng.integers(0, 10)),
                        "truth": None})
    for i, s in enumerate(out):
        s["id"] = f"{universe}-{i:03d}"
        s["published"] = _when(s["monthsAgo"], i).isoformat()
        s["publisher"] = f"{s['city']} Health Wire (fictional)"
    return out


def _scenario(s: dict) -> str:
    sysname, e, pub = s["system"], s["event"], s["published"]
    names = f'Allowed organization name: "{sysname}". Article date: {pub}. City: {s["city"]}.'
    k = s["kind"]
    if k == "report":
        return f"{names}\nScenario: {sysname} {EVENT_TEXT[e]}. Report it as news announced this week."
    if k == "followup":
        return (f"{names}\nScenario: a follow-up story about how {sysname}'s {e} (announced about two months "
                f"earlier) is affecting staff, including cardiologists' uncertainty about their contracts.")
    if k == "old":
        return f"{names}\nScenario: {sysname} {EVENT_TEXT[e]}. Report it as news announced this week."
    if k == "denial":
        return (f"{names}\nScenario: rumors circulated online that {sysname} was planning {e}; a {sysname} "
                f"spokesperson firmly denies it and says there are no such plans. Nothing has happened.")
    if k == "routine":
        return (f"{names}\nScenario: {sysname} opens an expanded cardiac catheterization lab and is hiring nurses "
                f"and technologists. Positive, routine news; no layoffs, sale, merger or financial trouble.")
    return (f"{names}\nScenario: a local software company (unnamed) announces layoffs of 120 employees. "
            f"Mention {sysname} only in passing as one of the area's large employers that is still hiring. "
            f"Nothing negative happens to {sysname}.")


def _clean(text: str) -> list[str]:
    return [n for n in REAL_NAMES if re.search(r"\b" + re.escape(n) + r"\b", text, re.I)]


def write(s: dict) -> dict:
    for attempt in range(3):
        note = "" if attempt == 0 else f"\n(Attempt {attempt + 1}: the previous draft named a real organization. Use only the allowed name.)"
        out = call_json(GEN_SYSTEM, _scenario(s) + note, GEN_SCHEMA, tag="fake-articles-v1", effort="low")
        hits = _clean(out["title"] + " " + out["body"])
        if not hits and s["system"].lower() in (out["title"] + out["body"]).lower():
            return {**s, "title": out["title"], "text": out["body"], "fictional": True}
    raise RuntimeError(f"could not write a clean fictional article for {s['id']}")


def run(frames: dict) -> dict:
    """frames: universe -> generated frame. Writes articles, extracts, scores accuracy."""
    all_specs = [s for u, f in frames.items() for s in specs(u, f)]
    with ThreadPoolExecutor(max_workers=8) as ex:
        articles = list(ex.map(write, all_specs))

    def read(a: dict) -> list[dict]:
        f = frames[a["universe"]]
        systems = sorted(set(f.loc[f["metro"] == a["metro"], "employer"]))
        ents = [{"id": n, "name": n, "place": a["metro"]} for n in systems]
        return extract({**a, "published": a["published"]}, ents, tag="fake-extract")

    with ThreadPoolExecutor(max_workers=8) as ex:
        extracted = list(ex.map(read, articles))
    out = {"asof": SIM_ASOF.isoformat(), "model": "claude-opus-5-5", "universes": {}}
    for u, frame in frames.items():
        arts = [a for a in articles if a["universe"] == u]
        evs = [e for a, es in zip(articles, extracted) if a["universe"] == u for e in es]
        best = latest_counted(evs, SIM_ASOF)
        systems = (frame.groupby(["metro", "employer"])[["disruption_event", "disruption_recency_months"]]
                   .first().reset_index())
        result, rows = {}, []
        for _, r in systems.iterrows():
            truth = None if r["disruption_event"] == "none" else {"event": r["disruption_event"],
                                                                  "monthsAgo": int(r["disruption_recency_months"])}
            got = best.get(r["employer"])
            found = None if got is None else {"event": BACK.get(got["event_type"], got["event_type"].replace("_", " ")),
                                              "monthsAgo": got["monthsAgo"], "article": got["article"],
                                              "quote": got["evidence_quote"]}
            result[f"{r['metro']}|{r['employer']}"] = found
            rows.append({"metro": r["metro"], "system": r["employer"], "truth": truth, "extracted": found})
        tp = sum(1 for x in rows if x["truth"] and x["extracted"])
        fp = sum(1 for x in rows if not x["truth"] and x["extracted"])
        fn = sum(1 for x in rows if x["truth"] and not x["extracted"])
        typ = sum(1 for x in rows if x["truth"] and x["extracted"] and x["truth"]["event"] == x["extracted"]["event"])
        errs = [abs(x["truth"]["monthsAgo"] - x["extracted"]["monthsAgo"]) for x in rows if x["truth"] and x["extracted"]]
        out["universes"][u] = {
            "articles": arts, "events": evs, "bySystem": result, "comparison": rows,
            "accuracy": {"systems": len(rows), "withEvent": tp + fn, "found": tp, "missed": fn, "falseAlarms": fp,
                         "typeCorrect": typ, "meanMonthsError": round(float(np.mean(errs)), 2) if errs else None,
                         "articles": len(arts), "eventsExtracted": len(evs),
                         "eventsCounted": sum(1 for e in evs if e["counted"]),
                         "quoteFailures": sum(1 for e in evs if "quote not found verbatim in the article" in e["rejected"])},
        }
    return out


def load_fake() -> dict | None:
    if not os.path.exists(CACHE):
        return None
    with open(CACHE) as f:
        return json.load(f)


if __name__ == "__main__":
    from engine.generate_data import RNG_SEED, generate

    frames = {"synthetic": generate(n=1200, seed=RNG_SEED)}
    res = run(frames)
    with open(CACHE, "w") as f:
        json.dump(res, f, indent=1)
    for u, v in res["universes"].items():
        print(f"  {u:<9} {v['accuracy']}")
    print(f"LLM calls {USAGE['calls']} (+{USAGE['cached']} cached), ~${cost_usd():.2f} this run")
