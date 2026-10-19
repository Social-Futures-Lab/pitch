"""Business logic for Admin & Data Management (Phase 5b)."""

import logging
import secrets
import string
import uuid
from typing import Any, Optional

from fastapi import HTTPException, status
import sqlalchemy as sa
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models.annotation import Annotation
from app.models.attention_check import AttentionCheck
from app.models.conversation import Conversation
from app.models.discussion_prompt import DiscussionPrompt
from app.models.enums import (
    AnnotationPhase,
    AttentionCheckType,
    GroupStatus,
    ReviewStatus,
    Scenario,
    UserRole,
)
from app.models.group import Group, GroupMembership
from app.models.knowledge_item import KnowledgeItem
from app.models.qualification import QualificationResult
from app.models.transcript_excerpt import TranscriptExcerpt
from app.models.turn import Turn
from app.models.user import User
from app.schemas.admin import (
    ExcerptUpdate,
    ItemReviewAction,
    SupplementalAssignment,
    UserCreate,
    UserUpdate,
)
from app.services import neutralization_service
from app.db.base import enum_val

logger = logging.getLogger(__name__)

# Phase ordering for valid transitions
_PHASE_ORDER = [
    GroupStatus.conversation,
    GroupStatus.construction,
    GroupStatus.neutralization,
    GroupStatus.cross_annotation,
    GroupStatus.deliberation,
    GroupStatus.complete,
]


async def resolve_conversation_prefix(
    db: AsyncSession, prefix: str
) -> uuid.UUID:
    """Resolve a full or partial UUID to a conversation UUID.

    Accepts a complete UUID or a hex prefix (e.g. first 8 characters).
    Raises 400 if no match or ambiguous, 404 if not found.
    """
    try:
        return uuid.UUID(prefix)
    except ValueError:
        pass

    clean = prefix.replace("-", "").lower()
    if not clean or not all(c in "0123456789abcdef" for c in clean):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid conversation ID: {prefix}",
        )

    id_col = func.replace(func.cast(Conversation.id, sa.String), "-", "")
    result = await db.execute(
        select(Conversation).where(id_col.like(f"{clean}%"))
    )
    matches = result.scalars().all()

    if len(matches) == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No conversation found matching prefix '{prefix}'",
        )
    if len(matches) > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ambiguous prefix '{prefix}' — matches {len(matches)} conversations. Provide more characters.",
        )
    return matches[0].id


def _generate_join_code(length: int = 8) -> str:
    """Generate a random alphanumeric join code."""
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _resolve_turn_number(
    db: AsyncSession, conversation_id: uuid.UUID, turn_number: int
) -> Turn:
    """Look up a Turn by conversation + turn_number. Raises 404 if not found."""
    result = await db.execute(
        select(Turn).where(
            Turn.conversation_id == conversation_id,
            Turn.turn_number == turn_number,
        )
    )
    turn = result.scalar_one_or_none()
    if turn is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Turn number {turn_number} not found in conversation",
        )
    return turn


# ---------------------------------------------------------------------------
# Groups
# ---------------------------------------------------------------------------


async def create_group(
    db: AsyncSession,
    scenario: str,
    prompt_id: Optional[str] = None,
) -> dict[str, Any]:
    """Create a study group with a random 8-character join code."""
    # Validate scenario
    try:
        scenario_enum = Scenario(scenario)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid scenario: {scenario}. Must be one of: {[s.value for s in Scenario]}",
        )

    prompt_uuid = None
    if prompt_id:
        prompt_uuid = uuid.UUID(prompt_id)
        result = await db.execute(
            select(DiscussionPrompt).where(DiscussionPrompt.id == prompt_uuid)
        )
        if result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Discussion prompt not found",
            )

    # Generate unique join code with retry
    for _ in range(10):
        join_code = _generate_join_code()
        existing = await db.execute(
            select(Group).where(Group.join_code == join_code)
        )
        if existing.scalar_one_or_none() is None:
            break
    else:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate unique join code",
        )

    group = Group(
        scenario=scenario_enum,
        prompt_id=prompt_uuid,
        status=GroupStatus.conversation,
        join_code=join_code,
    )
    db.add(group)
    await db.flush()

    conversation = Conversation(group_id=group.id)
    db.add(conversation)
    await db.commit()
    await db.refresh(group)

    return {
        "id": str(group.id),
        "scenario": enum_val(group.scenario),
        "status": enum_val(group.status),
        "join_code": group.join_code,
        "prompt_id": str(group.prompt_id) if group.prompt_id else None,
        "member_count": 0,
        "created_at": group.created_at,
    }


async def list_groups(db: AsyncSession) -> list[dict[str, Any]]:
    """Return all groups with member counts."""
    # Subquery for member counts
    member_count_subq = (
        select(
            GroupMembership.group_id,
            func.count(GroupMembership.id).label("member_count"),
        )
        .group_by(GroupMembership.group_id)
        .subquery()
    )

    result = await db.execute(
        select(Group, member_count_subq.c.member_count)
        .outerjoin(member_count_subq, Group.id == member_count_subq.c.group_id)
        .order_by(Group.created_at.desc())
    )
    rows = result.all()

    return [
        {
            "id": str(group.id),
            "scenario": enum_val(group.scenario),
            "status": enum_val(group.status),
            "join_code": group.join_code,
            "prompt_id": str(group.prompt_id) if group.prompt_id else None,
            "member_count": member_count or 0,
            "created_at": group.created_at,
        }
        for group, member_count in rows
    ]


async def transition_phase(
    db: AsyncSession,
    group_id: uuid.UUID,
    target_status: str,
) -> dict[str, Any]:
    """Validate and execute a phase transition for a group.

    Transitions must follow the order:
    conversation -> construction -> neutralization -> cross_annotation
    -> deliberation -> complete
    """
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )

    # Validate target status
    try:
        target_enum = GroupStatus(target_status)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid target status: {target_status}. Must be one of: {[s.value for s in GroupStatus]}",
        )

    # Validate ordering
    current_idx = _PHASE_ORDER.index(group.status)
    target_idx = _PHASE_ORDER.index(target_enum)

    if target_idx != current_idx + 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Invalid transition: {enum_val(group.status)} -> {target_status}. "
                f"Next valid phase is: {_PHASE_ORDER[current_idx + 1].value if current_idx + 1 < len(_PHASE_ORDER) else 'none'}"
            ),
        )

    group.status = target_enum
    await db.commit()
    await db.refresh(group)

    # Auto-neutralize when entering neutralization phase
    if target_enum == GroupStatus.neutralization:
        conv_result = await db.execute(
            select(Conversation.id).where(Conversation.group_id == group_id)
        )
        for (conv_id,) in conv_result.all():
            try:
                await neutralization_service.batch_neutralize(db, conv_id)
            except Exception as exc:
                logger.warning("Auto-neutralization failed for conversation %s: %s", conv_id, exc)

    # Auto-generate excerpts when entering cross_annotation phase
    if target_enum == GroupStatus.cross_annotation:
        from app.services import excerpt_service
        conv_result = await db.execute(
            select(Conversation.id).where(Conversation.group_id == group_id)
        )
        conv_ids = [row[0] for row in conv_result.all()]
        if conv_ids:
            items_result = await db.execute(
                select(KnowledgeItem).where(
                    KnowledgeItem.conversation_id.in_(conv_ids),
                    KnowledgeItem.review_status == ReviewStatus.approved,
                )
            )
            for item in items_result.scalars().all():
                try:
                    await excerpt_service.generate_excerpt(db, item.id)
                except Exception as exc:
                    logger.warning("Excerpt generation failed for item %s: %s", item.id, exc)

    # Get member count
    count_result = await db.execute(
        select(func.count(GroupMembership.id)).where(
            GroupMembership.group_id == group_id
        )
    )
    member_count = count_result.scalar() or 0

    return {
        "id": str(group.id),
        "scenario": enum_val(group.scenario),
        "status": enum_val(group.status),
        "join_code": group.join_code,
        "prompt_id": str(group.prompt_id) if group.prompt_id else None,
        "member_count": member_count,
        "created_at": group.created_at,
    }


async def revert_phase(
    db: AsyncSession,
    group_id: uuid.UUID,
    target_status: str,
) -> dict[str, Any]:
    """Revert a group to an earlier phase, preserving all existing data.

    Unlike transition_phase, this allows moving backward. All existing
    annotations, rankings, and knowledge items are preserved in the database.
    Only the group status is changed.
    """
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )

    try:
        target_enum = GroupStatus(target_status)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid target status: {target_status}. Must be one of: {[s.value for s in GroupStatus]}",
        )

    current_idx = _PHASE_ORDER.index(group.status)
    target_idx = _PHASE_ORDER.index(target_enum)

    if target_idx >= current_idx:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Revert target must be an earlier phase. "
                f"Current: {enum_val(group.status)}, target: {target_status}"
            ),
        )

    # Reset conversation ended_at when reverting to conversation
    if target_enum == GroupStatus.conversation:
        await db.execute(
            sa.update(Conversation)
            .where(Conversation.group_id == group_id)
            .values(ended_at=None)
        )

    # Reset construction_done_at for all members when reverting to construction or earlier
    if target_idx <= _PHASE_ORDER.index(GroupStatus.construction):
        await db.execute(
            sa.update(GroupMembership)
            .where(GroupMembership.group_id == group_id)
            .values(construction_done_at=None)
        )

    # Reset annotation_done_at for all members when reverting to/before cross_annotation
    if target_idx <= _PHASE_ORDER.index(GroupStatus.cross_annotation):
        await db.execute(
            sa.update(GroupMembership)
            .where(GroupMembership.group_id == group_id)
            .values(annotation_done_at=None)
        )

    # Reset deliberation_completed_at when reverting to/before deliberation
    if target_idx <= _PHASE_ORDER.index(GroupStatus.deliberation):
        await db.execute(
            sa.update(GroupMembership)
            .where(GroupMembership.group_id == group_id)
            .values(deliberation_completed_at=None, ranking_deliberation_completed_at=None)
        )

    group.status = target_enum
    await db.commit()
    await db.refresh(group)

    count_result = await db.execute(
        select(func.count(GroupMembership.id)).where(
            GroupMembership.group_id == group_id
        )
    )
    member_count = count_result.scalar() or 0

    return {
        "id": str(group.id),
        "scenario": enum_val(group.scenario),
        "status": enum_val(group.status),
        "join_code": group.join_code,
        "prompt_id": str(group.prompt_id) if group.prompt_id else None,
        "member_count": member_count,
        "created_at": group.created_at,
    }


async def get_group_item_stats(
    db: AsyncSession,
    group_id: uuid.UUID,
) -> dict[str, Any]:
    """Return knowledge item counts by status for a group."""
    conv_ids_q = select(Conversation.id).where(Conversation.group_id == group_id)

    total_result = await db.execute(
        select(func.count(KnowledgeItem.id)).where(
            KnowledgeItem.conversation_id.in_(conv_ids_q)
        )
    )
    total = total_result.scalar() or 0

    status_counts: dict[str, int] = {}
    for rs in ReviewStatus:
        count_result = await db.execute(
            select(func.count(KnowledgeItem.id)).where(
                KnowledgeItem.conversation_id.in_(conv_ids_q),
                KnowledgeItem.review_status == rs,
            )
        )
        status_counts[rs.value] = count_result.scalar() or 0

    neutralized_result = await db.execute(
        select(func.count(KnowledgeItem.id)).where(
            KnowledgeItem.conversation_id.in_(conv_ids_q),
            KnowledgeItem.neutralized_ideal_response.isnot(None),
        )
    )
    neutralized = neutralized_result.scalar() or 0

    return {
        "total": total,
        "neutralized": neutralized,
        **status_counts,
    }


async def list_group_members(
    db: AsyncSession,
    group_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """Return all members of a group."""
    result = await db.execute(
        select(GroupMembership, User)
        .join(User, GroupMembership.user_id == User.id)
        .where(GroupMembership.group_id == group_id)
        .order_by(GroupMembership.joined_at)
    )
    rows = result.all()
    return [
        {
            "id": str(membership.id),
            "user_id": str(user.id),
            "name": user.name,
            "email": user.email,
            "role": enum_val(user.role),
            "joined_at": membership.joined_at,
            "construction_done_at": membership.construction_done_at,
            "annotation_done_at": membership.annotation_done_at,
            "deliberation_completed_at": membership.deliberation_completed_at,
        }
        for membership, user in rows
    ]


async def add_group_member(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Add a user to a group."""
    group = (await db.execute(select(Group).where(Group.id == group_id))).scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")

    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    existing = await db.execute(
        select(GroupMembership).where(
            GroupMembership.group_id == group_id,
            GroupMembership.user_id == user_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is already a member of this group")

    membership = GroupMembership(group_id=group_id, user_id=user_id)
    db.add(membership)
    await db.commit()
    await db.refresh(membership)

    return {
        "id": str(membership.id),
        "user_id": str(user.id),
        "name": user.name,
        "email": user.email,
        "role": enum_val(user.role),
        "joined_at": membership.joined_at,
    }


async def remove_group_member(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Remove a user from a group."""
    result = await db.execute(
        select(GroupMembership).where(
            GroupMembership.group_id == group_id,
            GroupMembership.user_id == user_id,
        )
    )
    membership = result.scalar_one_or_none()
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")

    await db.delete(membership)
    await db.commit()


async def list_group_conversations(
    db: AsyncSession,
    group_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """Return all conversations for a group with turn counts."""
    result = await db.execute(
        select(Group).where(Group.id == group_id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )

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
            select(Conversation, turn_count_subq.c.turn_count)
            .outerjoin(
                turn_count_subq,
                Conversation.id == turn_count_subq.c.conversation_id,
            )
            .where(Conversation.group_id == group_id)
            .order_by(Conversation.started_at)
        )
    ).all()

    return [
        {
            "id": str(conv.id),
            "group_id": str(conv.group_id),
            "started_at": conv.started_at,
            "ended_at": conv.ended_at,
            "turn_count": turn_count or 0,
        }
        for conv, turn_count in rows
    ]


# ---------------------------------------------------------------------------
# Knowledge Item Review
# ---------------------------------------------------------------------------


async def get_items_for_review(
    db: AsyncSession,
    status_filter: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Return knowledge items optionally filtered by review_status."""
    query = select(KnowledgeItem).order_by(KnowledgeItem.created_at.desc())

    if status_filter:
        try:
            review_status = ReviewStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status filter: {status_filter}",
            )
        query = query.where(KnowledgeItem.review_status == review_status)

    result = await db.execute(query)
    items = result.scalars().all()

    # Batch-resolve turn IDs
    turn_ids: set[uuid.UUID] = set()
    for item in items:
        turn_ids.add(item.window_start_id)
        turn_ids.add(item.window_end_id)
        turn_ids.add(item.best_turn_id)

    turn_number_map: dict[uuid.UUID, int] = {}
    if turn_ids:
        turns_result = await db.execute(
            select(Turn).where(Turn.id.in_(list(turn_ids)))
        )
        for t in turns_result.scalars().all():
            turn_number_map[t.id] = t.turn_number

    return [
        {
            "id": str(item.id),
            "conversation_id": str(item.conversation_id),
            "author_id": str(item.author_id),
            "raw_ideal_response": item.raw_ideal_response,
            "neutralized_ideal_response": item.neutralized_ideal_response,
            "window_start_turn_number": turn_number_map.get(item.window_start_id, 0),
            "window_end_turn_number": turn_number_map.get(item.window_end_id, 0),
            "best_turn_number": turn_number_map.get(item.best_turn_id, 0),
            "contribution_type": enum_val(item.contribution_type),
            "pertinence": item.pertinence,
            "source": enum_val(item.source),
            "review_status": enum_val(item.review_status),
            "created_at": item.created_at,
        }
        for item in items
    ]


async def review_item(
    db: AsyncSession,
    item_id: uuid.UUID,
    action: str,
    edited_text: Optional[str] = None,
) -> dict[str, Any]:
    """Approve, reject, or edit a knowledge item's neutralized response."""
    result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == item_id)
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Knowledge item not found",
        )

    if action == "approve":
        if not item.neutralized_ideal_response:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot approve item without neutralized response",
            )
        item.review_status = ReviewStatus.approved
    elif action == "reject":
        item.review_status = ReviewStatus.rejected
    elif action == "edit":
        if not edited_text or not edited_text.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="edited_neutralized_response is required for edit action",
            )
        item.neutralized_ideal_response = edited_text
        item.review_status = ReviewStatus.approved
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid action: {action}. Must be 'approve', 'reject', or 'edit'",
        )

    await db.commit()
    await db.refresh(item)

    return {
        "id": str(item.id),
        "review_status": enum_val(item.review_status),
        "neutralized_ideal_response": item.neutralized_ideal_response,
    }


async def trigger_neutralization(
    db: AsyncSession,
    item_id: uuid.UUID,
) -> dict[str, Any]:
    """Run neutralization on a single knowledge item."""
    result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == item_id)
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Knowledge item not found",
        )

    try:
        neutralized = await neutralization_service.neutralize_item(
            item.raw_ideal_response
        )
    except Exception as exc:
        logger.error("Neutralization failed for item %s: %s", item_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Neutralization service error: {str(exc)}",
        )

    item.neutralized_ideal_response = neutralized
    await db.commit()
    await db.refresh(item)

    return {
        "id": str(item.id),
        "neutralized_ideal_response": item.neutralized_ideal_response,
    }


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------


async def create_prompt(
    db: AsyncSession,
    scenario: str,
    text: str,
    pre_identified_items: Optional[list] = None,
) -> dict[str, Any]:
    """Create a new discussion prompt."""
    try:
        scenario_enum = Scenario(scenario)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid scenario: {scenario}",
        )

    prompt = DiscussionPrompt(
        scenario=scenario_enum,
        text=text,
        pre_identified_items=pre_identified_items,
    )
    db.add(prompt)
    await db.commit()
    await db.refresh(prompt)

    return {
        "id": str(prompt.id),
        "scenario": enum_val(prompt.scenario),
        "text": prompt.text,
        "pre_identified_items": prompt.pre_identified_items,
        "created_at": prompt.created_at,
    }


async def list_prompts(db: AsyncSession) -> list[dict[str, Any]]:
    """Return all discussion prompts."""
    result = await db.execute(
        select(DiscussionPrompt).order_by(DiscussionPrompt.created_at.desc())
    )
    prompts = result.scalars().all()
    return [
        {
            "id": str(p.id),
            "scenario": enum_val(p.scenario),
            "text": p.text,
            "pre_identified_items": p.pre_identified_items,
            "created_at": p.created_at,
        }
        for p in prompts
    ]


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


async def create_user(
    db: AsyncSession,
    data: UserCreate,
) -> dict[str, Any]:
    """Create a new user account."""
    try:
        role_enum = UserRole(data.role)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role: {data.role}. Must be one of: {[r.value for r in UserRole]}",
        )

    if not data.email or not data.email.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is required",
        )

    if not data.password or len(data.password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password is required (minimum 6 characters)",
        )

    existing = await db.execute(
        select(User).where(User.email == data.email)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    password_hash_value = hash_password(data.password)

    user = User(
        name=data.name,
        email=data.email,
        role=role_enum,
        password_hash=password_hash_value,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return {
        "id": str(user.id),
        "name": user.name,
        "email": user.email,
        "role": enum_val(user.role),
        "created_at": user.created_at,
    }


async def list_users(db: AsyncSession) -> list[dict[str, Any]]:
    """Return all user accounts."""
    result = await db.execute(
        select(User).order_by(User.created_at.desc())
    )
    users = result.scalars().all()
    return [
        {
            "id": str(u.id),
            "name": u.name,
            "email": u.email,
            "role": enum_val(u.role),
            "created_at": u.created_at,
        }
        for u in users
    ]


async def update_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    data: UserUpdate,
) -> dict[str, Any]:
    """Update an existing user account."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if data.name is not None:
        user.name = data.name

    if data.email is not None:
        if data.email != user.email:
            existing = await db.execute(
                select(User).where(User.email == data.email, User.id != user_id)
            )
            if existing.scalar_one_or_none() is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A user with this email already exists",
                )
            user.email = data.email

    if data.role is not None:
        try:
            user.role = UserRole(data.role)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid role: {data.role}. Must be one of: {[r.value for r in UserRole]}",
            )

    if data.password is not None:
        if len(data.password) < 6:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Password must be at least 6 characters",
            )
        user.password_hash = hash_password(data.password)

    await db.commit()
    await db.refresh(user)

    return {
        "id": str(user.id),
        "name": user.name,
        "email": user.email,
        "role": enum_val(user.role),
        "created_at": user.created_at,
    }


# ---------------------------------------------------------------------------
# Excerpts
# ---------------------------------------------------------------------------


async def list_excerpts(
    db: AsyncSession,
    conversation_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """Return all transcript excerpts for a conversation."""
    result = await db.execute(
        select(TranscriptExcerpt)
        .where(TranscriptExcerpt.conversation_id == conversation_id)
        .order_by(TranscriptExcerpt.created_at)
    )
    excerpts = result.scalars().all()

    # Batch-resolve turn IDs
    turn_ids: set[uuid.UUID] = set()
    for e in excerpts:
        turn_ids.add(e.start_turn_id)
        turn_ids.add(e.end_turn_id)

    turn_number_map: dict[uuid.UUID, int] = {}
    if turn_ids:
        turns_result = await db.execute(
            select(Turn).where(Turn.id.in_(list(turn_ids)))
        )
        for t in turns_result.scalars().all():
            turn_number_map[t.id] = t.turn_number

    return [
        {
            "id": str(e.id),
            "conversation_id": str(e.conversation_id),
            "knowledge_item_id": str(e.knowledge_item_id),
            "start_turn_number": turn_number_map.get(e.start_turn_id, 0),
            "end_turn_number": turn_number_map.get(e.end_turn_id, 0),
            "preceding_context_summary": e.preceding_context_summary,
            "following_context_summary": e.following_context_summary,
            "created_at": e.created_at,
        }
        for e in excerpts
    ]


async def update_excerpt(
    db: AsyncSession,
    excerpt_id: uuid.UUID,
    data: ExcerptUpdate,
) -> dict[str, Any]:
    """Update excerpt boundaries and/or context summaries."""
    result = await db.execute(
        select(TranscriptExcerpt).where(TranscriptExcerpt.id == excerpt_id)
    )
    excerpt = result.scalar_one_or_none()
    if excerpt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transcript excerpt not found",
        )

    update_fields = data.model_dump(exclude_unset=True)
    if not update_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update",
        )

    conversation_id = excerpt.conversation_id

    if "start_turn_number" in update_fields and update_fields["start_turn_number"] is not None:
        turn = await _resolve_turn_number(
            db, conversation_id, update_fields["start_turn_number"]
        )
        excerpt.start_turn_id = turn.id

    if "end_turn_number" in update_fields and update_fields["end_turn_number"] is not None:
        turn = await _resolve_turn_number(
            db, conversation_id, update_fields["end_turn_number"]
        )
        excerpt.end_turn_id = turn.id

    if "preceding_context_summary" in update_fields:
        excerpt.preceding_context_summary = update_fields["preceding_context_summary"]

    if "following_context_summary" in update_fields:
        excerpt.following_context_summary = update_fields["following_context_summary"]

    await db.commit()
    await db.refresh(excerpt)

    # Resolve turn IDs for response
    turn_ids: set[uuid.UUID] = {excerpt.start_turn_id, excerpt.end_turn_id}
    turn_number_map: dict[uuid.UUID, int] = {}
    if turn_ids:
        turns_result = await db.execute(
            select(Turn).where(Turn.id.in_(list(turn_ids)))
        )
        for t in turns_result.scalars().all():
            turn_number_map[t.id] = t.turn_number

    return {
        "id": str(excerpt.id),
        "conversation_id": str(excerpt.conversation_id),
        "knowledge_item_id": str(excerpt.knowledge_item_id),
        "start_turn_number": turn_number_map.get(excerpt.start_turn_id, 0),
        "end_turn_number": turn_number_map.get(excerpt.end_turn_id, 0),
        "preceding_context_summary": excerpt.preceding_context_summary,
        "following_context_summary": excerpt.following_context_summary,
        "created_at": excerpt.created_at,
    }


# ---------------------------------------------------------------------------
# Qualification
# ---------------------------------------------------------------------------


async def configure_qualification(
    db: AsyncSession,
    practice_pairs: list[dict],
) -> dict[str, Any]:
    """Store qualification configuration as practice pairs.

    This creates QualificationResult records with the reference data
    for later evaluation. The practice_pairs list should contain dicts
    with excerpt_id, item_id, and reference turn numbers.
    """
    # Validate that referenced excerpts and items exist
    for pair in practice_pairs:
        excerpt_id = uuid.UUID(pair["excerpt_id"])
        item_id = uuid.UUID(pair["item_id"])

        excerpt_result = await db.execute(
            select(TranscriptExcerpt).where(TranscriptExcerpt.id == excerpt_id)
        )
        if excerpt_result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Excerpt {pair['excerpt_id']} not found",
            )

        item_result = await db.execute(
            select(KnowledgeItem).where(KnowledgeItem.id == item_id)
        )
        if item_result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Knowledge item {pair['item_id']} not found",
            )

    return {
        "status": "ok",
        "practice_pairs_count": len(practice_pairs),
        "practice_pairs": practice_pairs,
    }


async def get_qualification_results(
    db: AsyncSession,
) -> list[dict[str, Any]]:
    """Return all qualification results."""
    result = await db.execute(
        select(QualificationResult).order_by(QualificationResult.created_at.desc())
    )
    results = result.scalars().all()
    return [
        {
            "id": str(qr.id),
            "annotator_id": str(qr.annotator_id),
            "practice_pairs": qr.practice_pairs,
            "passed": qr.passed,
            "created_at": qr.created_at,
        }
        for qr in results
    ]


# ---------------------------------------------------------------------------
# Attention Checks
# ---------------------------------------------------------------------------


async def create_attention_check(
    db: AsyncSession,
    knowledge_item_id: str,
    excerpt_id: str,
    check_type: str,
    expected_result: str,
) -> dict[str, Any]:
    """Create a new attention check."""
    try:
        check_type_enum = AttentionCheckType(check_type)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid check_type: {check_type}. Must be one of: {[ct.value for ct in AttentionCheckType]}",
        )

    item_uuid = uuid.UUID(knowledge_item_id)
    excerpt_uuid = uuid.UUID(excerpt_id)

    # Validate references
    item_result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == item_uuid)
    )
    if item_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Knowledge item not found",
        )

    excerpt_result = await db.execute(
        select(TranscriptExcerpt).where(TranscriptExcerpt.id == excerpt_uuid)
    )
    if excerpt_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transcript excerpt not found",
        )

    check = AttentionCheck(
        knowledge_item_id=item_uuid,
        excerpt_id=excerpt_uuid,
        check_type=check_type_enum,
        expected_result=expected_result,
    )
    db.add(check)
    await db.commit()
    await db.refresh(check)

    return {
        "id": str(check.id),
        "knowledge_item_id": str(check.knowledge_item_id),
        "excerpt_id": str(check.excerpt_id),
        "check_type": enum_val(check.check_type),
        "expected_result": check.expected_result,
        "created_at": check.created_at,
    }


async def get_attention_check_results(
    db: AsyncSession,
) -> list[dict[str, Any]]:
    """Return attention check definitions with per-annotator pass/fail analysis.

    For each attention check, compares annotator submissions against the
    expected result.
    """
    # Fetch all attention checks
    checks_result = await db.execute(
        select(AttentionCheck).order_by(AttentionCheck.created_at)
    )
    checks = checks_result.scalars().all()

    output = []
    for check in checks:
        # Find annotations for this excerpt+item pair
        annotations_result = await db.execute(
            select(Annotation).where(
                Annotation.excerpt_id == check.excerpt_id,
                Annotation.knowledge_item_id == check.knowledge_item_id,
                Annotation.phase == AnnotationPhase.cross_annotation,
            )
        )
        annotations = annotations_result.scalars().all()

        annotator_results = []
        for ann in annotations:
            if check.expected_result == "do_not_surface":
                passed = ann.do_not_surface is True
            else:
                # expected_result is a turn ID
                passed = (
                    ann.best_turn_id is not None
                    and str(ann.best_turn_id) == check.expected_result
                )

            annotator_results.append(
                {
                    "annotator_id": str(ann.annotator_id),
                    "annotation_id": str(ann.id),
                    "passed": passed,
                }
            )

        output.append(
            {
                "check_id": str(check.id),
                "knowledge_item_id": str(check.knowledge_item_id),
                "excerpt_id": str(check.excerpt_id),
                "check_type": enum_val(check.check_type),
                "expected_result": check.expected_result,
                "annotator_results": annotator_results,
            }
        )

    return output


# ---------------------------------------------------------------------------
# Supplemental Annotation
# ---------------------------------------------------------------------------


async def get_supplemental_queue(
    db: AsyncSession,
) -> list[dict[str, Any]]:
    """Return excerpt+item pairs with fewer than 5 cross_annotation annotations."""
    # Count annotations per excerpt+item pair
    count_subq = (
        select(
            Annotation.excerpt_id,
            Annotation.knowledge_item_id,
            func.count(Annotation.id).label("annotation_count"),
        )
        .where(Annotation.phase == AnnotationPhase.cross_annotation)
        .group_by(Annotation.excerpt_id, Annotation.knowledge_item_id)
        .subquery()
    )

    # Get all excerpt+item pairs (from TranscriptExcerpt)
    result = await db.execute(
        select(
            TranscriptExcerpt.id.label("excerpt_id"),
            TranscriptExcerpt.knowledge_item_id,
            count_subq.c.annotation_count,
        )
        .outerjoin(
            count_subq,
            (TranscriptExcerpt.id == count_subq.c.excerpt_id)
            & (TranscriptExcerpt.knowledge_item_id == count_subq.c.knowledge_item_id),
        )
        .where(
            (count_subq.c.annotation_count < 5)
            | (count_subq.c.annotation_count.is_(None))
        )
    )
    rows = result.all()

    return [
        {
            "excerpt_id": str(row.excerpt_id),
            "knowledge_item_id": str(row.knowledge_item_id),
            "annotation_count": row.annotation_count or 0,
        }
        for row in rows
    ]


async def assign_supplemental(
    db: AsyncSession,
    annotator_id: str,
    pairs: list[dict],
) -> dict[str, Any]:
    """Create annotation assignment records for supplemental annotators.

    Creates empty Annotation records in cross_annotation phase with
    annotator_role=external for each excerpt+item pair.
    """
    annotator_uuid = uuid.UUID(annotator_id)

    # Verify annotator exists
    user_result = await db.execute(
        select(User).where(User.id == annotator_uuid)
    )
    if user_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Annotator not found",
        )

    created = []
    for pair in pairs:
        excerpt_uuid = uuid.UUID(pair["excerpt_id"])
        item_uuid = uuid.UUID(pair["knowledge_item_id"])

        # Verify excerpt and item exist
        excerpt_result = await db.execute(
            select(TranscriptExcerpt).where(TranscriptExcerpt.id == excerpt_uuid)
        )
        if excerpt_result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Excerpt {pair['excerpt_id']} not found",
            )

        item_result = await db.execute(
            select(KnowledgeItem).where(KnowledgeItem.id == item_uuid)
        )
        if item_result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Knowledge item {pair['knowledge_item_id']} not found",
            )

        # Check for existing assignment
        existing = await db.execute(
            select(Annotation).where(
                Annotation.excerpt_id == excerpt_uuid,
                Annotation.knowledge_item_id == item_uuid,
                Annotation.annotator_id == annotator_uuid,
                Annotation.phase == AnnotationPhase.cross_annotation,
            )
        )
        if existing.scalar_one_or_none() is not None:
            # Already assigned, skip
            continue

        annotation = Annotation(
            excerpt_id=excerpt_uuid,
            knowledge_item_id=item_uuid,
            annotator_id=annotator_uuid,
            annotator_role=AnnotatorRole.external,
            phase=AnnotationPhase.cross_annotation,
            do_not_surface=False,
        )
        db.add(annotation)
        created.append(
            {
                "excerpt_id": str(excerpt_uuid),
                "knowledge_item_id": str(item_uuid),
            }
        )

    await db.commit()

    return {
        "annotator_id": annotator_id,
        "assigned_count": len(created),
        "pairs": created,
    }
