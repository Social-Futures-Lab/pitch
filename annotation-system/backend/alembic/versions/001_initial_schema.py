"""Initial schema - create all 16 tables.

Revision ID: 001_initial_schema
Revises:
Create Date: 2026-04-27
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. users (no FK dependencies)
    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("role", sa.VARCHAR(50), nullable=False),
        sa.Column("name", sa.VARCHAR(255), nullable=False),
        sa.Column("email", sa.VARCHAR(255), nullable=True),
        sa.Column("password_hash", sa.VARCHAR(255), nullable=True),
        sa.Column("prolific_id", sa.VARCHAR(255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("email", name="uq_users_email"),
        sa.UniqueConstraint("prolific_id", name="uq_users_prolific_id"),
    )

    # 2. discussion_prompts (no FK dependencies)
    op.create_table(
        "discussion_prompts",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("scenario", sa.VARCHAR(50), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("pre_identified_items", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # 3. groups (FK -> discussion_prompts)
    op.create_table(
        "groups",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("scenario", sa.VARCHAR(50), nullable=False),
        sa.Column(
            "prompt_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("discussion_prompts.id"),
            nullable=True,
        ),
        sa.Column("status", sa.VARCHAR(50), server_default="conversation", nullable=False),
        sa.Column("join_code", sa.VARCHAR(20), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("join_code", name="uq_groups_join_code"),
    )

    # 4. group_memberships (FK -> groups, users)
    op.create_table(
        "group_memberships",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "group_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("groups.id"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "joined_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("group_id", "user_id", name="uq_group_membership"),
    )

    # 5. conversations (FK -> groups)
    op.create_table(
        "conversations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "group_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("groups.id"),
            nullable=False,
        ),
        sa.Column(
            "started_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
    )

    # 6. turns (FK -> conversations, users)
    op.create_table(
        "turns",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "conversation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("conversations.id"),
            nullable=False,
        ),
        sa.Column("turn_number", sa.Integer(), nullable=False),
        sa.Column(
            "speaker_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "timestamp",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "conversation_id", "turn_number", name="uq_conversation_turn_number"
        ),
    )

    # 7. inline_annotations (FK -> conversations, turns, users)
    op.create_table(
        "inline_annotations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "conversation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("conversations.id"),
            nullable=False,
        ),
        sa.Column(
            "turn_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("turns.id"),
            nullable=False,
        ),
        sa.Column(
            "participant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "timestamp",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # 8. knowledge_items (FK -> conversations, users, turns x3)
    op.create_table(
        "knowledge_items",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "conversation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("conversations.id"),
            nullable=False,
        ),
        sa.Column(
            "author_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("raw_ideal_response", sa.Text(), nullable=False),
        sa.Column("neutralized_ideal_response", sa.Text(), nullable=True),
        sa.Column("ai_suggestion_used", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("ai_suggestion_text", sa.Text(), nullable=True),
        sa.Column(
            "window_start_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("turns.id"),
            nullable=False,
        ),
        sa.Column(
            "window_end_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("turns.id"),
            nullable=False,
        ),
        sa.Column(
            "best_turn_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("turns.id"),
            nullable=False,
        ),
        sa.Column("contribution_type", sa.VARCHAR(50), nullable=False),
        sa.Column("pertinence", sa.Float(), nullable=False),
        sa.Column("source", sa.VARCHAR(50), server_default="participant", nullable=False),
        sa.Column("review_status", sa.VARCHAR(50), server_default="pending", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # 9. search_results (FK -> knowledge_items)
    op.create_table(
        "search_results",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "knowledge_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("knowledge_items.id"),
            nullable=False,
        ),
        sa.Column("query", sa.VARCHAR(500), nullable=False),
        sa.Column("result_title", sa.VARCHAR(500), nullable=False),
        sa.Column("result_snippet", sa.Text(), nullable=True),
        sa.Column("result_url", sa.VARCHAR(2000), nullable=True),
        sa.Column("result_metadata", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # 10. transcript_excerpts (FK -> conversations, knowledge_items, turns x2)
    op.create_table(
        "transcript_excerpts",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "conversation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("conversations.id"),
            nullable=False,
        ),
        sa.Column(
            "knowledge_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("knowledge_items.id"),
            nullable=False,
        ),
        sa.Column(
            "start_turn_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("turns.id"),
            nullable=False,
        ),
        sa.Column(
            "end_turn_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("turns.id"),
            nullable=False,
        ),
        sa.Column("preceding_context_summary", sa.Text(), nullable=True),
        sa.Column("following_context_summary", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # 11. annotations (FK -> transcript_excerpts, knowledge_items, users, turns x3, self-ref)
    op.create_table(
        "annotations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "excerpt_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("transcript_excerpts.id"),
            nullable=False,
        ),
        sa.Column(
            "knowledge_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("knowledge_items.id"),
            nullable=False,
        ),
        sa.Column(
            "annotator_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("annotator_role", sa.VARCHAR(50), nullable=False),
        sa.Column("phase", sa.VARCHAR(50), nullable=False),
        sa.Column(
            "window_start_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("turns.id"),
            nullable=True,
        ),
        sa.Column(
            "window_end_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("turns.id"),
            nullable=True,
        ),
        sa.Column(
            "best_turn_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("turns.id"),
            nullable=True,
        ),
        sa.Column("do_not_surface", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("extends_before", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("extends_after", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column("visible_peer_annotations", postgresql.JSONB(), nullable=True),
        sa.Column(
            "revision_of_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("annotations.id"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # 12. priority_rankings (FK -> transcript_excerpts, users)
    op.create_table(
        "priority_rankings",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "excerpt_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("transcript_excerpts.id"),
            nullable=False,
        ),
        sa.Column(
            "annotator_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("phase", sa.VARCHAR(50), nullable=False),
        sa.Column("ranked_items", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # 13. qualification_results (FK -> users)
    op.create_table(
        "qualification_results",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "annotator_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("practice_pairs", postgresql.JSONB(), nullable=False),
        sa.Column("passed", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # 14. attention_checks (FK -> knowledge_items, transcript_excerpts)
    op.create_table(
        "attention_checks",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "knowledge_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("knowledge_items.id"),
            nullable=False,
        ),
        sa.Column(
            "excerpt_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("transcript_excerpts.id"),
            nullable=False,
        ),
        sa.Column("check_type", sa.VARCHAR(50), nullable=False),
        sa.Column("expected_result", sa.VARCHAR(255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # 15. consensus_windows (FK -> knowledge_items, transcript_excerpts, turns x3)
    op.create_table(
        "consensus_windows",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "knowledge_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("knowledge_items.id"),
            nullable=False,
        ),
        sa.Column(
            "excerpt_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("transcript_excerpts.id"),
            nullable=False,
        ),
        sa.Column(
            "consensus_start_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("turns.id"),
            nullable=True,
        ),
        sa.Column(
            "consensus_end_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("turns.id"),
            nullable=True,
        ),
        sa.Column(
            "consensus_best_turn_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("turns.id"),
            nullable=True,
        ),
        sa.Column("annotator_agreement", sa.Float(), nullable=False),
        sa.Column("status", sa.VARCHAR(50), nullable=False),
        sa.Column("source_annotations", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # 16. consensus_priority_rankings (FK -> transcript_excerpts)
    op.create_table(
        "consensus_priority_rankings",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "excerpt_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("transcript_excerpts.id"),
            nullable=False,
        ),
        sa.Column("method", sa.VARCHAR(50), nullable=False),
        sa.Column("ranked_items", postgresql.JSONB(), nullable=False),
        sa.Column("agreement_score", sa.Float(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    # Drop in reverse dependency order
    op.drop_table("consensus_priority_rankings")
    op.drop_table("consensus_windows")
    op.drop_table("attention_checks")
    op.drop_table("qualification_results")
    op.drop_table("priority_rankings")
    op.drop_table("annotations")
    op.drop_table("transcript_excerpts")
    op.drop_table("search_results")
    op.drop_table("knowledge_items")
    op.drop_table("inline_annotations")
    op.drop_table("turns")
    op.drop_table("conversations")
    op.drop_table("group_memberships")
    op.drop_table("groups")
    op.drop_table("discussion_prompts")
    op.drop_table("users")
