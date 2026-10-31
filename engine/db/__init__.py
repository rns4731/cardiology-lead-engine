"""Postgres: the engine's system of record.

Why: a JSON bundle is one run's snapshot for the web to render. History -- every CMS and
NPI-registry pull, every export run -- and the growth team's outreach outcomes (the real
label future models will train on) need a durable, queryable store. Data still flows one
way: the engine computes, `engine.db.load` stores, the web reads bundles.

    docker compose up -d db                     # Postgres on localhost:5432
    .venv/bin/alembic upgrade head              # create / migrate the tables
    .venv/bin/python -m engine.db.load          # store raw pulls + every bundle
"""
from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

DEFAULT_URL = "postgresql+psycopg://leads:leads@localhost:5432/leads"


def database_url() -> str:
    return os.environ.get("DATABASE_URL", DEFAULT_URL)


def get_engine(url: str | None = None) -> Engine:
    return create_engine(url or database_url())
