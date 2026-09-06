"""Integration tests for REQ-3's rigor path — `POST /requirements/{id}/test-conditions`
and `POST /test-conditions/{id}/test-cases` (ADR-0028), plus the generic
factory's now-restricted `POST /test-conditions`.

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), matching `test_releases.py`/`test_projects.py`'s
established style. The package-level `tests/integration/conftest.py` fixture
(`_require_live_server`, autouse=True, session-scoped) applies automatically
to this module too.

Covers TC-REQ-005, 006, 007, 010, 011 from
`docs/test-cases/2026-09-03-test-cases.md`, plus the 404-vs-403 org-boundary
classes both new routes inherit (`docs/test-design/2026-09-03-test-design.md`
§24, reusing §4/§19's Class B/C).

Every link-table assertion queries the link table *directly* via
`AsyncSessionLocal` rather than inferring it from the `201` response body —
§24 is explicit that a route which creates the entity but silently skips the
link insert would still pass a response-shape-only test. TC-REQ-006's
transitive assertion goes further and walks
`TestConditionTestCaseLink -> TestCondition -> RequirementTestConditionLink ->
Requirement` as one multi-hop join, because two independently-existing link
rows could still point at inconsistent parents.

One known-defect marker: TC-REQ-007's direct-path arm's own
`GET /test-cases/{id}` is `xfail(strict=True)` — the generic factory's
`resolve_test_case_org_id` has no `RequirementTestCaseLink` fallback, a
pre-existing ADR-0022 gap owned by REQ-2, not introduced by this story. See
`test_direct_path_test_case_is_readable_over_http`'s marker for the full
root cause.

Each test seeds its own `User`/`Organization`/`OrgMembership`/
`RoleAssignment`/`Project`/`Requirement` (and, where needed,
`TestLevel`/`TestType`/`TestCondition`/`TestCase` and their link rows — none
of which REQ-3 exposes a seeding route for) directly via `AsyncSessionLocal`,
same precedent `test_projects.py`/`test_releases.py` established, and cleans
up in a `finally` block. Emails/org slugs/names are unique per test.
"""

import os
from datetime import UTC, datetime
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import delete, or_, select

from app.core.security import create_access_token, hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import (
    Requirement,
    TestCase,
    TestCaseStatus,
    TestCondition,
    TestConditionPriority,
)
from app.models.auth import AuthIdentity, AuthProvider
from app.models.project import Project
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus
from app.models.trace import (
    RequirementTestCaseLink,
    RequirementTestConditionLink,
    TestConditionTestCaseLink,
)

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


def _requirement_test_conditions_path(requirement_id) -> str:
    return f"{API_PREFIX}/requirements/{requirement_id}/test-conditions"


def _test_condition_test_cases_path(test_condition_id) -> str:
    return f"{API_PREFIX}/test-conditions/{test_condition_id}/test-cases"


def _test_conditions_path() -> str:
    """The generic factory's flat collection path (ADR-0022)."""
    return f"{API_PREFIX}/test-conditions"


def _test_condition_path(test_condition_id) -> str:
    return f"{API_PREFIX}/test-conditions/{test_condition_id}"


def _test_case_path(test_case_id) -> str:
    return f"{API_PREFIX}/test-cases/{test_case_id}"


# --- seeding / cleanup helpers ---------------------------------------------------------------
# Mirrors test_releases.py's helpers of the same names/shapes, extended with
# the Requirement/TestCondition/TestCase + link-table chain this story needs.


def _unique_email(tag: str) -> str:
    return f"req3-{tag}-{uuid4().hex[:8]}@example.com"


def _unique_slug(tag: str) -> str:
    return f"req3-{tag}-{uuid4().hex[:8]}"


def _unique_name(tag: str) -> str:
    return f"REQ-3 {tag} {uuid4().hex[:8]}"


async def _create_user(session, email: str, password: str = DEFAULT_PASSWORD) -> User:
    user = User(name="REQ-3 Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()  # populate user.actor_id (joined-table inheritance PK/FK)
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"REQ-3 Test Org {slug_prefix}", slug=_unique_slug(slug_prefix))
    session.add(org)
    await session.flush()
    return org


async def _create_membership(
    session, user: User, org: Organization, status: OrgMembershipStatus
) -> OrgMembership:
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
    seeded system Role assigned org-wide.
    """
    user = await _create_user(session, _unique_email(tag))
    await _create_membership(session, user, org, OrgMembershipStatus.active)
    role = await _get_role_by_name(session, role_name)
    await _assign_role(session, actor_id=user.actor_id, org=org, role=role)
    return user


async def _create_custom_role_member(
    session, tag: str, org: Organization, permission_codes: list[str]
) -> tuple[User, Role]:
    """Seed a human User with an active `OrgMembership` in `org` and a
    bespoke, org-scoped `Role` (NOT one of the 5 system roles) granting
    exactly `permission_codes`.

    Used for the "membership present, required permission missing -> 403"
    half of the 404-vs-403 boundary: the actor deliberately *does* hold a
    role with a real (unrelated) permission, so a 403 proves the specific
    `test_condition.create`/`test_case.create` gate fired rather than a
    blanket has-no-roles-at-all rejection.
    """
    user = await _create_user(session, _unique_email(tag))
    await _create_membership(session, user, org, OrgMembershipStatus.active)

    role = Role(org_id=org.id, name=f"custom-{tag}-{uuid4().hex[:6]}", is_system_role=False)
    session.add(role)
    await session.flush()

    for code in permission_codes:
        permission = await _get_permission_by_code(session, code)
        session.add(RolePermission(role_id=role.id, permission_id=permission.id))
    await session.flush()

    await _assign_role(session, actor_id=user.actor_id, org=org, role=role)
    return user, role


def _access_token_for(actor_id) -> str:
    return create_access_token(str(actor_id))


async def _create_project(session, org: Organization, tag: str) -> Project:
    project = Project(org_id=org.id, name=_unique_name(tag))
    session.add(project)
    await session.flush()
    return project


async def _create_requirement(session, project: Project, tag: str) -> Requirement:
    requirement = Requirement(
        project_id=project.id,
        title=_unique_name(f"Req {tag}"),
        description=f"REQ-3 requirement description {tag}",
    )
    session.add(requirement)
    await session.flush()
    return requirement


async def _create_test_condition(
    session,
    requirement: Requirement,
    tag: str,
    *,
    priority: TestConditionPriority = TestConditionPriority.medium,
    with_link: bool = True,
) -> TestCondition:
    """Seed a `TestCondition` (+ its `RequirementTestConditionLink`) directly.

    `POST /test-conditions` is removed by ADR-0028 and the bespoke route is
    what several of these tests are *asserting on*, so fixtures that merely
    need a pre-existing TestCondition seed it via the session instead.
    """
    condition = TestCondition(
        requirement_id=requirement.id,
        description=f"REQ-3 seeded condition {tag} {uuid4().hex[:6]}",
        priority=priority,
    )
    session.add(condition)
    await session.flush()
    if with_link:
        session.add(
            RequirementTestConditionLink(
                requirement_id=requirement.id, test_condition_id=condition.id
            )
        )
        await session.flush()
    return condition


async def _create_test_level(session, tag: str) -> TestLevel:
    level = TestLevel(name=f"REQ-3 Level {tag} {uuid4().hex[:8]}")
    session.add(level)
    await session.flush()
    return level


async def _create_test_type(session, tag: str) -> TestType:
    test_type = TestType(name=f"REQ-3 Type {tag} {uuid4().hex[:8]}")
    session.add(test_type)
    await session.flush()
    return test_type


async def _create_direct_path_test_case(
    session,
    requirement: Requirement,
    actor_id,
    test_level: TestLevel,
    test_type: TestType,
    tag: str,
) -> TestCase:
    """Seed a REQ-2-shaped ("direct path") TestCase: `test_condition_id IS NULL`,
    traced to its Requirement via `RequirementTestCaseLink` only.

    REQ-2's own route (`POST /requirements/{id}/test-cases`) is explicitly out
    of scope for this story and not built, so TC-REQ-007's direct-path arm is
    seeded through the session rather than over HTTP.
    """
    test_case = TestCase(
        test_condition_id=None,
        test_level_id=test_level.id,
        test_type_id=test_type.id,
        created_by_actor_id=actor_id,
        title=_unique_name(f"Direct TC {tag}"),
        status=TestCaseStatus.draft,
    )
    session.add(test_case)
    await session.flush()
    session.add(RequirementTestCaseLink(requirement_id=requirement.id, test_case_id=test_case.id))
    await session.flush()
    return test_case


# --- direct DB assertions (never inferred from a response body) ------------------------------


async def _requirement_test_condition_link_ids(requirement_id, test_condition_id) -> list:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(RequirementTestConditionLink.id).where(
                RequirementTestConditionLink.requirement_id == requirement_id,
                RequirementTestConditionLink.test_condition_id == test_condition_id,
            )
        )
        return [row[0] for row in result.all()]


async def _test_condition_test_case_link_ids(test_condition_id, test_case_id) -> list:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(TestConditionTestCaseLink.id).where(
                TestConditionTestCaseLink.test_condition_id == test_condition_id,
                TestConditionTestCaseLink.test_case_id == test_case_id,
            )
        )
        return [row[0] for row in result.all()]


async def _requirement_ids_traced_from_test_case(test_case_id) -> list:
    """Walk `TestConditionTestCaseLink -> TestCondition -> RequirementTestConditionLink
    -> Requirement` for one TestCase, as a single multi-hop join.

    TC-REQ-006 / test-design §24: asserting the two link rows exist
    *independently* is explicitly insufficient — each could individually exist
    while pointing at inconsistent parents. Only a joined walk proves the
    chain actually reaches the originating Requirement.
    """
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Requirement.id)
            .select_from(TestConditionTestCaseLink)
            .join(TestCondition, TestCondition.id == TestConditionTestCaseLink.test_condition_id)
            .join(
                RequirementTestConditionLink,
                RequirementTestConditionLink.test_condition_id == TestCondition.id,
            )
            .join(Requirement, Requirement.id == RequirementTestConditionLink.requirement_id)
            .where(TestConditionTestCaseLink.test_case_id == test_case_id)
        )
        return [row[0] for row in result.all()]


async def _requirement_test_case_link_count(test_case_id) -> int:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(RequirementTestCaseLink.id).where(
                RequirementTestCaseLink.test_case_id == test_case_id
            )
        )
        return len(result.all())


async def _test_condition_test_case_link_count(test_case_id) -> int:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(TestConditionTestCaseLink.id).where(
                TestConditionTestCaseLink.test_case_id == test_case_id
            )
        )
        return len(result.all())


async def _fetch_test_condition(test_condition_id) -> TestCondition | None:
    async with AsyncSessionLocal() as session:
        return await session.get(TestCondition, test_condition_id)


async def _fetch_test_case(test_case_id) -> TestCase | None:
    async with AsyncSessionLocal() as session:
        return await session.get(TestCase, test_case_id)


async def _cleanup(
    *,
    emails: list[str] | None = None,
    user_ids: list | None = None,
    org_ids: list | None = None,
    role_ids: list | None = None,
    project_ids: list | None = None,
    requirement_ids: list | None = None,
    test_condition_ids: list | None = None,
    test_case_ids: list | None = None,
    test_level_ids: list | None = None,
    test_type_ids: list | None = None,
) -> None:
    """Delete everything a test may have created, in FK-safe order.

    Same shape as `test_releases.py`'s `_cleanup`, extended with the
    Requirement/TestCondition/TestCase chain and its 3 link tables. Link rows
    are deleted explicitly first (they'd cascade, but the entity FKs above
    them are `RESTRICT`, so the order matters and being explicit keeps a
    failed-mid-test run from leaving orphans). Never deletes RBAC-4's seeded
    catalog `Role`/`Permission` rows — only bespoke `Role` rows a test
    created itself via `role_ids`.
    """
    emails = emails or []
    user_ids = list(user_ids or [])
    org_ids = org_ids or []
    role_ids = role_ids or []
    project_ids = project_ids or []
    requirement_ids = requirement_ids or []
    test_condition_ids = test_condition_ids or []
    test_case_ids = test_case_ids or []
    test_level_ids = test_level_ids or []
    test_type_ids = test_type_ids or []

    async with AsyncSessionLocal() as session:
        if emails:
            result = await session.execute(select(User.actor_id).where(User.email.in_(emails)))
            user_ids.extend(row[0] for row in result.all() if row[0] not in user_ids)

        if test_case_ids or test_condition_ids:
            conditions = []
            if test_case_ids:
                conditions.append(TestConditionTestCaseLink.test_case_id.in_(test_case_ids))
            if test_condition_ids:
                conditions.append(
                    TestConditionTestCaseLink.test_condition_id.in_(test_condition_ids)
                )
            await session.execute(delete(TestConditionTestCaseLink).where(or_(*conditions)))
        if test_case_ids or requirement_ids:
            conditions = []
            if test_case_ids:
                conditions.append(RequirementTestCaseLink.test_case_id.in_(test_case_ids))
            if requirement_ids:
                conditions.append(RequirementTestCaseLink.requirement_id.in_(requirement_ids))
            await session.execute(delete(RequirementTestCaseLink).where(or_(*conditions)))
        if test_condition_ids or requirement_ids:
            conditions = []
            if test_condition_ids:
                conditions.append(
                    RequirementTestConditionLink.test_condition_id.in_(test_condition_ids)
                )
            if requirement_ids:
                conditions.append(RequirementTestConditionLink.requirement_id.in_(requirement_ids))
            await session.execute(delete(RequirementTestConditionLink).where(or_(*conditions)))

        if test_case_ids:
            await session.execute(delete(TestCase).where(TestCase.id.in_(test_case_ids)))
        if test_condition_ids:
            await session.execute(
                delete(TestCondition).where(TestCondition.id.in_(test_condition_ids))
            )
        if requirement_ids:
            await session.execute(delete(Requirement).where(Requirement.id.in_(requirement_ids)))
        if test_level_ids:
            await session.execute(delete(TestLevel).where(TestLevel.id.in_(test_level_ids)))
        if test_type_ids:
            await session.execute(delete(TestType).where(TestType.id.in_(test_type_ids)))

        if user_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(user_ids)))
        if org_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id.in_(org_ids)))
        if role_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.role_id.in_(role_ids)))
            await session.execute(delete(RolePermission).where(RolePermission.role_id.in_(role_ids)))
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


# --- TC-REQ-005: TestCondition create writes BOTH the row and its link row --------------------


@pytest.mark.asyncio
async def test_create_test_condition_for_requirement_writes_row_and_link() -> None:  # TC-REQ-005
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcreq005")
            project = await _create_project(session, org, "tcreq005")
            requirement = await _create_requirement(session, project, "tcreq005")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            admin_id, requirement_id = admin.actor_id, requirement.id

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _requirement_test_conditions_path(requirement_id),
                json={"description": "Login rejects an expired password", "priority": "high"},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["requirement_id"] == str(requirement_id)
        assert body["description"] == "Login rejects an expired password"
        assert body["priority"] == "high"
        condition_id = UUID(body["id"])
        test_condition_ids = [condition_id]

        # The TestCondition row itself, read back from the DB (not the body).
        condition_row = await _fetch_test_condition(condition_id)
        assert condition_row is not None
        assert condition_row.requirement_id == requirement_id
        assert condition_row.description == "Login rejects an expired password"
        assert condition_row.priority == TestConditionPriority.high

        # The whole point of the bespoke route (ADR-0028): the link row must
        # exist too. A route that only INSERTed the TestCondition would still
        # have returned an identical 201 body.
        link_ids = await _requirement_test_condition_link_ids(requirement_id, condition_id)
        assert len(link_ids) == 1, (
            "expected exactly one RequirementTestConditionLink row for the new TestCondition"
        )
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
        )


# --- TC-REQ-006: TestCase-via-TestCondition create + transitive traceability -------------------


@pytest.mark.asyncio
async def test_create_test_case_for_test_condition_writes_row_link_and_traces() -> None:  # TC-REQ-006
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcreq006")
            project = await _create_project(session, org, "tcreq006")
            requirement = await _create_requirement(session, project, "tcreq006")
            condition = await _create_test_condition(session, requirement, "tcreq006")
            level = await _create_test_level(session, "tcreq006")
            test_type = await _create_test_type(session, "tcreq006")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            admin_id = admin.actor_id
            requirement_id, condition_id = requirement.id, condition.id
            level_id, type_id = level.id, test_type.id

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _test_condition_test_cases_path(condition_id),
                json={
                    "title": "Expired password is rejected at login",
                    "preconditions": "A user account whose password expired yesterday",
                    "expected_result": "401 with the generic credentials message",
                    "test_level_id": str(level_id),
                    "test_type_id": str(type_id),
                },
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 201, response.text
        body = response.json()
        test_case_id = UUID(body["id"])
        test_case_ids = [test_case_id]

        # DB-level assertions on the TestCase row itself.
        test_case_row = await _fetch_test_case(test_case_id)
        assert test_case_row is not None
        assert test_case_row.test_condition_id == condition_id
        assert test_case_row.status == TestCaseStatus.draft
        assert test_case_row.created_by_actor_id == admin_id
        assert test_case_row.title == "Expired password is rejected at login"

        # The link row, queried directly.
        link_ids = await _test_condition_test_case_link_ids(condition_id, test_case_id)
        assert len(link_ids) == 1, (
            "expected exactly one TestConditionTestCaseLink row for the new TestCase"
        )

        # Transitive traceability as ONE multi-hop join (test-design §24):
        # TestConditionTestCaseLink -> TestCondition -> RequirementTestConditionLink
        # -> Requirement must reach the exact originating Requirement.
        traced = await _requirement_ids_traced_from_test_case(test_case_id)
        assert traced == [requirement_id], (
            "the TestCase -> TestCondition -> Requirement walk must reach exactly the "
            f"originating Requirement {requirement_id}, got {traced}"
        )
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


# --- TC-REQ-007: both authoring paths coexist in one project ----------------------------------


@pytest.mark.asyncio
async def test_direct_and_rigor_path_test_cases_coexist_in_same_project() -> None:  # TC-REQ-007
    """Both authoring paths' TestCases coexist in one Project, each traced only
    by its own link table.

    The direct arm's own `GET /test-cases/{id}` is asserted separately, in
    `test_direct_path_test_case_is_readable_over_http` below — it currently
    fails on a pre-existing resolver gap that belongs to REQ-2's scope, not
    this story's (see that test's docstring). Everything REQ-3 itself owns is
    asserted here, unweakened.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcreq007")
            project = await _create_project(session, org, "tcreq007")
            requirement = await _create_requirement(session, project, "tcreq007")
            condition = await _create_test_condition(session, requirement, "tcreq007")
            level = await _create_test_level(session, "tcreq007")
            test_type = await _create_test_type(session, "tcreq007")
            # REQ-2's direct path — its own route is out of scope for REQ-3
            # and not built, so this arm is seeded through the session.
            direct_case = await _create_direct_path_test_case(
                session, requirement, admin.actor_id, level, test_type, "tcreq007"
            )
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [direct_case.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            admin_id, condition_id = admin.actor_id, condition.id
            direct_case_id = direct_case.id
            level_id, type_id = level.id, test_type.id

        access_token = _access_token_for(admin_id)
        headers = {"Authorization": f"Bearer {access_token}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            create_response = await client.post(
                _test_condition_test_cases_path(condition_id),
                json={
                    "title": "Rigor-path test case",
                    "test_level_id": str(level_id),
                    "test_type_id": str(type_id),
                },
                headers=headers,
            )
            assert create_response.status_code == 201, create_response.text
            rigor_case_id = UUID(create_response.json()["id"])
            test_case_ids = [direct_case_id, rigor_case_id]

            rigor_get = await client.get(_test_case_path(rigor_case_id), headers=headers)

        # The rigor-path TestCase resolves and reports its TestCondition.
        assert rigor_get.status_code == 200, rigor_get.text
        assert rigor_get.json()["test_condition_id"] == str(condition_id)

        # The direct-path TestCase's own `test_condition_id` is NULL — read
        # from the row itself (the HTTP read of this arm is asserted in the
        # dedicated test below, which the resolver gap currently blocks).
        direct_row = await _fetch_test_case(direct_case_id)
        assert direct_row is not None
        assert direct_row.test_condition_id is None

        # Each is reachable only via its OWN link table, never the other's.
        assert await _requirement_test_case_link_count(direct_case_id) == 1
        assert await _test_condition_test_case_link_count(direct_case_id) == 0

        assert await _test_condition_test_case_link_count(rigor_case_id) == 1
        assert await _requirement_test_case_link_count(rigor_case_id) == 0
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


@pytest.mark.xfail(
    strict=True,
    reason=(
        "Known defect, REQ-2 scope, NOT introduced by REQ-3/ADR-0028: "
        "`resolve_test_case_org_id` (app/api/crud_factory.py:232-264) resolves a "
        "`test_condition_id IS NULL` TestCase ONLY via the TestSuiteTestCase "
        "fallback — it never consults `RequirementTestCaseLink`. A direct-path "
        "TestCase that is linked to its Requirement but not yet in any TestSuite "
        "therefore resolves org_id=None and the generic factory's item route "
        "answers 404 (verified: adding the same TestCase to a TestSuite flips it "
        "to 200). Fixing the resolver belongs to REQ-2's own story, which owns "
        "`POST /requirements/{id}/test-cases`; this test is left strict-xfail so "
        "it turns red the moment the gap is closed and the marker must go."
    ),
)
@pytest.mark.asyncio
async def test_direct_path_test_case_is_readable_over_http() -> None:  # TC-REQ-007 (direct arm, HTTP)
    """`GET /test-cases/{id}` for a REQ-2-shaped direct-path TestCase -> 200,
    `test_condition_id` null (TC-REQ-007's "Both `200`" expected result).
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcreq007d")
            project = await _create_project(session, org, "tcreq007d")
            requirement = await _create_requirement(session, project, "tcreq007d")
            level = await _create_test_level(session, "tcreq007d")
            test_type = await _create_test_type(session, "tcreq007d")
            direct_case = await _create_direct_path_test_case(
                session, requirement, admin.actor_id, level, test_type, "tcreq007d"
            )
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_case_ids = [direct_case.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            admin_id, direct_case_id = admin.actor_id, direct_case.id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(_test_case_path(direct_case_id), headers=headers)

        assert response.status_code == 200, response.text
        assert response.json()["test_condition_id"] is None
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


# --- TC-REQ-010: test_manager alone can reach both routes -------------------------------------


@pytest.mark.asyncio
async def test_test_manager_can_author_test_condition_and_test_case() -> None:  # TC-REQ-010
    """The only class that catches ADR-0028's RBAC bundle-extension migration
    silently failing to apply (or the bundle reverting to its pre-REQ-3
    `.read`-only shape): the actor holds ONLY a `test_manager` RoleAssignment
    — no `org_admin`, no `tester`, anywhere. Same shape as TC-PROJ-017.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcreq010")
            project = await _create_project(session, org, "tcreq010")
            requirement = await _create_requirement(session, project, "tcreq010")
            level = await _create_test_level(session, "tcreq010")
            test_type = await _create_test_type(session, "tcreq010")
            # Holds ONLY test_manager, org-wide — no org_admin/tester anywhere.
            manager = await _create_member_with_role(session, "tcreq010-mgr", org, "test_manager")
            await session.commit()
            user_ids = [admin.actor_id, manager.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            manager_id, requirement_id = manager.actor_id, requirement.id
            level_id, type_id = level.id, test_type.id

        # Guard: the actor must genuinely hold no role other than test_manager.
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(Role.name)
                .select_from(RoleAssignment)
                .join(Role, Role.id == RoleAssignment.role_id)
                .where(RoleAssignment.actor_id == manager_id)
            )
            assert [row[0] for row in result.all()] == ["test_manager"]

        access_token = _access_token_for(manager_id)
        headers = {"Authorization": f"Bearer {access_token}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            condition_response = await client.post(
                _requirement_test_conditions_path(requirement_id),
                json={"description": "test_manager-authored condition", "priority": "medium"},
                headers=headers,
            )
            assert condition_response.status_code == 201, condition_response.text
            condition_id = UUID(condition_response.json()["id"])
            test_condition_ids = [condition_id]

            case_response = await client.post(
                _test_condition_test_cases_path(condition_id),
                json={
                    "title": "test_manager-authored test case",
                    "test_level_id": str(level_id),
                    "test_type_id": str(type_id),
                },
                headers=headers,
            )
            assert case_response.status_code == 201, case_response.text
            test_case_ids = [UUID(case_response.json()["id"])]
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


# --- TC-REQ-011: generic POST /test-conditions removed, everything else intact ----------------


@pytest.mark.asyncio
async def test_generic_test_condition_create_removed_other_methods_intact() -> None:  # TC-REQ-011
    """`POST /test-conditions` must be gone, and *only* `POST`.

    Expected status is `405 Method Not Allowed`, not `404`: ADR-0028 narrows
    `_TEST_CONDITION_CONFIG.methods` to `{list, get, update, delete}`, so the
    collection path `/api/v1/test-conditions` is still registered (for `GET`)
    — Starlette matches the path, finds no `POST` handler on it, and answers
    `405`. A `404` here would mean the whole path had been unregistered, i.e.
    the blanket removal this test exists to rule out.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcreq011")
            project = await _create_project(session, org, "tcreq011")
            requirement = await _create_requirement(session, project, "tcreq011")
            condition = await _create_test_condition(
                session, requirement, "tcreq011", priority=TestConditionPriority.low
            )
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            admin_id, requirement_id, condition_id = admin.actor_id, requirement.id, condition.id

        access_token = _access_token_for(admin_id)
        headers = {"Authorization": f"Bearer {access_token}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # Negative case: the pre-ADR-0028 generic create route.
            post_response = await client.post(
                _test_conditions_path(),
                json={
                    "requirement_id": str(requirement_id),
                    "description": "should never be created",
                    "priority": "low",
                },
                headers=headers,
            )
            assert post_response.status_code == 405, post_response.text

            # Positive cases proving the restriction is create-only.
            list_response = await client.get(
                _test_conditions_path(),
                params={"requirement_id": str(requirement_id)},
                headers=headers,
            )
            assert list_response.status_code == 200, list_response.text
            listed_ids = [item["id"] for item in list_response.json()["items"]]
            assert str(condition_id) in listed_ids

            get_response = await client.get(_test_condition_path(condition_id), headers=headers)
            assert get_response.status_code == 200, get_response.text
            assert get_response.json()["id"] == str(condition_id)

            patch_response = await client.patch(
                _test_condition_path(condition_id),
                json={"priority": "high"},
                headers=headers,
            )
            assert patch_response.status_code == 200, patch_response.text
            assert patch_response.json()["priority"] == "high"

            delete_response = await client.delete(
                _test_condition_path(condition_id), headers=headers
            )
            assert delete_response.status_code == 204, delete_response.text

        # And the DELETE really removed it.
        assert await _fetch_test_condition(condition_id) is None

        # Nothing was created by the rejected POST.
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(TestCondition.id).where(TestCondition.requirement_id == requirement_id)
            )
            assert result.all() == []
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
        )


# --- 404-vs-403 boundary for both new routes (NFR-1 / ADR-0007, test-design §24) ---------------


@pytest.mark.asyncio
async def test_create_test_condition_cross_org_returns_404_not_403() -> None:
    """No `OrgMembership` in the Requirement's org -> 404, never 403: existence
    must not be confirmable across an org boundary (NFR-1/ADR-0007).
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_a, org_a = await _create_org_admin(session, "tcbnd404a")
            admin_b, org_b = await _create_org_admin(session, "tcbnd404b")
            project = await _create_project(session, org_a, "tcbnd404")
            requirement = await _create_requirement(session, project, "tcbnd404")
            await session.commit()
            user_ids = [admin_a.actor_id, admin_b.actor_id]
            org_ids = [org_a.id, org_b.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            outsider_id, requirement_id = admin_b.actor_id, requirement.id

        headers = {"Authorization": f"Bearer {_access_token_for(outsider_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _requirement_test_conditions_path(requirement_id),
                json={"description": "cross-org attempt", "priority": "low"},
                headers=headers,
            )

        assert response.status_code == 404, response.text
        assert response.json()["code"] == "not_found"

        # And nothing was written despite org_b's actor being org_admin there.
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(TestCondition.id).where(TestCondition.requirement_id == requirement_id)
            )
            test_condition_ids = [row[0] for row in result.all()]
        assert test_condition_ids == []
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
        )


@pytest.mark.asyncio
async def test_create_test_case_for_test_condition_cross_org_returns_404_not_403() -> None:
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_a, org_a = await _create_org_admin(session, "tcbnd404c")
            admin_b, org_b = await _create_org_admin(session, "tcbnd404d")
            project = await _create_project(session, org_a, "tcbnd404c")
            requirement = await _create_requirement(session, project, "tcbnd404c")
            condition = await _create_test_condition(session, requirement, "tcbnd404c")
            level = await _create_test_level(session, "tcbnd404c")
            test_type = await _create_test_type(session, "tcbnd404c")
            await session.commit()
            user_ids = [admin_a.actor_id, admin_b.actor_id]
            org_ids = [org_a.id, org_b.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            outsider_id, condition_id = admin_b.actor_id, condition.id
            level_id, type_id = level.id, test_type.id

        headers = {"Authorization": f"Bearer {_access_token_for(outsider_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _test_condition_test_cases_path(condition_id),
                json={
                    "title": "cross-org attempt",
                    "test_level_id": str(level_id),
                    "test_type_id": str(type_id),
                },
                headers=headers,
            )

        assert response.status_code == 404, response.text
        assert response.json()["code"] == "not_found"

        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(TestCase.id).where(TestCase.test_condition_id == condition_id)
            )
            test_case_ids = [row[0] for row in result.all()]
        assert test_case_ids == []
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


@pytest.mark.asyncio
async def test_create_test_condition_without_permission_returns_403() -> None:
    """Membership present but `test_condition.create` missing -> 403 (the other
    half of the boundary: same-org callers DO get told it's a permission
    problem, only cross-org callers get the existence-hiding 404).
    """
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcbnd403a")
            project = await _create_project(session, org, "tcbnd403a")
            requirement = await _create_requirement(session, project, "tcbnd403a")
            member, custom_role = await _create_custom_role_member(
                session, "tcbnd403a", org, ["test_condition.read"]
            )
            await session.commit()
            user_ids = [admin.actor_id, member.actor_id]
            org_ids = [org.id]
            role_ids = [custom_role.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            member_id, requirement_id = member.actor_id, requirement.id

        headers = {"Authorization": f"Bearer {_access_token_for(member_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _requirement_test_conditions_path(requirement_id),
                json={"description": "no permission", "priority": "low"},
                headers=headers,
            )

        assert response.status_code == 403, response.text
        assert response.json()["code"] == "permission_denied"
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            role_ids=role_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
        )


@pytest.mark.asyncio
async def test_create_test_case_for_test_condition_without_permission_returns_403() -> None:
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcbnd403b")
            project = await _create_project(session, org, "tcbnd403b")
            requirement = await _create_requirement(session, project, "tcbnd403b")
            condition = await _create_test_condition(session, requirement, "tcbnd403b")
            level = await _create_test_level(session, "tcbnd403b")
            test_type = await _create_test_type(session, "tcbnd403b")
            member, custom_role = await _create_custom_role_member(
                session, "tcbnd403b", org, ["test_case.read"]
            )
            await session.commit()
            user_ids = [admin.actor_id, member.actor_id]
            org_ids = [org.id]
            role_ids = [custom_role.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            member_id, condition_id = member.actor_id, condition.id
            level_id, type_id = level.id, test_type.id

        headers = {"Authorization": f"Bearer {_access_token_for(member_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _test_condition_test_cases_path(condition_id),
                json={
                    "title": "no permission",
                    "test_level_id": str(level_id),
                    "test_type_id": str(type_id),
                },
                headers=headers,
            )

        assert response.status_code == 403, response.text
        assert response.json()["code"] == "permission_denied"
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            role_ids=role_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


@pytest.mark.asyncio
async def test_create_under_nonexistent_parent_returns_404_for_both_routes() -> None:
    """A parent id that doesn't exist at all -> 404, indistinguishable from the
    cross-org case above (that indistinguishability is the point).
    """
    user_ids: list = []
    org_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcbnd404e")
            level = await _create_test_level(session, "tcbnd404e")
            test_type = await _create_test_type(session, "tcbnd404e")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            admin_id = admin.actor_id
            level_id, type_id = level.id, test_type.id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        missing_requirement_id = uuid4()
        missing_condition_id = uuid4()

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            condition_response = await client.post(
                _requirement_test_conditions_path(missing_requirement_id),
                json={"description": "no such requirement", "priority": "low"},
                headers=headers,
            )
            assert condition_response.status_code == 404, condition_response.text
            assert condition_response.json()["code"] == "not_found"

            case_response = await client.post(
                _test_condition_test_cases_path(missing_condition_id),
                json={
                    "title": "no such test condition",
                    "test_level_id": str(level_id),
                    "test_type_id": str(type_id),
                },
                headers=headers,
            )
            assert case_response.status_code == 404, case_response.text
            assert case_response.json()["code"] == "not_found"
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )
