"""Read one article with Claude, then verify what it claims before anything is used.

Claude returns structured events (organization, type, status, date, a verbatim quote).
Nothing is trusted on the model's word:
  - the evidence quote must appear verbatim in the article text (whitespace/quote-mark
    normalized) -- otherwise the event is rejected as unsupported;
  - the organization must be one of the candidate entities given (else "other");
  - rumored or denied events are kept for the record but never counted;
  - only the event types in the signal's definition (M&A, financial distress, layoffs --
    with bankruptcy and closure as distress) count toward employer disruption;
    leadership changes and service cuts are recorded but not counted.
Real and fictional articles go through this same code path.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date

from engine.news.llm import call_json

EVENT_TYPES = ["acquisition", "merger", "financial_distress", "layoffs", "bankruptcy", "closure",
               "leadership_change", "service_cut", "other"]
COUNTED_TYPES = {"acquisition", "merger", "financial_distress", "layoffs", "bankruptcy", "closure"}
COUNTED_STATUS = {"completed", "announced", "reported"}
WINDOW_MONTHS = 36
PROMPT_VERSION = "extract-v2"

SYSTEM = """You read one news article and extract employer-disruption events about specific healthcare organizations.

You are given a list of candidate organizations, each with an id. Report an event only when the article itself reports it about an organization; never infer events the article doesn't state.

For each event:
- entity_id: the candidate whose organization is the SUBJECT of the event -- the one being acquired, merging, in financial trouble, cutting jobs, closing, or changing top leadership. If the subject is an organization not in the candidate list (including an unnamed buyer, or an organization only mentioned in passing), use "other".
- event_type: acquisition (the organization is being bought or taken over), merger, financial_distress (operating losses, downgrades, missed covenants, cash problems), layoffs (job cuts or furloughs), bankruptcy, closure (a hospital or major unit closing), leadership_change (CEO/president departure or replacement), service_cut (a service line ended), or other.
- status: completed, announced (formally announced or agreed), reported (reported as fact by the article), rumored (unconfirmed or speculative), or denied (the organization denies it).
- event_date: when the EVENT itself happened or was announced -- not when the article was written. If the article mentions an older event in passing ("acquired the hospital in 2019", "since the 2021 merger"), use that date, even if only the year is known (YYYY). Use the article's publication date only for news the article itself is breaking. Format YYYY-MM-DD, YYYY-MM or YYYY. date_basis says which.
- background: true if the article mentions the event only as past background rather than reporting it as news.
- temporary: true for temporary disruptions -- closures from weather or power outages, brief pauses, short-term diversions.
- closure means a hospital, campus or major service line closing permanently. A single clinic or outpatient site closing is service_cut.
- evidence_quote: one short passage copied EXACTLY, character for character, from the article text that states the event. Do not paraphrase, merge sentences, or fix typos.
- confidence: high, medium or low.

Set relevant to false and return no events if the article reports no such event about any organization."""


def _schema(entity_ids: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "relevant": {"type": "boolean"},
            "events": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "entity_id": {"type": "string", "enum": entity_ids + ["other"]},
                        "organization_as_written": {"type": "string"},
                        "event_type": {"type": "string", "enum": EVENT_TYPES},
                        "status": {"type": "string", "enum": ["completed", "announced", "reported", "rumored", "denied"]},
                        "event_date": {"type": "string"},
                        "date_basis": {"type": "string", "enum": ["stated_in_article", "publication_date"]},
                        "background": {"type": "boolean"},
                        "temporary": {"type": "boolean"},
                        "evidence_quote": {"type": "string"},
                        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                    },
                    "required": ["entity_id", "organization_as_written", "event_type", "status", "event_date",
                                 "date_basis", "background", "temporary", "evidence_quote", "confidence"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["relevant", "events"],
        "additionalProperties": False,
    }


def _user(article: dict, entities: list[dict]) -> str:
    cands = "\n".join(f"- {e['id']}: {e['name']}" + (f" ({e['place']})" if e.get("place") else "") for e in entities)
    return (f"Candidate organizations:\n{cands}\n\n"
            f"Article\nTitle: {article['title']}\nPublisher: {article.get('publisher') or 'unknown'}\n"
            f"Published: {article.get('published') or 'unknown'}\n\n{article['text']}")


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace("–", "-").replace("—", "-").replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip().lower()


def parse_date(s: str, fallback: str | None) -> date | None:
    for v in (s, fallback):
        if not v:
            continue
        if re.fullmatch(r"\d{4}", v.strip()):
            return date(int(v), 7, 1)  # year only: mid-year
        m = re.match(r"(\d{4})-(\d{2})(?:-(\d{2}))?", v.strip())
        if m:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3) or 15)
            for day in (d, 28):
                try:
                    return date(y, mo, day)
                except ValueError:
                    continue
            return None
    return None


def months_between(earlier: date, later: date) -> float:
    return (later - earlier).days / 30.44


def extract(article: dict, entities: list[dict], *, tag: str) -> list[dict]:
    """Claude's events for one article, each annotated with verification results."""
    ids = [e["id"] for e in entities]
    out = call_json(SYSTEM, _user(article, entities), _schema(ids), tag=f"{tag}-{PROMPT_VERSION}")
    hay = norm(article["title"] + " \n " + article["text"])
    events = []
    for ev in out.get("events", []):
        quote_ok = len(norm(ev["evidence_quote"])) >= 12 and norm(ev["evidence_quote"]) in hay
        when = parse_date(ev["event_date"], article.get("published"))
        # a year named in the verbatim quote that is earlier than the claimed date wins:
        # "acquired the hospital in 2019" is a 2019 event, whenever the article ran
        years = [int(y) for y in re.findall(r"\b((?:19|20)\d{2})\b", ev["evidence_quote"])]
        if when and years and min(years) < when.year:
            when = date(min(years), 7, 1)
            ev = {**ev, "date_basis": "year_in_quote"}
        reasons = []
        if ev.get("temporary"):
            reasons.append("temporary disruption")
        if ev.get("background") and ev["date_basis"] == "publication_date":
            reasons.append("past event mentioned without its date")
        if not quote_ok:
            reasons.append("quote not found verbatim in the article")
        if ev["entity_id"] == "other":
            reasons.append("about an organization outside the candidate list")
        if ev["status"] not in COUNTED_STATUS:
            reasons.append(f"status is {ev['status']}")
        if ev["event_type"] not in COUNTED_TYPES:
            reasons.append(f"{ev['event_type'].replace('_', ' ')} is not part of this signal's definition")
        if when is None:
            reasons.append("no usable date")
        events.append({**ev, "article": article["id"], "date": when.isoformat() if when else None,
                       "verified": quote_ok and ev["entity_id"] != "other",
                       "counted": not reasons, "rejected": reasons})
    return events


SAME_EVENT_MONTHS = 6   # same organization + type within this span = one event, dated by its first report


def latest_counted(events: list[dict], asof: date) -> dict[str, dict]:
    """Most recent counted event per entity within the window, with months before `asof`.

    Follow-up coverage doesn't make an event newer: counted reports of the same type about
    the same organization within SAME_EVENT_MONTHS are one event, dated by the earliest."""
    clusters: dict[tuple, list[list[dict]]] = {}
    for ev in sorted((e for e in events if e["counted"]), key=lambda e: e["date"]):
        groups = clusters.setdefault((ev["entity_id"], ev["event_type"]), [])
        d = date.fromisoformat(ev["date"])
        if groups and months_between(date.fromisoformat(groups[-1][-1]["date"]), d) <= SAME_EVENT_MONTHS:
            groups[-1].append(ev)
        else:
            groups.append([ev])
    best: dict[str, dict] = {}
    for (entity, _), groups in clusters.items():
        for g in groups:
            first = g[0]
            m = months_between(date.fromisoformat(first["date"]), asof)
            if m < 0 or m > WINDOW_MONTHS:
                continue
            cur = best.get(entity)
            if cur is None or first["date"] > cur["date"]:
                best[entity] = {**first, "monthsAgo": round(m, 1), "reports": len(g),
                                "articles": [e["article"] for e in g]}
    return best
