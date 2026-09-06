"""Integration tests for REQ-4's `TestSuite` membership routes (ADR-0030):
`POST`/`DELETE /test-suites/{id}/test-cases/{case_id}` and
`GET /test-suites/{id}/test-cases`.

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), matching `test_req3_test_condition_authoring.py`'s
established style. The package-level `tests/integration/conftest.py` fixture
(`_require_live_server`, autouse=True, session-scoped) applies automatically to
this module too.

Covers TC-REQ-008, 009, 012, 013, 014 from
`docs/test-cases/2026-09-03-test-cases.md`, plus the 404-vs-403 org-boundary
classes all three routes inherit (`docs/test-design/2026-09-03-test-design.md`
§26, reusing §4/§19's Class B/C). TC-REQ-010/011 belong to REQ-3 and are
covered in that story's own file, not here.

Three things §26 is explicit about, each of which changes what the test must
actually *do* rather than just what it asserts:

- **TC-REQ-008** must query `TestSuiteTestCase` **directly** for both rows. Two
  `201` responses are called out as insufficient evidence: a route that
  overwrote a single "current suite" pointer instead of inserting a genuine
  second join row would still return two plausible-looking `201`s.
- **TC-REQ-009** must be a *sequenced* GET -> DELETE -> GET inside one test, not
  two independent assertions that could each pass against a stale read. The
  zero-membership boundary (fresh suite -> `200` + empty list, never `404`) is
  its own separate class.
- **TC-REQ-012** must exercise **more than one** of ADR-0029's three resolver
  branches. A project-match check miscoded against only one branch's result
  would pass a single-branch fixture while leaking membership via the others,
  so both the TestCondition-mediated and the direct-link branches are tested.

Every membership assertion queries the junction table directly via
`AsyncSessionLocal` rather than inferring state from a response body, the same
posture REQ-3's file established for its link tables.

Each test seeds its own `User`/`Organization`/`OrgMembership`/`RoleAssignment`/
`Project`/`Requirement`/`TestSuite`/`TestCase` (and link rows) directly via
`AsyncSessionLocal` and cleans up in a `finally` block. Emails/org slugs/names
are unique per test.
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
    TestSuite,
    TestSuiteTestCase,
)
from app.models.auth import AuthIdentity, AuthProvider
from app.models.project import Project
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus
from app.models.trace import RequirementTestCaseLink, RequirementTestConditionLink

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


def _suite_membership_path(test_suite_id, test_case_id) -> str:
    """`POST`/`DELETE` target — the add/remove pair."""
    return f"{API_PREFIX}/test-suites/{test_suite_id}/test-cases/{test_case_id}"


def _suite_test_cases_path(test_suite_id) -> str:
    """`GET` target — the live membership list."""
    return f"{API_PREFIX}/test-suites/{test_suite_id}/test-cases"


# --- seeding / cleanup helpers ---------------------------------------------------------------
# Mirrors test_req3_test_condition_authoring.py's helpers of the same
# names/shapes, extended with the TestSuite + TestSuiteTestCase rows this story
# needs.


def _unique_email(tag: str) -> str:
    return f"req4-{tag}-{uuid4().hex[:8]}@example.com"


def _unique_slug(tag: str) -> str:
    return f"req4-{tag}-{uuid4().hex[:8]}"


def _unique_name(tag: str) -> str:
    return f"REQ-4 {tag} {uuid4().hex[:8]}"


async def _create_user(session, email: str, password: str = DEFAULT_PASSWORD) -> User:
    user = User(name="REQ-4 Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()  # populate user.actor_id (joined-table inheritance PK/FK)
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"REQ-4 Test Org {slug_prefix}", slug=_unique_slug(slug_prefix))
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
    """Seed a User with an active membership and a bespoke org-scoped Role
    granting exactly `permission_codes`.

    Used for the "membership present, required permission missing -> 403" half
    of the boundary: the actor deliberately holds a real (unrelated) permission,
    so a 403 proves the specific `test_suite.update`/`.read` gate fired rather
    than a blanket has-no-roles-at-all rejection.
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
        description=f"REQ-4 requirement description {tag}",
    )
    session.add(requirement)
    await session.flush()
    return requirement


async def _create_test_suite(session, project: Project, tag: str, *, purpose: str = "regression") -> TestSuite:
    suite = TestSuite(project_id=project.id, name=_unique_name(f"Suite {tag}"), purpose=purpose)
    session.add(suite)
    await session.flush()
    return suite


async def _create_test_condition(session, requirement: Requirement, tag: str) -> TestCondition:
    condition = TestCondition(
        requirement_id=requirement.id,
        description=f"REQ-4 seeded condition {tag} {uuid4().hex[:6]}",
        priority=TestConditionPriority.medium,
    )
    session.add(condition)
    await session.flush()
    session.add(
        RequirementTestConditionLink(requirement_id=requirement.id, test_condition_id=condition.id)
    )
    await session.flush()
    return condition


async def _create_test_level(session, tag: str) -> TestLevel:
    level = TestLevel(name=f"REQ-4 Level {tag} {uuid4().hex[:8]}")
    session.add(level)
    await session.flush()
    return level


async def _create_test_type(session, tag: str) -> TestType:
    test_type = TestType(name=f"REQ-4 Type {tag} {uuid4().hex[:8]}")
    session.add(test_type)
    await session.flush()
    return test_type


async def _create_condition_path_test_case(
    session,
    condition: TestCondition,
    actor_id,
    test_level: TestLevel,
    test_type: TestType,
    tag: str,
) -> TestCase:
    """Seed a REQ-3-shaped ("rigor path") TestCase: `test_condition_id` set.

    This is ADR-0029 resolver **branch 1** — `test_condition_id` ->
    `TestCondition.requirement_id` -> `Requirement.project_id`.
    """
    test_case = TestCase(
        test_condition_id=condition.id,
        test_level_id=test_level.id,
        test_type_id=test_type.id,
        created_by_actor_id=actor_id,
        title=_unique_name(f"Condition TC {tag}"),
        status=TestCaseStatus.draft,
    )
    session.add(test_case)
    await session.flush()
    return test_case


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

    This is ADR-0029 resolver **branch 2** — the `RequirementTestCaseLink`
    fallback.
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


async def _suite_membership_rows(test_suite_id, test_case_id) -> list:
    """Every `TestSuiteTestCase` row for one (suite, case) pair.

    TC-REQ-008 / test-design §26: membership must be proven against the
    junction table itself, since a route that overwrote a single pointer rather
    than inserting a second join row would still return two plausible `201`s.
    """
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(TestSuiteTestCase.id).where(
                TestSuiteTestCase.test_suite_id == test_suite_id,
                TestSuiteTestCase.test_case_id == test_case_id,
            )
        )
        return [row[0] for row in result.all()]


async def _test_case_ids_in_suite(test_suite_id) -> set:
    """All `test_case_id`s joined to one suite, read straight from the DB."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(TestSuiteTestCase.test_case_id).where(
                TestSuiteTestCase.test_suite_id == test_suite_id
            )
        )
        return {row[0] for row in result.all()}


async def _cleanup(
    *,
    emails: list[str] | None = None,
    user_ids: list | None = None,
    org_ids: list | None = None,
    role_ids: list | None = None,
    project_ids: list | None = None,
    requirement_ids: list | None = None,
    test_suite_ids: list | None = None,
    test_condition_ids: list | None = None,
    test_case_ids: list | None = None,
    test_level_ids: list | None = None,
    test_type_ids: list | None = None,
) -> None:
    """Delete everything a test may have created, in FK-safe order.

    Same shape as `test_req3_test_condition_authoring.py`'s `_cleanup`, with
    `TestSuiteTestCase`/`TestSuite` added ahead of the `TestCase`/`Project`
    deletes (`TestSuite.project_id` is `RESTRICT`, so the suite must go before
    its project).
    """
    emails = emails or []
    user_ids = list(user_ids or [])
    org_ids = org_ids or []
    role_ids = role_ids or []
    project_ids = project_ids or []
    requirement_ids = requirement_ids or []
    test_suite_ids = test_suite_ids or []
    test_condition_ids = test_condition_ids or []
    test_case_ids = test_case_ids or []
    test_level_ids = test_level_ids or []
    test_type_ids = test_type_ids or []

    async with AsyncSessionLocal() as session:
        if emails:
            result = await session.execute(select(User.actor_id).where(User.email.in_(emails)))
            user_ids.extend(row[0] for row in result.all() if row[0] not in user_ids)

        # Junction rows first — the entity FKs above them are RESTRICT.
        if test_suite_ids or test_case_ids:
            conditions = []
            if test_suite_ids:
                conditions.append(TestSuiteTestCase.test_suite_id.in_(test_suite_ids))
            if test_case_ids:
                conditions.append(TestSuiteTestCase.test_case_id.in_(test_case_ids))
            await session.execute(delete(TestSuiteTestCase).where(or_(*conditions)))

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

        if test_suite_ids:
            await session.execute(delete(TestSuite).where(TestSuite.id.in_(test_suite_ids)))
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


# --- TC-REQ-008: a TestCase can belong to more than one Suite ---------------------------------


@pytest.mark.asyncio
async def test_test_case_can_belong_to_two_suites_independently() -> None:  # TC-REQ-008
    """TC-REQ-008 literally: "TestSuite A + TestSuite B (same project) + TestCase
    exist" -> "POST `/test-suites/{A.id}/test-cases/{case.id}`, then POST
    `/test-suites/{B.id}/test-cases/{case.id}`" -> "Both `201`; both
    `TestSuiteTestCase` rows exist afterward (queried directly), each suite's
    membership independent of the other".

    The "queried directly" clause is why the two `201`s below are not the
    assertion that matters — `_suite_membership_rows` reads the junction table
    itself. §26: a route that overwrote a single "current suite" pointer would
    still return two plausible-looking `201`s while failing this class.

    Independence is then proven by removing the case from A only and confirming
    B's row survives.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_suite_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcreq008")
            project = await _create_project(session, org, "tcreq008")
            requirement = await _create_requirement(session, project, "tcreq008")
            condition = await _create_test_condition(session, requirement, "tcreq008")
            level = await _create_test_level(session, "tcreq008")
            test_type = await _create_test_type(session, "tcreq008")
            case = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tcreq008"
            )
            # Two suites, SAME project (TC-REQ-008's stated precondition).
            suite_a = await _create_test_suite(session, project, "tcreq008-A", purpose="regression")
            suite_b = await _create_test_suite(session, project, "tcreq008-B", purpose="smoke")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_suite_ids = [suite_a.id, suite_b.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            admin_id, case_id = admin.actor_id, case.id
            suite_a_id, suite_b_id = suite_a.id, suite_b.id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response_a = await client.post(
                _suite_membership_path(suite_a_id, case_id), headers=headers
            )
            assert response_a.status_code == 201, response_a.text

            response_b = await client.post(
                _suite_membership_path(suite_b_id, case_id), headers=headers
            )
            assert response_b.status_code == 201, response_b.text

        # The assertion TC-REQ-008 actually names: BOTH rows exist, queried
        # directly against the junction table (not inferred from the 201s).
        rows_a = await _suite_membership_rows(suite_a_id, case_id)
        rows_b = await _suite_membership_rows(suite_b_id, case_id)
        assert len(rows_a) == 1, f"expected exactly one TestSuiteTestCase row for suite A, got {rows_a}"
        assert len(rows_b) == 1, f"expected exactly one TestSuiteTestCase row for suite B, got {rows_b}"

        # "each suite's membership independent of the other": removing from A
        # must leave B's row untouched.
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            remove = await client.delete(
                _suite_membership_path(suite_a_id, case_id), headers=headers
            )
            assert remove.status_code == 204, remove.text

        assert await _suite_membership_rows(suite_a_id, case_id) == []
        assert len(await _suite_membership_rows(suite_b_id, case_id)) == 1, (
            "removing the case from suite A must not affect its membership in suite B"
        )
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_suite_ids=test_suite_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


# --- TC-REQ-009: membership stays live pre-execution ------------------------------------------


@pytest.mark.asyncio
async def test_suite_membership_list_is_live_across_a_removal() -> None:  # TC-REQ-009
    """TC-REQ-009 literally: "TestSuite has 2 TestCases" -> "GET
    `/test-suites/{id}/test-cases` (returns both), DELETE one, GET again (same
    test, sequenced)" -> "First GET: both cases. DELETE: `204`. Second GET: only
    the remaining case — reflects current membership, not a stale/cached
    snapshot".

    Deliberately one test with three sequenced HTTP calls on one client, per
    §26 — two independent tests could each pass against a stale read.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_suite_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcreq009")
            project = await _create_project(session, org, "tcreq009")
            requirement = await _create_requirement(session, project, "tcreq009")
            condition = await _create_test_condition(session, requirement, "tcreq009")
            level = await _create_test_level(session, "tcreq009")
            test_type = await _create_test_type(session, "tcreq009")
            case_one = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tcreq009-1"
            )
            case_two = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tcreq009-2"
            )
            suite = await _create_test_suite(session, project, "tcreq009")
            # Precondition: "TestSuite has 2 TestCases" — seeded, so the test
            # itself exercises GET/DELETE/GET rather than the add route.
            session.add(TestSuiteTestCase(test_suite_id=suite.id, test_case_id=case_one.id))
            session.add(TestSuiteTestCase(test_suite_id=suite.id, test_case_id=case_two.id))
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case_one.id, case_two.id]
            test_suite_ids = [suite.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            admin_id, suite_id = admin.actor_id, suite.id
            case_one_id, case_two_id = case_one.id, case_two.id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # First GET: both cases.
            first = await client.get(_suite_test_cases_path(suite_id), headers=headers)
            assert first.status_code == 200, first.text
            first_body = first.json()
            assert first_body["total"] == 2, first_body
            assert {item["id"] for item in first_body["items"]} == {
                str(case_one_id),
                str(case_two_id),
            }

            # DELETE one -> 204.
            removed = await client.delete(
                _suite_membership_path(suite_id, case_one_id), headers=headers
            )
            assert removed.status_code == 204, removed.text

            # Second GET, same test, same client: only the remaining case.
            second = await client.get(_suite_test_cases_path(suite_id), headers=headers)
            assert second.status_code == 200, second.text
            second_body = second.json()
            assert second_body["total"] == 1, second_body
            assert [item["id"] for item in second_body["items"]] == [str(case_two_id)], (
                "the second GET must reflect current membership, not a stale/cached snapshot"
            )

        # And the junction table agrees with what the API just reported.
        assert await _test_case_ids_in_suite(suite_id) == {case_two_id}
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_suite_ids=test_suite_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


@pytest.mark.asyncio
async def test_empty_suite_membership_returns_200_empty_list_not_404() -> None:
    """§26's zero-membership boundary: a freshly created `TestSuite` with no
    adds yet -> `200` with an empty list, **not** `404`.

    The suite itself exists; having no members yet is a valid, common state,
    not an error — and confusing the two would make the UI's "No test cases in
    this suite yet" empty state unreachable.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    test_suite_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcreq009e")
            project = await _create_project(session, org, "tcreq009e")
            suite = await _create_test_suite(session, project, "tcreq009e", purpose="acceptance")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            test_suite_ids = [suite.id]
            admin_id, suite_id = admin.actor_id, suite.id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(_suite_test_cases_path(suite_id), headers=headers)

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["items"] == []
        assert body["total"] == 0
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            test_suite_ids=test_suite_ids,
        )


# --- TC-REQ-012: cross-project add rejected, across TWO resolver branches ----------------------


@pytest.mark.asyncio
async def test_cross_project_add_rejected_via_both_resolver_branches() -> None:  # TC-REQ-012
    """TC-REQ-012 literally: "TestSuite in Project A; TestCase resolves to
    Project B (same org) — tested via at least 2 of the 3 ADR-0029 resolver
    branches (direct-link and TestCondition-mediated), not just one" -> "POST
    `/test-suites/{A-suite.id}/test-cases/{case.id}` for each branch's TestCase"
    -> "`422 validation_error` in every branch tested, never `404` (caller
    already proved org membership)".

    Both projects live in the SAME org and the caller is `org_admin` of it, so
    the org gate is genuinely passed in both arms — a `404` here would mean the
    tenant check fired instead of the project-match rule, which is exactly the
    confusion this class exists to catch.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_suite_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcreq012")
            project_a = await _create_project(session, org, "tcreq012-A")
            project_b = await _create_project(session, org, "tcreq012-B")
            requirement_b = await _create_requirement(session, project_b, "tcreq012-B")
            condition_b = await _create_test_condition(session, requirement_b, "tcreq012-B")
            level = await _create_test_level(session, "tcreq012")
            test_type = await _create_test_type(session, "tcreq012")

            # Branch 1: TestCondition-mediated (test_condition_id set).
            condition_case = await _create_condition_path_test_case(
                session, condition_b, admin.actor_id, level, test_type, "tcreq012-cond"
            )
            # Branch 2: direct-link (test_condition_id NULL + RequirementTestCaseLink).
            direct_case = await _create_direct_path_test_case(
                session, requirement_b, admin.actor_id, level, test_type, "tcreq012-direct"
            )

            # The target suite lives in project A.
            suite_a = await _create_test_suite(session, project_a, "tcreq012-A")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project_a.id, project_b.id]
            requirement_ids = [requirement_b.id]
            test_condition_ids = [condition_b.id]
            test_case_ids = [condition_case.id, direct_case.id]
            test_suite_ids = [suite_a.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            admin_id, suite_a_id = admin.actor_id, suite_a.id
            condition_case_id, direct_case_id = condition_case.id, direct_case.id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # Branch 1 — TestCondition-mediated.
            condition_arm = await client.post(
                _suite_membership_path(suite_a_id, condition_case_id), headers=headers
            )
            assert condition_arm.status_code == 422, (
                f"TestCondition-mediated branch must be 422, never 404: {condition_arm.text}"
            )
            assert condition_arm.json()["code"] == "validation_error"

            # Branch 2 — direct-link.
            direct_arm = await client.post(
                _suite_membership_path(suite_a_id, direct_case_id), headers=headers
            )
            assert direct_arm.status_code == 422, (
                f"direct-link branch must be 422, never 404: {direct_arm.text}"
            )
            assert direct_arm.json()["code"] == "validation_error"

        # Neither rejected POST wrote a junction row.
        assert await _test_case_ids_in_suite(suite_a_id) == set()
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_suite_ids=test_suite_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


# --- TC-REQ-013: duplicate add is a conflict, not a validation error ---------------------------


@pytest.mark.asyncio
async def test_duplicate_add_returns_409_not_422() -> None:  # TC-REQ-013
    """TC-REQ-013 literally: "TestCase already a member of TestSuite" -> "POST
    the same `/test-suites/{id}/test-cases/{case_id}` pair again" -> "`409
    already_in_suite`, distinct from `422`; the first (non-duplicate) POST in
    the same test asserted `201` immediately prior".

    Written as the positive-then-negative pair §26 requires, in one test: the
    `201` is asserted immediately before the duplicate `409`, so a route that
    returned `409` for everything could not pass. The explicit
    `!= 422` assertion is the point of the class — it catches an implementation
    that reused REQ-3's generic `IntegrityError` -> `422` handler by copy-paste
    instead of adding a dedicated `409` branch.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_suite_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcreq013")
            project = await _create_project(session, org, "tcreq013")
            requirement = await _create_requirement(session, project, "tcreq013")
            condition = await _create_test_condition(session, requirement, "tcreq013")
            level = await _create_test_level(session, "tcreq013")
            test_type = await _create_test_type(session, "tcreq013")
            case = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tcreq013"
            )
            suite = await _create_test_suite(session, project, "tcreq013")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_suite_ids = [suite.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            admin_id, suite_id, case_id = admin.actor_id, suite.id, case.id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # The "first (non-duplicate) POST ... asserted 201 immediately prior".
            first = await client.post(_suite_membership_path(suite_id, case_id), headers=headers)
            assert first.status_code == 201, first.text

            # Same pair again -> 409, explicitly NOT 422.
            duplicate = await client.post(
                _suite_membership_path(suite_id, case_id), headers=headers
            )
            assert duplicate.status_code == 409, duplicate.text
            assert duplicate.status_code != 422
            assert duplicate.json()["code"] == "already_in_suite"

        # The rejected duplicate left exactly one row, not two.
        assert len(await _suite_membership_rows(suite_id, case_id)) == 1
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_suite_ids=test_suite_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


# --- TC-REQ-014: removing a non-member is 404, not an idempotent 204 ---------------------------


@pytest.mark.asyncio
async def test_remove_non_member_returns_404_not_204() -> None:  # TC-REQ-014
    """TC-REQ-014 literally: "TestCase was never added to TestSuite (or was
    already removed)" -> "DELETE `/test-suites/{id}/test-cases/{case_id}`" ->
    "`404` — deliberately asymmetric with `POST`'s `409`-on-already-true
    (ADR-0030)".

    Both halves of the TC's stated precondition are exercised: a case that was
    *never* added, and a case that *was* added and then removed (the second
    DELETE of the same pair).
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_suite_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcreq014")
            project = await _create_project(session, org, "tcreq014")
            requirement = await _create_requirement(session, project, "tcreq014")
            condition = await _create_test_condition(session, requirement, "tcreq014")
            level = await _create_test_level(session, "tcreq014")
            test_type = await _create_test_type(session, "tcreq014")
            never_added = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tcreq014-never"
            )
            added_then_removed = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tcreq014-removed"
            )
            suite = await _create_test_suite(session, project, "tcreq014")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [never_added.id, added_then_removed.id]
            test_suite_ids = [suite.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            admin_id, suite_id = admin.actor_id, suite.id
            never_added_id, removed_id = never_added.id, added_then_removed.id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # Half 1: "was never added to TestSuite".
            never = await client.delete(
                _suite_membership_path(suite_id, never_added_id), headers=headers
            )
            assert never.status_code == 404, never.text
            assert never.json()["code"] == "not_found"

            # Half 2: "or was already removed".
            add = await client.post(_suite_membership_path(suite_id, removed_id), headers=headers)
            assert add.status_code == 201, add.text
            first_remove = await client.delete(
                _suite_membership_path(suite_id, removed_id), headers=headers
            )
            assert first_remove.status_code == 204, first_remove.text
            second_remove = await client.delete(
                _suite_membership_path(suite_id, removed_id), headers=headers
            )
            assert second_remove.status_code == 404, (
                f"a repeated DELETE must be 404, not an idempotent 204: {second_remove.text}"
            )
            assert second_remove.json()["code"] == "not_found"
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_suite_ids=test_suite_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


# --- RBAC: tester holds test_suite.read only; test_manager/org_admin hold both -----------------


@pytest.mark.asyncio
async def test_tester_can_read_membership_but_not_modify_it() -> None:
    """ADR-0030's "no RBAC catalog change" claim, asserted rather than trusted.

    `tester`'s seeded bundle holds exactly `test_suite.read` (no `.update`), so
    the same actor must get `200` on the list route and `403` on both write
    routes. This is the class that would catch the `GET` being gated on
    `.update` by copy-paste from its two siblings.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_suite_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcrbac-tester")
            project = await _create_project(session, org, "tcrbac-tester")
            requirement = await _create_requirement(session, project, "tcrbac-tester")
            condition = await _create_test_condition(session, requirement, "tcrbac-tester")
            level = await _create_test_level(session, "tcrbac-tester")
            test_type = await _create_test_type(session, "tcrbac-tester")
            member_case = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tcrbac-tester-in"
            )
            outside_case = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tcrbac-tester-out"
            )
            suite = await _create_test_suite(session, project, "tcrbac-tester")
            session.add(TestSuiteTestCase(test_suite_id=suite.id, test_case_id=member_case.id))
            tester = await _create_member_with_role(session, "tcrbac-tester-t", org, "tester")
            await session.commit()
            user_ids = [admin.actor_id, tester.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [member_case.id, outside_case.id]
            test_suite_ids = [suite.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            tester_id, suite_id = tester.actor_id, suite.id
            member_case_id, outside_case_id = member_case.id, outside_case.id

        # Guard: the actor genuinely holds no role other than tester.
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(Role.name)
                .select_from(RoleAssignment)
                .join(Role, Role.id == RoleAssignment.role_id)
                .where(RoleAssignment.actor_id == tester_id)
            )
            assert [row[0] for row in result.all()] == ["tester"]

        headers = {"Authorization": f"Bearer {_access_token_for(tester_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # test_suite.read -> allowed.
            read = await client.get(_suite_test_cases_path(suite_id), headers=headers)
            assert read.status_code == 200, read.text
            assert [item["id"] for item in read.json()["items"]] == [str(member_case_id)]

            # test_suite.update -> denied, on both write routes.
            add = await client.post(
                _suite_membership_path(suite_id, outside_case_id), headers=headers
            )
            assert add.status_code == 403, add.text
            assert add.json()["code"] == "permission_denied"

            remove = await client.delete(
                _suite_membership_path(suite_id, member_case_id), headers=headers
            )
            assert remove.status_code == 403, remove.text
            assert remove.json()["code"] == "permission_denied"

        # The denied write really wrote nothing / removed nothing.
        assert await _test_case_ids_in_suite(suite_id) == {member_case_id}
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_suite_ids=test_suite_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


@pytest.mark.asyncio
async def test_test_manager_can_add_and_remove_suite_membership() -> None:
    """The other half of ADR-0030's RBAC claim: `test_manager` (Priya's own
    persona, the story's narrator) reaches all three routes with no bundle
    extension and no new migration — unlike REQ-3, which needed one.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_suite_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcrbac-mgr")
            project = await _create_project(session, org, "tcrbac-mgr")
            requirement = await _create_requirement(session, project, "tcrbac-mgr")
            condition = await _create_test_condition(session, requirement, "tcrbac-mgr")
            level = await _create_test_level(session, "tcrbac-mgr")
            test_type = await _create_test_type(session, "tcrbac-mgr")
            case = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tcrbac-mgr"
            )
            suite = await _create_test_suite(session, project, "tcrbac-mgr")
            manager = await _create_member_with_role(session, "tcrbac-mgr-m", org, "test_manager")
            await session.commit()
            user_ids = [admin.actor_id, manager.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_suite_ids = [suite.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            manager_id, suite_id, case_id = manager.actor_id, suite.id, case.id

        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(Role.name)
                .select_from(RoleAssignment)
                .join(Role, Role.id == RoleAssignment.role_id)
                .where(RoleAssignment.actor_id == manager_id)
            )
            assert [row[0] for row in result.all()] == ["test_manager"]

        headers = {"Authorization": f"Bearer {_access_token_for(manager_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            add = await client.post(_suite_membership_path(suite_id, case_id), headers=headers)
            assert add.status_code == 201, add.text

            read = await client.get(_suite_test_cases_path(suite_id), headers=headers)
            assert read.status_code == 200, read.text
            assert [item["id"] for item in read.json()["items"]] == [str(case_id)]

            remove = await client.delete(
                _suite_membership_path(suite_id, case_id), headers=headers
            )
            assert remove.status_code == 204, remove.text

        assert await _test_case_ids_in_suite(suite_id) == set()
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_suite_ids=test_suite_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


# --- 404-vs-403 boundary for all three routes (NFR-1 / ADR-0007, test-design §26) --------------


@pytest.mark.asyncio
async def test_cross_org_suite_returns_404_on_all_three_routes() -> None:
    """A `TestSuite` in another org -> `404` on `POST`/`DELETE`/`GET`, never
    `403`: existence must not be confirmable across an org boundary
    (NFR-1/ADR-0007). The outsider is `org_admin` of their *own* org, so a
    `403` would prove the tenant walk was skipped in favour of a bare
    permission check.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_suite_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_a, org_a = await _create_org_admin(session, "tcbnd404a")
            admin_b, org_b = await _create_org_admin(session, "tcbnd404b")
            project = await _create_project(session, org_a, "tcbnd404")
            requirement = await _create_requirement(session, project, "tcbnd404")
            condition = await _create_test_condition(session, requirement, "tcbnd404")
            level = await _create_test_level(session, "tcbnd404")
            test_type = await _create_test_type(session, "tcbnd404")
            case = await _create_condition_path_test_case(
                session, condition, admin_a.actor_id, level, test_type, "tcbnd404"
            )
            suite = await _create_test_suite(session, project, "tcbnd404")
            session.add(TestSuiteTestCase(test_suite_id=suite.id, test_case_id=case.id))
            await session.commit()
            user_ids = [admin_a.actor_id, admin_b.actor_id]
            org_ids = [org_a.id, org_b.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_suite_ids = [suite.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            outsider_id, suite_id, case_id = admin_b.actor_id, suite.id, case.id

        headers = {"Authorization": f"Bearer {_access_token_for(outsider_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            listed = await client.get(_suite_test_cases_path(suite_id), headers=headers)
            assert listed.status_code == 404, listed.text
            assert listed.json()["code"] == "not_found"

            added = await client.post(_suite_membership_path(suite_id, case_id), headers=headers)
            assert added.status_code == 404, added.text
            assert added.json()["code"] == "not_found"

            removed = await client.delete(
                _suite_membership_path(suite_id, case_id), headers=headers
            )
            assert removed.status_code == 404, removed.text
            assert removed.json()["code"] == "not_found"

        # The cross-org DELETE removed nothing.
        assert await _test_case_ids_in_suite(suite_id) == {case_id}
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_suite_ids=test_suite_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


@pytest.mark.asyncio
async def test_cross_org_test_case_returns_404_not_422() -> None:
    """A `TestSuite` the caller CAN see, plus a `TestCase` from another org ->
    `404`, not `422`.

    The distinction this class defends: a cross-*project* case (same org) is
    `422`, but a cross-*org* case must be indistinguishable from a nonexistent
    one. Getting `422` here would confirm the foreign case exists (NFR-1 leak).
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_suite_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_a, org_a = await _create_org_admin(session, "tcbndxorg-a")
            admin_b, org_b = await _create_org_admin(session, "tcbndxorg-b")
            # Caller's own org/project/suite.
            project_a = await _create_project(session, org_a, "tcbndxorg-a")
            suite_a = await _create_test_suite(session, project_a, "tcbndxorg-a")
            # A foreign org's TestCase.
            project_b = await _create_project(session, org_b, "tcbndxorg-b")
            requirement_b = await _create_requirement(session, project_b, "tcbndxorg-b")
            condition_b = await _create_test_condition(session, requirement_b, "tcbndxorg-b")
            level = await _create_test_level(session, "tcbndxorg")
            test_type = await _create_test_type(session, "tcbndxorg")
            foreign_case = await _create_condition_path_test_case(
                session, condition_b, admin_b.actor_id, level, test_type, "tcbndxorg"
            )
            await session.commit()
            user_ids = [admin_a.actor_id, admin_b.actor_id]
            org_ids = [org_a.id, org_b.id]
            project_ids = [project_a.id, project_b.id]
            requirement_ids = [requirement_b.id]
            test_condition_ids = [condition_b.id]
            test_case_ids = [foreign_case.id]
            test_suite_ids = [suite_a.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            caller_id, suite_a_id = admin_a.actor_id, suite_a.id
            foreign_case_id = foreign_case.id

        headers = {"Authorization": f"Bearer {_access_token_for(caller_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _suite_membership_path(suite_a_id, foreign_case_id), headers=headers
            )

        assert response.status_code == 404, (
            f"a cross-ORG case must be 404 (existence-hiding), not the cross-PROJECT 422: "
            f"{response.text}"
        )
        assert response.json()["code"] == "not_found"
        assert await _test_case_ids_in_suite(suite_a_id) == set()
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_suite_ids=test_suite_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


@pytest.mark.asyncio
async def test_membership_routes_without_permission_return_403() -> None:
    """Membership present but the required `test_suite` permission missing ->
    `403` (the other half of the boundary: same-org callers DO get told it's a
    permission problem, only cross-org callers get the existence-hiding 404).

    The custom role grants an unrelated real permission, so a `403` proves the
    specific `test_suite.read`/`.update` gate fired rather than a blanket
    has-no-roles rejection.
    """
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_suite_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcbnd403")
            project = await _create_project(session, org, "tcbnd403")
            requirement = await _create_requirement(session, project, "tcbnd403")
            condition = await _create_test_condition(session, requirement, "tcbnd403")
            level = await _create_test_level(session, "tcbnd403")
            test_type = await _create_test_type(session, "tcbnd403")
            case = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tcbnd403"
            )
            suite = await _create_test_suite(session, project, "tcbnd403")
            member, custom_role = await _create_custom_role_member(
                session, "tcbnd403", org, ["test_case.read"]
            )
            await session.commit()
            user_ids = [admin.actor_id, member.actor_id]
            org_ids = [org.id]
            role_ids = [custom_role.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_suite_ids = [suite.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            member_id, suite_id, case_id = member.actor_id, suite.id, case.id

        headers = {"Authorization": f"Bearer {_access_token_for(member_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            listed = await client.get(_suite_test_cases_path(suite_id), headers=headers)
            assert listed.status_code == 403, listed.text
            assert listed.json()["code"] == "permission_denied"

            added = await client.post(_suite_membership_path(suite_id, case_id), headers=headers)
            assert added.status_code == 403, added.text
            assert added.json()["code"] == "permission_denied"

            removed = await client.delete(
                _suite_membership_path(suite_id, case_id), headers=headers
            )
            assert removed.status_code == 403, removed.text
            assert removed.json()["code"] == "permission_denied"
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            role_ids=role_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_suite_ids=test_suite_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


@pytest.mark.asyncio
async def test_nonexistent_suite_or_case_returns_404() -> None:
    """Ids that don't exist at all -> `404`, indistinguishable from the
    cross-org case above (that indistinguishability is the point).
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_suite_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcbnd404m")
            project = await _create_project(session, org, "tcbnd404m")
            requirement = await _create_requirement(session, project, "tcbnd404m")
            condition = await _create_test_condition(session, requirement, "tcbnd404m")
            level = await _create_test_level(session, "tcbnd404m")
            test_type = await _create_test_type(session, "tcbnd404m")
            case = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tcbnd404m"
            )
            suite = await _create_test_suite(session, project, "tcbnd404m")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_suite_ids = [suite.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            admin_id, suite_id, case_id = admin.actor_id, suite.id, case.id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        missing_suite_id = uuid4()
        missing_case_id = uuid4()

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # Nonexistent suite, on every route.
            for response in (
                await client.get(_suite_test_cases_path(missing_suite_id), headers=headers),
                await client.post(
                    _suite_membership_path(missing_suite_id, case_id), headers=headers
                ),
                await client.delete(
                    _suite_membership_path(missing_suite_id, case_id), headers=headers
                ),
            ):
                assert response.status_code == 404, response.text
                assert response.json()["code"] == "not_found"

            # Real suite, nonexistent case.
            add_missing_case = await client.post(
                _suite_membership_path(suite_id, missing_case_id), headers=headers
            )
            assert add_missing_case.status_code == 404, add_missing_case.text
            assert add_missing_case.json()["code"] == "not_found"

            remove_missing_case = await client.delete(
                _suite_membership_path(suite_id, missing_case_id), headers=headers
            )
            assert remove_missing_case.status_code == 404, remove_missing_case.text
            assert remove_missing_case.json()["code"] == "not_found"
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_suite_ids=test_suite_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )
