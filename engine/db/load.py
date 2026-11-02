"""Store the engine's data in Postgres: the cached public pulls (CMS Medicare + hospital
ownership) and every bundle the exporter wrote.

    .venv/bin/python -m engine.db.load          # local (DATABASE_URL, default localhost:5432)
    docker compose run --rm loader              # inside Docker

Idempotent: each pull and each bundle is keyed by a hash of its content, so a re-run
stores nothing new and a changed pull or re-export becomes a new, dated snapshot.
Refuses to run unless the schema is at the latest Alembic revision, and refuses any
bundle that fails the contract validator or carries the hidden label.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import sys
import time
from collections.abc import Iterable
from datetime import date, datetime
from decimal import Decimal

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import func, insert, select
from sqlalchemy.engine import Connection
from sqlalchemy.exc import SQLAlchemyError

from engine.bundle_check import FORBIDDEN_LEAD_KEYS, validate
from engine.db import get_engine
from engine.db.models import (
    Cohort,
    CohortMember,
    ExportManifest,
    ExportRun,
    IngestRun,
    Lead,
    LeadContribution,
    MetroSummary,
    Signal,
)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ALEMBIC_INI = os.path.join(ROOT, "alembic.ini")
CMS_CACHE = os.path.join(ROOT, "data", "cache", "public_raw.json.gz")
BUNDLES = os.path.join(ROOT, "web", "public", "data")

# raw CMS column -> (table column, kind). The read side inverts these to rebuild the cache.
PRV = {"Rndrng_NPI": ("npi", "npi"), "Rndrng_Prvdr_Last_Org_Name": ("last_name", "text"),
       "Rndrng_Prvdr_First_Name": ("first_name", "text"), "Rndrng_Prvdr_St1": ("street", "text"),
       "Rndrng_Prvdr_City": ("city", "text"), "Rndrng_Prvdr_State_Abrvtn": ("state", "text"),
       "Rndrng_Prvdr_Zip5": ("zip5", "text"), "Rndrng_Prvdr_Type": ("provider_type", "text"),
       "Tot_Benes": ("total_beneficiaries", "num"), "Tot_Srvcs": ("total_services", "num"),
       "Tot_Mdcr_Alowd_Amt": ("total_allowed", "num")}
SVC = {"Rndrng_NPI": ("npi", "npi"), "HCPCS_Cd": ("hcpcs_code", "text"), "Place_Of_Srvc": ("place_of_service", "text"),
       "Tot_Srvcs": ("total_services", "num"), "Avg_Mdcr_Alowd_Amt": ("avg_allowed", "num")}
HOSP = {"CCN": ("ccn", "text"), "CITY": ("city", "text"), "STATE": ("state", "text")}
CHOW = {"CCN - BUYER": ("buyer_ccn", "text"), "CCN - SELLER": ("seller_ccn", "text"),
        "EFFECTIVE DATE": ("effective_date", "date"), "CHOW TYPE TEXT": ("chow_type", "text"),
        "ORGANIZATION NAME - BUYER": ("buyer_name", "text"), "ORGANIZATION NAME - SELLER": ("seller_name", "text")}
CMS_TABLES = {"prv": ("cms_provider_year", PRV), "svc": ("cms_provider_service", SVC),
              "hosp": ("cms_hospital", HOSP), "chow": ("cms_ownership_change", CHOW)}
# bundle lists normalized into their own tables; every other top-level field -> export_run.document
NORMALIZED = ("leads", "signals", "groups", "metros")


def content_sha256(obj) -> str:
    """Hash of an in-memory payload. main() hashes the file text instead, so a no-op re-run
    can skip a stored file without parsing or validating it."""
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _stored(conn: Connection, sha: str) -> bool:
    return conn.execute(select(IngestRun.id).where(IngestRun.content_sha256 == sha).union_all(
        select(ExportRun.id).where(ExportRun.bundle_sha256 == sha),
        select(ExportManifest.id).where(ExportManifest.content_sha256 == sha)).limit(1)).first() is not None


def require_head(conn: Connection) -> None:
    head = ScriptDirectory.from_config(Config(ALEMBIC_INI)).get_current_head()
    current = MigrationContext.configure(conn).get_current_revision()
    if current != head:
        raise SystemExit(f"database schema is at {current}, the code expects {head} -- run: alembic upgrade head")


def _convert(value, kind: str):
    if value is None:
        return None
    if kind == "npi":  # CMS sends it as a string
        return int(value)
    if kind == "num":
        return None if value == "" else Decimal(str(value))
    if kind == "date":
        return None if value == "" else date.fromisoformat(str(value)[:10])
    return value


def _copy(conn: Connection, table: str, cols: list[str], rows: Iterable[tuple]) -> int:
    """COPY rows in the connection's open transaction (fast for ~300k service rows)."""
    n = 0
    with conn.connection.driver_connection.cursor() as cur:
        with cur.copy(f"COPY {table} ({', '.join(cols)}) FROM STDIN") as cp:
            for row in rows:
                cp.write_row(row)
                n += 1
    return n


BULK = {"cms_provider_year", "cms_provider_service"}  # ~370k rows per pull


def _bulk_copy(conn: Connection, table: str, cols: list[str], rows: Iterable[tuple]) -> int:
    """COPY into a big snapshot table with its foreign key checked once, not per row (per-row
    checks made a pull take minutes). Postgres DDL is transactional: if anything fails, the
    rollback restores the constraint, and re-adding it validates every row with one join."""
    fk = f"fk_{table}_ingest_run"
    conn.exec_driver_sql(f"ALTER TABLE {table} DROP CONSTRAINT {fk}")
    n = _copy(conn, table, cols, rows)
    conn.exec_driver_sql(f"ALTER TABLE {table} ADD CONSTRAINT {fk} FOREIGN KEY (ingest_run_id) "
                         "REFERENCES ingest_run (id) ON DELETE CASCADE")
    return n


def _already(conn: Connection, source: str, sha: str) -> int | None:
    return conn.execute(select(IngestRun.id).where(IngestRun.source == source,
                                                   IngestRun.content_sha256 == sha)).scalar_one_or_none()


def _ingest_run(conn: Connection, source: str, fetched_at, sha: str, layout: dict) -> int:
    return conn.execute(insert(IngestRun).values(
        source=source, fetched_at=datetime.fromisoformat(fetched_at) if fetched_at else None,
        content_sha256=sha, row_counts={}, layout=layout).returning(IngestRun.id)).scalar_one()


def load_cms(conn: Connection, raw: dict, sha: str | None = None) -> int | None:
    """Store one public_fetch pull. Returns the new ingest_run id, or None if already stored."""
    sha = sha or content_sha256(raw)
    if _already(conn, "cms_medicare", sha) is not None:
        return None
    layout = {"keys": list(raw), "columns": {}, "passthrough": {}}
    for key, value in raw.items():
        if key == "fetchedAt":
            continue
        if key not in CMS_TABLES:  # a dataset this loader doesn't model yet: keep it verbatim
            layout["passthrough"][key] = value
        elif isinstance(value, dict):  # per-year
            layout["columns"][key] = {y: list(rows[0]) if rows else [] for y, rows in value.items()}
        else:
            layout["columns"][key] = list(value[0]) if value else []
    run = _ingest_run(conn, "cms_medicare", raw.get("fetchedAt"), sha, layout)
    counts = {}
    for key, (table, spec) in CMS_TABLES.items():
        if key not in raw:
            continue
        per_year = raw[key].items() if isinstance(raw[key], dict) else [(None, raw[key])]
        cols = ["ingest_run_id"] + (["year"] if isinstance(raw[key], dict) else []) + [c for c, _ in spec.values()]
        rows = ((run, *([int(y)] if y is not None else []), *(_convert(r.get(src), kind) for src, (_, kind) in spec.items()))
                for y, rs in per_year for r in rs)
        counts[key] = (_bulk_copy if table in BULK else _copy)(conn, table, cols, rows)
    conn.execute(IngestRun.__table__.update().where(IngestRun.id == run).values(row_counts=counts))
    return run


def load_bundle(conn: Connection, b: dict, sha: str | None = None) -> int | None:
    """Store one exported bundle. None if this exact bundle is already stored."""
    sid = b.get("source", {}).get("id", "?")
    try:
        problems = validate(b)
    except (KeyError, TypeError, AttributeError) as e:  # the validator assumes the current shape
        problems = [f"missing or malformed field {e} -- stale bundle? re-export it"]
    if problems:
        raise ValueError(f"{sid} bundle fails the contract ({len(problems)} problems), e.g. {problems[0]}")
    leaked = sorted({k for lead in b["leads"] for k in lead} & FORBIDDEN_LEAD_KEYS)
    if leaked:
        raise ValueError(f"{sid} bundle carries hidden-label fields {leaked}; refusing to store it")
    sha = sha or content_sha256(b)
    if conn.execute(select(ExportRun.id).where(ExportRun.source_id == sid,
                                               ExportRun.bundle_sha256 == sha)).scalar_one_or_none() is not None:
        return None
    run = conn.execute(insert(ExportRun).values(
        source_id=sid, kind=b.get("kind"), schema_version=b["schemaVersion"],
        generated_at=datetime.fromisoformat(b["source"]["generatedAt"]), bundle_sha256=sha,
        lead_count=len(b["leads"]), layout=list(b),
        document={k: v for k, v in b.items() if k not in NORMALIZED}).returning(ExportRun.id)).scalar_one()

    leads = b["leads"]
    conn.execute(insert(Lead), [{
        "export_run_id": run, "npi": int(l["npi"]), "position": i, "name": l.get("name"),
        "metro": l.get("metro"), "metro_slug": l.get("metroSlug"), "subspecialty": l.get("subspecialty"),
        "employer": l.get("employer"), "propensity": l.get("propensity"), "timing_score": l.get("timingScore"),
        "timing_bucket": l.get("timingBucket"), "rank": l.get("rank"), "record": l} for i, l in enumerate(leads)])
    contrib = [{"export_run_id": run, "npi": int(l["npi"]), "signal_key": k, "points": v}
               for l in leads for k, v in (l.get("contributions") or {}).items() if v is not None]
    if contrib:
        conn.execute(insert(LeadContribution), contrib)
    if b.get("signals"):
        conn.execute(insert(Signal), [{"export_run_id": run, "key": s["key"], "position": i, "label": s.get("label"),
                                       "weight": s.get("weight"), "record": s} for i, s in enumerate(b["signals"])])
    if b.get("groups"):
        conn.execute(insert(Cohort), [{"export_run_id": run, "cohort_id": g["id"], "position": i, "name": g.get("name"),
                                       "metro": g.get("metro"), "viability": g.get("viability"), "record": g}
                                      for i, g in enumerate(b["groups"])])
        conn.execute(insert(CohortMember), [{"export_run_id": run, "cohort_id": g["id"], "npi": int(n), "position": j}
                                            for g in b["groups"] for j, n in enumerate(g.get("members", []))])
    if b.get("metros"):
        conn.execute(insert(MetroSummary), [{"export_run_id": run, "slug": m["slug"], "position": i,
                                             "metro": m.get("metro"), "record": m} for i, m in enumerate(b["metros"])])
    return run


def load_manifest(conn: Connection, manifest: dict, sha: str | None = None) -> int | None:
    """Store the exporter's manifest.json. None if this exact manifest is already stored."""
    if not isinstance(manifest.get("sources"), list) or not all("id" in s for s in manifest["sources"]):
        raise ValueError("manifest has no sources list")
    sha = sha or content_sha256(manifest)
    if conn.execute(select(ExportManifest.id).where(ExportManifest.content_sha256 == sha)).first():
        return None
    return conn.execute(insert(ExportManifest).values(content_sha256=sha, document=manifest)
                        .returning(ExportManifest.id)).scalar_one()


def _bundle_paths(root: str) -> list[tuple[str, str]]:
    """(source id, path) for every available bundle, in manifest order."""
    manifest = os.path.join(root, "manifest.json")
    if os.path.exists(manifest):
        with open(manifest) as f:
            ids = [s["id"] for s in json.load(f)["sources"] if s.get("available")]
    else:
        ids = sorted(d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d))) if os.path.isdir(root) else []
    return [(sid, p) for sid in ids if os.path.exists(p := os.path.join(root, sid, "bundle.json"))]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--no-raw", action="store_true", help="skip the cached public pulls")
    ap.add_argument("--no-bundles", action="store_true", help="skip the exported bundles")
    ap.add_argument("--bundles", default=BUNDLES, help="directory holding <source>/bundle.json")
    args = ap.parse_args(argv)

    engine = get_engine()
    failed = 0
    with engine.connect() as conn:
        require_head(conn)

    def step(label: str, fn, path: str) -> None:
        nonlocal failed
        t0 = time.perf_counter()
        try:
            with (gzip.open(path, "rt") if path.endswith(".gz") else open(path)) as f:
                raw_text = f.read()
            sha = hashlib.sha256(raw_text.encode()).hexdigest()
            with engine.begin() as conn:
                run = None if _stored(conn, sha) else fn(conn, json.loads(raw_text), sha)
            took = f" ({time.perf_counter() - t0:.1f}s)" if run else ""
            print(f"  {label:<22} " + (f"stored as run {run}{took}" if run else "already stored"))
        except (ValueError, KeyError, TypeError, SQLAlchemyError) as e:
            failed += 1
            print(f"  {label:<22} FAILED: {e}", file=sys.stderr)

    if not args.no_raw:
        if os.path.exists(CMS_CACHE):
            step("cms_medicare (raw)", load_cms, CMS_CACHE)
    if not args.no_bundles:
        for sid, path in _bundle_paths(args.bundles):
            step(f"{sid} (bundle)", load_bundle, path)
        if os.path.exists(manifest := os.path.join(args.bundles, "manifest.json")):
            step("manifest", load_manifest, manifest)

    with engine.connect() as conn:
        runs = conn.execute(select(func.count()).select_from(ExportRun)).scalar_one()
        pulls = conn.execute(select(func.count()).select_from(IngestRun)).scalar_one()
    print(f"  database now holds {pulls} raw pull(s) and {runs} export run(s)")
    engine.dispose()
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
