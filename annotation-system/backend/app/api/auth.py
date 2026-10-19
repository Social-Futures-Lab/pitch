import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User
from app.models.group import Group, GroupMembership
from app.models.enums import UserRole
from app.core.security import (
    create_access_token,
    verify_password,
)
from app.core.dependencies import get_current_user
from app.db.base import enum_val
from app.schemas.auth import (
    ResearcherLogin,
    ParticipantLogin,
    ExternalAnnotatorLogin,
    TokenResponse,
    UserOut,
)

router = APIRouter()


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=str(user.id),
        name=user.name,
        email=user.email,
        role=enum_val(user.role),
    )


def _token_for(user: User) -> TokenResponse:
    token = create_access_token(
        {"user_id": str(user.id), "role": enum_val(user.role)}
    )
    return TokenResponse(access_token=token, user=_user_out(user))


@router.post("/login/researcher", response_model=TokenResponse)
async def researcher_login(
    body: ResearcherLogin,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.email == body.email)
    )
    user = result.scalar_one_or_none()
    if not user or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    return _token_for(user)


@router.post("/login/participant", response_model=TokenResponse)
async def participant_login(
    body: ParticipantLogin,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Group).where(Group.join_code == body.join_code)
    )
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invalid join code")

    result = await db.execute(
        select(User).where(User.name == body.name, User.role == UserRole.participant)
    )
    user = result.scalar_one_or_none()

    if not user:
        user = User(name=body.name, role=UserRole.participant)
        db.add(user)
        await db.flush()

    existing = await db.execute(
        select(GroupMembership).where(
            GroupMembership.group_id == group.id,
            GroupMembership.user_id == user.id,
        )
    )
    if not existing.scalar_one_or_none():
        membership_count = await db.execute(
            select(GroupMembership).where(GroupMembership.group_id == group.id)
        )
        from app.core.config import config
        max_participants = config.get("app", {}).get("max_group_participants", 5)
        if len(membership_count.scalars().all()) >= max_participants:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Group is full")
        db.add(GroupMembership(group_id=group.id, user_id=user.id))

    await db.commit()
    await db.refresh(user)
    return _token_for(user)


@router.post("/login/external", response_model=TokenResponse)
async def external_annotator_login(
    body: ExternalAnnotatorLogin,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(
            User.prolific_id == body.prolific_id,
            User.role == UserRole.external_annotator,
        )
    )
    user = result.scalar_one_or_none()

    if not user:
        user = User(
            name=f"Annotator-{body.prolific_id[:8]}",
            role=UserRole.external_annotator,
            prolific_id=body.prolific_id,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    return _token_for(user)


@router.get("/me", response_model=UserOut)
async def get_me(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    result = await db.execute(select(User).where(User.id == uuid.UUID(current_user["user_id"])))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return _user_out(user)
