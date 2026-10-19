"""Tests for app/services/construction_service.py."""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Conversation
from app.models.enums import GroupStatus
from app.models.group import Group
from app.models.knowledge_item import KnowledgeItem
from app.models.search_result import SearchResult
from app.models.turn import Turn
from app.models.user import User
from app.schemas.construction import KnowledgeItemCreate, KnowledgeItemUpdate
from app.services import construction_service


# =====================================================================
# get_transcript
# =====================================================================


@pytest.mark.asyncio
async def test_get_transcript_returns_all_turns(
    db: AsyncSession,
    conversation: Conversation,
    turns: list[Turn],
    participant: User,
    group_with_members: Group,
):
    """get_transcript returns all turns with speaker names."""
    result = await construction_service.get_transcript(
        db, conversation.id, participant.id
    )

    assert result["conversation_id"] == str(conversation.id)
    assert len(result["turns"]) == 10

    # Verify turn ordering and content
    for i, t in enumerate(result["turns"]):
        assert t["turn_number"] == i + 1
        assert t["text"] == f"Turn {i + 1} text content"
        assert t["speaker_name"] in ("Test Participant", "Participant Two")


@pytest.mark.asyncio
async def test_get_transcript_includes_flagged_status(
    db: AsyncSession,
    conversation: Conversation,
    turns: list[Turn],
    participant: User,
    group_with_members: Group,
):
    """get_transcript includes flagged status per turn for the user's flags."""
    # Import here to avoid circular imports at module level
    from app.services.conversation_service import create_flag

    # Flag turn 3 and turn 7
    await create_flag(
        db, str(conversation.id), str(participant.id), str(turns[2].id)
    )
    await create_flag(
        db, str(conversation.id), str(participant.id), str(turns[6].id)
    )

    result = await construction_service.get_transcript(
        db, conversation.id, participant.id
    )

    # Check specific turns are flagged
    flagged_numbers = {
        t["turn_number"] for t in result["turns"] if t["flagged"]
    }
    assert flagged_numbers == {3, 7}

    # Check the rest are not flagged
    unflagged_numbers = {
        t["turn_number"] for t in result["turns"] if not t["flagged"]
    }
    assert unflagged_numbers == {1, 2, 4, 5, 6, 8, 9, 10}


@pytest.mark.asyncio
async def test_get_transcript_non_member(
    db: AsyncSession,
    conversation: Conversation,
    turns: list[Turn],
    external_annotator: User,
    group_with_members: Group,
):
    """get_transcript raises 403 for a user who is not a group member."""
    with pytest.raises(HTTPException) as exc_info:
        await construction_service.get_transcript(
            db, conversation.id, external_annotator.id
        )

    assert exc_info.value.status_code == 403
    assert "not a member" in exc_info.value.detail.lower()


# =====================================================================
# create_knowledge_item
# =====================================================================


@pytest.mark.asyncio
async def test_create_knowledge_item_success(
    db: AsyncSession,
    conversation: Conversation,
    turns: list[Turn],
    participant: User,
    group_with_members: Group,
):
    """create_knowledge_item creates an item with valid data."""
    item_data = KnowledgeItemCreate(
        raw_ideal_response="This is an ideal response about the topic.",
        window_start_turn_number=2,
        window_end_turn_number=8,
        best_turn_number=5,
        contribution_type="heads_up",
        pertinence=0.7,
    )

    result = await construction_service.create_knowledge_item(
        db, conversation.id, participant.id, item_data
    )

    assert result["raw_ideal_response"] == "This is an ideal response about the topic."
    assert result["window_start_turn_number"] == 2
    assert result["window_end_turn_number"] == 8
    assert result["best_turn_number"] == 5
    assert result["contribution_type"] == "heads_up"
    assert result["pertinence"] == 0.7
    assert result["source"] == "participant"
    assert result["author_id"] == str(participant.id)
    assert result["conversation_id"] == str(conversation.id)


@pytest.mark.asyncio
async def test_create_knowledge_item_window_start_gt_end(
    db: AsyncSession,
    conversation: Conversation,
    turns: list[Turn],
    participant: User,
    group_with_members: Group,
):
    """create_knowledge_item raises 400 when window_start > window_end."""
    item_data = KnowledgeItemCreate(
        raw_ideal_response="Some response.",
        window_start_turn_number=8,
        window_end_turn_number=3,
        best_turn_number=5,
        contribution_type="heads_up",
        pertinence=0.5,
    )

    with pytest.raises(HTTPException) as exc_info:
        await construction_service.create_knowledge_item(
            db, conversation.id, participant.id, item_data
        )

    assert exc_info.value.status_code == 400
    assert "window_start_turn_number" in exc_info.value.detail


@pytest.mark.asyncio
async def test_create_knowledge_item_best_turn_outside_window(
    db: AsyncSession,
    conversation: Conversation,
    turns: list[Turn],
    participant: User,
    group_with_members: Group,
):
    """create_knowledge_item raises 400 when best_turn is outside the window."""
    item_data = KnowledgeItemCreate(
        raw_ideal_response="Some response.",
        window_start_turn_number=3,
        window_end_turn_number=7,
        best_turn_number=9,  # outside window
        contribution_type="suggestion",
        pertinence=0.6,
    )

    with pytest.raises(HTTPException) as exc_info:
        await construction_service.create_knowledge_item(
            db, conversation.id, participant.id, item_data
        )

    assert exc_info.value.status_code == 400
    assert "best_turn_number" in exc_info.value.detail


@pytest.mark.asyncio
async def test_create_knowledge_item_empty_response(
    db: AsyncSession,
    conversation: Conversation,
    turns: list[Turn],
    participant: User,
    group_with_members: Group,
):
    """create_knowledge_item raises 400 when raw_ideal_response is empty."""
    item_data = KnowledgeItemCreate(
        raw_ideal_response="   ",  # whitespace only
        window_start_turn_number=2,
        window_end_turn_number=5,
        best_turn_number=3,
        contribution_type="pushback",
        pertinence=0.5,
    )

    with pytest.raises(HTTPException) as exc_info:
        await construction_service.create_knowledge_item(
            db, conversation.id, participant.id, item_data
        )

    assert exc_info.value.status_code == 400
    assert "raw_ideal_response" in exc_info.value.detail


# =====================================================================
# update_knowledge_item
# =====================================================================


@pytest.mark.asyncio
async def test_update_knowledge_item_partial_success(
    db: AsyncSession,
    knowledge_item: KnowledgeItem,
    participant: User,
    turns: list[Turn],
):
    """Partial update of a knowledge item succeeds."""
    update_data = KnowledgeItemUpdate(
        raw_ideal_response="Updated ideal response text.",
        pertinence=0.95,
    )

    result = await construction_service.update_knowledge_item(
        db, knowledge_item.id, participant.id, update_data
    )

    assert result["raw_ideal_response"] == "Updated ideal response text."
    assert result["pertinence"] == 0.95
    # Window values should remain unchanged (turns 3-7 from fixture)
    assert result["window_start_turn_number"] == 3
    assert result["window_end_turn_number"] == 7
    assert result["best_turn_number"] == 5


@pytest.mark.asyncio
async def test_update_knowledge_item_non_owner(
    db: AsyncSession,
    knowledge_item: KnowledgeItem,
    participant2: User,
    turns: list[Turn],
):
    """Updating a knowledge item by a non-owner raises 403."""
    update_data = KnowledgeItemUpdate(
        raw_ideal_response="Unauthorized update.",
    )

    with pytest.raises(HTTPException) as exc_info:
        await construction_service.update_knowledge_item(
            db, knowledge_item.id, participant2.id, update_data
        )

    assert exc_info.value.status_code == 403
    assert "your own" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_update_knowledge_item_invalid_window_after_update(
    db: AsyncSession,
    knowledge_item: KnowledgeItem,
    participant: User,
    turns: list[Turn],
):
    """Updating to an invalid window (start > end) raises 400."""
    # The fixture has window 3-7. Setting start to 9 makes start > end.
    update_data = KnowledgeItemUpdate(
        window_start_turn_number=9,
    )

    with pytest.raises(HTTPException) as exc_info:
        await construction_service.update_knowledge_item(
            db, knowledge_item.id, participant.id, update_data
        )

    assert exc_info.value.status_code == 400
    assert "window_start_turn_number" in exc_info.value.detail


# =====================================================================
# get_user_items
# =====================================================================


@pytest.mark.asyncio
async def test_get_user_items_with_resolved_numbers(
    db: AsyncSession,
    conversation: Conversation,
    knowledge_item: KnowledgeItem,
    participant: User,
    turns: list[Turn],
):
    """get_user_items returns items with resolved turn numbers."""
    items = await construction_service.get_user_items(
        db, conversation.id, participant.id
    )

    assert len(items) == 1
    item = items[0]
    assert item["id"] == str(knowledge_item.id)
    assert item["window_start_turn_number"] == 3
    assert item["window_end_turn_number"] == 7
    assert item["best_turn_number"] == 5
    assert item["raw_ideal_response"] == "This is a test ideal response about LLM ethics."


@pytest.mark.asyncio
async def test_get_user_items_empty_for_other_user(
    db: AsyncSession,
    conversation: Conversation,
    knowledge_item: KnowledgeItem,
    participant2: User,
    turns: list[Turn],
):
    """get_user_items returns empty list for a user who has no items."""
    items = await construction_service.get_user_items(
        db, conversation.id, participant2.id
    )

    assert items == []


# =====================================================================
# search_for_item
# =====================================================================


@pytest.mark.asyncio
@patch("app.services.construction_service.search_service.search")
async def test_search_for_item_success(
    mock_search: AsyncMock,
    db: AsyncSession,
    knowledge_item: KnowledgeItem,
    turns: list[Turn],
):
    """search_for_item calls search service and persists SearchResult records."""
    mock_search.return_value = [
        {
            "title": "Relevant Paper",
            "snippet": "This paper discusses the topic.",
            "url": "https://example.com/paper",
            "metadata": {"year": 2024},
        },
        {
            "title": "Another Paper",
            "snippet": "More relevant content.",
            "url": "https://example.com/paper2",
            "metadata": None,
        },
    ]

    results = await construction_service.search_for_item(
        db, knowledge_item.id, "LLM ethics", "scholarly"
    )

    # Verify search was called with correct args
    mock_search.assert_called_once_with("LLM ethics", "scholarly")

    # Verify results returned
    assert len(results) == 2
    assert results[0]["result_title"] == "Relevant Paper"
    assert results[0]["result_snippet"] == "This paper discusses the topic."
    assert results[0]["result_url"] == "https://example.com/paper"
    assert results[1]["result_title"] == "Another Paper"

    # Verify records persisted in DB
    from sqlalchemy import select

    db_results = await db.execute(
        select(SearchResult).where(
            SearchResult.knowledge_item_id == knowledge_item.id
        )
    )
    persisted = db_results.scalars().all()
    assert len(persisted) == 2


# =====================================================================
# ai_suggest
# =====================================================================


@pytest.mark.asyncio
@patch("app.services.construction_service.ai_suggest_service.suggest_ideal_response")
async def test_ai_suggest_success(
    mock_suggest: AsyncMock,
    db: AsyncSession,
    conversation: Conversation,
    knowledge_item: KnowledgeItem,
    turns: list[Turn],
    participant: User,
    group_with_members: Group,
):
    """ai_suggest calls LLM with correct transcript and returns suggestion."""
    mock_suggest.return_value = "Here is an AI-generated suggestion."

    result = await construction_service.ai_suggest(
        db,
        conversation.id,
        knowledge_item.id,
        participant.id,
        context_turns=[1, 2, 3],
    )

    assert result == "Here is an AI-generated suggestion."

    # Verify the mock was called
    mock_suggest.assert_called_once()
    call_kwargs = mock_suggest.call_args

    # The transcript_text should contain the specified turns
    transcript_text = call_kwargs[1]["transcript_text"] if call_kwargs[1] else call_kwargs[0][0]
    assert "[Turn 1]" in transcript_text
    assert "[Turn 2]" in transcript_text
    assert "[Turn 3]" in transcript_text
    # Turns outside the context should NOT be present
    assert "[Turn 4]" not in transcript_text

    # Scenario should be from the group
    scenario = call_kwargs[1]["scenario"] if call_kwargs[1] else call_kwargs[0][2]
    assert scenario == "scholarly"
