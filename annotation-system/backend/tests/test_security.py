"""Tests for app.core.security and app.core.dependencies.

Covers password hashing/verification, JWT creation/verification, and the
FastAPI dependencies get_current_user and require_role.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import jwt as jose_jwt

from app.core.security import (
    ALGORITHM,
    SECRET_KEY,
    create_access_token,
    hash_password,
    verify_password,
    verify_token,
)


# ===================================================================
# Tests for hash_password / verify_password
# ===================================================================


class TestPasswordHashing:
    def test_correct_password_verifies(self):
        hashed = hash_password("my-secret-password")
        assert verify_password("my-secret-password", hashed) is True

    def test_wrong_password_fails(self):
        hashed = hash_password("correct-password")
        assert verify_password("wrong-password", hashed) is False

    def test_hash_is_different_each_time(self):
        """bcrypt includes a random salt, so hashing the same password twice
        produces different outputs."""
        h1 = hash_password("same-password")
        h2 = hash_password("same-password")
        assert h1 != h2
        # But both should still verify
        assert verify_password("same-password", h1) is True
        assert verify_password("same-password", h2) is True

    def test_empty_password(self):
        hashed = hash_password("")
        assert verify_password("", hashed) is True
        assert verify_password("notempty", hashed) is False

    def test_hash_looks_like_bcrypt(self):
        hashed = hash_password("test")
        # bcrypt hashes start with "$2b$" or "$2a$"
        assert hashed.startswith("$2b$") or hashed.startswith("$2a$")


# ===================================================================
# Tests for create_access_token / verify_token
# ===================================================================


class TestJWT:
    def test_valid_token_decodes_correctly(self):
        user_id = str(uuid.uuid4())
        data = {"user_id": user_id, "role": "researcher"}
        token = create_access_token(data)
        payload = verify_token(token)

        assert payload is not None
        assert payload["user_id"] == user_id
        assert payload["role"] == "researcher"

    def test_token_contains_exp_claim(self):
        data = {"user_id": "abc", "role": "participant"}
        token = create_access_token(data)
        payload = verify_token(token)

        assert payload is not None
        assert "exp" in payload

    def test_expired_token_returns_none(self):
        """Manually create an already-expired token."""
        data = {
            "user_id": "abc",
            "role": "researcher",
            "exp": datetime.now(timezone.utc) - timedelta(hours=1),
        }
        token = jose_jwt.encode(data, SECRET_KEY, algorithm=ALGORITHM)
        assert verify_token(token) is None

    def test_tampered_token_returns_none(self):
        token = create_access_token({"user_id": "abc", "role": "researcher"})
        # Flip a character in the middle of the token to tamper it
        chars = list(token)
        mid = len(chars) // 2
        chars[mid] = "X" if chars[mid] != "X" else "Y"
        tampered = "".join(chars)
        assert verify_token(tampered) is None

    def test_wrong_secret_returns_none(self):
        """Token signed with wrong secret cannot be verified."""
        data = {
            "user_id": "abc",
            "role": "researcher",
            "exp": datetime.now(timezone.utc) + timedelta(days=1),
        }
        token = jose_jwt.encode(data, "wrong-secret-key", algorithm=ALGORITHM)
        assert verify_token(token) is None

    def test_original_data_not_mutated(self):
        """create_access_token should not mutate the input dict."""
        data = {"user_id": "abc", "role": "researcher"}
        original_keys = set(data.keys())
        create_access_token(data)
        assert set(data.keys()) == original_keys

    def test_garbage_string_returns_none(self):
        assert verify_token("not.a.valid.jwt") is None
        assert verify_token("") is None
        assert verify_token("abc123") is None


# ===================================================================
# Tests for get_current_user dependency (via test client)
# ===================================================================


class TestGetCurrentUser:
    """Test the get_current_user dependency through an actual HTTP endpoint.

    Uses the /health endpoint indirectly; for auth-specific testing we hit
    an endpoint that requires get_current_user (e.g., GET /api/conversations/).
    """

    @pytest.mark.asyncio
    async def test_valid_token_returns_payload(self, client, researcher):
        """A valid researcher token accesses a protected endpoint."""
        from tests.conftest import auth_header, researcher_token

        token = researcher_token(researcher)
        resp = await client.get(
            "/api/auth/me",
            headers=auth_header(token),
        )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_missing_token_returns_401(self, client):
        """No Authorization header -> 401/403."""
        resp = await client.get("/api/auth/me")
        assert resp.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_invalid_token_returns_401(self, client):
        """Garbage bearer token -> 401."""
        resp = await client.get(
            "/api/auth/me",
            headers={"Authorization": "Bearer garbage.invalid.token"},
        )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_expired_token_returns_401(self, client):
        """An expired JWT -> 401."""
        data = {
            "user_id": str(uuid.uuid4()),
            "role": "researcher",
            "exp": datetime.now(timezone.utc) - timedelta(hours=1),
        }
        token = jose_jwt.encode(data, SECRET_KEY, algorithm=ALGORITHM)
        resp = await client.get(
            "/api/auth/me",
            headers={"Authorization": "Bearer " + token},
        )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_token_missing_user_id_returns_401(self, client):
        """Token without user_id claim -> 401."""
        data = {
            "role": "researcher",
            "exp": datetime.now(timezone.utc) + timedelta(days=1),
        }
        token = jose_jwt.encode(data, SECRET_KEY, algorithm=ALGORITHM)
        resp = await client.get(
            "/api/auth/me",
            headers={"Authorization": "Bearer " + token},
        )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_token_missing_role_returns_401(self, client):
        """Token without role claim -> 401."""
        data = {
            "user_id": str(uuid.uuid4()),
            "exp": datetime.now(timezone.utc) + timedelta(days=1),
        }
        token = jose_jwt.encode(data, SECRET_KEY, algorithm=ALGORITHM)
        resp = await client.get(
            "/api/auth/me",
            headers={"Authorization": "Bearer " + token},
        )
        assert resp.status_code == 401


# ===================================================================
# Tests for require_role dependency (via test client)
# ===================================================================


class TestRequireRole:
    """Test the require_role dependency through actual HTTP endpoints.

    POST /api/conversations/ requires role 'researcher'.
    """

    @pytest.mark.asyncio
    async def test_correct_role_passes(self, client, researcher):
        """Researcher can access researcher-only endpoint."""
        from tests.conftest import auth_header, researcher_token

        token = researcher_token(researcher)
        # POST /api/conversations/ requires researcher role
        resp = await client.post(
            "/api/conversations/",
            headers=auth_header(token),
            json={},  # minimal body; may fail validation but should not be 403
        )
        # Should not get 403 (role check passed); 422 (validation) is fine
        assert resp.status_code != 403

    @pytest.mark.asyncio
    async def test_wrong_role_returns_403(self, client, participant):
        """Participant cannot access researcher-only endpoint -> 403."""
        from tests.conftest import auth_header, participant_token

        token = participant_token(participant)
        resp = await client.post(
            "/api/conversations/",
            headers=auth_header(token),
            json={},
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_external_annotator_wrong_role_returns_403(
        self, client, external_annotator
    ):
        """External annotator cannot access researcher-only endpoint."""
        from tests.conftest import auth_header, external_token

        token = external_token(external_annotator)
        resp = await client.post(
            "/api/conversations/",
            headers=auth_header(token),
            json={},
        )
        assert resp.status_code == 403
