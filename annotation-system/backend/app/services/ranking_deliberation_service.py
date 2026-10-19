"""Business logic for the Ranking Deliberation phase.

After annotation deliberation, users see each other's priority rankings
and can revise their own ranking based on peer input.
"""

import logging
import uuid
from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.annotation import Annotation
from app.models.enums import AnnotationPhase, GroupStatus, UserRole
from app.models.group import Group, GroupMembership
from app.models.knowledge_item import KnowledgeItem
from app.models.priority_ranking import PriorityRanking
from app.models.transcript_excerpt import TranscriptExcerpt
from app.models.turn import Turn
from app.models.user import User
from app.db.base import enum_val

logger = logging.getLogger(__name__)

_LABELS = [chr(i) for i in range(ord("A"), ord("Z") + 1)]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_turn_number_map(
    db: AsyncSession, turn_ids: set[uuid.UUID]
) -> dict[uuid.UUID, int]:
    if not turn_ids:
        return {}
    result = await db.execute(select(Turn).where(Turn.id.in_(list(turn_ids))))
    return {t.id: t.turn_number for t in result.scalars().all()}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def get_ranking_deliberation_excerpts(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """Return excerpts for which the user has a cross_annotation-phase ranking.

    Each excerpt represents one ranking deliberation task.
    """
    result = await db.execute(
        select(PriorityRanking).where(
            PriorityRanking.annotator_id == user_id,
            PriorityRanking.phase == AnnotationPhase.cross_annotation,
        )
    )
    rankings = result.scalars().all()

    if not rankings:
        return []

    excerpt_ids = [r.excerpt_id for r in rankings]
    excerpts_result = await db.execute(
        select(TranscriptExcerpt).where(TranscriptExcerpt.id.in_(excerpt_ids))
    )
    excerpts = {e.id: e for e in excerpts_result.scalars().all()}

    # Collect turn IDs for start/end resolution
    turn_ids: set[uuid.UUID] = set()
    for excerpt in excerpts.values():
        turn_ids.add(excerpt.start_turn_id)
        turn_ids.add(excerpt.end_turn_id)
    turn_number_map = await _get_turn_number_map(db, turn_ids)

    # Check which conversations have a deliberation-phase ranking
    delib_result = await db.execute(
        select(PriorityRanking.excerpt_id).where(
            PriorityRanking.annotator_id == user_id,
            PriorityRanking.phase == AnnotationPhase.deliberation,
        )
    )
    delib_excerpt_ids = {row[0] for row in delib_result.all()}
    # Resolve to conversation_ids
    if delib_excerpt_ids:
        delib_exc_result = await db.execute(
            select(TranscriptExcerpt).where(
                TranscriptExcerpt.id.in_(list(delib_excerpt_ids))
            )
        )
        revised_conversation_ids = {
            e.conversation_id for e in delib_exc_result.scalars().all()
        }
    else:
        revised_conversation_ids = set()

    items = []
    for ranking in rankings:
        excerpt = excerpts.get(ranking.excerpt_id)
        if not excerpt:
            continue
        items.append({
            "excerpt_id": str(ranking.excerpt_id),
            "conversation_id": str(excerpt.conversation_id),
            "excerpt_start_turn": turn_number_map.get(excerpt.start_turn_id),
            "excerpt_end_turn": turn_number_map.get(excerpt.end_turn_id),
            "item_count": len(ranking.ranked_items),
            "revised": excerpt.conversation_id in revised_conversation_ids,
        })

    items.sort(key=lambda x: (x["conversation_id"], x["excerpt_id"]))
    return items


async def get_peer_rankings(
    db: AsyncSession,
    excerpt_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Get peer rankings for a conversation, anonymized, plus the user's own ranking.

    Rankings are matched by conversation (via the excerpt's conversation_id)
    rather than by a specific excerpt_id, because each user may have saved
    their ranking against a different excerpt within the same conversation.

    Returns each peer's ranking with a stable label (Annotator A, B, etc.)
    and the user's own current ranking (deliberation revision if exists,
    otherwise the original cross_annotation ranking).
    """
    # Resolve the excerpt to its conversation
    exc_result = await db.execute(
        select(TranscriptExcerpt).where(TranscriptExcerpt.id == excerpt_id)
    )
    excerpt = exc_result.scalar_one_or_none()
    if excerpt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Excerpt not found",
        )
    conversation_id = excerpt.conversation_id

    # Find all excerpt IDs in this conversation
    conv_excerpts_result = await db.execute(
        select(TranscriptExcerpt.id).where(
            TranscriptExcerpt.conversation_id == conversation_id
        )
    )
    conv_excerpt_ids = [row[0] for row in conv_excerpts_result.all()]

    # Fetch all cross_annotation-phase rankings for any excerpt in this conversation
    result = await db.execute(
        select(PriorityRanking)
        .where(
            PriorityRanking.excerpt_id.in_(conv_excerpt_ids),
            PriorityRanking.phase == AnnotationPhase.cross_annotation,
        )
        .order_by(PriorityRanking.annotator_id)
    )
    all_rankings = result.scalars().all()

    # Deduplicate: keep one ranking per annotator.
    # Prefer the ranking with the most items (correct data), then latest.
    rankings_by_user: dict[uuid.UUID, PriorityRanking] = {}
    for r in all_rankings:
        r_items = r.ranked_items if isinstance(r.ranked_items, list) else []
        existing = rankings_by_user.get(r.annotator_id)
        if existing is None:
            rankings_by_user[r.annotator_id] = r
        else:
            ex_items = existing.ranked_items if isinstance(existing.ranked_items, list) else []
            if len(r_items) > len(ex_items):
                rankings_by_user[r.annotator_id] = r
            elif len(r_items) == len(ex_items) and r.created_at > existing.created_at:
                rankings_by_user[r.annotator_id] = r
    all_rankings = sorted(rankings_by_user.values(), key=lambda r: str(r.annotator_id))

    own_ranking = None
    peer_rankings = []
    for r in all_rankings:
        if r.annotator_id == user_id:
            own_ranking = r
        else:
            peer_rankings.append(r)

    if own_ranking is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Your ranking not found for this excerpt",
        )

    # Check if user has a deliberation-phase revision (any excerpt in this conversation)
    delib_result = await db.execute(
        select(PriorityRanking)
        .where(
            PriorityRanking.excerpt_id.in_(conv_excerpt_ids),
            PriorityRanking.annotator_id == user_id,
            PriorityRanking.phase == AnnotationPhase.deliberation,
        )
        .order_by(PriorityRanking.created_at.desc())
    )
    delib_ranking = delib_result.scalars().first()

    # Build items list with knowledge item details
    all_item_ids: set[str] = set()
    for r in all_rankings:
        for entry in r.ranked_items:
            kid = entry.get("knowledge_item_id") if isinstance(entry, dict) else None
            if kid:
                all_item_ids.add(kid)

    # Fetch knowledge items for display
    ki_uuids = []
    for kid in all_item_ids:
        try:
            ki_uuids.append(uuid.UUID(kid))
        except (ValueError, AttributeError):
            logger.warning("Skipping invalid knowledge_item_id in ranked_items: %s", kid)
    ki_result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id.in_(ki_uuids))
    )
    knowledge_items = {str(ki.id): ki for ki in ki_result.scalars().all()}

    # Resolve turn numbers for best_turn_id on knowledge items
    ki_turn_ids: set[uuid.UUID] = set()
    for ki in knowledge_items.values():
        ki_turn_ids.add(ki.best_turn_id)
    ki_turn_map = await _get_turn_number_map(db, ki_turn_ids)

    # Fetch user's annotations to determine do_not_surface status.
    # Prioritise deliberation-phase revisions over cross_annotation-phase.
    ann_result = await db.execute(
        select(Annotation).where(
            Annotation.annotator_id == user_id,
            Annotation.knowledge_item_id.in_(ki_uuids),
        )
    )
    all_annotations = ann_result.scalars().all()
    dns_by_item: dict[str, bool] = {}
    for ann in all_annotations:
        kid_str = str(ann.knowledge_item_id)
        if ann.phase == AnnotationPhase.deliberation:
            # Deliberation revision always takes priority
            dns_by_item[kid_str] = ann.do_not_surface
        elif kid_str not in dns_by_item:
            dns_by_item[kid_str] = ann.do_not_surface

    # Build knowledge items info
    items_info = {}
    for kid, ki in knowledge_items.items():
        items_info[kid] = {
            "knowledge_item_id": kid,
            "neutralized_ideal_response": ki.neutralized_ideal_response or ki.raw_ideal_response,
            "contribution_type": enum_val(ki.contribution_type),
            "best_turn_number": ki_turn_map.get(ki.best_turn_id),
            "is_own_item": ki.author_id == user_id,
            "do_not_surface": dns_by_item.get(kid, False),
        }

    # Build peer rankings with labels
    peers = []
    for idx, r in enumerate(peer_rankings):
        label = f"Annotator {_LABELS[idx % len(_LABELS)]}"
        item_rank_map = {}
        for entry in r.ranked_items:
            if isinstance(entry, dict) and "knowledge_item_id" in entry and "rank" in entry:
                item_rank_map[entry["knowledge_item_id"]] = entry["rank"]
        peers.append({
            "annotator_label": label,
            "ranked_items": r.ranked_items,
            "item_rank_map": item_rank_map,
        })

    # User's effective ranking (deliberation revision if exists)
    effective_ranking = delib_ranking if delib_ranking else own_ranking

    return {
        "peers": peers,
        "own_ranking": {
            "ranked_items": effective_ranking.ranked_items,
            "phase": enum_val(effective_ranking.phase),
        },
        "original_ranking": {
            "ranked_items": own_ranking.ranked_items,
        },
        "items_info": items_info,
    }


async def save_ranking_revision(
    db: AsyncSession,
    excerpt_id: uuid.UUID,
    user_id: uuid.UUID,
    ranked_items: list[dict[str, Any]],
) -> dict[str, Any]:
    """Save a deliberation-phase ranking revision.

    Validates rank sequencing and upserts a PriorityRanking with
    phase=deliberation.
    """
    # Validate excerpt exists and resolve conversation
    exc_result = await db.execute(
        select(TranscriptExcerpt).where(TranscriptExcerpt.id == excerpt_id)
    )
    excerpt = exc_result.scalar_one_or_none()
    if excerpt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Excerpt not found",
        )
    conversation_id = excerpt.conversation_id

    if not ranked_items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ranked_items must not be empty",
        )

    # Validate rank sequencing
    ranks = sorted(ri["rank"] for ri in ranked_items)
    expected = list(range(1, len(ranked_items) + 1))
    if ranks != expected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ranks must be sequential starting from 1; got {ranks}",
        )

    # Find all excerpt IDs in this conversation
    conv_excerpts_result = await db.execute(
        select(TranscriptExcerpt.id).where(
            TranscriptExcerpt.conversation_id == conversation_id
        )
    )
    conv_excerpt_ids = [row[0] for row in conv_excerpts_result.all()]

    # Verify user has an original ranking for this conversation
    orig_result = await db.execute(
        select(PriorityRanking).where(
            PriorityRanking.excerpt_id.in_(conv_excerpt_ids),
            PriorityRanking.annotator_id == user_id,
            PriorityRanking.phase == AnnotationPhase.cross_annotation,
        )
    )
    if orig_result.scalars().first() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Original ranking not found",
        )

    # Upsert deliberation-phase ranking (search across all conversation excerpts)
    existing_result = await db.execute(
        select(PriorityRanking).where(
            PriorityRanking.excerpt_id.in_(conv_excerpt_ids),
            PriorityRanking.annotator_id == user_id,
            PriorityRanking.phase == AnnotationPhase.deliberation,
        )
    )
    existing = existing_result.scalars().first()

    ranked_items_json = [
        {
            "knowledge_item_id": ri["knowledge_item_id"],
            "rank": ri["rank"],
            "chosen_best_turn_number": ri["chosen_best_turn_number"],
        }
        for ri in ranked_items
    ]

    if existing is not None:
        existing.ranked_items = ranked_items_json
        flag_modified(existing, "ranked_items")
        await db.commit()
        await db.refresh(existing)
        record = existing
    else:
        record = PriorityRanking(
            excerpt_id=excerpt_id,
            annotator_id=user_id,
            phase=AnnotationPhase.deliberation,
            ranked_items=ranked_items_json,
        )
        db.add(record)
        await db.commit()
        await db.refresh(record)

    return {
        "id": str(record.id),
        "excerpt_id": str(record.excerpt_id),
        "annotator_id": str(record.annotator_id),
        "phase": enum_val(record.phase),
        "ranked_items": record.ranked_items,
        "created_at": record.created_at,
    }


async def get_progress(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Return ranking deliberation progress for the user."""
    # Total = number of cross_annotation rankings the user has
    orig_result = await db.execute(
        select(PriorityRanking).where(
            PriorityRanking.annotator_id == user_id,
            PriorityRanking.phase == AnnotationPhase.cross_annotation,
        )
    )
    originals = orig_result.scalars().all()
    total = len(originals)

    # Completed = number that have a deliberation-phase revision.
    # Match by conversation (via excerpt) rather than by exact excerpt_id,
    # since the deliberation revision may be stored against a different excerpt.
    delib_result = await db.execute(
        select(PriorityRanking).where(
            PriorityRanking.annotator_id == user_id,
            PriorityRanking.phase == AnnotationPhase.deliberation,
        )
    )
    delib_rankings = delib_result.scalars().all()
    revised_excerpt_ids = {r.excerpt_id for r in delib_rankings}

    # Resolve conversation_ids for deliberation rankings
    if revised_excerpt_ids:
        delib_exc_result = await db.execute(
            select(TranscriptExcerpt).where(
                TranscriptExcerpt.id.in_(list(revised_excerpt_ids))
            )
        )
        revised_conversation_ids = {
            e.conversation_id for e in delib_exc_result.scalars().all()
        }
    else:
        revised_conversation_ids = set()

    # Resolve conversation_ids for original rankings
    orig_excerpt_ids = [r.excerpt_id for r in originals]
    if orig_excerpt_ids:
        orig_exc_result = await db.execute(
            select(TranscriptExcerpt).where(
                TranscriptExcerpt.id.in_(orig_excerpt_ids)
            )
        )
        orig_excerpt_conv_map = {
            e.id: e.conversation_id for e in orig_exc_result.scalars().all()
        }
    else:
        orig_excerpt_conv_map = {}

    completed = sum(
        1 for r in originals
        if orig_excerpt_conv_map.get(r.excerpt_id) in revised_conversation_ids
    )

    # Check if user has marked ranking deliberation complete
    membership_result = await db.execute(
        select(GroupMembership)
        .join(Group, GroupMembership.group_id == Group.id)
        .where(
            GroupMembership.user_id == user_id,
            Group.status == GroupStatus.deliberation,
        )
    )
    memberships = membership_result.scalars().all()
    ranking_deliberation_completed = (
        len(memberships) > 0
        and all(m.ranking_deliberation_completed_at is not None for m in memberships)
    )

    # Return the original excerpt_ids that have been revised (by conversation match)
    revised_orig_excerpt_ids = [
        r.excerpt_id for r in originals
        if orig_excerpt_conv_map.get(r.excerpt_id) in revised_conversation_ids
    ]

    return {
        "total": total,
        "completed": completed,
        "pending": total - completed,
        "revised_excerpt_ids": [str(eid) for eid in revised_orig_excerpt_ids],
        "ranking_deliberation_completed": ranking_deliberation_completed,
    }


async def mark_complete(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Mark ranking deliberation as complete for this user."""
    result = await db.execute(
        select(GroupMembership)
        .join(Group, GroupMembership.group_id == Group.id)
        .where(
            GroupMembership.user_id == user_id,
            Group.status == GroupStatus.deliberation,
            GroupMembership.ranking_deliberation_completed_at.is_(None),
        )
        .limit(1)
    )
    membership = result.scalar_one_or_none()

    if membership is None:
        # Already completed — return success idempotently
        return {"status": "completed", "completed_at": None}

    now = datetime.utcnow()
    membership.ranking_deliberation_completed_at = now
    await db.commit()

    return {
        "status": "completed",
        "completed_at": now.isoformat(),
    }


async def get_group_progress(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Get ranking deliberation completion status for all group members."""
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

    all_members_result = await db.execute(
        select(GroupMembership, User)
        .join(User, GroupMembership.user_id == User.id)
        .where(
            GroupMembership.group_id == membership.group_id,
            User.role != UserRole.researcher,
        )
    )
    all_members = all_members_result.all()

    completed = sum(
        1 for m, _ in all_members if m.ranking_deliberation_completed_at is not None
    )

    participants = []
    for m, user in all_members:
        participants.append({
            "user_id": str(user.id),
            "user_name": user.name,
            "is_current_user": user.id == user_id,
            "completed": m.ranking_deliberation_completed_at is not None,
        })

    return {
        "total_participants": len(all_members),
        "completed_count": completed,
        "all_complete": completed == len(all_members) and len(all_members) > 0,
        "participants": participants,
    }
