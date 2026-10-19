"""Add ai_interaction_log column to knowledge_items

Revision ID: 011
Revises: 010
Create Date: 2026-06-02
"""
from alembic import op
import sqlalchemy as sa

revision = "011_ai_interaction_log"
down_revision = "010_contrib_detail_an"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "knowledge_items",
        sa.Column("ai_interaction_log", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("knowledge_items", "ai_interaction_log")
