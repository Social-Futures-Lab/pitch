"""Business logic for the Construction phase (Module 1 — Phase 3)."""

import logging
import uuid
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Conversation
from app.models.enums import ContributionType, ItemSource, ReviewStatus
from app.models.group import Group, GroupMembership
from app.models.inline_annotation import InlineAnnotation
from app.models.knowledge_item import KnowledgeItem
from app.models.search_result import SearchResult
from app.models.turn import Turn
from app.models.user import User
from app.schemas.construction import KnowledgeItemCreate, KnowledgeItemUpdate
from app.services import ai_suggest_service, search_service
from app.db.base import enum_val

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _resolve_turn_number(
    db: AsyncSession, conversation_id: uuid.UUID, turn_number: int
) -> Turn:
    """Look up a Turn by conversation + turn_number.  Raises 404 if not found."""
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


async def _verify_membership(
    db: AsyncSession, conversation_id: uuid.UUID, user_id: uuid.UUID
) -> Conversation:
    """Verify that the user belongs to the conversation's group.

    Returns the Conversation ORM object.  Raises 404/403 on failure.
    """
    result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id)
    )
    conversation = result.scalar_one_or_none()
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    membership_result = await db.execute(
        select(GroupMembership).where(
            GroupMembership.group_id == conversation.group_id,
            GroupMembership.user_id == user_id,
        )
    )
    if membership_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this conversation's group",
        )
    return conversation


async def _get_group_for_conversation(
    db: AsyncSession, conversation_id: uuid.UUID
) -> Group:
    """Return the Group associated with a conversation."""
    result = await db.execute(
        select(Group)
        .join(Conversation, Conversation.group_id == Group.id)
        .where(Conversation.id == conversation_id)
    )
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found for conversation",
        )
    return group


def _item_to_dict(
    item: KnowledgeItem,
    window_start_number: int,
    window_end_number: int,
    best_turn_number: int,
) -> dict[str, Any]:
    """Serialize a KnowledgeItem to a dict matching KnowledgeItemOut."""
    return {
        "id": str(item.id),
        "conversation_id": str(item.conversation_id),
        "author_id": str(item.author_id),
        "raw_ideal_response": item.raw_ideal_response,
        "neutralized_ideal_response": item.neutralized_ideal_response,
        "ai_suggestion_used": item.ai_suggestion_used,
        "window_start_turn_number": window_start_number,
        "window_end_turn_number": window_end_number,
        "best_turn_number": best_turn_number,
        "contribution_type": enum_val(item.contribution_type),
        "contribution_type_detail": item.contribution_type_detail,
        "pertinence": item.pertinence,
        "notes": item.notes,
        "inserted_resources": item.inserted_resources,
        "ai_interaction_log": item.ai_interaction_log,
        "source": enum_val(item.source),
        "review_status": enum_val(item.review_status),
        "created_at": item.created_at,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def get_transcript(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Return the full transcript with turns and the user's inline flags."""
    await _verify_membership(db, conversation_id, user_id)

    # Fetch turns ordered by turn_number
    turns_result = await db.execute(
        select(Turn)
        .where(Turn.conversation_id == conversation_id)
        .order_by(Turn.turn_number)
    )
    turns = turns_result.scalars().all()

    # Fetch user's inline annotations (flags) for this conversation
    flags_result = await db.execute(
        select(InlineAnnotation).where(
            InlineAnnotation.conversation_id == conversation_id,
            InlineAnnotation.participant_id == user_id,
        )
    )
    flags = flags_result.scalars().all()
    flagged_turn_ids = {str(f.turn_id) for f in flags}

    # Fetch speaker names for all unique speaker_ids in turns
    speaker_ids = list({t.speaker_id for t in turns})
    speakers: dict[uuid.UUID, str] = {}
    if speaker_ids:
        users_result = await db.execute(
            select(User).where(User.id.in_(speaker_ids))
        )
        for u in users_result.scalars().all():
            speakers[u.id] = u.name

    turn_dicts = []
    for t in turns:
        turn_dicts.append(
            {
                "id": str(t.id),
                "turn_number": t.turn_number,
                "speaker_id": str(t.speaker_id),
                "speaker_name": speakers.get(t.speaker_id, "Unknown"),
                "text": t.text,
                "timestamp": t.timestamp.isoformat() if t.timestamp else None,
                "flagged": str(t.id) in flagged_turn_ids,
            }
        )

    return {
        "conversation_id": str(conversation_id),
        "turns": turn_dicts,
    }


async def create_knowledge_item(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    author_id: uuid.UUID,
    item_data: KnowledgeItemCreate,
) -> dict[str, Any]:
    """Validate and create a new KnowledgeItem."""
    await _verify_membership(db, conversation_id, author_id)

    # Validate window ordering
    if item_data.window_start_turn_number > item_data.window_end_turn_number:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="window_start_turn_number must be <= window_end_turn_number",
        )

    # Validate best_turn within window
    if not (
        item_data.window_start_turn_number
        <= item_data.best_turn_number
        <= item_data.window_end_turn_number
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="best_turn_number must be within the window range",
        )

    # Validate response not empty
    if not item_data.raw_ideal_response.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="raw_ideal_response must not be empty",
        )

    # Resolve turn numbers to turn IDs
    window_start = await _resolve_turn_number(
        db, conversation_id, item_data.window_start_turn_number
    )
    window_end = await _resolve_turn_number(
        db, conversation_id, item_data.window_end_turn_number
    )
    best_turn = await _resolve_turn_number(
        db, conversation_id, item_data.best_turn_number
    )

    item = KnowledgeItem(
        conversation_id=conversation_id,
        author_id=author_id,
        raw_ideal_response=item_data.raw_ideal_response,
        ai_suggestion_used=item_data.ai_suggestion_used,
        ai_suggestion_text=item_data.ai_suggestion_text,
        window_start_id=window_start.id,
        window_end_id=window_end.id,
        best_turn_id=best_turn.id,
        contribution_type=ContributionType(item_data.contribution_type),
        contribution_type_detail=item_data.contribution_type_detail,
        pertinence=item_data.pertinence,
        notes=item_data.notes,
        source=ItemSource.participant,
        inserted_resources=item_data.inserted_resources,
        ai_interaction_log=item_data.ai_interaction_log,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)

    return _item_to_dict(
        item,
        item_data.window_start_turn_number,
        item_data.window_end_turn_number,
        item_data.best_turn_number,
    )


async def update_knowledge_item(
    db: AsyncSession,
    item_id: uuid.UUID,
    author_id: uuid.UUID,
    update_data: KnowledgeItemUpdate,
) -> dict[str, Any]:
    """Partial update of a KnowledgeItem.  Validates ownership."""
    result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == item_id)
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Knowledge item not found",
        )
    if item.author_id != author_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only update your own knowledge items",
        )

    # Collect the fields being updated to determine final window/best values
    update_fields = update_data.model_dump(exclude_unset=True)
    if not update_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update",
        )

    # We need current turn numbers for validation if partially updating window
    # Fetch current turn numbers from existing turn IDs
    current_turns: dict[str, int] = {}
    for attr, fk_attr in [
        ("window_start_turn_number", "window_start_id"),
        ("window_end_turn_number", "window_end_id"),
        ("best_turn_number", "best_turn_id"),
    ]:
        turn_id = getattr(item, fk_attr)
        t_result = await db.execute(select(Turn).where(Turn.id == turn_id))
        t = t_result.scalar_one()
        current_turns[attr] = t.turn_number

    # Merge with incoming updates
    final_start = update_fields.get(
        "window_start_turn_number", current_turns["window_start_turn_number"]
    )
    final_end = update_fields.get(
        "window_end_turn_number", current_turns["window_end_turn_number"]
    )
    final_best = update_fields.get(
        "best_turn_number", current_turns["best_turn_number"]
    )

    # Validate window ordering
    if final_start > final_end:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="window_start_turn_number must be <= window_end_turn_number",
        )
    if not (final_start <= final_best <= final_end):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="best_turn_number must be within the window range",
        )

    # Validate non-empty response if provided
    if "raw_ideal_response" in update_fields:
        if not update_fields["raw_ideal_response"].strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="raw_ideal_response must not be empty",
            )
        if item.raw_ideal_response != update_fields["raw_ideal_response"]:
            item.raw_ideal_response = update_fields["raw_ideal_response"]
            item.neutralized_ideal_response = None
            item.review_status = ReviewStatus.pending

    # Resolve and set turn IDs for any turn number changes
    if "window_start_turn_number" in update_fields:
        turn = await _resolve_turn_number(
            db, item.conversation_id, update_fields["window_start_turn_number"]
        )
        item.window_start_id = turn.id

    if "window_end_turn_number" in update_fields:
        turn = await _resolve_turn_number(
            db, item.conversation_id, update_fields["window_end_turn_number"]
        )
        item.window_end_id = turn.id

    if "best_turn_number" in update_fields:
        turn = await _resolve_turn_number(
            db, item.conversation_id, update_fields["best_turn_number"]
        )
        item.best_turn_id = turn.id

    if "contribution_type" in update_fields:
        item.contribution_type = ContributionType(update_fields["contribution_type"])

    if "contribution_type_detail" in update_fields:
        item.contribution_type_detail = update_fields["contribution_type_detail"]

    if "pertinence" in update_fields:
        item.pertinence = update_fields["pertinence"]

    if "notes" in update_fields:
        item.notes = update_fields["notes"]

    if "inserted_resources" in update_fields:
        item.inserted_resources = update_fields["inserted_resources"]

    if "ai_interaction_log" in update_fields:
        item.ai_interaction_log = update_fields["ai_interaction_log"]

    await db.commit()
    await db.refresh(item)

    return _item_to_dict(item, final_start, final_end, final_best)


async def get_user_items(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    author_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """Return all knowledge items for a user in a conversation, with turn numbers."""
    result = await db.execute(
        select(KnowledgeItem)
        .where(
            KnowledgeItem.conversation_id == conversation_id,
            KnowledgeItem.author_id == author_id,
        )
        .order_by(KnowledgeItem.created_at)
    )
    items = result.scalars().all()

    # Batch-resolve turn IDs to turn numbers
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

    output = []
    for item in items:
        output.append(
            _item_to_dict(
                item,
                turn_number_map.get(item.window_start_id, 0),
                turn_number_map.get(item.window_end_id, 0),
                turn_number_map.get(item.best_turn_id, 0),
            )
        )
    return output


async def search_for_item(
    db: AsyncSession,
    item_id: uuid.UUID,
    query: str,
    scenario: str,
) -> list[dict[str, Any]]:
    """Run a search for a knowledge item and persist the results."""
    # Verify item exists
    item_result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == item_id)
    )
    item = item_result.scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Knowledge item not found",
        )

    # Execute search
    try:
        raw_results = await search_service.search(query, scenario)
    except Exception as exc:
        logger.error("Search failed for item %s: %s", item_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Search service error: {str(exc)}",
        )

    # Persist results
    persisted: list[dict[str, Any]] = []
    for r in raw_results:
        sr = SearchResult(
            knowledge_item_id=item_id,
            query=query,
            result_title=r.get("title", "Untitled"),
            result_snippet=r.get("snippet"),
            result_url=r.get("url"),
            result_metadata=r.get("metadata"),
        )
        db.add(sr)
        await db.flush()
        await db.refresh(sr)
        persisted.append(
            {
                "id": str(sr.id),
                "query": sr.query,
                "result_title": sr.result_title,
                "result_snippet": sr.result_snippet,
                "result_url": sr.result_url,
                "result_metadata": sr.result_metadata,
            }
        )

    await db.commit()
    return persisted


async def get_item_searches(
    db: AsyncSession,
    item_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """Return all search results associated with a knowledge item."""
    # Verify item exists
    item_result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == item_id)
    )
    if item_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Knowledge item not found",
        )

    result = await db.execute(
        select(SearchResult)
        .where(SearchResult.knowledge_item_id == item_id)
        .order_by(SearchResult.created_at)
    )
    records = result.scalars().all()

    return [
        {
            "id": str(sr.id),
            "query": sr.query,
            "result_title": sr.result_title,
            "result_snippet": sr.result_snippet,
            "result_url": sr.result_url,
            "result_metadata": sr.result_metadata,
        }
        for sr in records
    ]


async def ai_suggest(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    item_id: uuid.UUID,
    user_id: uuid.UUID,
    context_turns: Optional[list[int]] = None,
    existing_text: Optional[str] = None,
) -> str:
    """Generate an AI-suggested ideal response for a knowledge item.

    Uses the conversation transcript (optionally filtered to specific turns)
    plus any existing search results for the item as LLM context.
    If *existing_text* is provided the LLM refines the draft instead of
    generating from scratch.
    """
    await _verify_membership(db, conversation_id, user_id)

    # Verify item exists and belongs to this conversation
    item_result = await db.execute(
        select(KnowledgeItem).where(
            KnowledgeItem.id == item_id,
            KnowledgeItem.conversation_id == conversation_id,
        )
    )
    if item_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Knowledge item not found in this conversation",
        )

    # Build transcript text
    turns_query = select(Turn).where(
        Turn.conversation_id == conversation_id
    )
    if context_turns:
        turns_query = turns_query.where(Turn.turn_number.in_(context_turns))
    turns_query = turns_query.order_by(Turn.turn_number)

    turns_result = await db.execute(turns_query)
    turns = turns_result.scalars().all()

    if not turns:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No turns found for the given context",
        )

    # Fetch speaker names
    speaker_ids = list({t.speaker_id for t in turns})
    speakers: dict[uuid.UUID, str] = {}
    if speaker_ids:
        users_result = await db.execute(
            select(User).where(User.id.in_(speaker_ids))
        )
        for u in users_result.scalars().all():
            speakers[u.id] = u.name

    transcript_lines = []
    for t in turns:
        name = speakers.get(t.speaker_id, "Unknown")
        transcript_lines.append(f"[Turn {t.turn_number}] {name}: {t.text}")
    transcript_text = "\n".join(transcript_lines)

    # Gather existing search results for context
    sr_result = await db.execute(
        select(SearchResult).where(SearchResult.knowledge_item_id == item_id)
    )
    search_records = sr_result.scalars().all()
    search_dicts = [
        {
            "title": sr.result_title,
            "snippet": sr.result_snippet,
            "url": sr.result_url,
        }
        for sr in search_records
    ]

    # Get scenario from group
    group = await _get_group_for_conversation(db, conversation_id)
    scenario = enum_val(group.scenario) if group.scenario else "scholar"

    try:
        suggestion = await ai_suggest_service.suggest_ideal_response(
            transcript_text=transcript_text,
            search_results=search_dicts,
            inserted_resources=None,
            scenario=scenario,
            existing_text=existing_text,
        )
    except Exception as exc:
        logger.error("AI suggestion failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI suggestion service error: {str(exc)}",
        )

    return suggestion


async def delete_knowledge_item(
    db: AsyncSession,
    item_id: uuid.UUID,
    author_id: uuid.UUID,
) -> None:
    """Delete a knowledge item. Validates ownership."""
    result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == item_id)
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Knowledge item not found",
        )
    if item.author_id != author_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own knowledge items",
        )

    await db.delete(item)
    await db.commit()
