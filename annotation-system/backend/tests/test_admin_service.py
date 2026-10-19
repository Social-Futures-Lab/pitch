"""Tests for app/services/admin_service.py."""

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from unittest.mock import AsyncMock, patch

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
from app.models.knowledge_item import KnowledgeItem
from app.models.transcript_excerpt import TranscriptExcerpt
from app.models.turn import Turn
from app.models.user import User
from app.schemas.admin import UserCreate
from app.services import admin_service


# ---------------------------------------------------------------------------
# create_group
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_group_basic(db: AsyncSession, prompt: DiscussionPrompt):
    """Creating a group produces an 8-char join code and conversation status."""
    result = await admin_service.create_group(db, "scholarly", str(prompt.id))

    assert result["scenario"] == "scholarly"
    assert result["status"] == "conversation"
    assert len(result["join_code"]) == 8
    assert result["join_code"].isalnum()
    assert result["member_count"] == 0
    assert result["prompt_id"] == str(prompt.id)
    # The group should exist in the DB
    group = (
        await db.execute(select(Group).where(Group.id == uuid.UUID(result["id"])))
    ).scalar_one()
    assert group is not None


@pytest.mark.asyncio
async def test_create_group_join_code_unique(db: AsyncSession, prompt: DiscussionPrompt):
    """Two groups should get different join codes."""
    r1 = await admin_service.create_group(db, "scholarly", str(prompt.id))
    r2 = await admin_service.create_group(db, "trip_planning", str(prompt.id))
    assert r1["join_code"] != r2["join_code"]


@pytest.mark.asyncio
async def test_create_group_valid_scenarios(db: AsyncSession, prompt: DiscussionPrompt):
    """Both valid scenario values should work."""
    r1 = await admin_service.create_group(db, "scholarly", str(prompt.id))
    assert r1["scenario"] == "scholarly"

    r2 = await admin_service.create_group(db, "trip_planning", str(prompt.id))
    assert r2["scenario"] == "trip_planning"


@pytest.mark.asyncio
async def test_create_group_invalid_scenario(db: AsyncSession, prompt: DiscussionPrompt):
    """An invalid scenario raises 400."""
    with pytest.raises(HTTPException) as exc_info:
        await admin_service.create_group(db, "invalid_scenario", str(prompt.id))
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_create_group_no_prompt(db: AsyncSession):
    """A group can be created without a prompt_id."""
    result = await admin_service.create_group(db, "scholarly")
    assert result["prompt_id"] is None
    assert result["scenario"] == "scholarly"


@pytest.mark.asyncio
async def test_create_group_nonexistent_prompt(db: AsyncSession):
    """Referencing a non-existent prompt raises 404."""
    fake_id = str(uuid.uuid4())
    with pytest.raises(HTTPException) as exc_info:
        await admin_service.create_group(db, "scholarly", fake_id)
    assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# list_groups
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_groups_empty(db: AsyncSession):
    """Returns an empty list when no groups exist."""
    result = await admin_service.list_groups(db)
    assert result == []


@pytest.mark.asyncio
async def test_list_groups_with_member_counts(
    db: AsyncSession, group_with_members: Group
):
    """Returns groups with correct member counts."""
    result = await admin_service.list_groups(db)
    assert len(result) == 1
    assert result[0]["id"] == str(group_with_members.id)
    assert result[0]["member_count"] == 2


@pytest.mark.asyncio
async def test_list_groups_no_members(db: AsyncSession, group: Group):
    """A group with no members shows member_count == 0."""
    result = await admin_service.list_groups(db)
    assert len(result) == 1
    assert result[0]["member_count"] == 0


# ---------------------------------------------------------------------------
# transition_phase
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_transition_phase_valid_next(db: AsyncSession, group: Group):
    """conversation -> construction is a valid sequential transition."""
    result = await admin_service.transition_phase(
        db, group.id, "construction"
    )
    assert result["status"] == "construction"

    # Verify DB actually changed
    refreshed = (
        await db.execute(select(Group).where(Group.id == group.id))
    ).scalar_one()
    assert refreshed.status == GroupStatus.construction


@pytest.mark.asyncio
async def test_transition_phase_invalid_skip(db: AsyncSession, group: Group):
    """conversation -> deliberation (skipping phases) should fail."""
    with pytest.raises(HTTPException) as exc_info:
        await admin_service.transition_phase(db, group.id, "deliberation")
    assert exc_info.value.status_code == 400
    assert "Invalid transition" in exc_info.value.detail


@pytest.mark.asyncio
async def test_transition_phase_invalid_target(db: AsyncSession, group: Group):
    """An unrecognised target status raises 400."""
    with pytest.raises(HTTPException) as exc_info:
        await admin_service.transition_phase(db, group.id, "nonexistent")
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_transition_phase_group_not_found(db: AsyncSession):
    """A non-existent group_id raises 404."""
    with pytest.raises(HTTPException) as exc_info:
        await admin_service.transition_phase(db, uuid.uuid4(), "construction")
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_transition_phase_full_chain(db: AsyncSession, group: Group):
    """Walk through every phase in order: conversation -> complete."""
    phases = [
        "construction",
        "neutralization",
        "cross_annotation",
        "deliberation",
        "complete",
    ]
    for target in phases:
        result = await admin_service.transition_phase(db, group.id, target)
        assert result["status"] == target

    # Verify final state in DB
    refreshed = (
        await db.execute(select(Group).where(Group.id == group.id))
    ).scalar_one()
    assert refreshed.status == GroupStatus.complete


@pytest.mark.asyncio
async def test_transition_phase_backwards_fails(db: AsyncSession, group: Group):
    """Going backwards (construction -> conversation) should fail."""
    await admin_service.transition_phase(db, group.id, "construction")
    with pytest.raises(HTTPException) as exc_info:
        await admin_service.transition_phase(db, group.id, "conversation")
    assert exc_info.value.status_code == 400


# ---------------------------------------------------------------------------
# create_user
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_user_participant(db: AsyncSession):
    """Participants can be created without a password."""
    data = UserCreate(name="Alice", role="participant")
    result = await admin_service.create_user(db, data)
    assert result["name"] == "Alice"
    assert result["role"] == "participant"
    assert result["email"] is None


@pytest.mark.asyncio
async def test_create_user_researcher_with_password(db: AsyncSession):
    """Researchers require a password; the hash is stored (not the plaintext)."""
    data = UserCreate(
        name="Dr. Bob",
        email="bob@research.org",
        role="researcher",
        password="securepassword123",
    )
    result = await admin_service.create_user(db, data)
    assert result["role"] == "researcher"
    assert result["email"] == "bob@research.org"

    # Verify password was hashed
    user = (
        await db.execute(select(User).where(User.id == uuid.UUID(result["id"])))
    ).scalar_one()
    assert user.password_hash is not None
    assert user.password_hash != "securepassword123"


@pytest.mark.asyncio
async def test_create_user_researcher_no_password_fails(db: AsyncSession):
    """Researcher without password raises 400."""
    data = UserCreate(name="Dr. No-Pass", email="nopass@test.com", role="researcher")
    with pytest.raises(HTTPException) as exc_info:
        await admin_service.create_user(db, data)
    assert exc_info.value.status_code == 400
    assert "Password is required" in exc_info.value.detail


@pytest.mark.asyncio
async def test_create_user_duplicate_email_fails(db: AsyncSession):
    """Two users with the same email raises 409."""
    data1 = UserCreate(name="First", email="dup@test.com", role="participant")
    await admin_service.create_user(db, data1)

    data2 = UserCreate(name="Second", email="dup@test.com", role="participant")
    with pytest.raises(HTTPException) as exc_info:
        await admin_service.create_user(db, data2)
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_create_user_invalid_role(db: AsyncSession):
    """An invalid role string raises 400."""
    data = UserCreate(name="Invalid", role="superadmin")
    with pytest.raises(HTTPException) as exc_info:
        await admin_service.create_user(db, data)
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_create_user_external_annotator(db: AsyncSession):
    """External annotator can be created without a password."""
    data = UserCreate(name="Ext Ann", role="external_annotator")
    result = await admin_service.create_user(db, data)
    assert result["role"] == "external_annotator"


# ---------------------------------------------------------------------------
# review_item
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_review_item_approve(db: AsyncSession, knowledge_item: KnowledgeItem):
    """Approving an item with neutralized text sets status to approved."""
    # First set neutralized text so approval succeeds
    knowledge_item.neutralized_ideal_response = "Neutralized text."
    await db.commit()
    await db.refresh(knowledge_item)

    result = await admin_service.review_item(db, knowledge_item.id, "approve")
    assert result["review_status"] == "approved"


@pytest.mark.asyncio
async def test_review_item_approve_without_neutralized_fails(
    db: AsyncSession, knowledge_item: KnowledgeItem
):
    """Cannot approve an item that has no neutralized_ideal_response."""
    # knowledge_item fixture has neutralized_ideal_response = None
    with pytest.raises(HTTPException) as exc_info:
        await admin_service.review_item(db, knowledge_item.id, "approve")
    assert exc_info.value.status_code == 400
    assert "Cannot approve" in exc_info.value.detail


@pytest.mark.asyncio
async def test_review_item_reject(db: AsyncSession, knowledge_item: KnowledgeItem):
    """Rejecting sets review_status to rejected."""
    result = await admin_service.review_item(db, knowledge_item.id, "reject")
    assert result["review_status"] == "rejected"


@pytest.mark.asyncio
async def test_review_item_edit(db: AsyncSession, knowledge_item: KnowledgeItem):
    """Edit updates neutralized_ideal_response AND sets status to approved."""
    edited = "Manually edited neutralized text"
    result = await admin_service.review_item(
        db, knowledge_item.id, "edit", edited_text=edited
    )
    assert result["review_status"] == "approved"
    assert result["neutralized_ideal_response"] == edited

    # Verify in DB
    refreshed = (
        await db.execute(
            select(KnowledgeItem).where(KnowledgeItem.id == knowledge_item.id)
        )
    ).scalar_one()
    assert refreshed.neutralized_ideal_response == edited
    assert refreshed.review_status == ReviewStatus.approved


@pytest.mark.asyncio
async def test_review_item_edit_empty_text_fails(
    db: AsyncSession, knowledge_item: KnowledgeItem
):
    """Edit without edited_text raises 400."""
    with pytest.raises(HTTPException) as exc_info:
        await admin_service.review_item(db, knowledge_item.id, "edit")
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_review_item_invalid_action(
    db: AsyncSession, knowledge_item: KnowledgeItem
):
    """An unknown action raises 400."""
    with pytest.raises(HTTPException) as exc_info:
        await admin_service.review_item(db, knowledge_item.id, "destroy")
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_review_item_not_found(db: AsyncSession):
    """A non-existent item_id raises 404."""
    with pytest.raises(HTTPException) as exc_info:
        await admin_service.review_item(db, uuid.uuid4(), "approve")
    assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# trigger_neutralization
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_trigger_neutralization(
    db: AsyncSession, knowledge_item: KnowledgeItem
):
    """Mocks neutralization_service.neutralize_item and checks result."""
    with patch(
        "app.services.admin_service.neutralization_service.neutralize_item",
        new_callable=AsyncMock,
        return_value="Neutralized output from LLM",
    ) as mock_neutralize:
        result = await admin_service.trigger_neutralization(db, knowledge_item.id)

    mock_neutralize.assert_awaited_once_with(knowledge_item.raw_ideal_response)
    assert result["neutralized_ideal_response"] == "Neutralized output from LLM"

    # Verify DB update
    refreshed = (
        await db.execute(
            select(KnowledgeItem).where(KnowledgeItem.id == knowledge_item.id)
        )
    ).scalar_one()
    assert refreshed.neutralized_ideal_response == "Neutralized output from LLM"


@pytest.mark.asyncio
async def test_trigger_neutralization_not_found(db: AsyncSession):
    """Non-existent item raises 404."""
    with pytest.raises(HTTPException) as exc_info:
        await admin_service.trigger_neutralization(db, uuid.uuid4())
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_trigger_neutralization_service_error(
    db: AsyncSession, knowledge_item: KnowledgeItem
):
    """When neutralization raises, a 502 is returned."""
    with patch(
        "app.services.admin_service.neutralization_service.neutralize_item",
        new_callable=AsyncMock,
        side_effect=RuntimeError("LLM down"),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await admin_service.trigger_neutralization(db, knowledge_item.id)
    assert exc_info.value.status_code == 502


# ---------------------------------------------------------------------------
# create_prompt
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_prompt(db: AsyncSession):
    """Creates a prompt with the given scenario and text."""
    result = await admin_service.create_prompt(
        db, "scholarly", "Discuss AI ethics in healthcare."
    )
    assert result["scenario"] == "scholarly"
    assert result["text"] == "Discuss AI ethics in healthcare."
    assert result["pre_identified_items"] is None

    # Verify in DB
    p = (
        await db.execute(
            select(DiscussionPrompt).where(
                DiscussionPrompt.id == uuid.UUID(result["id"])
            )
        )
    ).scalar_one()
    assert p.scenario == Scenario.scholarly


@pytest.mark.asyncio
async def test_create_prompt_with_pre_identified_items(db: AsyncSession):
    """Creates a prompt with pre_identified_items."""
    items = [{"term": "LLM", "explanation": "Large Language Model"}]
    result = await admin_service.create_prompt(
        db, "trip_planning", "Plan a trip to Paris.", pre_identified_items=items
    )
    assert result["pre_identified_items"] == items


@pytest.mark.asyncio
async def test_create_prompt_invalid_scenario(db: AsyncSession):
    """Invalid scenario raises 400."""
    with pytest.raises(HTTPException) as exc_info:
        await admin_service.create_prompt(db, "mystery", "Some text")
    assert exc_info.value.status_code == 400


# ---------------------------------------------------------------------------
# get_supplemental_queue
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_supplemental_queue_no_annotations(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
):
    """An excerpt+item pair with zero annotations appears in the queue."""
    result = await admin_service.get_supplemental_queue(db)
    assert len(result) == 1
    assert result[0]["excerpt_id"] == str(excerpt.id)
    assert result[0]["knowledge_item_id"] == str(knowledge_item.id)
    assert result[0]["annotation_count"] == 0


@pytest.mark.asyncio
async def test_get_supplemental_queue_below_threshold(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
    external_annotator: User,
):
    """Pairs with < 5 cross_annotation annotations are in the queue."""
    # Create 3 annotations (below threshold of 5)
    for i in range(3):
        annotator = User(
            id=uuid.uuid4(),
            name=f"Annotator {i}",
            role=UserRole.external_annotator,
        )
        db.add(annotator)
        await db.flush()
        ann = Annotation(
            id=uuid.uuid4(),
            excerpt_id=excerpt.id,
            knowledge_item_id=knowledge_item.id,
            annotator_id=annotator.id,
            annotator_role=AnnotatorRole.external,
            phase=AnnotationPhase.cross_annotation,
            do_not_surface=False,
        )
        db.add(ann)
    await db.commit()

    result = await admin_service.get_supplemental_queue(db)
    assert len(result) == 1
    assert result[0]["annotation_count"] == 3


@pytest.mark.asyncio
async def test_get_supplemental_queue_at_threshold(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
):
    """Pairs with exactly 5 cross_annotation annotations are NOT in the queue."""
    for i in range(5):
        annotator = User(
            id=uuid.uuid4(),
            name=f"Ann {i}",
            role=UserRole.external_annotator,
        )
        db.add(annotator)
        await db.flush()
        ann = Annotation(
            id=uuid.uuid4(),
            excerpt_id=excerpt.id,
            knowledge_item_id=knowledge_item.id,
            annotator_id=annotator.id,
            annotator_role=AnnotatorRole.external,
            phase=AnnotationPhase.cross_annotation,
            do_not_surface=False,
        )
        db.add(ann)
    await db.commit()

    result = await admin_service.get_supplemental_queue(db)
    assert len(result) == 0


@pytest.mark.asyncio
async def test_get_supplemental_queue_empty_when_no_excerpts(db: AsyncSession):
    """Empty DB => empty queue."""
    result = await admin_service.get_supplemental_queue(db)
    assert result == []
