"""Integration tests for REQ-2: direct TestCase authoring from a Requirement
(no TestCondition), ADR-0006.

Covers TC-REQ-003/TC-REQ-004 (`docs/test-cases/2026-09-03-test-cases.md`).
Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), same seeding/cleanup style as
`test_requirements_title.py`.
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
from app.models.assets import Requirement, TestCase, TestStep
from app.models.auth import AuthIdentity, AuthProvider
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus
from app.models.trace import RequirementTestCaseLink

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


# --- seeding / cleanup helpers ---------------------------------------------------------------
# Mirrors test_requirements_title.py's helpers of the same names/shapes.


def _unique_email(tag: str) -> str:
    return f"req2-{tag}-{uuid4().hex[:8]}@example.com"


def _unique_slug(tag: str) -> str:
    return f"req2-{tag}-{uuid4().hex[:8]}"


def _unique_name(tag: str) -> str:
    return f"REQ-2 {tag} {uuid4().hex[:8]}"


async def _create_user(session, email: str, password: str = DEFAULT_PASSWORD) -> User:
    user = User(name="REQ-2 Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"REQ-2 Test Org {slug_prefix}", slug=_unique_slug(slug_prefix))
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


async def _create_requirement(session, project: Project, tag: str) -> Requirement:
    requirement = Requirement(
        project_id=project.id,
        title=_unique_name(f"requirement-{tag}"),
        description=f"REQ-2 test requirement {tag}",
    )
    session.add(requirement)
    await session.flush()
    return requirement


async def _create_taxonomy(session, tag: str) -> tuple[TestLevel, TestType]:
    level = TestLevel(name=_unique_name(f"level-{tag}"))
    type_ = TestType(name=_unique_name(f"type-{tag}"))
    session.add_all([level, type_])
    await session.flush()
    return level, type_


def _access_token_for(actor_id) -> str:
    return create_access_token(str(actor_id))


async def _cleanup(
    *,
    user_ids: list | None = None,
    org_ids: list | None = None,
    project_ids: list | None = None,
    requirement_ids: list | None = None,
    test_case_ids: list | None = None,
    test_level_ids: list | None = None,
    test_type_ids: list | None = None,
) -> None:
    """Delete everything a test may have created, in FK-safe (child-first) order."""
    user_ids = list(user_ids or [])
    org_ids = org_ids or []
    project_ids = project_ids or []
    requirement_ids = requirement_ids or []
    test_case_ids = test_case_ids or []
    test_level_ids = test_level_ids or []
    test_type_ids = test_type_ids or []

    async with AsyncSessionLocal() as session:
        if test_case_ids:
            await session.execute(delete(TestStep).where(TestStep.test_case_id.in_(test_case_ids)))
            await session.execute(
                delete(RequirementTestCaseLink).where(RequirementTestCaseLink.test_case_id.in_(test_case_ids))
            )
            await session.execute(delete(TestCase).where(TestCase.id.in_(test_case_ids)))
        if requirement_ids:
            await session.execute(delete(Requirement).where(Requirement.id.in_(requirement_ids)))
        if test_level_ids:
            await session.execute(delete(TestLevel).where(TestLevel.id.in_(test_level_ids)))
        if test_type_ids:
            await session.execute(delete(TestType).where(TestType.id.in_(test_type_ids)))
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


class _Fixture:
    """Bag of ids a test needs, seeded once, cleaned up in `finally`."""

    def __init__(self) -> None:
        self.user_ids: list = []
        self.org_ids: list = []
        self.project_ids: list = []
        self.requirement_ids: list = []
        self.test_case_ids: list = []
        self.test_level_ids: list = []
        self.test_type_ids: list = []

    async def cleanup(self) -> None:
        await _cleanup(
            user_ids=self.user_ids,
            org_ids=self.org_ids,
            project_ids=self.project_ids,
            requirement_ids=self.requirement_ids,
            test_case_ids=self.test_case_ids,
            test_level_ids=self.test_level_ids,
            test_type_ids=self.test_type_ids,
        )


async def _seed_admin_requirement(tag: str) -> tuple[_Fixture, str, str, str, str]:
    """Seed an org_admin User + Org + Project + Requirement + TestLevel/TestType.

    Returns `(fixture, access_token, requirement_id, test_level_id, test_type_id)`.
    """
    fx = _Fixture()
    async with AsyncSessionLocal() as session:
        admin, org = await _create_org_admin(session, tag)
        project = await _create_project(session, org, tag)
        requirement = await _create_requirement(session, project, tag)
        level, type_ = await _create_taxonomy(session, tag)
        await session.commit()
        fx.user_ids = [admin.actor_id]
        fx.org_ids = [org.id]
        fx.project_ids = [project.id]
        fx.requirement_ids = [requirement.id]
        fx.test_level_ids = [level.id]
        fx.test_type_ids = [type_.id]
        token = _access_token_for(admin.actor_id)
        return fx, token, str(requirement.id), str(level.id), str(type_.id)


# --- TC-REQ-003: direct TestCase authoring (no TestCondition) -----------------------------------


@pytest.mark.asyncio
async def test_create_test_case_direct_link_returns_201_and_traces_to_requirement() -> None:  # TC-REQ-003
    fx, token, requirement_id, level_id, type_id = await _seed_admin_requirement("003")
    try:
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                f"{API_PREFIX}/requirements/{requirement_id}/test-cases",
                json={
                    "title": "Login rejects a wrong password",
                    "preconditions": "A user account exists",
                    "expected_result": "401 returned, no session created",
                    "test_level_id": level_id,
                    "test_type_id": type_id,
                },
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 201
        body = response.json()
        fx.test_case_ids = [body["id"]]
        assert body["test_condition_id"] is None
        assert body["title"] == "Login rejects a wrong password"
        assert body["status"] == "draft"

        # Traceable to the Requirement via RequirementTestCaseLink, no
        # TestCondition anywhere in the chain (ADR-0006).
        async with AsyncSessionLocal() as session:
            link = await session.scalar(
                select(RequirementTestCaseLink).where(
                    RequirementTestCaseLink.requirement_id == requirement_id,
                    RequirementTestCaseLink.test_case_id == body["id"],
                )
            )
            assert link is not None
    finally:
        await fx.cleanup()


@pytest.mark.asyncio
async def test_create_test_case_stamps_created_by_actor_id() -> None:  # TC-REQ-003
    fx, token, requirement_id, level_id, type_id = await _seed_admin_requirement("003b")
    try:
        admin_actor_id = str(fx.user_ids[0])
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                f"{API_PREFIX}/requirements/{requirement_id}/test-cases",
                json={"title": "Some test case", "test_level_id": level_id, "test_type_id": type_id},
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 201
        body = response.json()
        fx.test_case_ids = [body["id"]]
        assert body["created_by_actor_id"] == admin_actor_id
    finally:
        await fx.cleanup()


@pytest.mark.asyncio
async def test_created_direct_link_test_case_is_readable_afterwards() -> None:  # resolver-gap fix
    """A direct-link TestCase (test_condition_id=null, no suite) must resolve
    its org_id via RequirementTestCaseLink -- not 404 as an "orphaned" row.
    """
    fx, token, requirement_id, level_id, type_id = await _seed_admin_requirement("003c")
    try:
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            create_response = await client.post(
                f"{API_PREFIX}/requirements/{requirement_id}/test-cases",
                json={"title": "Readable after create", "test_level_id": level_id, "test_type_id": type_id},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert create_response.status_code == 201
            test_case_id = create_response.json()["id"]
            fx.test_case_ids = [test_case_id]

            get_response = await client.get(
                f"{API_PREFIX}/test-cases/{test_case_id}",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert get_response.status_code == 200
        assert get_response.json()["id"] == test_case_id
    finally:
        await fx.cleanup()


@pytest.mark.asyncio
async def test_list_test_cases_for_requirement_includes_direct_link() -> None:  # TC-REQ-003
    fx, token, requirement_id, level_id, type_id = await _seed_admin_requirement("003d")
    try:
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            create_response = await client.post(
                f"{API_PREFIX}/requirements/{requirement_id}/test-cases",
                json={"title": "Listed test case", "test_level_id": level_id, "test_type_id": type_id},
                headers={"Authorization": f"Bearer {token}"},
            )
            test_case_id = create_response.json()["id"]
            fx.test_case_ids = [test_case_id]

            list_response = await client.get(
                f"{API_PREFIX}/requirements/{requirement_id}/test-cases",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert list_response.status_code == 200
        ids = {item["id"] for item in list_response.json()["items"]}
        assert test_case_id in ids
    finally:
        await fx.cleanup()


@pytest.mark.asyncio
async def test_create_test_case_missing_test_level_id_returns_422() -> None:  # TC-REQ-003 (negative)
    fx, token, requirement_id, _level_id, type_id = await _seed_admin_requirement("003e")
    try:
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                f"{API_PREFIX}/requirements/{requirement_id}/test-cases",
                json={"title": "Missing test level", "test_type_id": type_id},
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 422
    finally:
        await fx.cleanup()


@pytest.mark.asyncio
async def test_create_test_case_for_cross_tenant_requirement_returns_404() -> None:  # NFR-1
    fx, token, _requirement_id, level_id, type_id = await _seed_admin_requirement("003f")
    other_requirement_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            other_admin, other_org = await _create_org_admin(session, "003f-other")
            other_project = await _create_project(session, other_org, "003f-other")
            other_requirement = await _create_requirement(session, other_project, "003f-other")
            await session.commit()
            other_requirement_ids = [other_requirement.id]
            fx.user_ids.append(other_admin.actor_id)
            fx.org_ids.append(other_org.id)
            fx.project_ids.append(other_project.id)
            other_requirement_id = str(other_requirement.id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                f"{API_PREFIX}/requirements/{other_requirement_id}/test-cases",
                json={"title": "Should not be creatable", "test_level_id": level_id, "test_type_id": type_id},
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 404
    finally:
        fx.requirement_ids.extend(other_requirement_ids)
        await fx.cleanup()


# --- TC-REQ-004: add and reorder TestSteps -------------------------------------------------------


@pytest.mark.asyncio
async def test_add_test_steps_are_orderable_and_independently_editable() -> None:  # TC-REQ-004
    fx, token, requirement_id, level_id, type_id = await _seed_admin_requirement("004")
    try:
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            create_response = await client.post(
                f"{API_PREFIX}/requirements/{requirement_id}/test-cases",
                json={"title": "TestCase with steps", "test_level_id": level_id, "test_type_id": type_id},
                headers={"Authorization": f"Bearer {token}"},
            )
            test_case_id = create_response.json()["id"]
            fx.test_case_ids = [test_case_id]

            step_ids = []
            for sequence, action in [(1, "Open login page"), (2, "Enter credentials"), (3, "Submit form")]:
                step_response = await client.post(
                    f"{API_PREFIX}/test-steps",
                    json={"test_case_id": test_case_id, "sequence": sequence, "action": action},
                    headers={"Authorization": f"Bearer {token}"},
                )
                assert step_response.status_code == 201
                step_ids.append(step_response.json()["id"])

            list_response = await client.get(
                f"{API_PREFIX}/test-steps",
                params={"test_case_id": test_case_id},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert list_response.status_code == 200
            items = list_response.json()["items"]
            assert [item["sequence"] for item in sorted(items, key=lambda i: i["sequence"])] == [1, 2, 3]

            # Independently editable: patch the middle step's action alone.
            patch_response = await client.patch(
                f"{API_PREFIX}/test-steps/{step_ids[1]}",
                json={"action": "Enter valid credentials"},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert patch_response.status_code == 200
            assert patch_response.json()["action"] == "Enter valid credentials"
            assert patch_response.json()["sequence"] == 2

            # First step untouched by the second step's edit.
            first_step_response = await client.get(
                f"{API_PREFIX}/test-steps/{step_ids[0]}",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert first_step_response.json()["action"] == "Open login page"
    finally:
        await fx.cleanup()
