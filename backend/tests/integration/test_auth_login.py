"""Integration tests for `POST /api/v1/auth/login` (AUTH-1).

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), matching the style of `tests/integration/test_health_api.py`.
The package-level `tests/integration/conftest.py` fixture (`_require_live_server`,
`autouse=True`, session-scoped) applies automatically to this module too — it
skips the whole integration suite cleanly if no live server is reachable, so
no separate skip-guard is needed here.

Covers exactly the 10 AUTH-1-scoped cases from
`docs/test-cases/2026-09-03-test-cases.md`: TC-AUTH-001..005, TC-AUTH-013..017.
TC-AUTH-006..012 belong to AUTH-2/3/4 (not implemented) and are intentionally
out of scope for this file.

Each test seeds its own `User`/`AuthIdentity`/`Organization`/`OrgMembership`/
`LoginAttempt` rows directly via `AsyncSessionLocal` (the test process shares
`DATABASE_URL` with the live server under test) and cleans them up in a
`finally` block. Emails are unique per test (`auth-test-<uuid4 hex>@example.com`)
as an extra safety net against cross-test collisions even if cleanup has a bug.
"""

import os
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, AuthProvider, LoginAttempt, RefreshToken
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
LOGIN_PATH = "/api/v1/auth/login"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


# --- seeding / cleanup helpers ---------------------------------------------------------------


async def _create_user(session, email: str, password: str) -> User:
    """Seed a `User` + `provider=local` `AuthIdentity`. Caller commits."""
    user = User(name="Auth Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()  # populate user.actor_id (joined-table inheritance PK/FK)
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"Auth Test Org {slug_prefix}", slug=f"{slug_prefix}-{uuid4().hex[:8]}")
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


async def _cleanup(email: str, user_id=None, org_ids: list | None = None) -> None:
    """Delete everything seeded by a test, in FK-safe order.

    Order matters: `refresh_token`/`org_membership`/`auth_identity` all carry
    `ON DELETE RESTRICT` FKs to `user.actor_id`, and `org_membership` also
    `RESTRICT`s to `organization.id` — all must be deleted before their
    parent `User`/`Organization` rows. `user.actor_id` itself
    `ON DELETE CASCADE`s to `actor.id`, but we delete both explicitly rather
    than relying on that cascade.
    """
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


async def _discover_client_ip(client: httpx.AsyncClient, email: str) -> str:
    """Issue one failed login for `email` and read back the `client_ip` the
    live server actually recorded for it in `LoginAttempt`.

    Reasoning: the route records `client_ip = request.client.host if
    request.client else "unknown"` (see `app/api/routes/auth.py`) — i.e.
    whatever the server's TCP layer sees as the peer address for the
    connection. When this test process (an `httpx.AsyncClient`) connects to
    `TEST_API_BASE_URL`, that peer address is very likely a loopback address
    (`127.0.0.1`, or possibly `::1` if IPv6 loopback resolves first,
    depending on the host's resolver order) — plausibly `127.0.0.1` for the
    documented `docker compose exec backend pytest ...` invocation, since the
    test process and the server are the same container hitting its own
    loopback interface. Rather than hardcode either guess, we make one real
    request first and query the DB for the exact string the server wrote
    down for it, then reuse that exact value when seeding the remaining
    synthetic `LoginAttempt` rows below — this is correct regardless of
    environment (bare host, docker, IPv4 vs IPv6) since it reads the ground
    truth instead of assuming it.
    """
    response = await client.post(
        LOGIN_PATH, json={"email": email, "password": "wrong-password-for-ip-discovery"}
    )
    assert response.status_code == 401
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(LoginAttempt.client_ip)
            .where(LoginAttempt.email == email)
            .order_by(LoginAttempt.attempted_at.desc())
            .limit(1)
        )
        return result.scalar_one()


def _unique_email() -> str:
    return f"auth-test-{uuid4().hex[:8]}@example.com"


# --- TC-AUTH-001: valid credentials, single active org -> 200 -----------------------------


@pytest.mark.asyncio
async def test_login_valid_credentials_returns_token_and_auto_org() -> None:  # TC-AUTH-001
    email = _unique_email()
    password = DEFAULT_PASSWORD
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, password)
            org = await _create_org(session, "tc001")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            await session.commit()
            user_id, org_id, org_name, org_slug = user.actor_id, org.id, org.name, org.slug
        org_ids = [org_id]

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(LOGIN_PATH, json={"email": email, "password": password})

        assert response.status_code == 200
        body = response.json()
        assert body["access_token"]
        assert body["org_context"] == "auto"
        assert len(body["orgs"]) == 1
        assert body["orgs"][0] == {"id": str(org_id), "name": org_name, "slug": org_slug}

        set_cookie = response.headers.get("set-cookie")
        assert set_cookie is not None
        assert "refresh_token=" in set_cookie
        assert "httponly" in set_cookie.lower()
    finally:
        await _cleanup(email, user_id, org_ids)


# --- TC-AUTH-002: wrong password vs. nonexistent email -> identical 401 body ---------------


@pytest.mark.asyncio
async def test_login_wrong_password_and_unknown_email_return_identical_401() -> None:  # TC-AUTH-002
    email = _unique_email()
    password = DEFAULT_PASSWORD
    user_id = None
    org_ids: list = []
    nonexistent_email = None
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, password)
            org = await _create_org(session, "tc002")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            await session.commit()
            user_id, org_id = user.actor_id, org.id
        org_ids = [org_id]

        nonexistent_email = _unique_email()

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            wrong_password_response = await client.post(
                LOGIN_PATH, json={"email": email, "password": "definitely-wrong-password"}
            )
            unknown_email_response = await client.post(
                LOGIN_PATH, json={"email": nonexistent_email, "password": "whatever-password"}
            )

        assert wrong_password_response.status_code == 401
        assert unknown_email_response.status_code == 401

        wrong_password_body = wrong_password_response.json()
        unknown_email_body = unknown_email_response.json()

        assert wrong_password_body == {
            "code": "invalid_credentials",
            "message": "Invalid email or password.",
            "field_errors": None,
        }
        # Byte-for-byte identical bodies: no enumeration leak between "wrong
        # password for a real user" and "email doesn't exist at all".
        assert wrong_password_body == unknown_email_body
    finally:
        await _cleanup(email, user_id, org_ids)
        if nonexistent_email is not None:
            await _cleanup(nonexistent_email)


# --- TC-AUTH-003: exactly 1 active membership -> org_context "auto" -----------------------


@pytest.mark.asyncio
async def test_login_single_active_membership_yields_auto_org_context() -> None:  # TC-AUTH-003
    email = _unique_email()
    password = DEFAULT_PASSWORD
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, password)
            org = await _create_org(session, "tc003")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            await session.commit()
            user_id, org_id = user.actor_id, org.id
        org_ids = [org_id]

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(LOGIN_PATH, json={"email": email, "password": password})

        assert response.status_code == 200
        body = response.json()
        assert body["org_context"] == "auto"
        assert len(body["orgs"]) == 1
    finally:
        await _cleanup(email, user_id, org_ids)


# --- TC-AUTH-004: 2 active memberships (2 orgs) -> org_context "picker" -------------------


@pytest.mark.asyncio
async def test_login_two_active_memberships_yields_picker_org_context() -> None:  # TC-AUTH-004
    email = _unique_email()
    password = DEFAULT_PASSWORD
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, password)
            org_a = await _create_org(session, "tc004a")
            org_b = await _create_org(session, "tc004b")
            await _create_membership(session, user, org_a, OrgMembershipStatus.active)
            await _create_membership(session, user, org_b, OrgMembershipStatus.active)
            await session.commit()
            user_id = user.actor_id
            org_a_id, org_b_id = org_a.id, org_b.id
        org_ids = [org_a_id, org_b_id]

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(LOGIN_PATH, json={"email": email, "password": password})

        assert response.status_code == 200
        body = response.json()
        assert body["org_context"] == "picker"
        assert len(body["orgs"]) == 2
        returned_org_ids = {org["id"] for org in body["orgs"]}
        assert returned_org_ids == {str(org_a_id), str(org_b_id)}
    finally:
        await _cleanup(email, user_id, org_ids)


# --- TC-AUTH-005: password never stored in plaintext ---------------------------------------


@pytest.mark.asyncio
async def test_login_password_stored_as_argon2_hash_not_plaintext() -> None:  # TC-AUTH-005
    email = _unique_email()
    password = DEFAULT_PASSWORD
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, password)
            org = await _create_org(session, "tc005")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            await session.commit()
            user_id, org_id = user.actor_id, org.id
        org_ids = [org_id]

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(LOGIN_PATH, json={"email": email, "password": password})
        assert response.status_code == 200

        async with AsyncSessionLocal() as session:
            result = await session.execute(select(User.password_hash).where(User.actor_id == user_id))
            stored_hash = result.scalar_one()

        assert stored_hash.startswith("$argon2")
        assert stored_hash != password
    finally:
        await _cleanup(email, user_id, org_ids)


# --- TC-AUTH-013: zero OrgMembership rows -> 403 no_active_organization --------------------


@pytest.mark.asyncio
async def test_login_zero_memberships_returns_403_no_active_organization() -> None:  # TC-AUTH-013
    email = _unique_email()
    password = DEFAULT_PASSWORD
    user_id = None
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, password)
            await session.commit()
            user_id = user.actor_id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(LOGIN_PATH, json={"email": email, "password": password})

        assert response.status_code == 403
        body = response.json()
        assert body["code"] == "no_active_organization"
    finally:
        await _cleanup(email, user_id)


# --- TC-AUTH-014: only suspended + invited memberships -> 403 -------------------------------


@pytest.mark.asyncio
async def test_login_only_suspended_and_invited_memberships_returns_403() -> None:  # TC-AUTH-014
    email = _unique_email()
    password = DEFAULT_PASSWORD
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, password)
            org_suspended = await _create_org(session, "tc014susp")
            org_invited = await _create_org(session, "tc014inv")
            await _create_membership(session, user, org_suspended, OrgMembershipStatus.suspended)
            await _create_membership(session, user, org_invited, OrgMembershipStatus.invited)
            await session.commit()
            user_id = user.actor_id
            org_ids = [org_suspended.id, org_invited.id]

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(LOGIN_PATH, json={"email": email, "password": password})

        assert response.status_code == 403
        body = response.json()
        assert body["code"] == "no_active_organization"
    finally:
        await _cleanup(email, user_id, org_ids)


# --- TC-AUTH-015: 1 active + 1 suspended -> 200, only active org returned ------------------


@pytest.mark.asyncio
async def test_login_active_plus_suspended_returns_only_active_org() -> None:  # TC-AUTH-015
    email = _unique_email()
    password = DEFAULT_PASSWORD
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, password)
            org_active = await _create_org(session, "tc015active")
            org_suspended = await _create_org(session, "tc015susp")
            await _create_membership(session, user, org_active, OrgMembershipStatus.active)
            await _create_membership(session, user, org_suspended, OrgMembershipStatus.suspended)
            await session.commit()
            user_id = user.actor_id
            active_org_id, suspended_org_id = org_active.id, org_suspended.id
        org_ids = [active_org_id, suspended_org_id]

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(LOGIN_PATH, json={"email": email, "password": password})

        assert response.status_code == 200
        body = response.json()
        assert body["org_context"] == "auto"
        returned_org_ids = {org["id"] for org in body["orgs"]}
        assert returned_org_ids == {str(active_org_id)}
        assert str(suspended_org_id) not in returned_org_ids
    finally:
        await _cleanup(email, user_id, org_ids)


# --- TC-AUTH-016: 5 failed attempts -> 6th blocked with 429 --------------------------------


@pytest.mark.asyncio
async def test_login_rate_limited_after_five_failed_attempts() -> None:  # TC-AUTH-016
    email = _unique_email()
    password = DEFAULT_PASSWORD
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, password)
            org = await _create_org(session, "tc016")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            await session.commit()
            user_id, org_id = user.actor_id, org.id
        org_ids = [org_id]

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # Failed attempt #1 (real request) — also discovers the observed
            # client_ip for this environment; see _discover_client_ip.
            client_ip = await _discover_client_ip(client, email)

            # Seed 4 more failed attempts directly for the same
            # (email, client_ip) pair -> 5 failed attempts total, the
            # ADR-0011 / NFR-11 threshold.
            async with AsyncSessionLocal() as session:
                now = datetime.now(UTC)
                for _ in range(4):
                    session.add(
                        LoginAttempt(email=email, client_ip=client_ip, succeeded=False, attempted_at=now)
                    )
                await session.commit()

            # 6th request for this pair -- must be throttled regardless of
            # whether these credentials are actually correct.
            response = await client.post(LOGIN_PATH, json={"email": email, "password": password})

        assert response.status_code == 429
        body = response.json()
        assert body["code"] == "rate_limited"
    finally:
        await _cleanup(email, user_id, org_ids)


# --- TC-AUTH-017: a successful login resets the failure count -----------------------------


@pytest.mark.asyncio
async def test_login_failure_count_behavior_across_a_successful_login() -> None:  # TC-AUTH-017
    """A successful login resets the throttle counter (ADR-0011, AUTH-1 scope plan).

    NOTE — this test previously asserted a *bug*: the first version of the
    route only counted `LoginAttempt.succeeded.is_(False)` rows in the
    trailing 15-minute window, with no exclusion for failures that happened
    before a later success — so 3 pre-existing failures + 1 success would
    only take 2 more failures to trip the 429, not the documented 5. That
    was flagged as a docs/implementation discrepancy and has since been
    fixed in `app/api/routes/auth.py`: the rate-limit query now only counts
    failures at or after the most recent success for the same
    `(email, client_ip)` pair (falling back to the 15-minute window start if
    there's no prior success). This test asserts the corrected, documented
    behavior.

    Arithmetic under the fixed route, with 3 pre-existing failures + 1
    success + N further failures for the same pair (threshold = 5, checked
    against the count *before* the current attempt):
      further-failure #1: count_since_success=0 (<5) -> 401
      further-failure #2: count_since_success=1 (<5) -> 401
      further-failure #3: count_since_success=2 (<5) -> 401
      further-failure #4: count_since_success=3 (<5) -> 401
      further-failure #5: count_since_success=4 (<5) -> 401
      further-failure #6: count_since_success=5 (>=5) -> 429
    i.e. it takes a fresh 5 failures (not fewer) after the success to trip
    the limiter again — the pre-success failures no longer count at all.
    """
    email = _unique_email()
    password = DEFAULT_PASSWORD
    user_id = None
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email, password)
            org = await _create_org(session, "tc017")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            await session.commit()
            user_id, org_id = user.actor_id, org.id
        org_ids = [org_id]

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # Failed attempt #1 (real request) — also discovers client_ip.
            client_ip = await _discover_client_ip(client, email)

            # Seed 2 more failed attempts -> 3 pre-existing failures total,
            # matching the scenario's stated precondition.
            async with AsyncSessionLocal() as session:
                now = datetime.now(UTC)
                for _ in range(2):
                    session.add(
                        LoginAttempt(email=email, client_ip=client_ip, succeeded=False, attempted_at=now)
                    )
                await session.commit()

            # A real successful login for the same (email, client_ip) pair —
            # resets the effective counting window to start here.
            success_response = await client.post(
                LOGIN_PATH, json={"email": email, "password": password}
            )
            assert success_response.status_code == 200

            # 5 further failures post-reset must all still be allowed
            # (401, not 429) — the pre-success failures no longer count.
            expected_statuses = [401, 401, 401, 401, 401, 429]
            actual_statuses = []
            for _ in range(6):
                response = await client.post(
                    LOGIN_PATH, json={"email": email, "password": "still-wrong-password"}
                )
                actual_statuses.append(response.status_code)

        assert actual_statuses == expected_statuses
    finally:
        await _cleanup(email, user_id, org_ids)
