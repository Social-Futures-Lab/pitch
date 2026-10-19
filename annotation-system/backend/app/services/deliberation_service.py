"""Business logic for the Deliberation phase (Phase 5a)."""

import logging
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.annotation import Annotation
from app.models.enums import AnnotationPhase, AnnotatorRole, GroupStatus, UserRole
from app.models.group import Group, GroupMembership
from app.models.knowledge_item import KnowledgeItem
from app.models.transcript_excerpt import TranscriptExcerpt
from app.models.turn import Turn
from app.models.user import User
from app.schemas.deliberation import RevisionCreate
from app.db.base import enum_val

logger = logging.getLogger(__name__)

# Letters for anonymous labels: A, B, C, ...
_LABELS = [chr(i) for i in range(ord("A"), ord("Z") + 1)]


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


async def _get_turn_number_map(
    db: AsyncSession, turn_ids: set[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """Batch-resolve turn UUIDs to turn numbers."""
    if not turn_ids:
        return {}
    result = await db.execute(
        select(Turn).where(Turn.id.in_(list(turn_ids)))
    )
    return {t.id: t.turn_number for t in result.scalars().all()}


async def _get_excerpt_conversation_id(
    db: AsyncSession, excerpt_id: uuid.UUID
) -> uuid.UUID:
    """Return the conversation_id for a given excerpt. Raises 404 if not found."""
    result = await db.execute(
        select(TranscriptExcerpt).where(TranscriptExcerpt.id == excerpt_id)
    )
    excerpt = result.scalar_one_or_none()
    if excerpt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transcript excerpt not found",
        )
    return excerpt.conversation_id


def _annotation_to_dict(
    annotation: Annotation,
    turn_number_map: dict[uuid.UUID, int],
) -> dict[str, Any]:
    """Serialize an Annotation to a dict with resolved turn numbers."""
    return {
        "id": str(annotation.id),
        "excerpt_id": str(annotation.excerpt_id),
        "knowledge_item_id": str(annotation.knowledge_item_id),
        "annotator_id": str(annotation.annotator_id),
        "annotator_role": enum_val(annotation.annotator_role),
        "phase": enum_val(annotation.phase),
        "window_start_turn_number": (
            turn_number_map.get(annotation.window_start_id)
            if annotation.window_start_id
            else None
        ),
        "window_end_turn_number": (
            turn_number_map.get(annotation.window_end_id)
            if annotation.window_end_id
            else None
        ),
        "best_turn_number": (
            turn_number_map.get(annotation.best_turn_id)
            if annotation.best_turn_id
            else None
        ),
        "do_not_surface": annotation.do_not_surface,
        "extends_before": annotation.extends_before,
        "extends_after": annotation.extends_after,
        "contribution_type": annotation.contribution_type,
        "contribution_type_detail": annotation.contribution_type_detail,
        "pertinence": annotation.pertinence,
        "rationale": annotation.rationale,
        "revision_of_id": (
            str(annotation.revision_of_id)
            if annotation.revision_of_id
            else None
        ),
        "created_at": annotation.created_at,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def get_peer_annotations(
    db: AsyncSession,
    excerpt_id: uuid.UUID,
    knowledge_item_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Get anonymized peer annotations and the user's own original annotation.

    Returns all cross_annotation-phase annotations for this excerpt+item,
    excluding the user's own, with stable anonymous labels.
    Also returns the user's own original cross_annotation-phase annotation.
    """
    # Fetch all cross_annotation-phase annotations for this excerpt + item
    result = await db.execute(
        select(Annotation)
        .where(
            Annotation.excerpt_id == excerpt_id,
            Annotation.knowledge_item_id == knowledge_item_id,
            Annotation.phase == AnnotationPhase.cross_annotation,
        )
        .order_by(Annotation.annotator_id)  # stable ordering for labels
    )
    all_annotations = result.scalars().all()

    # Separate own vs peers
    own_annotation = None
    peer_annotations = []
    for ann in all_annotations:
        if ann.annotator_id == user_id:
            own_annotation = ann
        else:
            peer_annotations.append(ann)

    if own_annotation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Your original annotation not found for this excerpt and item",
        )

    # Fetch the original knowledge item for the author's placement
    ki_result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == knowledge_item_id)
    )
    knowledge_item = ki_result.scalar_one_or_none()

    # Collect all turn IDs to batch-resolve
    turn_ids: set[uuid.UUID] = set()
    for ann in all_annotations:
        if ann.window_start_id:
            turn_ids.add(ann.window_start_id)
        if ann.window_end_id:
            turn_ids.add(ann.window_end_id)
        if ann.best_turn_id:
            turn_ids.add(ann.best_turn_id)
    if knowledge_item:
        turn_ids.add(knowledge_item.window_start_id)
        turn_ids.add(knowledge_item.window_end_id)
        turn_ids.add(knowledge_item.best_turn_id)

    turn_number_map = await _get_turn_number_map(db, turn_ids)

    # Build peer list: start with the original author's placement
    peers = []
    if knowledge_item:
        peers.append(
            {
                "annotator_label": "Original author",
                "window_start_turn_number": turn_number_map.get(
                    knowledge_item.window_start_id
                ),
                "window_end_turn_number": turn_number_map.get(
                    knowledge_item.window_end_id
                ),
                "best_turn_number": turn_number_map.get(
                    knowledge_item.best_turn_id
                ),
                "do_not_surface": False,
                "extends_before": False,
                "extends_after": False,
                "rationale": knowledge_item.notes,
                "contribution_type": enum_val(knowledge_item.contribution_type),
                "pertinence": knowledge_item.pertinence,
            }
        )

    # Add anonymized peer annotations
    for idx, ann in enumerate(peer_annotations):
        label = f"Annotator {_LABELS[idx % len(_LABELS)]}"
        peers.append(
            {
                "annotator_label": label,
                "window_start_turn_number": (
                    turn_number_map.get(ann.window_start_id)
                    if ann.window_start_id
                    else None
                ),
                "window_end_turn_number": (
                    turn_number_map.get(ann.window_end_id)
                    if ann.window_end_id
                    else None
                ),
                "best_turn_number": (
                    turn_number_map.get(ann.best_turn_id)
                    if ann.best_turn_id
                    else None
                ),
                "do_not_surface": ann.do_not_surface,
                "extends_before": ann.extends_before,
                "extends_after": ann.extends_after,
                "rationale": ann.rationale,
                "contribution_type": ann.contribution_type,
                "pertinence": ann.pertinence,
            }
        )

    own_dict = _annotation_to_dict(own_annotation, turn_number_map)

    return {
        "peers": peers,
        "own_annotation": own_dict,
    }


async def get_my_original(
    db: AsyncSession,
    excerpt_id: uuid.UUID,
    knowledge_item_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Return the user's current annotation (deliberation revision if exists, otherwise original).

    This is used to populate the editable fields in the deliberation UI.
    Returns the deliberation-phase revision if one exists, otherwise falls back
    to the original cross_annotation-phase annotation.
    """
    # First try to get the deliberation revision (most recent if multiple exist)
    result = await db.execute(
        select(Annotation)
        .where(
            Annotation.excerpt_id == excerpt_id,
            Annotation.knowledge_item_id == knowledge_item_id,
            Annotation.annotator_id == user_id,
            Annotation.phase == AnnotationPhase.deliberation,
        )
        .order_by(Annotation.created_at.desc())
    )
    annotation = result.scalars().first()

    # Fall back to the original cross_annotation if no deliberation revision exists
    if annotation is None:
        result = await db.execute(
            select(Annotation).where(
                Annotation.excerpt_id == excerpt_id,
                Annotation.knowledge_item_id == knowledge_item_id,
                Annotation.annotator_id == user_id,
                Annotation.phase == AnnotationPhase.cross_annotation,
            )
        )
        annotation = result.scalar_one_or_none()

    if annotation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Original annotation not found",
        )

    turn_ids: set[uuid.UUID] = set()
    if annotation.window_start_id:
        turn_ids.add(annotation.window_start_id)
    if annotation.window_end_id:
        turn_ids.add(annotation.window_end_id)
    if annotation.best_turn_id:
        turn_ids.add(annotation.best_turn_id)

    turn_number_map = await _get_turn_number_map(db, turn_ids)
    return _annotation_to_dict(annotation, turn_number_map)


async def create_revision(
    db: AsyncSession,
    excerpt_id: uuid.UUID,
    knowledge_item_id: uuid.UUID,
    user_id: uuid.UUID,
    data: RevisionCreate,
) -> dict[str, Any]:
    """Create or update a deliberation-phase revision of the user's original annotation.

    Finds the user's original cross_annotation-phase annotation for this
    excerpt+item, then creates or updates an Annotation record with
    phase="deliberation" and revision_of pointing to the original.
    """
    logger.info(
        f"create_revision called: excerpt_id={excerpt_id}, knowledge_item_id={knowledge_item_id}, "
        f"user_id={user_id}, data={data}"
    )

    # Find the original cross_annotation-phase annotation
    result = await db.execute(
        select(Annotation).where(
            Annotation.excerpt_id == excerpt_id,
            Annotation.knowledge_item_id == knowledge_item_id,
            Annotation.annotator_id == user_id,
            Annotation.phase == AnnotationPhase.cross_annotation,
        )
    )
    original = result.scalar_one_or_none()
    if original is None:
        logger.error(f"Original annotation not found for user {user_id}, excerpt {excerpt_id}, item {knowledge_item_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Original annotation not found for revision",
        )

    # Check if a deliberation revision already exists (take most recent if multiple)
    existing_result = await db.execute(
        select(Annotation)
        .where(
            Annotation.excerpt_id == excerpt_id,
            Annotation.knowledge_item_id == knowledge_item_id,
            Annotation.annotator_id == user_id,
            Annotation.phase == AnnotationPhase.deliberation,
            Annotation.revision_of_id == original.id,
        )
        .order_by(Annotation.created_at.desc())
    )
    existing_revision = existing_result.scalars().first()

    # Get the conversation_id for turn resolution
    conversation_id = await _get_excerpt_conversation_id(db, excerpt_id)

    # Resolve turn numbers to turn IDs
    # Handle explicit None for do-not-surface case
    window_start_id: Optional[uuid.UUID] = None
    window_end_id: Optional[uuid.UUID] = None
    best_turn_id: Optional[uuid.UUID] = None

    if data.window_start_turn_number is not None:
        turn = await _resolve_turn_number(
            db, conversation_id, data.window_start_turn_number
        )
        window_start_id = turn.id
    elif existing_revision:
        # Preserve existing value if not provided and revision exists
        window_start_id = existing_revision.window_start_id
    elif data.do_not_surface is not True:
        # Fall back to original only if not do-not-surface
        window_start_id = original.window_start_id

    if data.window_end_turn_number is not None:
        turn = await _resolve_turn_number(
            db, conversation_id, data.window_end_turn_number
        )
        window_end_id = turn.id
    elif existing_revision:
        window_end_id = existing_revision.window_end_id
    elif data.do_not_surface is not True:
        window_end_id = original.window_end_id

    if data.best_turn_number is not None:
        turn = await _resolve_turn_number(
            db, conversation_id, data.best_turn_number
        )
        best_turn_id = turn.id
    elif existing_revision:
        best_turn_id = existing_revision.best_turn_id
    elif data.do_not_surface is not True:
        best_turn_id = original.best_turn_id

    # Determine field values
    do_not_surface = (
        data.do_not_surface
        if data.do_not_surface is not None
        else (existing_revision.do_not_surface if existing_revision else original.do_not_surface)
    )
    extends_before = (
        data.extends_before
        if data.extends_before is not None
        else (existing_revision.extends_before if existing_revision else original.extends_before)
    )
    extends_after = (
        data.extends_after
        if data.extends_after is not None
        else (existing_revision.extends_after if existing_revision else original.extends_after)
    )
    rationale = (
        data.rationale
        if data.rationale is not None
        else (existing_revision.rationale if existing_revision else original.rationale)
    )
    contribution_type = (
        data.contribution_type
        if data.contribution_type is not None
        else (existing_revision.contribution_type if existing_revision else original.contribution_type)
    )
    contribution_type_detail = (
        data.contribution_type_detail
        if data.contribution_type_detail is not None
        else (existing_revision.contribution_type_detail if existing_revision else original.contribution_type_detail)
    )
    pertinence = (
        data.pertinence
        if data.pertinence is not None
        else (existing_revision.pertinence if existing_revision else original.pertinence)
    )

    if existing_revision:
        # Update existing revision
        logger.info(f"Updating existing revision {existing_revision.id}")
        existing_revision.window_start_id = window_start_id
        existing_revision.window_end_id = window_end_id
        existing_revision.best_turn_id = best_turn_id
        existing_revision.do_not_surface = do_not_surface
        existing_revision.extends_before = extends_before
        existing_revision.extends_after = extends_after
        existing_revision.rationale = rationale
        existing_revision.contribution_type = contribution_type
        existing_revision.contribution_type_detail = contribution_type_detail
        existing_revision.pertinence = pertinence
        revision = existing_revision
    else:
        # Create new revision
        logger.info(f"Creating new revision for original annotation {original.id}")
        revision = Annotation(
            excerpt_id=excerpt_id,
            knowledge_item_id=knowledge_item_id,
            annotator_id=user_id,
            annotator_role=original.annotator_role,
            phase=AnnotationPhase.deliberation,
            window_start_id=window_start_id,
            window_end_id=window_end_id,
            best_turn_id=best_turn_id,
            do_not_surface=do_not_surface,
            extends_before=extends_before,
            extends_after=extends_after,
            rationale=rationale,
            contribution_type=contribution_type,
            contribution_type_detail=contribution_type_detail,
            pertinence=pertinence,
            revision_of_id=original.id,
        )
        db.add(revision)

    await db.commit()
    await db.refresh(revision)
    logger.info(
        f"Revision saved successfully: id={revision.id}, do_not_surface={revision.do_not_surface}, "
        f"window_start={window_start_id}, window_end={window_end_id}, best_turn={best_turn_id}"
    )

    # Resolve turn IDs for the response
    turn_ids: set[uuid.UUID] = set()
    if revision.window_start_id:
        turn_ids.add(revision.window_start_id)
    if revision.window_end_id:
        turn_ids.add(revision.window_end_id)
    if revision.best_turn_id:
        turn_ids.add(revision.best_turn_id)

    turn_number_map = await _get_turn_number_map(db, turn_ids)
    return _annotation_to_dict(revision, turn_number_map)


async def log_visibility(
    db: AsyncSession,
    excerpt_id: uuid.UUID,
    knowledge_item_id: uuid.UUID,
    user_id: uuid.UUID,
    visible_annotation_ids: list[str],
) -> dict[str, str]:
    """Log which peer annotations were visible during deliberation.

    Updates the user's deliberation-phase annotation (or original if no
    revision yet) with the visible_peer_annotations JSONB field.
    """
    # First try to find a deliberation-phase revision (most recent if duplicates)
    result = await db.execute(
        select(Annotation).where(
            Annotation.excerpt_id == excerpt_id,
            Annotation.knowledge_item_id == knowledge_item_id,
            Annotation.annotator_id == user_id,
            Annotation.phase == AnnotationPhase.deliberation,
        ).order_by(Annotation.created_at.desc())
    )
    annotation = result.scalars().first()

    # Fall back to the original cross_annotation-phase annotation
    if annotation is None:
        result = await db.execute(
            select(Annotation).where(
                Annotation.excerpt_id == excerpt_id,
                Annotation.knowledge_item_id == knowledge_item_id,
                Annotation.annotator_id == user_id,
                Annotation.phase == AnnotationPhase.cross_annotation,
            ).order_by(Annotation.created_at.desc())
        )
        annotation = result.scalars().first()

    if annotation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No annotation found to update visibility log",
        )

    annotation.visible_peer_annotations = {
        "visible_annotation_ids": visible_annotation_ids,
    }
    await db.commit()

    return {"status": "ok"}


async def get_deliberation_assignments(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """Return the list of (excerpt, knowledge_item) pairs ready for deliberation.

    Returns only items that the user has completed a cross-annotation annotation for.
    """
    # Get all cross-annotation annotations for this user
    # Order by excerpt_id and knowledge_item_id for consistent ordering
    result = await db.execute(
        select(Annotation)
        .where(
            Annotation.annotator_id == user_id,
            Annotation.phase == AnnotationPhase.cross_annotation,
            Annotation.revision_of_id.is_(None),
        )
        .order_by(Annotation.excerpt_id, Annotation.knowledge_item_id)
    )
    cross_annotations = result.scalars().all()

    # Build assignment list from annotations
    assignments = []

    # Collect all excerpt IDs and turn IDs to batch fetch
    excerpt_ids = [ann.excerpt_id for ann in cross_annotations]
    if not excerpt_ids:
        return []

    # Fetch all excerpts
    excerpts_result = await db.execute(
        select(TranscriptExcerpt).where(TranscriptExcerpt.id.in_(excerpt_ids))
    )
    excerpts = {e.id: e for e in excerpts_result.scalars().all()}

    # Collect turn IDs
    turn_ids = set()
    for excerpt in excerpts.values():
        turn_ids.add(excerpt.start_turn_id)
        turn_ids.add(excerpt.end_turn_id)

    # Batch resolve turn numbers
    turn_number_map = await _get_turn_number_map(db, turn_ids)

    # Build assignments
    for ann in cross_annotations:
        excerpt = excerpts.get(ann.excerpt_id)
        if not excerpt:
            continue

        assignments.append({
            "excerpt_id": str(ann.excerpt_id),
            "knowledge_item_id": str(ann.knowledge_item_id),
            "conversation_id": str(excerpt.conversation_id),
            "excerpt_start_turn": turn_number_map.get(excerpt.start_turn_id),
            "excerpt_end_turn": turn_number_map.get(excerpt.end_turn_id),
        })

    # Sort by conversation_id, then excerpt_id, then knowledge_item_id
    # This ensures consistent ordering that matches the list page grouping
    assignments.sort(key=lambda a: (a["conversation_id"], a["excerpt_id"], a["knowledge_item_id"]))

    return assignments


async def get_progress(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> dict[str, int]:
    """Return deliberation completion stats for the current user.

    ``total``: number of cross_annotation-phase annotations the user has
    (i.e., items they need to review in deliberation).
    ``completed``: number that have a deliberation-phase revision.
    ``deliberation_completed``: whether the user has marked annotation
    deliberation as done (deliberation_completed_at is set).
    """
    # All the user's cross_annotation annotations = deliberation tasks
    result = await db.execute(
        select(Annotation).where(
            Annotation.annotator_id == user_id,
            Annotation.phase == AnnotationPhase.cross_annotation,
            Annotation.revision_of_id.is_(None),
        )
    )
    cross_annotations = result.scalars().all()
    total = len(cross_annotations)

    # Find which have a deliberation revision
    revision_result = await db.execute(
        select(Annotation).where(
            Annotation.annotator_id == user_id,
            Annotation.phase == AnnotationPhase.deliberation,
            Annotation.revision_of_id.is_not(None),
        )
    )
    revisions = revision_result.scalars().all()
    revised_ids = {r.revision_of_id for r in revisions}
    revised_item_ids = {str(r.knowledge_item_id) for r in revisions}
    completed = sum(1 for a in cross_annotations if a.id in revised_ids)
    do_not_surface_count = sum(1 for r in revisions if r.do_not_surface)

    # Check if user has marked annotation deliberation complete
    membership_result = await db.execute(
        select(GroupMembership)
        .join(Group, GroupMembership.group_id == Group.id)
        .where(
            GroupMembership.user_id == user_id,
            Group.status == GroupStatus.deliberation,
        )
    )
    memberships = membership_result.scalars().all()
    deliberation_completed = (
        len(memberships) > 0
        and all(m.deliberation_completed_at is not None for m in memberships)
    )

    return {
        "total": total,
        "completed": completed,
        "pending": total - completed,
        "revised_knowledge_item_ids": list(revised_item_ids),
        "do_not_surface_count": do_not_surface_count,
        "deliberation_completed": deliberation_completed,
    }


async def mark_complete(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Mark deliberation as complete for this user.

    Updates the user's group membership with a completion timestamp.
    """
    # Find the user's group membership for a group in deliberation phase
    result = await db.execute(
        select(GroupMembership)
        .join(Group, GroupMembership.group_id == Group.id)
        .where(
            GroupMembership.user_id == user_id,
            Group.status == GroupStatus.deliberation,
            GroupMembership.deliberation_completed_at.is_(None),
        )
        .limit(1)
    )
    membership = result.scalar_one_or_none()

    if membership is None:
        # Already completed — return success idempotently
        return {"status": "completed", "deliberation_completed_at": None}

    # Set completion timestamp
    now = datetime.utcnow()
    membership.deliberation_completed_at = now
    await db.commit()

    return {
        "status": "completed",
        "completed_at": now.isoformat(),
    }


async def get_group_progress(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Get deliberation completion status for all members of the user's group."""
    # Find user's group (prefer one in deliberation phase)
    result = await db.execute(
        select(GroupMembership)
        .join(Group, GroupMembership.group_id == Group.id)
        .where(
            GroupMembership.user_id == user_id,
            Group.status == GroupStatus.deliberation,
        )
        .limit(1)
    )
    membership = result.scalar_one_or_none()

    if membership is None:
        return {
            "total_participants": 0,
            "completed_count": 0,
            "all_complete": False,
            "participants": [],
        }

    # Get all members of this group with their user info (exclude researchers)
    all_members_result = await db.execute(
        select(GroupMembership, User)
        .join(User, GroupMembership.user_id == User.id)
        .where(
            GroupMembership.group_id == membership.group_id,
            User.role != UserRole.researcher,
        )
    )
    all_members = all_members_result.all()

    # Count how many have completed
    completed = sum(
        1 for m, _ in all_members if m.deliberation_completed_at is not None
    )

    # Build participant list
    participants = []
    for m, user in all_members:
        participants.append({
            "user_id": str(user.id),
            "user_name": user.name,
            "is_current_user": user.id == user_id,
            "completed": m.deliberation_completed_at is not None,
        })

    return {
        "total_participants": len(all_members),
        "completed_count": completed,
        "all_complete": completed == len(all_members) and len(all_members) > 0,
        "participants": participants,
    }
