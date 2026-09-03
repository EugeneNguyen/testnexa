"""Integration tests for `POST /api/v1/auth/refresh` and `GET /api/v1/auth/me` (AUTH-2).

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), matching the style of `test_auth_login.py`. The
package-level `tests/integration/conftest.py` fixture (`_require_live_server`,
autouse=True, session-scoped) applies automatically to this module too — it
skips the whole integration suite cleanly if no live server is reachable, so
no separate skip-guard is needed here.

Covers exactly the AUTH-2-scoped cases from
`docs/test-cases/2026-09-03-test-cases.md`: TC-AUTH-006, 007, 008, 018, 019,
020, 021, 022, 023, plus one fix-round test
(`test_concurrent_refresh_with_same_token_only_one_wins`) proving the
TOCTOU-race fix in the rotation `UPDATE` (see that test's own docstring).

Each test seeds its own `User`/`AuthIdentity`/`Organization`/`OrgMembership`/
`RefreshToken` rows directly via `AsyncSessionLocal` (the test process shares
`DATABASE_URL` with the live server under test) and cleans them up in a
`finally` block, same pattern as `test_auth_login.py`. Since `POST
/auth/refresh` reads its input exclusively from the `refresh_token` httpOnly
cookie (never a request body/header), tests drive it via `_post_refresh()`
below rather than going through a real `/auth/login` call — this lets each
test precisely control the seeded `RefreshToken` row's
`revoked_at`/`expires_at`/`token_hash` state, which is exactly what
TC-AUTH-007/008/018/019/021/022 need to assert on.
"""

import asyncio
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
REFRESH_PATH = "/api/v1/auth/refresh"
ME_PATH = "/api/v1/auth/me"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


# --- seeding / cleanup helpers ---------------------------------------------------------------
# Mirrors test_auth_login.py's helpers exactly, plus a RefreshToken seeder.


async def _create_user(session, email: str, password: str) -> User:
    """Seed a `User` + `provider=local` `AuthIdentity`. Caller commits."""
    user = User(name="Auth Refresh Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()  # populate user.actor_id (joined-table inheritance PK/FK)
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"Auth Refresh Test Org {slug_prefix}", slug=f"{slug_prefix}-{uuid4().hex[:8]}")
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
    """Seed a `RefreshToken` row directly, returning `(row, raw_token)`.

    Default `expires_at` is 30 days out (a healthy, unexpired token) unless
    the caller passes an explicit value (e.g. in the past, for TC-AUTH-019).
    """
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
    """Delete everything seeded by a test, in FK-safe order (see test_auth_login.py)."""
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


def _unique_email() -> str:
    return f"auth-refresh-test-{uuid4().hex[:8]}@example.com"


async def _get_stored_token(token_hash: str) -> RefreshToken | None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        return result.scalars().first()


async def _post_refresh(raw_token: str | None) -> httpx.Response:
    """POST `/auth/refresh` with `raw_token` as the `refresh_token` cookie (or no cookie at all if `None`).

    Uses a fresh, single-purpose `httpx.AsyncClient` per call rather than a
    shared client's persistent cookie jar. Layering `client.cookies.set(...)`
    calls onto a jar that already holds a previous response's `Set-Cookie`
    (which httpx stores keyed against the actual request host) leaves two
    same-name-but-different-domain jar entries behind — `httpx.CookieConflict`
    on any later `.get()`, and an ambiguous `Cookie:` header on the next
    request whose value is not deterministically the one a test intended. A
    fresh client scoped to exactly one cookie sidesteps this entirely: no
    jar to accumulate stale entries in.
    """
    cookies = {"refresh_token": raw_token} if raw_token is not None else None
    async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, cookies=cookies) as client:
        return await client.post(REFRESH_PATH)


def _new_refresh_cookie(response: httpx.Response) -> str:
    """Extract the raw refresh token this specific response's `Set-Cookie` carried.

    `response.cookies` reflects only this response's own `Set-Cookie`
    header(s), not any accumulated client-level jar state, so there is no
    domain-conflict ambiguity here (unlike a shared client's persistent
    `.cookies` jar across multiple requests/responses).
    """
    value = response.cookies.get("refresh_token")
    assert value is not None, "expected a new refresh_token cookie on a successful rotation"
    return value


# --- TC-AUTH-006: silent refresh on access-token expiry, retried /auth/me succeeds ---------


@pytest.mark.asyncio
async def test_refresh_issues_new_access_token_that_works_against_me() -> None:  # TC-AUTH-006
    email = _unique_email()
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, DEFAULT_PASSWORD)
            org = await _create_org(session, "tc006")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            _row, raw_token = await _create_refresh_token(session, user)
            await session.commit()
            user_id, org_id = user.actor_id, org.id
        org_ids = [org_id]

        refresh_response = await _post_refresh(raw_token)
        assert refresh_response.status_code == 200
        body = refresh_response.json()
        assert set(body.keys()) == {"access_token"}
        new_access_token = body["access_token"]

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            me_response = await client.get(ME_PATH, headers={"Authorization": f"Bearer {new_access_token}"})
        assert me_response.status_code == 200
        me_body = me_response.json()
        assert me_body["actor_id"] == str(user_id)
        assert me_body["email"] == email
        assert me_body["actor_type"] == "user"
    finally:
        await _cleanup(email, user_id, org_ids)


# --- TC-AUTH-007: refresh with revoked token -> 401, no new token issued -------------------


@pytest.mark.asyncio
async def test_refresh_with_revoked_token_returns_401() -> None:  # TC-AUTH-007
    email = _unique_email()
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, DEFAULT_PASSWORD)
            org = await _create_org(session, "tc007")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            row, raw_token = await _create_refresh_token(
                session, user, revoked_at=datetime.now(UTC), revoked_reason="test-revoked"
            )
            await session.commit()
            user_id, org_id = user.actor_id, org.id
            token_hash = row.token_hash
        org_ids = [org_id]

        response = await _post_refresh(raw_token)

        assert response.status_code == 401
        assert response.json() == {
            "code": "invalid_refresh_token",
            "message": "Your session has expired. Please log in again.",
            "field_errors": None,
        }

        # No new token issued: the revoked row is untouched, and no sibling
        # (rotated-forward) row exists for this user.
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(RefreshToken).where(RefreshToken.user_id == user_id))
            rows = result.scalars().all()
        assert len(rows) == 1
        assert rows[0].token_hash == token_hash
    finally:
        await _cleanup(email, user_id, org_ids)


# --- TC-AUTH-008: refresh tokens are individually revocable --------------------------------


@pytest.mark.asyncio
async def test_revoking_one_session_does_not_affect_another() -> None:  # TC-AUTH-008
    email = _unique_email()
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, DEFAULT_PASSWORD)
            org = await _create_org(session, "tc008")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            _row_a, raw_token_a = await _create_refresh_token(
                session, user, revoked_at=datetime.now(UTC), revoked_reason="test-revoked"
            )
            _row_b, raw_token_b = await _create_refresh_token(session, user)
            await session.commit()
            user_id, org_id = user.actor_id, org.id
        org_ids = [org_id]

        response_a = await _post_refresh(raw_token_a)
        assert response_a.status_code == 401

        response_b = await _post_refresh(raw_token_b)
        assert response_b.status_code == 200
        assert "access_token" in response_b.json()
    finally:
        await _cleanup(email, user_id, org_ids)


# --- TC-AUTH-018: refresh token is single-use (rotation) -----------------------------------


@pytest.mark.asyncio
async def test_refresh_token_is_single_use() -> None:  # TC-AUTH-018
    email = _unique_email()
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, DEFAULT_PASSWORD)
            org = await _create_org(session, "tc018")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            _row, raw_token = await _create_refresh_token(session, user)
            await session.commit()
            user_id, org_id = user.actor_id, org.id
        org_ids = [org_id]

        first_response = await _post_refresh(raw_token)
        assert first_response.status_code == 200
        assert "access_token" in first_response.json()

        # Present the exact same (now rotated-out) raw token again.
        second_response = await _post_refresh(raw_token)
        assert second_response.status_code == 401
        assert second_response.json()["code"] == "invalid_refresh_token"
    finally:
        await _cleanup(email, user_id, org_ids)


# --- Fix round 1: TOCTOU race — two truly concurrent requests presenting the ---------------
# --- same still-valid raw token must NOT both succeed in rotating it. ----------------------


@pytest.mark.asyncio
async def test_concurrent_refresh_with_same_token_only_one_wins() -> None:
    """Two genuinely concurrent `/auth/refresh` calls with the SAME raw token: exactly one wins.

    Chosen over a same-process "call the conditional-update path twice in a
    row" proxy: this repo's integration suite already runs against a live
    async server backed by real Postgres, so genuine concurrency is directly
    available here (`asyncio.gather` firing two real HTTP requests at once)
    and is strictly better evidence for a race-condition fix than a
    sequential stand-in — a sequential double-call can't actually exercise
    the interleaving (both requests' SELECTs completing before either
    UPDATE) that made the original bug possible in the first place, only the
    *outcome* of one possible interleaving. Two concurrent coroutines against
    an async (asyncpg) backend naturally interleave at their I/O await
    points, which reliably reproduces the race here.

    Before the fix (unconditional ORM `stored_token.revoked_at = now` +
    commit, `UPDATE` keyed only on `id`): both requests would read
    `revoked_at IS NULL` before either wrote, both would proceed, and BOTH
    would successfully rotate — inserting two live child tokens from one
    presented token. After the fix (conditional
    `UPDATE ... WHERE id = :id AND revoked_at IS NULL` + rowcount check):
    exactly one request's `UPDATE` can ever flip `revoked_at` from `NULL`,
    so exactly one succeeds (200, one live child token) and the other loses
    the race and is rejected (401 `invalid_refresh_token`, no child token).
    """
    email = _unique_email()
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, DEFAULT_PASSWORD)
            org = await _create_org(session, "tc-race")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            _row, raw_token = await _create_refresh_token(session, user)
            await session.commit()
            user_id, org_id = user.actor_id, org.id
        org_ids = [org_id]

        # Fire both requests at once, presenting the identical raw token —
        # simulates a stolen-and-replayed token racing the legitimate
        # client's own refresh (or a naive double-fire from one client).
        response_a, response_b = await asyncio.gather(
            _post_refresh(raw_token), _post_refresh(raw_token)
        )

        statuses = sorted([response_a.status_code, response_b.status_code])
        assert statuses == [200, 401], (
            f"expected exactly one winner (200) and one loser (401), got {statuses}"
        )

        loser_response = response_a if response_a.status_code == 401 else response_b
        assert loser_response.json()["code"] == "invalid_refresh_token"

        # Exactly one live child token must exist for this user afterward —
        # not two. (The original row is revoked either way; count only
        # non-revoked descendants.)
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(RefreshToken).where(
                    RefreshToken.user_id == user_id,
                    RefreshToken.revoked_at.is_(None),
                )
            )
            live_tokens = result.scalars().all()
        assert len(live_tokens) == 1
    finally:
        await _cleanup(email, user_id, org_ids)


# --- TC-AUTH-019: refresh rejected once token itself expires -------------------------------


@pytest.mark.asyncio
async def test_refresh_rejected_when_token_expired() -> None:  # TC-AUTH-019
    email = _unique_email()
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, DEFAULT_PASSWORD)
            org = await _create_org(session, "tc019")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            _row, raw_token = await _create_refresh_token(
                session, user, expires_at=datetime.now(UTC) - timedelta(days=1)
            )
            await session.commit()
            user_id, org_id = user.actor_id, org.id
        org_ids = [org_id]

        response = await _post_refresh(raw_token)

        assert response.status_code == 401
        assert response.json()["code"] == "invalid_refresh_token"
    finally:
        await _cleanup(email, user_id, org_ids)


# --- TC-AUTH-020: refresh rejected with no cookie at all ------------------------------------


@pytest.mark.asyncio
async def test_refresh_rejected_with_no_cookie() -> None:  # TC-AUTH-020
    response = await _post_refresh(None)

    assert response.status_code == 401
    assert response.json() == {
        "code": "invalid_refresh_token",
        "message": "Your session has expired. Please log in again.",
        "field_errors": None,
    }


# --- TC-AUTH-021: refresh rejected once org access is lost, token NOT revoked --------------


@pytest.mark.asyncio
async def test_refresh_rejected_when_org_membership_suspended_does_not_revoke_token() -> None:  # TC-AUTH-021
    email = _unique_email()
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, DEFAULT_PASSWORD)
            org = await _create_org(session, "tc021")
            membership = await _create_membership(session, user, org, OrgMembershipStatus.active)
            row, raw_token = await _create_refresh_token(session, user)
            await session.commit()
            user_id, org_id, membership_id, token_hash = user.actor_id, org.id, membership.id, row.token_hash
        org_ids = [org_id]

        # Membership transitions from active -> suspended after login/issuance.
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(OrgMembership).where(OrgMembership.id == membership_id))
            membership_row = result.scalars().one()
            membership_row.status = OrgMembershipStatus.suspended
            await session.commit()

        response = await _post_refresh(raw_token)

        assert response.status_code == 403
        assert response.json() == {
            "code": "no_active_organization",
            "message": "Your account has no active organization membership. Contact your administrator.",
            "field_errors": None,
        }

        # The refresh token itself must NOT be revoked by this rejection.
        stored = await _get_stored_token(token_hash)
        assert stored is not None
        assert stored.revoked_at is None

        # Reactivate membership; a later refresh with the SAME token succeeds.
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(OrgMembership).where(OrgMembership.id == membership_id))
            membership_row = result.scalars().one()
            membership_row.status = OrgMembershipStatus.active
            await session.commit()

        retry_response = await _post_refresh(raw_token)

        assert retry_response.status_code == 200
        assert "access_token" in retry_response.json()
    finally:
        await _cleanup(email, user_id, org_ids)


# --- TC-AUTH-022: rotation inherits original session's absolute expiry ---------------------


@pytest.mark.asyncio
async def test_rotation_inherits_original_absolute_expiry_across_three_rotations() -> None:  # TC-AUTH-022
    email = _unique_email()
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, DEFAULT_PASSWORD)
            org = await _create_org(session, "tc022")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            row, raw_token = await _create_refresh_token(session, user)
            await session.commit()
            user_id, org_id = user.actor_id, org.id
            original_expires_at = row.expires_at
        org_ids = [org_id]

        current_raw_token = raw_token
        for _ in range(3):
            response = await _post_refresh(current_raw_token)
            assert response.status_code == 200
            current_raw_token = _new_refresh_cookie(response)

        stored = await _get_stored_token(hash_refresh_token(current_raw_token))
        assert stored is not None
        assert stored.expires_at == original_expires_at
    finally:
        await _cleanup(email, user_id, org_ids)


# --- TC-AUTH-023: GET /auth/me returns current actor identity ------------------------------


@pytest.mark.asyncio
async def test_me_returns_current_actor_identity() -> None:  # TC-AUTH-023
    email = _unique_email()
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, DEFAULT_PASSWORD)
            org = await _create_org(session, "tc023")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            await session.commit()
            user_id, org_id = user.actor_id, org.id
        org_ids = [org_id]

        access_token = create_access_token(str(user_id))

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(ME_PATH, headers={"Authorization": f"Bearer {access_token}"})

        assert response.status_code == 200
        assert response.json() == {
            "actor_id": str(user_id),
            "email": email,
            "actor_type": "user",
        }
    finally:
        await _cleanup(email, user_id, org_ids)
