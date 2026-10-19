"""Tests for app/services/neutralization_service.py."""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from unittest.mock import AsyncMock, patch

from app.models.enums import (
    ContributionType,
    ItemSource,
    ReviewStatus,
)
from app.models.conversation import Conversation
from app.models.knowledge_item import KnowledgeItem
from app.models.turn import Turn
from app.models.user import User
from app.services import neutralization_service


# ---------------------------------------------------------------------------
# neutralize_item
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_neutralize_item_bedrock_provider():
    """With provider='bedrock', _invoke_bedrock is called."""
    with patch(
        "app.services.neutralization_service._invoke_bedrock",
        new_callable=AsyncMock,
        return_value="Neutralized via Bedrock",
    ) as mock_bedrock:
        result = await neutralization_service.neutralize_item(
            "As Bob mentioned, LLMs are important.", provider="bedrock"
        )
    assert result == "Neutralized via Bedrock"
    mock_bedrock.assert_awaited_once()
    # Verify the user content is passed correctly
    call_arg = mock_bedrock.call_args[0][0]
    assert "As Bob mentioned, LLMs are important." in call_arg


@pytest.mark.asyncio
async def test_neutralize_item_openai_provider():
    """With provider='openai', _invoke_openai is called."""
    with patch(
        "app.services.neutralization_service._invoke_openai",
        new_callable=AsyncMock,
        return_value="Neutralized via OpenAI",
    ) as mock_openai:
        result = await neutralization_service.neutralize_item(
            "Going back to what Alice said about ethics.", provider="openai"
        )
    assert result == "Neutralized via OpenAI"
    mock_openai.assert_awaited_once()


@pytest.mark.asyncio
async def test_neutralize_item_default_provider():
    """With provider=None, config is consulted for the default."""
    with patch(
        "app.services.neutralization_service.config",
        {"llm": {"provider": "bedrock"}},
    ):
        with patch(
            "app.services.neutralization_service._invoke_bedrock",
            new_callable=AsyncMock,
            return_value="Default bedrock",
        ) as mock_bedrock:
            result = await neutralization_service.neutralize_item(
                "Some raw text."
            )
    assert result == "Default bedrock"
    mock_bedrock.assert_awaited_once()


@pytest.mark.asyncio
async def test_neutralize_item_default_provider_openai():
    """With provider=None and config set to openai, _invoke_openai is called."""
    with patch(
        "app.services.neutralization_service.config",
        {"llm": {"provider": "openai"}},
    ):
        with patch(
            "app.services.neutralization_service._invoke_openai",
            new_callable=AsyncMock,
            return_value="Default openai",
        ) as mock_openai:
            result = await neutralization_service.neutralize_item(
                "Some raw text."
            )
    assert result == "Default openai"
    mock_openai.assert_awaited_once()


@pytest.mark.asyncio
async def test_neutralize_item_empty_text():
    """Empty text returns as-is without calling any LLM."""
    with patch(
        "app.services.neutralization_service._invoke_bedrock",
        new_callable=AsyncMock,
    ) as mock_bedrock:
        result = await neutralization_service.neutralize_item("")
    assert result == ""
    mock_bedrock.assert_not_awaited()


@pytest.mark.asyncio
async def test_neutralize_item_whitespace_only():
    """Whitespace-only text returns as-is."""
    with patch(
        "app.services.neutralization_service._invoke_bedrock",
        new_callable=AsyncMock,
    ) as mock_bedrock:
        result = await neutralization_service.neutralize_item("   ")
    assert result == "   "
    mock_bedrock.assert_not_awaited()


@pytest.mark.asyncio
async def test_neutralize_item_none_text():
    """None text returns as-is (falsy check)."""
    with patch(
        "app.services.neutralization_service._invoke_bedrock",
        new_callable=AsyncMock,
    ) as mock_bedrock:
        result = await neutralization_service.neutralize_item(None)
    assert result is None
    mock_bedrock.assert_not_awaited()


@pytest.mark.asyncio
async def test_neutralize_item_returns_llm_response():
    """The function returns exactly what the LLM returns."""
    expected = "LLMs are important for natural language processing research."
    with patch(
        "app.services.neutralization_service._invoke_bedrock",
        new_callable=AsyncMock,
        return_value=expected,
    ):
        result = await neutralization_service.neutralize_item(
            "Actually, as I was saying, LLMs are important for NLP research.",
            provider="bedrock",
        )
    assert result == expected


# ---------------------------------------------------------------------------
# batch_neutralize
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_neutralize_processes_pending_items(
    db: AsyncSession,
    conversation: Conversation,
    knowledge_item: KnowledgeItem,
):
    """Processes all pending items that have no neutralized text."""
    # knowledge_item fixture: review_status=pending, neutralized_ideal_response=None
    with patch(
        "app.services.neutralization_service.neutralize_item",
        new_callable=AsyncMock,
        return_value="Neutralized text",
    ) as mock_neutralize:
        results = await neutralization_service.batch_neutralize(
            db, conversation.id
        )

    assert len(results) == 1
    assert results[0]["item_id"] == str(knowledge_item.id)
    assert results[0]["neutralized_ideal_response"] == "Neutralized text"
    mock_neutralize.assert_awaited_once()

    # Verify DB update
    refreshed = (
        await db.execute(
            select(KnowledgeItem).where(KnowledgeItem.id == knowledge_item.id)
        )
    ).scalar_one()
    assert refreshed.neutralized_ideal_response == "Neutralized text"


@pytest.mark.asyncio
async def test_batch_neutralize_skips_already_neutralized(
    db: AsyncSession,
    conversation: Conversation,
    knowledge_item: KnowledgeItem,
):
    """Items that already have neutralized text are skipped."""
    knowledge_item.neutralized_ideal_response = "Already done"
    await db.commit()

    with patch(
        "app.services.neutralization_service.neutralize_item",
        new_callable=AsyncMock,
    ) as mock_neutralize:
        results = await neutralization_service.batch_neutralize(
            db, conversation.id
        )

    assert len(results) == 0
    mock_neutralize.assert_not_awaited()


@pytest.mark.asyncio
async def test_batch_neutralize_skips_non_pending(
    db: AsyncSession,
    conversation: Conversation,
    knowledge_item: KnowledgeItem,
):
    """Items that are not 'pending' review_status are skipped."""
    knowledge_item.review_status = ReviewStatus.approved
    await db.commit()

    with patch(
        "app.services.neutralization_service.neutralize_item",
        new_callable=AsyncMock,
    ) as mock_neutralize:
        results = await neutralization_service.batch_neutralize(
            db, conversation.id
        )

    assert len(results) == 0
    mock_neutralize.assert_not_awaited()


@pytest.mark.asyncio
async def test_batch_neutralize_continues_on_failure(
    db: AsyncSession,
    conversation: Conversation,
    participant: User,
    turns: list[Turn],
):
    """If one item fails, the batch continues with the rest."""
    # Create two knowledge items
    item1 = KnowledgeItem(
        id=uuid.uuid4(),
        conversation_id=conversation.id,
        author_id=participant.id,
        raw_ideal_response="Item one text.",
        window_start_id=turns[0].id,
        window_end_id=turns[3].id,
        best_turn_id=turns[1].id,
        contribution_type=ContributionType.suggestion,
        pertinence=0.5,
        source=ItemSource.participant,
        review_status=ReviewStatus.pending,
    )
    item2 = KnowledgeItem(
        id=uuid.uuid4(),
        conversation_id=conversation.id,
        author_id=participant.id,
        raw_ideal_response="Item two text.",
        window_start_id=turns[4].id,
        window_end_id=turns[7].id,
        best_turn_id=turns[5].id,
        contribution_type=ContributionType.heads_up,
        pertinence=0.7,
        source=ItemSource.participant,
        review_status=ReviewStatus.pending,
    )
    db.add_all([item1, item2])
    await db.commit()
    await db.refresh(item1)
    await db.refresh(item2)

    call_count = 0

    async def _side_effect(raw_text, provider=None):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise RuntimeError("LLM failure on first item")
        return "Successfully neutralized"

    with patch(
        "app.services.neutralization_service.neutralize_item",
        new_callable=AsyncMock,
        side_effect=_side_effect,
    ):
        results = await neutralization_service.batch_neutralize(
            db, conversation.id
        )

    # The original knowledge_item fixture is also pending with no neutralized text,
    # so we expect 3 items processed total (fixture item + item1 + item2).
    # One of the first processed should fail, the rest succeed.
    errors = [r for r in results if "error" in r]
    successes = [r for r in results if "neutralized_ideal_response" in r]
    assert len(errors) == 1
    assert len(successes) >= 1
    assert "LLM failure" in errors[0]["error"]


@pytest.mark.asyncio
async def test_batch_neutralize_returns_results(
    db: AsyncSession,
    conversation: Conversation,
    knowledge_item: KnowledgeItem,
):
    """Returns list with item_id and neutralized text."""
    with patch(
        "app.services.neutralization_service.neutralize_item",
        new_callable=AsyncMock,
        return_value="Clean text",
    ):
        results = await neutralization_service.batch_neutralize(
            db, conversation.id
        )

    assert len(results) == 1
    assert "item_id" in results[0]
    assert results[0]["neutralized_ideal_response"] == "Clean text"


@pytest.mark.asyncio
async def test_batch_neutralize_empty_conversation(
    db: AsyncSession,
    conversation: Conversation,
    knowledge_item: KnowledgeItem,
):
    """No items to process when all are already handled."""
    knowledge_item.neutralized_ideal_response = "Done"
    await db.commit()

    with patch(
        "app.services.neutralization_service.neutralize_item",
        new_callable=AsyncMock,
    ) as mock_neutralize:
        results = await neutralization_service.batch_neutralize(
            db, conversation.id
        )

    assert results == []
    mock_neutralize.assert_not_awaited()


@pytest.mark.asyncio
async def test_batch_neutralize_nonexistent_conversation(db: AsyncSession):
    """A conversation with no items returns an empty list (no crash)."""
    with patch(
        "app.services.neutralization_service.neutralize_item",
        new_callable=AsyncMock,
    ) as mock_neutralize:
        results = await neutralization_service.batch_neutralize(
            db, uuid.uuid4()
        )

    assert results == []
    mock_neutralize.assert_not_awaited()
