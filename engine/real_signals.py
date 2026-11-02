"""The ten signals computed from real public data, one honest label per signal.

Each signal keeps the synthetic definition (engine/signals.py) and its 0-1 formula, but its
input comes from a real record. Where that record measures something slightly different,
the label says so:

  real        the input is exactly what the signal asks for
  stand-in    a real record of a closely related thing (e.g. years since graduation for
              years in practice) -- the difference is stated next to every value
  inferred    a real record put through a stated rule (e.g. "independent-style group" =
              a group whose cardiologists bill mostly in office settings)
  assumption  a real input through a fixed lookup whose values are assumptions
  none        no real source; the value is empty

Values are never imputed: a physician missing from a source gets an empty value for that
signal, not a default.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date

import numpy as np
import pandas as pd

from engine.generate_data import SUBSPECIALTIES
from engine.news.extract import WINDOW_MONTHS, latest_counted, months_between

INDEPENDENT_STYLE = 0.5     # a group is independent-style when its cardiologists' median office share is >= 50%
MIN_MEMBERS = 2             # ...measured on at least this many members with billing data
# words too generic to tie a group's name to a hospital's ("Seton Family of Doctors" ~ "Ascension Seton ...")
GENERIC = {"health", "healthcare", "medical", "medicine", "center", "centers", "hospital", "hospitals", "regional",
           "cardiology", "cardiovascular", "heart", "vascular", "group", "groups", "physicians", "physician", "associates",
           "clinic", "clinics", "family", "doctors", "university", "system", "systems", "services", "care", "network",
           "partners", "specialists", "specialty", "practice", "institute", "memorial", "general", "community", "saint",
           "south", "north", "east", "west", "central", "county", "city", "valley", "national", "american",
           "professional", "associated", "department"}
_WORD = __import__("re").compile(r"[a-z]{5,}")


# a group whose legal name says it is a hospital / system / university entity is hospital-linked outright
HOSPITAL_WORDS = __import__("re").compile(r"\b(hospital|medical center|health system|university|hospital authority|"
                                          r"health sciences|healthcare system|(provider|physicians?|medical|health) network)\b", __import__("re").I)


def _tokens(name: str) -> set[str]:
    return {w for w in _WORD.findall(name.lower().replace("'", "").replace("’", "")) if w not in GENERIC}

STATUS = {
    "disruption": ("stand-in",
                   "Real events about the physician's billing group or affiliated hospitals in the last 36 months: CMS "
                   "hospital change-of-ownership records, and news articles read by Claude (each event kept only if its "
                   "quote appears word for word in the article). Billing group and hospital affiliation stand in for the "
                   "employer; affiliation usually means privileges, not employment."),
    "career_stage": ("stand-in",
                     "Years since medical-school graduation (CMS Doctors & Clinicians), through the same curve. That is not "
                     "years in practice: cardiology training typically adds six to seven years after graduation."),
    "prior_independent": ("inferred",
                          "1 if, in any CMS snapshot since October 2019, the physician billed through an independent-style "
                          "group that isn't one of their current groups. Independent-style is inferred: a group whose "
                          "cardiologists bill mostly (at least half their services) in office settings, whose legal name doesn't "
                          "say hospital, medical center, health system, university or provider/physician network, and whose name "
                          "shares no distinctive "
                          "word with a hospital its members are affiliated with. Still a guess: some hospital-owned groups "
                          "will pass."),
    "subspecialty_econ": ("assumption",
                          "The fixed economics lookup applied to the real Medicare provider type. The provider type is "
                          "real; the lookup values are assumptions, not data."),
    "productivity": ("stand-in",
                     "Medicare work RVUs in 2024 (services billed per code × the code's CMS work RVU), as a percentile "
                     "among cardiologists billing Medicare in the seven states. Medicare only, and CMS suppresses lines "
                     "with fewer than 11 patients, so it understates all-payer productivity."),
    "peer_left": ("inferred",
                  "1 if a cardiologist who shared a billing group with the physician a year earlier has since joined an "
                  "independent-style group (CMS snapshots about 12 months apart; independent-style as defined under "
                  "Prior independent)."),
    "independent_density": ("inferred",
                            "Independent-style cardiology groups with a member billing from the city in the latest CMS "
                            "snapshot (as defined under Prior independent), ÷ 8 and capped at 1 (the synthetic formula)."),
    "recent_employer_change": ("stand-in",
                               "Months since the physician first appeared in a new billing group in the CMS snapshots "
                               "(about every six months since 2023, yearly before), through the same decay. A billing-group "
                               "change, not a confirmed change of employer."),
    "contract_window": ("none", None),
    "industry_engagement": ("real",
                            "CMS Open Payments general payments received in 2025, through the synthetic formula. Research "
                            "payments and ownership interests are separate CMS files and are not included."),
}


def office_share(svc_rows: list[dict]) -> pd.Series:
    df = pd.DataFrame(svc_rows)
    srv = pd.to_numeric(df["Tot_Srvcs"], errors="coerce").fillna(0.0)
    g = pd.DataFrame({"npi": df["Rndrng_NPI"].astype(str), "srv": srv,
                      "office": srv.where(df["Place_Of_Srvc"] == "O", 0.0)}).groupby("npi").sum()
    g = g[g["srv"] > 0]
    return g["office"] / g["srv"]


def work_rvus(svc_rows: list[dict], work: dict) -> pd.Series:
    df = pd.DataFrame(svc_rows)
    srv = pd.to_numeric(df["Tot_Srvcs"], errors="coerce").fillna(0.0)
    w = df["HCPCS_Cd"].map(lambda c: work.get(str(c).strip(), 0.0))
    return (srv * w).groupby(df["Rndrng_NPI"].astype(str)).sum()


class Directory:
    """CMS Doctors & Clinicians snapshots, indexed for the questions the signals ask."""

    def __init__(self, d: dict, share_by_year: dict[int, pd.Series]):
        self.dates = sorted(d["snapshots"])
        self.latest = self.dates[-1]
        self.names = d["hospitalNames"]
        f = d["fields"]
        self.groups = {}       # date -> npi -> set(pac)
        self.members = {}      # date -> pac -> set(npi)
        self.org_name = {}     # pac -> latest name
        self.row = {}          # npi -> latest row dict
        self.hospitals = {}    # date -> npi -> [ccn]
        for dt in self.dates:
            snap = d["snapshots"][dt]
            g, m = defaultdict(set), defaultdict(set)
            for row in snap["rows"]:
                r = dict(zip(f, row))
                self.row[r["npi"]] = r
                if r["orgPac"]:
                    g[r["npi"]].add(r["orgPac"])
                    m[r["orgPac"]].add(r["npi"])
                    self.org_name[r["orgPac"]] = r["orgName"]
                else:
                    g.setdefault(r["npi"], set())
            self.groups[dt], self.members[dt] = g, m
            self.hospitals[dt] = snap["hospitals"]
        self.style = {dt: self._styles(dt, share_by_year) for dt in self.dates}
        # cities each group bills from in the latest snapshot (a clinician can list several addresses)
        self.group_cities = defaultdict(set)
        for row in d["snapshots"][self.latest]["rows"]:
            r = dict(zip(f, row))
            if r["orgPac"]:
                self.group_cities[r["orgPac"]].add((r["city"], r["state"]))

    def _styles(self, dt: str, share_by_year: dict[int, pd.Series]) -> dict[str, str]:
        """Independent-style: the group's cardiologists bill mostly in office settings AND its name shares no
        distinctive word with a hospital its members are affiliated with (hospital-owned groups often carry the
        system's name). Hospital-style otherwise; unknown with too few members billing in the seven states."""
        share = share_by_year[2022 if dt < "2024-01-01" else 2024]
        hosp = self.hospitals[dt]
        out = {}
        for pac, npis in self.members[dt].items():
            vals = [share[n] for n in npis if n in share.index]
            if len(vals) < MIN_MEMBERS:
                out[pac] = "unknown"
                continue
            name = self.org_name.get(pac, "")
            words = _tokens(name)
            linked = bool(HOSPITAL_WORDS.search(name)) or any(
                words & _tokens(self.names.get(c, [""])[0]) for n in npis for c in hosp.get(n, ()))
            out[pac] = ("independent-style" if float(np.median(vals)) >= INDEPENDENT_STYLE and not linked
                        else "hospital-style")
        return out

    def year_before(self) -> str:
        target = pd.Timestamp(self.latest) - pd.DateOffset(months=12)
        return min(self.dates[:-1], key=lambda dt: abs((pd.Timestamp(dt) - target).days))


def _f(v: float | None) -> float | None:
    return None if v is None else round(float(v), 4)


def compute(npis: list[int], *, subspecialty: dict[int, str], city: dict[int, tuple[str, str]],
            directory: Directory | None,
            wrvu: pd.Series | None, payments: dict | None, news: dict | None,
            chow: list[dict], asof: date) -> tuple[dict, dict]:
    """Per-NPI signal values and facts. Returns ({npi: {key: value|None}}, {npi: {...facts}})."""
    values, facts = {}, {}
    wr_pct = wrvu.rank(pct=True) if wrvu is not None else None
    D = directory
    latest = D.latest if D else None
    prev = D.year_before() if D else None

    # independent-style groups billing from each city (latest snapshot)
    density = defaultdict(set)
    if D:
        for pac, cities in D.group_cities.items():
            if D.style[latest].get(pac) == "independent-style":
                for c in cities:
                    density[c].add(pac)

    # news: verified counted events per entity, mapped from every merged id to the entity
    alias, best_news, ent_name, articles = {}, {}, {}, {}
    if news:
        for e in news["entities"]:
            for i in e["ids"]:
                alias[i] = e["id"]
            ent_name[e["id"]] = e["name"]
        best_news = latest_counted(news["events"], asof)
        articles = {a["id"]: a for a in news["articles"]}
    chow_by_ccn = defaultdict(list)
    for e in chow:
        d = pd.to_datetime(e.get("EFFECTIVE DATE"), errors="coerce")
        if pd.isna(d):
            continue
        for ccn in {e.get("CCN - SELLER"), e.get("CCN - BUYER")}:
            if ccn:
                chow_by_ccn[ccn].append((d.date(), e))

    for npi in npis:
        s = str(npi)
        v, fx = {k: None for k in STATUS}, {}
        ev_list = []

        # subspecialty economics -- lookup (assumption) on the real provider type
        sub = subspecialty[npi]
        if sub in SUBSPECIALTIES:
            v["subspecialty_econ"] = SUBSPECIALTIES[sub][1]
            fx["subspecialty_econ"] = f"{sub} → lookup value {SUBSPECIALTIES[sub][1]:.2f}"

        # productivity -- Medicare work RVUs, percentile
        if wrvu is not None and s in wrvu.index:
            v["productivity"] = _f(wr_pct[s])
            fx["productivity"] = f"{wrvu[s]:,.0f} Medicare work RVUs in 2024 ({wr_pct[s] * 100:.0f}th percentile)"

        # industry engagement -- Open Payments (absence = no general payments reported)
        if payments is not None:
            p = payments["payments"].get(s)
            usd = p["usd"] if p else 0.0
            v["industry_engagement"] = _f(min(max((math.log(usd + 1) - 5) / 5, 0), 1))
            fx["industry_engagement"] = (f"${usd:,.0f} in {p['count']} general payment{'s' if p['count'] != 1 else ''} "
                                         f"({payments['year']})" if p else f"No general payments reported for {payments['year']}")

        if D and s in D.row:
            r = D.row[s]
            # career stage -- years since graduation (stand-in for years in practice)
            if r["grad"].isdigit():
                yrs = asof.year - int(r["grad"])
                v["career_stage"] = _f(math.exp(-(((yrs - 15) / 8.0) ** 2)))
                fx["career_stage"] = f"Graduated {r['grad']} ({yrs} years ago)"

            cur_groups = D.groups[latest].get(s, set())
            # prior independent -- an earlier independent-style group they've left
            seen, indep = False, []
            for dt in D.dates[:-1]:
                for pac in D.groups[dt].get(s, ()):
                    st = D.style[dt].get(pac, "unknown")
                    if st != "unknown":
                        seen = True
                    if st == "independent-style" and pac not in cur_groups:
                        indep.append((dt, pac))
            if indep:
                dt, pac = indep[-1]
                v["prior_independent"] = 1.0
                fx["prior_independent"] = f"Billed through {D.org_name.get(pac, pac).title()} (independent-style) as of {dt}"
            elif seen:
                v["prior_independent"] = 0.0
                fx["prior_independent"] = f"No independent-style group in CMS snapshots since {D.dates[0]}"

            # recent employer change -- first appearance in a new billing group
            change, first_seen = None, None
            for a, b in zip(D.dates, D.dates[1:]):
                if s in D.groups[a] and first_seen is None:
                    first_seen = a
                if s in D.groups[a] and s in D.groups[b]:
                    new = D.groups[b][s] - D.groups[a][s]
                    if new:
                        change = (b, sorted(new))
            if change:
                mo = months_between(date.fromisoformat(change[0]), asof)
                v["recent_employer_change"] = _f(math.exp(-mo / 18.0))
                names = ", ".join(D.org_name.get(p, p).title() for p in change[1])
                fx["recent_employer_change"] = f"First listed with {names} in the {change[0]} snapshot (~{mo:.0f} months ago)"
            elif first_seen:
                mo = months_between(date.fromisoformat(first_seen), asof)
                v["recent_employer_change"] = _f(math.exp(-mo / 18.0))
                fx["recent_employer_change"] = f"No new billing group since {first_seen} (at least {mo:.0f} months)"

            # peer left -- a year-earlier group colleague now in an independent-style group
            prev_groups = D.groups[prev].get(s, set())
            if prev_groups:
                colleagues = {n for pac in prev_groups for n in D.members[prev].get(pac, ())} - {s}
                moved = sorted(n for n in colleagues
                               if any(D.style[latest].get(p) == "independent-style"
                                      for p in D.groups[latest].get(n, set()) - D.groups[prev].get(n, set())))
                v["peer_left"] = 1.0 if moved else 0.0
                fx["peer_left"] = (f"{len(moved)} of {len(colleagues)} cardiologists from their {prev} billing group(s) "
                                   f"joined an independent-style group by {latest}")

            # independent density -- independent-style groups billing from the city
            c, st_ = city[npi]
            n_ind = len(density.get((c, st_), ()))
            v["independent_density"] = _f(min(n_ind / 8.0, 1.0))
            fx["independent_density"] = (f"{n_ind} independent-style cardiology group{'s' if n_ind != 1 else ''} "
                                         f"billing from {c.title()} ({latest})")

            # disruption -- news (group or hospital) + CMS ownership changes (hospital)
            hosp = D.hospitals[latest].get(s, [])
            ids = [("billing group", f"group:{p}") for p in sorted(cur_groups)] + \
                  [("affiliated hospital", f"hosp:{c}") for c in hosp]
            for via, i in ids:
                ent = alias.get(i)
                ev = best_news.get(ent) if ent else None
                if ev:
                    a = articles.get(ev["article"], {})
                    ev_list.append({"kind": "news", "via": via, "entity": ent_name.get(ent, ent), "type": ev["event_type"],
                                    "date": ev["date"], "monthsAgo": ev["monthsAgo"], "quote": ev["evidence_quote"],
                                    "status": ev["status"], "title": a.get("title"), "publisher": a.get("publisher"),
                                    "url": a.get("finalUrl") or a.get("url"), "reports": ev["reports"]})
            for c in hosp:
                for d, e in chow_by_ccn.get(c, []):
                    mo = months_between(d, asof)
                    if 0 <= mo <= WINDOW_MONTHS:
                        name = D.names.get(c, [c])[0]
                        ev_list.append({"kind": "cms", "via": "affiliated hospital", "entity": name.title(),
                                        "type": "acquisition", "date": d.isoformat(), "monthsAgo": round(mo, 1),
                                        "quote": f"CMS change of ownership: {str(e.get('ORGANIZATION NAME - SELLER') or '').title()} → "
                                                 f"{str(e.get('ORGANIZATION NAME - BUYER') or '').title()} ({e.get('CHOW TYPE TEXT') or 'change of ownership'})",
                                        "status": "completed", "title": None, "publisher": "CMS Hospital Change of Ownership",
                                        "url": None, "reports": 1})
            if ids:
                if ev_list:
                    top = min(ev_list, key=lambda e: e["monthsAgo"])
                    v["disruption"] = _f(math.exp(-top["monthsAgo"] / 12.0))
                    fx["disruption"] = (f"{top['type'].replace('_', ' ').capitalize()} at {top['entity']} "
                                        f"({top['via']}), {top['monthsAgo']:.0f} months ago")
                elif news is not None:
                    v["disruption"] = 0.0
                    fx["disruption"] = (f"No qualifying event in 36 months of news or CMS ownership records for "
                                        f"{len(cur_groups)} billing group(s) and {len(hosp)} affiliated hospital(s)")
        values[npi] = v
        facts[npi] = {"text": fx, "evidence": sorted(ev_list, key=lambda e: e["monthsAgo"])}
        if D and s in D.row:
            facts[npi]["groups"] = [{"pac": p, "name": D.org_name.get(p, p).title(),
                                     "style": D.style[latest].get(p, "unknown"),
                                     "size": len(D.members[latest].get(p, ()))} for p in sorted(D.groups[latest].get(s, ()))]
            facts[npi]["hospitals"] = [{"ccn": c, "name": D.names.get(c, [c])[0].title()}
                                       for c in D.hospitals[latest].get(s, [])]
            facts[npi]["grad"] = D.row[s]["grad"]
    return values, facts
