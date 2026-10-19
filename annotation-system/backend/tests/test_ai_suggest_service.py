"""Tests for app/services/ai_suggest_service.py."""

import pytest
from unittest.mock import AsyncMock, patch

from app.services import ai_suggest_service


@pytest.mark.asyncio
@patch("app.services.ai_suggest_service._invoke_bedrock")
async def test_suggest_ideal_response_includes_contribution_type(
    mock_bedrock: AsyncMock,
):
    """Test that contribution_type is included in the prompt."""
    mock_bedrock.return_value = "AI generated response"

    transcript = "[Turn 1] Alice: Hello\n[Turn 2] Bob: Hi"
    search_results = []

    result = await ai_suggest_service.suggest_ideal_response(
        transcript_text=transcript,
        search_results=search_results,
        inserted_resources=None,
        scenario="scholar",
        contribution_type="heads_up",
        importance=None,
    )

    assert result == "AI generated response"
    mock_bedrock.assert_called_once()

    # Check that the prompt includes contribution type guidance
    call_args = mock_bedrock.call_args
    messages = call_args[0][0]
    user_message = messages[0]["content"]
    assert "heads_up" in user_message.lower() or "Introduce a useful fact" in user_message


@pytest.mark.asyncio
@patch("app.services.ai_suggest_service._invoke_bedrock")
async def test_suggest_ideal_response_includes_importance(
    mock_bedrock: AsyncMock,
):
    """Test that importance level is included in the prompt."""
    mock_bedrock.return_value = "Very important response"

    transcript = "[Turn 1] Alice: Hello"
    search_results = []

    result = await ai_suggest_service.suggest_ideal_response(
        transcript_text=transcript,
        search_results=search_results,
        inserted_resources=None,
        scenario="trip_planning",
        contribution_type="suggestion",
        importance=0.9,  # High importance
    )

    assert result == "Very important response"
    mock_bedrock.assert_called_once()

    # Check that the prompt includes importance guidance
    call_args = mock_bedrock.call_args
    messages = call_args[0][0]
    user_message = messages[0]["content"]
    # importance=0.9 should map to "Essential or very important"
    assert "Essential" in user_message or "very important" in user_message


@pytest.mark.asyncio
@patch("app.services.ai_suggest_service._invoke_bedrock")
async def test_suggest_ideal_response_with_search_results(
    mock_bedrock: AsyncMock,
):
    """Test that search results are included in the prompt."""
    mock_bedrock.return_value = "Response grounded in search results"

    transcript = "[Turn 1] Alice: What about LLMs?"
    search_results = [
        {
            "title": "LLM Ethics Paper",
            "snippet": "A study of ethical implications...",
            "url": "https://example.com/paper1",
        },
        {
            "title": "AI Safety Survey",
            "snippet": "Comprehensive survey of AI safety...",
            "url": "https://example.com/paper2",
        },
    ]

    result = await ai_suggest_service.suggest_ideal_response(
        transcript_text=transcript,
        search_results=search_results,
        inserted_resources=None,
        scenario="scholar",
        contribution_type="heads_up",
        importance=0.75,
    )

    assert result == "Response grounded in search results"
    mock_bedrock.assert_called_once()

    # Check that search results are in the prompt
    call_args = mock_bedrock.call_args
    messages = call_args[0][0]
    user_message = messages[0]["content"]
    assert "LLM Ethics Paper" in user_message
    assert "AI Safety Survey" in user_message
    assert "https://example.com/paper1" in user_message


@pytest.mark.asyncio
@patch("app.services.ai_suggest_service._invoke_bedrock")
async def test_suggest_ideal_response_refines_existing_text(
    mock_bedrock: AsyncMock,
):
    """Test that existing_text triggers refinement mode."""
    mock_bedrock.return_value = "Refined version of draft"

    transcript = "[Turn 1] Alice: Hello"
    search_results = []

    result = await ai_suggest_service.suggest_ideal_response(
        transcript_text=transcript,
        search_results=search_results,
        inserted_resources=None,
        scenario="scholar",
        contribution_type="suggestion",
        importance=0.5,
        existing_text="User's rough draft here",
    )

    assert result == "Refined version of draft"
    mock_bedrock.assert_called_once()

    # Check that prompt includes user's draft
    call_args = mock_bedrock.call_args
    messages = call_args[0][0]
    user_message = messages[0]["content"]
    assert "User's rough draft here" in user_message
    assert "Refine" in user_message or "refine" in user_message


@pytest.mark.asyncio
@patch("app.services.ai_suggest_service._invoke_bedrock")
async def test_suggest_ideal_response_all_contribution_types(
    mock_bedrock: AsyncMock,
):
    """Test all three contribution types produce appropriate guidance."""
    mock_bedrock.return_value = "Test response"

    transcript = "[Turn 1] Test"
    contribution_types = ["heads_up", "pushback", "support", "suggestion"]

    for ctype in contribution_types:
        mock_bedrock.reset_mock()

        await ai_suggest_service.suggest_ideal_response(
            transcript_text=transcript,
            search_results=[],
            scenario="scholar",
            contribution_type=ctype,
            importance=0.5,
        )

        # Verify each type produces a different guidance string
        call_args = mock_bedrock.call_args
        messages = call_args[0][0]
        user_message = messages[0]["content"]

        if ctype == "heads_up":
            assert "Introduce a useful fact" in user_message
        elif ctype == "pushback":
            assert "Challenge or question" in user_message
        elif ctype == "support":
            assert "Confirm or back up" in user_message
        elif ctype == "suggestion":
            assert "Recommend what the group could do" in user_message


@pytest.mark.asyncio
@patch("app.services.ai_suggest_service._invoke_bedrock")
async def test_suggest_ideal_response_importance_levels(
    mock_bedrock: AsyncMock,
):
    """Test importance levels map to correct labels."""
    mock_bedrock.return_value = "Test response"

    transcript = "[Turn 1] Test"
    importance_tests = [
        (0.0, "Nice to have"),
        (0.25, "Somewhat important"),
        (0.5, "Important"),
        (0.75, "Essential or very important"),
        (1.0, "Essential or very important"),
    ]

    for importance, expected_label in importance_tests:
        mock_bedrock.reset_mock()

        await ai_suggest_service.suggest_ideal_response(
            transcript_text=transcript,
            search_results=[],
            scenario="scholar",
            contribution_type="heads_up",
            importance=importance,
        )

        call_args = mock_bedrock.call_args
        messages = call_args[0][0]
        user_message = messages[0]["content"]

        assert expected_label in user_message, f"Expected '{expected_label}' for importance={importance}"


@pytest.mark.asyncio
@patch("app.services.ai_suggest_service._invoke_bedrock")
async def test_suggest_ideal_response_without_metadata(
    mock_bedrock: AsyncMock,
):
    """Test backward compatibility: works without contribution_type and importance."""
    mock_bedrock.return_value = "Basic response"

    transcript = "[Turn 1] Alice: Hello"

    result = await ai_suggest_service.suggest_ideal_response(
        transcript_text=transcript,
        search_results=[],
        inserted_resources=None,
        scenario="scholar",
        contribution_type=None,
        importance=None,
    )

    assert result == "Basic response"
    mock_bedrock.assert_called_once()
