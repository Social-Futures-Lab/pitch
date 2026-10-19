"""Tests for app/services/deliberation_service.py."""

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.annotation import Annotation
from app.models.conversation import Conversation
from app.models.enums import AnnotationPhase, AnnotatorRole
from app.models.group import Group
from app.models.knowledge_item import KnowledgeItem
from app.models.transcript_excerpt import TranscriptExcerpt
from app.models.turn import Turn
from app.models.user import User
from app.schemas.deliberation import RevisionCreate
from app.services import deliberation_service


# ---------------------------------------------------------------------------
# Helper to create an Annotation record
# ---------------------------------------------------------------------------


async def _make_annotation(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
    annotator: User,
    turns: list[Turn],
    *,
    annotator_role: AnnotatorRole = AnnotatorRole.within_group,
    phase: AnnotationPhase = AnnotationPhase.cross_annotation,
    do_not_surface: bool = False,
    extends_before: bool = False,
    extends_after: bool = False,
    rationale: str | None = None,
    revision_of_id: uuid.UUID | None = None,
    window_start_idx: int = 2,
    window_end_idx: int = 6,
    best_turn_idx: int = 4,
) -> Annotation:
    ann = Annotation(
        id=uuid.uuid4(),
        excerpt_id=excerpt.id,
        knowledge_item_id=knowledge_item.id,
        annotator_id=annotator.id,
        annotator_role=annotator_role,
        phase=phase,
        window_start_id=turns[window_start_idx].id,
        window_end_id=turns[window_end_idx].id,
        best_turn_id=turns[best_turn_idx].id,
        do_not_surface=do_not_surface,
        extends_before=extends_before,
        extends_after=extends_after,
        rationale=rationale,
        revision_of_id=revision_of_id,
    )
    db.add(ann)
    await db.commit()
    await db.refresh(ann)
    return ann


# =====================================================================
# get_peer_annotations
# =====================================================================


@pytest.mark.asyncio
async def test_get_peer_annotations_anonymized(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
    participant: User,
    participant2: User,
    external_annotator: User,
    turns: list[Turn],
):
    """get_peer_annotations returns anonymized peers (Annotator A, B, etc.)."""
    # Create the requesting user's own annotation
    own_ann = await _make_annotation(
        db, excerpt, knowledge_item, participant, turns,
        best_turn_idx=3,
    )

    # Create two peer annotations
    peer1_ann = await _make_annotation(
        db, excerpt, knowledge_item, participant2, turns,
        annotator_role=AnnotatorRole.within_group,
        best_turn_idx=5,
    )
    peer2_ann = await _make_annotation(
        db, excerpt, knowledge_item, external_annotator, turns,
        annotator_role=AnnotatorRole.external,
        best_turn_idx=4,
        do_not_surface=True,
    )

    result = await deliberation_service.get_peer_annotations(
        db, excerpt.id, knowledge_item.id, participant.id
    )

    # Should have 2 peers
    peers = result["peers"]
    assert len(peers) == 2

    # Peers should be anonymized with labels like "Annotator A", "Annotator B"
    labels = {p["annotator_label"] for p in peers}
    assert "Annotator A" in labels
    assert "Annotator B" in labels

    # No annotator_id should be exposed in the peer data
    for p in peers:
        assert "annotator_id" not in p


@pytest.mark.asyncio
async def test_get_peer_annotations_excludes_own(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
    participant: User,
    participant2: User,
    turns: list[Turn],
):
    """get_peer_annotations excludes the requesting user's own annotation from peers."""
    own_ann = await _make_annotation(
        db, excerpt, knowledge_item, participant, turns,
    )
    peer_ann = await _make_annotation(
        db, excerpt, knowledge_item, participant2, turns,
        best_turn_idx=5,
    )

    result = await deliberation_service.get_peer_annotations(
        db, excerpt.id, knowledge_item.id, participant.id
    )

    # Own annotation should be in the own_annotation field, not in peers
    assert result["own_annotation"]["id"] == str(own_ann.id)

    # Only one peer
    assert len(result["peers"]) == 1


@pytest.mark.asyncio
async def test_get_peer_annotations_returns_own_annotation(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
    participant: User,
    participant2: User,
    turns: list[Turn],
):
    """get_peer_annotations returns the user's own annotation as a separate field."""
    own_ann = await _make_annotation(
        db, excerpt, knowledge_item, participant, turns,
    )
    await _make_annotation(
        db, excerpt, knowledge_item, participant2, turns,
    )

    result = await deliberation_service.get_peer_annotations(
        db, excerpt.id, knowledge_item.id, participant.id
    )

    own = result["own_annotation"]
    assert own["id"] == str(own_ann.id)
    assert own["annotator_id"] == str(participant.id)
    assert own["phase"] == "cross_annotation"
    assert own["window_start_turn_number"] == 3  # turns[2] is turn_number=3
    assert own["window_end_turn_number"] == 7    # turns[6] is turn_number=7
    assert own["best_turn_number"] == 5          # turns[4] is turn_number=5


@pytest.mark.asyncio
async def test_get_peer_annotations_no_own_raises_404(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
    participant: User,
    participant2: User,
    turns: list[Turn],
):
    """get_peer_annotations raises 404 if the user has no own annotation."""
    # Only create a peer annotation, not the requesting user's
    await _make_annotation(
        db, excerpt, knowledge_item, participant2, turns,
    )

    with pytest.raises(HTTPException) as exc_info:
        await deliberation_service.get_peer_annotations(
            db, excerpt.id, knowledge_item.id, participant.id
        )

    assert exc_info.value.status_code == 404
    assert "Your original annotation not found" in exc_info.value.detail


# =====================================================================
# create_revision
# =====================================================================


@pytest.mark.asyncio
async def test_create_revision_success(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
    participant: User,
    turns: list[Turn],
):
    """create_revision creates a deliberation-phase annotation linked to original."""
    original = await _make_annotation(
        db, excerpt, knowledge_item, participant, turns,
        do_not_surface=False,
        extends_before=True,
    )

    revision_data = RevisionCreate(
        best_turn_number=6,  # change best turn
        rationale="Changed my mind after seeing peers.",
    )

    result = await deliberation_service.create_revision(
        db, excerpt.id, knowledge_item.id, participant.id, revision_data
    )

    assert result["phase"] == "deliberation"
    assert result["revision_of_id"] == str(original.id)
    assert result["best_turn_number"] == 6
    assert result["rationale"] == "Changed my mind after seeing peers."
    # Unchanged fields should fall back to original values
    assert result["window_start_turn_number"] == 3  # from original (turns[2])
    assert result["window_end_turn_number"] == 7    # from original (turns[6])
    assert result["do_not_surface"] is False         # from original
    assert result["extends_before"] is True          # from original


@pytest.mark.asyncio
async def test_create_revision_falls_back_to_original_values(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
    participant: User,
    turns: list[Turn],
):
    """create_revision preserves original values for fields not specified in revision."""
    original = await _make_annotation(
        db, excerpt, knowledge_item, participant, turns,
        do_not_surface=True,
        extends_before=False,
        extends_after=True,
    )

    # Provide no field overrides (only rationale)
    revision_data = RevisionCreate(
        rationale="No changes, just providing rationale.",
    )

    result = await deliberation_service.create_revision(
        db, excerpt.id, knowledge_item.id, participant.id, revision_data
    )

    assert result["phase"] == "deliberation"
    assert result["revision_of_id"] == str(original.id)
    # All turn numbers should match the original
    assert result["window_start_turn_number"] == 3
    assert result["window_end_turn_number"] == 7
    assert result["best_turn_number"] == 5
    assert result["do_not_surface"] is True
    assert result["extends_before"] is False
    assert result["extends_after"] is True


@pytest.mark.asyncio
async def test_create_revision_no_original_raises_404(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
    participant: User,
    turns: list[Turn],
):
    """create_revision raises 404 if no original cross_annotation annotation exists."""
    revision_data = RevisionCreate(
        best_turn_number=5,
    )

    with pytest.raises(HTTPException) as exc_info:
        await deliberation_service.create_revision(
            db, excerpt.id, knowledge_item.id, participant.id, revision_data
        )

    assert exc_info.value.status_code == 404
    assert "Original annotation not found" in exc_info.value.detail


# =====================================================================
# get_my_original
# =====================================================================


@pytest.mark.asyncio
async def test_get_my_original_returns_cross_annotation(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
    participant: User,
    turns: list[Turn],
):
    """get_my_original returns the user's cross_annotation-phase annotation."""
    original = await _make_annotation(
        db, excerpt, knowledge_item, participant, turns,
        phase=AnnotationPhase.cross_annotation,
        rationale="My initial assessment.",
    )

    result = await deliberation_service.get_my_original(
        db, excerpt.id, knowledge_item.id, participant.id
    )

    assert result["id"] == str(original.id)
    assert result["phase"] == "cross_annotation"
    assert result["annotator_id"] == str(participant.id)
    assert result["window_start_turn_number"] == 3
    assert result["window_end_turn_number"] == 7
    assert result["best_turn_number"] == 5


@pytest.mark.asyncio
async def test_get_my_original_none_raises_404(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
    participant: User,
    turns: list[Turn],
):
    """get_my_original raises 404 when no annotation exists for the user."""
    with pytest.raises(HTTPException) as exc_info:
        await deliberation_service.get_my_original(
            db, excerpt.id, knowledge_item.id, participant.id
        )

    assert exc_info.value.status_code == 404
    assert "Original annotation not found" in exc_info.value.detail


@pytest.mark.asyncio
async def test_get_my_original_ignores_deliberation_phase(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
    participant: User,
    turns: list[Turn],
):
    """get_my_original only returns cross_annotation phase, not deliberation phase."""
    # Create the original
    original = await _make_annotation(
        db, excerpt, knowledge_item, participant, turns,
        phase=AnnotationPhase.cross_annotation,
    )

    # Create a deliberation revision
    await _make_annotation(
        db, excerpt, knowledge_item, participant, turns,
        phase=AnnotationPhase.deliberation,
        revision_of_id=original.id,
        best_turn_idx=5,
    )

    result = await deliberation_service.get_my_original(
        db, excerpt.id, knowledge_item.id, participant.id
    )

    # Should return the cross_annotation one, not the deliberation one
    assert result["id"] == str(original.id)
    assert result["phase"] == "cross_annotation"


# =====================================================================
# log_visibility
# =====================================================================


@pytest.mark.asyncio
async def test_log_visibility_on_cross_annotation(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
    participant: User,
    turns: list[Turn],
):
    """log_visibility stores visible_peer_annotations on cross_annotation annotation."""
    original = await _make_annotation(
        db, excerpt, knowledge_item, participant, turns,
        phase=AnnotationPhase.cross_annotation,
    )

    visible_ids = [str(uuid.uuid4()), str(uuid.uuid4())]

    result = await deliberation_service.log_visibility(
        db, excerpt.id, knowledge_item.id, participant.id, visible_ids
    )

    assert result["status"] == "ok"

    # Verify the annotation was updated
    await db.refresh(original)
    assert original.visible_peer_annotations is not None
    assert original.visible_peer_annotations["visible_annotation_ids"] == visible_ids


@pytest.mark.asyncio
async def test_log_visibility_prefers_deliberation_revision(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
    participant: User,
    turns: list[Turn],
):
    """log_visibility updates the deliberation revision if one exists."""
    original = await _make_annotation(
        db, excerpt, knowledge_item, participant, turns,
        phase=AnnotationPhase.cross_annotation,
    )

    # Create a deliberation revision
    revision = await _make_annotation(
        db, excerpt, knowledge_item, participant, turns,
        phase=AnnotationPhase.deliberation,
        revision_of_id=original.id,
    )

    visible_ids = [str(uuid.uuid4())]

    result = await deliberation_service.log_visibility(
        db, excerpt.id, knowledge_item.id, participant.id, visible_ids
    )

    assert result["status"] == "ok"

    # The deliberation revision should be updated, not the original
    await db.refresh(revision)
    assert revision.visible_peer_annotations is not None
    assert revision.visible_peer_annotations["visible_annotation_ids"] == visible_ids

    # Original should remain unchanged
    await db.refresh(original)
    assert original.visible_peer_annotations is None


@pytest.mark.asyncio
async def test_log_visibility_no_annotation_raises_404(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
    participant: User,
    turns: list[Turn],
):
    """log_visibility raises 404 when no annotation exists for the user."""
    with pytest.raises(HTTPException) as exc_info:
        await deliberation_service.log_visibility(
            db, excerpt.id, knowledge_item.id, participant.id, []
        )

    assert exc_info.value.status_code == 404
    assert "No annotation found" in exc_info.value.detail


@pytest.mark.asyncio
async def test_get_peer_annotations_includes_rationales(
    db: AsyncSession,
    excerpt: TranscriptExcerpt,
    knowledge_item: KnowledgeItem,
    participant: User,
    participant2: User,
    external_annotator: User,
    turns: list[Turn],
):
    """get_peer_annotations includes rationale field for peer annotations."""
    # Create own annotation with rationale
    own_ann = await _make_annotation(
        db, excerpt, knowledge_item, participant, turns,
        rationale="I think this is the best place because...",
    )

    # Create peer annotations with and without rationales
    peer1_ann = await _make_annotation(
        db, excerpt, knowledge_item, participant2, turns,
        rationale="This seems like a good spot.",
        best_turn_idx=5,
    )
    peer2_ann = await _make_annotation(
        db, excerpt, knowledge_item, external_annotator, turns,
        rationale=None,
        best_turn_idx=4,
    )

    result = await deliberation_service.get_peer_annotations(
        db, excerpt.id, knowledge_item.id, participant.id
    )

    # Check own annotation has rationale
    assert result["own_annotation"]["rationale"] == "I think this is the best place because..."

    # Check peers include rationale field
    peers = result["peers"]
    assert len(peers) == 2

    # Find the peers by their characteristics
    peer_with_rationale = next(p for p in peers if p["best_turn_number"] == 6)
    peer_without_rationale = next(p for p in peers if p["best_turn_number"] == 5)

    assert peer_with_rationale["rationale"] == "This seems like a good spot."
    assert peer_without_rationale["rationale"] is None


# =====================================================================
# mark_complete
# =====================================================================


@pytest.mark.asyncio
async def test_mark_complete_success(
    db: AsyncSession,
    group_with_members: Group,
    participant: User,
):
    """mark_complete successfully records completion timestamp."""
    result = await deliberation_service.mark_complete(db, participant.id)

    assert result["status"] == "completed"
    assert "completed_at" in result

    # Verify the timestamp was saved in the database
    from sqlalchemy import select
    from app.models.group import GroupMembership

    membership_result = await db.execute(
        select(GroupMembership).where(GroupMembership.user_id == participant.id)
    )
    membership = membership_result.scalar_one()
    assert membership.deliberation_completed_at is not None


@pytest.mark.asyncio
async def test_mark_complete_no_membership_raises_404(
    db: AsyncSession,
    participant: User,
):
    """mark_complete raises 404 when user is not a group member."""
    with pytest.raises(HTTPException) as exc_info:
        await deliberation_service.mark_complete(db, participant.id)

    assert exc_info.value.status_code == 404
    assert "not a member of any group" in exc_info.value.detail


# =====================================================================
# get_group_progress
# =====================================================================


@pytest.mark.asyncio
async def test_get_group_progress_none_completed(
    db: AsyncSession,
    group_with_members: Group,
    participant: User,
):
    """get_group_progress shows correct stats when no one has completed."""
    result = await deliberation_service.get_group_progress(db, participant.id)

    assert result["total_members"] == 2
    assert result["completed_members"] == 0
    assert result["all_complete"] is False


@pytest.mark.asyncio
async def test_get_group_progress_partial_completion(
    db: AsyncSession,
    group_with_members: Group,
    participant: User,
    participant2: User,
):
    """get_group_progress shows correct stats when some have completed."""
    # Mark one user as complete
    await deliberation_service.mark_complete(db, participant.id)

    result = await deliberation_service.get_group_progress(db, participant.id)

    assert result["total_members"] == 2
    assert result["completed_members"] == 1
    assert result["all_complete"] is False


@pytest.mark.asyncio
async def test_get_group_progress_all_completed(
    db: AsyncSession,
    group_with_members: Group,
    participant: User,
    participant2: User,
):
    """get_group_progress shows all_complete=True when everyone is done."""
    # Mark both users as complete
    await deliberation_service.mark_complete(db, participant.id)
    await deliberation_service.mark_complete(db, participant2.id)

    result = await deliberation_service.get_group_progress(db, participant.id)

    assert result["total_members"] == 2
    assert result["completed_members"] == 2
    assert result["all_complete"] is True


@pytest.mark.asyncio
async def test_get_group_progress_no_membership(
    db: AsyncSession,
    participant: User,
):
    """get_group_progress returns zeros when user has no group."""
    result = await deliberation_service.get_group_progress(db, participant.id)

    assert result["total_members"] == 0
    assert result["completed_members"] == 0
    assert result["all_complete"] is False
