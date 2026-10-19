"""Split pushback_support into separate pushback and support categories

Revision ID: 012
Revises: 011
Create Date: 2026-06-07
"""
from alembic import op

revision = "012_split_pushback_support"
down_revision = "011_ai_interaction_log"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Convert existing pushback_support values to pushback (default)
    op.execute(
        "UPDATE knowledge_items SET contribution_type = 'pushback' "
        "WHERE contribution_type = 'pushback_support'"
    )
    # Also update annotations table if it has contribution_type
    op.execute(
        "UPDATE annotations SET contribution_type = 'pushback' "
        "WHERE contribution_type = 'pushback_support'"
    )


def downgrade() -> None:
    # Merge pushback and support back into pushback_support
    op.execute(
        "UPDATE knowledge_items SET contribution_type = 'pushback_support' "
        "WHERE contribution_type IN ('pushback', 'support')"
    )
    op.execute(
        "UPDATE annotations SET contribution_type = 'pushback_support' "
        "WHERE contribution_type IN ('pushback', 'support')"
    )
