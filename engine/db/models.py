"""Tables, in three groups.

  raw snapshots   every CMS / NPI-registry pull, verbatim and typed, tagged by ingest_run --
                  diffing snapshots is how employer-change and peer-departure signals get built
  engine outputs  every exported bundle, normalized (lead, contribution, signal, cohort, ...)
                  with each full record kept as JSONB, so a bundle can be rebuilt exactly
  outreach_event  the growth team's outcomes: the real label future models train on

The hidden synthetic label (will_move_24mo) is never stored: rows come only from bundles
that passed the contract validator, and those carry the label only as aggregates.
Change a table here => add an Alembic revision (`alembic revision --autogenerate`).
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    MetaData,
    Numeric,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}
OUTREACH_OUTCOMES = ("no_response", "declined", "interested", "meeting", "joined")
RAW_SOURCES = ("cms_medicare", "npi_registry")


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


def _run_fk() -> ForeignKey:
    return ForeignKey("ingest_run.id", ondelete="CASCADE")


# ---------------------------------------------------------------- raw snapshots
class IngestRun(Base):
    """One pull of one public source. `layout` keeps the column lists per year so the
    original cache can be rebuilt exactly (older Medicare years keep only the NPI)."""
    __tablename__ = "ingest_run"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(Text)
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    loaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    content_sha256: Mapped[str] = mapped_column(Text)
    row_counts: Mapped[dict] = mapped_column(JSONB)
    layout: Mapped[dict] = mapped_column(JSONB)
    __table_args__ = (
        UniqueConstraint("source", "content_sha256"),
        CheckConstraint(f"source IN {RAW_SOURCES}", name="source"),
    )


class CmsProviderYear(Base):
    """Medicare Physician & Other Practitioners -- by Provider, one row per NPI-year."""
    __tablename__ = "cms_provider_year"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ingest_run_id: Mapped[int] = mapped_column(_run_fk())
    year: Mapped[int] = mapped_column(Integer)
    npi: Mapped[int] = mapped_column(BigInteger)
    last_name: Mapped[str | None] = mapped_column(Text)
    first_name: Mapped[str | None] = mapped_column(Text)
    street: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str | None] = mapped_column(Text)
    zip5: Mapped[str | None] = mapped_column(Text)
    provider_type: Mapped[str | None] = mapped_column(Text)
    total_beneficiaries: Mapped[Decimal | None] = mapped_column(Numeric)
    total_services: Mapped[Decimal | None] = mapped_column(Numeric)
    total_allowed: Mapped[Decimal | None] = mapped_column(Numeric)
    __table_args__ = (Index(None, "ingest_run_id", "year", "npi"),)


class CmsProviderService(Base):
    """Medicare by Provider and Service: one row per NPI x HCPCS x place of service."""
    __tablename__ = "cms_provider_service"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ingest_run_id: Mapped[int] = mapped_column(_run_fk())
    year: Mapped[int] = mapped_column(Integer)
    npi: Mapped[int] = mapped_column(BigInteger)
    hcpcs_code: Mapped[str | None] = mapped_column(Text)
    place_of_service: Mapped[str | None] = mapped_column(Text)
    total_services: Mapped[Decimal | None] = mapped_column(Numeric)
    avg_allowed: Mapped[Decimal | None] = mapped_column(Numeric)
    __table_args__ = (Index(None, "ingest_run_id", "year", "npi"),)


class CmsHospital(Base):
    """Hospital Enrollments: CCN -> city (maps ownership changes to places)."""
    __tablename__ = "cms_hospital"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ingest_run_id: Mapped[int] = mapped_column(_run_fk())
    ccn: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (Index(None, "ingest_run_id", "ccn"),)


class CmsOwnershipChange(Base):
    """Hospital Change of Ownership events."""
    __tablename__ = "cms_ownership_change"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ingest_run_id: Mapped[int] = mapped_column(_run_fk(), index=True)
    effective_date: Mapped[date | None] = mapped_column(Date)
    chow_type: Mapped[str | None] = mapped_column(Text)
    buyer_ccn: Mapped[str | None] = mapped_column(Text)
    seller_ccn: Mapped[str | None] = mapped_column(Text)
    buyer_name: Mapped[str | None] = mapped_column(Text)
    seller_name: Mapped[str | None] = mapped_column(Text)


class NpiIdentity(Base):
    """Cardiologists from the public NIH/NLM NPI registry (real-identities mode)."""
    __tablename__ = "npi_identity"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ingest_run_id: Mapped[int] = mapped_column(_run_fk())
    npi: Mapped[int] = mapped_column(BigInteger)
    name: Mapped[str | None] = mapped_column(Text)
    raw_name: Mapped[str | None] = mapped_column(Text)
    metro: Mapped[str | None] = mapped_column(Text)
    subspecialty: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (Index(None, "ingest_run_id", "npi"),)


# --------------------------------------------------------------- engine outputs
class ExportRun(Base):
    """One exported bundle. `document` holds its top-level fields that aren't normalized
    into tables (meta, source, systems, sweep, ...); `layout` its top-level key order."""
    __tablename__ = "export_run"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[str] = mapped_column(Text)
    kind: Mapped[str | None] = mapped_column(Text)
    schema_version: Mapped[int] = mapped_column(Integer)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    loaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    bundle_sha256: Mapped[str] = mapped_column(Text)
    lead_count: Mapped[int] = mapped_column(Integer)
    layout: Mapped[list] = mapped_column(JSONB)
    document: Mapped[dict] = mapped_column(JSONB)
    __table_args__ = (
        UniqueConstraint("source_id", "bundle_sha256"),
        Index(None, "source_id", "generated_at"),
    )


def _export_fk() -> ForeignKey:
    return ForeignKey("export_run.id", ondelete="CASCADE")


class Lead(Base):
    __tablename__ = "lead"
    export_run_id: Mapped[int] = mapped_column(_export_fk(), primary_key=True)
    npi: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str | None] = mapped_column(Text)
    metro: Mapped[str | None] = mapped_column(Text)
    metro_slug: Mapped[str | None] = mapped_column(Text)
    subspecialty: Mapped[str | None] = mapped_column(Text)
    employer: Mapped[str | None] = mapped_column(Text)
    propensity: Mapped[Decimal | None] = mapped_column(Numeric)
    timing_score: Mapped[Decimal | None] = mapped_column(Numeric)
    timing_bucket: Mapped[str | None] = mapped_column(Text)
    rank: Mapped[int | None] = mapped_column(Integer)
    record: Mapped[dict] = mapped_column(JSONB)


class LeadContribution(Base):
    """Points each signal adds to a lead's score (sums to its propensity)."""
    __tablename__ = "lead_contribution"
    export_run_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    npi: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    signal_key: Mapped[str] = mapped_column(Text, primary_key=True)
    points: Mapped[Decimal] = mapped_column(Numeric)
    __table_args__ = (
        ForeignKeyConstraint(["export_run_id", "npi"], ["lead.export_run_id", "lead.npi"], ondelete="CASCADE"),
    )


class Signal(Base):
    __tablename__ = "signal"
    export_run_id: Mapped[int] = mapped_column(_export_fk(), primary_key=True)
    key: Mapped[str] = mapped_column(Text, primary_key=True)
    position: Mapped[int] = mapped_column(Integer)
    label: Mapped[str | None] = mapped_column(Text)
    weight: Mapped[Decimal | None] = mapped_column(Numeric)
    record: Mapped[dict] = mapped_column(JSONB)


class Cohort(Base):
    """A candidate founding slate (bundle `groups`)."""
    __tablename__ = "cohort"
    export_run_id: Mapped[int] = mapped_column(_export_fk(), primary_key=True)
    cohort_id: Mapped[str] = mapped_column(Text, primary_key=True)
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str | None] = mapped_column(Text)
    metro: Mapped[str | None] = mapped_column(Text)
    viability: Mapped[Decimal | None] = mapped_column(Numeric)
    record: Mapped[dict] = mapped_column(JSONB)


class CohortMember(Base):
    __tablename__ = "cohort_member"
    export_run_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cohort_id: Mapped[str] = mapped_column(Text, primary_key=True)
    npi: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    position: Mapped[int] = mapped_column(Integer)
    __table_args__ = (
        ForeignKeyConstraint(["export_run_id", "cohort_id"], ["cohort.export_run_id", "cohort.cohort_id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["export_run_id", "npi"], ["lead.export_run_id", "lead.npi"], ondelete="CASCADE"),
    )


class MetroSummary(Base):
    __tablename__ = "metro_summary"
    export_run_id: Mapped[int] = mapped_column(_export_fk(), primary_key=True)
    slug: Mapped[str] = mapped_column(Text, primary_key=True)
    position: Mapped[int] = mapped_column(Integer)
    metro: Mapped[str | None] = mapped_column(Text)
    record: Mapped[dict] = mapped_column(JSONB)


# ------------------------------------------------------------------ team input
class OutreachEvent(Base):
    """What happened when the team contacted a cardiologist. Keyed by NPI, not by an
    export run: outcomes outlive any one scoring run."""
    __tablename__ = "outreach_event"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    npi: Mapped[int] = mapped_column(BigInteger, index=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    channel: Mapped[str | None] = mapped_column(Text)
    outcome: Mapped[str] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    recorded_by: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (CheckConstraint(f"outcome IN {OUTREACH_OUTCOMES}", name="outcome"),)
