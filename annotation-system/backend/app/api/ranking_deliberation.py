"""REST endpoints for the Ranking Deliberation phase."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Any

from app.core.dependencies import require_role
from app.db.session import get_db
from app.services import ranking_deliberation_service

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class RankingRevisionItem(BaseModel):
    knowledge_item_id: str
    rank: int
    chosen_best_turn_number: int


class RankingRevisionCreate(BaseModel):
    ranked_items: list[RankingRevisionItem]


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


@router.get("/excerpts")
async def get_ranking_deliberation_excerpts(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Return excerpts that have rankings ready for deliberation."""
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await ranking_deliberation_service.get_ranking_deliberation_excerpts(db, user_id)


@router.get("/excerpts/{excerpt_id}/peers")
async def get_peer_rankings(
    excerpt_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Get anonymized peer rankings for an excerpt."""
    eid = _parse_uuid(excerpt_id, "excerpt_id")
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await ranking_deliberation_service.get_peer_rankings(db, eid, user_id)


@router.post("/excerpts/{excerpt_id}/revise")
async def save_ranking_revision(
    excerpt_id: str,
    body: RankingRevisionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Save a deliberation-phase ranking revision."""
    eid = _parse_uuid(excerpt_id, "excerpt_id")
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    ranked_items = [ri.model_dump() for ri in body.ranked_items]
    return await ranking_deliberation_service.save_ranking_revision(
        db, eid, user_id, ranked_items
    )


@router.get("/progress")
async def get_progress(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Return ranking deliberation progress for the current user."""
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await ranking_deliberation_service.get_progress(db, user_id)


@router.post("/complete")
async def mark_complete(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Mark ranking deliberation as complete for the current user."""
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await ranking_deliberation_service.mark_complete(db, user_id)


@router.get("/group-progress")
async def get_group_progress(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Get ranking deliberation completion status for all group members."""
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await ranking_deliberation_service.get_group_progress(db, user_id)
