"""Integration tests for REQ-5: standalone TestCase authoring (no
Requirement, no TestCondition) + optional retrofit link to a Requirement,
ADR-0069.

Covers TC-REQ-015..019 (`docs/test-cases/2026-09-03-test-cases.md`).
Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), same seeding/cleanup style as `test_req2_direct_test_case.py`.
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
from app.models.assets import Requirement, TestCase, TestCondition
from app.models.auth import AuthIdentity, AuthProvider
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus
from app.models.trace import RequirementTestCaseLink, RequirementTestConditionLink, TestConditionTestCaseLink

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


# --- seeding / cleanup helpers, mirrors test_req2_direct_test_case.py verbatim -----------------


def _unique_email(tag: str) -> str:
    return f"req5-{tag}-{uuid4().hex[:8]}@example.com"


def _unique_slug(tag: str) -> str:
    return f"req5-{tag}-{uuid4().hex[:8]}"


def _unique_name(tag: str) -> str:
    return f"REQ-5 {tag} {uuid4().hex[:8]}"


async def _create_user(session, email: str, password: str = DEFAULT_PASSWORD) -> User:
    user = User(name="REQ-5 Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"REQ-5 Test Org {slug_prefix}", slug=_unique_slug(slug_prefix))
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
        description=f"REQ-5 test requirement {tag}",
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
    test_condition_ids: list | None = None,
    test_level_ids: list | None = None,
    test_type_ids: list | None = None,
) -> None:
    """Delete everything a test may have created, in FK-safe (child-first) order."""
    user_ids = list(user_ids or [])
    org_ids = org_ids or []
    project_ids = project_ids or []
    requirement_ids = requirement_ids or []
    test_case_ids = test_case_ids or []
    test_condition_ids = test_condition_ids or []
    test_level_ids = test_level_ids or []
    test_type_ids = test_type_ids or []

    async with AsyncSessionLocal() as session:
        if test_case_ids:
            await session.execute(
                delete(RequirementTestCaseLink).where(RequirementTestCaseLink.test_case_id.in_(test_case_ids))
            )
            await session.execute(
                delete(TestConditionTestCaseLink).where(TestConditionTestCaseLink.test_case_id.in_(test_case_ids))
            )
            await session.execute(delete(TestCase).where(TestCase.id.in_(test_case_ids)))
        if test_condition_ids:
            await session.execute(
                delete(RequirementTestConditionLink).where(
                    RequirementTestConditionLink.test_condition_id.in_(test_condition_ids)
                )
            )
            await session.execute(delete(TestCondition).where(TestCondition.id.in_(test_condition_ids)))
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
        self.test_condition_ids: list = []
        self.test_level_ids: list = []
        self.test_type_ids: list = []

    async def cleanup(self) -> None:
        await _cleanup(
            user_ids=self.user_ids,
            org_ids=self.org_ids,
            project_ids=self.project_ids,
            requirement_ids=self.requirement_ids,
            test_case_ids=self.test_case_ids,
            test_condition_ids=self.test_condition_ids,
            test_level_ids=self.test_level_ids,
            test_type_ids=self.test_type_ids,
        )


async def _seed_admin_project(tag: str) -> tuple[_Fixture, str, str, str, str]:
    """Seed an org_admin User + Org + Project + TestLevel/TestType (no Requirement).

    Returns `(fixture, access_token, project_id, test_level_id, test_type_id)`.
    """
    fx = _Fixture()
    async with AsyncSessionLocal() as session:
        admin, org = await _create_org_admin(session, tag)
        project = await _create_project(session, org, tag)
        level, type_ = await _create_taxonomy(session, tag)
        await session.commit()
        fx.user_ids = [admin.actor_id]
        fx.org_ids = [org.id]
        fx.project_ids = [project.id]
        fx.test_level_ids = [level.id]
        fx.test_type_ids = [type_.id]
        token = _access_token_for(admin.actor_id)
        return fx, token, str(project.id), str(level.id), str(type_.id)


# --- TC-REQ-015: standalone TestCase authoring (no Requirement, no TestCondition) ---------------


@pytest.mark.asyncio
async def test_standalone_create_returns_201_no_requirement_no_condition() -> None:  # TC-REQ-015
    fx, token, project_id, level_id, type_id = await _seed_admin_project("015")
    try:
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                f"{API_PREFIX}/test-cases",
                json={
                    "project_id": project_id,
                    "title": "Standalone exploratory case",
                    "test_level_id": level_id,
                    "test_type_id": type_id,
                },
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 201
        body = response.json()
        fx.test_case_ids = [body["id"]]
        assert body["test_condition_id"] is None
        assert body["project_id"] == project_id
        assert body["status"] == "draft"

        # No RequirementTestCaseLink row exists for the new case — proven by
        # absence, not just inferred from a successful create response.
        async with AsyncSessionLocal() as session:
            link = await session.scalar(
                select(RequirementTestCaseLink).where(RequirementTestCaseLink.test_case_id == body["id"])
            )
            assert link is None
    finally:
        await fx.cleanup()


@pytest.mark.asyncio
async def test_standalone_create_stamps_created_by_actor_id() -> None:  # TC-REQ-015
    fx, token, project_id, level_id, type_id = await _seed_admin_project("015b")
    try:
        admin_actor_id = str(fx.user_ids[0])
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                f"{API_PREFIX}/test-cases",
                json={
                    "project_id": project_id,
                    "title": "Some standalone case",
                    "test_level_id": level_id,
                    "test_type_id": type_id,
                },
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 201
        body = response.json()
        fx.test_case_ids = [body["id"]]
        assert body["created_by_actor_id"] == admin_actor_id
    finally:
        await fx.cleanup()


@pytest.mark.asyncio
async def test_standalone_create_missing_project_id_returns_422() -> None:  # TC-REQ-015 (negative)
    fx, token, _project_id, level_id, type_id = await _seed_admin_project("015c")
    try:
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                f"{API_PREFIX}/test-cases",
                json={"title": "No project", "test_level_id": level_id, "test_type_id": type_id},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert response.status_code == 422
    finally:
        await fx.cleanup()


# --- TC-REQ-016: standalone TestCase reachable via the project-scoped admin list -----------------


@pytest.mark.asyncio
async def test_standalone_case_listable_via_project_scoped_list() -> None:  # TC-REQ-016
    fx, token, project_id, level_id, type_id = await _seed_admin_project("016")
    try:
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # Empty project: 200 empty list, not 404 — the project itself exists.
            empty_response = await client.get(
                f"{API_PREFIX}/test-cases",
                params={"project_id": project_id},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert empty_response.status_code == 200
            assert empty_response.json()["items"] == []

            create_response = await client.post(
                f"{API_PREFIX}/test-cases",
                json={
                    "project_id": project_id,
                    "title": "Sidebar-reachable case",
                    "test_level_id": level_id,
                    "test_type_id": type_id,
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            test_case_id = create_response.json()["id"]
            fx.test_case_ids = [test_case_id]

            list_response = await client.get(
                f"{API_PREFIX}/test-cases",
                params={"project_id": project_id},
                headers={"Authorization": f"Bearer {token}"},
            )

        assert list_response.status_code == 200
        ids = {item["id"] for item in list_response.json()["items"]}
        assert test_case_id in ids
    finally:
        await fx.cleanup()


# --- TC-REQ-017: link an existing standalone TestCase to a Requirement ---------------------------


@pytest.mark.asyncio
async def test_link_standalone_case_to_requirement_then_still_readable() -> None:  # TC-REQ-017
    fx, token, project_id, level_id, type_id = await _seed_admin_project("017")
    try:
        async with AsyncSessionLocal() as session:
            project = await session.get(Project, project_id)
            requirement = await _create_requirement(session, project, "017")
            await session.commit()
            fx.requirement_ids = [requirement.id]
            requirement_id = str(requirement.id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            create_response = await client.post(
                f"{API_PREFIX}/test-cases",
                json={
                    "project_id": project_id,
                    "title": "To be linked",
                    "test_level_id": level_id,
                    "test_type_id": type_id,
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            test_case_id = create_response.json()["id"]
            fx.test_case_ids = [test_case_id]

            link_response = await client.post(
                f"{API_PREFIX}/test-cases/{test_case_id}/link-requirement",
                json={"requirement_id": requirement_id},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert link_response.status_code == 201

            # A RequirementTestCaseLink row exists (queried directly).
            async with AsyncSessionLocal() as session:
                link = await session.scalar(
                    select(RequirementTestCaseLink).where(
                        RequirementTestCaseLink.requirement_id == requirement.id,
                        RequirementTestCaseLink.test_case_id == test_case_id,
                    )
                )
                assert link is not None

            # Create-then-link-then-read round trip: the resolver's
            # Requirement-link branch, not a stale project_id branch, now
            # governs — proven by an actual GET, not inferred.
            get_response = await client.get(
                f"{API_PREFIX}/test-cases/{test_case_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
        assert get_response.status_code == 200
        assert get_response.json()["id"] == test_case_id
    finally:
        await fx.cleanup()


# --- TC-REQ-018: re-linking an already-linked TestCase is a conflict -----------------------------


@pytest.mark.asyncio
async def test_relink_already_linked_via_prior_call_returns_409() -> None:  # TC-REQ-018 (sub-class b)
    fx, token, project_id, level_id, type_id = await _seed_admin_project("018b")
    try:
        async with AsyncSessionLocal() as session:
            project = await session.get(Project, project_id)
            requirement = await _create_requirement(session, project, "018b")
            await session.commit()
            fx.requirement_ids = [requirement.id]
            requirement_id = str(requirement.id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            create_response = await client.post(
                f"{API_PREFIX}/test-cases",
                json={
                    "project_id": project_id,
                    "title": "Linked once already",
                    "test_level_id": level_id,
                    "test_type_id": type_id,
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            test_case_id = create_response.json()["id"]
            fx.test_case_ids = [test_case_id]

            first_link = await client.post(
                f"{API_PREFIX}/test-cases/{test_case_id}/link-requirement",
                json={"requirement_id": requirement_id},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert first_link.status_code == 201

            second_link = await client.post(
                f"{API_PREFIX}/test-cases/{test_case_id}/link-requirement",
                json={"requirement_id": requirement_id},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert second_link.status_code == 409
        assert second_link.json()["code"] == "already_linked_to_requirement"
    finally:
        await fx.cleanup()


@pytest.mark.asyncio
async def test_link_a_test_condition_mediated_case_returns_409() -> None:  # TC-REQ-018 (sub-class a)
    """A case with `test_condition_id` already set (REQ-3's rigor path) is
    also rejected — not just a case already linked via this route."""
    fx, token, project_id, level_id, type_id = await _seed_admin_project("018a")
    try:
        async with AsyncSessionLocal() as session:
            project = await session.get(Project, project_id)
            requirement = await _create_requirement(session, project, "018a")
            second_requirement = await _create_requirement(session, project, "018a-second")
            await session.commit()
            fx.requirement_ids = [requirement.id, second_requirement.id]
            requirement_id = str(requirement.id)
            second_requirement_id = str(second_requirement.id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            condition_response = await client.post(
                f"{API_PREFIX}/requirements/{requirement_id}/test-conditions",
                json={"description": "Some condition", "priority": "medium"},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert condition_response.status_code == 201
            condition_id = condition_response.json()["id"]
            fx.test_condition_ids = [condition_id]

            create_response = await client.post(
                f"{API_PREFIX}/test-conditions/{condition_id}/test-cases",
                json={"title": "Rigor-path case", "test_level_id": level_id, "test_type_id": type_id},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert create_response.status_code == 201
            test_case_id = create_response.json()["id"]
            fx.test_case_ids = [test_case_id]

            link_response = await client.post(
                f"{API_PREFIX}/test-cases/{test_case_id}/link-requirement",
                json={"requirement_id": second_requirement_id},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert link_response.status_code == 409
        assert link_response.json()["code"] == "already_linked_to_requirement"
    finally:
        await fx.cleanup()


# --- TC-REQ-019: link-requirement cross-boundary rejection ---------------------------------------


@pytest.mark.asyncio
async def test_link_requirement_cross_org_returns_404() -> None:  # TC-REQ-019(a)
    fx, token, project_id, level_id, type_id = await _seed_admin_project("019a")
    other_requirement_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            other_admin, other_org = await _create_org_admin(session, "019a-other")
            other_project = await _create_project(session, other_org, "019a-other")
            other_requirement = await _create_requirement(session, other_project, "019a-other")
            await session.commit()
            other_requirement_ids = [other_requirement.id]
            fx.user_ids.append(other_admin.actor_id)
            fx.org_ids.append(other_org.id)
            fx.project_ids.append(other_project.id)
            other_requirement_id = str(other_requirement.id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            create_response = await client.post(
                f"{API_PREFIX}/test-cases",
                json={
                    "project_id": project_id,
                    "title": "Cross-org link attempt",
                    "test_level_id": level_id,
                    "test_type_id": type_id,
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            test_case_id = create_response.json()["id"]
            fx.test_case_ids = [test_case_id]

            link_response = await client.post(
                f"{API_PREFIX}/test-cases/{test_case_id}/link-requirement",
                json={"requirement_id": other_requirement_id},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert link_response.status_code == 404
    finally:
        fx.requirement_ids.extend(other_requirement_ids)
        await fx.cleanup()


@pytest.mark.asyncio
async def test_link_requirement_cross_project_same_org_returns_422() -> None:  # TC-REQ-019(b)
    fx, token, project_id, level_id, type_id = await _seed_admin_project("019b")
    try:
        async with AsyncSessionLocal() as session:
            org = await session.get(Organization, fx.org_ids[0])
            other_project = await _create_project(session, org, "019b-other")
            other_requirement = await _create_requirement(session, other_project, "019b-other")
            await session.commit()
            fx.project_ids.append(other_project.id)
            fx.requirement_ids = [other_requirement.id]
            other_requirement_id = str(other_requirement.id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            create_response = await client.post(
                f"{API_PREFIX}/test-cases",
                json={
                    "project_id": project_id,
                    "title": "Cross-project link attempt",
                    "test_level_id": level_id,
                    "test_type_id": type_id,
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            test_case_id = create_response.json()["id"]
            fx.test_case_ids = [test_case_id]

            link_response = await client.post(
                f"{API_PREFIX}/test-cases/{test_case_id}/link-requirement",
                json={"requirement_id": other_requirement_id},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert link_response.status_code == 422
        assert link_response.json()["code"] == "validation_error"
    finally:
        await fx.cleanup()


# --- GET /test-cases/{id}/requirement-link (implementation-time addition, ADR-0069) ---------------


@pytest.mark.asyncio
async def test_requirement_link_read_reflects_standalone_then_linked_state() -> None:
    """Backs `EntityFormPage`'s "Link to Requirement" section — `null` for a
    standalone case, the real `requirement_id` once linked."""
    fx, token, project_id, level_id, type_id = await _seed_admin_project("read-link")
    try:
        async with AsyncSessionLocal() as session:
            project = await session.get(Project, project_id)
            requirement = await _create_requirement(session, project, "read-link")
            await session.commit()
            fx.requirement_ids = [requirement.id]
            requirement_id = str(requirement.id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            create_response = await client.post(
                f"{API_PREFIX}/test-cases",
                json={
                    "project_id": project_id,
                    "title": "Read-link case",
                    "test_level_id": level_id,
                    "test_type_id": type_id,
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            test_case_id = create_response.json()["id"]
            fx.test_case_ids = [test_case_id]

            before_response = await client.get(
                f"{API_PREFIX}/test-cases/{test_case_id}/requirement-link",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert before_response.status_code == 200
            assert before_response.json()["requirement_id"] is None

            link_response = await client.post(
                f"{API_PREFIX}/test-cases/{test_case_id}/link-requirement",
                json={"requirement_id": requirement_id},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert link_response.status_code == 201

            after_response = await client.get(
                f"{API_PREFIX}/test-cases/{test_case_id}/requirement-link",
                headers={"Authorization": f"Bearer {token}"},
            )
        assert after_response.status_code == 200
        assert after_response.json()["requirement_id"] == requirement_id
    finally:
        await fx.cleanup()


# --- 2026-09-15, live-manual-test feedback: `description` field + `select` dropdown flag --------


@pytest.mark.asyncio
async def test_standalone_create_with_description_round_trips() -> None:
    """The standalone create path (`POST /test-cases`) accepts and returns `description`."""
    fx, token, project_id, level_id, type_id = await _seed_admin_project("desc-a")
    try:
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                f"{API_PREFIX}/test-cases",
                json={
                    "project_id": project_id,
                    "title": "Standalone case with description",
                    "description": "Covers the checkout happy path",
                    "test_level_id": level_id,
                    "test_type_id": type_id,
                },
                headers={"Authorization": f"Bearer {token}"},
            )
        assert response.status_code == 201
        body = response.json()
        fx.test_case_ids = [body["id"]]
        assert body["description"] == "Covers the checkout happy path"
    finally:
        await fx.cleanup()


@pytest.mark.asyncio
async def test_direct_link_create_with_description_round_trips() -> None:
    """The direct-link path (`POST /requirements/{id}/test-cases`, REQ-2) accepts `description` too."""
    fx, token, project_id, level_id, type_id = await _seed_admin_project("desc-b")
    try:
        async with AsyncSessionLocal() as session:
            project = await session.get(Project, project_id)
            requirement = await _create_requirement(session, project, "desc-b")
            await session.commit()
            fx.requirement_ids = [requirement.id]
            requirement_id = str(requirement.id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                f"{API_PREFIX}/requirements/{requirement_id}/test-cases",
                json={
                    "title": "Direct-link case with description",
                    "description": "Covers the login happy path",
                    "test_level_id": level_id,
                    "test_type_id": type_id,
                },
                headers={"Authorization": f"Bearer {token}"},
            )
        assert response.status_code == 201
        body = response.json()
        fx.test_case_ids = [body["id"]]
        assert body["description"] == "Covers the login happy path"
    finally:
        await fx.cleanup()


@pytest.mark.asyncio
async def test_rigor_path_create_with_description_round_trips() -> None:
    """The rigor path (`POST /test-conditions/{id}/test-cases`, REQ-3) accepts `description` too."""
    fx, token, project_id, level_id, type_id = await _seed_admin_project("desc-c")
    try:
        async with AsyncSessionLocal() as session:
            project = await session.get(Project, project_id)
            requirement = await _create_requirement(session, project, "desc-c")
            await session.commit()
            fx.requirement_ids = [requirement.id]
            requirement_id = str(requirement.id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            condition_response = await client.post(
                f"{API_PREFIX}/requirements/{requirement_id}/test-conditions",
                json={"description": "Some condition", "priority": "medium"},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert condition_response.status_code == 201
            condition_id = condition_response.json()["id"]
            fx.test_condition_ids = [condition_id]

            response = await client.post(
                f"{API_PREFIX}/test-conditions/{condition_id}/test-cases",
                json={
                    "title": "Rigor-path case with description",
                    "description": "Covers the rate-limit boundary",
                    "test_level_id": level_id,
                    "test_type_id": type_id,
                },
                headers={"Authorization": f"Bearer {token}"},
            )
        assert response.status_code == 201
        body = response.json()
        fx.test_case_ids = [body["id"]]
        assert body["description"] == "Covers the rate-limit boundary"
    finally:
        await fx.cleanup()


@pytest.mark.asyncio
async def test_test_case_schema_marks_test_level_type_condition_as_select() -> None:
    """`GET /entities/test-cases/schema` emits `select: true` on the 3 small
    bounded-catalog fk fields (`test_level_id`/`test_type_id`/
    `test_condition_id`) and NOT on `project_id` (unbounded, stays an
    `FkAutocomplete`)."""
    fx, token, _project_id, _level_id, _type_id = await _seed_admin_project("desc-d")
    try:
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/entities/test-cases/schema",
                headers={"Authorization": f"Bearer {token}"},
            )
        assert response.status_code == 200
        fields = {f["name"]: f for f in response.json()["fields"]}
        assert fields["test_level_id"]["select"] is True
        assert fields["test_type_id"]["select"] is True
        assert fields["test_condition_id"]["select"] is True
        assert "select" not in fields["project_id"]
        assert "description" in fields
        assert fields["description"]["type"] == "text"
    finally:
        await fx.cleanup()
