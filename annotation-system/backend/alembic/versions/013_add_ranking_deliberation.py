"""Add ranking deliberation phase support

Revision ID: 013
Revises: 012
"""
import sqlalchemy as sa
from alembic import op

revision = "013_add_ranking_deliberation"
down_revision = "012_split_pushback_support"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "group_memberships",
        sa.Column("ranking_deliberation_completed_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("group_memberships", "ranking_deliberation_completed_at")
