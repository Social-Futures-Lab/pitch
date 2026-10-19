"""Add inserted_resources column to knowledge_items

Revision ID: 007
Revises: 006
"""
import sqlalchemy as sa
from alembic import op

revision = "007_add_inserted_resources"
down_revision = "006_add_annotation_done_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("knowledge_items", sa.Column("inserted_resources", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("knowledge_items", "inserted_resources")
