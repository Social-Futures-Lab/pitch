"""Add contribution_type and pertinence to annotations.

Revision ID: 005_add_annotation_rating_fields
Revises: 004_add_construction_done_at
Create Date: 2026-04-30
"""

from alembic import op
import sqlalchemy as sa

revision = "005_add_annotation_rating_fields"
down_revision = "004_add_construction_done_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "annotations",
        sa.Column("contribution_type", sa.VARCHAR(50), nullable=True),
    )
    op.add_column(
        "annotations",
        sa.Column("pertinence", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("annotations", "pertinence")
    op.drop_column("annotations", "contribution_type")
