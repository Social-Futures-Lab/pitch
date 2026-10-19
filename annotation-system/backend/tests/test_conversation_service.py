"""Tests for app/services/conversation_service.py."""

import uuid
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Conversation
from app.models.enums import GroupStatus
from app.models.group import Group
from app.models.inline_annotation import InlineAnnotation
from app.models.turn import Turn
from app.models.user import User
from app.services import conversation_service


# =====================================================================
# create_conversation
# =====================================================================


@pytest.mark.asyncio
async def test_create_conversation_success(db: AsyncSession, group: Group):
    """Creating a conversation for a valid group in 'conversation' status succeeds."""
    conv = await conversation_service.create_conversation(db, str(group.id))

    assert conv is not None
    assert conv.group_id == group.id
    assert conv.ended_at is None


@pytest.mark.asyncio
async def test_create_conversation_nonexistent_group(db: AsyncSession):
    """Creating a conversation for a non-existent group raises 404."""
    fake_id = str(uuid.uuid4())
    with pytest.raises(HTTPException) as exc_info:
        await conversation_service.create_conversation(db, fake_id)

    assert exc_info.value.status_code == 404
    assert "Group not found" in exc_info.value.detail


@pytest.mark.asyncio
async def test_create_conversation_wrong_status(db: AsyncSession, group: Group):
    """Creating a conversation when group status != 'conversation' raises 409."""
    group.status = GroupStatus.construction
    await db.commit()
    await db.refresh(group)

    with pytest.raises(HTTPException) as exc_info:
        await conversation_service.create_conversation(db, str(group.id))

    assert exc_info.value.status_code == 409
    assert "conversation" in exc_info.value.detail.lower()


# =====================================================================
# get_conversation
# =====================================================================


@pytest.mark.asyncio
async def test_get_conversation_with_sorted_turns(
    db: AsyncSession, conversation: Conversation, turns: list[Turn]
):
    """get_conversation returns the conversation with turns sorted by turn_number."""
    result = await conversation_service.get_conversation(db, str(conversation.id))

    assert result.id == conversation.id
    assert len(result.turns) == 10
    turn_numbers = [t.turn_number for t in result.turns]
    assert turn_numbers == list(range(1, 11))


@pytest.mark.asyncio
async def test_get_conversation_not_found(db: AsyncSession):
    """get_conversation with a non-existent id raises 404."""
    with pytest.raises(HTTPException) as exc_info:
        await conversation_service.get_conversation(db, str(uuid.uuid4()))

    assert exc_info.value.status_code == 404
    assert "Conversation not found" in exc_info.value.detail


# =====================================================================
# get_conversation_turns
# =====================================================================


@pytest.mark.asyncio
async def test_get_conversation_turns_paginated(
    db: AsyncSession, conversation: Conversation, turns: list[Turn]
):
    """get_conversation_turns returns paginated results respecting offset and limit."""
    # First page: offset=0, limit=3
    page1 = await conversation_service.get_conversation_turns(
        db, str(conversation.id), offset=0, limit=3
    )
    assert len(page1) == 3
    assert [t.turn_number for t in page1] == [1, 2, 3]

    # Second page: offset=3, limit=3
    page2 = await conversation_service.get_conversation_turns(
        db, str(conversation.id), offset=3, limit=3
    )
    assert len(page2) == 3
    assert [t.turn_number for t in page2] == [4, 5, 6]

    # Beyond the end
    page_end = await conversation_service.get_conversation_turns(
        db, str(conversation.id), offset=10, limit=5
    )
    assert len(page_end) == 0


@pytest.mark.asyncio
async def test_get_conversation_turns_not_found(db: AsyncSession):
    """get_conversation_turns for a non-existent conversation raises 404."""
    with pytest.raises(HTTPException) as exc_info:
        await conversation_service.get_conversation_turns(
            db, str(uuid.uuid4())
        )

    assert exc_info.value.status_code == 404
    assert "Conversation not found" in exc_info.value.detail


# =====================================================================
# create_turn
# =====================================================================


@pytest.mark.asyncio
async def test_create_turn_correct_number(
    db: AsyncSession,
    conversation: Conversation,
    turns: list[Turn],
    participant: User,
):
    """create_turn assigns the correct next turn_number after existing turns."""
    # The turns fixture creates turns 1-10, so the next should be 11.
    turn = await conversation_service.create_turn(
        db,
        str(conversation.id),
        str(participant.id),
        "This is turn eleven",
    )

    assert turn.turn_number == 11
    assert turn.text == "This is turn eleven"
    assert turn.speaker_id == participant.id
    assert turn.conversation_id == conversation.id


@pytest.mark.asyncio
async def test_create_turn_does_not_lock_aggregate_query(
    db: AsyncSession,
    conversation: Conversation,
    turns: list[Turn],
    participant: User,
):
    """PostgreSQL rejects FOR UPDATE on aggregate queries like max()."""
    original_execute = db.execute

    async def _assert_postgres_safe_sql(stmt, params=None, **kwargs):
        compiled = str(
            stmt.compile(
                dialect=postgresql.dialect(),
                compile_kwargs={"literal_binds": False},
            )
        )
        if "max(" in compiled.lower() and "FOR UPDATE" in compiled:
            raise AssertionError(
                "Aggregate turn-number query must not use FOR UPDATE"
            )
        return await original_execute(stmt, params, **kwargs)

    with patch.object(db, "execute", side_effect=_assert_postgres_safe_sql):
        await conversation_service.create_turn(
            db,
            str(conversation.id),
            str(participant.id),
            "This is a PostgreSQL-safe turn",
        )


@pytest.mark.asyncio
async def test_create_turn_conversation_ended(
    db: AsyncSession,
    conversation: Conversation,
    turns: list[Turn],
    participant: User,
):
    """create_turn raises 409 when the conversation has already ended."""
    conversation.ended_at = datetime.now(timezone.utc)
    await db.commit()

    with pytest.raises(HTTPException) as exc_info:
        await conversation_service.create_turn(
            db,
            str(conversation.id),
            str(participant.id),
            "Too late",
        )

    assert exc_info.value.status_code == 409
    assert "ended" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_create_turn_nonexistent_conversation(
    db: AsyncSession, participant: User
):
    """create_turn raises 404 for a non-existent conversation."""
    with pytest.raises(HTTPException) as exc_info:
        await conversation_service.create_turn(
            db,
            str(uuid.uuid4()),
            str(participant.id),
            "Hello",
        )

    assert exc_info.value.status_code == 404
    assert "Conversation not found" in exc_info.value.detail


# =====================================================================
# create_flag
# =====================================================================


@pytest.mark.asyncio
async def test_create_flag_success(
    db: AsyncSession,
    conversation: Conversation,
    turns: list[Turn],
    participant: User,
):
    """create_flag creates an InlineAnnotation for a valid turn."""
    flag = await conversation_service.create_flag(
        db,
        str(conversation.id),
        str(participant.id),
        str(turns[0].id),
    )

    assert flag is not None
    assert flag.conversation_id == conversation.id
    assert flag.participant_id == participant.id
    assert flag.turn_id == turns[0].id


@pytest.mark.asyncio
async def test_create_flag_wrong_conversation_turn(
    db: AsyncSession,
    conversation: Conversation,
    turns: list[Turn],
    participant: User,
):
    """create_flag raises 404 when the turn does not belong to the conversation."""
    # Use a random UUID as the turn_id to simulate a turn from another conversation
    fake_turn_id = str(uuid.uuid4())

    with pytest.raises(HTTPException) as exc_info:
        await conversation_service.create_flag(
            db,
            str(conversation.id),
            str(participant.id),
            fake_turn_id,
        )

    assert exc_info.value.status_code == 404
    assert "Turn not found" in exc_info.value.detail


# =====================================================================
# get_participant_flags
# =====================================================================


@pytest.mark.asyncio
async def test_get_participant_flags_ordered(
    db: AsyncSession,
    conversation: Conversation,
    turns: list[Turn],
    participant: User,
):
    """get_participant_flags returns flags ordered by timestamp."""
    # Create two flags
    flag1 = await conversation_service.create_flag(
        db,
        str(conversation.id),
        str(participant.id),
        str(turns[2].id),
    )
    flag2 = await conversation_service.create_flag(
        db,
        str(conversation.id),
        str(participant.id),
        str(turns[5].id),
    )

    flags = await conversation_service.get_participant_flags(
        db, str(conversation.id), str(participant.id)
    )

    assert len(flags) == 2
    # They should be returned in order of creation (timestamp order)
    assert flags[0].turn_id == turns[2].id
    assert flags[1].turn_id == turns[5].id


@pytest.mark.asyncio
async def test_get_participant_flags_empty(
    db: AsyncSession,
    conversation: Conversation,
    turns: list[Turn],
    participant: User,
):
    """get_participant_flags returns empty list when participant has no flags."""
    flags = await conversation_service.get_participant_flags(
        db, str(conversation.id), str(participant.id)
    )

    assert flags == []


# =====================================================================
# end_conversation
# =====================================================================


@pytest.mark.asyncio
async def test_end_conversation_success(
    db: AsyncSession,
    conversation: Conversation,
    group_with_members: Group,
):
    """end_conversation sets ended_at and transitions group to construction."""
    result = await conversation_service.end_conversation(
        db, str(conversation.id)
    )

    assert result.ended_at is not None
    assert result.ended_at.tzinfo is None
    # Refresh the group to check its status
    await db.refresh(group_with_members)
    assert group_with_members.status == GroupStatus.construction


@pytest.mark.asyncio
async def test_end_conversation_assigns_naive_datetime_before_commit(
    db: AsyncSession,
    conversation: Conversation,
):
    """PostgreSQL timestamp columns reject timezone-aware datetimes."""

    async def _assert_naive_ended_at():
        assert conversation.ended_at is not None
        assert conversation.ended_at.tzinfo is None

    async def _skip_refresh(_obj):
        return None

    with (
        patch.object(db, "commit", side_effect=_assert_naive_ended_at),
        patch.object(db, "refresh", side_effect=_skip_refresh),
    ):
        await conversation_service.end_conversation(db, str(conversation.id))


@pytest.mark.asyncio
async def test_end_conversation_already_ended(
    db: AsyncSession,
    conversation: Conversation,
    group_with_members: Group,
):
    """end_conversation raises 409 if the conversation is already ended."""
    # End it once
    await conversation_service.end_conversation(db, str(conversation.id))

    # Try to end it again
    with pytest.raises(HTTPException) as exc_info:
        await conversation_service.end_conversation(db, str(conversation.id))

    assert exc_info.value.status_code == 409
    assert "already ended" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_end_conversation_not_found(db: AsyncSession):
    """end_conversation raises 404 for a non-existent conversation."""
    with pytest.raises(HTTPException) as exc_info:
        await conversation_service.end_conversation(db, str(uuid.uuid4()))

    assert exc_info.value.status_code == 404
    assert "Conversation not found" in exc_info.value.detail
