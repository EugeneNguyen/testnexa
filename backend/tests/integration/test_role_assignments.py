"""Integration tests for `POST`/`GET /orgs/{org_id}/role-assignments`
(RBAC-3, ADR-0021).

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), matching `test_projects.py`/`test_organizations.py`'s
established style. The package-level `tests/integration/conftest.py` fixture
(`_require_live_server`, autouse=True, session-scoped) applies automatically
to this module too.

Covers TC-RBAC-024 through TC-RBAC-034 from
`docs/test-cases/2026-09-03-test-cases.md`. TC-RBAC-011/TC-RBAC-035 (AIAgent
grantee resolving permissions identically, and the project-creator
regression fix) are covered in `test_projects.py` instead — those need the
now-fixed `GET`/`PATCH /projects/{id}` routes for real HTTP proof, not this
module's create/list mechanics.

Each test seeds its own `User`/`Organization`/`OrgMembership`/
`RoleAssignment` (and, where needed, `AIAgent`/`Project`/custom `Role`) rows
directly via `AsyncSessionLocal` — the same fixture-seeding precedent
`test_projects.py`/`test_organizations.py`/`test_agents.py` established —
and cleans up in a `finally` block. Emails/org slugs are unique per test.
"""

import os
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, select

from app.core.security import create_access_token, generate_api_key, hash_api_key, hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, AIAgent, User
from app.models.auth import AuthIdentity, AuthProvider
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment, RolePermission
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


def _role_assignments_path(org_id) -> str:
    return f"{API_PREFIX}/orgs/{org_id}/role-assignments"


# --- seeding / cleanup helpers ---------------------------------------------------------------
# Mirrors test_projects.py's/test_organizations.py's/test_agents.py's helpers of the same names/shapes.


def _unique_email(tag: str) -> str:
    return f"rbac3-{tag}-{uuid4().hex[:8]}@example.com"


def _unique_slug(tag: str) -> str:
    return f"rbac3-{tag}-{uuid4().hex[:8]}"


async def _create_user(session, email: str, password: str = DEFAULT_PASSWORD) -> User:
    user = User(name="RBAC-3 Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()  # populate user.actor_id (joined-table inheritance PK/FK)
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"RBAC-3 Test Org {slug_prefix}", slug=_unique_slug(slug_prefix))
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


async def _create_agent(session, *, acting_on_behalf_of_user_id, agent_name: str = "RBAC-3 Test Agent") -> AIAgent:
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
    return agent


async def _create_project(session, org: Organization, name: str) -> Project:
    project = Project(org_id=org.id, name=name)
    session.add(project)
    await session.flush()
    return project


async def _get_role_by_name(session, name: str) -> Role:
    """Look up one of RBAC-4's seeded system Roles (org_id IS NULL)."""
    result = await session.execute(select(Role).where(Role.name == name, Role.org_id.is_(None)))
    role = result.scalars().first()
    assert role is not None, f"expected the RBAC-4-seeded {name!r} system Role to already exist"
    return role


async def _assign_role(session, *, actor_id, org: Organization, role: Role, project_id=None) -> RoleAssignment:
    row = RoleAssignment(actor_id=actor_id, org_id=org.id, project_id=project_id, role_id=role.id)
    session.add(row)
    await session.flush()
    return row


async def _create_org_admin(session, tag: str) -> tuple[User, Organization]:
    """Seed a human User who is org_admin (org-wide RoleAssignment) of a
    fresh Organization, with an active OrgMembership in it.
    """
    user = await _create_user(session, _unique_email(tag))
    org = await _create_org(session, tag)
    await _create_membership(session, user, org, OrgMembershipStatus.active)
    org_admin_role = await _get_role_by_name(session, "org_admin")
    await _assign_role(session, actor_id=user.actor_id, org=org, role=org_admin_role)
    return user, org


async def _create_member_with_role(session, tag: str, org: Organization, role_name: str) -> User:
    """Seed a human User with an active OrgMembership in `org` and the named
    seeded system Role assigned org-wide (`tester`/`auditor` have no
    `role_assignment.*` in their bundles per `rbac_seed_catalog.py` —
    usable for the 403-lacks-permission cases below).
    """
    user = await _create_user(session, _unique_email(tag))
    await _create_membership(session, user, org, OrgMembershipStatus.active)
    role = await _get_role_by_name(session, role_name)
    await _assign_role(session, actor_id=user.actor_id, org=org, role=role)
    return user


def _access_token_for(actor_id) -> str:
    return create_access_token(str(actor_id))


async def _cleanup(
    *,
    emails: list[str] | None = None,
    user_ids: list | None = None,
    agent_ids: list | None = None,
    org_ids: list | None = None,
    role_ids: list | None = None,
    project_ids: list | None = None,
) -> None:
    """Delete everything a test may have created, in FK-safe order.

    Never deletes RBAC-4's seeded catalog `Role`/`Permission` rows (e.g.
    `org_admin`, `tester`) — only `Role` rows this file created itself via
    `role_ids` (custom, org-scoped roles created for the cross-org `role_id`
    case).
    """
    emails = emails or []
    user_ids = list(user_ids or [])
    agent_ids = agent_ids or []
    org_ids = org_ids or []
    role_ids = role_ids or []
    project_ids = project_ids or []

    async with AsyncSessionLocal() as session:
        if emails:
            result = await session.execute(select(User.actor_id).where(User.email.in_(emails)))
            user_ids.extend(row[0] for row in result.all() if row[0] not in user_ids)

        actor_ids_for_role_assignment_cleanup = [*user_ids, *agent_ids]
        if actor_ids_for_role_assignment_cleanup:
            await session.execute(
                delete(RoleAssignment).where(RoleAssignment.actor_id.in_(actor_ids_for_role_assignment_cleanup))
            )
        if org_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id.in_(org_ids)))
        if role_ids:
            await session.execute(delete(RolePermission).where(RolePermission.role_id.in_(role_ids)))
            await session.execute(delete(RoleAssignment).where(RoleAssignment.role_id.in_(role_ids)))
            await session.execute(delete(Role).where(Role.id.in_(role_ids)))
        if project_ids:
            await session.execute(delete(Project).where(Project.id.in_(project_ids)))
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


# --- TC-RBAC-024: create RoleAssignment, org-wide ---------------------------------------------


@pytest.mark.asyncio
async def test_create_role_assignment_org_wide_returns_201() -> None:  # TC-RBAC-024
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc024")
            target = await _create_user(session, _unique_email("tc024-target"))
            await _create_membership(session, target, org, OrgMembershipStatus.active)
            tester_role = await _get_role_by_name(session, "tester")
            await session.commit()
            user_ids = [admin.actor_id, target.actor_id]
            org_ids = [org.id]
            admin_id, org_id, target_id, role_id = admin.actor_id, org.id, target.actor_id, tester_role.id

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _role_assignments_path(org_id),
                json={"actor_id": str(target_id), "role_id": str(role_id)},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 201
        body = response.json()
        assert body["actor_id"] == str(target_id)
        assert body["org_id"] == str(org_id)
        assert body["role_id"] == str(role_id)
        assert body["project_id"] is None
        assert "id" in body
        assert "created_at" in body
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-025: create RoleAssignment, project-scoped ---------------------------------------


@pytest.mark.asyncio
async def test_create_role_assignment_project_scoped_returns_201() -> None:  # TC-RBAC-025
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc025")
            target = await _create_user(session, _unique_email("tc025-target"))
            await _create_membership(session, target, org, OrgMembershipStatus.active)
            tester_role = await _get_role_by_name(session, "tester")
            project = await _create_project(session, org, "TC-RBAC-025 Project")
            await session.commit()
            user_ids = [admin.actor_id, target.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            admin_id, org_id, target_id, role_id, project_id = (
                admin.actor_id,
                org.id,
                target.actor_id,
                tester_role.id,
                project.id,
            )

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _role_assignments_path(org_id),
                json={"actor_id": str(target_id), "role_id": str(role_id), "project_id": str(project_id)},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 201
        body = response.json()
        assert body["project_id"] == str(project_id)
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


# --- TC-RBAC-026: create-endpoint 404-vs-403 boundary ------------------------------------------


@pytest.mark.asyncio
async def test_create_role_assignment_404_for_zero_membership_actor() -> None:  # TC-RBAC-026a
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc026a-org")
            outsider = await _create_user(session, _unique_email("tc026a-outsider"))
            tester_role = await _get_role_by_name(session, "tester")
            await session.commit()
            user_ids = [admin.actor_id, outsider.actor_id]
            org_ids = [org.id]
            outsider_id, org_id, role_id = outsider.actor_id, org.id, tester_role.id

        access_token = _access_token_for(outsider_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _role_assignments_path(org_id),
                json={"actor_id": str(admin.actor_id), "role_id": str(role_id)},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 404
        assert response.json()["code"] == "not_found"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


@pytest.mark.asyncio
async def test_create_role_assignment_403_for_member_without_permission() -> None:  # TC-RBAC-026b
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc026b")
            # `tester` system role: active membership, but no
            # role_assignment.create in its bundle -> 403, not 404.
            member = await _create_member_with_role(session, "tc026b-member", org, "tester")
            tester_role = await _get_role_by_name(session, "tester")
            await session.commit()
            user_ids = [admin.actor_id, member.actor_id]
            org_ids = [org.id]
            member_id, org_id, role_id = member.actor_id, org.id, tester_role.id

        access_token = _access_token_for(member_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _role_assignments_path(org_id),
                json={"actor_id": str(admin.actor_id), "role_id": str(role_id)},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 403
        assert response.json()["code"] == "permission_denied"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-027: cross-org role_id/project_id rejected as 422, never 404 ---------------------


@pytest.mark.asyncio
async def test_create_role_assignment_cross_org_role_id_returns_422() -> None:  # TC-RBAC-027a
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc027a")
            _other_admin, other_org = await _create_org_admin(session, "tc027a-other")
            foreign_role = Role(org_id=other_org.id, name="Foreign Custom Role", is_system_role=False)
            session.add(foreign_role)
            await session.flush()
            target = await _create_user(session, _unique_email("tc027a-target"))
            await _create_membership(session, target, org, OrgMembershipStatus.active)
            await session.commit()
            user_ids = [admin.actor_id, _other_admin.actor_id, target.actor_id]
            org_ids = [org.id, other_org.id]
            role_ids = [foreign_role.id]
            admin_id, org_id, target_id, foreign_role_id = admin.actor_id, org.id, target.actor_id, foreign_role.id

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _role_assignments_path(org_id),
                json={"actor_id": str(target_id), "role_id": str(foreign_role_id)},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 422
        body = response.json()
        assert body["code"] == "validation_error"
        assert "role_id" in (body.get("field_errors") or {})
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, role_ids=role_ids)


@pytest.mark.asyncio
async def test_create_role_assignment_cross_org_project_id_returns_422() -> None:  # TC-RBAC-027b
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc027b")
            _other_admin, other_org = await _create_org_admin(session, "tc027b-other")
            foreign_project = await _create_project(session, other_org, "TC-RBAC-027b Foreign Project")
            target = await _create_user(session, _unique_email("tc027b-target"))
            await _create_membership(session, target, org, OrgMembershipStatus.active)
            tester_role = await _get_role_by_name(session, "tester")
            await session.commit()
            user_ids = [admin.actor_id, _other_admin.actor_id, target.actor_id]
            org_ids = [org.id, other_org.id]
            project_ids = [foreign_project.id]
            admin_id, org_id, target_id, role_id, foreign_project_id = (
                admin.actor_id,
                org.id,
                target.actor_id,
                tester_role.id,
                foreign_project.id,
            )

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _role_assignments_path(org_id),
                json={
                    "actor_id": str(target_id),
                    "role_id": str(role_id),
                    "project_id": str(foreign_project_id),
                },
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 422
        body = response.json()
        assert body["code"] == "validation_error"
        assert "project_id" in (body.get("field_errors") or {})
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


# --- TC-RBAC-028: unknown actor_id rejected -----------------------------------------------------


@pytest.mark.asyncio
async def test_create_role_assignment_unknown_actor_id_returns_422() -> None:  # TC-RBAC-028
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc028")
            tester_role = await _get_role_by_name(session, "tester")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            admin_id, org_id, role_id = admin.actor_id, org.id, tester_role.id

        access_token = _access_token_for(admin_id)
        unknown_actor_id = uuid4()

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _role_assignments_path(org_id),
                json={"actor_id": str(unknown_actor_id), "role_id": str(role_id)},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 422
        body = response.json()
        assert body["code"] == "validation_error"
        assert "actor_id" in (body.get("field_errors") or {})
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-029: duplicate RoleAssignment rejected --------------------------------------------


@pytest.mark.asyncio
async def test_create_role_assignment_duplicate_returns_422() -> None:  # TC-RBAC-029
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc029")
            target = await _create_user(session, _unique_email("tc029-target"))
            await _create_membership(session, target, org, OrgMembershipStatus.active)
            tester_role = await _get_role_by_name(session, "tester")
            await session.commit()
            user_ids = [admin.actor_id, target.actor_id]
            org_ids = [org.id]
            admin_id, org_id, target_id, role_id = admin.actor_id, org.id, target.actor_id, tester_role.id

        access_token = _access_token_for(admin_id)
        payload = {"actor_id": str(target_id), "role_id": str(role_id)}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            first_response = await client.post(
                _role_assignments_path(org_id),
                json=payload,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            assert first_response.status_code == 201

            duplicate_response = await client.post(
                _role_assignments_path(org_id),
                json=payload,
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert duplicate_response.status_code == 422
        assert duplicate_response.json()["code"] == "validation_error"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-030: User-actor OrgMembership precondition -----------------------------------------


@pytest.mark.asyncio
async def test_create_role_assignment_user_actor_without_membership_returns_422() -> None:  # TC-RBAC-030
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc030")
            # Target exists as a User, but has ZERO OrgMembership rows in org_id.
            target = await _create_user(session, _unique_email("tc030-target"))
            tester_role = await _get_role_by_name(session, "tester")
            await session.commit()
            user_ids = [admin.actor_id, target.actor_id]
            org_ids = [org.id]
            admin_id, org_id, target_id, role_id = admin.actor_id, org.id, target.actor_id, tester_role.id

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _role_assignments_path(org_id),
                json={"actor_id": str(target_id), "role_id": str(role_id)},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 422
        body = response.json()
        assert body["code"] == "validation_error"
        assert "actor_id" in (body.get("field_errors") or {})
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-031: any-status membership satisfies the precondition -----------------------------


@pytest.mark.asyncio
async def test_create_role_assignment_suspended_membership_still_returns_201() -> None:  # TC-RBAC-031
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc031")
            target = await _create_user(session, _unique_email("tc031-target"))
            await _create_membership(session, target, org, OrgMembershipStatus.suspended)
            tester_role = await _get_role_by_name(session, "tester")
            await session.commit()
            user_ids = [admin.actor_id, target.actor_id]
            org_ids = [org.id]
            admin_id, org_id, target_id, role_id = admin.actor_id, org.id, target.actor_id, tester_role.id

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _role_assignments_path(org_id),
                json={"actor_id": str(target_id), "role_id": str(role_id)},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 201
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-032: AIAgent actor skips the membership gate --------------------------------------


@pytest.mark.asyncio
async def test_create_role_assignment_aiagent_actor_skips_membership_gate() -> None:  # TC-RBAC-032
    user_ids: list = []
    agent_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc032")
            agent = await _create_agent(session, acting_on_behalf_of_user_id=admin.actor_id)
            tester_role = await _get_role_by_name(session, "tester")
            await session.commit()
            user_ids = [admin.actor_id]
            agent_ids = [agent.actor_id]
            org_ids = [org.id]
            admin_id, org_id, agent_id, role_id = admin.actor_id, org.id, agent.actor_id, tester_role.id

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _role_assignments_path(org_id),
                json={"actor_id": str(agent_id), "role_id": str(role_id)},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 201
        body = response.json()
        assert body["actor_id"] == str(agent_id)
    finally:
        await _cleanup(user_ids=user_ids, agent_ids=agent_ids, org_ids=org_ids)


# --- TC-RBAC-033: list RoleAssignments for an org -----------------------------------------------


@pytest.mark.asyncio
async def test_list_role_assignments_returns_org_wide_and_project_scoped_rows() -> None:  # TC-RBAC-033
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc033")
            other_admin, other_org = await _create_org_admin(session, "tc033-other")

            target = await _create_user(session, _unique_email("tc033-target"))
            await _create_membership(session, target, org, OrgMembershipStatus.active)
            tester_role = await _get_role_by_name(session, "tester")
            project = await _create_project(session, org, "TC-RBAC-033 Project")

            org_wide_assignment = await _assign_role(session, actor_id=target.actor_id, org=org, role=tester_role)
            project_scoped_assignment = await _assign_role(
                session, actor_id=target.actor_id, org=org, role=tester_role, project_id=project.id
            )
            await session.commit()

            user_ids = [admin.actor_id, other_admin.actor_id, target.actor_id]
            org_ids = [org.id, other_org.id]
            project_ids = [project.id]
            admin_id, org_id = admin.actor_id, org.id
            org_wide_id, project_scoped_id = org_wide_assignment.id, project_scoped_assignment.id

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                _role_assignments_path(org_id),
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 200
        body = response.json()
        returned_ids = {row["id"] for row in body}
        assert str(org_wide_id) in returned_ids
        assert str(project_scoped_id) in returned_ids
        assert all(row["org_id"] == str(org_id) for row in body)
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


# --- TC-RBAC-034: list-endpoint 404-vs-403 boundary ---------------------------------------------


@pytest.mark.asyncio
async def test_list_role_assignments_404_for_zero_membership_actor() -> None:  # TC-RBAC-034a
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc034a-org")
            outsider = await _create_user(session, _unique_email("tc034a-outsider"))
            await session.commit()
            user_ids = [admin.actor_id, outsider.actor_id]
            org_ids = [org.id]
            outsider_id, org_id = outsider.actor_id, org.id

        access_token = _access_token_for(outsider_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                _role_assignments_path(org_id),
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 404
        assert response.json()["code"] == "not_found"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


@pytest.mark.asyncio
async def test_list_role_assignments_403_for_member_without_permission() -> None:  # TC-RBAC-034b
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc034b")
            # `tester` system role has no role_assignment.read in its bundle.
            member = await _create_member_with_role(session, "tc034b-member", org, "tester")
            await session.commit()
            user_ids = [admin.actor_id, member.actor_id]
            org_ids = [org.id]
            member_id, org_id = member.actor_id, org.id

        access_token = _access_token_for(member_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                _role_assignments_path(org_id),
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 403
        assert response.json()["code"] == "permission_denied"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)
