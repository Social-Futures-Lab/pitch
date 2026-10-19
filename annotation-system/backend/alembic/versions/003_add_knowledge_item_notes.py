"""Add notes column to knowledge_items

Revision ID: 003
Revises: 002
"""
import sqlalchemy as sa
from alembic import op

revision = "003_add_notes"
down_revision = "002_rename_scenario"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("knowledge_items", sa.Column("notes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("knowledge_items", "notes")
