"""Store the exporter's manifest.json so the API can serve the app's data from Postgres.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-30 22:29:52.957134
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0002'
down_revision: str | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('export_manifest',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('loaded_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('content_sha256', sa.Text(), nullable=False),
    sa.Column('document', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_export_manifest')),
    sa.UniqueConstraint('content_sha256', name=op.f('uq_export_manifest_content_sha256'))
    )


def downgrade() -> None:
    op.drop_table('export_manifest')
