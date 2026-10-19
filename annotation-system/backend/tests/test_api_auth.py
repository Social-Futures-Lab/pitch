"""Integration tests for /api/auth endpoints."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import GroupStatus, Scenario, UserRole
from app.models.group import Group, GroupMembership
from app.models.user import User

from .conftest import (
    TestSession,
    auth_header,
    participant_token,
    researcher_token,
)


# ---------------------------------------------------------------------------
# POST /api/auth/login/researcher
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_researcher_login_success(client: AsyncClient, researcher: User):
    resp = await client.post(
        "/api/auth/login/researcher",
        json={"email": "researcher@test.local", "password": "testpass"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["id"] == str(researcher.id)
    assert data["user"]["role"] == "researcher"
    assert data["user"]["name"] == "Test Researcher"


@pytest.mark.asyncio
async def test_researcher_login_wrong_password(
    client: AsyncClient, researcher: User
):
    resp = await client.post(
        "/api/auth/login/researcher",
        json={"email": "researcher@test.local", "password": "wrongpass"},
    )
    assert resp.status_code == 401
    assert "Invalid credentials" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_researcher_login_nonexistent_email(client: AsyncClient):
    resp = await client.post(
        "/api/auth/login/researcher",
        json={"email": "nobody@test.local", "password": "anything"},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/auth/login/participant
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_participant_login_success(
    client: AsyncClient, group: Group, participant: User, db: AsyncSession
):
    # Add participant to the group so they are known
    async with TestSession() as session:
        session.add(
            GroupMembership(
                id=uuid.uuid4(), group_id=group.id, user_id=participant.id
            )
        )
        await session.commit()

    resp = await client.post(
        "/api/auth/login/participant",
        json={"name": participant.name, "join_code": "TESTCODE"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["user"]["role"] == "participant"


@pytest.mark.asyncio
async def test_participant_login_creates_new_user(
    client: AsyncClient, group: Group
):
    resp = await client.post(
        "/api/auth/login/participant",
        json={"name": "Brand New Participant", "join_code": "TESTCODE"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["user"]["name"] == "Brand New Participant"
    assert data["user"]["role"] == "participant"


@pytest.mark.asyncio
async def test_participant_login_adds_membership(
    client: AsyncClient, group: Group
):
    """Logging in with a valid join code should create a group membership."""
    resp = await client.post(
        "/api/auth/login/participant",
        json={"name": "Membership Test User", "join_code": "TESTCODE"},
    )
    assert resp.status_code == 200

    # Verify the membership was created
    async with TestSession() as session:
        from sqlalchemy import select

        memberships = await session.execute(
            select(GroupMembership).where(GroupMembership.group_id == group.id)
        )
        members = memberships.scalars().all()
        user_names = []
        for m in members:
            user_result = await session.execute(
                select(User).where(User.id == m.user_id)
            )
            u = user_result.scalar_one()
            user_names.append(u.name)
        assert "Membership Test User" in user_names


@pytest.mark.asyncio
async def test_participant_login_invalid_join_code(client: AsyncClient):
    resp = await client.post(
        "/api/auth/login/participant",
        json={"name": "Anyone", "join_code": "BADCODE"},
    )
    assert resp.status_code == 404
    assert "Invalid join code" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_participant_login_group_full(client: AsyncClient, db: AsyncSession):
    """When the group has reached max_group_participants, new joins should fail."""
    from app.core.config import config
    from app.models.discussion_prompt import DiscussionPrompt

    max_p = config.get("app", {}).get("max_group_participants", 5)

    # Create a prompt and a group
    prompt = DiscussionPrompt(
        id=uuid.uuid4(), scenario=Scenario.scholarly, text="Full group test"
    )
    db.add(prompt)
    await db.flush()

    full_group = Group(
        id=uuid.uuid4(),
        scenario=Scenario.scholarly,
        prompt_id=prompt.id,
        status=GroupStatus.conversation,
        join_code="FULLGRP",
    )
    db.add(full_group)
    await db.flush()

    # Fill the group to capacity
    for i in range(max_p):
        u = User(
            id=uuid.uuid4(),
            name=f"Filler {i}",
            role=UserRole.participant,
        )
        db.add(u)
        await db.flush()
        db.add(
            GroupMembership(
                id=uuid.uuid4(), group_id=full_group.id, user_id=u.id
            )
        )
    await db.commit()

    # Now try to join as a new participant
    resp = await client.post(
        "/api/auth/login/participant",
        json={"name": "Overflow User", "join_code": "FULLGRP"},
    )
    assert resp.status_code == 400
    assert "full" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# POST /api/auth/login/external
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_external_login_success(
    client: AsyncClient, external_annotator: User
):
    resp = await client.post(
        "/api/auth/login/external",
        json={"prolific_id": "PROL12345678"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["user"]["id"] == str(external_annotator.id)
    assert data["user"]["role"] == "external_annotator"


@pytest.mark.asyncio
async def test_external_login_auto_creates_user(client: AsyncClient):
    new_prolific_id = "NEW_PROLIFIC_42"
    resp = await client.post(
        "/api/auth/login/external",
        json={"prolific_id": new_prolific_id},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["user"]["role"] == "external_annotator"
    # Name should include the truncated prolific id prefix
    assert "NEW_PROL" in data["user"]["name"]


@pytest.mark.asyncio
async def test_external_login_returns_same_user_on_repeat(client: AsyncClient):
    prolific_id = "REPEAT_ID_999"
    resp1 = await client.post(
        "/api/auth/login/external",
        json={"prolific_id": prolific_id},
    )
    assert resp1.status_code == 200
    user1 = resp1.json()["user"]

    resp2 = await client.post(
        "/api/auth/login/external",
        json={"prolific_id": prolific_id},
    )
    assert resp2.status_code == 200
    user2 = resp2.json()["user"]

    assert user1["id"] == user2["id"]


# ---------------------------------------------------------------------------
# GET /api/auth/me
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_me_success(client: AsyncClient, researcher: User):
    token = researcher_token(researcher)
    resp = await client.get("/api/auth/me", headers=auth_header(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == str(researcher.id)
    assert data["role"] == "researcher"
    assert data["name"] == "Test Researcher"


@pytest.mark.asyncio
async def test_get_me_with_participant(client: AsyncClient, participant: User):
    token = participant_token(participant)
    resp = await client.get("/api/auth/me", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["role"] == "participant"


@pytest.mark.asyncio
async def test_get_me_without_token(client: AsyncClient):
    resp = await client.get("/api/auth/me")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_get_me_with_invalid_token(client: AsyncClient):
    resp = await client.get(
        "/api/auth/me", headers={"Authorization": "Bearer invalidtoken"}
    )
    assert resp.status_code in (401, 403)
