"""Add annotation_done_at to group_memberships.

Revision ID: 006_add_annotation_done_at
Revises: 005_add_annotation_rating_fields
Create Date: 2026-04-30
"""

from alembic import op
import sqlalchemy as sa

revision = "006_add_annotation_done_at"
down_revision = "005_add_annotation_rating_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "group_memberships",
        sa.Column("annotation_done_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("group_memberships", "annotation_done_at")
