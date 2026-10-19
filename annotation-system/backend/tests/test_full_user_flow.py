"""End-to-end integration test simulating a full PITCH annotation pilot study.

Topic: Sociotechnical AI Governance
Speakers: Amy, Teanna, Zunairah

Phases exercised:
1. Admin setup (create prompt, group)
2. Participant login (join group via join_code)
3. Researcher creates conversation
4. Conversation phase (7 turns via REST, flags on turns)
5. End conversation → construction phase
6. Construction phase (5 knowledge items created by participants)
7. Admin reviews items (approve with neutralized text)
8. Admin transitions to cross_annotation
9. Cross-annotation (another participant annotates items)
10. Priority ranking
"""

import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import StaticPool, event
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
from app.models.user import User
from app.models.enums import UserRole

# ---------------------------------------------------------------------------
# Self-contained fixtures (no dependency on conftest)
# ---------------------------------------------------------------------------

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

_engine = create_async_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(_engine.sync_engine, "connect")
def _enable_sqlite_fks(dbapi_connection, _connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


_TestSession = async_sessionmaker(
    _engine, class_=AsyncSession, expire_on_commit=False
)


@pytest_asyncio.fixture(autouse=True)
async def setup_database():
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def _override_get_db():
    async with _TestSession() as session:
        yield session


@pytest_asyncio.fixture
async def client() -> AsyncClient:
    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_token(user_id: str, role: str) -> str:
    return create_access_token({"user_id": user_id, "role": role})


# ---------------------------------------------------------------------------
# Conversation content
# ---------------------------------------------------------------------------

TOPIC = (
    "How should decisions about AI system behavior be made, and by whom? "
    "Consider stakeholders, governance mechanisms, and how to anticipate harms."
)

TURNS = [
    ("Amy", "What about this question: What makes AI governance 'sociotechnical' vs. purely technical or purely social? What do you think?"),
    ("Teanna", "That's a good question. I think it's because the topic is inherently interdisciplinary (combines legal and computing techniques)."),
    ("Zunairah", "I think that it really is about understanding how AI is used and creating laws for AI governance based on the usage. So, it starts out exploring the social implications but creating rules for AI is technical. It combines both ideas, so AI governance is 'sociotechnical'."),
    ("Amy", "Do you think AI governance today needs more technical or social progress? Any interesting papers you've seen? Particularly work that combines the two well?"),
    ("Teanna", "I think it needs more social progress, especially in the US context in which AI regulation is much harder. This is not an exact paper but a plenary session at FAccT last year talked about how the EU AI Act failed because it wasn't the best interpretation of rights-based policymaking. (heavily paraphrasing)"),
    ("Zunairah", "There is a lot of understanding of the impacts of AI, but not a lot of rules for it, so I think AI governance needs to be more technical. What do you think?"),
    ("Amy", "On the technical side, I remember this paper: https://cdn.governance.ai/Open_Problems_in_Technical_AI_Governance.pdf"),
]

# Knowledge items to create (each assigned to a speaker)
KNOWLEDGE_ITEMS = [
    {
        "label": "K1",
        "speaker": "Amy",
        "raw_ideal_response": "Yes, CS, ethics, law, HCI could all inform the sociotechnical governance of AI.",
        "window_start": 1,
        "window_end": 3,
        "best_turn": 2,
        "contribution_type": "heads_up",
        "pertinence": 0.7,
        "neutralized": "Computer science, ethics, law, and human-computer interaction are among the disciplines that inform sociotechnical AI governance.",
    },
    {
        "label": "K2",
        "speaker": "Teanna",
        "raw_ideal_response": "Exactly, there's a paper arguing that 'The rule of law is dependent on natural language in order to be comprehended,' but 'AI has rules, however these rules are the rules of mathematics and statistics,' so the two kinds of rules are not naturally compatible, which might be a fundamental challenge of sociotechnical governance of AI.",
        "window_start": 3,
        "window_end": 4,
        "best_turn": 3,
        "contribution_type": "pushback",
        "pertinence": 0.8,
        "neutralized": "There is a fundamental tension between the natural-language basis of legal rules and the mathematical rules governing AI systems, which presents a challenge for sociotechnical governance.",
    },
    {
        "label": "K3",
        "speaker": "Zunairah",
        "raw_ideal_response": "Here's an example of such a paper! 'AI will fix this' — The Technical, Discursive, and Political Turn to AI in Governing Communication. Big Data & Society 8 (2021).",
        "window_start": 4,
        "window_end": 5,
        "best_turn": 4,
        "contribution_type": "suggestion",
        "pertinence": 0.9,
        "neutralized": "Katzenbach (2021) discusses AI as a governance tool for digital communication and the need to integrate technical deployment with social regulation.",
    },
    {
        "label": "K4",
        "speaker": "Amy",
        "raw_ideal_response": "Here's the title and abstract of the keynote: Regulating AI: Lessons from Emerging Legal Frameworks — Nathalie Smuha, KU Leuven.",
        "window_start": 5,
        "window_end": 6,
        "best_turn": 5,
        "contribution_type": "suggestion",
        "pertinence": 0.85,
        "neutralized": "Smuha's keynote at FAccT explored lessons from emerging AI legal frameworks, with a focus on the EU AI Act as a case study.",
    },
    {
        "label": "K5",
        "speaker": "Teanna",
        "raw_ideal_response": "That's a great point! Many recent papers did suggest this problem: Existing frameworks lack clarity on how regulations translate into conformity mechanisms, leading to gaps in compliance and enforcement.",
        "window_start": 6,
        "window_end": 7,
        "best_turn": 6,
        "contribution_type": "pushback",
        "pertinence": 0.75,
        "neutralized": "Multiple studies note that existing AI governance frameworks remain too abstract, creating recurring gaps between ethical ideals and practical implementation.",
    },
]


# ---------------------------------------------------------------------------
# Test class
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestFullUserFlow:
    """Simulate the complete study lifecycle from admin setup through annotation."""

    # -----------------------------------------------------------------------
    # Phase 0: Admin setup — create researcher, prompt, group
    # -----------------------------------------------------------------------

    async def test_full_flow(self, client: AsyncClient):
        print("\n=== PHASE 0: Admin setup ===")

        # 0a. Seed a researcher directly via the database override
        async with _TestSession() as db:
            researcher = User(
                name="Dr. Researcher",
                email="researcher@pitch.test",
                role=UserRole.researcher,
                password_hash=hash_password("researchpass"),
            )
            db.add(researcher)
            await db.commit()
            await db.refresh(researcher)
            researcher_id = str(researcher.id)
        researcher_token = _make_token(researcher_id, "researcher")

        # 0b. Login as researcher (verify the auth endpoint works)
        resp = await client.post(
            "/api/auth/login/researcher",
            json={"email": "researcher@pitch.test", "password": "researchpass"},
        )
        assert resp.status_code == 200, f"Researcher login failed: {resp.text}"
        login_data = resp.json()
        assert login_data["user"]["role"] == "researcher"
        assert "access_token" in login_data
        researcher_token = login_data["access_token"]
        print(f"  Researcher logged in: {login_data['user']['name']}")

        # 0c. Create a discussion prompt
        resp = await client.post(
            "/api/admin/prompts",
            json={"scenario": "scholarly", "text": TOPIC},
            headers=_auth(researcher_token),
        )
        assert resp.status_code == 201, f"Create prompt failed: {resp.text}"
        prompt = resp.json()
        prompt_id = prompt["id"]
        print(f"  Created prompt: {prompt_id[:8]}...")

        # 0d. Create a study group
        resp = await client.post(
            "/api/admin/groups",
            json={"scenario": "scholarly", "prompt_id": prompt_id},
            headers=_auth(researcher_token),
        )
        assert resp.status_code == 201, f"Create group failed: {resp.text}"
        group = resp.json()
        group_id = group["id"]
        join_code = group["join_code"]
        assert group["status"] == "conversation"
        print(f"  Created group: {group_id[:8]}... join_code={join_code}")

        # -----------------------------------------------------------------------
        # Phase 1: Participants join via join_code
        # -----------------------------------------------------------------------
        print("\n=== PHASE 1: Participants join ===")

        participant_tokens = {}
        participant_ids = {}
        for name in ["Amy", "Teanna", "Zunairah"]:
            resp = await client.post(
                "/api/auth/login/participant",
                json={"name": name, "join_code": join_code},
            )
            assert resp.status_code == 200, f"Participant login failed for {name}: {resp.text}"
            data = resp.json()
            participant_tokens[name] = data["access_token"]
            participant_ids[name] = data["user"]["id"]
            assert data["user"]["role"] == "participant"
            print(f"  {name} joined (id={data['user']['id'][:8]}...)")

        # -----------------------------------------------------------------------
        # Phase 2: Researcher creates a conversation
        # -----------------------------------------------------------------------
        print("\n=== PHASE 2: Create conversation ===")

        resp = await client.post(
            "/api/conversations/",
            json={"group_id": group_id},
            headers=_auth(researcher_token),
        )
        assert resp.status_code == 201, f"Create conversation failed: {resp.text}"
        conversation = resp.json()
        conv_id = conversation["id"]
        print(f"  Conversation created: {conv_id[:8]}...")

        # -----------------------------------------------------------------------
        # Phase 3: Conversation — send messages via REST (simulating WS)
        # Turns are sent through the conversation_service directly since
        # we can't easily test WebSocket with httpx.
        # We'll use the service layer via the DB session.
        # -----------------------------------------------------------------------
        print("\n=== PHASE 3: Conversation (sending turns) ===")

        turn_ids = []
        from app.services import conversation_service

        for i, (speaker, text) in enumerate(TURNS, start=1):
            async with _TestSession() as db:
                turn = await conversation_service.create_turn(
                    db,
                    conv_id,
                    participant_ids[speaker],
                    text,
                )
                turn_ids.append(str(turn.id))
                print(f"  Turn {turn.turn_number}: [{speaker}] {text[:60]}...")

        # Verify turns via GET endpoint
        resp = await client.get(
            f"/api/conversations/{conv_id}/turns",
            headers=_auth(participant_tokens["Amy"]),
        )
        assert resp.status_code == 200
        turns_data = resp.json()
        assert len(turns_data) == 7, f"Expected 7 turns, got {len(turns_data)}"
        print(f"  Verified {len(turns_data)} turns via GET endpoint")

        # Verify conversation detail
        resp = await client.get(
            f"/api/conversations/{conv_id}",
            headers=_auth(participant_tokens["Amy"]),
        )
        assert resp.status_code == 200
        detail = resp.json()
        assert len(detail["turns"]) == 7

        # -----------------------------------------------------------------------
        # Phase 3b: Flags — participants flag interesting moments
        # -----------------------------------------------------------------------
        print("\n=== PHASE 3b: Flags (inline annotations) ===")

        # Amy flags turn 2 (Teanna's interdisciplinary point)
        resp = await client.post(
            f"/api/conversations/{conv_id}/flags",
            json={"turn_id": turn_ids[1]},  # turn 2
            headers=_auth(participant_tokens["Amy"]),
        )
        assert resp.status_code == 201, f"Flag creation failed: {resp.text}"
        flag1 = resp.json()
        print(f"  Amy flagged turn 2: flag_id={flag1['id'][:8]}...")

        # Teanna flags turn 3 (Zunairah's sociotechnical definition)
        resp = await client.post(
            f"/api/conversations/{conv_id}/flags",
            json={"turn_id": turn_ids[2]},  # turn 3
            headers=_auth(participant_tokens["Teanna"]),
        )
        assert resp.status_code == 201
        flag2 = resp.json()
        print(f"  Teanna flagged turn 3: flag_id={flag2['id'][:8]}...")

        # Zunairah flags turn 5 (Teanna's FAccT reference)
        resp = await client.post(
            f"/api/conversations/{conv_id}/flags",
            json={"turn_id": turn_ids[4]},  # turn 5
            headers=_auth(participant_tokens["Zunairah"]),
        )
        assert resp.status_code == 201
        flag3 = resp.json()
        print(f"  Zunairah flagged turn 5: flag_id={flag3['id'][:8]}...")

        # Amy also flags turn 6 (Zunairah asking for more technical governance)
        resp = await client.post(
            f"/api/conversations/{conv_id}/flags",
            json={"turn_id": turn_ids[5]},  # turn 6
            headers=_auth(participant_tokens["Amy"]),
        )
        assert resp.status_code == 201
        flag4 = resp.json()
        print(f"  Amy flagged turn 6: flag_id={flag4['id'][:8]}...")

        # Verify flags per participant
        resp = await client.get(
            f"/api/conversations/{conv_id}/flags",
            headers=_auth(participant_tokens["Amy"]),
        )
        assert resp.status_code == 200
        amy_flags = resp.json()
        assert len(amy_flags) == 2, f"Expected 2 Amy flags, got {len(amy_flags)}"
        print(f"  Amy's flags count: {len(amy_flags)}")

        resp = await client.get(
            f"/api/conversations/{conv_id}/flags",
            headers=_auth(participant_tokens["Teanna"]),
        )
        assert resp.status_code == 200
        teanna_flags = resp.json()
        assert len(teanna_flags) == 1
        print(f"  Teanna's flags count: {len(teanna_flags)}")

        # -----------------------------------------------------------------------
        # Phase 4: End conversation → construction
        # -----------------------------------------------------------------------
        print("\n=== PHASE 4: End conversation ===")

        resp = await client.post(
            f"/api/conversations/{conv_id}/end",
            headers=_auth(researcher_token),
        )
        assert resp.status_code == 200, f"End conversation failed: {resp.text}"
        ended = resp.json()
        assert ended["ended_at"] is not None
        print(f"  Conversation ended at {ended['ended_at']}")

        # Verify group transitioned to construction
        resp = await client.get(
            "/api/admin/groups",
            headers=_auth(researcher_token),
        )
        assert resp.status_code == 200
        groups = resp.json()
        our_group = [g for g in groups if g["id"] == group_id][0]
        assert our_group["status"] == "construction"
        print(f"  Group status: {our_group['status']}")

        # -----------------------------------------------------------------------
        # Phase 5: Construction — participants create knowledge items
        # -----------------------------------------------------------------------
        print("\n=== PHASE 5: Construction (knowledge items) ===")

        # First, verify transcript is accessible in construction phase
        resp = await client.get(
            f"/api/construction/{conv_id}/transcript",
            headers=_auth(participant_tokens["Amy"]),
        )
        assert resp.status_code == 200, f"Get transcript failed: {resp.text}"
        transcript = resp.json()
        assert len(transcript["turns"]) == 7
        # Verify Amy's flags show up
        amy_flagged = [t for t in transcript["turns"] if t["flagged"]]
        assert len(amy_flagged) == 2, f"Expected 2 flagged turns for Amy, got {len(amy_flagged)}"
        print(f"  Transcript loaded: {len(transcript['turns'])} turns, {len(amy_flagged)} flagged by Amy")

        # Create knowledge items (each by the speaker designated in the test data)
        created_items = {}
        for ki in KNOWLEDGE_ITEMS:
            speaker = ki["speaker"]
            token = participant_tokens[speaker]
            resp = await client.post(
                f"/api/construction/{conv_id}/items",
                json={
                    "raw_ideal_response": ki["raw_ideal_response"],
                    "window_start_turn_number": ki["window_start"],
                    "window_end_turn_number": ki["window_end"],
                    "best_turn_number": ki["best_turn"],
                    "contribution_type": ki["contribution_type"],
                    "pertinence": ki["pertinence"],
                },
                headers=_auth(token),
            )
            assert resp.status_code == 201, f"Create item {ki['label']} failed: {resp.text}"
            item_data = resp.json()
            created_items[ki["label"]] = item_data
            assert item_data["source"] == "participant"
            assert item_data["review_status"] == "pending"
            assert item_data["window_start_turn_number"] == ki["window_start"]
            assert item_data["window_end_turn_number"] == ki["window_end"]
            assert item_data["best_turn_number"] == ki["best_turn"]
            print(f"  {ki['label']} created by {speaker}: item_id={item_data['id'][:8]}... type={ki['contribution_type']}")

        # Verify Amy can list her items
        resp = await client.get(
            f"/api/construction/{conv_id}/items",
            headers=_auth(participant_tokens["Amy"]),
        )
        assert resp.status_code == 200
        amy_items = resp.json()
        assert len(amy_items) == 2  # K1, K4 are by Amy
        print(f"  Amy's items: {len(amy_items)}")

        # Verify Teanna can list her items
        resp = await client.get(
            f"/api/construction/{conv_id}/items",
            headers=_auth(participant_tokens["Teanna"]),
        )
        assert resp.status_code == 200
        teanna_items = resp.json()
        assert len(teanna_items) == 2  # K2, K5 are by Teanna
        print(f"  Teanna's items: {len(teanna_items)}")

        # Test updating an item (Amy updates K1's pertinence)
        k1_id = created_items["K1"]["id"]
        resp = await client.put(
            f"/api/construction/items/{k1_id}",
            json={"pertinence": 0.8},
            headers=_auth(participant_tokens["Amy"]),
        )
        assert resp.status_code == 200, f"Update item failed: {resp.text}"
        updated = resp.json()
        assert updated["pertinence"] == 0.8
        print(f"  Updated K1 pertinence to 0.8")

        # -----------------------------------------------------------------------
        # Phase 6: Admin reviews knowledge items (neutralization)
        # -----------------------------------------------------------------------
        print("\n=== PHASE 6: Admin review & neutralization ===")

        # Transition to neutralization phase
        resp = await client.post(
            f"/api/admin/groups/{group_id}/transition",
            json={"target_status": "neutralization"},
            headers=_auth(researcher_token),
        )
        assert resp.status_code == 200, f"Transition failed: {resp.text}"
        print(f"  Transitioned to neutralization")

        # Get all items for review
        resp = await client.get(
            "/api/admin/items",
            headers=_auth(researcher_token),
        )
        assert resp.status_code == 200
        review_items = resp.json()
        assert len(review_items) == 5
        print(f"  Items for review: {len(review_items)}")

        # Approve each item with the neutralized text
        for ki in KNOWLEDGE_ITEMS:
            item_id = created_items[ki["label"]]["id"]
            resp = await client.put(
                f"/api/admin/items/{item_id}/review",
                json={
                    "action": "edit",
                    "edited_neutralized_response": ki["neutralized"],
                },
                headers=_auth(researcher_token),
            )
            assert resp.status_code == 200, f"Review {ki['label']} failed: {resp.text}"
            reviewed = resp.json()
            assert reviewed["review_status"] == "approved"
            assert reviewed["neutralized_ideal_response"] == ki["neutralized"]
            print(f"  {ki['label']} approved with neutralized response")

        # -----------------------------------------------------------------------
        # Phase 7: Transition to cross_annotation
        # -----------------------------------------------------------------------
        print("\n=== PHASE 7: Cross-annotation phase ===")

        resp = await client.post(
            f"/api/admin/groups/{group_id}/transition",
            json={"target_status": "cross_annotation"},
            headers=_auth(researcher_token),
        )
        assert resp.status_code == 200
        print(f"  Transitioned to cross_annotation")

        # Check assignments for Teanna (she should see items NOT authored by her)
        resp = await client.get(
            "/api/annotation/assignments",
            headers=_auth(participant_tokens["Teanna"]),
        )
        assert resp.status_code == 200, f"Get assignments failed: {resp.text}"
        teanna_assignments = resp.json()
        # Teanna authored K2 and K5, so she should see K1, K3, K4
        assert len(teanna_assignments) == 3, (
            f"Expected 3 assignments for Teanna, got {len(teanna_assignments)}"
        )
        print(f"  Teanna's assignments: {len(teanna_assignments)} items to annotate")

        # Check assignments for Amy
        resp = await client.get(
            "/api/annotation/assignments",
            headers=_auth(participant_tokens["Amy"]),
        )
        assert resp.status_code == 200
        amy_assignments = resp.json()
        # Amy authored K1 and K4, so she should see K2, K3, K5
        assert len(amy_assignments) == 3
        print(f"  Amy's assignments: {len(amy_assignments)} items to annotate")

        # Check assignments for Zunairah
        resp = await client.get(
            "/api/annotation/assignments",
            headers=_auth(participant_tokens["Zunairah"]),
        )
        assert resp.status_code == 200
        zunairah_assignments = resp.json()
        # Zunairah authored K3, so she should see K1, K2, K4, K5
        assert len(zunairah_assignments) == 4
        print(f"  Zunairah's assignments: {len(zunairah_assignments)} items to annotate")

        # -----------------------------------------------------------------------
        # Phase 7b: View excerpt detail and create annotations
        # -----------------------------------------------------------------------
        print("\n=== PHASE 7b: Annotating items ===")

        # Teanna annotates her first assignment (should be an item she didn't author)
        first_assignment = teanna_assignments[0]
        excerpt_id = first_assignment["excerpt_id"]
        ki_id = first_assignment["knowledge_item_id"]

        # Get excerpt detail (frontend: clicking on assignment card)
        resp = await client.get(
            f"/api/annotation/excerpts/{excerpt_id}",
            headers=_auth(participant_tokens["Teanna"]),
        )
        assert resp.status_code == 200, f"Get excerpt failed: {resp.text}"
        excerpt_detail = resp.json()
        assert len(excerpt_detail["turns"]) > 0
        assert excerpt_detail["knowledge_item"] is not None
        print(f"  Excerpt loaded: {len(excerpt_detail['turns'])} turns, item type={first_assignment['item_contribution_type']}")

        # Teanna places her annotation (3-click: window_start, window_end, best_turn)
        excerpt_start = excerpt_detail["start_turn_number"]
        excerpt_end = excerpt_detail["end_turn_number"]
        mid = (excerpt_start + excerpt_end) // 2

        resp = await client.post(
            "/api/annotation/",
            json={
                "excerpt_id": excerpt_id,
                "knowledge_item_id": ki_id,
                "window_start_turn_number": excerpt_start,
                "window_end_turn_number": mid,
                "best_turn_number": excerpt_start,
                "do_not_surface": False,
                "extends_before": False,
                "extends_after": False,
                "rationale": "The knowledge item is relevant early in the excerpt.",
            },
            headers=_auth(participant_tokens["Teanna"]),
        )
        assert resp.status_code == 201, f"Create annotation failed: {resp.text}"
        annotation1 = resp.json()
        assert annotation1["annotator_role"] == "within_group"
        assert annotation1["phase"] == "cross_annotation"
        print(f"  Teanna created annotation: window=[{excerpt_start},{mid}], best={excerpt_start}")

        # Teanna annotates all remaining assignments
        for i, assignment in enumerate(teanna_assignments[1:], start=2):
            a_excerpt_id = assignment["excerpt_id"]
            a_ki_id = assignment["knowledge_item_id"]

            # Get excerpt detail
            resp = await client.get(
                f"/api/annotation/excerpts/{a_excerpt_id}",
                headers=_auth(participant_tokens["Teanna"]),
            )
            assert resp.status_code == 200
            a_detail = resp.json()
            a_start = a_detail["start_turn_number"]
            a_end = a_detail["end_turn_number"]
            a_mid = (a_start + a_end) // 2

            resp = await client.post(
                "/api/annotation/",
                json={
                    "excerpt_id": a_excerpt_id,
                    "knowledge_item_id": a_ki_id,
                    "window_start_turn_number": a_start,
                    "window_end_turn_number": a_mid,
                    "best_turn_number": a_start,
                    "do_not_surface": False,
                    "extends_before": False,
                    "extends_after": False,
                    "rationale": f"Annotation for assignment {i}",
                },
                headers=_auth(participant_tokens["Teanna"]),
            )
            assert resp.status_code == 201, f"Annotation {i} failed: {resp.text}"
            print(f"  Teanna annotated assignment {i}: excerpt={a_excerpt_id[:8]}...")

        # Verify progress
        resp = await client.get(
            "/api/annotation/progress",
            headers=_auth(participant_tokens["Teanna"]),
        )
        assert resp.status_code == 200
        progress = resp.json()
        assert progress["completed"] == 3
        assert progress["pending"] == 0
        print(f"  Teanna's progress: {progress['completed']}/{progress['total']} complete")

        # Amy annotates all her assignments
        for i, assignment in enumerate(amy_assignments, start=1):
            a_excerpt_id = assignment["excerpt_id"]
            a_ki_id = assignment["knowledge_item_id"]

            resp = await client.get(
                f"/api/annotation/excerpts/{a_excerpt_id}",
                headers=_auth(participant_tokens["Amy"]),
            )
            assert resp.status_code == 200
            a_detail = resp.json()
            a_start = a_detail["start_turn_number"]
            a_end = a_detail["end_turn_number"]

            resp = await client.post(
                "/api/annotation/",
                json={
                    "excerpt_id": a_excerpt_id,
                    "knowledge_item_id": a_ki_id,
                    "window_start_turn_number": a_start + 1 if a_start + 1 <= a_end else a_start,
                    "window_end_turn_number": a_end,
                    "best_turn_number": a_end,
                    "do_not_surface": False,
                    "extends_before": True,
                    "extends_after": False,
                    "rationale": f"Amy's annotation {i} - the item is relevant toward the end of excerpt.",
                },
                headers=_auth(participant_tokens["Amy"]),
            )
            assert resp.status_code == 201, f"Amy annotation {i} failed: {resp.text}"
            print(f"  Amy annotated assignment {i}")

        resp = await client.get(
            "/api/annotation/progress",
            headers=_auth(participant_tokens["Amy"]),
        )
        assert resp.status_code == 200
        amy_progress = resp.json()
        assert amy_progress["completed"] == 3
        print(f"  Amy's progress: {amy_progress['completed']}/{amy_progress['total']} complete")

        # Zunairah annotates — mark one as "do not surface"
        for i, assignment in enumerate(zunairah_assignments, start=1):
            a_excerpt_id = assignment["excerpt_id"]
            a_ki_id = assignment["knowledge_item_id"]

            resp = await client.get(
                f"/api/annotation/excerpts/{a_excerpt_id}",
                headers=_auth(participant_tokens["Zunairah"]),
            )
            assert resp.status_code == 200
            a_detail = resp.json()
            a_start = a_detail["start_turn_number"]
            a_end = a_detail["end_turn_number"]

            if i == 3:
                # Mark the 3rd assignment as "do not surface"
                resp = await client.post(
                    "/api/annotation/",
                    json={
                        "excerpt_id": a_excerpt_id,
                        "knowledge_item_id": a_ki_id,
                        "do_not_surface": True,
                        "rationale": "I don't think this knowledge item adds value to the conversation at this point.",
                    },
                    headers=_auth(participant_tokens["Zunairah"]),
                )
            else:
                resp = await client.post(
                    "/api/annotation/",
                    json={
                        "excerpt_id": a_excerpt_id,
                        "knowledge_item_id": a_ki_id,
                        "window_start_turn_number": a_start,
                        "window_end_turn_number": a_end,
                        "best_turn_number": (a_start + a_end) // 2,
                        "do_not_surface": False,
                        "extends_before": False,
                        "extends_after": True,
                        "rationale": f"Zunairah's annotation {i}",
                    },
                    headers=_auth(participant_tokens["Zunairah"]),
                )
            assert resp.status_code == 201, f"Zunairah annotation {i} failed: {resp.text}"
            ann = resp.json()
            if i == 3:
                assert ann["do_not_surface"] is True
                print(f"  Zunairah marked assignment {i} as DO NOT SURFACE")
            else:
                print(f"  Zunairah annotated assignment {i}")

        resp = await client.get(
            "/api/annotation/progress",
            headers=_auth(participant_tokens["Zunairah"]),
        )
        assert resp.status_code == 200
        z_progress = resp.json()
        assert z_progress["completed"] == 4
        print(f"  Zunairah's progress: {z_progress['completed']}/{z_progress['total']} complete")

        # -----------------------------------------------------------------------
        # Phase 7c: Priority ranking
        # -----------------------------------------------------------------------
        print("\n=== PHASE 7c: Priority ranking ===")

        # Get the distinct excerpt IDs from Teanna's assignments
        teanna_excerpt_ids = list(set(a["excerpt_id"] for a in teanna_assignments))

        for excerpt_id in teanna_excerpt_ids:
            # Get the items for this excerpt
            items_in_excerpt = [
                a for a in teanna_assignments if a["excerpt_id"] == excerpt_id
            ]
            if len(items_in_excerpt) < 1:
                continue

            ranked = []
            for rank, assignment in enumerate(items_in_excerpt, start=1):
                a_ki_id = assignment["knowledge_item_id"]
                # Use the excerpt start turn as chosen_best_turn_number
                a_start = assignment["excerpt_start_turn"]
                ranked.append({
                    "knowledge_item_id": a_ki_id,
                    "rank": rank,
                    "chosen_best_turn_number": a_start,
                })

            resp = await client.post(
                f"/api/annotation/excerpts/{excerpt_id}/ranking",
                json={"ranked_items": ranked},
                headers=_auth(participant_tokens["Teanna"]),
            )
            assert resp.status_code == 201, f"Ranking failed: {resp.text}"
            ranking_data = resp.json()
            print(f"  Teanna submitted ranking for excerpt {excerpt_id[:8]}...: {len(ranked)} items ranked")

        # -----------------------------------------------------------------------
        # Phase 8: Transition to deliberation
        # -----------------------------------------------------------------------
        print("\n=== PHASE 8: Deliberation ===")

        resp = await client.post(
            f"/api/admin/groups/{group_id}/transition",
            json={"target_status": "deliberation"},
            headers=_auth(researcher_token),
        )
        assert resp.status_code == 200
        print(f"  Transitioned to deliberation")

        # Teanna views peer annotations for her first assignment
        first_exc_id = teanna_assignments[0]["excerpt_id"]
        first_ki_id = teanna_assignments[0]["knowledge_item_id"]

        resp = await client.get(
            f"/api/deliberation/{first_exc_id}/peers",
            params={"knowledge_item_id": first_ki_id},
            headers=_auth(participant_tokens["Teanna"]),
        )
        assert resp.status_code == 200, f"Get peers failed: {resp.text}"
        peers = resp.json()
        assert "own_annotation" in peers
        assert "peers" in peers
        print(f"  Teanna sees {len(peers['peers'])} peer annotations")

        # Teanna gets her original annotation
        resp = await client.get(
            f"/api/deliberation/{first_exc_id}/my-original",
            params={"knowledge_item_id": first_ki_id},
            headers=_auth(participant_tokens["Teanna"]),
        )
        assert resp.status_code == 200, f"Get original failed: {resp.text}"
        original = resp.json()
        assert original["phase"] == "cross_annotation"
        print(f"  Teanna's original annotation retrieved")

        # Teanna revises her annotation based on peer feedback
        resp = await client.post(
            f"/api/deliberation/{first_exc_id}/revise",
            params={"knowledge_item_id": first_ki_id},
            json={
                "rationale": "After seeing peer annotations, I now think the window should be wider.",
            },
            headers=_auth(participant_tokens["Teanna"]),
        )
        assert resp.status_code == 200 or resp.status_code == 201, f"Revision failed: {resp.text}"
        revision = resp.json()
        assert revision["phase"] == "deliberation"
        assert revision["revision_of_id"] is not None
        print(f"  Teanna revised annotation: revision_id={revision['id'][:8]}...")

        # Log visibility
        resp = await client.post(
            f"/api/deliberation/{first_exc_id}/log-visibility",
            params={"knowledge_item_id": first_ki_id},
            json={"visible_annotation_ids": [peers["own_annotation"]["id"]]},
            headers=_auth(participant_tokens["Teanna"]),
        )
        assert resp.status_code == 200, f"Log visibility failed: {resp.text}"
        print(f"  Visibility logged")

        # -----------------------------------------------------------------------
        # Phase 9: Final checks and data integrity
        # -----------------------------------------------------------------------
        print("\n=== PHASE 9: Data integrity checks ===")

        # Check that all users exist
        resp = await client.get(
            "/api/admin/users",
            headers=_auth(researcher_token),
        )
        assert resp.status_code == 200
        users = resp.json()
        user_names = {u["name"] for u in users}
        assert "Amy" in user_names
        assert "Teanna" in user_names
        assert "Zunairah" in user_names
        print(f"  Users in system: {len(users)}")

        # Check excerpts exist for the conversation
        resp = await client.get(
            f"/api/admin/excerpts/{conv_id}",
            headers=_auth(researcher_token),
        )
        assert resp.status_code == 200
        excerpts = resp.json()
        assert len(excerpts) > 0
        print(f"  Excerpts for conversation: {len(excerpts)}")

        # Transition to complete
        resp = await client.post(
            f"/api/admin/groups/{group_id}/transition",
            json={"target_status": "complete"},
            headers=_auth(researcher_token),
        )
        assert resp.status_code == 200
        final = resp.json()
        assert final["status"] == "complete"
        print(f"  Group status: {final['status']}")

        print("\n=== ALL PHASES COMPLETE ===")
        print("  Summary:")
        print(f"    - 1 study group (scenario=scholarly)")
        print(f"    - 3 participants (Amy, Teanna, Zunairah)")
        print(f"    - 7 conversation turns")
        print(f"    - 4 flags across participants")
        print(f"    - 5 knowledge items")
        print(f"    - All items neutralized and approved")
        print(f"    - 10 annotations (3+3+4)")
        print(f"    - Priority rankings submitted")
        print(f"    - 1 deliberation revision")
        print(f"    - Study completed")
