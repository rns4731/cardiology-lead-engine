"""Initial schema: raw public snapshots, engine outputs per export run, outreach outcomes, and
the current_export_run / current_lead views.

Revision ID: 0001
Revises: 
Create Date: 2026-10-30 21:36:07.300012
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0001'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('export_run',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('source_id', sa.Text(), nullable=False),
    sa.Column('kind', sa.Text(), nullable=True),
    sa.Column('schema_version', sa.Integer(), nullable=False),
    sa.Column('generated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('loaded_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('bundle_sha256', sa.Text(), nullable=False),
    sa.Column('lead_count', sa.Integer(), nullable=False),
    sa.Column('layout', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('document', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_export_run')),
    sa.UniqueConstraint('source_id', 'bundle_sha256', name=op.f('uq_export_run_source_id_bundle_sha256'))
    )
    op.create_index(op.f('ix_export_run_source_id_generated_at'), 'export_run', ['source_id', 'generated_at'], unique=False)
    op.create_table('ingest_run',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('source', sa.Text(), nullable=False),
    sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('loaded_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('content_sha256', sa.Text(), nullable=False),
    sa.Column('row_counts', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('layout', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.CheckConstraint("source IN ('cms_medicare', 'npi_registry')", name=op.f('ck_ingest_run_source')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_ingest_run')),
    sa.UniqueConstraint('source', 'content_sha256', name=op.f('uq_ingest_run_source_content_sha256'))
    )
    op.create_table('outreach_event',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('npi', sa.BigInteger(), nullable=False),
    sa.Column('occurred_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('channel', sa.Text(), nullable=True),
    sa.Column('outcome', sa.Text(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('recorded_by', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("outcome IN ('no_response', 'declined', 'interested', 'meeting', 'joined')", name=op.f('ck_outreach_event_outcome')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_outreach_event'))
    )
    op.create_index(op.f('ix_outreach_event_npi'), 'outreach_event', ['npi'], unique=False)
    op.create_table('cms_hospital',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('ingest_run_id', sa.Integer(), nullable=False),
    sa.Column('ccn', sa.Text(), nullable=True),
    sa.Column('city', sa.Text(), nullable=True),
    sa.Column('state', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['ingest_run_id'], ['ingest_run.id'], name=op.f('fk_cms_hospital_ingest_run'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_cms_hospital'))
    )
    op.create_index(op.f('ix_cms_hospital_ingest_run_id_ccn'), 'cms_hospital', ['ingest_run_id', 'ccn'], unique=False)
    op.create_table('cms_ownership_change',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('ingest_run_id', sa.Integer(), nullable=False),
    sa.Column('effective_date', sa.Date(), nullable=True),
    sa.Column('chow_type', sa.Text(), nullable=True),
    sa.Column('buyer_ccn', sa.Text(), nullable=True),
    sa.Column('seller_ccn', sa.Text(), nullable=True),
    sa.Column('buyer_name', sa.Text(), nullable=True),
    sa.Column('seller_name', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['ingest_run_id'], ['ingest_run.id'], name=op.f('fk_cms_ownership_change_ingest_run'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_cms_ownership_change'))
    )
    op.create_index(op.f('ix_cms_ownership_change_ingest_run_id'), 'cms_ownership_change', ['ingest_run_id'], unique=False)
    op.create_table('cms_provider_service',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('ingest_run_id', sa.Integer(), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('npi', sa.BigInteger(), nullable=False),
    sa.Column('hcpcs_code', sa.Text(), nullable=True),
    sa.Column('place_of_service', sa.Text(), nullable=True),
    sa.Column('total_services', sa.Numeric(), nullable=True),
    sa.Column('avg_allowed', sa.Numeric(), nullable=True),
    sa.ForeignKeyConstraint(['ingest_run_id'], ['ingest_run.id'], name=op.f('fk_cms_provider_service_ingest_run'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_cms_provider_service'))
    )
    op.create_index(op.f('ix_cms_provider_service_ingest_run_id_year_npi'), 'cms_provider_service', ['ingest_run_id', 'year', 'npi'], unique=False)
    op.create_table('cms_provider_year',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('ingest_run_id', sa.Integer(), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('npi', sa.BigInteger(), nullable=False),
    sa.Column('last_name', sa.Text(), nullable=True),
    sa.Column('first_name', sa.Text(), nullable=True),
    sa.Column('street', sa.Text(), nullable=True),
    sa.Column('city', sa.Text(), nullable=True),
    sa.Column('state', sa.Text(), nullable=True),
    sa.Column('zip5', sa.Text(), nullable=True),
    sa.Column('provider_type', sa.Text(), nullable=True),
    sa.Column('total_beneficiaries', sa.Numeric(), nullable=True),
    sa.Column('total_services', sa.Numeric(), nullable=True),
    sa.Column('total_allowed', sa.Numeric(), nullable=True),
    sa.ForeignKeyConstraint(['ingest_run_id'], ['ingest_run.id'], name=op.f('fk_cms_provider_year_ingest_run'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_cms_provider_year'))
    )
    op.create_index(op.f('ix_cms_provider_year_ingest_run_id_year_npi'), 'cms_provider_year', ['ingest_run_id', 'year', 'npi'], unique=False)
    op.create_table('cohort',
    sa.Column('export_run_id', sa.Integer(), nullable=False),
    sa.Column('cohort_id', sa.Text(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('name', sa.Text(), nullable=True),
    sa.Column('metro', sa.Text(), nullable=True),
    sa.Column('viability', sa.Numeric(), nullable=True),
    sa.Column('record', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.ForeignKeyConstraint(['export_run_id'], ['export_run.id'], name=op.f('fk_cohort_export_run'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('export_run_id', 'cohort_id', name=op.f('pk_cohort'))
    )
    op.create_table('lead',
    sa.Column('export_run_id', sa.Integer(), nullable=False),
    sa.Column('npi', sa.BigInteger(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('name', sa.Text(), nullable=True),
    sa.Column('metro', sa.Text(), nullable=True),
    sa.Column('metro_slug', sa.Text(), nullable=True),
    sa.Column('subspecialty', sa.Text(), nullable=True),
    sa.Column('employer', sa.Text(), nullable=True),
    sa.Column('propensity', sa.Numeric(), nullable=True),
    sa.Column('timing_score', sa.Numeric(), nullable=True),
    sa.Column('timing_bucket', sa.Text(), nullable=True),
    sa.Column('rank', sa.Integer(), nullable=True),
    sa.Column('record', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.ForeignKeyConstraint(['export_run_id'], ['export_run.id'], name=op.f('fk_lead_export_run'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('export_run_id', 'npi', name=op.f('pk_lead'))
    )
    op.create_table('metro_summary',
    sa.Column('export_run_id', sa.Integer(), nullable=False),
    sa.Column('slug', sa.Text(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('metro', sa.Text(), nullable=True),
    sa.Column('record', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.ForeignKeyConstraint(['export_run_id'], ['export_run.id'], name=op.f('fk_metro_summary_export_run'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('export_run_id', 'slug', name=op.f('pk_metro_summary'))
    )
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
    op.create_table('signal',
    sa.Column('export_run_id', sa.Integer(), nullable=False),
    sa.Column('key', sa.Text(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('label', sa.Text(), nullable=True),
    sa.Column('weight', sa.Numeric(), nullable=True),
    sa.Column('record', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.ForeignKeyConstraint(['export_run_id'], ['export_run.id'], name=op.f('fk_signal_export_run'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('export_run_id', 'key', name=op.f('pk_signal'))
    )
    op.create_table('cohort_member',
    sa.Column('export_run_id', sa.Integer(), nullable=False),
    sa.Column('cohort_id', sa.Text(), nullable=False),
    sa.Column('npi', sa.BigInteger(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['export_run_id', 'cohort_id'], ['cohort.export_run_id', 'cohort.cohort_id'], name=op.f('fk_cohort_member_cohort'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['export_run_id', 'npi'], ['lead.export_run_id', 'lead.npi'], name=op.f('fk_cohort_member_lead'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('export_run_id', 'cohort_id', 'npi', name=op.f('pk_cohort_member'))
    )
    op.create_table('lead_contribution',
    sa.Column('export_run_id', sa.Integer(), nullable=False),
    sa.Column('npi', sa.BigInteger(), nullable=False),
    sa.Column('signal_key', sa.Text(), nullable=False),
    sa.Column('points', sa.Numeric(), nullable=False),
    sa.ForeignKeyConstraint(['export_run_id', 'npi'], ['lead.export_run_id', 'lead.npi'], name=op.f('fk_lead_contribution_lead'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('export_run_id', 'npi', 'signal_key', name=op.f('pk_lead_contribution'))
    )
    # the latest export of each source, and its leads: what the app is showing now
    op.execute(
        "CREATE VIEW current_export_run AS "
        "SELECT DISTINCT ON (source_id) * FROM export_run ORDER BY source_id, generated_at DESC, id DESC"
    )
    op.execute(
        "CREATE VIEW current_lead AS "
        "SELECT r.source_id, l.* FROM lead l JOIN current_export_run r ON r.id = l.export_run_id"
    )


def downgrade() -> None:
    op.execute("DROP VIEW current_lead")
    op.execute("DROP VIEW current_export_run")
    op.drop_table('lead_contribution')
    op.drop_table('cohort_member')
    op.drop_table('signal')
    op.drop_index(op.f('ix_npi_identity_ingest_run_id_npi'), table_name='npi_identity')
    op.drop_table('npi_identity')
    op.drop_table('metro_summary')
    op.drop_table('lead')
    op.drop_table('cohort')
    op.drop_index(op.f('ix_cms_provider_year_ingest_run_id_year_npi'), table_name='cms_provider_year')
    op.drop_table('cms_provider_year')
    op.drop_index(op.f('ix_cms_provider_service_ingest_run_id_year_npi'), table_name='cms_provider_service')
    op.drop_table('cms_provider_service')
    op.drop_index(op.f('ix_cms_ownership_change_ingest_run_id'), table_name='cms_ownership_change')
    op.drop_table('cms_ownership_change')
    op.drop_index(op.f('ix_cms_hospital_ingest_run_id_ccn'), table_name='cms_hospital')
    op.drop_table('cms_hospital')
    op.drop_index(op.f('ix_outreach_event_npi'), table_name='outreach_event')
    op.drop_table('outreach_event')
    op.drop_table('ingest_run')
    op.drop_index(op.f('ix_export_run_source_id_generated_at'), table_name='export_run')
    op.drop_table('export_run')
