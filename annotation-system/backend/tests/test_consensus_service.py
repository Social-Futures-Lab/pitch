"""Tests for app.services.consensus_service.

Covers the pure statistical helpers (Fleiss' kappa, Kendall's W, _median,
_mode) as well as the async database-backed consensus functions
(compute_consensus_window, compute_consensus_ranking, compute_all_consensus).
"""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.annotation import Annotation
from app.models.enums import (
    AnnotationPhase,
    AnnotatorRole,
    ConsensusStatus,
)
from app.models.priority_ranking import PriorityRanking
from app.models.user import User
from app.models.enums import UserRole
from app.services.consensus_service import (
    _median,
    _mode,
    compute_all_consensus,
    compute_consensus_ranking,
    compute_consensus_window,
    compute_fleiss_kappa,
    compute_kendalls_w,
)


# ---------------------------------------------------------------------------
# Helper: create additional external-annotator users
# ---------------------------------------------------------------------------


async def _make_annotator(db: AsyncSession, name: str) -> User:
    user = User(
        id=uuid.uuid4(),
        name=name,
        role=UserRole.external_annotator,
        prolific_id=f"PROL_{uuid.uuid4().hex[:8]}",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


# ===================================================================
# Tests for compute_fleiss_kappa  (pure function, no DB needed)
# ===================================================================


class TestFleissKappa:
    """Tests for the pairwise-agreement variant of Fleiss' kappa."""

    def test_perfect_agreement_same_turn(self):
        """All annotators pick the same turn -> kappa = 1.0."""
        annotations = [
            {"best_turn_number": 5, "do_not_surface": False},
            {"best_turn_number": 5, "do_not_surface": False},
            {"best_turn_number": 5, "do_not_surface": False},
        ]
        kappa = compute_fleiss_kappa(annotations)
        assert kappa == pytest.approx(1.0)

    def test_complete_disagreement(self):
        """Every annotator picks a different turn.

        For n raters each choosing a unique category:
            P_observed = 0
            P_expected = n * (1/n)^2 = 1/n
            kappa = (0 - 1/n) / (1 - 1/n) = -1/(n-1)
        """
        annotations = [
            {"best_turn_number": 1, "do_not_surface": False},
            {"best_turn_number": 2, "do_not_surface": False},
            {"best_turn_number": 3, "do_not_surface": False},
        ]
        kappa = compute_fleiss_kappa(annotations)
        expected = -1.0 / (3 - 1)  # -0.5
        assert kappa == pytest.approx(expected)

    def test_mixed_agreement(self):
        """Some annotators agree, some disagree -> kappa between -1 and 1."""
        annotations = [
            {"best_turn_number": 5, "do_not_surface": False},
            {"best_turn_number": 5, "do_not_surface": False},
            {"best_turn_number": 5, "do_not_surface": False},
            {"best_turn_number": 7, "do_not_surface": False},
        ]
        kappa = compute_fleiss_kappa(annotations)
        # P_o=0.5, P_e=0.625 → kappa = -0.333
        assert -1.0 < kappa < 1.0
        assert kappa == pytest.approx(-1.0 / 3.0)

    def test_all_do_not_surface(self):
        """All annotators mark do_not_surface -> perfect agreement."""
        annotations = [
            {"best_turn_number": None, "do_not_surface": True},
            {"best_turn_number": None, "do_not_surface": True},
            {"best_turn_number": None, "do_not_surface": True},
        ]
        kappa = compute_fleiss_kappa(annotations)
        assert kappa == pytest.approx(1.0)

    def test_fewer_than_two_annotations(self):
        """Single annotation -> returns 0.0."""
        annotations = [{"best_turn_number": 5, "do_not_surface": False}]
        assert compute_fleiss_kappa(annotations) == 0.0

    def test_empty_annotations(self):
        assert compute_fleiss_kappa([]) == 0.0

    def test_mix_do_not_surface_and_turns(self):
        """Some annotators say do_not_surface, some place turns.

        With 4 annotators: 2 dns + 2 on turn 3:
            categories: [dns, dns, 3, 3]
            freq: {dns: 2, 3: 2}
            concordant = 2*1 + 2*1 = 4
            total_pairs = 4*3 = 12
            p_observed = 4/12 = 1/3
            p_expected = (2/4)^2 + (2/4)^2 = 0.25 + 0.25 = 0.5
            kappa = (1/3 - 0.5) / (1 - 0.5) = -1/3
        """
        annotations = [
            {"best_turn_number": None, "do_not_surface": True},
            {"best_turn_number": None, "do_not_surface": True},
            {"best_turn_number": 3, "do_not_surface": False},
            {"best_turn_number": 3, "do_not_surface": False},
        ]
        kappa = compute_fleiss_kappa(annotations)
        expected = (1.0 / 3.0 - 0.5) / (1.0 - 0.5)
        assert kappa == pytest.approx(expected)

    def test_two_annotators_agree(self):
        """Two annotators pick the same turn -> kappa = 1.0."""
        annotations = [
            {"best_turn_number": 8, "do_not_surface": False},
            {"best_turn_number": 8, "do_not_surface": False},
        ]
        kappa = compute_fleiss_kappa(annotations)
        assert kappa == pytest.approx(1.0)

    def test_two_annotators_disagree(self):
        """Two annotators pick different turns -> kappa = -1.0."""
        annotations = [
            {"best_turn_number": 1, "do_not_surface": False},
            {"best_turn_number": 2, "do_not_surface": False},
        ]
        kappa = compute_fleiss_kappa(annotations)
        # n=2, each picks unique: -1/(2-1) = -1.0
        assert kappa == pytest.approx(-1.0)

    def test_none_best_turn_not_dns(self):
        """Annotations with best_turn_number=None and do_not_surface=False
        are placed in the __none__ category."""
        annotations = [
            {"best_turn_number": None, "do_not_surface": False},
            {"best_turn_number": None, "do_not_surface": False},
        ]
        kappa = compute_fleiss_kappa(annotations)
        assert kappa == pytest.approx(1.0)


# ===================================================================
# Tests for compute_kendalls_w  (pure function, no DB needed)
# ===================================================================


class TestKendallsW:
    """Tests for Kendall's coefficient of concordance."""

    def test_perfect_agreement(self):
        """Identical rankings -> W = 1.0."""
        rankings = [
            [1, 2, 3, 4],
            [1, 2, 3, 4],
            [1, 2, 3, 4],
        ]
        w = compute_kendalls_w(rankings)
        assert w == pytest.approx(1.0)

    def test_perfect_disagreement_two_raters(self):
        """Two raters with reversed rankings.

        For 2 raters, reversed rankings can still produce W > 0 depending on
        the formula. With ranks [1,2,3] and [3,2,1]:
            col_sums = [4, 4, 4] -> all equal -> S = 0 -> W = 0.0
        """
        rankings = [
            [1, 2, 3],
            [3, 2, 1],
        ]
        w = compute_kendalls_w(rankings)
        assert w == pytest.approx(0.0)

    def test_perfect_reversal_three_raters(self):
        """Three raters: 2 agree, 1 reversed. Should give moderate W."""
        rankings = [
            [1, 2, 3],
            [1, 2, 3],
            [3, 2, 1],
        ]
        w = compute_kendalls_w(rankings)
        assert 0.0 < w < 1.0

    def test_mixed_rankings(self):
        """Moderate agreement -> W between 0 and 1."""
        rankings = [
            [1, 2, 3, 4],
            [1, 3, 2, 4],
            [2, 1, 3, 4],
        ]
        w = compute_kendalls_w(rankings)
        assert 0.0 < w < 1.0

    def test_fewer_than_two_raters(self):
        """Single rater -> returns 0.0."""
        assert compute_kendalls_w([[1, 2, 3]]) == 0.0

    def test_empty_raters(self):
        assert compute_kendalls_w([]) == 0.0

    def test_fewer_than_two_items(self):
        """Ranking a single item -> returns 0.0."""
        rankings = [
            [1],
            [1],
        ]
        assert compute_kendalls_w(rankings) == 0.0

    def test_unequal_length_rankings(self):
        """Rankings of different lengths -> returns 0.0."""
        rankings = [
            [1, 2, 3],
            [1, 2],
        ]
        assert compute_kendalls_w(rankings) == 0.0

    def test_two_items_two_raters_agree(self):
        """Two raters agree on two items -> W = 1.0."""
        rankings = [
            [1, 2],
            [1, 2],
        ]
        w = compute_kendalls_w(rankings)
        assert w == pytest.approx(1.0)


# ===================================================================
# Tests for _median and _mode (private helpers)
# ===================================================================


class TestMedian:
    def test_odd_length(self):
        assert _median([3, 1, 2]) == 2

    def test_even_length(self):
        # (2 + 3) / 2 = 2.5 -> round -> 2
        assert _median([1, 2, 3, 4]) == 2

    def test_even_length_rounds_to_nearest(self):
        # (3 + 4) / 2 = 3.5 -> round -> 4
        assert _median([1, 3, 4, 6]) == 4

    def test_single_element(self):
        assert _median([42]) == 42

    def test_two_elements(self):
        # (5 + 7) / 2 = 6
        assert _median([5, 7]) == 6

    def test_all_same(self):
        assert _median([3, 3, 3, 3]) == 3

    def test_sorted_already(self):
        assert _median([1, 2, 3, 4, 5]) == 3


class TestMode:
    def test_single_clear_mode(self):
        assert _mode([1, 2, 2, 3]) == 2

    def test_all_same(self):
        assert _mode([5, 5, 5]) == 5

    def test_multiple_modes_picks_median(self):
        """When there are multiple modes (tie), _mode picks the median of the
        tied values via modes[len(modes) // 2]."""
        # All values appear once -> all are modes: [1, 2, 3]
        # len(modes)=3, modes[1] = 2
        assert _mode([1, 2, 3]) == 2

    def test_two_modes(self):
        # Values: 1 appears 2x, 3 appears 2x; modes = [1, 3]
        # len(modes)=2, modes[1] = 3
        assert _mode([1, 1, 3, 3]) == 3

    def test_single_element(self):
        assert _mode([7]) == 7

    def test_four_tied_modes(self):
        # modes = [1, 2, 3, 4], len=4, modes[2] = 3
        assert _mode([1, 2, 3, 4]) == 3


# ===================================================================
# Tests for compute_consensus_window (async, needs DB)
# ===================================================================


class TestComputeConsensusWindow:
    """Integration tests for compute_consensus_window using the test DB."""

    @pytest.mark.asyncio
    async def test_majority_do_not_surface(
        self, db, excerpt, knowledge_item, turns, external_annotator
    ):
        """When majority of annotators say do_not_surface, status is do_not_surface."""
        ann1_user = external_annotator
        ann2_user = await _make_annotator(db, "Annotator2")
        ann3_user = await _make_annotator(db, "Annotator3")

        # 2 of 3 say do_not_surface
        for i, (user, dns) in enumerate([
            (ann1_user, True),
            (ann2_user, True),
            (ann3_user, False),
        ]):
            ann = Annotation(
                id=uuid.uuid4(),
                excerpt_id=excerpt.id,
                knowledge_item_id=knowledge_item.id,
                annotator_id=user.id,
                annotator_role=AnnotatorRole.external,
                phase=AnnotationPhase.cross_annotation,
                do_not_surface=dns,
                window_start_id=turns[0].id if not dns else None,
                window_end_id=turns[9].id if not dns else None,
                best_turn_id=turns[4].id if not dns else None,
            )
            db.add(ann)
        await db.commit()

        result = await compute_consensus_window(db, excerpt.id, knowledge_item.id)

        assert result["status"] == ConsensusStatus.do_not_surface.value
        assert result["consensus_best_turn_number"] is None
        assert result["annotator_agreement"] == pytest.approx(2.0 / 3.0)

    @pytest.mark.asyncio
    async def test_well_defined_agreement(
        self, db, excerpt, knowledge_item, turns, external_annotator
    ):
        """All annotators place near the same window -> well_defined."""
        ann1_user = external_annotator
        ann2_user = await _make_annotator(db, "Annotator2")
        ann3_user = await _make_annotator(db, "Annotator3")

        # All agree on turn 5 as best, window [2..8]
        for user in [ann1_user, ann2_user, ann3_user]:
            ann = Annotation(
                id=uuid.uuid4(),
                excerpt_id=excerpt.id,
                knowledge_item_id=knowledge_item.id,
                annotator_id=user.id,
                annotator_role=AnnotatorRole.external,
                phase=AnnotationPhase.cross_annotation,
                do_not_surface=False,
                window_start_id=turns[1].id,   # turn_number=2
                window_end_id=turns[7].id,      # turn_number=8
                best_turn_id=turns[4].id,        # turn_number=5
            )
            db.add(ann)
        await db.commit()

        result = await compute_consensus_window(db, excerpt.id, knowledge_item.id)

        assert result["status"] == ConsensusStatus.well_defined.value
        assert result["annotator_agreement"] > 0.6
        assert result["consensus_best_turn_number"] == 5
        assert result["consensus_start_turn_number"] == 2
        assert result["consensus_end_turn_number"] == 8

    @pytest.mark.asyncio
    async def test_scattered_placements_contested(
        self, db, excerpt, knowledge_item, turns, external_annotator
    ):
        """Scattered placements -> contested status."""
        ann1_user = external_annotator
        ann2_user = await _make_annotator(db, "Annotator2")
        ann3_user = await _make_annotator(db, "Annotator3")
        ann4_user = await _make_annotator(db, "Annotator4")
        ann5_user = await _make_annotator(db, "Annotator5")

        # Each annotator picks very different turns
        configs = [
            (ann1_user, turns[0].id, turns[2].id, turns[1].id),  # 1, 3, 2
            (ann2_user, turns[3].id, turns[5].id, turns[4].id),  # 4, 6, 5
            (ann3_user, turns[6].id, turns[8].id, turns[7].id),  # 7, 9, 8
            (ann4_user, turns[0].id, turns[9].id, turns[0].id),  # 1, 10, 1
            (ann5_user, turns[7].id, turns[9].id, turns[9].id),  # 8, 10, 10
        ]
        for user, start_id, end_id, best_id in configs:
            ann = Annotation(
                id=uuid.uuid4(),
                excerpt_id=excerpt.id,
                knowledge_item_id=knowledge_item.id,
                annotator_id=user.id,
                annotator_role=AnnotatorRole.external,
                phase=AnnotationPhase.cross_annotation,
                do_not_surface=False,
                window_start_id=start_id,
                window_end_id=end_id,
                best_turn_id=best_id,
            )
            db.add(ann)
        await db.commit()

        result = await compute_consensus_window(db, excerpt.id, knowledge_item.id)

        assert result["status"] == ConsensusStatus.contested.value
        assert result["annotator_agreement"] <= 0.6

    @pytest.mark.asyncio
    async def test_deliberation_supersedes_cross_annotation(
        self, db, excerpt, knowledge_item, turns, external_annotator
    ):
        """A deliberation-phase annotation supersedes an earlier cross_annotation."""
        user = external_annotator

        # Cross annotation: best = turn 2
        cross_ann = Annotation(
            id=uuid.uuid4(),
            excerpt_id=excerpt.id,
            knowledge_item_id=knowledge_item.id,
            annotator_id=user.id,
            annotator_role=AnnotatorRole.external,
            phase=AnnotationPhase.cross_annotation,
            do_not_surface=False,
            window_start_id=turns[0].id,
            window_end_id=turns[4].id,
            best_turn_id=turns[1].id,  # turn 2
        )
        db.add(cross_ann)
        await db.flush()

        # Deliberation revision: best = turn 5  (should supersede)
        delib_ann = Annotation(
            id=uuid.uuid4(),
            excerpt_id=excerpt.id,
            knowledge_item_id=knowledge_item.id,
            annotator_id=user.id,
            annotator_role=AnnotatorRole.external,
            phase=AnnotationPhase.deliberation,
            do_not_surface=False,
            window_start_id=turns[2].id,
            window_end_id=turns[7].id,
            best_turn_id=turns[4].id,  # turn 5
            revision_of_id=cross_ann.id,
        )
        db.add(delib_ann)
        await db.commit()

        result = await compute_consensus_window(db, excerpt.id, knowledge_item.id)

        # Only one annotator, so the result should use the deliberation values
        assert result["consensus_best_turn_number"] == 5
        assert result["consensus_start_turn_number"] == 3
        assert result["consensus_end_turn_number"] == 8

    @pytest.mark.asyncio
    async def test_single_annotator(
        self, db, excerpt, knowledge_item, turns, external_annotator
    ):
        """A single annotator should still produce a result."""
        ann = Annotation(
            id=uuid.uuid4(),
            excerpt_id=excerpt.id,
            knowledge_item_id=knowledge_item.id,
            annotator_id=external_annotator.id,
            annotator_role=AnnotatorRole.external,
            phase=AnnotationPhase.cross_annotation,
            do_not_surface=False,
            window_start_id=turns[2].id,
            window_end_id=turns[6].id,
            best_turn_id=turns[4].id,
        )
        db.add(ann)
        await db.commit()

        result = await compute_consensus_window(db, excerpt.id, knowledge_item.id)

        # Single annotator: agreement should be 1.0 (1 out of 1 within +/-1)
        assert result["annotator_agreement"] == pytest.approx(1.0)
        assert result["consensus_best_turn_number"] == 5
        assert result["status"] == ConsensusStatus.well_defined.value

    @pytest.mark.asyncio
    async def test_no_annotations_raises(
        self, db, excerpt, knowledge_item, turns
    ):
        """No annotations -> raises ValueError."""
        with pytest.raises(ValueError, match="No annotations found"):
            await compute_consensus_window(db, excerpt.id, knowledge_item.id)

    @pytest.mark.asyncio
    async def test_upsert_updates_existing(
        self, db, excerpt, knowledge_item, turns, external_annotator
    ):
        """Running compute_consensus_window twice upserts (updates) rather
        than creating duplicate ConsensusWindow records."""
        ann = Annotation(
            id=uuid.uuid4(),
            excerpt_id=excerpt.id,
            knowledge_item_id=knowledge_item.id,
            annotator_id=external_annotator.id,
            annotator_role=AnnotatorRole.external,
            phase=AnnotationPhase.cross_annotation,
            do_not_surface=False,
            window_start_id=turns[2].id,
            window_end_id=turns[6].id,
            best_turn_id=turns[4].id,
        )
        db.add(ann)
        await db.commit()

        result1 = await compute_consensus_window(db, excerpt.id, knowledge_item.id)
        result2 = await compute_consensus_window(db, excerpt.id, knowledge_item.id)

        # Same record was updated, not duplicated
        assert result1["id"] == result2["id"]


# ===================================================================
# Tests for compute_consensus_ranking (async, needs DB)
# ===================================================================


class TestComputeConsensusRanking:
    """Integration tests for compute_consensus_ranking (Borda count)."""

    @pytest.mark.asyncio
    async def test_similar_rankings_high_agreement(
        self, db, excerpt, knowledge_item, turns, external_annotator
    ):
        """Multiple raters with identical rankings -> high Borda agreement."""
        ann1 = external_annotator
        ann2 = await _make_annotator(db, "Ranker2")
        ann3 = await _make_annotator(db, "Ranker3")

        item_id_str = str(knowledge_item.id)

        for user in [ann1, ann2, ann3]:
            pr = PriorityRanking(
                id=uuid.uuid4(),
                excerpt_id=excerpt.id,
                annotator_id=user.id,
                phase=AnnotationPhase.cross_annotation,
                ranked_items=[
                    {
                        "knowledge_item_id": item_id_str,
                        "rank": 1,
                        "chosen_best_turn_number": 5,
                    },
                ],
            )
            db.add(pr)
        await db.commit()

        result = await compute_consensus_ranking(db, excerpt.id)

        assert result["method"] == "borda_count"
        assert len(result["ranked_items"]) == 1
        assert result["ranked_items"][0]["rank"] == 1
        assert result["ranked_items"][0]["knowledge_item_id"] == item_id_str
        # With a single item, Kendall's W returns 0.0 (fewer than 2 items)
        assert result["agreement_score"] == pytest.approx(0.0)

    @pytest.mark.asyncio
    async def test_multiple_items_borda_ranking(
        self, db, excerpt, knowledge_item, turns, external_annotator
    ):
        """Multiple items ranked by multiple raters; check Borda ordering."""
        ann1 = external_annotator
        ann2 = await _make_annotator(db, "Ranker2")

        item_a = str(knowledge_item.id)
        item_b = str(uuid.uuid4())  # fake item id (no FK constraint used)

        # Both raters agree: item_a is rank 1, item_b is rank 2
        for user in [ann1, ann2]:
            pr = PriorityRanking(
                id=uuid.uuid4(),
                excerpt_id=excerpt.id,
                annotator_id=user.id,
                phase=AnnotationPhase.cross_annotation,
                ranked_items=[
                    {
                        "knowledge_item_id": item_a,
                        "rank": 1,
                        "chosen_best_turn_number": 5,
                    },
                    {
                        "knowledge_item_id": item_b,
                        "rank": 2,
                        "chosen_best_turn_number": 3,
                    },
                ],
            )
            db.add(pr)
        await db.commit()

        result = await compute_consensus_ranking(db, excerpt.id)

        ranked = result["ranked_items"]
        assert len(ranked) == 2
        # item_a should be rank 1 (higher Borda)
        assert ranked[0]["knowledge_item_id"] == item_a
        assert ranked[0]["rank"] == 1
        assert ranked[1]["knowledge_item_id"] == item_b
        assert ranked[1]["rank"] == 2

        # Perfect agreement between 2 raters on 2 items -> W = 1.0
        assert result["agreement_score"] == pytest.approx(1.0)

    @pytest.mark.asyncio
    async def test_upsert_updates_existing_ranking(
        self, db, excerpt, knowledge_item, turns, external_annotator
    ):
        """Running compute_consensus_ranking twice updates the same record."""
        item_a = str(knowledge_item.id)

        pr = PriorityRanking(
            id=uuid.uuid4(),
            excerpt_id=excerpt.id,
            annotator_id=external_annotator.id,
            phase=AnnotationPhase.cross_annotation,
            ranked_items=[
                {
                    "knowledge_item_id": item_a,
                    "rank": 1,
                    "chosen_best_turn_number": 5,
                },
            ],
        )
        db.add(pr)
        await db.commit()

        result1 = await compute_consensus_ranking(db, excerpt.id)
        result2 = await compute_consensus_ranking(db, excerpt.id)

        assert result1["id"] == result2["id"]

    @pytest.mark.asyncio
    async def test_no_rankings_raises(self, db, excerpt, knowledge_item, turns):
        """No PriorityRanking records -> raises ValueError."""
        with pytest.raises(ValueError, match="No priority rankings found"):
            await compute_consensus_ranking(db, excerpt.id)

    @pytest.mark.asyncio
    async def test_disagreeing_raters(
        self, db, excerpt, knowledge_item, turns, external_annotator
    ):
        """Raters disagree on ordering -> lower Kendall's W."""
        ann1 = external_annotator
        ann2 = await _make_annotator(db, "Ranker2")

        item_a = str(knowledge_item.id)
        item_b = str(uuid.uuid4())

        # Rater 1: A=1, B=2.  Rater 2: A=2, B=1  (reversed)
        pr1 = PriorityRanking(
            id=uuid.uuid4(),
            excerpt_id=excerpt.id,
            annotator_id=ann1.id,
            phase=AnnotationPhase.cross_annotation,
            ranked_items=[
                {"knowledge_item_id": item_a, "rank": 1, "chosen_best_turn_number": 5},
                {"knowledge_item_id": item_b, "rank": 2, "chosen_best_turn_number": 3},
            ],
        )
        pr2 = PriorityRanking(
            id=uuid.uuid4(),
            excerpt_id=excerpt.id,
            annotator_id=ann2.id,
            phase=AnnotationPhase.cross_annotation,
            ranked_items=[
                {"knowledge_item_id": item_a, "rank": 2, "chosen_best_turn_number": 5},
                {"knowledge_item_id": item_b, "rank": 1, "chosen_best_turn_number": 3},
            ],
        )
        db.add(pr1)
        db.add(pr2)
        await db.commit()

        result = await compute_consensus_ranking(db, excerpt.id)

        # Perfectly reversed: W = 0.0
        assert result["agreement_score"] == pytest.approx(0.0)


# ===================================================================
# Tests for compute_all_consensus (async, needs DB)
# ===================================================================


class TestComputeAllConsensus:
    """Integration tests for compute_all_consensus."""

    @pytest.mark.asyncio
    async def test_with_multiple_excerpts(
        self, db, conversation, excerpt, knowledge_item, turns, external_annotator
    ):
        """Processes each excerpt + item pair and collects stats."""
        # Create annotation for our excerpt/item pair
        ann = Annotation(
            id=uuid.uuid4(),
            excerpt_id=excerpt.id,
            knowledge_item_id=knowledge_item.id,
            annotator_id=external_annotator.id,
            annotator_role=AnnotatorRole.external,
            phase=AnnotationPhase.cross_annotation,
            do_not_surface=False,
            window_start_id=turns[2].id,
            window_end_id=turns[6].id,
            best_turn_id=turns[4].id,
        )
        db.add(ann)

        # Also create a PriorityRanking so the ranking step succeeds
        pr = PriorityRanking(
            id=uuid.uuid4(),
            excerpt_id=excerpt.id,
            annotator_id=external_annotator.id,
            phase=AnnotationPhase.cross_annotation,
            ranked_items=[
                {
                    "knowledge_item_id": str(knowledge_item.id),
                    "rank": 1,
                    "chosen_best_turn_number": 5,
                },
            ],
        )
        db.add(pr)
        await db.commit()

        result = await compute_all_consensus(db, conversation.id)

        assert result["conversation_id"] == str(conversation.id)
        assert result["total_pairs"] == 1
        assert result["well_defined"] + result["contested"] + result["do_not_surface"] == 1
        assert result["ranking_count"] == 1
        assert result["errors"] == []

    @pytest.mark.asyncio
    async def test_no_excerpts_returns_empty(
        self, db, conversation, turns
    ):
        """A conversation with no excerpts -> empty stats, no errors."""
        # Remove the excerpt fixture dependency; conversation has no excerpts
        # by itself (excerpt is created via fixture which we did NOT include).
        # We need a fresh conversation with no excerpts.
        from app.models.conversation import Conversation

        empty_conv = Conversation(
            id=uuid.uuid4(),
            group_id=conversation.group_id,
        )
        db.add(empty_conv)
        await db.commit()

        result = await compute_all_consensus(db, empty_conv.id)

        assert result["total_pairs"] == 0
        assert result["well_defined"] == 0
        assert result["contested"] == 0
        assert result["do_not_surface"] == 0
        assert result["ranking_count"] == 0
        assert result["errors"] == []

    @pytest.mark.asyncio
    async def test_errors_in_some_pairs_still_continues(
        self, db, conversation, excerpt, knowledge_item, turns, external_annotator
    ):
        """When ranking computation fails, compute_all_consensus reports the
        error and continues."""
        # Create an annotation so the window computation succeeds
        ann = Annotation(
            id=uuid.uuid4(),
            excerpt_id=excerpt.id,
            knowledge_item_id=knowledge_item.id,
            annotator_id=external_annotator.id,
            annotator_role=AnnotatorRole.external,
            phase=AnnotationPhase.cross_annotation,
            do_not_surface=False,
            window_start_id=turns[2].id,
            window_end_id=turns[6].id,
            best_turn_id=turns[4].id,
        )
        db.add(ann)
        await db.commit()
        # Do NOT create PriorityRankings -> ranking step will fail

        result = await compute_all_consensus(db, conversation.id)

        assert result["total_pairs"] == 1
        # The window should succeed
        assert result["well_defined"] + result["contested"] + result["do_not_surface"] == 1
        # The ranking should have errored
        assert result["ranking_count"] == 0
        assert len(result["errors"]) == 1
        assert "No priority rankings found" in result["errors"][0]
