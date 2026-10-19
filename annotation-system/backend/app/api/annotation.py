"""REST endpoints for the Cross-Annotation phase (Module 2 — Phase 4)."""

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role
from app.db.session import get_db
from app.models.conversation import Conversation
from app.models.group import GroupMembership
from app.models.user import User
from app.models.enums import UserRole
from app.schemas.annotation import (
    AnnotationCreate,
    AnnotationOut,
    AnnotationUpdate,
    AssignmentOut,
    ExcerptOut,
    PriorityRankingCreate,
    PriorityRankingOut,
    ProgressOut,
)
from app.services import annotation_service
from app.db.base import enum_val

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_uuid(value: str, label: str = "ID") -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {label}: {value}",
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/assignments", response_model=list[AssignmentOut])
async def get_assignments(
    user_id: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Return the list of (excerpt, knowledge_item) pairs assigned to a user.

    Uses the current user if ``user_id`` is not provided.
    """
    if user_id:
        uid = _parse_uuid(user_id, "user_id")
    else:
        uid = _parse_uuid(current_user["user_id"], "user_id")
    return await annotation_service.get_assignments(db, uid)


@router.get("/excerpts/{excerpt_id}", response_model=ExcerptOut)
async def get_excerpt_detail(
    excerpt_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Return the full excerpt with turns, context summaries, and the
    neutralised knowledge item."""
    eid = _parse_uuid(excerpt_id, "excerpt_id")
    return await annotation_service.get_excerpt_detail(db, eid)


@router.get("/excerpts/{excerpt_id}/mine", response_model=list[AnnotationOut])
async def get_my_annotations_for_excerpt(
    excerpt_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Get the current user's annotations for a specific excerpt."""
    from app.models.annotation import Annotation
    from app.models.enums import AnnotationPhase
    from app.models.turn import Turn
    from sqlalchemy import select

    eid = _parse_uuid(excerpt_id, "excerpt_id")
    uid = _parse_uuid(current_user["user_id"], "user_id")

    result = await db.execute(
        select(Annotation).where(
            Annotation.excerpt_id == eid,
            Annotation.annotator_id == uid,
            Annotation.phase == AnnotationPhase.cross_annotation,
            Annotation.revision_of_id.is_(None),
        )
    )
    annotations = result.scalars().all()

    out = []
    for ann in annotations:
        ws = en = bt = None
        if ann.window_start_id:
            t = (await db.execute(select(Turn).where(Turn.id == ann.window_start_id))).scalar_one_or_none()
            if t: ws = t.turn_number
        if ann.window_end_id:
            t = (await db.execute(select(Turn).where(Turn.id == ann.window_end_id))).scalar_one_or_none()
            if t: en = t.turn_number
        if ann.best_turn_id:
            t = (await db.execute(select(Turn).where(Turn.id == ann.best_turn_id))).scalar_one_or_none()
            if t: bt = t.turn_number

        out.append({
            "id": str(ann.id),
            "excerpt_id": str(ann.excerpt_id),
            "knowledge_item_id": str(ann.knowledge_item_id),
            "annotator_id": str(ann.annotator_id),
            "annotator_role": enum_val(ann.annotator_role),
            "phase": enum_val(ann.phase),
            "window_start_turn_number": ws,
            "window_end_turn_number": en,
            "best_turn_number": bt,
            "do_not_surface": ann.do_not_surface,
            "extends_before": ann.extends_before,
            "extends_after": ann.extends_after,
            "contribution_type": ann.contribution_type,
            "contribution_type_detail": ann.contribution_type_detail,
            "pertinence": ann.pertinence,
            "rationale": ann.rationale,
            "revision_of_id": str(ann.revision_of_id) if ann.revision_of_id else None,
            "created_at": ann.created_at,
        })
    return out


@router.post("/", response_model=AnnotationOut, status_code=status.HTTP_201_CREATED)
async def create_annotation(
    body: AnnotationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Create (or auto-save) an annotation for an excerpt + knowledge item."""
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await annotation_service.create_annotation(db, user_id, body)


@router.put("/{annotation_id}", response_model=AnnotationOut)
async def update_annotation(
    annotation_id: str,
    body: AnnotationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Partial update of an existing annotation (owner only)."""
    aid = _parse_uuid(annotation_id, "annotation_id")
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await annotation_service.update_annotation(db, aid, user_id, body)


@router.post(
    "/excerpts/{excerpt_id}/ranking",
    response_model=PriorityRankingOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_priority_ranking(
    excerpt_id: str,
    body: PriorityRankingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Submit or replace a priority ranking for an excerpt."""
    eid = _parse_uuid(excerpt_id, "excerpt_id")
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await annotation_service.create_priority_ranking(
        db, eid, user_id, body
    )


@router.get("/rankable-items")
async def get_rankable_items(
    conversation_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Get all knowledge items available for ranking in a conversation.

    Unlike annotation assignments, this includes the user's own items.
    """
    cid = _parse_uuid(conversation_id, "conversation_id")
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await annotation_service.get_rankable_items(db, cid, user_id)


@router.get("/progress", response_model=ProgressOut)
async def get_progress(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Return completion stats for the current user."""
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await annotation_service.get_progress(db, user_id)


@router.get("/conversations/{conversation_id}/turns")
async def get_conversation_turns_range(
    conversation_id: str,
    start: int = Query(..., ge=1),
    end: int = Query(..., ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Return turns within a turn-number range for a conversation."""
    from app.models.turn import Turn
    from app.models.user import User
    from sqlalchemy import select as sa_select

    cid = _parse_uuid(conversation_id, "conversation_id")

    turns_result = await db.execute(
        sa_select(Turn)
        .where(
            Turn.conversation_id == cid,
            Turn.turn_number >= start,
            Turn.turn_number <= end,
        )
        .order_by(Turn.turn_number)
    )
    turns = turns_result.scalars().all()

    speaker_ids = list({t.speaker_id for t in turns})
    speakers: dict = {}
    if speaker_ids:
        users_result = await db.execute(
            sa_select(User).where(User.id.in_(speaker_ids))
        )
        for u in users_result.scalars().all():
            speakers[u.id] = u.name

    return [
        {
            "id": str(t.id),
            "conversation_id": str(t.conversation_id),
            "turn_number": t.turn_number,
            "speaker_id": str(t.speaker_id),
            "speaker_name": speakers.get(t.speaker_id, "Unknown"),
            "text": t.text,
            "timestamp": t.timestamp.isoformat() if t.timestamp else None,
        }
        for t in turns
    ]


@router.post("/conversations/{conversation_id}/mark-done")
async def mark_annotation_done(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Mark the current user as done with annotation for this conversation."""
    cid = _parse_uuid(conversation_id, "conversation_id")
    user_id = _parse_uuid(current_user["user_id"], "user_id")

    conv_result = await db.execute(
        select(Conversation).where(Conversation.id == cid)
    )
    conv = conv_result.scalar_one_or_none()
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")

    membership_result = await db.execute(
        select(GroupMembership).where(
            GroupMembership.group_id == conv.group_id,
            GroupMembership.user_id == user_id,
        )
    )
    membership = membership_result.scalar_one_or_none()
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this group")

    membership.annotation_done_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    return {"status": "done"}


@router.delete("/conversations/{conversation_id}/mark-done")
async def unmark_annotation_done(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Unmark the current user as done with annotation."""
    cid = _parse_uuid(conversation_id, "conversation_id")
    user_id = _parse_uuid(current_user["user_id"], "user_id")

    conv_result = await db.execute(
        select(Conversation).where(Conversation.id == cid)
    )
    conv = conv_result.scalar_one_or_none()
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")

    membership_result = await db.execute(
        select(GroupMembership).where(
            GroupMembership.group_id == conv.group_id,
            GroupMembership.user_id == user_id,
        )
    )
    membership = membership_result.scalar_one_or_none()
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this group")

    membership.annotation_done_at = None
    await db.commit()
    return {"status": "undone"}


@router.get("/conversations/{conversation_id}/done-progress")
async def get_annotation_done_progress(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Return annotation completion progress for the conversation's group."""
    cid = _parse_uuid(conversation_id, "conversation_id")
    user_id = _parse_uuid(current_user["user_id"], "user_id")

    conv_result = await db.execute(
        select(Conversation).where(Conversation.id == cid)
    )
    conv = conv_result.scalar_one_or_none()
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")

    from app.models.group import Group

    group_result = await db.execute(
        select(Group).where(Group.id == conv.group_id)
    )
    group = group_result.scalar_one()

    members_result = await db.execute(
        select(GroupMembership)
        .join(User, GroupMembership.user_id == User.id)
        .where(
            GroupMembership.group_id == conv.group_id,
            User.role != UserRole.researcher,
        )
    )
    members = members_result.scalars().all()
    total = len(members)
    done = sum(1 for m in members if m.annotation_done_at is not None)

    my_membership = next((m for m in members if m.user_id == user_id), None)
    if my_membership is None:
        my_result = await db.execute(
            select(GroupMembership).where(
                GroupMembership.group_id == conv.group_id,
                GroupMembership.user_id == user_id,
            )
        )
        my_membership = my_result.scalar_one_or_none()

    return {
        "total": total,
        "done": done,
        "current_user_done": my_membership.annotation_done_at is not None if my_membership else False,
        "group_status": enum_val(group.status),
    }
