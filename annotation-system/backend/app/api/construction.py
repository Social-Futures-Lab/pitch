"""REST endpoints for the Construction phase (Module 1 — Phase 3)."""

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role
from app.db.session import get_db
from app.models.conversation import Conversation
from app.models.group import GroupMembership
from app.schemas.construction import (
    AIGenerateMessageRequest,
    AIGenerateMessageResponse,
    AIIntentionsRequest,
    AISourceSearchRequest,
    AISourceSearchResponse,
    AISuggestRequest,
    AISuggestResponse,
    IntentionTag,
    NextItemSuggestionsResponse,
    KnowledgeItemCreate,
    KnowledgeItemOut,
    KnowledgeItemUpdate,
    SearchQuery,
    SearchResultOut,
)
from app.services import construction_service
from app.db.base import enum_val

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_uuid(value: str, label: str = "ID") -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {label}: {value}",
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/{conv_id}/transcript")
async def get_transcript(
    conv_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "researcher")
    ),
):
    """Return the full transcript for a conversation plus the user's inline flags."""
    conversation_id = _parse_uuid(conv_id, "conversation_id")
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await construction_service.get_transcript(db, conversation_id, user_id)


@router.post(
    "/{conv_id}/items",
    response_model=KnowledgeItemOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_knowledge_item(
    conv_id: str,
    body: KnowledgeItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "researcher")
    ),
):
    """Create a new knowledge item for the conversation."""
    conversation_id = _parse_uuid(conv_id, "conversation_id")
    author_id = _parse_uuid(current_user["user_id"], "user_id")
    return await construction_service.create_knowledge_item(
        db, conversation_id, author_id, body
    )


@router.put("/items/{item_id}", response_model=KnowledgeItemOut)
async def update_knowledge_item(
    item_id: str,
    body: KnowledgeItemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "researcher")
    ),
):
    """Update an existing knowledge item (partial update, owner only)."""
    kid = _parse_uuid(item_id, "item_id")
    author_id = _parse_uuid(current_user["user_id"], "user_id")
    return await construction_service.update_knowledge_item(
        db, kid, author_id, body
    )


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_item(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "researcher")
    ),
):
    """Delete a knowledge item (owner only)."""
    kid = _parse_uuid(item_id, "item_id")
    author_id = _parse_uuid(current_user["user_id"], "user_id")
    await construction_service.delete_knowledge_item(db, kid, author_id)
    return None


@router.get("/{conv_id}/items", response_model=list[KnowledgeItemOut])
async def get_items(
    conv_id: str,
    author_id: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "researcher")
    ),
):
    """Return knowledge items for a conversation.

    If ``author_id`` query param is provided, returns that user's items;
    otherwise defaults to the current user's items.
    """
    conversation_id = _parse_uuid(conv_id, "conversation_id")
    if author_id:
        aid = _parse_uuid(author_id, "author_id")
    else:
        aid = _parse_uuid(current_user["user_id"], "user_id")
    return await construction_service.get_user_items(db, conversation_id, aid)


@router.post("/{conv_id}/web-search")
async def web_search_for_conversation(
    conv_id: str,
    body: SearchQuery,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "researcher")
    ),
):
    """Web search via Tavily — always uses web search regardless of scenario."""
    from app.services import search_service

    _parse_uuid(conv_id, "conversation_id")
    results = await search_service.search_tavily(
        body.query,
        search_service.config.get("search", {}).get("tavily_api_key", ""),
    )
    return [
        {
            "id": f"web-{i}",
            "query": body.query,
            "result_title": r.get("title", ""),
            "result_snippet": r.get("snippet", ""),
            "result_url": r.get("url", ""),
            "result_metadata": r.get("metadata"),
        }
        for i, r in enumerate(results)
    ]


@router.post("/{conv_id}/search")
async def search_for_conversation(
    conv_id: str,
    body: SearchQuery,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "researcher")
    ),
):
    """Semantic Scholar search — always uses Semantic Scholar."""
    from app.services import search_service

    _parse_uuid(conv_id, "conversation_id")
    results = await search_service.search_semantic_scholar(
        body.query,
        search_service.config.get("search", {}).get("semantic_scholar_api_key", ""),
    )
    return [
        {
            "id": f"temp-{i}",
            "query": body.query,
            "result_title": r.get("title", ""),
            "result_snippet": r.get("snippet", ""),
            "result_url": r.get("url", ""),
            "result_metadata": r.get("metadata"),
        }
        for i, r in enumerate(results)
    ]


@router.post("/{conv_id}/ai-suggest")
async def ai_suggest_for_conversation(
    conv_id: str,
    body: AISuggestRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "researcher")
    ),
):
    """Generate an AI suggestion scoped to metadata and placement window."""
    from sqlalchemy import select as sa_select
    from app.models.conversation import Conversation
    from app.models.group import Group
    from app.models.turn import Turn
    from app.services import ai_suggest_service

    conversation_id = _parse_uuid(conv_id, "conversation_id")
    conv_result = await db.execute(
        sa_select(Conversation).where(Conversation.id == conversation_id)
    )
    conv = conv_result.scalar_one_or_none()
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")

    group_result = await db.execute(
        sa_select(Group).where(Group.id == conv.group_id)
    )
    group = group_result.scalar_one_or_none()
    scenario = enum_val(group.scenario) if group and group.scenario else "scholar"

    # Fetch turns only up to window_end (scoped to placement window)
    turns_result = await db.execute(
        sa_select(Turn)
        .where(
            Turn.conversation_id == conversation_id,
            Turn.turn_number <= body.window_end
        )
        .order_by(Turn.turn_number)
    )
    turns = turns_result.scalars().all()

    from app.models.user import User
    speaker_ids = list({t.speaker_id for t in turns})
    speakers: dict = {}
    if speaker_ids:
        users_result = await db.execute(
            sa_select(User).where(User.id.in_(speaker_ids))
        )
        for u in users_result.scalars().all():
            speakers[u.id] = u.name

    transcript_text = "\n".join(
        f"[Turn {t.turn_number}] {speakers.get(t.speaker_id, 'Unknown')}: {t.text}"
        for t in turns
    )

    # Convert inserted resources to dict format for AI service
    inserted_resources_dicts = []
    if body.inserted_resources:
        for r in body.inserted_resources:
            inserted_resources_dicts.append({
                "title": r.title,
                "snippet": r.snippet or "",
                "url": r.url or "",
            })

    suggestion = await ai_suggest_service.suggest_ideal_response(
        transcript_text, [], inserted_resources_dicts, scenario,
        body.contribution_type, body.importance, body.existing_text,
        mode=body.mode,
    )
    return {"suggestion": suggestion}


@router.post("/{conv_id}/ai-intentions", response_model=list[IntentionTag])
async def generate_ai_intentions(
    conv_id: str,
    body: AIIntentionsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "researcher")
    ),
):
    """Generate AI intention tags for a placement window."""
    from sqlalchemy import select as sa_select
    from app.models.conversation import Conversation
    from app.models.group import Group
    from app.models.turn import Turn
    from app.models.user import User
    from app.services import ai_intentions_service

    conversation_id = _parse_uuid(conv_id, "conversation_id")
    conv_result = await db.execute(
        sa_select(Conversation).where(Conversation.id == conversation_id)
    )
    conv = conv_result.scalar_one_or_none()
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")

    group_result = await db.execute(
        sa_select(Group).where(Group.id == conv.group_id)
    )
    group = group_result.scalar_one_or_none()
    scenario = enum_val(group.scenario) if group and group.scenario else "scholar"

    # Fetch turns up to window_end
    turns_result = await db.execute(
        sa_select(Turn)
        .where(
            Turn.conversation_id == conversation_id,
            Turn.turn_number <= body.window_end
        )
        .order_by(Turn.turn_number)
    )
    turns = turns_result.scalars().all()

    speaker_ids = list({t.speaker_id for t in turns})
    speakers: dict = {}
    if speaker_ids:
        users_result = await db.execute(
            sa_select(User).where(User.id.in_(speaker_ids))
        )
        for u in users_result.scalars().all():
            speakers[u.id] = u.name

    transcript_text = "\n".join(
        f"[Turn {t.turn_number}] {speakers.get(t.speaker_id, 'Unknown')}: {t.text}"
        for t in turns
    )

    tags = await ai_intentions_service.generate_intentions(
        transcript_text, body.window_start, body.window_end, body.best_turn, scenario
    )
    return tags


@router.post("/{conv_id}/ai-source-search", response_model=AISourceSearchResponse)
async def ai_source_search(
    conv_id: str,
    body: AISourceSearchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "researcher")
    ),
):
    """AI-driven source discovery: generates queries, searches, curates results."""
    import asyncio
    from sqlalchemy import select as sa_select
    from app.models.conversation import Conversation
    from app.models.group import Group
    from app.models.turn import Turn
    from app.models.user import User
    from app.services import ai_suggest_service, search_service

    conversation_id = _parse_uuid(conv_id, "conversation_id")
    conv_result = await db.execute(
        sa_select(Conversation).where(Conversation.id == conversation_id)
    )
    conv = conv_result.scalar_one_or_none()
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")

    group_result = await db.execute(
        sa_select(Group).where(Group.id == conv.group_id)
    )
    group = group_result.scalar_one_or_none()
    scenario = enum_val(group.scenario) if group and group.scenario else "scholar"

    # Build transcript
    turns_result = await db.execute(
        sa_select(Turn)
        .where(
            Turn.conversation_id == conversation_id,
            Turn.turn_number <= body.window_end
        )
        .order_by(Turn.turn_number)
    )
    turns = turns_result.scalars().all()

    speaker_ids = list({t.speaker_id for t in turns})
    speakers: dict = {}
    if speaker_ids:
        users_result = await db.execute(
            sa_select(User).where(User.id.in_(speaker_ids))
        )
        for u in users_result.scalars().all():
            speakers[u.id] = u.name

    transcript_text = "\n".join(
        f"[Turn {t.turn_number}] {speakers.get(t.speaker_id, 'Unknown')}: {t.text}"
        for t in turns
    )

    # Generate search queries via AI
    queries = await ai_suggest_service.generate_search_queries(
        transcript_text, body.intention_tag, body.contribution_type, scenario
    )

    # Execute searches in parallel
    search_config = search_service.config.get("search", {})
    scholar_key = search_config.get("semantic_scholar_api_key", "")
    tavily_key = search_config.get("tavily_api_key", "")

    async def run_search(q: dict) -> list[dict]:
        try:
            if q["search_type"] == "scholar":
                return await search_service.search_semantic_scholar(q["query"], scholar_key)
            else:
                return await search_service.search_tavily(q["query"], tavily_key)
        except Exception:
            return []

    search_tasks = [run_search(q) for q in queries]
    all_results = await asyncio.gather(*search_tasks)

    # Deduplicate by URL/title and format
    seen_keys: set[str] = set()
    formatted_results = []
    for i, (query_info, results) in enumerate(zip(queries, all_results)):
        for j, r in enumerate(results):
            key = r.get("url") or r.get("title", f"result-{i}-{j}")
            if key in seen_keys:
                continue
            seen_keys.add(key)
            formatted_results.append({
                "id": f"ai-{i}-{j}",
                "query": query_info["query"],
                "result_title": r.get("title", ""),
                "result_snippet": r.get("snippet", ""),
                "result_url": r.get("url", ""),
                "result_metadata": r.get("metadata"),
            })

    queries_used = [q["query"] for q in queries]
    return {"queries_used": queries_used, "results": formatted_results[:15]}


@router.post("/{conv_id}/ai-generate-message", response_model=AIGenerateMessageResponse)
async def ai_generate_message(
    conv_id: str,
    body: AIGenerateMessageRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "researcher")
    ),
):
    """Full AI message generation from all context, with follow-up support."""
    from sqlalchemy import select as sa_select
    from app.models.conversation import Conversation
    from app.models.group import Group
    from app.models.turn import Turn
    from app.models.user import User
    from app.services import ai_suggest_service

    conversation_id = _parse_uuid(conv_id, "conversation_id")
    conv_result = await db.execute(
        sa_select(Conversation).where(Conversation.id == conversation_id)
    )
    conv = conv_result.scalar_one_or_none()
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")

    group_result = await db.execute(
        sa_select(Group).where(Group.id == conv.group_id)
    )
    group = group_result.scalar_one_or_none()
    scenario = enum_val(group.scenario) if group and group.scenario else "scholar"

    # Fetch turns up to window_end
    turns_result = await db.execute(
        sa_select(Turn)
        .where(
            Turn.conversation_id == conversation_id,
            Turn.turn_number <= body.window_end
        )
        .order_by(Turn.turn_number)
    )
    turns = turns_result.scalars().all()

    speaker_ids = list({t.speaker_id for t in turns})
    speakers: dict = {}
    if speaker_ids:
        users_result = await db.execute(
            sa_select(User).where(User.id.in_(speaker_ids))
        )
        for u in users_result.scalars().all():
            speakers[u.id] = u.name

    transcript_text = "\n".join(
        f"[Turn {t.turn_number}] {speakers.get(t.speaker_id, 'Unknown')}: {t.text}"
        for t in turns
    )

    # Convert inserted resources
    inserted_resources_dicts = []
    if body.inserted_resources:
        for r in body.inserted_resources:
            inserted_resources_dicts.append({
                "title": r.title,
                "snippet": r.snippet or "",
                "url": r.url or "",
            })

    message = await ai_suggest_service.generate_full_message(
        transcript_text=transcript_text,
        intention_tag=body.intention_tag,
        contribution_type=body.contribution_type,
        pertinence=body.pertinence,
        inserted_resources=inserted_resources_dicts or None,
        scenario=scenario,
        follow_up_prompt=body.follow_up_prompt,
        previous_messages=body.previous_messages,
    )
    return {"message": message}


@router.post("/items/{item_id}/search", response_model=list[SearchResultOut])
async def search_for_item(
    item_id: str,
    body: SearchQuery,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "researcher")
    ),
):
    """Execute a search query for a knowledge item and persist results."""
    kid = _parse_uuid(item_id, "item_id")
    user_id = _parse_uuid(current_user["user_id"], "user_id")

    # Determine scenario from the item's conversation group
    from sqlalchemy import select as sa_select

    from app.models.conversation import Conversation
    from app.models.group import Group
    from app.models.knowledge_item import KnowledgeItem

    item_result = await db.execute(
        sa_select(KnowledgeItem).where(KnowledgeItem.id == kid)
    )
    item = item_result.scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Knowledge item not found",
        )

    conv_result = await db.execute(
        sa_select(Conversation).where(Conversation.id == item.conversation_id)
    )
    conv = conv_result.scalar_one_or_none()
    if conv is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    group_result = await db.execute(
        sa_select(Group).where(Group.id == conv.group_id)
    )
    group = group_result.scalar_one_or_none()
    scenario = enum_val(group.scenario) if group and group.scenario else "scholar"

    return await construction_service.search_for_item(
        db, kid, body.query, scenario
    )


@router.get("/items/{item_id}/searches", response_model=list[SearchResultOut])
async def get_item_searches(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "researcher")
    ),
):
    """Return the search history for a knowledge item."""
    kid = _parse_uuid(item_id, "item_id")
    return await construction_service.get_item_searches(db, kid)


@router.post("/items/{item_id}/ai-suggest", response_model=AISuggestResponse)
async def ai_suggest(
    item_id: str,
    body: AISuggestRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "researcher")
    ),
):
    """Generate an AI-suggested ideal response for a knowledge item."""
    kid = _parse_uuid(item_id, "item_id")
    user_id = _parse_uuid(current_user["user_id"], "user_id")

    # Look up the conversation_id from the item
    from sqlalchemy import select as sa_select

    from app.models.knowledge_item import KnowledgeItem

    item_result = await db.execute(
        sa_select(KnowledgeItem).where(KnowledgeItem.id == kid)
    )
    item = item_result.scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Knowledge item not found",
        )

    suggestion = await construction_service.ai_suggest(
        db,
        item.conversation_id,
        kid,
        user_id,
        body.context_turns,
        body.existing_text,
    )
    return AISuggestResponse(suggestion=suggestion)


@router.post("/{conv_id}/next-item-suggestions", response_model=NextItemSuggestionsResponse)
async def get_next_item_suggestions(
    conv_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "researcher")
    ),
):
    """Generate AI suggestions for the user's next knowledge item.

    Samples random segments from the transcript and asks AI to identify
    substantive ones with potential directions. Includes existing items
    context to avoid overlap and increase variety.
    """
    from sqlalchemy import select as sa_select
    from app.models.knowledge_item import KnowledgeItem
    from app.models.inline_annotation import InlineAnnotation
    from app.models.turn import Turn
    from app.models.user import User
    from app.services import ai_intentions_service

    conversation_id = _parse_uuid(conv_id, "conversation_id")
    user_id = _parse_uuid(current_user["user_id"], "user_id")

    # Fetch all turns
    turns_result = await db.execute(
        sa_select(Turn)
        .where(Turn.conversation_id == conversation_id)
        .order_by(Turn.turn_number)
    )
    turns = turns_result.scalars().all()
    if not turns:
        return {"suggestions": []}

    # Build transcript lines with turn numbers
    speaker_ids = list({t.speaker_id for t in turns})
    speakers: dict = {}
    if speaker_ids:
        users_result = await db.execute(
            sa_select(User).where(User.id.in_(speaker_ids))
        )
        for u in users_result.scalars().all():
            speakers[u.id] = u.name

    transcript_lines = [
        f"[Turn {t.turn_number}] {speakers.get(t.speaker_id, 'Unknown')}: {t.text}"
        for t in turns
    ]

    # Fetch user's bookmarked turns (for segment sampling priority)
    flags_result = await db.execute(
        sa_select(InlineAnnotation).where(
            InlineAnnotation.conversation_id == conversation_id,
            InlineAnnotation.participant_id == user_id,
        )
    )
    flags = flags_result.scalars().all()
    turn_id_to_number = {t.id: t.turn_number for t in turns}
    bookmarked_turn_numbers = [
        turn_id_to_number[f.turn_id]
        for f in flags
        if f.turn_id in turn_id_to_number
    ]

    # Fetch user's existing items to pass as context for variety
    items_result = await db.execute(
        sa_select(KnowledgeItem)
        .where(
            KnowledgeItem.conversation_id == conversation_id,
            KnowledgeItem.author_id == user_id,
        )
        .order_by(KnowledgeItem.created_at)
    )
    existing_items = items_result.scalars().all()

    # Build turn number map for existing items
    turn_ids: set = set()
    for item in existing_items:
        turn_ids.add(item.window_start_id)
        turn_ids.add(item.window_end_id)
    turn_number_map: dict = {}
    if turn_ids:
        tn_result = await db.execute(
            sa_select(Turn).where(Turn.id.in_(list(turn_ids)))
        )
        for t in tn_result.scalars().all():
            turn_number_map[t.id] = t.turn_number

    existing_items_context = []
    for item in existing_items:
        start_tn = turn_number_map.get(item.window_start_id, "?")
        end_tn = turn_number_map.get(item.window_end_id, "?")
        detail = item.contribution_type_detail or enum_val(item.contribution_type)
        existing_items_context.append(
            f"- \"{detail}\" (turns {start_tn}–{end_tn})"
        )

    suggestions = await ai_intentions_service.generate_next_item_suggestions(
        transcript_lines, existing_items_context,
        bookmarked_turn_numbers=bookmarked_turn_numbers or None,
    )
    return {"suggestions": suggestions}


@router.post("/{conv_id}/mark-done")
async def mark_construction_done(
    conv_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "researcher")
    ),
):
    """Mark the current user as done with construction for this conversation."""
    conversation_id = _parse_uuid(conv_id, "conversation_id")
    user_id = _parse_uuid(current_user["user_id"], "user_id")

    conv_result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id)
    )
    conv = conv_result.scalar_one_or_none()
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")

    membership_result = await db.execute(
        select(GroupMembership).where(
            GroupMembership.group_id == conv.group_id,
            GroupMembership.user_id == user_id,
        )
    )
    membership = membership_result.scalar_one_or_none()
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this group")

    membership.construction_done_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    return {"status": "done"}


@router.delete("/{conv_id}/mark-done")
async def unmark_construction_done(
    conv_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "researcher")
    ),
):
    """Unmark the current user as done (they want to add more items)."""
    conversation_id = _parse_uuid(conv_id, "conversation_id")
    user_id = _parse_uuid(current_user["user_id"], "user_id")

    conv_result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id)
    )
    conv = conv_result.scalar_one_or_none()
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")

    membership_result = await db.execute(
        select(GroupMembership).where(
            GroupMembership.group_id == conv.group_id,
            GroupMembership.user_id == user_id,
        )
    )
    membership = membership_result.scalar_one_or_none()
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this group")

    membership.construction_done_at = None
    await db.commit()
    return {"status": "undone"}
