"""Integration tests for `POST /api/v1/orgs` (RBAC-1, ADR-0016).

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), matching `test_auth_login.py` / `test_agents.py`'s
established style. The package-level `tests/integration/conftest.py` fixture
(`_require_live_server`, autouse=True, session-scoped) applies automatically
to this module too.

Covers TC-RBAC-003, TC-RBAC-022, TC-RBAC-023, plus the plan's two additional
non-TC-numbered gates: 403 for an actor holding `organization.create` in no
org at all, and 401 unauthenticated.

Each test seeds its own `User`/`Organization`/`OrgMembership`/`RoleAssignment`
(and, for TC-RBAC-023, `Project`) rows directly via `AsyncSessionLocal` — the
same fixture-seeding precedent `test_agents.py` established for RBAC data
(no bootstrap API exists yet for arbitrary `Role`/`RoleAssignment` fixtures
beyond what `POST /auth/signup` itself produces) — and cleans up in a
`finally` block. Emails/org slugs are unique per test.
"""

import os
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, select

from app.core.security import create_access_token, hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, AuthProvider
from app.models.project import Project
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
ORGS_PATH = "/api/v1/orgs"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


# --- seeding / cleanup helpers ---------------------------------------------------------------
# Mirrors test_agents.py's helpers of the same names/shapes.


def _unique_email(tag: str) -> str:
    return f"rbac1-orgs-{tag}-{uuid4().hex[:8]}@example.com"


def _unique_slug(tag: str) -> str:
    return f"rbac1-orgs-{tag}-{uuid4().hex[:8]}"


async def _create_user(session, email: str, password: str = DEFAULT_PASSWORD) -> User:
    user = User(name="RBAC-1 Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()  # populate user.actor_id (joined-table inheritance PK/FK)
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"RBAC-1 Test Org {slug_prefix}", slug=_unique_slug(slug_prefix))
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


async def _get_org_admin_role(session) -> Role:
    """Look up RBAC-4's seeded org-wide `org_admin` system Role (org_id IS NULL)."""
    result = await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
    role = result.scalars().first()
    assert role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
    return role


async def _get_permission_by_code(session, code: str) -> Permission:
    result = await session.execute(select(Permission).where(Permission.code == code))
    permission = result.scalars().first()
    assert permission is not None, f"expected catalog Permission {code!r} to already be seeded"
    return permission


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
    org_admin_role = await _get_org_admin_role(session)
    await _assign_role(session, actor_id=user.actor_id, org=org, role=org_admin_role)
    return user, org


def _access_token_for(actor_id) -> str:
    return create_access_token(str(actor_id))


async def _cleanup(
    *,
    emails: list[str] | None = None,
    user_ids: list | None = None,
    org_ids: list | None = None,
    role_ids: list | None = None,
    project_ids: list | None = None,
) -> None:
    """Delete everything a test may have created, in FK-safe order.

    Never deletes RBAC-4's seeded catalog `Role`/`Permission` rows (e.g.
    `org_admin`, `organization.create`) — only `Role` rows this file created
    itself via `role_ids` (none, currently; kept for symmetry/future use).
    """
    emails = emails or []
    user_ids = list(user_ids or [])
    org_ids = org_ids or []
    role_ids = role_ids or []
    project_ids = project_ids or []

    async with AsyncSessionLocal() as session:
        if emails:
            result = await session.execute(select(User.actor_id).where(User.email.in_(emails)))
            user_ids.extend(row[0] for row in result.all() if row[0] not in user_ids)

        if user_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(user_ids)))
        if org_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id.in_(org_ids)))
        if role_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.role_id.in_(role_ids)))
            await session.execute(delete(Role).where(Role.id.in_(role_ids)))
        if project_ids:
            await session.execute(delete(Project).where(Project.id.in_(project_ids)))
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


# --- TC-RBAC-003: org slug uniqueness -> 422 -------------------------------------------------


@pytest.mark.asyncio
async def test_create_org_slug_collision_returns_422() -> None:  # TC-RBAC-003
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, existing_org = await _create_org_admin(session, "tc003")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [existing_org.id]
            admin_id, existing_slug = admin.actor_id, existing_org.slug

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                ORGS_PATH,
                json={"name": "Colliding Org", "slug": existing_slug},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 422
        body = response.json()
        assert body["code"] == "validation_error"
        assert "slug" in (body.get("field_errors") or {})
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-022: existing org_admin creates a second, isolated org -------------------------


@pytest.mark.asyncio
async def test_org_admin_creates_second_isolated_org() -> None:  # TC-RBAC-022
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org_a = await _create_org_admin(session, "tc022")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org_a.id]
            admin_id, org_a_id = admin.actor_id, org_a.id

            # Snapshot Org A's own OrgMembership/RoleAssignment rows before
            # the second-org call, to assert they're untouched afterward.
            membership_a_before = (
                await session.execute(
                    select(OrgMembership).where(OrgMembership.org_id == org_a_id, OrgMembership.user_id == admin_id)
                )
            ).scalars().first()
            role_assignment_a_before = (
                await session.execute(
                    select(RoleAssignment).where(
                        RoleAssignment.org_id == org_a_id, RoleAssignment.actor_id == admin_id
                    )
                )
            ).scalars().first()
            assert membership_a_before is not None
            assert role_assignment_a_before is not None
            membership_a_status_before = membership_a_before.status
            role_assignment_a_role_id_before = role_assignment_a_before.role_id

        access_token = _access_token_for(admin_id)
        new_slug = _unique_slug("tc022-second")

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                ORGS_PATH,
                json={"name": "TC-RBAC-022 Second Org", "slug": new_slug},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 201
        body = response.json()
        assert body["slug"] == new_slug
        new_org_id = body["id"]
        org_ids.append(new_org_id)

        async with AsyncSessionLocal() as session:
            # New org: creator gets an active OrgMembership + org-wide
            # org_admin RoleAssignment.
            new_membership = (
                await session.execute(
                    select(OrgMembership).where(
                        OrgMembership.org_id == new_org_id, OrgMembership.user_id == admin_id
                    )
                )
            ).scalars().first()
            assert new_membership is not None
            assert new_membership.status == OrgMembershipStatus.active

            new_role_assignment = (
                await session.execute(
                    select(RoleAssignment)
                    .join(Role, Role.id == RoleAssignment.role_id)
                    .where(
                        RoleAssignment.org_id == new_org_id,
                        RoleAssignment.actor_id == admin_id,
                        RoleAssignment.project_id.is_(None),
                        Role.name == "org_admin",
                        Role.org_id.is_(None),
                    )
                )
            ).scalars().first()
            assert new_role_assignment is not None

            # Org A's own rows are unchanged.
            membership_a_after = (
                await session.execute(
                    select(OrgMembership).where(OrgMembership.org_id == org_a_id, OrgMembership.user_id == admin_id)
                )
            ).scalars().first()
            role_assignment_a_after = (
                await session.execute(
                    select(RoleAssignment).where(
                        RoleAssignment.org_id == org_a_id, RoleAssignment.actor_id == admin_id
                    )
                )
            ).scalars().first()
            assert membership_a_after is not None
            assert membership_a_after.status == membership_a_status_before
            assert role_assignment_a_after is not None
            assert role_assignment_a_after.role_id == role_assignment_a_role_id_before
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-RBAC-023: a project-scoped-only grant does not satisfy the any-org gate -------------


@pytest.mark.asyncio
async def test_project_scoped_only_grant_does_not_satisfy_any_org_gate() -> None:  # TC-RBAC-023
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, _unique_email("tc023"))
            org = await _create_org(session, "tc023")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            project = Project(org_id=org.id, name="TC-RBAC-023 Project")
            session.add(project)
            await session.flush()

            create_org_permission = await _get_permission_by_code(session, "organization.create")
            role = Role(org_id=org.id, name="project-scoped-org-creator", is_system_role=False)
            session.add(role)
            await session.flush()

            session.add(RolePermission(role_id=role.id, permission_id=create_org_permission.id))
            await session.flush()

            # The ONLY RoleAssignment this actor holds granting
            # organization.create is project-scoped (project_id non-null) —
            # must NOT satisfy has_permission_in_any_org's org-wide-only gate.
            await _assign_role(session, actor_id=user.actor_id, org=org, role=role, project_id=project.id)

            await session.commit()
            user_ids = [user.actor_id]
            org_ids = [org.id]
            role_ids = [role.id]
            project_ids = [project.id]
            user_id = user.actor_id

        access_token = _access_token_for(user_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                ORGS_PATH,
                json={"name": "Should Never Exist", "slug": _unique_slug("tc023-blocked")},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 403
        body = response.json()
        assert body["code"] == "permission_denied"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, role_ids=role_ids, project_ids=project_ids)


# --- 403 for an actor holding organization.create in no org at all --------------------------


@pytest.mark.asyncio
async def test_actor_with_no_organization_create_grant_anywhere_gets_403() -> None:  # RBAC-1 plan
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, _unique_email("tc-no-perm"))
            org = await _create_org(session, "tc-no-perm")
            await _create_membership(session, user, org, OrgMembershipStatus.active)

            # A role granting some other, unrelated permission — never
            # organization.create — to prove this isn't just "no role at all".
            other_permission = await _get_permission_by_code(session, "test_case.read")
            role = Role(org_id=org.id, name="unrelated-permission-role", is_system_role=False)
            session.add(role)
            await session.flush()

            session.add(RolePermission(role_id=role.id, permission_id=other_permission.id))
            await session.flush()
            await _assign_role(session, actor_id=user.actor_id, org=org, role=role)

            await session.commit()
            user_ids = [user.actor_id]
            org_ids = [org.id]
            role_ids = [role.id]
            user_id = user.actor_id

        access_token = _access_token_for(user_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                ORGS_PATH,
                json={"name": "Should Never Exist", "slug": _unique_slug("tc-no-perm-blocked")},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 403
        body = response.json()
        assert body["code"] == "permission_denied"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, role_ids=role_ids)


# --- 401 unauthenticated ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_org_unauthenticated_returns_401() -> None:  # RBAC-1 plan
    async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
        response = await client.post(
            ORGS_PATH,
            json={"name": "Should Never Exist", "slug": _unique_slug("tc-unauth")},
        )

    assert response.status_code == 401
    body = response.json()
    assert body["code"] == "invalid_token"
