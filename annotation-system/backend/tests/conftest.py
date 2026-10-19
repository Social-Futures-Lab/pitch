"""Shared test fixtures for the PITCH annotation backend test suite.

Uses an in-memory SQLite database via aiosqlite so tests run fast and
don't require a running PostgreSQL instance.  Where PostgreSQL-specific
types (e.g. JSONB) are used, SQLAlchemy transparently falls back to JSON.
"""

import asyncio
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import StaticPool, event, text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.security import create_access_token, hash_password
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models import *  # noqa: F401, F403
from app.models.annotation import Annotation
from app.models.conversation import Conversation
from app.models.discussion_prompt import DiscussionPrompt
from app.models.enums import (
    AnnotationPhase,
    AnnotatorRole,
    ContributionType,
    GroupStatus,
    ItemSource,
    ReviewStatus,
    Scenario,
    UserRole,
)
from app.models.group import Group, GroupMembership
from app.models.inline_annotation import InlineAnnotation
from app.models.knowledge_item import KnowledgeItem
from app.models.priority_ranking import PriorityRanking
from app.models.search_result import SearchResult
from app.models.transcript_excerpt import TranscriptExcerpt
from app.models.turn import Turn
from app.models.user import User

# ---------------------------------------------------------------------------
# Engine / session fixtures
# ---------------------------------------------------------------------------

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

engine = create_async_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine.sync_engine, "connect")
def _enable_sqlite_fks(dbapi_connection, _connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestSession = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(autouse=True)
async def setup_database():
    """Create all tables before each test and drop them after."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def db() -> AsyncGenerator[AsyncSession, None]:
    async with TestSession() as session:
        yield session


async def _override_get_db():
    async with TestSession() as session:
        yield session


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Data factory fixtures
# ---------------------------------------------------------------------------


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


@pytest_asyncio.fixture
async def researcher(db: AsyncSession) -> User:
    user = User(
        id=_uuid(),
        name="Test Researcher",
        email="researcher@test.local",
        role=UserRole.researcher,
        password_hash=hash_password("testpass"),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest_asyncio.fixture
async def participant(db: AsyncSession) -> User:
    user = User(
        id=_uuid(),
        name="Test Participant",
        role=UserRole.participant,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest_asyncio.fixture
async def participant2(db: AsyncSession) -> User:
    user = User(
        id=_uuid(),
        name="Participant Two",
        role=UserRole.participant,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest_asyncio.fixture
async def external_annotator(db: AsyncSession) -> User:
    user = User(
        id=_uuid(),
        name="External Annotator",
        role=UserRole.external_annotator,
        prolific_id="PROL12345678",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest_asyncio.fixture
async def prompt(db: AsyncSession) -> DiscussionPrompt:
    p = DiscussionPrompt(
        id=_uuid(),
        scenario=Scenario.scholarly,
        text="Discuss the ethical implications of large language models.",
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


@pytest_asyncio.fixture
async def group(db: AsyncSession, prompt: DiscussionPrompt) -> Group:
    g = Group(
        id=_uuid(),
        scenario=Scenario.scholarly,
        prompt_id=prompt.id,
        status=GroupStatus.conversation,
        join_code="TESTCODE",
    )
    db.add(g)
    await db.commit()
    await db.refresh(g)
    return g


@pytest_asyncio.fixture
async def group_with_members(
    db: AsyncSession, group: Group, participant: User, participant2: User
) -> Group:
    db.add(GroupMembership(id=_uuid(), group_id=group.id, user_id=participant.id))
    db.add(GroupMembership(id=_uuid(), group_id=group.id, user_id=participant2.id))
    await db.commit()
    await db.refresh(group)
    return group


@pytest_asyncio.fixture
async def conversation(db: AsyncSession, group_with_members: Group) -> Conversation:
    conv = Conversation(
        id=_uuid(),
        group_id=group_with_members.id,
    )
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return conv


@pytest_asyncio.fixture
async def turns(
    db: AsyncSession, conversation: Conversation, participant: User, participant2: User
) -> list[Turn]:
    created: list[Turn] = []
    speakers = [participant, participant2]
    for i in range(1, 11):
        t = Turn(
            id=_uuid(),
            conversation_id=conversation.id,
            turn_number=i,
            speaker_id=speakers[i % 2].id,
            text=f"Turn {i} text content",
        )
        db.add(t)
        created.append(t)
    await db.commit()
    for t in created:
        await db.refresh(t)
    return created


@pytest_asyncio.fixture
async def knowledge_item(
    db: AsyncSession, conversation: Conversation, participant: User, turns: list[Turn]
) -> KnowledgeItem:
    item = KnowledgeItem(
        id=_uuid(),
        conversation_id=conversation.id,
        author_id=participant.id,
        raw_ideal_response="This is a test ideal response about LLM ethics.",
        window_start_id=turns[2].id,
        window_end_id=turns[6].id,
        best_turn_id=turns[4].id,
        contribution_type=ContributionType.heads_up,
        pertinence=0.8,
        source=ItemSource.participant,
        review_status=ReviewStatus.pending,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@pytest_asyncio.fixture
async def excerpt(
    db: AsyncSession,
    conversation: Conversation,
    knowledge_item: KnowledgeItem,
    turns: list[Turn],
) -> TranscriptExcerpt:
    exc = TranscriptExcerpt(
        id=_uuid(),
        conversation_id=conversation.id,
        knowledge_item_id=knowledge_item.id,
        start_turn_id=turns[0].id,
        end_turn_id=turns[9].id,
        preceding_context_summary="Before the excerpt discussion.",
        following_context_summary="After the excerpt discussion.",
    )
    db.add(exc)
    await db.commit()
    await db.refresh(exc)
    return exc


# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------


def researcher_token(researcher: User) -> str:
    return create_access_token(
        {"user_id": str(researcher.id), "role": "researcher"}
    )


def participant_token(participant: User) -> str:
    return create_access_token(
        {"user_id": str(participant.id), "role": "participant"}
    )


def external_token(annotator: User) -> str:
    return create_access_token(
        {"user_id": str(annotator.id), "role": "external_annotator"}
    )


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
