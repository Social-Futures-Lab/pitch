import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.conversation import Conversation
from app.models.turn import Turn
from app.models.inline_annotation import InlineAnnotation
from app.models.group import Group, GroupMembership
from app.models.discussion_prompt import DiscussionPrompt
from app.models.user import User
from app.models.enums import GroupStatus
from app.db.base import enum_val


async def validate_participant(
    db: AsyncSession, conversation_id: uuid.UUID, user_id: uuid.UUID
) -> Conversation:
    """Validate that the user is a member of the group owning this conversation.

    Returns the conversation if valid, raises HTTPException otherwise.
    """
    result = await db.execute(
        select(Conversation)
        .options(selectinload(Conversation.group))
        .where(Conversation.id == conversation_id)
    )
    conversation = result.scalar_one_or_none()
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    membership = await db.execute(
        select(GroupMembership).where(
            GroupMembership.group_id == conversation.group_id,
            GroupMembership.user_id == user_id,
        )
    )
    if membership.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this conversation's group",
        )

    return conversation


async def create_conversation(
    db: AsyncSession, group_id: str
) -> Conversation:
    """Create a new conversation for a group.

    Validates that the group exists and its status is 'conversation'.
    """
    gid = uuid.UUID(group_id)
    result = await db.execute(select(Group).where(Group.id == gid))
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )

    if group.status != GroupStatus.conversation:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Group status must be 'conversation', currently '{enum_val(group.status)}'",
        )

    conversation = Conversation(group_id=gid)
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    return conversation


async def get_conversation(
    db: AsyncSession, conversation_id: str
) -> Conversation:
    """Return a conversation with its turns eager-loaded (ordered by turn_number)."""
    try:
        cid = uuid.UUID(conversation_id)
    except ValueError:
        from app.services.admin_service import resolve_conversation_prefix
        cid = await resolve_conversation_prefix(db, conversation_id)
    result = await db.execute(
        select(Conversation)
        .options(
            selectinload(Conversation.turns).selectinload(Turn.speaker),
            selectinload(Conversation.group).selectinload(Group.prompt),
        )
        .where(Conversation.id == cid)
    )
    conversation = result.scalar_one_or_none()
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )
    # Sort turns in-memory since selectinload doesn't support order_by
    conversation.turns.sort(key=lambda t: t.turn_number)
    return conversation


async def get_conversation_turns(
    db: AsyncSession, conversation_id: str, offset: int = 0, limit: int = 100
) -> list[Turn]:
    """Return paginated turns for a conversation, ordered by turn_number."""
    cid = uuid.UUID(conversation_id)
    # Verify conversation exists
    conv_check = await db.execute(
        select(Conversation.id).where(Conversation.id == cid)
    )
    if conv_check.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    result = await db.execute(
        select(Turn)
        .options(selectinload(Turn.speaker))
        .where(Turn.conversation_id == cid)
        .order_by(Turn.turn_number)
        .offset(offset)
        .limit(limit)
    )
    return list(result.scalars().all())


async def create_turn(
    db: AsyncSession,
    conversation_id: str,
    speaker_id: str,
    text_content: str,
) -> Turn:
    """Create a turn with server-side turn numbering.

    Locks the conversation row before calculating the next turn number to
    prevent concurrent writers from assigning the same number.
    """
    cid = uuid.UUID(conversation_id)
    sid = uuid.UUID(speaker_id)

    # Verify conversation exists and is not ended. The row lock serializes
    # turn-number assignment for this conversation on PostgreSQL.
    conv_result = await db.execute(
        select(Conversation)
        .where(Conversation.id == cid)
        .with_for_update()
    )
    conversation = conv_result.scalar_one_or_none()
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )
    if conversation.ended_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conversation has ended",
        )

    # The conversation row is already locked above. Do not use FOR UPDATE on
    # this aggregate query; PostgreSQL rejects row locks on aggregate results.
    max_query = (
        select(func.coalesce(func.max(Turn.turn_number), 0))
        .where(Turn.conversation_id == cid)
    )
    max_result = await db.execute(max_query)
    max_turn = max_result.scalar()
    next_turn = max_turn + 1

    turn = Turn(
        conversation_id=cid,
        turn_number=next_turn,
        speaker_id=sid,
        text=text_content,
    )
    db.add(turn)
    await db.commit()
    await db.refresh(turn, attribute_names=["id", "timestamp"])
    # Eagerly load speaker for response serialization
    await db.refresh(turn, attribute_names=["speaker"])
    return turn


async def create_flag(
    db: AsyncSession,
    conversation_id: str,
    participant_id: str,
    turn_id: str,
) -> InlineAnnotation:
    """Create an inline annotation (flag) for a turn.

    Validates the turn belongs to the conversation.
    """
    cid = uuid.UUID(conversation_id)
    pid = uuid.UUID(participant_id)
    tid = uuid.UUID(turn_id)

    # Verify the turn belongs to this conversation
    turn_result = await db.execute(
        select(Turn).where(Turn.id == tid, Turn.conversation_id == cid)
    )
    turn = turn_result.scalar_one_or_none()
    if turn is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Turn not found in this conversation",
        )

    flag = InlineAnnotation(
        conversation_id=cid,
        turn_id=tid,
        participant_id=pid,
    )
    db.add(flag)
    await db.commit()
    await db.refresh(flag)
    return flag


async def remove_flag(
    db: AsyncSession,
    conversation_id: str,
    participant_id: str,
    turn_id: str,
) -> bool:
    """Remove a flag (inline annotation) for a turn. Returns True if deleted."""
    cid = uuid.UUID(conversation_id)
    pid = uuid.UUID(participant_id)
    tid = uuid.UUID(turn_id)

    result = await db.execute(
        select(InlineAnnotation).where(
            InlineAnnotation.conversation_id == cid,
            InlineAnnotation.turn_id == tid,
            InlineAnnotation.participant_id == pid,
        )
    )
    flag = result.scalar_one_or_none()
    if flag is None:
        return False

    await db.delete(flag)
    await db.commit()
    return True


async def get_participant_flags(
    db: AsyncSession, conversation_id: str, participant_id: str
) -> list[InlineAnnotation]:
    """Return all flags (inline annotations) by a participant in a conversation."""
    cid = uuid.UUID(conversation_id)
    pid = uuid.UUID(participant_id)

    result = await db.execute(
        select(InlineAnnotation)
        .where(
            InlineAnnotation.conversation_id == cid,
            InlineAnnotation.participant_id == pid,
        )
        .order_by(InlineAnnotation.timestamp)
    )
    return list(result.scalars().all())


async def end_conversation(
    db: AsyncSession, conversation_id: str
) -> Conversation:
    """End a conversation and transition the group status to 'construction'.

    Sets ended_at on the conversation and advances the group status.
    """
    cid = uuid.UUID(conversation_id)

    result = await db.execute(
        select(Conversation)
        .options(selectinload(Conversation.group))
        .where(Conversation.id == cid)
    )
    conversation = result.scalar_one_or_none()
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )
    if conversation.ended_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conversation has already ended",
        )

    conversation.ended_at = datetime.now(timezone.utc).replace(tzinfo=None)
    conversation.group.status = GroupStatus.construction
    await db.commit()
    await db.refresh(conversation)
    return conversation


async def resume_conversation(
    db: AsyncSession, conversation_id: str
) -> Conversation:
    """Resume a previously ended conversation.

    Clears ended_at and returns the group to 'conversation' status.
    Only allowed when the group is still in the 'construction' phase.
    """
    cid = uuid.UUID(conversation_id)

    result = await db.execute(
        select(Conversation)
        .options(selectinload(Conversation.group))
        .where(Conversation.id == cid)
    )
    conversation = result.scalar_one_or_none()
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )
    if conversation.ended_at is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conversation is still active",
        )
    if conversation.group.status != GroupStatus.construction:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot resume: group has moved past construction phase (current: {conversation.enum_val(group.status)})",
        )

    conversation.ended_at = None
    conversation.group.status = GroupStatus.conversation
    await db.commit()
    await db.refresh(conversation)
    return conversation
