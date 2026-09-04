"""Integration tests for `POST /orgs/{org_id}/projects`, `GET`/`PATCH
/projects/{id}` (PROJ-1, ADR-0017).

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), matching `test_organizations.py` / `test_agents.py`'s
established style. The package-level `tests/integration/conftest.py` fixture
(`_require_live_server`, autouse=True, session-scoped) applies automatically
to this module too.

Covers TC-PROJ-001, 003, 006, 007, 008, 009, 010, 011, 012, 013 from
`docs/test-cases/2026-09-03-test-cases.md`. TC-PROJ-002 (no orphaned
Requirement/TestSuite/TestPlan outside a Project) is NOT implemented here —
per ADR-0017 it's schema-enforced already (non-nullable `project_id` FKs)
but execution-untestable until one of those three entities gets its own
create route; out of reach for this story, same posture ADR-0016/RBAC-1
took for TC-RBAC-002 before this story made the `Project` half of it
achievable (now covered by TC-PROJ-012 below).

Each test seeds its own `User`/`Organization`/`OrgMembership`/
`RoleAssignment` rows directly via `AsyncSessionLocal` — the same
fixture-seeding precedent `test_organizations.py`/`test_agents.py`
established for RBAC data (no bootstrap API exists for arbitrary
`Role`/`RoleAssignment` fixtures beyond what `POST /auth/signup` itself
produces, and signup is bootstrap-closed after the first `Organization`
row exists anyway) — and cleans up in a `finally` block. Emails/org slugs
are unique per test.
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
API_PREFIX = "/api/v1"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


def _projects_path(org_id) -> str:
    return f"{API_PREFIX}/orgs/{org_id}/projects"


def _project_path(project_id) -> str:
    return f"{API_PREFIX}/projects/{project_id}"


# --- seeding / cleanup helpers ---------------------------------------------------------------
# Mirrors test_organizations.py's/test_agents.py's helpers of the same names/shapes.


def _unique_email(tag: str) -> str:
    return f"proj1-{tag}-{uuid4().hex[:8]}@example.com"


def _unique_slug(tag: str) -> str:
    return f"proj1-{tag}-{uuid4().hex[:8]}"


async def _create_user(session, email: str, password: str = DEFAULT_PASSWORD) -> User:
    user = User(name="PROJ-1 Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()  # populate user.actor_id (joined-table inheritance PK/FK)
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str, default_standards_profile: str | None = None) -> Organization:
    org = Organization(
        name=f"PROJ-1 Test Org {slug_prefix}",
        slug=_unique_slug(slug_prefix),
        default_standards_profile=default_standards_profile,
    )
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


async def _get_role_by_name(session, name: str) -> Role:
    """Look up one of RBAC-4's seeded system Roles (org_id IS NULL)."""
    result = await session.execute(select(Role).where(Role.name == name, Role.org_id.is_(None)))
    role = result.scalars().first()
    assert role is not None, f"expected the RBAC-4-seeded {name!r} system Role to already exist"
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


async def _create_org_admin(session, tag: str, default_standards_profile: str | None = None) -> tuple[User, Organization]:
    """Seed a human User who is org_admin (org-wide RoleAssignment) of a
    fresh Organization, with an active OrgMembership in it.
    """
    user = await _create_user(session, _unique_email(tag))
    org = await _create_org(session, tag, default_standards_profile=default_standards_profile)
    await _create_membership(session, user, org, OrgMembershipStatus.active)
    org_admin_role = await _get_role_by_name(session, "org_admin")
    await _assign_role(session, actor_id=user.actor_id, org=org, role=org_admin_role)
    return user, org


async def _create_member_with_role(session, tag: str, org: Organization, role_name: str) -> User:
    """Seed a human User with an active OrgMembership in `org` and the named
    seeded system Role assigned org-wide (no `project.create`/`.read`/
    `.update` in any of `tester`/`auditor`'s bundles per
    `rbac_seed_catalog.py` — usable for both the 403-lacks-permission and
    member-without-permission cases below).
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
    org_ids: list | None = None,
    role_ids: list | None = None,
    project_ids: list | None = None,
) -> None:
    """Delete everything a test may have created, in FK-safe order.

    Mirrors `test_organizations.py`'s `_cleanup` verbatim (including its
    project_ids param, previously unused there since no create-Project route
    existed yet — this file is the first to actually populate it). Never
    deletes RBAC-4's seeded catalog `Role`/`Permission` rows (e.g.
    `org_admin`, `test_manager`, `tester`) — only `Role` rows this file
    created itself via `role_ids` (none, currently; kept for symmetry).
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


# --- TC-PROJ-001: create -> 201, scoped to org_id --------------------------------------------


@pytest.mark.asyncio
async def test_create_project_returns_201_scoped_to_org() -> None:  # TC-PROJ-001
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc001")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            admin_id, org_id = admin.actor_id, org.id

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _projects_path(org_id),
                json={"name": "TC-PROJ-001 Alpha"},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 201
        body = response.json()
        assert body["name"] == "TC-PROJ-001 Alpha"
        assert body["org_id"] == str(org_id)
        assert "id" in body
        project_ids = [body["id"]]
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


# --- TC-PROJ-003: explicit standards_profile persists, org default not consulted ------------


@pytest.mark.asyncio
async def test_create_project_explicit_standards_profile_persists() -> None:  # TC-PROJ-003
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc003", default_standards_profile="ORG-DEFAULT-PROFILE")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            admin_id, org_id = admin.actor_id, org.id

        access_token = _access_token_for(admin_id)
        explicit_profile = "ISTQB-CTFL-v4.0.1 + ISO29119-3"

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _projects_path(org_id),
                json={"name": "TC-PROJ-003 Alpha", "standards_profile": explicit_profile},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 201
        body = response.json()
        assert body["standards_profile"] == explicit_profile
        project_ids = [body["id"]]
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


# --- TC-PROJ-006: omitted standards_profile inherits org default -----------------------------


@pytest.mark.asyncio
async def test_create_project_omitted_standards_profile_inherits_org_default() -> None:  # TC-PROJ-006
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        org_default = "TC-PROJ-006 Org Default Profile"
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc006", default_standards_profile=org_default)
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            admin_id, org_id = admin.actor_id, org.id

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _projects_path(org_id),
                json={"name": "TC-PROJ-006 Alpha"},  # standards_profile omitted entirely
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 201
        body = response.json()
        assert body["standards_profile"] == org_default
        project_ids = [body["id"]]
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


# --- TC-PROJ-007: explicit null overrides a non-null org default -----------------------------


@pytest.mark.asyncio
async def test_create_project_explicit_null_overrides_org_default() -> None:  # TC-PROJ-007
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc007", default_standards_profile="NON-NULL-DEFAULT")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            admin_id, org_id = admin.actor_id, org.id

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _projects_path(org_id),
                json={"name": "TC-PROJ-007 Alpha", "standards_profile": None},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 201
        body = response.json()
        assert body["standards_profile"] is None
        project_ids = [body["id"]]
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


# --- TC-PROJ-008: PATCH updates standards_profile; omitted field on a later PATCH -------------
# --- leaves it unchanged (no org-default fallback on update) ---------------------------------


@pytest.mark.asyncio
async def test_patch_updates_standards_profile_and_omitted_field_stays_unchanged() -> None:  # TC-PROJ-008
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc008")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            admin_id, org_id = admin.actor_id, org.id

        access_token = _access_token_for(admin_id)
        headers = {"Authorization": f"Bearer {access_token}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            create_response = await client.post(
                _projects_path(org_id),
                json={"name": "TC-PROJ-008 Alpha", "standards_profile": "PROFILE-V1"},
                headers=headers,
            )
            assert create_response.status_code == 201
            project_id = create_response.json()["id"]
            project_ids = [project_id]

            # First PATCH: explicit new standards_profile -> persists.
            patch_response = await client.patch(
                _project_path(project_id),
                json={"standards_profile": "PROFILE-V2"},
                headers=headers,
            )
            assert patch_response.status_code == 200
            assert patch_response.json()["standards_profile"] == "PROFILE-V2"

            # Second PATCH: standards_profile omitted entirely -> stays V2,
            # only name changes.
            patch_response_2 = await client.patch(
                _project_path(project_id),
                json={"name": "TC-PROJ-008 Alpha Renamed"},
                headers=headers,
            )
            assert patch_response_2.status_code == 200
            body = patch_response_2.json()
            assert body["name"] == "TC-PROJ-008 Alpha Renamed"
            assert body["standards_profile"] == "PROFILE-V2"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


# --- TC-PROJ-009: creator gets project-scoped test_manager RoleAssignment; -------------------
# --- org_admin's own org-wide RoleAssignment untouched ----------------------------------------


@pytest.mark.asyncio
async def test_creator_gets_project_scoped_test_manager_role_org_admin_untouched() -> None:  # TC-PROJ-009
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc009")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            admin_id, org_id = admin.actor_id, org.id

            org_wide_assignment_before = (
                await session.execute(
                    select(RoleAssignment).where(
                        RoleAssignment.actor_id == admin_id,
                        RoleAssignment.org_id == org_id,
                        RoleAssignment.project_id.is_(None),
                    )
                )
            ).scalars().first()
            assert org_wide_assignment_before is not None
            org_wide_role_id_before = org_wide_assignment_before.role_id

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _projects_path(org_id),
                json={"name": "TC-PROJ-009 Alpha"},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 201
        new_project_id = response.json()["id"]
        project_ids = [new_project_id]

        async with AsyncSessionLocal() as session:
            test_manager_role = await _get_role_by_name(session, "test_manager")

            project_scoped_assignment = (
                await session.execute(
                    select(RoleAssignment).where(
                        RoleAssignment.actor_id == admin_id,
                        RoleAssignment.org_id == org_id,
                        RoleAssignment.project_id == new_project_id,
                    )
                )
            ).scalars().first()
            assert project_scoped_assignment is not None
            assert project_scoped_assignment.role_id == test_manager_role.id

            org_wide_assignment_after = (
                await session.execute(
                    select(RoleAssignment).where(
                        RoleAssignment.actor_id == admin_id,
                        RoleAssignment.org_id == org_id,
                        RoleAssignment.project_id.is_(None),
                    )
                )
            ).scalars().first()
            assert org_wide_assignment_after is not None
            assert org_wide_assignment_after.role_id == org_wide_role_id_before
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


# --- TC-PROJ-010: (org_id, name) collision -> 422 same org, succeeds in a different org -------


@pytest.mark.asyncio
async def test_project_name_uniqueness_is_org_scoped() -> None:  # TC-PROJ-010
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_x, org_x = await _create_org_admin(session, "tc010x")
            admin_y, org_y = await _create_org_admin(session, "tc010y")
            await session.commit()
            user_ids = [admin_x.actor_id, admin_y.actor_id]
            org_ids = [org_x.id, org_y.id]
            admin_x_id, org_x_id = admin_x.actor_id, org_x.id
            admin_y_id, org_y_id = admin_y.actor_id, org_y.id

        token_x = _access_token_for(admin_x_id)
        token_y = _access_token_for(admin_y_id)
        project_name = "TC-PROJ-010 Alpha"

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            first_response = await client.post(
                _projects_path(org_x_id),
                json={"name": project_name},
                headers={"Authorization": f"Bearer {token_x}"},
            )
            assert first_response.status_code == 201
            project_ids.append(first_response.json()["id"])

            collision_response = await client.post(
                _projects_path(org_x_id),
                json={"name": project_name},
                headers={"Authorization": f"Bearer {token_x}"},
            )
            assert collision_response.status_code == 422
            collision_body = collision_response.json()
            assert collision_body["code"] == "validation_error"
            assert "name" in (collision_body.get("field_errors") or {})

            other_org_response = await client.post(
                _projects_path(org_y_id),
                json={"name": project_name},
                headers={"Authorization": f"Bearer {token_y}"},
            )
            assert other_org_response.status_code == 201
            project_ids.append(other_org_response.json()["id"])
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


# --- TC-PROJ-011: 404-vs-403 boundary on project creation -------------------------------------


@pytest.mark.asyncio
async def test_create_project_404_for_zero_membership_actor() -> None:  # TC-PROJ-011a
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc011a-org")
            outsider = await _create_user(session, _unique_email("tc011a-outsider"))
            await session.commit()
            user_ids = [admin.actor_id, outsider.actor_id]
            org_ids = [org.id]
            outsider_id, org_id = outsider.actor_id, org.id

        access_token = _access_token_for(outsider_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _projects_path(org_id),
                json={"name": "Should Never Exist"},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 404
        assert response.json()["code"] == "not_found"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


@pytest.mark.asyncio
async def test_create_project_403_for_member_without_permission() -> None:  # TC-PROJ-011b
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc011b")
            # `tester` system role: active membership, but no project.create
            # in its bundle (rbac_seed_catalog.py) -> 403, not 404.
            member = await _create_member_with_role(session, "tc011b-member", org, "tester")
            await session.commit()
            user_ids = [admin.actor_id, member.actor_id]
            org_ids = [org.id]
            member_id, org_id = member.actor_id, org.id

        access_token = _access_token_for(member_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _projects_path(org_id),
                json={"name": "Should Never Exist"},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 403
        assert response.json()["code"] == "permission_denied"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-PROJ-012: cross-org GET/PATCH -> 404 (also TC-RBAC-002's Project case) ----------------


@pytest.mark.asyncio
async def test_cross_org_get_and_patch_return_404() -> None:  # TC-PROJ-012 / TC-RBAC-002
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_a, org_a = await _create_org_admin(session, "tc012a")
            admin_b, org_b = await _create_org_admin(session, "tc012b")
            await session.commit()
            user_ids = [admin_a.actor_id, admin_b.actor_id]
            org_ids = [org_a.id, org_b.id]
            admin_a_id, org_a_id = admin_a.actor_id, org_a.id
            admin_b_id = admin_b.actor_id

        token_a = _access_token_for(admin_a_id)
        token_b = _access_token_for(admin_b_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            create_response = await client.post(
                _projects_path(org_a_id),
                json={"name": "TC-PROJ-012 Alpha"},
                headers={"Authorization": f"Bearer {token_a}"},
            )
            assert create_response.status_code == 201
            project_id = create_response.json()["id"]
            project_ids = [project_id]

            get_response = await client.get(
                _project_path(project_id),
                headers={"Authorization": f"Bearer {token_b}"},
            )
            assert get_response.status_code == 404
            assert get_response.json()["code"] == "not_found"

            patch_response = await client.patch(
                _project_path(project_id),
                json={"name": "Should Never Apply"},
                headers={"Authorization": f"Bearer {token_b}"},
            )
            assert patch_response.status_code == 404
            assert patch_response.json()["code"] == "not_found"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


# --- TC-PROJ-013: GET/PATCH membership-without-permission -> 403 -----------------------------


@pytest.mark.asyncio
async def test_get_and_patch_403_for_member_without_permission() -> None:  # TC-PROJ-013
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc013")
            # `tester` system role has neither project.read nor
            # project.update in its bundle (rbac_seed_catalog.py).
            member = await _create_member_with_role(session, "tc013-member", org, "tester")
            await session.commit()
            user_ids = [admin.actor_id, member.actor_id]
            org_ids = [org.id]
            admin_id, org_id = admin.actor_id, org.id
            member_id = member.actor_id

        admin_token = _access_token_for(admin_id)
        member_token = _access_token_for(member_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            create_response = await client.post(
                _projects_path(org_id),
                json={"name": "TC-PROJ-013 Alpha"},
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            assert create_response.status_code == 201
            project_id = create_response.json()["id"]
            project_ids = [project_id]

            get_response = await client.get(
                _project_path(project_id),
                headers={"Authorization": f"Bearer {member_token}"},
            )
            assert get_response.status_code == 403
            assert get_response.json()["code"] == "permission_denied"

            patch_response = await client.patch(
                _project_path(project_id),
                json={"name": "Should Never Apply"},
                headers={"Authorization": f"Bearer {member_token}"},
            )
            assert patch_response.status_code == 403
            assert patch_response.json()["code"] == "permission_denied"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)
