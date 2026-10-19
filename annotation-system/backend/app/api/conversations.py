import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.dependencies import get_current_user, require_role
from app.core.websocket import manager
from app.models.group import Group, GroupMembership
from app.models.conversation import Conversation
from app.models.turn import Turn
from app.models.user import User
from app.models.enums import UserRole
from app.services import conversation_service
from app.schemas.conversation import (
    ConversationCreate,
    ConversationOut,
    ConversationDetail,
    TurnOut,
    FlagCreate,
    FlagOut,
)
from app.schemas.common import MessageResponse
from app.db.base import enum_val

router = APIRouter()


def _turn_out(turn) -> TurnOut:
    """Serialize a Turn ORM object into a TurnOut schema."""
    ts = turn.timestamp
    if ts and ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return TurnOut(
        id=str(turn.id),
        conversation_id=str(turn.conversation_id),
        turn_number=turn.turn_number,
        speaker_id=str(turn.speaker_id),
        speaker_name=turn.speaker.name if turn.speaker else "Unknown",
        text=turn.text,
        timestamp=ts,
    )


def _conversation_out(conv) -> ConversationOut:
    """Serialize a Conversation ORM object into a ConversationOut schema."""
    return ConversationOut(
        id=str(conv.id),
        group_id=str(conv.group_id),
        started_at=conv.started_at,
        ended_at=conv.ended_at,
    )


def _conversation_detail(conv) -> ConversationDetail:
    """Serialize a Conversation ORM object (with turns loaded) into ConversationDetail."""
    topic = None
    if conv.group and conv.group.prompt:
        topic = conv.group.prompt.text
    return ConversationDetail(
        id=str(conv.id),
        group_id=str(conv.group_id),
        topic=topic,
        started_at=conv.started_at,
        ended_at=conv.ended_at,
        turns=[_turn_out(t) for t in conv.turns],
    )


def _flag_out(flag) -> FlagOut:
    """Serialize an InlineAnnotation ORM object into a FlagOut schema."""
    return FlagOut(
        id=str(flag.id),
        turn_id=str(flag.turn_id),
        timestamp=flag.timestamp,
    )


@router.get("/my-groups")
async def get_my_groups(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Return groups the current user belongs to, with active conversation info."""
    user_id = uuid.UUID(current_user["user_id"])

    memberships_result = await db.execute(
        select(GroupMembership).where(GroupMembership.user_id == user_id)
    )
    my_memberships = {m.group_id: m for m in memberships_result.scalars().all()}
    group_ids = list(my_memberships.keys())
    if not group_ids:
        return []

    turn_count_subq = (
        select(
            Turn.conversation_id,
            func.count(Turn.id).label("turn_count"),
        )
        .group_by(Turn.conversation_id)
        .subquery()
    )

    rows = (
        await db.execute(
            select(Group, Conversation, turn_count_subq.c.turn_count)
            .outerjoin(Conversation, Conversation.group_id == Group.id)
            .outerjoin(turn_count_subq, Conversation.id == turn_count_subq.c.conversation_id)
            .where(Group.id.in_(group_ids))
            .order_by(Group.created_at.desc())
        )
    ).all()

    # Preload construction progress for groups in construction phase
    construction_group_ids = [g.id for g, _, _ in rows if enum_val(g.status) == "construction"]
    construction_progress: dict[uuid.UUID, dict] = {}
    if construction_group_ids:
        all_memberships_result = await db.execute(
            select(GroupMembership)
            .join(User, GroupMembership.user_id == User.id)
            .where(
                GroupMembership.group_id.in_(construction_group_ids),
                User.role == UserRole.participant,
            )
        )
        all_memberships = all_memberships_result.scalars().all()
        for gid in construction_group_ids:
            group_members = [m for m in all_memberships if m.group_id == gid]
            total = len(group_members)
            done = sum(1 for m in group_members if m.construction_done_at is not None)
            construction_progress[gid] = {"total": total, "done": done}

    results = []
    needs_commit = False
    for group, conv, turn_count in rows:
        if conv is None and enum_val(group.status) == "conversation":
            conv = Conversation(group_id=group.id)
            db.add(conv)
            needs_commit = True
            await db.flush()
            await db.refresh(conv)

        my_membership = my_memberships.get(group.id)
        entry = {
            "group_id": str(group.id),
            "scenario": enum_val(group.scenario),
            "status": enum_val(group.status),
            "conversation_id": str(conv.id) if conv else None,
            "conversation_started_at": conv.started_at if conv else None,
            "conversation_ended_at": conv.ended_at if conv else None,
            "turn_count": turn_count or 0,
        }

        if enum_val(group.status) == "construction":
            progress = construction_progress.get(group.id, {"total": 0, "done": 0})
            entry["construction_done"] = my_membership.construction_done_at is not None if my_membership else False
            entry["construction_progress"] = progress

        results.append(entry)

    if needs_commit:
        await db.commit()

    return results


@router.post("/", response_model=ConversationOut, status_code=201)
async def create_conversation(
    body: ConversationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Create a new conversation for a group. Researcher only."""
    conversation = await conversation_service.create_conversation(
        db, body.group_id
    )
    return _conversation_out(conversation)


@router.get("/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get a conversation with all its turns."""
    conversation = await conversation_service.get_conversation(
        db, conversation_id
    )
    return _conversation_detail(conversation)


@router.get("/{conversation_id}/turns", response_model=List[TurnOut])
async def get_conversation_turns(
    conversation_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get paginated turns for a conversation."""
    turns = await conversation_service.get_conversation_turns(
        db, conversation_id, offset=offset, limit=limit
    )
    return [_turn_out(t) for t in turns]


@router.post(
    "/{conversation_id}/flags", response_model=FlagOut, status_code=201
)
async def create_flag(
    conversation_id: str,
    body: FlagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Create a flag (inline annotation) on a turn. Participant must be a group member."""
    user_id = current_user["user_id"]
    await conversation_service.validate_participant(
        db, uuid.UUID(conversation_id), uuid.UUID(user_id)
    )
    flag = await conversation_service.create_flag(
        db, conversation_id, user_id, body.turn_id
    )
    return _flag_out(flag)


@router.get("/{conversation_id}/flags", response_model=List[FlagOut])
async def get_my_flags(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get the current user's flags for a conversation."""
    user_id = current_user["user_id"]
    flags = await conversation_service.get_participant_flags(
        db, conversation_id, user_id
    )
    return [_flag_out(f) for f in flags]


@router.post("/{conversation_id}/end", response_model=ConversationOut)
async def end_conversation(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """End a conversation and transition group to 'construction' phase."""
    if current_user["role"] != "researcher":
        await conversation_service.validate_participant(
            db,
            uuid.UUID(conversation_id),
            uuid.UUID(current_user["user_id"]),
        )
    conversation = await conversation_service.end_conversation(
        db, conversation_id
    )
    room_id = str(conversation.id)
    await manager.broadcast(
        {
            "type": "conversation_ended",
            "ended_by": current_user["user_id"],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
        room_id,
    )
    return _conversation_out(conversation)


@router.post("/{conversation_id}/resume", response_model=ConversationOut)
async def resume_conversation(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Resume a previously ended conversation, returning group to conversation phase. Researcher only."""
    conversation = await conversation_service.resume_conversation(
        db, conversation_id
    )
    return _conversation_out(conversation)
