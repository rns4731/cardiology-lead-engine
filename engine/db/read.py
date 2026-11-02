"""Read the Postgres store back: rebuild a raw pull or a bundle exactly as it was stored,
or query the current leads. Lets engine code (and the tests) treat the database as the
source of a snapshot instead of the local cache files.

    from engine.db import get_engine
    from engine.db.read import bundle, current_leads, public_raw
    with get_engine().connect() as conn:
        raw = public_raw(conn)                    # == the public_fetch cache dict
        leads = current_leads(conn, "synthetic")  # DataFrame
"""
from __future__ import annotations

import pandas as pd
from sqlalchemy import select, text
from sqlalchemy.engine import Connection

from engine.db.load import CMS_TABLES, NORMALIZED
from engine.db.models import Cohort, ExportManifest, ExportRun, IngestRun, Lead, MetroSummary, Signal

_RECORDS = {"leads": Lead, "signals": Signal, "groups": Cohort, "metros": MetroSummary}


def _back(value, kind: str):
    """Invert load._convert to the cache's own types (CMS sends every value as a string)."""
    if value is None:
        return None
    if kind in ("npi", "num"):
        return str(value)
    if kind == "date":
        return value.isoformat()
    return value


def _ingest_run(conn: Connection, source: str, run_id: int | None) -> IngestRun:
    q = select(IngestRun).where(IngestRun.source == source)
    q = q.where(IngestRun.id == run_id) if run_id else q.order_by(IngestRun.fetched_at.desc().nulls_last(), IngestRun.id.desc())
    run = conn.execute(q.limit(1)).first()
    if run is None:
        raise LookupError(f"no {source} pull stored" + (f" with id {run_id}" if run_id else ""))
    return run


def _rows(conn: Connection, table: str, run_id: int, spec: dict, cols: list[str], year: int | None = None) -> list[dict]:
    where = "ingest_run_id = :run" + (" AND year = :year" if year is not None else "")
    db_cols = [spec[c][0] for c in cols]
    params = {"run": run_id} | ({"year": year} if year is not None else {})
    result = conn.execute(text(f"SELECT {', '.join(db_cols)} FROM {table} WHERE {where} ORDER BY id"), params)
    return [{c: _back(v, spec[c][1]) for c, v in zip(cols, row)} for row in result]


def public_raw(conn: Connection, run_id: int | None = None) -> dict:
    """The CMS pull (latest, or `run_id`) in engine.public_fetch's cache format."""
    run = _ingest_run(conn, "cms_medicare", run_id)
    out: dict = {}
    for key in run.layout["keys"]:
        if key == "fetchedAt":
            out[key] = run.fetched_at.isoformat() if run.fetched_at else None
        elif key in run.layout["passthrough"]:
            out[key] = run.layout["passthrough"][key]
        else:
            table, spec = CMS_TABLES[key]
            cols = run.layout["columns"][key]
            out[key] = ({y: _rows(conn, table, run.id, spec, c, int(y)) for y, c in cols.items()}
                        if isinstance(cols, dict) else _rows(conn, table, run.id, spec, cols))
    return out



def bundle(conn: Connection, source_id: str, run_id: int | None = None) -> dict:
    """An exported bundle (latest for `source_id`, or `run_id`), rebuilt exactly."""
    q = select(ExportRun).where(ExportRun.source_id == source_id)
    q = q.where(ExportRun.id == run_id) if run_id else q.order_by(ExportRun.generated_at.desc(), ExportRun.id.desc())
    run = conn.execute(q.limit(1)).first()
    if run is None:
        raise LookupError(f"no {source_id} export stored")
    out = {}
    for key in run.layout:
        if key in NORMALIZED:
            model = _RECORDS[key]
            out[key] = list(conn.execute(select(model.record).where(model.export_run_id == run.id)
                                         .order_by(model.position)).scalars())
        else:
            out[key] = run.document[key]
    return out


def current_leads(conn: Connection, source_id: str) -> pd.DataFrame:
    """Leads of the latest export of `source_id` (the current_lead view), in bundle order."""
    cols = "npi, name, metro, subspecialty, employer, propensity, timing_score, timing_bucket, rank"
    rows = conn.execute(text(f"SELECT {cols} FROM current_lead WHERE source_id = :s ORDER BY position"), {"s": source_id})
    return pd.DataFrame(rows.fetchall(), columns=[c.strip() for c in cols.split(",")])


def current_runs(conn: Connection) -> dict[str, int]:
    """source id -> id of its current (latest) export run."""
    return dict(conn.execute(text("SELECT source_id, id FROM current_export_run")).all())


def served_manifest(conn: Connection) -> dict:
    """The manifest the app gets: the exporter's latest manifest (order, labels, default),
    with each source's availability and counts taken from the export actually being
    served -- so the manifest never lists a source the database can't deliver."""
    stored = conn.execute(select(ExportManifest.document).order_by(ExportManifest.id.desc()).limit(1)).scalar()
    current = {sid: src for sid, src in conn.execute(
        text("SELECT source_id, document->'source' FROM current_export_run")).all()}
    entries = stored["sources"] if stored else [{"id": sid, "label": current[sid].get("label", sid),
                                                 "description": current[sid].get("description", "")}
                                                for sid in sorted(current)]
    sources = []
    for e in entries:
        src = current.get(e["id"])
        entry = {k: e[k] for k in ("id", "label", "description") if k in e}
        if src is None:
            entry.update(available=False, error="not loaded into Postgres")
        else:
            entry.update(available=True, count=src["count"], generatedAt=src["generatedAt"],
                         failedQueries=len(src.get("failedQueries", [])),
                         **({"fetchedAt": src["fetchedAt"]} if "fetchedAt" in src else {}))
            if e.get("generatedAt") == src["generatedAt"]:  # the exporter's flags describe this export
                entry.update({k: e[k] for k in ("stale", "error") if k in e})
        sources.append(entry)
    default = stored["default"] if stored else (sources[0]["id"] if sources else None)
    schema = stored["schemaVersion"] if stored else conn.execute(
        text("SELECT max(schema_version) FROM current_export_run")).scalar()
    return {"schemaVersion": schema, "default": default, "sources": sources}
