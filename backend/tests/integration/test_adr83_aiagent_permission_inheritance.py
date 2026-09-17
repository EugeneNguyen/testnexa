"""Integration tests for ADR-0083: an `AIAgent`'s permission check inherits
from its `acting_on_behalf_of_user_id`'s own `RoleAssignment` grants.

Before this change, `has_permission`/`has_permission_in_any_org` checked
only the calling actor's own `actor_id` — an `AIAgent` with zero
`RoleAssignment` rows of its own always failed the check, regardless of
whether the human it was minted to act for held the permission. Real HTTP
requests via `httpx.AsyncClient` against a live server, same
seeding-helper pattern `test_mcp_entity_tools.py` establishes (duplicated
here rather than cross-imported, per this repo's own per-file
fixture-ownership convention).

Exercised via the generic factory's plain REST route (`/api/v1/requirements`)
rather than an MCP tool call — `get_current_actor`/`has_permission` are the
same code path either way (ADR-0033's "no parallel, weaker code path for
MCP" decision), and a bare REST call needs no MCP handshake.
"""

import os
import uuid
from datetime import UTC, datetime
from uuid import UUID

import httpx
import pytest
from sqlalchemy import delete, select

from app.core.security import generate_api_key, hash_api_key, hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import AIAgent, User
from app.models.assets import Requirement
from app.models.auth import AuthIdentity, AuthProvider
from app.models.project import Project
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


def _unique_email(tag: str) -> str:
    return f"adr83-{tag}-{uuid.uuid4().hex[:8]}@example.com"


# --- seeding helpers (mirrors test_mcp_entity_tools.py's own pattern) ----------------------


async def _create_user(session, email: str) -> User:
    user = User(name="ADR-0083 Test User", email=email, password_hash=hash_password(DEFAULT_PASSWORD))
    session.add(user)
    await session.flush()
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"ADR-0083 Test Org {slug_prefix}", slug=f"{slug_prefix}-{uuid.uuid4().hex[:8]}")
    session.add(org)
    await session.flush()
    return org


async def _create_membership(
    session, user: User, org: Organization, status: OrgMembershipStatus = OrgMembershipStatus.active
) -> OrgMembership:
    membership = OrgMembership(org_id=org.id, user_id=user.actor_id, status=status, joined_at=datetime.now(UTC))
    session.add(membership)
    await session.flush()
    return membership


async def _create_project(session, org: Organization) -> Project:
    project = Project(org_id=org.id, name=f"ADR-0083 Project {uuid.uuid4().hex[:6]}", standards_profile=None)
    session.add(project)
    await session.flush()
    return project


async def _create_agent(session, *, acting_on_behalf_of_user_id: UUID, agent_name: str = "ADR-0083 Test Agent") -> tuple[AIAgent, str]:
    raw_key, key_prefix = generate_api_key()
    agent = AIAgent(
        agent_name=agent_name,
        model_or_provider="test-provider/test-model",
        acting_on_behalf_of_user_id=acting_on_behalf_of_user_id,
        key_hash=hash_api_key(raw_key),
        key_prefix=key_prefix,
        issued_at=datetime.now(UTC),
        revoked_at=None,
        last_used_at=None,
    )
    session.add(agent)
    await session.flush()
    return agent, raw_key


async def _get_permission_by_code(session, code: str) -> Permission:
    result = await session.execute(select(Permission).where(Permission.code == code))
    permission = result.scalars().first()
    assert permission is not None, f"catalog Permission {code!r} must already be seeded (RBAC-4)"
    return permission


async def _create_role(session, org: Organization, name: str) -> Role:
    role = Role(org_id=org.id, name=name, is_system_role=False)
    session.add(role)
    await session.flush()
    return role


async def _grant_permission(session, role: Role, permission: Permission) -> None:
    session.add(RolePermission(role_id=role.id, permission_id=permission.id))
    await session.flush()


async def _assign_role(session, *, actor_id: UUID, org: Organization, role: Role) -> None:
    session.add(RoleAssignment(actor_id=actor_id, org_id=org.id, project_id=None, role_id=role.id))
    await session.flush()


async def _cleanup(*, user_ids=(), org_ids=(), project_ids=(), requirement_ids=(), role_ids=(), agent_ids=()) -> None:
    async with AsyncSessionLocal() as session:
        for rid in requirement_ids:
            await session.execute(delete(Requirement).where(Requirement.id == rid))
        for role_id in role_ids:
            await session.execute(delete(RolePermission).where(RolePermission.role_id == role_id))
            await session.execute(delete(RoleAssignment).where(RoleAssignment.role_id == role_id))
        for agent_id in agent_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == agent_id))
        for uid in user_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == uid))
        for pid in project_ids:
            await session.execute(delete(Project).where(Project.id == pid))
        for oid in org_ids:
            await session.execute(delete(OrgMembership).where(OrgMembership.org_id == oid))
        for role_id in role_ids:
            await session.execute(delete(Role).where(Role.id == role_id))
        for oid in org_ids:
            await session.execute(delete(Organization).where(Organization.id == oid))
        for agent_id in agent_ids:
            await session.execute(delete(AIAgent).where(AIAgent.actor_id == agent_id))
        for uid in user_ids:
            await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == uid))
            await session.execute(delete(User).where(User.actor_id == uid))
        await session.commit()


@pytest.mark.asyncio
async def test_agent_with_no_own_grant_inherits_behalf_users_permission() -> None:
    """The core ADR-0083 claim: an `AIAgent` with ZERO `RoleAssignment` rows
    of its own succeeds a `requirement.create` check because the human it
    acts for holds it, provided that human has an active `OrgMembership` in
    this org."""
    email = _unique_email("inherit")
    user_ids, org_ids, project_ids, requirement_ids, role_ids, agent_ids = [], [], [], [], [], []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            org = await _create_org(session, "adr83-inherit")
            await _create_membership(session, user, org)
            project = await _create_project(session, org)

            create_perm = await _get_permission_by_code(session, "requirement.create")
            role = await _create_role(session, org, "adr83_inherit_role")
            await _grant_permission(session, role, create_perm)
            await _assign_role(session, actor_id=user.actor_id, org=org, role=role)

            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=user.actor_id)
            # Deliberately NO RoleAssignment for the agent itself.
            await session.commit()

            user_ids, org_ids, project_ids, role_ids, agent_ids = [user.actor_id], [org.id], [project.id], [role.id], [agent.actor_id]
            project_id = project.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=30.0) as client:
            resp = await client.post(
                f"{API_PREFIX}/requirements",
                json={"project_id": str(project_id), "title": "Inherited-permission requirement", "description": "via agent"},
                headers={"Authorization": f"Bearer {raw_key}"},
            )
            assert resp.status_code == 201, resp.text
            requirement_ids.append(UUID(resp.json()["id"]))
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, requirement_ids=requirement_ids, role_ids=role_ids, agent_ids=agent_ids)


@pytest.mark.asyncio
async def test_agent_inheritance_requires_behalf_users_active_membership() -> None:
    """A suspended behalf-user's own `RoleAssignment` must NOT be inherited
    — an agent must not gain more reach than the human it acts for currently
    has (question 2's default)."""
    email = _unique_email("suspended")
    user_ids, org_ids, project_ids, requirement_ids, role_ids, agent_ids = [], [], [], [], [], []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            org = await _create_org(session, "adr83-suspended")
            await _create_membership(session, user, org, status=OrgMembershipStatus.suspended)
            project = await _create_project(session, org)

            create_perm = await _get_permission_by_code(session, "requirement.create")
            role = await _create_role(session, org, "adr83_suspended_role")
            await _grant_permission(session, role, create_perm)
            await _assign_role(session, actor_id=user.actor_id, org=org, role=role)

            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=user.actor_id)
            await session.commit()

            user_ids, org_ids, project_ids, role_ids, agent_ids = [user.actor_id], [org.id], [project.id], [role.id], [agent.actor_id]
            project_id = project.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=30.0) as client:
            resp = await client.post(
                f"{API_PREFIX}/requirements",
                json={"project_id": str(project_id), "title": "Should never be created", "description": "via agent"},
                headers={"Authorization": f"Bearer {raw_key}"},
            )
            assert resp.status_code == 403, resp.text
            assert resp.json()["code"] == "permission_denied", resp.json()
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, requirement_ids=requirement_ids, role_ids=role_ids, agent_ids=agent_ids)


@pytest.mark.asyncio
async def test_agent_own_grant_still_works_with_no_behalf_user_permission() -> None:
    """Regression guard: union, not replace — an agent holding its own
    `RoleAssignment` still succeeds even when the human it acts for holds
    nothing at all in this org."""
    email = _unique_email("ownglant")
    user_ids, org_ids, project_ids, requirement_ids, role_ids, agent_ids = [], [], [], [], [], []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            org = await _create_org(session, "adr83-ownglant")
            await _create_membership(session, user, org)
            project = await _create_project(session, org)

            create_perm = await _get_permission_by_code(session, "requirement.create")
            role = await _create_role(session, org, "adr83_ownglant_role")
            await _grant_permission(session, role, create_perm)
            # Only the AGENT gets the grant — the human has an active
            # membership but no RoleAssignment of their own in this org.

            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=user.actor_id)
            await _assign_role(session, actor_id=agent.actor_id, org=org, role=role)
            await session.commit()

            user_ids, org_ids, project_ids, role_ids, agent_ids = [user.actor_id], [org.id], [project.id], [role.id], [agent.actor_id]
            project_id = project.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=30.0) as client:
            resp = await client.post(
                f"{API_PREFIX}/requirements",
                json={"project_id": str(project_id), "title": "Agent's own grant", "description": "via agent"},
                headers={"Authorization": f"Bearer {raw_key}"},
            )
            assert resp.status_code == 201, resp.text
            requirement_ids.append(UUID(resp.json()["id"]))
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, requirement_ids=requirement_ids, role_ids=role_ids, agent_ids=agent_ids)
