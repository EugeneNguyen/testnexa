"""Integration tests for SHELL-6's `GET /auth/me/orgs` route (ADR-0036).

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), seeding fixtures directly through `AsyncSessionLocal`
— the same shape `test_agents.py`/`test_auth_login.py` already use, helpers
copied from `test_agents.py` rather than re-derived. The package-level
`tests/integration/conftest.py` skip-guard applies here automatically.

Covers `docs/test-cases/2026-09-03-test-cases.md`'s **TC-AUTH-035** in full
(the three calls its `Steps` cell names, in one test, against one fixture:
human `User` -> 200 active-only; `AIAgent` bearer -> 403 `actor_forbidden`;
unauthenticated -> 401), plus the two remaining equivalence classes
test-design §31 names for this route that TC-AUTH-035's own row does not
itself exercise: multiple active memberships, and zero active memberships.

On the "`OrgSummary` shape matches `LoginResponse.orgs`" clause: this is
asserted by actually calling `POST /auth/login` as the same seeded user and
comparing the two response bodies' org entries directly, rather than by
re-asserting a hand-written `{id, name, slug}` dict against both. A
hand-written expectation would keep passing if *both* routes drifted to a
new shape together, which is exactly the drift the TC's wording is there to
catch.
"""

import os
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete

from app.core.security import create_access_token, generate_api_key, hash_api_key, hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, AIAgent, User
from app.models.auth import AuthIdentity, AuthProvider, LoginAttempt, RefreshToken
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
ME_ORGS_PATH = f"{API_PREFIX}/auth/me/orgs"
LOGIN_PATH = f"{API_PREFIX}/auth/login"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


def _unique_email(tag: str) -> str:
    # `example.com` deliberately, never a reserved special-use TLD
    # (`.test`/`.local`/...) — `POST /auth/login`'s `EmailStr` permanently
    # 422s those, and one of the tests below really does log in.
    return f"shell6-{tag}-{uuid4().hex[:8]}@example.com"


async def _create_user(session, email: str) -> User:
    """Seed a `User` directly.

    `User(...)` constructed directly — never `Actor()` then
    `User(actor_id=...)`, which breaks the joined-table-inheritance mapper
    (see `backend/CLAUDE.md`).
    """
    user = User(name="SHELL-6 Test User", email=email, password_hash=hash_password(DEFAULT_PASSWORD))
    session.add(user)
    await session.flush()  # populates user.actor_id
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str, name: str) -> Organization:
    org = Organization(name=name, slug=f"{slug_prefix}-{uuid4().hex[:8]}")
    session.add(org)
    await session.flush()
    return org


async def _create_membership(session, user: User, org: Organization, status: OrgMembershipStatus) -> None:
    session.add(
        OrgMembership(
            org_id=org.id,
            user_id=user.actor_id,
            status=status,
            joined_at=datetime.now(UTC) if status != OrgMembershipStatus.invited else None,
        )
    )
    await session.flush()


async def _create_agent(session, *, acting_on_behalf_of_user_id) -> tuple[AIAgent, str]:
    raw_key, key_prefix = generate_api_key()
    agent = AIAgent(
        agent_name="SHELL-6 Test Agent",
        model_or_provider="test-provider/test-model",
        acting_on_behalf_of_user_id=acting_on_behalf_of_user_id,
        key_hash=hash_api_key(raw_key),
        key_prefix=key_prefix,
        issued_at=datetime.now(UTC),
    )
    session.add(agent)
    await session.flush()
    return agent, raw_key


async def _cleanup(*, emails=None, user_ids=None, agent_ids=None, org_ids=None) -> None:
    """FK-safe (child-first) teardown of everything a test seeded."""
    emails = emails or []
    user_ids = user_ids or []
    agent_ids = agent_ids or []
    org_ids = org_ids or []

    async with AsyncSessionLocal() as session:
        if emails:
            await session.execute(delete(LoginAttempt).where(LoginAttempt.email.in_(emails)))
        if agent_ids:
            await session.execute(delete(AIAgent).where(AIAgent.actor_id.in_(agent_ids)))
            await session.execute(delete(Actor).where(Actor.id.in_(agent_ids)))
        if user_ids:
            await session.execute(delete(RefreshToken).where(RefreshToken.user_id.in_(user_ids)))
            await session.execute(delete(OrgMembership).where(OrgMembership.user_id.in_(user_ids)))
            await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id.in_(user_ids)))
        if org_ids:
            await session.execute(delete(OrgMembership).where(OrgMembership.org_id.in_(org_ids)))
            await session.execute(delete(Organization).where(Organization.id.in_(org_ids)))
        if user_ids:
            await session.execute(delete(User).where(User.actor_id.in_(user_ids)))
            await session.execute(delete(Actor).where(Actor.id.in_(user_ids)))
        await session.commit()


@pytest.mark.asyncio
async def test_me_orgs_active_only_human_only_and_authenticated_only() -> None:  # TC-AUTH-035
    """TC-AUTH-035, all three of its `Steps` calls against one fixture.

    Precondition per the TC: one `User` with `active`/`suspended`/`invited`
    memberships spread across **3** orgs — so "lists only the active-status
    org" is a real filter assertion (1 of 3 returned), not a trivially-true
    one.
    """
    email = _unique_email("mixed")
    user_ids: list = []
    agent_ids: list = []
    org_ids: list = []

    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            user_ids.append(user.actor_id)

            active_org = await _create_org(session, "shell6-active", "SHELL-6 Active Org")
            suspended_org = await _create_org(session, "shell6-susp", "SHELL-6 Suspended Org")
            invited_org = await _create_org(session, "shell6-inv", "SHELL-6 Invited Org")
            org_ids.extend([active_org.id, suspended_org.id, invited_org.id])

            await _create_membership(session, user, active_org, OrgMembershipStatus.active)
            await _create_membership(session, user, suspended_org, OrgMembershipStatus.suspended)
            await _create_membership(session, user, invited_org, OrgMembershipStatus.invited)

            agent, raw_agent_key = await _create_agent(session, acting_on_behalf_of_user_id=user.actor_id)
            agent_ids.append(agent.actor_id)

            await session.commit()
            active_org_id = str(active_org.id)
            active_org_name = active_org.name
            active_org_slug = active_org.slug

        access_token = create_access_token(str(user_ids[0]))

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            # --- Step 1: the human User call -> 200, active-only ---------------
            user_response = await client.get(
                ME_ORGS_PATH, headers={"Authorization": f"Bearer {access_token}"}
            )
            assert user_response.status_code == 200, user_response.text
            body = user_response.json()
            assert list(body.keys()) == ["orgs"], body

            returned = body["orgs"]
            assert len(returned) == 1, f"expected only the active-status org, got {returned}"
            assert returned[0] == {
                "id": active_org_id,
                "name": active_org_name,
                "slug": active_org_slug,
            }
            # The suspended/invited orgs must not leak by id either.
            returned_ids = {org["id"] for org in returned}
            assert str(suspended_org.id) not in returned_ids
            assert str(invited_org.id) not in returned_ids

            # --- "OrgSummary shape matches LoginResponse.orgs" -----------------
            # Compared against the live login route's own body rather than a
            # hand-written dict, so a *shared* drift in both routes still fails.
            login_response = await client.post(
                LOGIN_PATH, json={"email": email, "password": DEFAULT_PASSWORD}
            )
            assert login_response.status_code == 200, login_response.text
            login_orgs = login_response.json()["orgs"]
            assert login_orgs == returned, (
                "GET /auth/me/orgs must return byte-for-byte the same OrgSummary "
                f"entries POST /auth/login does: login={login_orgs} me_orgs={returned}"
            )

            # --- Step 2: the AIAgent bearer-key call -> 403 actor_forbidden ----
            agent_response = await client.get(
                ME_ORGS_PATH, headers={"Authorization": f"Bearer {raw_agent_key}"}
            )
            assert agent_response.status_code == 403, agent_response.text
            agent_body = agent_response.json()
            assert agent_body["code"] == "actor_forbidden", agent_body
            # The rejection must not leak the org list in any form.
            assert "orgs" not in agent_body, agent_body

            # --- Step 3: the unauthenticated call -> 401 -----------------------
            anon_response = await client.get(ME_ORGS_PATH)
            assert anon_response.status_code == 401, anon_response.text
    finally:
        await _cleanup(emails=[email], user_ids=user_ids, agent_ids=agent_ids, org_ids=org_ids)


@pytest.mark.asyncio
async def test_me_orgs_returns_every_active_membership_not_just_the_first() -> None:
    """Test-design §31: "2+ active-status memberships -> all of them".

    Distinct from TC-AUTH-035's own single-active-org fixture: that one
    proves the status filter excludes rows, this one proves the route
    doesn't accidentally return only one row (a `.first()`-shaped bug the
    single-org fixture structurally cannot catch).
    """
    email = _unique_email("multi")
    user_ids: list = []
    org_ids: list = []

    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            user_ids.append(user.actor_id)

            org_a = await _create_org(session, "shell6-a", "SHELL-6 Org A")
            org_b = await _create_org(session, "shell6-b", "SHELL-6 Org B")
            org_ids.extend([org_a.id, org_b.id])
            await _create_membership(session, user, org_a, OrgMembershipStatus.active)
            await _create_membership(session, user, org_b, OrgMembershipStatus.active)
            await session.commit()
            expected_ids = {str(org_a.id), str(org_b.id)}

        access_token = create_access_token(str(user_ids[0]))
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            response = await client.get(ME_ORGS_PATH, headers={"Authorization": f"Bearer {access_token}"})

        assert response.status_code == 200, response.text
        assert {org["id"] for org in response.json()["orgs"]} == expected_ids
    finally:
        await _cleanup(emails=[email], user_ids=user_ids, org_ids=org_ids)


@pytest.mark.asyncio
async def test_me_orgs_with_zero_active_memberships_is_200_empty_not_403() -> None:
    """Test-design §31: zero active memberships -> `200` with `orgs: []`.

    Deliberately NOT the `403 no_active_organization` that `POST /auth/login`
    and `POST /auth/refresh` return on the same DB state: those two decide
    whether to grant a session at all, whereas this route reports an
    already-authenticated caller's own state. The frontend depends on this
    distinction — a 200-with-empty-list drives the dropdown's "No
    organizations" row, while any error status would render as "Couldn't
    load organizations" instead (TC-SHELL-020's two distinct states).
    """
    email = _unique_email("zero")
    user_ids: list = []
    org_ids: list = []

    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            user_ids.append(user.actor_id)
            # A single non-active membership: proves the empty result comes
            # from the status filter, not from having no membership row.
            org = await _create_org(session, "shell6-zero", "SHELL-6 Suspended-Only Org")
            org_ids.append(org.id)
            await _create_membership(session, user, org, OrgMembershipStatus.suspended)
            await session.commit()

        access_token = create_access_token(str(user_ids[0]))
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            response = await client.get(ME_ORGS_PATH, headers={"Authorization": f"Bearer {access_token}"})

        assert response.status_code == 200, response.text
        assert response.json() == {"orgs": []}
    finally:
        await _cleanup(emails=[email], user_ids=user_ids, org_ids=org_ids)
