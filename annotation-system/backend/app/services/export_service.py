"""Business logic for data export (Phase 6 -- Export Pipeline).

Generates structured exports in various formats for the PITCH benchmark
evaluation pipeline.
"""

import logging
import random
import uuid
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.annotation import Annotation
from app.models.consensus import ConsensusPriorityRanking, ConsensusWindow
from app.models.conversation import Conversation
from app.models.enums import AnnotationPhase, ConsensusStatus
from app.models.knowledge_item import KnowledgeItem
from app.models.priority_ranking import PriorityRanking
from app.models.transcript_excerpt import TranscriptExcerpt
from app.models.turn import Turn
from app.models.user import User
from app.db.base import enum_val
from app.services.consensus_service import (
    compute_fleiss_kappa,
    compute_kendalls_w,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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


async def _fetch_excerpt_turns(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    start_turn_number: int,
    end_turn_number: int,
) -> list[dict[str, Any]]:
    """Fetch and serialize turns within a range."""
    turns_result = await db.execute(
        select(Turn)
        .where(
            Turn.conversation_id == conversation_id,
            Turn.turn_number >= start_turn_number,
            Turn.turn_number <= end_turn_number,
        )
        .order_by(Turn.turn_number)
    )
    turns = turns_result.scalars().all()

    # Resolve speaker names
    speaker_ids = list({t.speaker_id for t in turns})
    speakers: dict[uuid.UUID, str] = {}
    if speaker_ids:
        users_result = await db.execute(
            select(User).where(User.id.in_(speaker_ids))
        )
        for u in users_result.scalars().all():
            speakers[u.id] = u.name

    return [
        {
            "id": str(t.id),
            "turn_number": t.turn_number,
            "speaker_id": str(t.speaker_id),
            "speaker_name": speakers.get(t.speaker_id, "Unknown"),
            "text": t.text,
            "timestamp": t.timestamp.isoformat() if t.timestamp else None,
        }
        for t in turns
    ]


async def _get_consensus_windows(
    db: AsyncSession,
    conversation_id: Optional[uuid.UUID] = None,
) -> list[ConsensusWindow]:
    """Fetch consensus windows, optionally filtered by conversation."""
    if conversation_id is not None:
        # Get excerpt IDs for this conversation
        exc_result = await db.execute(
            select(TranscriptExcerpt.id).where(
                TranscriptExcerpt.conversation_id == conversation_id,
            )
        )
        excerpt_ids = [row[0] for row in exc_result.all()]
        if not excerpt_ids:
            return []
        result = await db.execute(
            select(ConsensusWindow).where(
                ConsensusWindow.excerpt_id.in_(excerpt_ids)
            )
        )
    else:
        result = await db.execute(select(ConsensusWindow))

    return list(result.scalars().all())


async def _resolve_excerpt_turn_numbers(
    db: AsyncSession, excerpt: TranscriptExcerpt
) -> tuple[int, int]:
    """Resolve an excerpt's start and end turn numbers."""
    st_result = await db.execute(
        select(Turn).where(Turn.id == excerpt.start_turn_id)
    )
    start_turn = st_result.scalar_one()

    et_result = await db.execute(
        select(Turn).where(Turn.id == excerpt.end_turn_id)
    )
    end_turn = et_result.scalar_one()

    return start_turn.turn_number, end_turn.turn_number


# ---------------------------------------------------------------------------
# Pick-best-turn export
# ---------------------------------------------------------------------------


async def export_pick_best_turn(
    db: AsyncSession,
    conversation_id: Optional[uuid.UUID] = None,
) -> list[dict[str, Any]]:
    """Export data in pick-best-turn format.

    For each (excerpt, item) pair with consensus:
    - Get transcript turns from consensus_start onward
    - Include context summaries
    - Include neutralized item, contribution type
    - Include consensus window and best turn (as turn numbers)
    """
    consensus_windows = await _get_consensus_windows(db, conversation_id)

    if not consensus_windows:
        return []

    # Collect all turn IDs for batch resolution
    turn_ids: set[uuid.UUID] = set()
    for cw in consensus_windows:
        for tid in (
            cw.consensus_start_id,
            cw.consensus_end_id,
            cw.consensus_best_turn_id,
        ):
            if tid is not None:
                turn_ids.add(tid)

    turn_number_map = await _get_turn_number_map(db, turn_ids)

    results: list[dict[str, Any]] = []

    for cw in consensus_windows:
        # Fetch excerpt
        exc_result = await db.execute(
            select(TranscriptExcerpt).where(
                TranscriptExcerpt.id == cw.excerpt_id
            )
        )
        excerpt = exc_result.scalar_one_or_none()
        if excerpt is None:
            continue

        # Fetch knowledge item
        ki_result = await db.execute(
            select(KnowledgeItem).where(
                KnowledgeItem.id == cw.knowledge_item_id
            )
        )
        ki = ki_result.scalar_one_or_none()
        if ki is None:
            continue

        # Get excerpt turn range
        start_num, end_num = await _resolve_excerpt_turn_numbers(db, excerpt)

        # Determine the turns to include: from consensus_start onward
        # (or full excerpt if no consensus start)
        consensus_start = turn_number_map.get(cw.consensus_start_id)
        turns_start = consensus_start if consensus_start is not None else start_num

        transcript_turns = await _fetch_excerpt_turns(
            db, excerpt.conversation_id, turns_start, end_num
        )

        consensus_end = turn_number_map.get(cw.consensus_end_id)
        consensus_best = turn_number_map.get(cw.consensus_best_turn_id)

        results.append({
            "excerpt_id": str(cw.excerpt_id),
            "knowledge_item_id": str(cw.knowledge_item_id),
            "transcript_turns": transcript_turns,
            "context_before": excerpt.preceding_context_summary,
            "context_after": excerpt.following_context_summary,
            "neutralized_item": (
                ki.neutralized_ideal_response or ki.raw_ideal_response
            ),
            "contribution_type": enum_val(ki.contribution_type),
            "consensus_window_start": consensus_start,
            "consensus_window_end": consensus_end,
            "consensus_best_turn": consensus_best,
            "consensus_status": enum_val(cw.status),
            "annotator_agreement": cw.annotator_agreement,
        })

    return results


# ---------------------------------------------------------------------------
# Turn-by-turn export
# ---------------------------------------------------------------------------


async def export_turn_by_turn(
    db: AsyncSession,
    conversation_id: Optional[uuid.UUID] = None,
) -> list[dict[str, Any]]:
    """Export data in turn-by-turn format.

    Same as pick-best-turn but with replay_start_turn = consensus window start.
    """
    pick_best_data = await export_pick_best_turn(db, conversation_id)

    results: list[dict[str, Any]] = []
    for entry in pick_best_data:
        result = dict(entry)
        result["replay_start_turn"] = entry.get("consensus_window_start")
        results.append(result)

    return results


# ---------------------------------------------------------------------------
# Prioritized export
# ---------------------------------------------------------------------------


async def export_prioritized(
    db: AsyncSession,
    conversation_id: Optional[uuid.UUID] = None,
) -> list[dict[str, Any]]:
    """Export data in prioritized format.

    For each excerpt: all items with their consensus windows + consensus ranking.
    """
    # Get excerpts
    if conversation_id is not None:
        exc_result = await db.execute(
            select(TranscriptExcerpt).where(
                TranscriptExcerpt.conversation_id == conversation_id,
            )
        )
    else:
        exc_result = await db.execute(select(TranscriptExcerpt))

    excerpts = exc_result.scalars().all()

    results: list[dict[str, Any]] = []

    for excerpt in excerpts:
        start_num, end_num = await _resolve_excerpt_turn_numbers(db, excerpt)

        # Fetch transcript turns
        transcript_turns = await _fetch_excerpt_turns(
            db, excerpt.conversation_id, start_num, end_num
        )

        # Fetch all consensus windows for this excerpt
        cw_result = await db.execute(
            select(ConsensusWindow).where(
                ConsensusWindow.excerpt_id == excerpt.id,
            )
        )
        consensus_windows = cw_result.scalars().all()

        if not consensus_windows:
            continue

        # Collect turn IDs for resolution
        turn_ids: set[uuid.UUID] = set()
        for cw in consensus_windows:
            for tid in (
                cw.consensus_start_id,
                cw.consensus_end_id,
                cw.consensus_best_turn_id,
            ):
                if tid is not None:
                    turn_ids.add(tid)
        turn_number_map = await _get_turn_number_map(db, turn_ids)

        # Build items list
        items: list[dict[str, Any]] = []
        for cw in consensus_windows:
            # Fetch knowledge item
            ki_result = await db.execute(
                select(KnowledgeItem).where(
                    KnowledgeItem.id == cw.knowledge_item_id
                )
            )
            ki = ki_result.scalar_one_or_none()
            if ki is None:
                continue

            items.append({
                "knowledge_item_id": str(cw.knowledge_item_id),
                "neutralized_item": (
                    ki.neutralized_ideal_response or ki.raw_ideal_response
                ),
                "contribution_type": enum_val(ki.contribution_type),
                "consensus_window_start": (
                    turn_number_map.get(cw.consensus_start_id)
                    if cw.consensus_start_id else None
                ),
                "consensus_window_end": (
                    turn_number_map.get(cw.consensus_end_id)
                    if cw.consensus_end_id else None
                ),
                "consensus_best_turn": (
                    turn_number_map.get(cw.consensus_best_turn_id)
                    if cw.consensus_best_turn_id else None
                ),
                "consensus_status": enum_val(cw.status),
            })

        # Fetch consensus ranking for this excerpt
        ranking_result = await db.execute(
            select(ConsensusPriorityRanking).where(
                ConsensusPriorityRanking.excerpt_id == excerpt.id,
            )
        )
        consensus_ranking_record = ranking_result.scalar_one_or_none()

        consensus_ranking: list[dict[str, Any]] = []
        agreement_score = 0.0
        if consensus_ranking_record is not None:
            agreement_score = consensus_ranking_record.agreement_score
            for entry in consensus_ranking_record.ranked_items:
                consensus_ranking.append({
                    "item_id": entry.get("knowledge_item_id"),
                    "rank": entry.get("rank"),
                    "best_turn": entry.get("chosen_best_turn_number"),
                })

        results.append({
            "excerpt_id": str(excerpt.id),
            "transcript_turns": transcript_turns,
            "items": items,
            "consensus_ranking": consensus_ranking,
            "agreement_score": agreement_score,
        })

    return results


# ---------------------------------------------------------------------------
# Ablation export
# ---------------------------------------------------------------------------


async def export_ablation(
    db: AsyncSession,
    variant: str,
) -> list[dict[str, Any]]:
    """Export ablation data.

    Variants:
    - "no_context": only current turn + item (strip surrounding transcript)
    - "shuffled": randomly permute turn order within excerpt
    - "quality": group items by pertinence level
    """
    # Get all pick-best-turn data as the base
    base_data = await export_pick_best_turn(db)

    results: list[dict[str, Any]] = []

    if variant == "no_context":
        for entry in base_data:
            best_turn = entry.get("consensus_best_turn")
            # Keep only the best turn from the transcript
            filtered_turns = [
                t for t in entry["transcript_turns"]
                if t["turn_number"] == best_turn
            ] if best_turn is not None else []

            results.append({
                "variant": "no_context",
                "data": {
                    "excerpt_id": entry["excerpt_id"],
                    "knowledge_item_id": entry["knowledge_item_id"],
                    "current_turn": filtered_turns[0] if filtered_turns else None,
                    "neutralized_item": entry["neutralized_item"],
                    "contribution_type": entry["contribution_type"],
                    "consensus_best_turn": best_turn,
                    "consensus_status": entry["consensus_status"],
                },
            })

    elif variant == "shuffled":
        for entry in base_data:
            shuffled_turns = list(entry["transcript_turns"])
            random.shuffle(shuffled_turns)

            results.append({
                "variant": "shuffled",
                "data": {
                    "excerpt_id": entry["excerpt_id"],
                    "knowledge_item_id": entry["knowledge_item_id"],
                    "transcript_turns": shuffled_turns,
                    "context_before": entry.get("context_before"),
                    "context_after": entry.get("context_after"),
                    "neutralized_item": entry["neutralized_item"],
                    "contribution_type": entry["contribution_type"],
                    "consensus_window_start": entry.get("consensus_window_start"),
                    "consensus_window_end": entry.get("consensus_window_end"),
                    "consensus_best_turn": entry.get("consensus_best_turn"),
                    "consensus_status": entry["consensus_status"],
                    "annotator_agreement": entry["annotator_agreement"],
                },
            })

    elif variant == "quality":
        # Group by pertinence level: fetch pertinence for each knowledge item
        item_pertinence: dict[str, float] = {}
        for entry in base_data:
            kid = entry["knowledge_item_id"]
            if kid not in item_pertinence:
                ki_result = await db.execute(
                    select(KnowledgeItem).where(
                        KnowledgeItem.id == uuid.UUID(kid)
                    )
                )
                ki = ki_result.scalar_one_or_none()
                if ki is not None:
                    item_pertinence[kid] = ki.pertinence
                else:
                    item_pertinence[kid] = 0.0

        # Define pertinence buckets
        high = [e for e in base_data if item_pertinence.get(e["knowledge_item_id"], 0) >= 0.7]
        medium = [e for e in base_data if 0.3 <= item_pertinence.get(e["knowledge_item_id"], 0) < 0.7]
        low = [e for e in base_data if item_pertinence.get(e["knowledge_item_id"], 0) < 0.3]

        for bucket_name, bucket_data in [("high", high), ("medium", medium), ("low", low)]:
            results.append({
                "variant": "quality",
                "data": {
                    "pertinence_level": bucket_name,
                    "count": len(bucket_data),
                    "entries": bucket_data,
                },
            })

    else:
        raise ValueError(f"Unknown ablation variant: {variant}")

    return results


# ---------------------------------------------------------------------------
# Bulk export
# ---------------------------------------------------------------------------


async def export_bulk(
    db: AsyncSession,
    format: str = "json",
) -> dict[str, Any]:
    """Full dump of all data tables.

    Returns a dict with keys: conversations, knowledge_items, annotations,
    consensus_windows, priority_rankings.
    """
    # Conversations
    conv_result = await db.execute(select(Conversation))
    conversations = conv_result.scalars().all()
    conversations_out = [
        {
            "id": str(c.id),
            "group_id": str(c.group_id),
            "started_at": c.started_at.isoformat() if c.started_at else None,
            "ended_at": c.ended_at.isoformat() if c.ended_at else None,
        }
        for c in conversations
    ]

    # Knowledge items
    ki_result = await db.execute(select(KnowledgeItem))
    items = ki_result.scalars().all()

    # Batch-resolve turn IDs for knowledge items
    ki_turn_ids: set[uuid.UUID] = set()
    for ki in items:
        ki_turn_ids.update([ki.window_start_id, ki.window_end_id, ki.best_turn_id])
    ki_turn_map = await _get_turn_number_map(db, ki_turn_ids)

    items_out = [
        {
            "id": str(ki.id),
            "conversation_id": str(ki.conversation_id),
            "author_id": str(ki.author_id),
            "raw_ideal_response": ki.raw_ideal_response,
            "neutralized_ideal_response": ki.neutralized_ideal_response,
            "contribution_type": enum_val(ki.contribution_type),
            "pertinence": ki.pertinence,
            "source": enum_val(ki.source),
            "review_status": enum_val(ki.review_status),
            "window_start_turn_number": ki_turn_map.get(ki.window_start_id),
            "window_end_turn_number": ki_turn_map.get(ki.window_end_id),
            "best_turn_number": ki_turn_map.get(ki.best_turn_id),
            "created_at": ki.created_at.isoformat() if ki.created_at else None,
        }
        for ki in items
    ]

    # Annotations
    ann_result = await db.execute(select(Annotation))
    annotations = ann_result.scalars().all()

    # Batch-resolve turn IDs for annotations
    ann_turn_ids: set[uuid.UUID] = set()
    for ann in annotations:
        for tid in (ann.window_start_id, ann.window_end_id, ann.best_turn_id):
            if tid is not None:
                ann_turn_ids.add(tid)
    ann_turn_map = await _get_turn_number_map(db, ann_turn_ids)

    annotations_out = [
        {
            "id": str(ann.id),
            "excerpt_id": str(ann.excerpt_id),
            "knowledge_item_id": str(ann.knowledge_item_id),
            "annotator_id": str(ann.annotator_id),
            "annotator_role": enum_val(ann.annotator_role),
            "phase": enum_val(ann.phase),
            "window_start_turn_number": (
                ann_turn_map.get(ann.window_start_id)
                if ann.window_start_id else None
            ),
            "window_end_turn_number": (
                ann_turn_map.get(ann.window_end_id)
                if ann.window_end_id else None
            ),
            "best_turn_number": (
                ann_turn_map.get(ann.best_turn_id)
                if ann.best_turn_id else None
            ),
            "do_not_surface": ann.do_not_surface,
            "extends_before": ann.extends_before,
            "extends_after": ann.extends_after,
            "rationale": ann.rationale,
            "revision_of_id": (
                str(ann.revision_of_id) if ann.revision_of_id else None
            ),
            "created_at": ann.created_at.isoformat() if ann.created_at else None,
        }
        for ann in annotations
    ]

    # Consensus windows
    cw_result = await db.execute(select(ConsensusWindow))
    consensus_windows = cw_result.scalars().all()

    cw_turn_ids: set[uuid.UUID] = set()
    for cw in consensus_windows:
        for tid in (
            cw.consensus_start_id,
            cw.consensus_end_id,
            cw.consensus_best_turn_id,
        ):
            if tid is not None:
                cw_turn_ids.add(tid)
    cw_turn_map = await _get_turn_number_map(db, cw_turn_ids)

    consensus_windows_out = [
        {
            "id": str(cw.id),
            "excerpt_id": str(cw.excerpt_id),
            "knowledge_item_id": str(cw.knowledge_item_id),
            "consensus_start_turn_number": (
                cw_turn_map.get(cw.consensus_start_id)
                if cw.consensus_start_id else None
            ),
            "consensus_end_turn_number": (
                cw_turn_map.get(cw.consensus_end_id)
                if cw.consensus_end_id else None
            ),
            "consensus_best_turn_number": (
                cw_turn_map.get(cw.consensus_best_turn_id)
                if cw.consensus_best_turn_id else None
            ),
            "annotator_agreement": cw.annotator_agreement,
            "status": enum_val(cw.status),
            "source_annotations": cw.source_annotations,
            "created_at": cw.created_at.isoformat() if cw.created_at else None,
        }
        for cw in consensus_windows
    ]

    # Priority rankings (both individual and consensus)
    pr_result = await db.execute(select(PriorityRanking))
    priority_rankings = pr_result.scalars().all()
    priority_rankings_out = [
        {
            "id": str(pr.id),
            "excerpt_id": str(pr.excerpt_id),
            "annotator_id": str(pr.annotator_id),
            "phase": enum_val(pr.phase),
            "ranked_items": pr.ranked_items,
            "created_at": pr.created_at.isoformat() if pr.created_at else None,
        }
        for pr in priority_rankings
    ]

    # Consensus priority rankings
    cpr_result = await db.execute(select(ConsensusPriorityRanking))
    consensus_rankings = cpr_result.scalars().all()
    consensus_rankings_out = [
        {
            "id": str(cpr.id),
            "excerpt_id": str(cpr.excerpt_id),
            "method": enum_val(cpr.method),
            "ranked_items": cpr.ranked_items,
            "agreement_score": cpr.agreement_score,
            "created_at": cpr.created_at.isoformat() if cpr.created_at else None,
        }
        for cpr in consensus_rankings
    ]

    if format == "csv":
        # For CSV, flatten into a structure more suitable for tabular export.
        # We return a dict where each key maps to a list of flat dicts.
        return {
            "conversations": conversations_out,
            "knowledge_items": items_out,
            "annotations": annotations_out,
            "consensus_windows": consensus_windows_out,
            "priority_rankings": priority_rankings_out,
            "consensus_priority_rankings": consensus_rankings_out,
        }

    return {
        "conversations": conversations_out,
        "knowledge_items": items_out,
        "annotations": annotations_out,
        "consensus_windows": consensus_windows_out,
        "priority_rankings": priority_rankings_out,
        "consensus_priority_rankings": consensus_rankings_out,
    }


# ---------------------------------------------------------------------------
# Agreement statistics
# ---------------------------------------------------------------------------


async def export_agreement_stats(
    db: AsyncSession,
    conversation_id: Optional[uuid.UUID] = None,
) -> dict[str, Any]:
    """Compute and return agreement statistics.

    Returns:
    - total_pairs: total (excerpt, item) pairs with consensus
    - well_defined / contested / do_not_surface counts
    - mean_agreement: mean annotator_agreement across all consensus windows
    - fleiss_kappa: computed from annotation data
    - kendalls_w: computed from priority ranking data
    """
    consensus_windows = await _get_consensus_windows(db, conversation_id)

    total_pairs = len(consensus_windows)
    well_defined = sum(
        1 for cw in consensus_windows
        if cw.status == ConsensusStatus.well_defined
    )
    contested = sum(
        1 for cw in consensus_windows
        if cw.status == ConsensusStatus.contested
    )
    do_not_surface = sum(
        1 for cw in consensus_windows
        if cw.status == ConsensusStatus.do_not_surface
    )

    mean_agreement = (
        sum(cw.annotator_agreement for cw in consensus_windows) / total_pairs
        if total_pairs > 0
        else 0.0
    )

    # Compute Fleiss' kappa across all (excerpt, item) pairs
    # For each pair, we need annotations and their best_turn choices
    all_kappas: list[float] = []
    for cw in consensus_windows:
        # Fetch annotations for this pair
        ann_result = await db.execute(
            select(Annotation).where(
                Annotation.excerpt_id == cw.excerpt_id,
                Annotation.knowledge_item_id == cw.knowledge_item_id,
                Annotation.phase.in_([
                    AnnotationPhase.cross_annotation,
                    AnnotationPhase.deliberation,
                ]),
            )
        )
        annotations = ann_result.scalars().all()

        if len(annotations) < 2:
            continue

        # Resolve turn numbers
        turn_ids: set[uuid.UUID] = set()
        for ann in annotations:
            if ann.best_turn_id is not None:
                turn_ids.add(ann.best_turn_id)
        turn_map = await _get_turn_number_map(db, turn_ids)

        ann_dicts = [
            {
                "do_not_surface": ann.do_not_surface,
                "best_turn_number": (
                    turn_map.get(ann.best_turn_id)
                    if ann.best_turn_id else None
                ),
            }
            for ann in annotations
        ]

        kappa = compute_fleiss_kappa(ann_dicts)
        all_kappas.append(kappa)

    fleiss_kappa_val = (
        sum(all_kappas) / len(all_kappas) if all_kappas else None
    )

    # Compute Kendall's W across all excerpts with priority rankings
    # Get excerpt IDs from consensus windows
    excerpt_ids = list({cw.excerpt_id for cw in consensus_windows})

    all_w_scores: list[float] = []
    for excerpt_id in excerpt_ids:
        pr_result = await db.execute(
            select(PriorityRanking).where(
                PriorityRanking.excerpt_id == excerpt_id,
            )
        )
        all_rankings = pr_result.scalars().all()

        if len(all_rankings) < 2:
            continue

        # Collect all item IDs across rankings
        all_item_ids: set[str] = set()
        for ranking in all_rankings:
            for entry in ranking.ranked_items:
                all_item_ids.add(entry["knowledge_item_id"])

        item_ids_list = sorted(all_item_ids)
        n_items = len(item_ids_list)

        if n_items < 2:
            continue

        # Build ranking matrix
        ranking_matrix: list[list[int]] = []
        for ranking in all_rankings:
            item_rank_map = {
                entry["knowledge_item_id"]: entry["rank"]
                for entry in ranking.ranked_items
            }
            rank_row = [
                item_rank_map.get(iid, n_items + 1)
                for iid in item_ids_list
            ]
            ranking_matrix.append(rank_row)

        w = compute_kendalls_w(ranking_matrix)
        all_w_scores.append(w)

    kendalls_w_val = (
        sum(all_w_scores) / len(all_w_scores) if all_w_scores else None
    )

    return {
        "total_pairs": total_pairs,
        "well_defined": well_defined,
        "contested": contested,
        "do_not_surface": do_not_surface,
        "mean_agreement": round(mean_agreement, 4),
        "fleiss_kappa": round(fleiss_kappa_val, 4) if fleiss_kappa_val is not None else None,
        "kendalls_w": round(kendalls_w_val, 4) if kendalls_w_val is not None else None,
    }
