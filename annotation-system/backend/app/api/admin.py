"""REST endpoints for Admin & Data Management (Phase 5b).

All endpoints require the researcher role.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role
from app.db.session import get_db
from app.schemas.admin import (
    ExcerptUpdate,
    ItemReviewAction,
    PhaseTransition,
    PromptCreate,
    PromptOut,
    StudyGroupCreate,
    StudyGroupOut,
    UserCreate,
    UserUpdate,
)
from app.services import admin_service

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
# Groups
# ---------------------------------------------------------------------------


@router.post("/groups", response_model=StudyGroupOut, status_code=status.HTTP_201_CREATED)
async def create_group(
    body: StudyGroupCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Create a new study group."""
    return await admin_service.create_group(db, body.scenario, body.prompt_id)


@router.get("/groups", response_model=list[StudyGroupOut])
async def list_groups(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """List all study groups with member counts."""
    return await admin_service.list_groups(db)


@router.post("/groups/{group_id}/transition", response_model=StudyGroupOut)
async def transition_phase(
    group_id: str,
    body: PhaseTransition,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Trigger a phase transition for a study group."""
    gid = _parse_uuid(group_id, "group_id")
    return await admin_service.transition_phase(db, gid, body.target_status)


@router.post("/groups/{group_id}/revert", response_model=StudyGroupOut)
async def revert_phase(
    group_id: str,
    body: PhaseTransition,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Revert a group to an earlier phase, preserving all existing data."""
    gid = _parse_uuid(group_id, "group_id")
    return await admin_service.revert_phase(db, gid, body.target_status)


@router.get("/groups/{group_id}/conversations")
async def list_group_conversations(
    group_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """List all conversations for a study group."""
    gid = _parse_uuid(group_id, "group_id")
    return await admin_service.list_group_conversations(db, gid)


@router.get("/groups/{group_id}/item-stats")
async def get_group_item_stats(
    group_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Get knowledge item counts by status for a group."""
    gid = _parse_uuid(group_id, "group_id")
    return await admin_service.get_group_item_stats(db, gid)


@router.get("/groups/{group_id}/members")
async def list_group_members(
    group_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """List all members of a study group."""
    gid = _parse_uuid(group_id, "group_id")
    return await admin_service.list_group_members(db, gid)


@router.post("/groups/{group_id}/members", status_code=status.HTTP_201_CREATED)
async def add_group_member(
    group_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Add a user to a study group."""
    gid = _parse_uuid(group_id, "group_id")
    uid = _parse_uuid(body.get("user_id", ""), "user_id")
    return await admin_service.add_group_member(db, gid, uid)


@router.delete("/groups/{group_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_group_member(
    group_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Remove a user from a study group."""
    gid = _parse_uuid(group_id, "group_id")
    uid = _parse_uuid(user_id, "user_id")
    await admin_service.remove_group_member(db, gid, uid)


# ---------------------------------------------------------------------------
# Knowledge Item Review
# ---------------------------------------------------------------------------


@router.get("/items")
async def get_items(
    status: Optional[str] = Query(default=None, alias="status"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Return knowledge items, optionally filtered by review status."""
    return await admin_service.get_items_for_review(db, status)


@router.put("/items/{item_id}/review")
async def review_item(
    item_id: str,
    body: ItemReviewAction,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Approve, reject, or edit a knowledge item's neutralized response."""
    iid = _parse_uuid(item_id, "item_id")
    return await admin_service.review_item(
        db, iid, body.action, body.edited_neutralized_response
    )


@router.put("/items/{item_id}/neutralize")
async def trigger_neutralization(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Trigger auto-neutralization for a single knowledge item."""
    iid = _parse_uuid(item_id, "item_id")
    return await admin_service.trigger_neutralization(db, iid)


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------


@router.post("/prompts", response_model=PromptOut, status_code=status.HTTP_201_CREATED)
async def create_prompt(
    body: PromptCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Create a new discussion prompt."""
    return await admin_service.create_prompt(
        db, body.scenario, body.text, body.pre_identified_items
    )


@router.get("/prompts", response_model=list[PromptOut])
async def list_prompts(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """List all discussion prompts."""
    return await admin_service.list_prompts(db)


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Create a new user account."""
    return await admin_service.create_user(db, body)


@router.get("/users")
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """List all user accounts."""
    return await admin_service.list_users(db)


@router.put("/users/{user_id}")
async def update_user(
    user_id: str,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Update an existing user account."""
    uid = _parse_uuid(user_id, "user_id")
    return await admin_service.update_user(db, uid, body)


# ---------------------------------------------------------------------------
# Excerpts
# ---------------------------------------------------------------------------


@router.get("/excerpts/{conv_id}")
async def list_excerpts(
    conv_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """List all transcript excerpts for a conversation."""
    conversation_id = await admin_service.resolve_conversation_prefix(db, conv_id)
    return await admin_service.list_excerpts(db, conversation_id)


@router.put("/excerpts/{excerpt_id}")
async def update_excerpt(
    excerpt_id: str,
    body: ExcerptUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Update excerpt boundaries and/or context summaries."""
    eid = _parse_uuid(excerpt_id, "excerpt_id")
    return await admin_service.update_excerpt(db, eid, body)


