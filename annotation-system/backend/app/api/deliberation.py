"""REST endpoints for the Deliberation phase (Phase 5a)."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role
from app.db.session import get_db
from app.schemas.deliberation import (
    PeersResponse,
    RevisionCreate,
    VisibilityLog,
)
from app.services import deliberation_service

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


@router.get("/assignments")
async def get_deliberation_assignments(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Return the list of items ready for deliberation (items with cross-annotation annotations)."""
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await deliberation_service.get_deliberation_assignments(db, user_id)


@router.get("/progress")
async def get_deliberation_progress(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Return deliberation completion stats for the current user."""
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await deliberation_service.get_progress(db, user_id)


@router.get("/{excerpt_id}/peers", response_model=PeersResponse)
async def get_peers(
    excerpt_id: str,
    knowledge_item_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Return anonymized peer annotations and the user's own original annotation."""
    eid = _parse_uuid(excerpt_id, "excerpt_id")
    kid = _parse_uuid(knowledge_item_id, "knowledge_item_id")
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await deliberation_service.get_peer_annotations(db, eid, kid, user_id)


@router.post("/{excerpt_id}/revise")
async def create_revision(
    excerpt_id: str,
    body: RevisionCreate,
    knowledge_item_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Create a deliberation-phase revision of the user's original annotation."""
    eid = _parse_uuid(excerpt_id, "excerpt_id")
    kid = _parse_uuid(knowledge_item_id, "knowledge_item_id")
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await deliberation_service.create_revision(db, eid, kid, user_id, body)


@router.get("/{excerpt_id}/my-original")
async def get_my_original(
    excerpt_id: str,
    knowledge_item_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Return the user's original cross_annotation-phase annotation."""
    eid = _parse_uuid(excerpt_id, "excerpt_id")
    kid = _parse_uuid(knowledge_item_id, "knowledge_item_id")
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await deliberation_service.get_my_original(db, eid, kid, user_id)


@router.post("/{excerpt_id}/log-visibility")
async def log_visibility(
    excerpt_id: str,
    body: VisibilityLog,
    knowledge_item_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Log which peer annotations were visible during deliberation."""
    eid = _parse_uuid(excerpt_id, "excerpt_id")
    kid = _parse_uuid(knowledge_item_id, "knowledge_item_id")
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await deliberation_service.log_visibility(
        db, eid, kid, user_id, body.visible_annotation_ids
    )


@router.post("/complete")
async def complete_deliberation(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Mark deliberation phase as complete for the current user."""
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await deliberation_service.mark_complete(db, user_id)


@router.get("/group-progress")
async def get_group_progress(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(
        require_role("participant", "external_annotator", "researcher")
    ),
):
    """Get deliberation completion status for all group members."""
    user_id = _parse_uuid(current_user["user_id"], "user_id")
    return await deliberation_service.get_group_progress(db, user_id)
