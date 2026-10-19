"""Add construction_done_at to group_memberships.

Revision ID: 004_add_construction_done_at
Revises: 003_add_notes
Create Date: 2026-04-30
"""

from alembic import op
import sqlalchemy as sa

revision = "004_add_construction_done_at"
down_revision = "003_add_notes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "group_memberships",
        sa.Column("construction_done_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("group_memberships", "construction_done_at")
