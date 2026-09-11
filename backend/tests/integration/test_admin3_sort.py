"""Integration tests for `?sort=`/`?sort=-<field>` on the generic `list`
route (ADR-0053, sort).

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), same seeding/cleanup style as `test_requirements_title.py`.
Exercises `Requirement` (a plain, non-scope-selector entity already used by
every other ADR-0053 test file) as the representative case for
`crud_factory.apply_sort`'s wiring into `list_items` — `apply_sort` itself is
unit-tested in `tests/unit/test_crud_factory.py::TestApplySort`; this file
only proves the real route actually applies it end-to-end (real `ORDER BY`,
real `422` for an unsortable/unknown field), which a unit test against a bare
`select()` cannot.
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


# --- seeding / cleanup helpers -----------------------------------------------------------------
# Mirrors test_requirements_title.py's helpers of the same names/shapes.


def _unique_email(tag: str) -> str:
    return f"admin3sort-{tag}-{uuid4().hex[:8]}@example.com"


def _unique_slug(tag: str) -> str:
    return f"admin3sort-{tag}-{uuid4().hex[:8]}"


def _unique_name(tag: str) -> str:
    return f"ADMIN-3-SORT {tag} {uuid4().hex[:8]}"


async def _create_user(session, email: str, password: str = DEFAULT_PASSWORD) -> User:
    user = User(name="ADMIN-3 Sort Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"ADMIN-3 Sort Test Org {slug_prefix}", slug=_unique_slug(slug_prefix))
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


async def _seed_three_requirements(session, project_id) -> list[Requirement]:
    """Deliberately inserted out of alphabetical order, so an unsorted
    baseline is never accidentally already-sorted by insertion order."""
    charlie = Requirement(project_id=project_id, title="Charlie requirement", description="c")
    alpha = Requirement(project_id=project_id, title="Alpha requirement", description="a")
    bravo = Requirement(project_id=project_id, title="Bravo requirement", description="b")
    session.add_all([charlie, alpha, bravo])
    await session.flush()
    return [alpha, bravo, charlie]  # alphabetical order, for asserting against


@pytest.mark.asyncio
async def test_sort_ascending_by_title_orders_items() -> None:
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "asc")
            project = await _create_project(session, org, "asc")
            alpha_bravo_charlie = await _seed_three_requirements(session, project.id)
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [r.id for r in alpha_bravo_charlie]
            token = _access_token_for(admin.actor_id)
            proj_id = project.id
            expected_titles = [r.title for r in alpha_bravo_charlie]

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/requirements",
                params={"project_id": str(proj_id), "sort": "title"},
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 200
        body = response.json()
        assert [item["title"] for item in body["items"]] == expected_titles
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, requirement_ids=requirement_ids)


@pytest.mark.asyncio
async def test_sort_descending_by_title_reverses_order() -> None:
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "desc")
            project = await _create_project(session, org, "desc")
            alpha_bravo_charlie = await _seed_three_requirements(session, project.id)
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [r.id for r in alpha_bravo_charlie]
            token = _access_token_for(admin.actor_id)
            proj_id = project.id
            expected_titles = [r.title for r in reversed(alpha_bravo_charlie)]

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/requirements",
                params={"project_id": str(proj_id), "sort": "-title"},
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 200
        body = response.json()
        assert [item["title"] for item in body["items"]] == expected_titles
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, requirement_ids=requirement_ids)


@pytest.mark.asyncio
async def test_sort_combines_with_pagination() -> None:
    """Sort must apply before the page/page_size slice, not after — otherwise
    a caller paginating a sorted list would see each page independently
    (re-)sorted rather than one globally-ordered sequence sliced into pages."""
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "page")
            project = await _create_project(session, org, "page")
            alpha_bravo_charlie = await _seed_three_requirements(session, project.id)
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [r.id for r in alpha_bravo_charlie]
            token = _access_token_for(admin.actor_id)
            proj_id = project.id
            expected_first_page = [alpha_bravo_charlie[0].title, alpha_bravo_charlie[1].title]

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/requirements",
                params={"project_id": str(proj_id), "sort": "title", "page": 1, "page_size": 2},
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 3
        assert [item["title"] for item in body["items"]] == expected_first_page
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, requirement_ids=requirement_ids)


@pytest.mark.asyncio
async def test_sort_by_unknown_field_returns_422() -> None:
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "unknown")
            project = await _create_project(session, org, "unknown")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            token = _access_token_for(admin.actor_id)
            proj_id = project.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/requirements",
                params={"project_id": str(proj_id), "sort": "not_a_real_field"},
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 422
        assert response.json()["code"] == "validation_error"
        assert "sort" in response.json()["field_errors"]
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


@pytest.mark.asyncio
async def test_no_sort_param_is_unaffected() -> None:
    """`?sort=` omitted entirely still 200s — the existing (pre-sort) shape,
    never a regression/required-param surprise for every caller that doesn't
    sort."""
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "nosort")
            project = await _create_project(session, org, "nosort")
            alpha_bravo_charlie = await _seed_three_requirements(session, project.id)
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [r.id for r in alpha_bravo_charlie]
            token = _access_token_for(admin.actor_id)
            proj_id = project.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/requirements",
                params={"project_id": str(proj_id)},
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 200
        assert response.json()["total"] == 3
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, requirement_ids=requirement_ids)


@pytest.mark.asyncio
async def test_schema_marks_title_sortable() -> None:  # ADR-0053: schema<->route consistency
    """`GET /entities/requirements/schema`'s own `sortable` flag for `title`
    must agree with the real route actually accepting `?sort=title` above —
    same "single source of truth" claim `apply_sort`'s own docstring makes
    (`sortable_fields` is computed from this exact schema at router-build
    time), proven end-to-end rather than just asserted."""
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "schema")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            token = _access_token_for(admin.actor_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/entities/requirements/schema",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 200
        fields_by_name = {f["name"]: f for f in response.json()["fields"]}
        assert fields_by_name["title"]["sortable"] is True
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)
