"""Postgres store: migrations, exact round trips, idempotent loads, and the label guard.

Runs against TEST_DATABASE_URL (default: the compose `db` service on localhost:5432,
database leads_test -- dropped and recreated per run, never the app's `leads`). Skipped
when no Postgres is reachable, so the core suite still runs without Docker:
    docker compose up -d db && .venv/bin/python -m pytest tests/test_db.py
"""
from __future__ import annotations

import copy
import json
import os

import pytest

pytest.importorskip("sqlalchemy")
pytest.importorskip("alembic")

from alembic import command  # noqa: E402
from alembic.autogenerate import compare_metadata  # noqa: E402
from alembic.config import Config  # noqa: E402
from alembic.runtime.migration import MigrationContext  # noqa: E402
from sqlalchemy import create_engine, func, inspect, select, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402
from sqlalchemy.exc import IntegrityError, OperationalError  # noqa: E402

from engine.bundle_check import FORBIDDEN_LEAD_KEYS  # noqa: E402
from engine.db import load, read  # noqa: E402
from engine.db.models import Base, ExportRun, IngestRun, Lead, LeadContribution, OutreachEvent  # noqa: E402

TEST_URL = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://leads:leads@localhost:5432/leads_test")
VIEWS = {"current_export_run", "current_lead"}
SOURCES = [s for s in ("synthetic", "real", "public") if os.path.exists(os.path.join(load.BUNDLES, s, "bundle.json"))]

RAW = {  # a miniature public_fetch pull: every table, every column kind
    "prv": {
        "2014": [{"Rndrng_NPI": "1000000001"}],  # old years keep only the NPI
        "2024": [{"Rndrng_NPI": "1000000001", "Rndrng_Prvdr_Last_Org_Name": "SMITH", "Rndrng_Prvdr_First_Name": "ANA",
                  "Rndrng_Prvdr_St1": "1 MAIN ST", "Rndrng_Prvdr_City": "PHOENIX", "Rndrng_Prvdr_State_Abrvtn": "AZ",
                  "Rndrng_Prvdr_Zip5": "08501", "Rndrng_Prvdr_Type": "Cardiology", "Tot_Benes": "120",
                  "Tot_Srvcs": "340.5", "Tot_Mdcr_Alowd_Amt": "15234.120000"}],
    },
    "svc": {"2024": [{"Rndrng_NPI": "1000000001", "HCPCS_Cd": "93000", "Place_Of_Srvc": "O",
                      "Tot_Srvcs": "34", "Avg_Mdcr_Alowd_Amt": "14.450294118"}]},
    "hosp": [{"CCN": "030001", "CITY": "PHOENIX", "STATE": "AZ"}],
    "chow": [{"CCN - BUYER": "030001", "CCN - SELLER": "030002", "EFFECTIVE DATE": "2025-03-20",
              "CHOW TYPE TEXT": "CHANGE OF OWNERSHIP", "ORGANIZATION NAME - BUYER": "BUYER LLC",
              "ORGANIZATION NAME - SELLER": "SELLER LP"}],
    "dac": [{"anything": 1}],  # a dataset the loader doesn't model yet is kept verbatim
    "fetchedAt": "2026-10-31T01:28:47+00:00",
}
IDENTITIES = {"fetchedAt": "2026-10-29T17:44:48+00:00", "failedQueries": [],
              "rows": [{"npi": 1000000001, "name": "Dr. Ana Smith", "raw_name": "SMITH, ANA",
                        "metro": "Phoenix, AZ", "subspecialty": "Interventional"}]}


def _alembic(url, *args) -> None:
    cfg = Config(load.ALEMBIC_INI)
    cfg.set_main_option("sqlalchemy.url", url.render_as_string(hide_password=False).replace("%", "%%"))
    getattr(command, args[0])(cfg, *args[1:])


def _bundle(source: str) -> dict:
    if source not in SOURCES:
        pytest.skip(f"no {source} bundle on disk -- run: python -m engine.export_web --offline")
    with open(os.path.join(load.BUNDLES, source, "bundle.json")) as f:
        return json.load(f)


@pytest.fixture(scope="module")
def pg():
    url = make_url(TEST_URL)
    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as c:
            c.execute(text(f'DROP DATABASE IF EXISTS "{url.database}" WITH (FORCE)'))
            c.execute(text(f'CREATE DATABASE "{url.database}"'))
    except OperationalError:
        pytest.skip(f"Postgres not reachable at {url.render_as_string()} -- run: docker compose up -d db")
    finally:
        admin.dispose()
    _alembic(url, "upgrade", "head")
    engine = create_engine(url)
    yield engine
    engine.dispose()


@pytest.fixture
def db(pg):
    tables = ", ".join(f'"{t}"' for t in Base.metadata.tables)
    with pg.begin() as c:
        c.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    return pg


def _count(conn, model) -> int:
    return conn.execute(select(func.count()).select_from(model)).scalar_one()


# ------------------------------------------------------------------ migrations
def test_migrations_downgrade_to_empty_and_back(pg):
    url = pg.url
    _alembic(url, "downgrade", "base")
    insp = inspect(pg)
    assert set(insp.get_table_names()) == {"alembic_version"}
    assert not set(insp.get_view_names())
    with pg.connect() as c, pytest.raises(SystemExit, match="alembic upgrade head"):
        load.require_head(c)  # the loader refuses a schema that isn't migrated
    _alembic(url, "upgrade", "head")
    insp = inspect(pg)
    assert set(Base.metadata.tables) <= set(insp.get_table_names())
    assert VIEWS <= set(insp.get_view_names())


def test_models_match_the_migrations(pg):
    with pg.connect() as c:
        diff = compare_metadata(MigrationContext.configure(c, opts={"compare_type": True}), Base.metadata)
    assert diff == [], f"models and migrations disagree -- add an Alembic revision: {diff}"


# --------------------------------------------------------------- raw snapshots
def test_cms_pull_round_trips_exactly_and_loads_once(db):
    with db.begin() as c:
        run = load.load_cms(c, RAW)
        assert run is not None
        assert load.load_cms(c, copy.deepcopy(RAW)) is None  # same content: stored once
    with db.connect() as c:
        assert read.public_raw(c) == RAW
        assert _count(c, IngestRun) == 1
        counts = c.execute(select(IngestRun.row_counts)).scalar_one()
    assert counts == {"prv": 2, "svc": 1, "hosp": 1, "chow": 1}


def test_a_changed_pull_is_a_new_snapshot(db):
    newer = copy.deepcopy(RAW) | {"fetchedAt": "2026-11-30T00:00:00+00:00"}
    with db.begin() as c:
        first, second = load.load_cms(c, RAW), load.load_cms(c, newer)
    with db.connect() as c:
        assert read.public_raw(c) == newer  # latest by fetch time
        assert read.public_raw(c, first) == RAW  # history is kept
        assert first != second


def test_identity_pull_round_trips_exactly(db):
    with db.begin() as c:
        assert load.load_identities(c, IDENTITIES) is not None
        assert load.load_identities(c, IDENTITIES) is None
    with db.connect() as c:
        assert read.identities(c) == IDENTITIES


# -------------------------------------------------------------- engine outputs
@pytest.mark.parametrize("source", ["synthetic", "real", "public"])
def test_bundle_round_trips_exactly(db, source):
    b = _bundle(source)
    with db.begin() as c:
        run = load.load_bundle(c, b)
        assert load.load_bundle(c, copy.deepcopy(b)) is None
    with db.connect() as c:
        assert read.bundle(c, source) == b
        assert _count(c, Lead) == len(b["leads"]) == b["source"]["count"]
        assert _count(c, LeadContribution) == sum(
            sum(v is not None for v in (l.get("contributions") or {}).values()) for l in b["leads"])
        leads = read.current_leads(c, source)
    assert run is not None and len(leads) == len(b["leads"])
    assert list(leads["npi"]) == [l["npi"] for l in b["leads"]]


def test_hidden_label_is_never_stored(db):
    b = _bundle("synthetic")
    leaky = copy.deepcopy(b)
    leaky["leads"][0]["will_move_24mo"] = 1
    with db.begin() as c, pytest.raises(ValueError):
        load.load_bundle(c, leaky)
    with db.begin() as c:
        load.load_bundle(c, b)
    with db.connect() as c:
        assert _count(c, ExportRun) == 1
        records = c.execute(select(Lead.record)).scalars().all()
    assert not {k for r in records for k in r} & FORBIDDEN_LEAD_KEYS
    assert not {col.name for col in Lead.__table__.columns} & FORBIDDEN_LEAD_KEYS


def test_current_views_follow_the_latest_export(db):
    b = _bundle("synthetic")
    newer = copy.deepcopy(b)
    newer["source"]["generatedAt"] = "2099-01-01T00:00:00+00:00"
    with db.begin() as c:
        load.load_bundle(c, b)
        latest = load.load_bundle(c, newer)
    with db.connect() as c:
        current = c.execute(text("SELECT id FROM current_export_run WHERE source_id = 'synthetic'")).scalar_one()
        n = c.execute(text("SELECT count(*) FROM current_lead WHERE source_id = 'synthetic'")).scalar_one()
    assert current == latest and n == len(b["leads"])


# ------------------------------------------------------------------ team input
def test_outreach_outcomes_are_constrained(db):
    with db.begin() as c:
        c.execute(OutreachEvent.__table__.insert().values(npi=1000000001, outcome="meeting", channel="call"))
    with db.begin() as c, pytest.raises(IntegrityError):
        c.execute(OutreachEvent.__table__.insert().values(npi=1000000001, outcome="maybe"))
    with db.connect() as c:
        assert _count(c, OutreachEvent) == 1
