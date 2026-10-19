"""Add deliberation completion tracking

Revision ID: 008
Revises: 007
"""
import sqlalchemy as sa
from alembic import op

revision = "008_add_deliberation_completion"
down_revision = "007_add_inserted_resources"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "group_memberships",
        sa.Column("deliberation_completed_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("group_memberships", "deliberation_completed_at")
