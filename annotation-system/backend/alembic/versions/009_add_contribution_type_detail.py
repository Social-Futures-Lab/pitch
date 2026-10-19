"""Add contribution_type_detail field to knowledge_items table

Revision ID: 009
Revises: 008
Create Date: 2026-06-01
"""
from alembic import op
import sqlalchemy as sa

revision = "009_contrib_detail_ki"
down_revision = "008_add_deliberation_completion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "knowledge_items",
        sa.Column("contribution_type_detail", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("knowledge_items", "contribution_type_detail")
