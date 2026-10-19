"""Rename scenario enum values: scholarly->scholar, trip_planning->trip

Revision ID: 002
Revises: 001
"""
from alembic import op

revision = "002_rename_scenario"
down_revision = "001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Original migration tried to rename PostgreSQL enum values, but the schema
    # uses VARCHAR(50) for scenario, not a PG enum. Values are already correct.
    pass


def downgrade() -> None:
    pass
