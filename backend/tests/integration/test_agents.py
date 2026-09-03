"""Integration tests for AUTH-4 (AI agent bearer authentication, ADR-0015).

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), matching the style of `test_auth_login.py` /
`test_auth_refresh.py`. The package-level `tests/integration/conftest.py`
fixture (`_require_live_server`, autouse=True, session-scoped) applies
automatically to this module too.

Covers the AUTH-4-scoped cases from `docs/test-cases/2026-09-03-test-cases.md`:
TC-AUTH-010, 012, 028, 029, 030, 031, 032, 033, 034. TC-AUTH-011 (AIAgent
blocked from `/test-plans/{id}/approve`) is intentionally NOT implemented
here — that route doesn't exist yet in this codebase (no business-entity
routes are built), see the AUTH-4 scope plan §1's "AC1 is verified at the
mechanism level" note; TC-AUTH-011 is RBAC-5's/a future business-route
story's coverage obligation, not AUTH-4's.

Each test seeds its own `User`/`Organization`/`OrgMembership`/`AIAgent`/
`Role`/`Permission`/`RoleAssignment` rows directly via `AsyncSessionLocal`
(the test process shares `DATABASE_URL` with the live server under test),
the same fixture-seeding precedent AUTH-1/AUTH-2 established for
`User`/`Organization`/`OrgMembership` — RBAC-1..5's own bootstrap API
doesn't exist yet, so there is no other way to get `Role`/`RoleAssignment`
rows into place. Cleans up in a `finally` block. Emails/org slugs are unique
per test as an extra safety net against cross-test collisions.

TC-AUTH-033/034 (AC2's own proof + the org-wide-grant-recognized case)
exercise `require_permission`/`has_permission` directly through a small
in-process throwaway FastAPI app (mirroring `tests/unit/test_rbac.py`'s
`_build_protected_test_app()` pattern) rather than through the real
`POST /orgs/{org_id}/agents/{agent_id}/revoke` route. This is deliberate,
not a shortcut: `agents.py`'s real routes hardcode a human-only gate
*before* the permission check (ADR-0015 — "an `AIAgent` bearer credential
calling `.../revoke` -> 403 `actor_forbidden`, unconditionally, even if that
agent's `RoleAssignment` happens to grant `ai_agent.update`"), so an
`AIAgent` caller hitting the real `.../revoke` route can never reach the
permission check at all — that's exactly TC-AUTH-031, tested separately
below. TC-AUTH-033/034 need to isolate `require_permission`'s own
allow/deny behavior instead, independent of that hardcoded gate — the AUTH-4
scope plan §1 explicitly names "a second synthetic `require_permission`-gated
route in the test" as an acceptable proof surface for exactly this reason.
The throwaway app still exercises the real `get_current_actor`/
`require_permission`/`has_permission` functions against the real live
Postgres (via `app.api.deps.get_db`) — only the route wiring itself is
test-local, matching `test_rbac.py`'s own justification for why a
throwaway app is used instead of mutating the shared `app.main.app`
singleton.
"""

import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy import delete, select

from app.api.deps import require_permission
from app.core.security import create_access_token, generate_api_key, hash_api_key, hash_password
from app.db.session import AsyncSessionLocal
from app.main import http_exception_handler
from app.models.actor import Actor, AIAgent, User
from app.models.auth import AuthIdentity, AuthProvider
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
ME_PATH = f"{API_PREFIX}/auth/me"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


def _agents_path(org_id) -> str:
    return f"{API_PREFIX}/orgs/{org_id}/agents"


def _revoke_path(org_id, agent_id) -> str:
    return f"{API_PREFIX}/orgs/{org_id}/agents/{agent_id}/revoke"


# --- seeding / cleanup helpers ---------------------------------------------------------------
# Mirrors test_auth_login.py / test_auth_refresh.py's own helpers exactly,
# plus AIAgent/Role/Permission/RolePermission/RoleAssignment seeders.


def _unique_email(tag: str) -> str:
    return f"auth4-{tag}-{uuid4().hex[:8]}@example.com"


async def _create_user(session, email: str, password: str = DEFAULT_PASSWORD, *, with_local_identity: bool = True) -> User:
    user = User(name="AUTH-4 Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()  # populate user.actor_id (joined-table inheritance PK/FK)
    if with_local_identity:
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
        await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"AUTH-4 Test Org {slug_prefix}", slug=f"{slug_prefix}-{uuid4().hex[:8]}")
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


async def _create_agent(
    session,
    *,
    acting_on_behalf_of_user_id,
    agent_name: str = "AUTH-4 Test Agent",
    revoked_at: datetime | None = None,
    last_used_at: datetime | None = None,
) -> tuple[AIAgent, str]:
    """Seed an `AIAgent` row directly, returning `(row, raw_key)`."""
    raw_key, key_prefix = generate_api_key()
    agent = AIAgent(
        agent_name=agent_name,
        model_or_provider="test-provider/test-model",
        acting_on_behalf_of_user_id=acting_on_behalf_of_user_id,
        key_hash=hash_api_key(raw_key),
        key_prefix=key_prefix,
        issued_at=datetime.now(UTC),
        revoked_at=revoked_at,
        last_used_at=last_used_at,
    )
    session.add(agent)
    await session.flush()
    return agent, raw_key


async def _get_permission_by_code(session, code: str) -> Permission:
    """Look up an already-seeded catalog Permission (data migration, ai_agent.create/.update)."""
    result = await session.execute(select(Permission).where(Permission.code == code))
    permission = result.scalars().first()
    assert permission is not None, f"expected catalog Permission {code!r} to already be seeded"
    return permission


async def _create_custom_permission(session, code: str) -> Permission:
    """Seed an arbitrary, non-catalog Permission row for "some other permission" scenarios."""
    resource, action = code.split(".", 1)
    permission = Permission(code=code, resource=resource, action=action)
    session.add(permission)
    await session.flush()
    return permission


async def _create_role(session, org: Organization, name: str) -> Role:
    role = Role(org_id=org.id, name=name, is_system_role=False)
    session.add(role)
    await session.flush()
    return role


async def _grant_permission(session, role: Role, permission: Permission) -> RolePermission:
    row = RolePermission(role_id=role.id, permission_id=permission.id)
    session.add(row)
    await session.flush()
    return row


async def _assign_role(session, *, actor_id, org: Organization, role: Role, project_id=None) -> RoleAssignment:
    row = RoleAssignment(actor_id=actor_id, org_id=org.id, project_id=project_id, role_id=role.id)
    session.add(row)
    await session.flush()
    return row


async def _cleanup(
    *,
    emails: list[str] | None = None,
    user_ids: list | None = None,
    agent_ids: list | None = None,
    org_ids: list | None = None,
    role_ids: list | None = None,
    custom_permission_ids: list | None = None,
) -> None:
    """Delete everything seeded by a test, in FK-safe order.

    Deliberately never deletes the migration-seeded `ai_agent.create`/
    `ai_agent.update` catalog `Permission` rows — only `Permission` rows this
    file created itself via `_create_custom_permission` (tracked separately
    in `custom_permission_ids`).
    """
    emails = emails or []
    user_ids = user_ids or []
    agent_ids = agent_ids or []
    org_ids = org_ids or []
    role_ids = role_ids or []
    custom_permission_ids = custom_permission_ids or []

    async with AsyncSessionLocal() as session:
        actor_ids_for_role_assignment_cleanup = [*user_ids, *agent_ids]
        if actor_ids_for_role_assignment_cleanup:
            await session.execute(
                delete(RoleAssignment).where(RoleAssignment.actor_id.in_(actor_ids_for_role_assignment_cleanup))
            )
        if role_ids:
            await session.execute(delete(RolePermission).where(RolePermission.role_id.in_(role_ids)))
            await session.execute(delete(Role).where(Role.id.in_(role_ids)))
        if custom_permission_ids:
            await session.execute(delete(Permission).where(Permission.id.in_(custom_permission_ids)))
        if agent_ids:
            await session.execute(delete(AIAgent).where(AIAgent.actor_id.in_(agent_ids)))
            await session.execute(delete(Actor).where(Actor.id.in_(agent_ids)))
        if user_ids:
            await session.execute(delete(OrgMembership).where(OrgMembership.user_id.in_(user_ids)))
            await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id.in_(user_ids)))
        if org_ids:
            await session.execute(delete(OrgMembership).where(OrgMembership.org_id.in_(org_ids)))
            await session.execute(delete(Organization).where(Organization.id.in_(org_ids)))
        if user_ids:
            await session.execute(delete(User).where(User.actor_id.in_(user_ids)))
            await session.execute(delete(Actor).where(Actor.id.in_(user_ids)))
        await session.commit()


async def _get_agent(agent_id) -> AIAgent | None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(AIAgent).where(AIAgent.actor_id == agent_id))
        return result.scalars().first()


def _access_token_for(actor_id) -> str:
    """Build a JWT access token for an arbitrary actor_id (User or AIAgent).

    Bypasses `POST /auth/login` entirely (same precedent as
    `test_auth_refresh.py::test_me_returns_current_actor_identity`) — these
    tests need precise control over which actor a token resolves to,
    including an `AIAgent` actor_id, which the login route can never issue a
    token for at all.
    """
    return create_access_token(str(actor_id))


# --- TC-AUTH-010: agent bearer key on GET /auth/me resolves to the AIAgent -----------------


@pytest.mark.asyncio
async def test_agent_bearer_key_on_me_resolves_the_agent_not_a_user() -> None:  # TC-AUTH-010
    email = _unique_email("tc010")
    user_ids: list = []
    org_ids: list = []
    agent_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            org = await _create_org(session, "tc010")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=user.actor_id)
            await session.commit()
            user_ids, org_ids, agent_ids = [user.actor_id], [org.id], [agent.actor_id]
            agent_id, agent_name = agent.actor_id, agent.agent_name

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(ME_PATH, headers={"Authorization": f"Bearer {raw_key}"})

        assert response.status_code == 200
        body = response.json()
        assert body["actor_id"] == str(agent_id)
        assert body["actor_type"] == "ai_agent"
        assert body["agent_name"] == agent_name
        assert "email" not in body
    finally:
        await _cleanup(emails=[email], user_ids=user_ids, org_ids=org_ids, agent_ids=agent_ids)


# --- TC-AUTH-012: org_admin-equivalent issues then revokes a credential --------------------


@pytest.mark.asyncio
async def test_org_admin_equivalent_issues_and_revokes_agent_credential() -> None:  # TC-AUTH-012
    email = _unique_email("tc012")
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    agent_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_user = await _create_user(session, email)
            org = await _create_org(session, "tc012")
            await _create_membership(session, admin_user, org, OrgMembershipStatus.active)

            create_perm = await _get_permission_by_code(session, "ai_agent.create")
            update_perm = await _get_permission_by_code(session, "ai_agent.update")
            role = await _create_role(session, org, "org_admin_equivalent")
            await _grant_permission(session, role, create_perm)
            await _grant_permission(session, role, update_perm)
            await _assign_role(session, actor_id=admin_user.actor_id, org=org, role=role)

            await session.commit()
            user_ids, org_ids, role_ids = [admin_user.actor_id], [org.id], [role.id]
            admin_user_id, org_id = admin_user.actor_id, org.id

        access_token = _access_token_for(admin_user_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            create_response = await client.post(
                _agents_path(org_id),
                json={"agent_name": "TC-AUTH-012 Agent", "acting_on_behalf_of_user_id": str(admin_user_id)},
                headers={"Authorization": f"Bearer {access_token}"},
            )
            assert create_response.status_code == 201
            create_body = create_response.json()
            assert create_body["api_key"].startswith("tnx_agent_")
            assert len(create_body["key_prefix"]) == 8
            assert create_body["api_key"].startswith(f"tnx_agent_{create_body['key_prefix']}_")
            raw_key = create_body["api_key"]
            agent_id = create_body["agent_id"]
            agent_ids = [agent_id]

            revoke_response = await client.post(
                _revoke_path(org_id, agent_id),
                headers={"Authorization": f"Bearer {access_token}"},
            )
            assert revoke_response.status_code == 200
            assert revoke_response.json()["agent_id"] == agent_id

            me_response = await client.get(ME_PATH, headers={"Authorization": f"Bearer {raw_key}"})

        assert me_response.status_code == 401
        assert me_response.json()["code"] == "invalid_token"
    finally:
        await _cleanup(emails=[email], user_ids=user_ids, org_ids=org_ids, role_ids=role_ids, agent_ids=agent_ids)


# --- TC-AUTH-028: revoked key rejected, last_used_at unchanged -----------------------------


@pytest.mark.asyncio
async def test_revoked_agent_key_rejected_before_any_last_used_at_update() -> None:  # TC-AUTH-028
    email = _unique_email("tc024")
    user_ids: list = []
    org_ids: list = []
    agent_ids: list = []
    try:
        fixed_last_used_at = datetime.now(UTC) - timedelta(days=1)
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            org = await _create_org(session, "tc024")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            agent, raw_key = await _create_agent(
                session,
                acting_on_behalf_of_user_id=user.actor_id,
                revoked_at=datetime.now(UTC),
                last_used_at=fixed_last_used_at,
            )
            await session.commit()
            user_ids, org_ids, agent_ids = [user.actor_id], [org.id], [agent.actor_id]
            agent_id = agent.actor_id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(ME_PATH, headers={"Authorization": f"Bearer {raw_key}"})

        assert response.status_code == 401
        assert response.json() == {
            "code": "invalid_token",
            "message": "Invalid or expired access token.",
            "field_errors": None,
        }

        stored = await _get_agent(agent_id)
        assert stored is not None
        assert stored.last_used_at == fixed_last_used_at
    finally:
        await _cleanup(emails=[email], user_ids=user_ids, org_ids=org_ids, agent_ids=agent_ids)


# --- TC-AUTH-029: prefix-narrowed lookup still verifies the full secret --------------------


@pytest.mark.asyncio
async def test_prefix_matched_but_wrong_secret_is_rejected() -> None:  # TC-AUTH-029
    email = _unique_email("tc025")
    user_ids: list = []
    org_ids: list = []
    agent_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            org = await _create_org(session, "tc025")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            agent_a, raw_key_a = await _create_agent(
                session, acting_on_behalf_of_user_id=user.actor_id, agent_name="Agent A"
            )
            agent_b, raw_key_b = await _create_agent(
                session, acting_on_behalf_of_user_id=user.actor_id, agent_name="Agent B"
            )
            await session.commit()
            user_ids, org_ids = [user.actor_id], [org.id]
            agent_ids = [agent_a.actor_id, agent_b.actor_id]

        # Craft a bearer value with agent A's key_prefix but agent B's secret
        # segment — fixed-offset slice, not str.split("_"), since the
        # url-safe-base64 secret can itself contain "_" characters.
        secret_b = raw_key_b[len(f"tnx_agent_{agent_b.key_prefix}_") :]
        crafted_key = f"tnx_agent_{agent_a.key_prefix}_{secret_b}"
        assert crafted_key != raw_key_a
        assert crafted_key != raw_key_b

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(ME_PATH, headers={"Authorization": f"Bearer {crafted_key}"})

        assert response.status_code == 401
        assert response.json()["code"] == "invalid_token"
    finally:
        await _cleanup(emails=[email], user_ids=user_ids, org_ids=org_ids, agent_ids=agent_ids)


# --- TC-AUTH-030: last_used_at advances across 2 successive authenticated calls ------------


@pytest.mark.asyncio
async def test_last_used_at_advances_across_two_successive_calls() -> None:  # TC-AUTH-030
    email = _unique_email("tc026")
    user_ids: list = []
    org_ids: list = []
    agent_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            org = await _create_org(session, "tc026")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=user.actor_id)
            await session.commit()
            user_ids, org_ids, agent_ids = [user.actor_id], [org.id], [agent.actor_id]
            agent_id = agent.actor_id

        stored_before = await _get_agent(agent_id)
        assert stored_before is not None
        assert stored_before.last_used_at is None

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            first_response = await client.get(ME_PATH, headers={"Authorization": f"Bearer {raw_key}"})
            assert first_response.status_code == 200

            stored_after_first = await _get_agent(agent_id)
            assert stored_after_first is not None
            assert stored_after_first.last_used_at is not None

            # Real time gap so the two `last_used_at` timestamps are
            # guaranteed distinct on the wire (not just "not equal by luck").
            await asyncio.sleep(1.1)

            second_response = await client.get(ME_PATH, headers={"Authorization": f"Bearer {raw_key}"})
            assert second_response.status_code == 200

        stored_after_second = await _get_agent(agent_id)
        assert stored_after_second is not None
        assert stored_after_second.last_used_at is not None
        assert stored_after_second.last_used_at > stored_after_first.last_used_at
    finally:
        await _cleanup(emails=[email], user_ids=user_ids, org_ids=org_ids, agent_ids=agent_ids)


# --- TC-AUTH-031: AIAgent cannot issue or revoke any credential, unconditionally -----------


@pytest.mark.asyncio
async def test_agent_cannot_issue_or_revoke_credentials_even_with_the_permission_granted() -> None:  # TC-AUTH-031
    email = _unique_email("tc027")
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    agent_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            accountable_user = await _create_user(session, email)
            org = await _create_org(session, "tc027")
            await _create_membership(session, accountable_user, org, OrgMembershipStatus.active)
            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=accountable_user.actor_id)

            # Incorrectly grant this very agent ai_agent.create/.update anyway
            # — the human-only gate must reject it regardless.
            create_perm = await _get_permission_by_code(session, "ai_agent.create")
            update_perm = await _get_permission_by_code(session, "ai_agent.update")
            role = await _create_role(session, org, "mistakenly_agent_eligible")
            await _grant_permission(session, role, create_perm)
            await _grant_permission(session, role, update_perm)
            await _assign_role(session, actor_id=agent.actor_id, org=org, role=role)

            await session.commit()
            user_ids, org_ids, role_ids, agent_ids = (
                [accountable_user.actor_id],
                [org.id],
                [role.id],
                [agent.actor_id],
            )
            org_id, agent_id = org.id, agent.actor_id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            create_response = await client.post(
                _agents_path(org_id),
                json={"agent_name": "Should Never Exist", "acting_on_behalf_of_user_id": str(user_ids[0])},
                headers={"Authorization": f"Bearer {raw_key}"},
            )
            revoke_response = await client.post(
                _revoke_path(org_id, agent_id),
                headers={"Authorization": f"Bearer {raw_key}"},
            )

        for response in (create_response, revoke_response):
            assert response.status_code == 403
            assert response.json()["code"] == "actor_forbidden"
    finally:
        await _cleanup(emails=[email], user_ids=user_ids, org_ids=org_ids, role_ids=role_ids, agent_ids=agent_ids)


# --- TC-AUTH-032: no membership -> 404, membership-without-permission -> 403 ---------------


@pytest.mark.asyncio
async def test_no_membership_yields_404_membership_without_permission_yields_403() -> None:  # TC-AUTH-032
    email_a = _unique_email("tc028a")
    email_b = _unique_email("tc028b")
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            outsider = await _create_user(session, email_a)
            member_without_permission = await _create_user(session, email_b)
            org = await _create_org(session, "tc028")
            await _create_membership(session, member_without_permission, org, OrgMembershipStatus.active)
            # `outsider` deliberately gets zero OrgMembership rows anywhere.
            await session.commit()
            user_ids = [outsider.actor_id, member_without_permission.actor_id]
            org_ids = [org.id]
            org_id = org.id

        outsider_token = _access_token_for(outsider.actor_id)
        member_token = _access_token_for(member_without_permission.actor_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            outsider_response = await client.post(
                _agents_path(org_id),
                json={"agent_name": "Never Created", "acting_on_behalf_of_user_id": str(member_without_permission.actor_id)},
                headers={"Authorization": f"Bearer {outsider_token}"},
            )
            member_response = await client.post(
                _agents_path(org_id),
                json={"agent_name": "Never Created", "acting_on_behalf_of_user_id": str(member_without_permission.actor_id)},
                headers={"Authorization": f"Bearer {member_token}"},
            )

        assert outsider_response.status_code == 404
        assert outsider_response.json()["code"] == "not_found"

        assert member_response.status_code == 403
        assert member_response.json()["code"] == "permission_denied"
    finally:
        await _cleanup(emails=[email_a, email_b], user_ids=user_ids, org_ids=org_ids)


# --- Synthetic require_permission-gated app, for TC-AUTH-033/034 ---------------------------
#
# See module docstring for why: the real `.../revoke` route's human-only
# gate always fires before `require_permission` for an AIAgent caller, which
# would make TC-AUTH-033/034 indistinguishable from TC-AUTH-031 if driven
# through that real route. This throwaway app wires the real
# `get_current_actor`/`require_permission`/`has_permission` functions (real
# live DB via `app.api.deps.get_db`) behind a route with NO human-only gate,
# isolating exactly the permission-check behavior AC2 is about. Mirrors
# `tests/unit/test_rbac.py`'s `_build_protected_test_app()` justification for
# using a standalone app instead of mutating the shared `app.main.app`.


def _build_permission_only_test_app() -> FastAPI:
    test_app = FastAPI()
    test_app.add_exception_handler(HTTPException, http_exception_handler)

    @test_app.post("/__test/orgs/{org_id}/synthetic-permission-check")
    async def _synthetic_check(
        org_id: str,
        actor=Depends(require_permission("ai_agent.update")),
    ) -> dict[str, str]:
        del org_id
        return {"actor_id": str(actor.actor_id)}

    return test_app


def _synthetic_check_path(org_id) -> str:
    return f"/__test/orgs/{org_id}/synthetic-permission-check"


# --- TC-AUTH-033: AC2 proof — AIAgent lacking the permission -> 403, permission_denied -----


@pytest.mark.asyncio
async def test_agent_lacking_required_permission_gets_permission_denied_403() -> None:  # TC-AUTH-033
    email = _unique_email("tc029")
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    agent_ids: list = []
    custom_permission_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            accountable_user = await _create_user(session, email)
            org = await _create_org(session, "tc029")
            await _create_membership(session, accountable_user, org, OrgMembershipStatus.active)
            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=accountable_user.actor_id)

            other_permission = await _create_custom_permission(session, f"other_resource.other_action_{uuid4().hex[:6]}")
            role = await _create_role(session, org, "some_other_permission_role")
            await _grant_permission(session, role, other_permission)
            await _assign_role(session, actor_id=agent.actor_id, org=org, role=role)

            await session.commit()
            user_ids = [accountable_user.actor_id]
            org_ids = [org.id]
            role_ids = [role.id]
            agent_ids = [agent.actor_id]
            custom_permission_ids = [other_permission.id]
            org_id = org.id

        # The agent's own raw `tnx_agent_...` key, NOT `_access_token_for` (a
        # human JWT) — `get_current_actor`'s JWT branch only ever resolves
        # against `User` (ADR-0015: JWTs are minted for human logins only),
        # so a JWT here would 401 before `require_permission` is ever
        # reached, silently testing nothing about the permission check.
        #
        # `httpx.AsyncClient` + `ASGITransport`, not `fastapi.testclient.
        # TestClient` — `TestClient` spins its own thread-local event loop
        # via `anyio.from_thread.BlockingPortal`, which collides with
        # `app.api.deps.get_db`'s async engine already bound to pytest-
        # asyncio's session-scoped loop (`asyncpg.exceptions.InterfaceError:
        # cannot perform operation: another operation is in progress`) and
        # poisons the shared connection pool for every later test in the
        # same pytest process. Driving the ASGI app in-loop avoids that
        # entirely.
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=_build_permission_only_test_app()), base_url="http://test"
        ) as test_client:
            response = await test_client.post(
                _synthetic_check_path(org_id), headers={"Authorization": f"Bearer {raw_key}"}
            )

        assert response.status_code == 403
        body = response.json()
        assert body["code"] == "permission_denied"
        assert body["code"] != "actor_forbidden"  # distinct from TC-AUTH-031's human-only gate
    finally:
        await _cleanup(
            emails=[email],
            user_ids=user_ids,
            org_ids=org_ids,
            role_ids=role_ids,
            agent_ids=agent_ids,
            custom_permission_ids=custom_permission_ids,
        )


# --- TC-AUTH-034: org-wide RoleAssignment (project_id=null) granting the permission ---------


@pytest.mark.asyncio
async def test_org_wide_role_assignment_grants_permission_without_project_scope() -> None:  # TC-AUTH-034
    email = _unique_email("tc030")
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    agent_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            accountable_user = await _create_user(session, email)
            org = await _create_org(session, "tc030")
            await _create_membership(session, accountable_user, org, OrgMembershipStatus.active)
            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=accountable_user.actor_id)

            update_perm = await _get_permission_by_code(session, "ai_agent.update")
            role = await _create_role(session, org, "org_wide_update_grant")
            await _grant_permission(session, role, update_perm)
            # project_id=None (default) -> org-wide grant, no project-scoped
            # RoleAssignment present at all — proves the org-wide resolution
            # branch works standalone.
            await _assign_role(session, actor_id=agent.actor_id, org=org, role=role, project_id=None)

            await session.commit()
            user_ids = [accountable_user.actor_id]
            org_ids = [org.id]
            role_ids = [role.id]
            agent_ids = [agent.actor_id]
            org_id, agent_id = org.id, agent.actor_id

        # Agent's own raw key + AsyncClient/ASGITransport — see TC-AUTH-033's
        # comment above for why (both fixes apply identically here).
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=_build_permission_only_test_app()), base_url="http://test"
        ) as test_client:
            response = await test_client.post(
                _synthetic_check_path(org_id), headers={"Authorization": f"Bearer {raw_key}"}
            )

        assert response.status_code == 200
        assert response.json() == {"actor_id": str(agent_id)}
    finally:
        await _cleanup(emails=[email], user_ids=user_ids, org_ids=org_ids, role_ids=role_ids, agent_ids=agent_ids)
