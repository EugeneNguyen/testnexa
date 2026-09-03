"""Integration tests for `POST /api/v1/auth/logout` (AUTH-3).

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), matching the style of `test_auth_refresh.py`. The
package-level `tests/integration/conftest.py` fixture (`_require_live_server`,
autouse=True, session-scoped) applies automatically to this module too — it
skips the whole integration suite cleanly if no live server is reachable, so
no separate skip-guard is needed here.

Covers exactly the AUTH-3-scoped cases from
`docs/test-cases/2026-09-03-test-cases.md`: TC-AUTH-009, 024, 025, 026, 027,
plus one ADR-0014-mandated case that isn't a numbered TC on its own (cross-user
cookie scoping — see `test_logout_does_not_revoke_a_different_users_token`).

Each test seeds its own `User`/`AuthIdentity`/`Organization`/`OrgMembership`/
`RefreshToken` rows directly via `AsyncSessionLocal` (the test process shares
`DATABASE_URL` with the live server under test) and cleans them up in a
`finally` block, same pattern as `test_auth_refresh.py`. `POST /auth/logout`
takes its refresh-token input exclusively from the `refresh_token` httpOnly
cookie and its identity from the `Authorization` bearer header — tests drive
it via `_post_logout()` below, which sets both independently, rather than
going through a real `/auth/login` call.
"""

import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, select

from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_refresh_token,
)
from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, AuthProvider, LoginAttempt, RefreshToken
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
LOGOUT_PATH = "/api/v1/auth/logout"
REFRESH_PATH = "/api/v1/auth/refresh"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


# --- seeding / cleanup helpers ---------------------------------------------------------------
# Mirrors test_auth_refresh.py's helpers exactly, plus a two-user cleanup variant.


async def _create_user(session, email: str, password: str) -> User:
    """Seed a `User` + `provider=local` `AuthIdentity`. Caller commits."""
    user = User(name="Auth Logout Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()  # populate user.actor_id (joined-table inheritance PK/FK)
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"Auth Logout Test Org {slug_prefix}", slug=f"{slug_prefix}-{uuid4().hex[:8]}")
    session.add(org)
    await session.flush()
    return org


async def _create_membership(session, user: User, org: Organization, status: OrgMembershipStatus) -> OrgMembership:
    membership = OrgMembership(
        org_id=org.id,
        user_id=user.actor_id,
        status=status,
        joined_at=datetime.now(UTC) if status != OrgMembershipStatus.invited else None,
    )
    session.add(membership)
    await session.flush()
    return membership


async def _create_refresh_token(
    session,
    user: User,
    *,
    expires_at: datetime | None = None,
    revoked_at: datetime | None = None,
    revoked_reason: str | None = None,
) -> tuple[RefreshToken, str]:
    """Seed a `RefreshToken` row directly, returning `(row, raw_token)`."""
    raw_token = create_refresh_token(str(user.actor_id))
    now = datetime.now(UTC)
    row = RefreshToken(
        user_id=user.actor_id,
        token_hash=hash_refresh_token(raw_token),
        issued_at=now,
        expires_at=expires_at if expires_at is not None else now + timedelta(days=30),
        revoked_at=revoked_at,
        revoked_reason=revoked_reason,
    )
    session.add(row)
    await session.flush()
    return row, raw_token


async def _cleanup(email: str, user_id=None, org_ids: list | None = None) -> None:
    """Delete everything seeded by a test, in FK-safe order (see test_auth_refresh.py)."""
    org_ids = org_ids or []
    async with AsyncSessionLocal() as session:
        await session.execute(delete(LoginAttempt).where(LoginAttempt.email == email))
        if user_id is not None:
            await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
            await session.execute(delete(OrgMembership).where(OrgMembership.user_id == user_id))
            await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == user_id))
        if org_ids:
            await session.execute(delete(OrgMembership).where(OrgMembership.org_id.in_(org_ids)))
            await session.execute(delete(Organization).where(Organization.id.in_(org_ids)))
        if user_id is not None:
            await session.execute(delete(User).where(User.actor_id == user_id))
            await session.execute(delete(Actor).where(Actor.id == user_id))
        await session.commit()


def _unique_email(tag: str = "") -> str:
    return f"auth-logout-test-{tag}-{uuid4().hex[:8]}@example.com"


async def _get_stored_token(token_hash: str) -> RefreshToken | None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        return result.scalars().first()


async def _post_logout(access_token: str | None, raw_refresh_token: str | None) -> httpx.Response:
    """POST `/auth/logout` with an optional bearer access token and an optional refresh cookie.

    Fresh, single-purpose `httpx.AsyncClient` per call (same rationale as
    `test_auth_refresh.py`'s `_post_refresh`) — avoids any shared-jar
    domain-conflict ambiguity across calls within one test.
    """
    cookies = {"refresh_token": raw_refresh_token} if raw_refresh_token is not None else None
    headers = {"Authorization": f"Bearer {access_token}"} if access_token is not None else None
    async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, cookies=cookies) as client:
        return await client.post(LOGOUT_PATH, headers=headers)


async def _post_refresh(raw_token: str | None) -> httpx.Response:
    """POST `/auth/refresh` with `raw_token` as the `refresh_token` cookie (or none)."""
    cookies = {"refresh_token": raw_token} if raw_token is not None else None
    async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, cookies=cookies) as client:
        return await client.post(REFRESH_PATH)


# --- TC-AUTH-009: logout revokes current session's refresh token ---------------------------


@pytest.mark.asyncio
async def test_logout_revokes_refresh_token_and_subsequent_refresh_401s() -> None:  # TC-AUTH-009
    email = _unique_email("tc009")
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, DEFAULT_PASSWORD)
            org = await _create_org(session, "tc009")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            row, raw_token = await _create_refresh_token(session, user)
            await session.commit()
            user_id, org_id, token_hash = user.actor_id, org.id, row.token_hash
        org_ids = [org_id]

        access_token = create_access_token(str(user_id))

        response = await _post_logout(access_token, raw_token)

        assert response.status_code == 204
        assert response.content == b""

        stored = await _get_stored_token(token_hash)
        assert stored is not None
        assert stored.revoked_at is not None
        assert stored.revoked_reason == "logout"

        # The cookie must be cleared on the response.
        set_cookie_headers = response.headers.get_list("set-cookie")
        assert any(h.startswith("refresh_token=") for h in set_cookie_headers)

        # Subsequent refresh with the SAME (now-revoked) cookie 401s.
        refresh_response = await _post_refresh(raw_token)
        assert refresh_response.status_code == 401
        assert refresh_response.json()["code"] == "invalid_refresh_token"
    finally:
        await _cleanup(email, user_id, org_ids)


# --- TC-AUTH-024: logout with no refresh cookie is a no-op success -------------------------


@pytest.mark.asyncio
async def test_logout_with_no_refresh_cookie_is_noop_success() -> None:  # TC-AUTH-024
    email = _unique_email("tc024")
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, DEFAULT_PASSWORD)
            org = await _create_org(session, "tc024")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            row, _raw_token = await _create_refresh_token(session, user)
            await session.commit()
            user_id, org_id, token_hash = user.actor_id, org.id, row.token_hash
        org_ids = [org_id]

        access_token = create_access_token(str(user_id))

        response = await _post_logout(access_token, None)

        assert response.status_code == 204
        assert response.content == b""

        # The user's untouched RefreshToken row must remain untouched.
        stored = await _get_stored_token(token_hash)
        assert stored is not None
        assert stored.revoked_at is None
        assert stored.revoked_reason is None
    finally:
        await _cleanup(email, user_id, org_ids)


# --- TC-AUTH-025: logout with already-revoked/rotated-out cookie is a no-op success ---------


@pytest.mark.asyncio
async def test_logout_with_already_revoked_cookie_is_noop_success() -> None:  # TC-AUTH-025
    email = _unique_email("tc025")
    user_id = None
    org_ids: list = []
    try:
        revoked_at = datetime.now(UTC) - timedelta(minutes=5)
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, DEFAULT_PASSWORD)
            org = await _create_org(session, "tc025")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            row, raw_token = await _create_refresh_token(
                session, user, revoked_at=revoked_at, revoked_reason="rotated"
            )
            await session.commit()
            user_id, org_id, token_hash = user.actor_id, org.id, row.token_hash
        org_ids = [org_id]

        access_token = create_access_token(str(user_id))

        response = await _post_logout(access_token, raw_token)

        assert response.status_code == 204
        assert response.content == b""

        # No double-write: revoked_at/revoked_reason from the original
        # rotation must remain untouched, not overwritten to "logout".
        stored = await _get_stored_token(token_hash)
        assert stored is not None
        assert stored.revoked_at == revoked_at
        assert stored.revoked_reason == "rotated"
    finally:
        await _cleanup(email, user_id, org_ids)


# --- TC-AUTH-026: logout doesn't revoke a different session's refresh token -----------------


@pytest.mark.asyncio
async def test_logout_session_a_does_not_affect_session_b() -> None:  # TC-AUTH-026
    email = _unique_email("tc026")
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, DEFAULT_PASSWORD)
            org = await _create_org(session, "tc026")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            row_a, raw_token_a = await _create_refresh_token(session, user)
            row_b, raw_token_b = await _create_refresh_token(session, user)
            await session.commit()
            user_id, org_id = user.actor_id, org.id
            token_hash_a, token_hash_b = row_a.token_hash, row_b.token_hash
        org_ids = [org_id]

        access_token = create_access_token(str(user_id))

        response = await _post_logout(access_token, raw_token_a)
        assert response.status_code == 204

        stored_a = await _get_stored_token(token_hash_a)
        assert stored_a is not None
        assert stored_a.revoked_at is not None
        assert stored_a.revoked_reason == "logout"

        stored_b = await _get_stored_token(token_hash_b)
        assert stored_b is not None
        assert stored_b.revoked_at is None

        # Session A's cookie now 401s on refresh.
        refresh_a = await _post_refresh(raw_token_a)
        assert refresh_a.status_code == 401

        # Session B's cookie still refreshes successfully.
        refresh_b = await _post_refresh(raw_token_b)
        assert refresh_b.status_code == 200
        assert "access_token" in refresh_b.json()
    finally:
        await _cleanup(email, user_id, org_ids)


# --- TC-AUTH-027: logout rejected without a valid access token ------------------------------


@pytest.mark.asyncio
async def test_logout_rejected_without_valid_access_token() -> None:  # TC-AUTH-027
    email = _unique_email("tc027")
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, DEFAULT_PASSWORD)
            org = await _create_org(session, "tc027")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            row, raw_token = await _create_refresh_token(session, user)
            await session.commit()
            user_id, org_id, token_hash = user.actor_id, org.id, row.token_hash
        org_ids = [org_id]

        # No access token at all.
        response_missing = await _post_logout(None, raw_token)
        assert response_missing.status_code == 401
        assert response_missing.json() == {
            "code": "invalid_token",
            "message": "Invalid or expired access token.",
            "field_errors": None,
        }

        # Malformed access token.
        response_malformed = await _post_logout("not-a-real-jwt", raw_token)
        assert response_malformed.status_code == 401
        assert response_malformed.json()["code"] == "invalid_token"

        # No revocation attempted in either case.
        stored = await _get_stored_token(token_hash)
        assert stored is not None
        assert stored.revoked_at is None
    finally:
        await _cleanup(email, user_id, org_ids)


# --- ADR-0014 cross-user scoping: a refresh cookie belonging to a DIFFERENT user ------------
# --- than the authenticated caller must not be revoked. -------------------------------------


@pytest.mark.asyncio
async def test_logout_does_not_revoke_a_different_users_token() -> None:
    """A caller's bearer access token must not be able to revoke another user's refresh cookie.

    ADR-0014 / AUTH-3 scope plan §3 "Cross-user cookie scoping": the CAS
    `UPDATE` is scoped to `token_hash = :hash AND user_id =
    :authenticated_user_id`, so a cookie whose row belongs to a different
    user never matches — falls into the same idempotent-204 "nothing to
    revoke" path, and that other user's row is left untouched.
    """
    email_a = _unique_email("tc-cross-a")
    email_b = _unique_email("tc-cross-b")
    user_id_a = None
    user_id_b = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user_a = await _create_user(session, email_a, DEFAULT_PASSWORD)
            user_b = await _create_user(session, email_b, DEFAULT_PASSWORD)
            org = await _create_org(session, "tc-cross")
            await _create_membership(session, user_a, org, OrgMembershipStatus.active)
            await _create_membership(session, user_b, org, OrgMembershipStatus.active)
            _row_a, _raw_token_a = await _create_refresh_token(session, user_a)
            row_b, raw_token_b = await _create_refresh_token(session, user_b)
            await session.commit()
            user_id_a, user_id_b, org_id = user_a.actor_id, user_b.actor_id, org.id
            token_hash_b = row_b.token_hash
        org_ids = [org_id]

        # User A's access token, but presenting user B's refresh cookie.
        access_token_a = create_access_token(str(user_id_a))

        response = await _post_logout(access_token_a, raw_token_b)

        assert response.status_code == 204
        assert response.content == b""

        # User B's row must be untouched.
        stored_b = await _get_stored_token(token_hash_b)
        assert stored_b is not None
        assert stored_b.revoked_at is None
        assert stored_b.revoked_reason is None

        # User B's refresh token still works normally.
        refresh_b = await _post_refresh(raw_token_b)
        assert refresh_b.status_code == 200
    finally:
        await _cleanup(email_a, user_id_a, [])
        await _cleanup(email_b, user_id_b, org_ids)
