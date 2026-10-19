"""Business logic for consensus computation (Phase 6 -- Export Pipeline).

Computes consensus windows, consensus priority rankings, and inter-annotator
agreement metrics (Fleiss' kappa, Kendall's W).
"""

import logging
import uuid
from collections import Counter
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.annotation import Annotation
from app.models.consensus import ConsensusPriorityRanking, ConsensusWindow
from app.models.enums import (
    AnnotationPhase,
    ConsensusMethod,
    ConsensusStatus,
)
from app.models.priority_ranking import PriorityRanking
from app.models.transcript_excerpt import TranscriptExcerpt
from app.models.turn import Turn
from app.db.base import enum_val

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Statistical helpers
# ---------------------------------------------------------------------------


def compute_fleiss_kappa(annotations: list[dict[str, Any]]) -> float:
    """Compute Fleiss' kappa for inter-annotator agreement on categorical data.

    Each annotation dict is expected to have a ``best_turn_number`` key (int or
    None).  Annotations where ``do_not_surface`` is True are placed in a
    special "do_not_surface" category.

    The computation treats each unique turn number (and "do_not_surface") as a
    nominal category.  Each "subject" is considered to be the (excerpt, item)
    pair, but because this function is called per-pair, there is only one
    subject; so we bin annotators' chosen best_turn_numbers into categories.

    For a single subject (the standard Fleiss' kappa degenerates), we instead
    compute pairwise agreement: the proportion of annotator pairs that chose
    the same category minus chance agreement.

    Returns a float in [-1, 1].  Returns 0.0 when there are fewer than 2
    annotations or when chance agreement is 1.
    """
    if len(annotations) < 2:
        return 0.0

    # Build list of category assignments
    categories: list[str] = []
    for ann in annotations:
        if ann.get("do_not_surface"):
            categories.append("__do_not_surface__")
        elif ann.get("best_turn_number") is not None:
            categories.append(str(ann["best_turn_number"]))
        else:
            categories.append("__none__")

    n = len(categories)
    if n < 2:
        return 0.0

    # Count category frequencies
    freq = Counter(categories)
    all_cats = list(freq.keys())
    k = len(all_cats)

    if k == 0:
        return 0.0

    # Observed agreement: proportion of concordant pairs
    # P_o = sum(n_j * (n_j - 1)) / (n * (n - 1))
    concordant = sum(nj * (nj - 1) for nj in freq.values())
    total_pairs = n * (n - 1)

    if total_pairs == 0:
        return 0.0

    p_observed = concordant / total_pairs

    # Expected agreement under chance: P_e = sum((n_j / n)^2)
    p_expected = sum((nj / n) ** 2 for nj in freq.values())

    if abs(p_expected - 1.0) < 1e-12:
        # Perfect chance agreement -- kappa undefined, return 1 if perfect
        return 1.0 if abs(p_observed - 1.0) < 1e-12 else 0.0

    kappa = (p_observed - p_expected) / (1.0 - p_expected)
    return kappa


def compute_kendalls_w(rankings: list[list[int]]) -> float:
    """Compute Kendall's coefficient of concordance (W).

    ``rankings`` is a list of ranking arrays.  Each inner list represents one
    rater's ranking over k items, where the value at index j is the rank
    assigned to item j (1-based).

    All inner lists must have the same length.  If fewer than 2 raters or fewer
    than 2 items, returns 0.0.

    Returns a float in [0, 1].
    """
    m = len(rankings)  # number of raters
    if m < 2:
        return 0.0

    k = len(rankings[0])  # number of items
    if k < 2:
        return 0.0

    # Validate all rankings have the same length
    for r in rankings:
        if len(r) != k:
            return 0.0

    # Compute column sums R_j = sum of ranks for item j across all raters
    column_sums = [0.0] * k
    for r in rankings:
        for j in range(k):
            column_sums[j] += r[j]

    # Mean of column sums
    r_bar = sum(column_sums) / k

    # S = sum of squared deviations of column sums from the mean
    s = sum((rj - r_bar) ** 2 for rj in column_sums)

    # Maximum possible S (when there is perfect agreement)
    # S_max = (m^2 * (k^3 - k)) / 12
    s_max = (m ** 2 * (k ** 3 - k)) / 12.0

    if s_max == 0.0:
        return 0.0

    w = s / s_max
    return w


# ---------------------------------------------------------------------------
# Consensus computation helpers
# ---------------------------------------------------------------------------


def _median(values: list[int]) -> int:
    """Compute the integer median of a list of ints (rounds to nearest int)."""
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    mid = n // 2
    if n % 2 == 0:
        return round((sorted_vals[mid - 1] + sorted_vals[mid]) / 2)
    return sorted_vals[mid]


def _mode(values: list[int]) -> int:
    """Compute the mode of a list of ints. Breaks ties by choosing the median
    of the modes."""
    freq = Counter(values)
    max_count = max(freq.values())
    modes = sorted(k for k, v in freq.items() if v == max_count)
    # Return the median of the modes (stable choice)
    return modes[len(modes) // 2]


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


async def _resolve_turn_by_number(
    db: AsyncSession, conversation_id: uuid.UUID, turn_number: int
) -> Turn | None:
    """Look up a Turn by conversation + turn_number. Returns None if not found."""
    result = await db.execute(
        select(Turn).where(
            Turn.conversation_id == conversation_id,
            Turn.turn_number == turn_number,
        )
    )
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def compute_consensus_window(
    db: AsyncSession,
    excerpt_id: uuid.UUID,
    knowledge_item_id: uuid.UUID,
) -> dict[str, Any]:
    """Compute the consensus window for a single (excerpt, item) pair.

    Algorithm:
    1. Gather all cross_annotation + deliberation (latest revision) annotations.
    2. If majority say ``do_not_surface``: status = "do_not_surface", null window.
    3. Otherwise: compute median start/end turns, mode best turn.
    4. Compute annotator_agreement as proportion agreeing within +/-1 turn of
       median best turn.
    5. Status: "well_defined" if agreement > 0.6, else "contested".
    6. Upsert ConsensusWindow record.
    """
    # Fetch the excerpt to get conversation_id
    exc_result = await db.execute(
        select(TranscriptExcerpt).where(TranscriptExcerpt.id == excerpt_id)
    )
    excerpt = exc_result.scalar_one_or_none()
    if excerpt is None:
        raise ValueError(f"Excerpt {excerpt_id} not found")

    conversation_id = excerpt.conversation_id

    # Fetch all annotations for this excerpt + item
    result = await db.execute(
        select(Annotation).where(
            Annotation.excerpt_id == excerpt_id,
            Annotation.knowledge_item_id == knowledge_item_id,
            Annotation.phase.in_([
                AnnotationPhase.cross_annotation,
                AnnotationPhase.deliberation,
            ]),
        )
    )
    all_annotations = result.scalars().all()

    if not all_annotations:
        raise ValueError(
            f"No annotations found for excerpt={excerpt_id}, item={knowledge_item_id}"
        )

    # For each annotator, prefer the latest deliberation revision over the
    # original cross_annotation.
    annotator_annotations: dict[uuid.UUID, Annotation] = {}
    for ann in all_annotations:
        existing = annotator_annotations.get(ann.annotator_id)
        if existing is None:
            annotator_annotations[ann.annotator_id] = ann
        elif ann.phase == AnnotationPhase.deliberation:
            # Deliberation supersedes cross_annotation
            if existing.phase == AnnotationPhase.cross_annotation:
                annotator_annotations[ann.annotator_id] = ann
            elif ann.created_at > existing.created_at:
                # Later deliberation revision supersedes earlier one
                annotator_annotations[ann.annotator_id] = ann

    effective_annotations = list(annotator_annotations.values())

    # Collect turn IDs for batch resolution
    turn_ids: set[uuid.UUID] = set()
    for ann in effective_annotations:
        for tid in (ann.window_start_id, ann.window_end_id, ann.best_turn_id):
            if tid is not None:
                turn_ids.add(tid)
    turn_number_map = await _get_turn_number_map(db, turn_ids)

    # Count do_not_surface votes
    dns_count = sum(1 for ann in effective_annotations if ann.do_not_surface)
    total = len(effective_annotations)

    source_annotation_ids = [str(ann.id) for ann in effective_annotations]

    if dns_count > total / 2:
        # Majority says do_not_surface
        consensus = await _upsert_consensus_window(
            db,
            excerpt_id=excerpt_id,
            knowledge_item_id=knowledge_item_id,
            consensus_start_id=None,
            consensus_end_id=None,
            consensus_best_turn_id=None,
            annotator_agreement=dns_count / total,
            status=ConsensusStatus.do_not_surface,
            source_annotations={"annotation_ids": source_annotation_ids},
        )
        return _consensus_window_to_dict(consensus, turn_number_map)

    # Filter to annotations that are NOT do_not_surface and have window data
    active_annotations = [
        ann for ann in effective_annotations
        if not ann.do_not_surface
        and ann.window_start_id is not None
        and ann.window_end_id is not None
        and ann.best_turn_id is not None
    ]

    if not active_annotations:
        # Edge case: no active annotations with window data
        consensus = await _upsert_consensus_window(
            db,
            excerpt_id=excerpt_id,
            knowledge_item_id=knowledge_item_id,
            consensus_start_id=None,
            consensus_end_id=None,
            consensus_best_turn_id=None,
            annotator_agreement=0.0,
            status=ConsensusStatus.contested,
            source_annotations={"annotation_ids": source_annotation_ids},
        )
        return _consensus_window_to_dict(consensus, turn_number_map)

    # Compute median start, end, mode best
    start_numbers = [
        turn_number_map[ann.window_start_id] for ann in active_annotations
    ]
    end_numbers = [
        turn_number_map[ann.window_end_id] for ann in active_annotations
    ]
    best_numbers = [
        turn_number_map[ann.best_turn_id] for ann in active_annotations
    ]

    median_start = _median(start_numbers)
    median_end = _median(end_numbers)
    mode_best = _mode(best_numbers)

    # Ensure median_start <= mode_best <= median_end
    if mode_best < median_start:
        median_start = mode_best
    if mode_best > median_end:
        median_end = mode_best

    # Compute annotator agreement: proportion agreeing within +/-1 turn of
    # the mode best turn
    agree_count = sum(
        1 for bt in best_numbers if abs(bt - mode_best) <= 1
    )
    agreement = agree_count / len(best_numbers) if best_numbers else 0.0

    # Determine status
    status_val = (
        ConsensusStatus.well_defined if agreement > 0.6
        else ConsensusStatus.contested
    )

    # Resolve consensus turn numbers to turn IDs
    consensus_start_turn = await _resolve_turn_by_number(
        db, conversation_id, median_start
    )
    consensus_end_turn = await _resolve_turn_by_number(
        db, conversation_id, median_end
    )
    consensus_best_turn = await _resolve_turn_by_number(
        db, conversation_id, mode_best
    )

    consensus = await _upsert_consensus_window(
        db,
        excerpt_id=excerpt_id,
        knowledge_item_id=knowledge_item_id,
        consensus_start_id=(
            consensus_start_turn.id if consensus_start_turn else None
        ),
        consensus_end_id=(
            consensus_end_turn.id if consensus_end_turn else None
        ),
        consensus_best_turn_id=(
            consensus_best_turn.id if consensus_best_turn else None
        ),
        annotator_agreement=agreement,
        status=status_val,
        source_annotations={"annotation_ids": source_annotation_ids},
    )

    # Re-collect turn IDs for the response (in case consensus turns are new)
    all_turn_ids = set(turn_ids)
    for tid in (
        consensus.consensus_start_id,
        consensus.consensus_end_id,
        consensus.consensus_best_turn_id,
    ):
        if tid is not None:
            all_turn_ids.add(tid)
    full_turn_map = await _get_turn_number_map(db, all_turn_ids)

    return _consensus_window_to_dict(consensus, full_turn_map)


async def compute_consensus_ranking(
    db: AsyncSession,
    excerpt_id: uuid.UUID,
) -> dict[str, Any]:
    """Compute consensus priority ranking for an excerpt via Borda count.

    For N items, rank 1 gets N points, rank 2 gets N-1, etc.
    Computes Kendall's W for agreement_score.
    Upserts a ConsensusPriorityRanking record.
    """
    # Fetch all PriorityRankings for this excerpt
    result = await db.execute(
        select(PriorityRanking).where(
            PriorityRanking.excerpt_id == excerpt_id,
        )
    )
    all_rankings = result.scalars().all()

    if not all_rankings:
        raise ValueError(f"No priority rankings found for excerpt {excerpt_id}")

    # Parse ranked_items from JSONB.  Each ranking.ranked_items is a list of
    # dicts: [{"knowledge_item_id": ..., "rank": ..., "chosen_best_turn_number": ...}]

    # Collect all unique item IDs across rankings
    all_item_ids: set[str] = set()
    for ranking in all_rankings:
        for entry in ranking.ranked_items:
            all_item_ids.add(entry["knowledge_item_id"])

    item_ids_list = sorted(all_item_ids)
    n_items = len(item_ids_list)

    if n_items == 0:
        raise ValueError("No items found in rankings")

    # Build Borda scores and ranking matrix for Kendall's W
    borda_scores: dict[str, float] = {iid: 0.0 for iid in item_ids_list}
    ranking_matrix: list[list[int]] = []  # each row = one rater's ranks

    for ranking in all_rankings:
        # Map item_id -> rank for this rater
        item_rank_map: dict[str, int] = {}
        for entry in ranking.ranked_items:
            item_rank_map[entry["knowledge_item_id"]] = entry["rank"]

        # Build rank array aligned to item_ids_list
        rank_row: list[int] = []
        for iid in item_ids_list:
            rank = item_rank_map.get(iid)
            if rank is not None:
                borda_scores[iid] += (n_items - rank + 1)
                rank_row.append(rank)
            else:
                # Item not ranked by this rater -> assign worst rank
                borda_scores[iid] += 0
                rank_row.append(n_items + 1)

        ranking_matrix.append(rank_row)

    # Sort items by Borda score (descending) to produce consensus ranking
    sorted_items = sorted(
        item_ids_list, key=lambda iid: borda_scores[iid], reverse=True
    )

    # Build the consensus ranked_items list
    # Also compute mode of chosen_best_turn_number per item
    item_best_turns: dict[str, list[int]] = {iid: [] for iid in item_ids_list}
    for ranking in all_rankings:
        for entry in ranking.ranked_items:
            if entry.get("chosen_best_turn_number") is not None:
                item_best_turns[entry["knowledge_item_id"]].append(
                    entry["chosen_best_turn_number"]
                )

    consensus_ranked_items = []
    for consensus_rank, iid in enumerate(sorted_items, start=1):
        best_turns = item_best_turns.get(iid, [])
        chosen_best = _mode(best_turns) if best_turns else None
        consensus_ranked_items.append({
            "knowledge_item_id": iid,
            "rank": consensus_rank,
            "borda_score": borda_scores[iid],
            "chosen_best_turn_number": chosen_best,
        })

    # Compute Kendall's W
    agreement_score = compute_kendalls_w(ranking_matrix)

    # Upsert ConsensusPriorityRanking
    existing_result = await db.execute(
        select(ConsensusPriorityRanking).where(
            ConsensusPriorityRanking.excerpt_id == excerpt_id,
        )
    )
    existing = existing_result.scalar_one_or_none()

    if existing is not None:
        existing.method = ConsensusMethod.borda_count
        existing.ranked_items = consensus_ranked_items
        existing.agreement_score = agreement_score
        await db.commit()
        await db.refresh(existing)
        record = existing
    else:
        record = ConsensusPriorityRanking(
            excerpt_id=excerpt_id,
            method=ConsensusMethod.borda_count,
            ranked_items=consensus_ranked_items,
            agreement_score=agreement_score,
        )
        db.add(record)
        await db.commit()
        await db.refresh(record)

    return {
        "id": str(record.id),
        "excerpt_id": str(record.excerpt_id),
        "method": enum_val(record.method),
        "ranked_items": record.ranked_items,
        "agreement_score": record.agreement_score,
        "created_at": record.created_at,
    }


async def compute_all_consensus(
    db: AsyncSession,
    conversation_id: uuid.UUID,
) -> dict[str, Any]:
    """Run consensus computation for all excerpt+item pairs in a conversation.

    Returns summary statistics.
    """
    # Fetch all excerpts for this conversation
    result = await db.execute(
        select(TranscriptExcerpt).where(
            TranscriptExcerpt.conversation_id == conversation_id,
        )
    )
    excerpts = result.scalars().all()

    if not excerpts:
        return {
            "conversation_id": str(conversation_id),
            "total_pairs": 0,
            "well_defined": 0,
            "contested": 0,
            "do_not_surface": 0,
            "ranking_count": 0,
            "errors": [],
        }

    # For each excerpt, find all unique knowledge_item_ids from annotations
    total_pairs = 0
    well_defined = 0
    contested = 0
    do_not_surface = 0
    ranking_count = 0
    errors: list[str] = []

    for excerpt in excerpts:
        # Get distinct knowledge_item_ids annotated for this excerpt
        ann_result = await db.execute(
            select(Annotation.knowledge_item_id)
            .where(Annotation.excerpt_id == excerpt.id)
            .distinct()
        )
        item_ids = [row[0] for row in ann_result.all()]

        for item_id in item_ids:
            total_pairs += 1
            try:
                result_dict = await compute_consensus_window(
                    db, excerpt.id, item_id
                )
                status_val = result_dict.get("status")
                if status_val == ConsensusStatus.well_defined.value:
                    well_defined += 1
                elif status_val == ConsensusStatus.contested.value:
                    contested += 1
                elif status_val == ConsensusStatus.do_not_surface.value:
                    do_not_surface += 1
            except Exception as e:
                errors.append(
                    f"excerpt={excerpt.id}, item={item_id}: {str(e)}"
                )
                logger.warning(
                    "Failed to compute consensus for excerpt=%s, item=%s: %s",
                    excerpt.id, item_id, e,
                )

        # Compute consensus ranking for the excerpt
        try:
            await compute_consensus_ranking(db, excerpt.id)
            ranking_count += 1
        except Exception as e:
            errors.append(f"ranking excerpt={excerpt.id}: {str(e)}")
            logger.warning(
                "Failed to compute consensus ranking for excerpt=%s: %s",
                excerpt.id, e,
            )

    return {
        "conversation_id": str(conversation_id),
        "total_pairs": total_pairs,
        "well_defined": well_defined,
        "contested": contested,
        "do_not_surface": do_not_surface,
        "ranking_count": ranking_count,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


async def _upsert_consensus_window(
    db: AsyncSession,
    *,
    excerpt_id: uuid.UUID,
    knowledge_item_id: uuid.UUID,
    consensus_start_id: uuid.UUID | None,
    consensus_end_id: uuid.UUID | None,
    consensus_best_turn_id: uuid.UUID | None,
    annotator_agreement: float,
    status: ConsensusStatus,
    source_annotations: dict | None,
) -> ConsensusWindow:
    """Create or update a ConsensusWindow record."""
    existing_result = await db.execute(
        select(ConsensusWindow).where(
            ConsensusWindow.excerpt_id == excerpt_id,
            ConsensusWindow.knowledge_item_id == knowledge_item_id,
        )
    )
    existing = existing_result.scalar_one_or_none()

    if existing is not None:
        existing.consensus_start_id = consensus_start_id
        existing.consensus_end_id = consensus_end_id
        existing.consensus_best_turn_id = consensus_best_turn_id
        existing.annotator_agreement = annotator_agreement
        existing.status = status
        existing.source_annotations = source_annotations
        await db.commit()
        await db.refresh(existing)
        return existing

    record = ConsensusWindow(
        excerpt_id=excerpt_id,
        knowledge_item_id=knowledge_item_id,
        consensus_start_id=consensus_start_id,
        consensus_end_id=consensus_end_id,
        consensus_best_turn_id=consensus_best_turn_id,
        annotator_agreement=annotator_agreement,
        status=status,
        source_annotations=source_annotations,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


def _consensus_window_to_dict(
    cw: ConsensusWindow,
    turn_number_map: dict[uuid.UUID, int],
) -> dict[str, Any]:
    """Serialize a ConsensusWindow to a dict with resolved turn numbers."""
    return {
        "id": str(cw.id),
        "excerpt_id": str(cw.excerpt_id),
        "knowledge_item_id": str(cw.knowledge_item_id),
        "consensus_start_turn_number": (
            turn_number_map.get(cw.consensus_start_id)
            if cw.consensus_start_id
            else None
        ),
        "consensus_end_turn_number": (
            turn_number_map.get(cw.consensus_end_id)
            if cw.consensus_end_id
            else None
        ),
        "consensus_best_turn_number": (
            turn_number_map.get(cw.consensus_best_turn_id)
            if cw.consensus_best_turn_id
            else None
        ),
        "annotator_agreement": cw.annotator_agreement,
        "status": enum_val(cw.status),
        "source_annotations": cw.source_annotations,
        "created_at": cw.created_at,
    }
