"""Business logic for transcript excerpt generation (Module 2 — Phase 4)."""

import logging
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge_item import KnowledgeItem
from app.models.transcript_excerpt import TranscriptExcerpt
from app.models.turn import Turn
from app.models.user import User
from app.db.base import enum_val

logger = logging.getLogger(__name__)

# Number of turns to include in an excerpt window around the knowledge item
EXCERPT_CONTEXT_TURNS = 15


async def generate_excerpt(
    db: AsyncSession,
    knowledge_item_id: uuid.UUID,
) -> TranscriptExcerpt:
    """Auto-generate a TranscriptExcerpt centred around a knowledge item's window.

    The excerpt covers approximately EXCERPT_CONTEXT_TURNS turns, centred on
    the mid-point of the item's placement window (window_start, window_end).
    If the resulting range extends beyond the conversation boundaries, it is
    clamped to the available turns.

    Returns the newly created TranscriptExcerpt ORM object.
    """

    # ── Fetch the knowledge item ──────────────────────────────────────────
    result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == knowledge_item_id)
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Knowledge item not found",
        )

    # Check if an excerpt already exists for this item
    existing = await db.execute(
        select(TranscriptExcerpt).where(
            TranscriptExcerpt.knowledge_item_id == knowledge_item_id
        )
    )
    if (exc := existing.scalars().first()) is not None:
        return exc

    conversation_id = item.conversation_id

    # ── Resolve the item's window turn numbers ────────────────────────────
    ws_result = await db.execute(select(Turn).where(Turn.id == item.window_start_id))
    window_start_turn = ws_result.scalar_one()

    we_result = await db.execute(select(Turn).where(Turn.id == item.window_end_id))
    window_end_turn = we_result.scalar_one()

    window_mid = (window_start_turn.turn_number + window_end_turn.turn_number) // 2

    # ── Determine conversation boundaries ─────────────────────────────────
    min_max = await db.execute(
        select(
            func.min(Turn.turn_number),
            func.max(Turn.turn_number),
        ).where(Turn.conversation_id == conversation_id)
    )
    row = min_max.one()
    conv_min_turn: int = row[0]
    conv_max_turn: int = row[1]

    # ── Calculate excerpt range ───────────────────────────────────────────
    half = EXCERPT_CONTEXT_TURNS // 2
    raw_start = window_mid - half
    raw_end = window_mid + half

    # Always include the full item window
    raw_start = min(raw_start, window_start_turn.turn_number)
    raw_end = max(raw_end, window_end_turn.turn_number)

    # Clamp to conversation boundaries
    excerpt_start_num = max(raw_start, conv_min_turn)
    excerpt_end_num = min(raw_end, conv_max_turn)

    # ── Resolve start/end turn IDs ────────────────────────────────────────
    start_turn = await _resolve_turn_by_number(
        db, conversation_id, excerpt_start_num
    )
    end_turn = await _resolve_turn_by_number(
        db, conversation_id, excerpt_end_num
    )

    # ── Build placeholder context summaries ───────────────────────────────
    preceding_summary: str | None = None
    if excerpt_start_num > conv_min_turn:
        preceding_summary = (
            f"[Preceding context: turns {conv_min_turn}–{excerpt_start_num - 1} "
            f"omitted. Summary to be generated.]"
        )

    following_summary: str | None = None
    if excerpt_end_num < conv_max_turn:
        following_summary = (
            f"[Following context: turns {excerpt_end_num + 1}–{conv_max_turn} "
            f"omitted. Summary to be generated.]"
        )

    # ── Persist ───────────────────────────────────────────────────────────
    excerpt = TranscriptExcerpt(
        conversation_id=conversation_id,
        knowledge_item_id=knowledge_item_id,
        start_turn_id=start_turn.id,
        end_turn_id=end_turn.id,
        preceding_context_summary=preceding_summary,
        following_context_summary=following_summary,
    )
    db.add(excerpt)
    await db.commit()
    await db.refresh(excerpt)

    logger.info(
        "Generated excerpt %s for item %s (turns %d–%d)",
        excerpt.id,
        knowledge_item_id,
        excerpt_start_num,
        excerpt_end_num,
    )
    return excerpt


async def get_excerpt_with_turns(
    db: AsyncSession,
    excerpt_id: uuid.UUID,
) -> dict[str, Any]:
    """Return a full excerpt payload with turns, speaker info, and the
    neutralised knowledge item.

    Raises 404 if the excerpt does not exist.
    """

    # ── Fetch excerpt ─────────────────────────────────────────────────────
    result = await db.execute(
        select(TranscriptExcerpt).where(TranscriptExcerpt.id == excerpt_id)
    )
    excerpt = result.scalar_one_or_none()
    if excerpt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Excerpt not found",
        )

    # ── Resolve start / end turn numbers ──────────────────────────────────
    st_result = await db.execute(select(Turn).where(Turn.id == excerpt.start_turn_id))
    start_turn = st_result.scalar_one()

    et_result = await db.execute(select(Turn).where(Turn.id == excerpt.end_turn_id))
    end_turn = et_result.scalar_one()

    # ── Fetch all turns in range ──────────────────────────────────────────
    turns_result = await db.execute(
        select(Turn)
        .where(
            Turn.conversation_id == excerpt.conversation_id,
            Turn.turn_number >= start_turn.turn_number,
            Turn.turn_number <= end_turn.turn_number,
        )
        .order_by(Turn.turn_number)
    )
    turns = turns_result.scalars().all()

    # ── Resolve speaker names ─────────────────────────────────────────────
    speaker_ids = list({t.speaker_id for t in turns})
    speakers: dict[uuid.UUID, str] = {}
    if speaker_ids:
        users_result = await db.execute(
            select(User).where(User.id.in_(speaker_ids))
        )
        for u in users_result.scalars().all():
            speakers[u.id] = u.name

    turn_dicts: list[dict[str, Any]] = []
    for t in turns:
        turn_dicts.append(
            {
                "id": str(t.id),
                "turn_number": t.turn_number,
                "speaker_id": str(t.speaker_id),
                "speaker_name": speakers.get(t.speaker_id, "Unknown"),
                "text": t.text,
                "timestamp": t.timestamp.isoformat() if t.timestamp else None,
            }
        )

    # ── Fetch the neutralised knowledge item ──────────────────────────────
    ki_result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == excerpt.knowledge_item_id)
    )
    ki = ki_result.scalar_one()

    # Resolve the item's window turn numbers for reference
    ki_ws_result = await db.execute(select(Turn).where(Turn.id == ki.window_start_id))
    ki_ws_turn = ki_ws_result.scalar_one()
    ki_we_result = await db.execute(select(Turn).where(Turn.id == ki.window_end_id))
    ki_we_turn = ki_we_result.scalar_one()
    ki_bt_result = await db.execute(select(Turn).where(Turn.id == ki.best_turn_id))
    ki_bt_turn = ki_bt_result.scalar_one()

    knowledge_item_dict: dict[str, Any] = {
        "id": str(ki.id),
        "conversation_id": str(ki.conversation_id),
        "contribution_type": enum_val(ki.contribution_type),
        "neutralized_ideal_response": ki.neutralized_ideal_response,
        "window_start_turn_number": ki_ws_turn.turn_number,
        "window_end_turn_number": ki_we_turn.turn_number,
        "best_turn_number": ki_bt_turn.turn_number,
        "pertinence": ki.pertinence,
        # Intentionally omit author_id and raw_ideal_response for neutrality
    }

    # ── Conversation turn range ────────────────────────────────────────
    min_max = await db.execute(
        select(
            func.min(Turn.turn_number),
            func.max(Turn.turn_number),
        ).where(Turn.conversation_id == excerpt.conversation_id)
    )
    range_row = min_max.one()

    return {
        "id": str(excerpt.id),
        "conversation_id": str(excerpt.conversation_id),
        "knowledge_item_id": str(excerpt.knowledge_item_id),
        "start_turn_number": start_turn.turn_number,
        "end_turn_number": end_turn.turn_number,
        "conversation_min_turn": range_row[0],
        "conversation_max_turn": range_row[1],
        "preceding_context_summary": excerpt.preceding_context_summary,
        "following_context_summary": excerpt.following_context_summary,
        "turns": turn_dicts,
        "knowledge_item": knowledge_item_dict,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _resolve_turn_by_number(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    turn_number: int,
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
