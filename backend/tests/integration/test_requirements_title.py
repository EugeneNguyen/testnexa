"""Integration tests for `Requirement.title` (REQ-1, ADR-0024).

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), matching `test_admin2_crud.py`/`test_projects.py`'s
established style. The package-level `tests/integration/conftest.py` fixture
(`_require_live_server`, autouse=True, session-scoped) applies automatically
to this module too.

Covers TC-REQ-001 and TC-REQ-002 from
`docs/test-cases/2026-09-03-test-cases.md` — the `title` field itself
(ADR-0024). `POST`/`GET /requirements`'s scoping, permission gate, and
404-vs-403 boundary were already delivered (and are already covered) by
ADMIN-2's `test_admin2_crud.py`; this file only exercises the parts that
changed: `title` round-tripping on create, `title` becoming a required field
(422 when missing), and `title` joining `search_fields` (`?q=`) alongside the
pre-existing exact-match `?external_ref=` filter.

Each test seeds its own `User`/`Organization`/`OrgMembership`/
`RoleAssignment`/`Project` directly via `AsyncSessionLocal` — same
fixture-seeding precedent `test_admin2_crud.py` established — and cleans up
in a `finally` block. Emails/org slugs/titles are unique per test.
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
from app.models.assets import Requirement
from app.models.auth import AuthIdentity, AuthProvider
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


# --- seeding / cleanup helpers ---------------------------------------------------------------
# Mirrors test_admin2_crud.py's helpers of the same names/shapes.


def _unique_email(tag: str) -> str:
    return f"req1-{tag}-{uuid4().hex[:8]}@example.com"


def _unique_slug(tag: str) -> str:
    return f"req1-{tag}-{uuid4().hex[:8]}"


def _unique_name(tag: str) -> str:
    return f"REQ-1 {tag} {uuid4().hex[:8]}"


async def _create_user(session, email: str, password: str = DEFAULT_PASSWORD) -> User:
    user = User(name="REQ-1 Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"REQ-1 Test Org {slug_prefix}", slug=_unique_slug(slug_prefix))
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
    """Seed a human org_admin User (org-wide RoleAssignment, all permissions
    including `requirement.create`) of a fresh Organization."""
    user = await _create_user(session, _unique_email(tag))
    org = await _create_org(session, tag)
    await _create_membership(session, user, org, OrgMembershipStatus.active)
    org_admin_role = await _get_role_by_name(session, "org_admin")
    await _assign_role(session, actor_id=user.actor_id, org=org, role=org_admin_role)
    return user, org


async def _create_project(session, org: Organization, tag: str) -> Project:
    project = Project(org_id=org.id, name=_unique_name(f"project-{tag}"))
    session.add(project)
    await session.flush()
    return project


def _access_token_for(actor_id) -> str:
    return create_access_token(str(actor_id))


async def _cleanup(
    *,
    user_ids: list | None = None,
    org_ids: list | None = None,
    project_ids: list | None = None,
    requirement_ids: list | None = None,
) -> None:
    """Delete everything a test may have created, in FK-safe (child-first) order."""
    user_ids = list(user_ids or [])
    org_ids = org_ids or []
    project_ids = project_ids or []
    requirement_ids = requirement_ids or []

    async with AsyncSessionLocal() as session:
        if requirement_ids:
            await session.execute(delete(Requirement).where(Requirement.id.in_(requirement_ids)))
        if project_ids:
            await session.execute(delete(Project).where(Project.id.in_(project_ids)))
        if user_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(user_ids)))
        if org_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id.in_(org_ids)))
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


# --- TC-REQ-001: capture a requirement, title required and round-tripped ------------------------


@pytest.mark.asyncio
async def test_create_requirement_returns_201_with_title() -> None:  # TC-REQ-001
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "001")
            project = await _create_project(session, org, "001")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            token = _access_token_for(admin.actor_id)
            proj_id = project.id

        title = _unique_name("title-001")
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                f"{API_PREFIX}/requirements",
                json={
                    "project_id": str(proj_id),
                    "title": title,
                    "description": "TC-REQ-001 requirement description",
                    "source": "stakeholder interview",
                    "external_ref": f"JIRA-{uuid4().hex[:6]}",
                },
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 201
        body = response.json()
        requirement_ids = [body["id"]]
        assert body["title"] == title
        assert body["project_id"] == str(proj_id)
        assert body["description"] == "TC-REQ-001 requirement description"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, requirement_ids=requirement_ids)


@pytest.mark.asyncio
async def test_create_requirement_missing_title_returns_422() -> None:  # TC-REQ-001 (negative)
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "001-neg")
            project = await _create_project(session, org, "001-neg")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            token = _access_token_for(admin.actor_id)
            proj_id = project.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                f"{API_PREFIX}/requirements",
                json={"project_id": str(proj_id), "description": "No title given"},
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 422
        assert response.json()["code"] == "validation_error"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


# --- TC-REQ-002: search by title substring (?q=) vs. exact external_ref (?external_ref=) --------


@pytest.mark.asyncio
async def test_search_by_title_substring_returns_matching_subset() -> None:  # TC-REQ-002
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    try:
        needle = f"UNIQUE-TITLE-NEEDLE-{uuid4().hex[:8]}"
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "002")
            project = await _create_project(session, org, "002")
            matching_1 = Requirement(
                project_id=project.id, title=f"contains {needle} first", description="req A"
            )
            matching_2 = Requirement(
                project_id=project.id, title=f"also has {needle} here", description="req B"
            )
            other = Requirement(project_id=project.id, title="totally unrelated title", description="req C")
            session.add_all([matching_1, matching_2, other])
            await session.flush()
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [matching_1.id, matching_2.id, other.id]
            token = _access_token_for(admin.actor_id)
            proj_id = project.id
            matching_ids = {str(matching_1.id), str(matching_2.id)}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/requirements",
                params={"project_id": str(proj_id), "q": needle},
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 2
        returned_ids = {item["id"] for item in body["items"]}
        assert returned_ids == matching_ids
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, requirement_ids=requirement_ids)


@pytest.mark.asyncio
async def test_filter_by_external_ref_is_exact_not_substring() -> None:  # TC-REQ-002
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    try:
        exact_ref = f"JIRA-{uuid4().hex[:8]}"
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "002b")
            project = await _create_project(session, org, "002b")
            exact_match = Requirement(
                project_id=project.id,
                title="exact ref requirement",
                description="req exact",
                external_ref=exact_ref,
            )
            # Its external_ref *contains* exact_ref as a substring, but is not
            # equal to it -- must NOT be returned by an exact `?external_ref=`
            # filter (proves exact, not substring, matching).
            substring_only = Requirement(
                project_id=project.id,
                title="substring ref requirement",
                description="req substring",
                external_ref=f"{exact_ref}-EXTRA",
            )
            session.add_all([exact_match, substring_only])
            await session.flush()
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [exact_match.id, substring_only.id]
            token = _access_token_for(admin.actor_id)
            proj_id = project.id
            exact_id = str(exact_match.id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/requirements",
                params={"project_id": str(proj_id), "external_ref": exact_ref},
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["items"][0]["id"] == exact_id
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, requirement_ids=requirement_ids)
