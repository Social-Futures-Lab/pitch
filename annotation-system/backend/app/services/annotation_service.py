"""Business logic for the Cross-Annotation phase (Module 2 — Phase 4)."""

import logging
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.annotation import Annotation
from app.models.attention_check import AttentionCheck
from app.models.conversation import Conversation
from app.models.enums import (
    AnnotationPhase,
    AnnotatorRole,
    UserRole,
)
from app.models.group import GroupMembership
from app.models.knowledge_item import KnowledgeItem
from app.models.priority_ranking import PriorityRanking
from app.models.transcript_excerpt import TranscriptExcerpt
from app.models.turn import Turn
from app.models.user import User
from app.schemas.annotation import (
    AnnotationCreate,
    AnnotationUpdate,
    PriorityRankingCreate,
)
from app.services import excerpt_service
from app.db.base import enum_val

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _resolve_excerpt_turn_number(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    turn_number: int,
    skip_range_check: bool = False,
) -> Turn:
    """Resolve a turn number within the excerpt's conversation context.

    Validates that the turn exists in the conversation.  Unless
    *skip_range_check* is True, also validates the turn falls within the
    excerpt's turn range (inclusive).
    """
    result = await db.execute(
        select(Turn).where(
            Turn.conversation_id == excerpt.conversation_id,
            Turn.turn_number == turn_number,
        )
    )
    turn = result.scalar_one_or_none()
    if turn is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Turn number {turn_number} not found in conversation",
        )

    if skip_range_check:
        return turn

    # Resolve the excerpt boundary turn numbers for range checking
    st_result = await db.execute(
        select(Turn).where(Turn.id == excerpt.start_turn_id)
    )
    start_turn = st_result.scalar_one()

    et_result = await db.execute(
        select(Turn).where(Turn.id == excerpt.end_turn_id)
    )
    end_turn = et_result.scalar_one()

    if not (start_turn.turn_number <= turn_number <= end_turn.turn_number):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Turn number {turn_number} is outside the excerpt range "
                f"({start_turn.turn_number}–{end_turn.turn_number})"
            ),
        )
    return turn


async def _turn_number_for_id(
    db: AsyncSession, turn_id: uuid.UUID | None
) -> int | None:
    """Return the turn_number for a given turn ID, or None."""
    if turn_id is None:
        return None
    result = await db.execute(select(Turn).where(Turn.id == turn_id))
    turn = result.scalar_one_or_none()
    return turn.turn_number if turn else None


async def _determine_annotator_role(
    db: AsyncSession,
    user_id: uuid.UUID,
    knowledge_item: KnowledgeItem,
) -> AnnotatorRole:
    """Determine the annotator's role relative to the knowledge item.

    - ``author``: the user authored the item
    - ``within_group``: the user is a group member but not the author
    - ``external``: the user is an external annotator (not in the group)
    """
    if knowledge_item.author_id == user_id:
        return AnnotatorRole.author

    # Check if user is in the group that owns the conversation
    conv_result = await db.execute(
        select(Conversation).where(
            Conversation.id == knowledge_item.conversation_id
        )
    )
    conversation = conv_result.scalar_one_or_none()
    if conversation is None:
        return AnnotatorRole.external

    membership = await db.execute(
        select(GroupMembership).where(
            GroupMembership.group_id == conversation.group_id,
            GroupMembership.user_id == user_id,
        )
    )
    if membership.scalar_one_or_none() is not None:
        return AnnotatorRole.within_group

    return AnnotatorRole.external


async def _get_attention_check_item_ids(db: AsyncSession) -> set[uuid.UUID]:
    """Return the set of knowledge_item_ids that are attention checks."""
    result = await db.execute(select(AttentionCheck.knowledge_item_id))
    return {row[0] for row in result.all()}


async def _annotation_to_dict(
    db: AsyncSession, annotation: Annotation
) -> dict[str, Any]:
    """Serialize an Annotation to a dict matching AnnotationOut."""
    result = {
        "id": str(annotation.id),
        "excerpt_id": str(annotation.excerpt_id),
        "knowledge_item_id": str(annotation.knowledge_item_id),
        "annotator_id": str(annotation.annotator_id),
        "annotator_role": enum_val(annotation.annotator_role),
        "phase": enum_val(annotation.phase),
        "window_start_turn_number": await _turn_number_for_id(
            db, annotation.window_start_id
        ),
        "window_end_turn_number": await _turn_number_for_id(
            db, annotation.window_end_id
        ),
        "best_turn_number": await _turn_number_for_id(
            db, annotation.best_turn_id
        ),
        "do_not_surface": annotation.do_not_surface,
        "extends_before": annotation.extends_before,
        "extends_after": annotation.extends_after,
        "contribution_type": annotation.contribution_type,
        "contribution_type_detail": annotation.contribution_type_detail,
        "pertinence": annotation.pertinence,
        "rationale": annotation.rationale,
        "revision_of_id": (
            str(annotation.revision_of_id) if annotation.revision_of_id else None
        ),
        "created_at": annotation.created_at,
    }

    return result


# ---------------------------------------------------------------------------
# Assignment retrieval
# ---------------------------------------------------------------------------


async def get_assignments(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """Return the list of (excerpt, knowledge_item) pairs assigned to a user.

    For **participants** (within-group annotators):
        All approved knowledge items from conversations in their group where
        they are NOT the item author.  An excerpt is auto-generated for each
        item if one does not already exist.

    For **external annotators**:
        Items for which an excerpt already exists that are not authored by them.
        (External annotators are assigned items by the researcher creating
        excerpts; we surface all excerpts that have not yet been annotated by
        this user.)

    Attention-check items are excluded (they are injected separately by the
    frontend or a dedicated endpoint).
    """
    # Look up user
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    attention_check_ids = await _get_attention_check_item_ids(db)

    assignments: list[dict[str, Any]] = []

    if user.role == UserRole.participant:
        # Find groups the user belongs to
        gm_result = await db.execute(
            select(GroupMembership).where(GroupMembership.user_id == user_id)
        )
        memberships = gm_result.scalars().all()
        group_ids = [m.group_id for m in memberships]

        if not group_ids:
            return []

        # Get conversations in those groups
        conv_result = await db.execute(
            select(Conversation).where(Conversation.group_id.in_(group_ids))
        )
        conversations = conv_result.scalars().all()
        conversation_ids = [c.id for c in conversations]

        if not conversation_ids:
            return []

        # Get all approved knowledge items in those conversations, excluding
        # items authored by the user and attention-check items
        items_result = await db.execute(
            select(KnowledgeItem).where(
                KnowledgeItem.conversation_id.in_(conversation_ids),
                KnowledgeItem.author_id != user_id,
            )
        )
        items = items_result.scalars().all()

        # Filter out attention checks
        items = [i for i in items if i.id not in attention_check_ids]

        # Auto-generate excerpts for each item
        for item in items:
            exc = await excerpt_service.generate_excerpt(db, item.id)
            assignments.append(
                await _build_assignment_dict(db, exc, item, user_id)
            )

    elif user.role == UserRole.external_annotator:
        # Fetch all excerpts that exist; the external annotator can annotate
        # any excerpt whose item they did not author.
        exc_result = await db.execute(select(TranscriptExcerpt))
        excerpts = exc_result.scalars().all()

        for exc in excerpts:
            if exc.knowledge_item_id in attention_check_ids:
                continue

            # Fetch the knowledge item to check authorship
            ki_result = await db.execute(
                select(KnowledgeItem).where(
                    KnowledgeItem.id == exc.knowledge_item_id
                )
            )
            ki = ki_result.scalar_one_or_none()
            if ki is None or ki.author_id == user_id:
                continue

            assignments.append(
                await _build_assignment_dict(db, exc, ki, user_id)
            )

    else:
        # Researchers get everything (for oversight)
        exc_result = await db.execute(select(TranscriptExcerpt))
        excerpts = exc_result.scalars().all()

        for exc in excerpts:
            if exc.knowledge_item_id in attention_check_ids:
                continue
            ki_result = await db.execute(
                select(KnowledgeItem).where(
                    KnowledgeItem.id == exc.knowledge_item_id
                )
            )
            ki = ki_result.scalar_one_or_none()
            if ki is None:
                continue
            assignments.append(
                await _build_assignment_dict(db, exc, ki, user_id)
            )

    return assignments


async def _build_assignment_dict(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    item: KnowledgeItem,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Build an assignment dict for a given excerpt/item pair."""
    # Resolve excerpt turn numbers
    st_result = await db.execute(
        select(Turn).where(Turn.id == excerpt.start_turn_id)
    )
    start_turn = st_result.scalar_one()

    et_result = await db.execute(
        select(Turn).where(Turn.id == excerpt.end_turn_id)
    )
    end_turn = et_result.scalar_one()

    # Check whether user has already annotated this excerpt/item pair
    ann_result = await db.execute(
        select(Annotation).where(
            Annotation.excerpt_id == excerpt.id,
            Annotation.knowledge_item_id == item.id,
            Annotation.annotator_id == user_id,
            Annotation.phase == AnnotationPhase.cross_annotation,
        )
    )
    completed = ann_result.scalar_one_or_none() is not None

    return {
        "excerpt_id": str(excerpt.id),
        "conversation_id": str(excerpt.conversation_id),
        "knowledge_item_id": str(item.id),
        "excerpt_start_turn": start_turn.turn_number,
        "excerpt_end_turn": end_turn.turn_number,
        "item_contribution_type": enum_val(item.contribution_type),
        "completed": completed,
    }


# ---------------------------------------------------------------------------
# Excerpt detail
# ---------------------------------------------------------------------------


async def get_excerpt_detail(
    db: AsyncSession,
    excerpt_id: uuid.UUID,
) -> dict[str, Any]:
    """Return the full excerpt with turns, context summaries, and neutralised item."""
    return await excerpt_service.get_excerpt_with_turns(db, excerpt_id)


# ---------------------------------------------------------------------------
# Annotation CRUD
# ---------------------------------------------------------------------------


async def create_annotation(
    db: AsyncSession,
    user_id: uuid.UUID,
    data: AnnotationCreate,
) -> dict[str, Any]:
    """Create a new cross-annotation (or update an existing one for the same
    excerpt + item + user, acting as auto-save).

    Validation rules:
    - If ``do_not_surface`` is True, window/best fields must be null.
    - If ``do_not_surface`` is False, window_start, window_end, and
      best_turn are all required.
    - ``window_start_turn_number`` must be <= ``window_end_turn_number``.
    - ``best_turn_number`` must fall within [window_start, window_end].
    """
    excerpt_id = uuid.UUID(data.excerpt_id)
    knowledge_item_id = uuid.UUID(data.knowledge_item_id)

    # Fetch excerpt
    exc_result = await db.execute(
        select(TranscriptExcerpt).where(TranscriptExcerpt.id == excerpt_id)
    )
    excerpt = exc_result.scalar_one_or_none()
    if excerpt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Excerpt not found",
        )

    # Fetch knowledge item
    ki_result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == knowledge_item_id)
    )
    knowledge_item = ki_result.scalar_one_or_none()
    if knowledge_item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Knowledge item not found",
        )

    # Verify excerpt is associated with this item
    if excerpt.knowledge_item_id != knowledge_item_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Excerpt does not belong to the specified knowledge item",
        )

    # Determine annotator role
    annotator_role = await _determine_annotator_role(db, user_id, knowledge_item)

    # Validate based on do_not_surface
    window_start_id: uuid.UUID | None = None
    window_end_id: uuid.UUID | None = None
    best_turn_id: uuid.UUID | None = None

    if data.do_not_surface:
        if any(
            v is not None
            for v in [
                data.window_start_turn_number,
                data.window_end_turn_number,
                data.best_turn_number,
            ]
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "When do_not_surface is true, window and best turn "
                    "fields must be null"
                ),
            )
    else:
        if (
            data.window_start_turn_number is None
            or data.window_end_turn_number is None
            or data.best_turn_number is None
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "When do_not_surface is false, window_start_turn_number, "
                    "window_end_turn_number, and best_turn_number are required"
                ),
            )

        if data.window_start_turn_number > data.window_end_turn_number:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="window_start_turn_number must be <= window_end_turn_number",
            )

        if not (
            data.window_start_turn_number
            <= data.best_turn_number
            <= data.window_end_turn_number
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="best_turn_number must be within the window range",
            )

        # Resolve turn numbers to turn IDs.  The UI shows the full
        # conversation so always skip the excerpt range check — the turn
        # just needs to exist in the conversation.
        ws_turn = await _resolve_excerpt_turn_number(
            db, excerpt, data.window_start_turn_number,
            skip_range_check=True,
        )
        we_turn = await _resolve_excerpt_turn_number(
            db, excerpt, data.window_end_turn_number,
            skip_range_check=True,
        )
        bt_turn = await _resolve_excerpt_turn_number(
            db, excerpt, data.best_turn_number,
            skip_range_check=True,
        )

        window_start_id = ws_turn.id
        window_end_id = we_turn.id
        best_turn_id = bt_turn.id

    # Check for existing annotation (auto-save: update in place)
    existing_result = await db.execute(
        select(Annotation).where(
            Annotation.excerpt_id == excerpt_id,
            Annotation.knowledge_item_id == knowledge_item_id,
            Annotation.annotator_id == user_id,
            Annotation.phase == AnnotationPhase.cross_annotation,
        )
    )
    existing = existing_result.scalar_one_or_none()

    if existing is not None:
        existing.window_start_id = window_start_id
        existing.window_end_id = window_end_id
        existing.best_turn_id = best_turn_id
        existing.do_not_surface = data.do_not_surface
        existing.extends_before = data.extends_before
        existing.extends_after = data.extends_after
        existing.contribution_type = data.contribution_type
        existing.contribution_type_detail = data.contribution_type_detail
        existing.pertinence = data.pertinence
        existing.rationale = data.rationale
        existing.annotator_role = annotator_role
        await db.commit()
        await db.refresh(existing)

        return await _annotation_to_dict(db, existing)

    annotation = Annotation(
        excerpt_id=excerpt_id,
        knowledge_item_id=knowledge_item_id,
        annotator_id=user_id,
        annotator_role=annotator_role,
        phase=AnnotationPhase.cross_annotation,
        window_start_id=window_start_id,
        window_end_id=window_end_id,
        best_turn_id=best_turn_id,
        do_not_surface=data.do_not_surface,
        extends_before=data.extends_before,
        extends_after=data.extends_after,
        contribution_type=data.contribution_type,
        contribution_type_detail=data.contribution_type_detail,
        pertinence=data.pertinence,
        rationale=data.rationale,
    )
    db.add(annotation)
    await db.commit()
    await db.refresh(annotation)

    return await _annotation_to_dict(db, annotation)


async def update_annotation(
    db: AsyncSession,
    annotation_id: uuid.UUID,
    user_id: uuid.UUID,
    data: AnnotationUpdate,
) -> dict[str, Any]:
    """Partial update of an existing annotation.

    Validates ownership and applies the same field-level validation as create.
    """
    result = await db.execute(
        select(Annotation).where(Annotation.id == annotation_id)
    )
    annotation = result.scalar_one_or_none()
    if annotation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Annotation not found",
        )
    if annotation.annotator_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only update your own annotations",
        )

    update_fields = data.model_dump(exclude_unset=True)

    if not update_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update",
        )

    # Fetch excerpt for turn resolution
    exc_result = await db.execute(
        select(TranscriptExcerpt).where(
            TranscriptExcerpt.id == annotation.excerpt_id
        )
    )
    excerpt = exc_result.scalar_one()

    # Determine the effective do_not_surface value after update
    effective_dns = update_fields.get("do_not_surface", annotation.do_not_surface)

    # Apply simple boolean / text fields
    if "do_not_surface" in update_fields:
        annotation.do_not_surface = update_fields["do_not_surface"]
    if "extends_before" in update_fields:
        annotation.extends_before = update_fields["extends_before"]
    if "extends_after" in update_fields:
        annotation.extends_after = update_fields["extends_after"]
    if "contribution_type" in update_fields:
        annotation.contribution_type = update_fields["contribution_type"]
    if "contribution_type_detail" in update_fields:
        annotation.contribution_type_detail = update_fields["contribution_type_detail"]
    if "pertinence" in update_fields:
        annotation.pertinence = update_fields["pertinence"]
    if "rationale" in update_fields:
        annotation.rationale = update_fields["rationale"]

    if effective_dns:
        # Clear window/best if do_not_surface becomes true
        annotation.window_start_id = None
        annotation.window_end_id = None
        annotation.best_turn_id = None
    else:
        # Resolve current turn numbers for any fields not being updated
        current_ws_num = await _turn_number_for_id(db, annotation.window_start_id)
        current_we_num = await _turn_number_for_id(db, annotation.window_end_id)
        current_bt_num = await _turn_number_for_id(db, annotation.best_turn_id)

        final_ws = update_fields.get("window_start_turn_number", current_ws_num)
        final_we = update_fields.get("window_end_turn_number", current_we_num)
        final_bt = update_fields.get("best_turn_number", current_bt_num)

        # Validate ordering if we have all values
        if final_ws is not None and final_we is not None:
            if final_ws > final_we:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="window_start_turn_number must be <= window_end_turn_number",
                )
        if (
            final_ws is not None
            and final_we is not None
            and final_bt is not None
        ):
            if not (final_ws <= final_bt <= final_we):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="best_turn_number must be within the window range",
                )

        # Resolve and set turn IDs for any turn number changes.
        # The UI shows the full conversation, so always skip the excerpt
        # range check — the turn just needs to exist in the conversation.
        if "window_start_turn_number" in update_fields:
            if update_fields["window_start_turn_number"] is not None:
                turn = await _resolve_excerpt_turn_number(
                    db, excerpt, update_fields["window_start_turn_number"],
                    skip_range_check=True,
                )
                annotation.window_start_id = turn.id
            else:
                annotation.window_start_id = None

        if "window_end_turn_number" in update_fields:
            if update_fields["window_end_turn_number"] is not None:
                turn = await _resolve_excerpt_turn_number(
                    db, excerpt, update_fields["window_end_turn_number"],
                    skip_range_check=True,
                )
                annotation.window_end_id = turn.id
            else:
                annotation.window_end_id = None

        if "best_turn_number" in update_fields:
            if update_fields["best_turn_number"] is not None:
                turn = await _resolve_excerpt_turn_number(
                    db, excerpt, update_fields["best_turn_number"],
                    skip_range_check=True,
                )
                annotation.best_turn_id = turn.id
            else:
                annotation.best_turn_id = None

    await db.commit()
    await db.refresh(annotation)

    return await _annotation_to_dict(db, annotation)


# ---------------------------------------------------------------------------
# Priority ranking
# ---------------------------------------------------------------------------


async def create_priority_ranking(
    db: AsyncSession,
    excerpt_id: uuid.UUID,
    user_id: uuid.UUID,
    data: PriorityRankingCreate,
) -> dict[str, Any]:
    """Create or replace a priority ranking for an excerpt.

    Validates:
    - The excerpt exists.
    - All ranked items belong to the excerpt (share the same
      knowledge_item_id or conversation).
    - The user has completed an annotation for every ranked item.
    - Ranks are sequential starting from 1.
    """
    # Fetch excerpt
    exc_result = await db.execute(
        select(TranscriptExcerpt).where(TranscriptExcerpt.id == excerpt_id)
    )
    excerpt = exc_result.scalar_one_or_none()
    if excerpt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Excerpt not found",
        )

    if not data.ranked_items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ranked_items must not be empty",
        )

    # Validate rank sequencing
    ranks = sorted(ri.rank for ri in data.ranked_items)
    expected = list(range(1, len(data.ranked_items) + 1))
    if ranks != expected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ranks must be sequential starting from 1; got {ranks}",
        )

    # Validate each ranked item
    for ri in data.ranked_items:
        ki_id = uuid.UUID(ri.knowledge_item_id)

        # Verify the item exists and belongs to a conversation in this excerpt
        ki_result = await db.execute(
            select(KnowledgeItem).where(KnowledgeItem.id == ki_id)
        )
        ki = ki_result.scalar_one_or_none()
        if ki is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Knowledge item {ri.knowledge_item_id} not found",
            )
        if ki.conversation_id != excerpt.conversation_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Knowledge item {ri.knowledge_item_id} does not belong "
                    f"to the excerpt's conversation"
                ),
            )

        # For items authored by someone else, verify user has annotated them.
        # Own items don't require annotation (they were created by the user).
        if ki.author_id != user_id:
            ann_result = await db.execute(
                select(Annotation)
                .join(TranscriptExcerpt, Annotation.excerpt_id == TranscriptExcerpt.id)
                .where(
                    TranscriptExcerpt.conversation_id == excerpt.conversation_id,
                    Annotation.knowledge_item_id == ki_id,
                    Annotation.annotator_id == user_id,
                    Annotation.phase == AnnotationPhase.cross_annotation,
                )
            )
            if ann_result.scalar_one_or_none() is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"You must annotate item {ri.knowledge_item_id} before "
                        f"including it in a ranking"
                    ),
                )

        # Validate chosen_best_turn_number exists in the conversation
        turn_result = await db.execute(
            select(Turn).where(
                Turn.conversation_id == excerpt.conversation_id,
                Turn.turn_number == ri.chosen_best_turn_number,
            )
        )
        if turn_result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=(
                    f"Turn number {ri.chosen_best_turn_number} not found "
                    f"in conversation"
                ),
            )

    # Build the JSONB payload
    ranked_items_json = [
        {
            "knowledge_item_id": ri.knowledge_item_id,
            "rank": ri.rank,
            "chosen_best_turn_number": ri.chosen_best_turn_number,
        }
        for ri in data.ranked_items
    ]

    # Upsert: find any existing ranking for this conversation + user + phase.
    # A user should only ever have one cross_annotation ranking per conversation.
    conv_excerpts_result = await db.execute(
        select(TranscriptExcerpt.id).where(
            TranscriptExcerpt.conversation_id == excerpt.conversation_id
        )
    )
    conv_excerpt_ids = [row[0] for row in conv_excerpts_result.all()]

    existing_result = await db.execute(
        select(PriorityRanking).where(
            PriorityRanking.excerpt_id.in_(conv_excerpt_ids),
            PriorityRanking.annotator_id == user_id,
            PriorityRanking.phase == AnnotationPhase.cross_annotation,
        )
    )
    existing = existing_result.scalars().first()
    if existing is not None:
        existing.ranked_items = ranked_items_json
        existing.excerpt_id = excerpt_id
        flag_modified(existing, "ranked_items")
        await db.commit()
        await db.refresh(existing)
        return {
            "id": str(existing.id),
            "excerpt_id": str(existing.excerpt_id),
            "annotator_id": str(existing.annotator_id),
            "phase": enum_val(existing.phase),
            "ranked_items": existing.ranked_items,
            "created_at": existing.created_at,
        }

    ranking = PriorityRanking(
        excerpt_id=excerpt_id,
        annotator_id=user_id,
        phase=AnnotationPhase.cross_annotation,
        ranked_items=ranked_items_json,
    )
    db.add(ranking)
    await db.commit()
    await db.refresh(ranking)

    return {
        "id": str(ranking.id),
        "excerpt_id": str(ranking.excerpt_id),
        "annotator_id": str(ranking.annotator_id),
        "phase": enum_val(ranking.phase),
        "ranked_items": ranking.ranked_items,
        "created_at": ranking.created_at,
    }


# ---------------------------------------------------------------------------
# Rankable items (all knowledge items including user's own)
# ---------------------------------------------------------------------------


async def get_rankable_items(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """Return all knowledge items in a conversation for ranking purposes.

    Unlike annotation assignments, this includes items authored by the user.
    For other people's items, uses the user's annotation for best_turn_number.
    For own items, uses the item's best_turn_id directly.
    """
    # Fetch all knowledge items in this conversation (excluding attention checks)
    attention_result = await db.execute(
        select(AttentionCheck.knowledge_item_id)
    )
    attention_check_ids = {row[0] for row in attention_result.all()}

    items_result = await db.execute(
        select(KnowledgeItem).where(
            KnowledgeItem.conversation_id == conversation_id,
        )
    )
    items = [i for i in items_result.scalars().all() if i.id not in attention_check_ids]

    if not items:
        return []

    # Fetch user's annotations for non-own items
    ann_result = await db.execute(
        select(Annotation)
        .join(TranscriptExcerpt, Annotation.excerpt_id == TranscriptExcerpt.id)
        .where(
            TranscriptExcerpt.conversation_id == conversation_id,
            Annotation.annotator_id == user_id,
            Annotation.phase == AnnotationPhase.cross_annotation,
        )
    )
    annotations = ann_result.scalars().all()
    ann_by_item = {a.knowledge_item_id: a for a in annotations}

    # Fetch all turns in the conversation (for resolving best turn info)
    all_turns_result = await db.execute(
        select(Turn, User)
        .join(User, Turn.speaker_id == User.id)
        .where(Turn.conversation_id == conversation_id)
    )
    all_turns = all_turns_result.all()
    turn_by_id = {t.id: (t, u) for t, u in all_turns}
    turn_by_number = {t.turn_number: (t, u) for t, u in all_turns}

    rankable = []
    for item in items:
        is_own = item.author_id == user_id
        ann = ann_by_item.get(item.id)

        if is_own:
            turn_pair = turn_by_id.get(item.best_turn_id)
            best_turn_number = turn_pair[0].turn_number if turn_pair else None
            do_not_surface = False
        elif ann:
            # Resolve annotation's best_turn_id to a turn number
            ann_turn_pair = turn_by_id.get(ann.best_turn_id) if ann.best_turn_id else None
            best_turn_number = ann_turn_pair[0].turn_number if ann_turn_pair else None
            do_not_surface = ann.do_not_surface
        else:
            continue

        # For do-not-surface items without a best turn, use the item's own best_turn_id
        if best_turn_number is None:
            if do_not_surface:
                fallback_pair = turn_by_id.get(item.best_turn_id)
                best_turn_number = fallback_pair[0].turn_number if fallback_pair else None
            if best_turn_number is None:
                continue

        # Resolve turn text and speaker
        turn_pair = turn_by_number.get(best_turn_number)

        rankable.append({
            "knowledge_item_id": str(item.id),
            "neutralized_ideal_response": item.neutralized_ideal_response or item.raw_ideal_response,
            "contribution_type": enum_val(item.contribution_type),
            "best_turn_number": best_turn_number,
            "best_turn_text": turn_pair[0].text if turn_pair else None,
            "best_turn_speaker": turn_pair[1].name if turn_pair else None,
            "is_own_item": is_own,
            "do_not_surface": do_not_surface,
        })

    return rankable


# ---------------------------------------------------------------------------
# Progress
# ---------------------------------------------------------------------------


async def get_progress(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> dict[str, int]:
    """Return completion stats for the current user.

    ``total``: number of assigned (excerpt, item) pairs.
    ``completed``: number that have a cross_annotation Annotation record.
    ``pending``: total - completed.
    """
    assignments = await get_assignments(db, user_id)
    total = len(assignments)
    completed = sum(1 for a in assignments if a["completed"])
    return {
        "total": total,
        "completed": completed,
        "pending": total - completed,
    }
