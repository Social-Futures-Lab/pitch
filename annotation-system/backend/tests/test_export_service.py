"""Tests for app/services/export_service.py."""

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.annotation import Annotation
from app.models.consensus import ConsensusPriorityRanking, ConsensusWindow
from app.models.conversation import Conversation
from app.models.enums import (
    AnnotationPhase,
    AnnotatorRole,
    ConsensusMethod,
    ConsensusStatus,
)
from app.models.knowledge_item import KnowledgeItem
from app.models.transcript_excerpt import TranscriptExcerpt
from app.models.turn import Turn
from app.models.user import User
from app.services import export_service


# ---------------------------------------------------------------------------
# Fixtures specific to export tests
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def consensus_window(
    db: AsyncSession,
    knowledge_item: KnowledgeItem,
    excerpt: TranscriptExcerpt,
    turns: list[Turn],
) -> ConsensusWindow:
    """Create a single ConsensusWindow for testing."""
    cw = ConsensusWindow(
        id=uuid.uuid4(),
        knowledge_item_id=knowledge_item.id,
        excerpt_id=excerpt.id,
        consensus_start_id=turns[2].id,
        consensus_end_id=turns[6].id,
        consensus_best_turn_id=turns[4].id,
        annotator_agreement=0.85,
        status=ConsensusStatus.well_defined,
        source_annotations={"annotation_ids": []},
    )
    db.add(cw)
    await db.commit()
    await db.refresh(cw)
    return cw


@pytest_asyncio.fixture
async def multiple_consensus_windows(
    db: AsyncSession,
    knowledge_item: KnowledgeItem,
    excerpt: TranscriptExcerpt,
    turns: list[Turn],
    conversation: Conversation,
    participant: User,
) -> list[ConsensusWindow]:
    """Create multiple ConsensusWindow records with different statuses."""
    # Create a second knowledge item for the "contested" window
    item2 = KnowledgeItem(
        id=uuid.uuid4(),
        conversation_id=conversation.id,
        author_id=participant.id,
        raw_ideal_response="Second item for testing.",
        window_start_id=turns[0].id,
        window_end_id=turns[4].id,
        best_turn_id=turns[2].id,
        contribution_type=knowledge_item.contribution_type,
        pertinence=0.6,
        source=knowledge_item.source,
        review_status=knowledge_item.review_status,
    )
    db.add(item2)
    await db.flush()

    # Create a second excerpt for the second item
    exc2 = TranscriptExcerpt(
        id=uuid.uuid4(),
        conversation_id=conversation.id,
        knowledge_item_id=item2.id,
        start_turn_id=turns[0].id,
        end_turn_id=turns[9].id,
        preceding_context_summary="Context before second excerpt.",
        following_context_summary="Context after second excerpt.",
    )
    db.add(exc2)
    await db.flush()

    # Create a third knowledge item for the "do_not_surface" window
    item3 = KnowledgeItem(
        id=uuid.uuid4(),
        conversation_id=conversation.id,
        author_id=participant.id,
        raw_ideal_response="Third item that should not surface.",
        window_start_id=turns[5].id,
        window_end_id=turns[9].id,
        best_turn_id=turns[7].id,
        contribution_type=knowledge_item.contribution_type,
        pertinence=0.3,
        source=knowledge_item.source,
        review_status=knowledge_item.review_status,
    )
    db.add(item3)
    await db.flush()

    exc3 = TranscriptExcerpt(
        id=uuid.uuid4(),
        conversation_id=conversation.id,
        knowledge_item_id=item3.id,
        start_turn_id=turns[0].id,
        end_turn_id=turns[9].id,
        preceding_context_summary="Context before third excerpt.",
        following_context_summary="Context after third excerpt.",
    )
    db.add(exc3)
    await db.flush()

    cw1 = ConsensusWindow(
        id=uuid.uuid4(),
        knowledge_item_id=knowledge_item.id,
        excerpt_id=excerpt.id,
        consensus_start_id=turns[2].id,
        consensus_end_id=turns[6].id,
        consensus_best_turn_id=turns[4].id,
        annotator_agreement=0.90,
        status=ConsensusStatus.well_defined,
        source_annotations={"annotation_ids": []},
    )
    cw2 = ConsensusWindow(
        id=uuid.uuid4(),
        knowledge_item_id=item2.id,
        excerpt_id=exc2.id,
        consensus_start_id=turns[1].id,
        consensus_end_id=turns[5].id,
        consensus_best_turn_id=turns[3].id,
        annotator_agreement=0.60,
        status=ConsensusStatus.contested,
        source_annotations={"annotation_ids": []},
    )
    cw3 = ConsensusWindow(
        id=uuid.uuid4(),
        knowledge_item_id=item3.id,
        excerpt_id=exc3.id,
        consensus_start_id=None,
        consensus_end_id=None,
        consensus_best_turn_id=None,
        annotator_agreement=0.95,
        status=ConsensusStatus.do_not_surface,
        source_annotations={"annotation_ids": []},
    )
    db.add_all([cw1, cw2, cw3])
    await db.commit()
    for cw in [cw1, cw2, cw3]:
        await db.refresh(cw)
    return [cw1, cw2, cw3]


# ---------------------------------------------------------------------------
# export_pick_best_turn
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_pick_best_turn_empty(
    db: AsyncSession, conversation: Conversation
):
    """Returns empty list when no consensus windows exist."""
    result = await export_service.export_pick_best_turn(db, conversation.id)
    assert result == []


@pytest.mark.asyncio
async def test_export_pick_best_turn_with_consensus(
    db: AsyncSession,
    conversation: Conversation,
    consensus_window: ConsensusWindow,
    knowledge_item: KnowledgeItem,
    excerpt: TranscriptExcerpt,
    turns: list[Turn],
):
    """Returns data with consensus turns when a consensus window exists."""
    result = await export_service.export_pick_best_turn(db, conversation.id)
    assert len(result) == 1

    entry = result[0]
    assert entry["excerpt_id"] == str(excerpt.id)
    assert entry["knowledge_item_id"] == str(knowledge_item.id)
    assert entry["consensus_window_start"] == turns[2].turn_number  # turn 3
    assert entry["consensus_window_end"] == turns[6].turn_number  # turn 7
    assert entry["consensus_best_turn"] == turns[4].turn_number  # turn 5
    assert entry["consensus_status"] == "well_defined"
    assert entry["annotator_agreement"] == 0.85
    assert entry["context_before"] == excerpt.preceding_context_summary
    assert entry["context_after"] == excerpt.following_context_summary
    # The neutralized item should fall back to raw since neutralized is None
    assert entry["neutralized_item"] == knowledge_item.raw_ideal_response
    assert entry["contribution_type"] == knowledge_item.contribution_type.value
    # Transcript turns should start from consensus_start (turn 3) to end of excerpt
    assert len(entry["transcript_turns"]) > 0
    assert entry["transcript_turns"][0]["turn_number"] == turns[2].turn_number


@pytest.mark.asyncio
async def test_export_pick_best_turn_uses_neutralized_text(
    db: AsyncSession,
    conversation: Conversation,
    consensus_window: ConsensusWindow,
    knowledge_item: KnowledgeItem,
):
    """When neutralized_ideal_response is set, it takes priority."""
    knowledge_item.neutralized_ideal_response = "Neutralized version"
    await db.commit()

    result = await export_service.export_pick_best_turn(db, conversation.id)
    assert result[0]["neutralized_item"] == "Neutralized version"


@pytest.mark.asyncio
async def test_export_pick_best_turn_no_conversation_filter(
    db: AsyncSession,
    consensus_window: ConsensusWindow,
):
    """When conversation_id=None, all consensus windows are returned."""
    result = await export_service.export_pick_best_turn(db, None)
    assert len(result) == 1


# ---------------------------------------------------------------------------
# export_turn_by_turn
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_turn_by_turn_empty(
    db: AsyncSession, conversation: Conversation
):
    """Returns empty list when no consensus windows exist."""
    result = await export_service.export_turn_by_turn(db, conversation.id)
    assert result == []


@pytest.mark.asyncio
async def test_export_turn_by_turn_includes_replay_start(
    db: AsyncSession,
    conversation: Conversation,
    consensus_window: ConsensusWindow,
    turns: list[Turn],
):
    """Turn-by-turn export includes replay_start_turn matching consensus window start."""
    result = await export_service.export_turn_by_turn(db, conversation.id)
    assert len(result) == 1

    entry = result[0]
    assert "replay_start_turn" in entry
    assert entry["replay_start_turn"] == turns[2].turn_number
    # Also has all the pick-best-turn fields
    assert "consensus_best_turn" in entry
    assert "transcript_turns" in entry


@pytest.mark.asyncio
async def test_export_turn_by_turn_no_conversation_filter(
    db: AsyncSession,
    consensus_window: ConsensusWindow,
):
    """Without conversation filter, all windows are included."""
    result = await export_service.export_turn_by_turn(db, None)
    assert len(result) == 1
    assert "replay_start_turn" in result[0]


# ---------------------------------------------------------------------------
# export_agreement_stats
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_agreement_stats_empty(
    db: AsyncSession, conversation: Conversation
):
    """Returns zero counts when no consensus windows exist."""
    result = await export_service.export_agreement_stats(db, conversation.id)
    assert result["total_pairs"] == 0
    assert result["well_defined"] == 0
    assert result["contested"] == 0
    assert result["do_not_surface"] == 0
    assert result["mean_agreement"] == 0.0


@pytest.mark.asyncio
async def test_export_agreement_stats_correct_counts(
    db: AsyncSession,
    conversation: Conversation,
    multiple_consensus_windows: list[ConsensusWindow],
):
    """Returns correct counts of well_defined, contested, do_not_surface."""
    result = await export_service.export_agreement_stats(db, conversation.id)

    assert result["total_pairs"] == 3
    assert result["well_defined"] == 1
    assert result["contested"] == 1
    assert result["do_not_surface"] == 1


@pytest.mark.asyncio
async def test_export_agreement_stats_mean_agreement(
    db: AsyncSession,
    conversation: Conversation,
    multiple_consensus_windows: list[ConsensusWindow],
):
    """Mean agreement is computed correctly across all consensus windows."""
    result = await export_service.export_agreement_stats(db, conversation.id)

    # The three windows have agreements: 0.90, 0.60, 0.95
    expected_mean = round((0.90 + 0.60 + 0.95) / 3, 4)
    assert result["mean_agreement"] == expected_mean


@pytest.mark.asyncio
async def test_export_agreement_stats_single_window(
    db: AsyncSession,
    conversation: Conversation,
    consensus_window: ConsensusWindow,
):
    """With a single consensus window, stats reflect that one record."""
    result = await export_service.export_agreement_stats(db, conversation.id)
    assert result["total_pairs"] == 1
    assert result["well_defined"] == 1
    assert result["contested"] == 0
    assert result["do_not_surface"] == 0
    assert result["mean_agreement"] == 0.85


@pytest.mark.asyncio
async def test_export_agreement_stats_no_conversation_filter(
    db: AsyncSession,
    consensus_window: ConsensusWindow,
):
    """Without conversation filter, all windows are counted."""
    result = await export_service.export_agreement_stats(db, None)
    assert result["total_pairs"] == 1


# ---------------------------------------------------------------------------
# export_bulk
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_bulk_json_format(
    db: AsyncSession,
    conversation: Conversation,
    knowledge_item: KnowledgeItem,
    turns: list[Turn],
):
    """JSON format returns dict with all tables."""
    result = await export_service.export_bulk(db, format="json")

    assert "conversations" in result
    assert "knowledge_items" in result
    assert "annotations" in result
    assert "consensus_windows" in result
    assert "priority_rankings" in result
    assert "consensus_priority_rankings" in result


@pytest.mark.asyncio
async def test_export_bulk_json_has_conversation(
    db: AsyncSession,
    conversation: Conversation,
):
    """Conversations table includes the test conversation."""
    result = await export_service.export_bulk(db, format="json")
    assert len(result["conversations"]) == 1
    assert result["conversations"][0]["id"] == str(conversation.id)


@pytest.mark.asyncio
async def test_export_bulk_json_has_knowledge_items(
    db: AsyncSession,
    knowledge_item: KnowledgeItem,
):
    """Knowledge items table includes the test item."""
    result = await export_service.export_bulk(db, format="json")
    assert len(result["knowledge_items"]) == 1
    ki = result["knowledge_items"][0]
    assert ki["id"] == str(knowledge_item.id)
    assert ki["raw_ideal_response"] == knowledge_item.raw_ideal_response
    assert ki["contribution_type"] == knowledge_item.contribution_type.value
    assert ki["pertinence"] == knowledge_item.pertinence
    assert ki["review_status"] == knowledge_item.review_status.value


@pytest.mark.asyncio
async def test_export_bulk_json_has_consensus_windows(
    db: AsyncSession,
    consensus_window: ConsensusWindow,
    turns: list[Turn],
):
    """Consensus windows table includes the test window with resolved turn numbers."""
    result = await export_service.export_bulk(db, format="json")
    assert len(result["consensus_windows"]) == 1
    cw = result["consensus_windows"][0]
    assert cw["id"] == str(consensus_window.id)
    assert cw["consensus_start_turn_number"] == turns[2].turn_number
    assert cw["consensus_end_turn_number"] == turns[6].turn_number
    assert cw["consensus_best_turn_number"] == turns[4].turn_number
    assert cw["annotator_agreement"] == 0.85
    assert cw["status"] == "well_defined"


@pytest.mark.asyncio
async def test_export_bulk_json_has_annotations(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
    participant: User,
    turns: list[Turn],
):
    """Annotations table includes created annotations."""
    ann = Annotation(
        id=uuid.uuid4(),
        excerpt_id=excerpt.id,
        knowledge_item_id=knowledge_item.id,
        annotator_id=participant.id,
        annotator_role=AnnotatorRole.within_group,
        phase=AnnotationPhase.cross_annotation,
        window_start_id=turns[1].id,
        window_end_id=turns[5].id,
        best_turn_id=turns[3].id,
        do_not_surface=False,
    )
    db.add(ann)
    await db.commit()

    result = await export_service.export_bulk(db, format="json")
    assert len(result["annotations"]) == 1
    out_ann = result["annotations"][0]
    assert out_ann["id"] == str(ann.id)
    assert out_ann["annotator_role"] == "within_group"
    assert out_ann["phase"] == "cross_annotation"
    assert out_ann["window_start_turn_number"] == turns[1].turn_number
    assert out_ann["best_turn_number"] == turns[3].turn_number
    assert out_ann["do_not_surface"] is False


@pytest.mark.asyncio
async def test_export_bulk_csv_format(
    db: AsyncSession,
    conversation: Conversation,
    knowledge_item: KnowledgeItem,
):
    """CSV format also returns dict with all table keys."""
    result = await export_service.export_bulk(db, format="csv")

    assert "conversations" in result
    assert "knowledge_items" in result
    assert "annotations" in result
    assert "consensus_windows" in result
    assert "priority_rankings" in result
    assert "consensus_priority_rankings" in result


@pytest.mark.asyncio
async def test_export_bulk_empty_db(db: AsyncSession):
    """Bulk export on empty DB returns all keys with empty lists."""
    result = await export_service.export_bulk(db, format="json")
    assert result["conversations"] == []
    assert result["knowledge_items"] == []
    assert result["annotations"] == []
    assert result["consensus_windows"] == []
    assert result["priority_rankings"] == []
    assert result["consensus_priority_rankings"] == []


@pytest.mark.asyncio
async def test_export_bulk_knowledge_item_turn_numbers(
    db: AsyncSession,
    knowledge_item: KnowledgeItem,
    turns: list[Turn],
):
    """Knowledge items in bulk export include resolved turn numbers."""
    result = await export_service.export_bulk(db, format="json")
    ki = result["knowledge_items"][0]
    assert ki["window_start_turn_number"] == turns[2].turn_number
    assert ki["window_end_turn_number"] == turns[6].turn_number
    assert ki["best_turn_number"] == turns[4].turn_number
