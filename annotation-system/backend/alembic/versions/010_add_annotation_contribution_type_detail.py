"""Add contribution_type_detail field to annotations table

Revision ID: 010
Revises: 009
Create Date: 2026-06-01
"""
from alembic import op
import sqlalchemy as sa

revision = "010_contrib_detail_an"
down_revision = "009_contrib_detail_ki"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "annotations",
        sa.Column("contribution_type_detail", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("annotations", "contribution_type_detail")
