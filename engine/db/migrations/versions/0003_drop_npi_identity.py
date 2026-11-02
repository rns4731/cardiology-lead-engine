"""Drop the NPI-registry identity store and the real-identities exports.

That mode put real physicians' names on simulated signals and scores; it was removed, so
nothing reads or writes `npi_identity` any more, and its stored bundles must not be served.
Downgrade restores the schema only -- the deleted rows are not recoverable from here.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-01 22:30:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0003'
down_revision: str | None = '0002'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DELETE FROM export_run WHERE source_id = 'real'")
    op.drop_index(op.f('ix_npi_identity_ingest_run_id_npi'), table_name='npi_identity')
    op.drop_table('npi_identity')
    op.execute("DELETE FROM ingest_run WHERE source = 'npi_registry'")
    op.drop_constraint(op.f('ck_ingest_run_source'), 'ingest_run', type_='check')
    op.create_check_constraint(op.f('ck_ingest_run_source'), 'ingest_run', "source IN ('cms_medicare')")


def downgrade() -> None:
    op.drop_constraint(op.f('ck_ingest_run_source'), 'ingest_run', type_='check')
    op.create_check_constraint(op.f('ck_ingest_run_source'), 'ingest_run',
                               "source IN ('cms_medicare', 'npi_registry')")
    op.create_table('npi_identity',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('ingest_run_id', sa.Integer(), nullable=False),
    sa.Column('npi', sa.BigInteger(), nullable=False),
    sa.Column('name', sa.Text(), nullable=True),
    sa.Column('raw_name', sa.Text(), nullable=True),
    sa.Column('metro', sa.Text(), nullable=True),
    sa.Column('subspecialty', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['ingest_run_id'], ['ingest_run.id'], name=op.f('fk_npi_identity_ingest_run'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_npi_identity'))
    )
    op.create_index(op.f('ix_npi_identity_ingest_run_id_npi'), 'npi_identity', ['ingest_run_id', 'npi'], unique=False)
