"""Integrity validator for exported web bundles.

    .venv/bin/python -m engine.bundle_check          # validate every bundle on disk

One validator, three callers: the exporter (refuses to write a broken bundle), the
pytest suite, and scripts/smoke.sh. Returns a list of human-readable problems;
an empty list means the bundle is internally consistent.
"""
from __future__ import annotations

import json
import math
import os
import sys

FORBIDDEN_LEAD_KEYS = {"willMove24mo", "will_move_24mo", "label", "outcome",
                       "latentSignal", "latent_signal"}
TIMING = {"Now", "Near", "Later", "Watch"}


def _walk_numbers(obj, path="$"):
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            yield path
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from _walk_numbers(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk_numbers(v, f"{path}[{i}]")


# fields that only make sense with a score; a real-data bundle must never carry them
SCORE_KEYS = {"propensity", "timingScore", "timingBucket", "rank", "percentile", "rankInMetro",
              "contributions", "timingParts", "reasons", "group", "candidateGroups"}


def validate_real(b: dict) -> list[str]:
    """Real-data bundle: real records only, every signal empty, nothing scored."""
    from engine.signals import SIGNALS

    p: list[str] = []
    for key in ["schemaVersion", "kind", "source", "universe", "prediction", "signals", "metros", "leads"]:
        if key not in b:
            p.append(f"missing top-level key: {key}")
    if p:
        return p
    leads = {l["npi"]: l for l in b["leads"]}
    metros = {m["slug"]: m for m in b["metros"]}
    if len(leads) != len(b["leads"]):
        p.append("duplicate npi in leads")
    if b["source"]["count"] != len(b["leads"]):
        p.append("source.count does not match number of leads")
    if b["prediction"].get("available") is not False:
        p.append("real-data bundle claims a prediction")
    if len(b["signals"]) != len(SIGNALS) or {s["key"] for s in b["signals"]} != set(SIGNALS):
        p.append("signal list differs from the ten catalog signals")
    for s in b["signals"]:
        if s.get("status") != "none" or not s.get("missing"):
            p.append(f"signal {s['key']} is not marked empty with a reason")
    for bad in _walk_numbers(b):
        p.append(f"NaN/Inf at {bad}")
        break
    t = b["universe"]["threshold"]
    for n, l in leads.items():
        if SCORE_KEYS & set(l) or FORBIDDEN_LEAD_KEYS & set(l):
            p.append(f"lead {n} carries score/outcome fields {sorted((SCORE_KEYS | FORBIDDEN_LEAD_KEYS) & set(l))}")
        if set(l["values"]) != set(SIGNALS) or any(v is not None for v in l["values"].values()):
            p.append(f"lead {n} has a signal value with no real source")
        if l["metroSlug"] not in metros:
            p.append(f"lead {n} -> unknown metro {l['metroSlug']}")
        if not 0 <= l["officeShare"] <= t:
            p.append(f"lead {n} office share {l['officeShare']} outside the hospital-based rule")
        for m in l["sameAddress"]:
            if m not in leads or m == n:
                p.append(f"lead {n} sameAddress -> bad npi {m}")
    if sum(m["total"] for m in b["metros"]) != len(leads):
        p.append("metro totals do not sum to the number of leads")
    for m in b["metros"]:
        if sum(m["mix"].values()) != m["total"]:
            p.append(f"metro {m['slug']} mix does not sum to its total")
        if m["total"] > m["billing"]:
            p.append(f"metro {m['slug']} lists more hospital-based than billing cardiologists")
        if m["total"] != sum(1 for l in leads.values() if l["metroSlug"] == m["slug"]):
            p.append(f"metro {m['slug']} total does not match its leads")
    return p


def validate(b: dict) -> list[str]:
    if b.get("kind") == "real-data":
        return validate_real(b)
    p: list[str] = []
    for key in ["schemaVersion", "source", "meta", "signals", "metros", "systems",
                "groups", "sweep", "leads"]:
        if key not in b:
            p.append(f"missing top-level key: {key}")
    if p:
        return p

    leads = {l["npi"]: l for l in b["leads"]}
    groups = {g["id"]: g for g in b["groups"]}
    metros = {m["slug"]: m for m in b["metros"]}
    systems = {s["slug"]: s for s in b["systems"]}
    weights = b["meta"]["weights"]

    if len(leads) != len(b["leads"]):
        p.append("duplicate npi in leads")
    if b["source"]["count"] != len(b["leads"]):
        p.append("source.count does not match number of leads")
    if sum(weights.values()) != 100:
        p.append(f"weights sum to {sum(weights.values())}, expected 100")
    if {s["key"] for s in b["signals"]} != set(weights):
        p.append("signal catalog keys differ from scoring weights")
    for bad in _walk_numbers(b):
        p.append(f"NaN/Inf at {bad}")
        break

    floor = b["meta"]["operatingFloor"]
    min_n = b["meta"].get("minN", 20)
    buckets = b["meta"]["timing"]["buckets"]

    # disclosure control: outcome aggregates over top-n prefixes must be >= min_n and
    # pairwise >= min_n apart, or individual outcomes fall out by subtraction
    m = b["meta"]["metrics"]
    sizes = sorted({int(k) for k, v in m["precision"].items() if v is not None}
                   | {r["qualified"] for r in b["sweep"] if r["precision"] is not None})
    if any(s < min_n for s in sizes):
        p.append(f"outcome aggregate over fewer than {min_n} leads: sizes {sizes}")
    if any(0 < y - x < min_n for x, y in zip(sizes, sizes[1:])):
        p.append(f"published top-n outcome sets closer than {min_n} leads: sizes {sizes}")
    for s in b["signals"]:
        inactive = m["n"] - s["activeCount"]
        if (s["moveRateActive"] is not None and s["activeCount"] < min_n) or \
           (s["moveRateInactive"] is not None and inactive < min_n):
            p.append(f"signal {s['key']} publishes a move rate over fewer than {min_n} leads")

    gids = [g["id"] for g in b["groups"]]
    if len(gids) != len(set(gids)):
        p.append("duplicate group ids")
    min_group, max_size = b["meta"]["viability"]["minGroup"], b["meta"]["viability"]["maxSize"]
    seen_members: set[int] = set()
    for g in b["groups"]:
        if not (min_group <= len(g["members"]) <= max_size):
            p.append(f"group {g['id']} has {len(g['members'])} members")
        if g["metroSlug"] not in metros:
            p.append(f"group {g['id']} -> unknown metro {g['metroSlug']}")
        if g["anchorSlug"] not in systems:
            p.append(f"group {g['id']} -> unknown anchor system {g['anchorSlug']}")
        if not (0 <= g["viability"] <= 100):
            p.append(f"group {g['id']} viability {g['viability']} out of range")
        for n in g["members"]:
            if n in seen_members:
                p.append(f"npi {n} is a member of more than one group")
            seen_members.add(n)
            l = leads.get(n)
            if l is None:
                p.append(f"group {g['id']} member {n} not in leads")
            elif l["group"] != g["id"] or l["metro"] != g["metro"] or l["propensity"] < floor:
                p.append(f"group {g['id']} member {n} inconsistent (group/metro/floor)")

    for l in b["leads"]:
        n = l["npi"]
        if FORBIDDEN_LEAD_KEYS & set(l):
            p.append(f"lead {n} exposes the hidden outcome label")
        if l["metroSlug"] not in metros:
            p.append(f"lead {n} -> unknown metro {l['metroSlug']}")
        if l["systemSlug"] not in systems:
            p.append(f"lead {n} -> unknown system {l['systemSlug']}")
        if l["timingBucket"] not in TIMING:
            p.append(f"lead {n} has timing bucket {l['timingBucket']}")
        elif next(x["name"] for x in buckets if l["timingScore"] >= x["min"]) != l["timingBucket"]:
            p.append(f"lead {n} shows readiness {l['timingScore']} but bucket {l['timingBucket']}")
        if l["group"] is not None and l["group"] not in groups:
            p.append(f"lead {n} -> unknown group {l['group']}")
        elif l["group"] is not None and n not in groups[l["group"]]["members"]:
            p.append(f"lead {n} claims group {l['group']} but is not a member")
        if set(l["contributions"]) != set(weights):
            p.append(f"lead {n} contribution keys differ from weights")
        if abs(sum(l["contributions"].values()) - l["propensity"]) > 0.11:
            p.append(f"lead {n} contributions do not sum to propensity")
        for c in l["candidateGroups"]:
            g = groups.get(c["group"])
            if g is None or g["metro"] != l["metro"]:
                p.append(f"lead {n} candidate group {c['group']} missing or in another metro")
            elif (c["status"] == "member") != (n in g["members"]):
                p.append(f"lead {n} candidate status for {c['group']} contradicts membership")
            elif c["status"] == "below_floor" and l["propensity"] >= floor:
                p.append(f"lead {n} marked below floor but qualifies")
            elif c["status"] == "eligible" and l["group"] is not None:
                p.append(f"lead {n} is 'eligible' for {c['group']} but already in {l['group']}")
            elif c["status"] == "member_elsewhere" and l["group"] in (None, c["group"]):
                p.append(f"lead {n} 'member_elsewhere' for {c['group']} contradicts membership")
        for kind, rel in l["related"].items():
            for r in rel:
                other = leads.get(r["npi"])
                if other is None or r["npi"] == n:
                    p.append(f"lead {n} related.{kind} -> invalid npi {r['npi']}")
                elif other["metro"] != l["metro"]:
                    p.append(f"lead {n} related.{kind} crosses metros")
                elif kind == "colleagues" and other["employer"] != l["employer"]:
                    p.append(f"lead {n} colleague {r['npi']} has a different employer")
                elif kind == "complements" and other["subspecialty"] == l["subspecialty"]:
                    p.append(f"lead {n} complement {r['npi']} shares their subspecialty")
        if len(p) > 50:
            p.append("... (truncated)")
            break

    for m in b["metros"]:
        for gid in m["groups"]:
            if gid not in groups:
                p.append(f"metro {m['slug']} -> unknown group {gid}")
        for s in m["systems"]:
            if s not in systems:
                p.append(f"metro {m['slug']} -> unknown system {s}")
        if m["grouped"] + m["bench"] != m["qualified"]:
            p.append(f"metro {m['slug']} grouped + bench != qualified")
        if m["qualified"] == 0 and m["readyShare"] is not None:
            p.append(f"metro {m['slug']} reports a ready share with nobody qualified")
    for s in b["signals"]:
        for n in s["top"]:
            if n not in leads:
                p.append(f"signal {s['key']} top npi {n} not in leads")
    floors = [r["floor"] for r in b["sweep"]]
    if floors != sorted(floors):
        p.append("sweep floors not ascending")
    q = [r["qualified"] for r in b["sweep"]]
    if any(a < bq for a, bq in zip(q, q[1:])):
        p.append("sweep qualified count increases with the floor")
    return p


def main() -> int:
    from engine.export_web import OUT, SCHEMA_VERSION

    manifest_path = os.path.join(OUT, "manifest.json")
    if not os.path.exists(manifest_path):
        print("no manifest -- run: .venv/bin/python -m engine.export_web")
        return 1
    with open(manifest_path) as f:
        manifest = json.load(f)
    bad = 0
    for s in manifest["sources"]:
        if not s["available"]:
            print(f"  {s['id']:<9} not available (skipped)")
            continue
        with open(os.path.join(OUT, s["id"], "bundle.json")) as f:
            b = json.load(f)
        probs = validate(b)
        if b.get("schemaVersion") != SCHEMA_VERSION:
            probs.insert(0, f"schemaVersion {b.get('schemaVersion')} != {SCHEMA_VERSION}")
        status = "OK" if not probs else f"{len(probs)} problem(s)"
        print(f"  {s['id']:<9} {len(b['leads']):>5} {'records' if b.get('kind') == 'real-data' else 'leads  '}  {status}")
        for pr in probs[:20]:
            print(f"      - {pr}")
        bad += bool(probs)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
