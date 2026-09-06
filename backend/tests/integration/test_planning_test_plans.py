"""Integration tests for PLAN-1's `TestPlan` membership/coverage routes and the
`status`-transition guard (ADR-0031).

Routes under test:
`POST`/`DELETE /test-plans/{id}/test-suites/{suite_id}`,
`GET /test-plans/{id}/test-suites`, `GET /test-plans/{id}/test-cases`, plus the
transition guard now wired into the generic `PATCH /test-plans/{id}`.

Real HTTP via `httpx.AsyncClient` against a live server (`TEST_API_BASE_URL`),
matching `test_req4_test_suite_membership.py`'s established style. The
package-level `tests/integration/conftest.py` fixture (`_require_live_server`,
autouse, session-scoped) applies to this module too.

Covers TC-PLAN-001, 002, 003, 009, 010, 011 from
`docs/test-cases/2026-09-03-test-cases.md`, plus the equivalence classes
`docs/test-design/2026-09-03-test-design.md` §27 adds on top of them. TC-PLAN-004
through 008 belong to PLAN-2/PLAN-3 and are deliberately absent — they have no
implementation to test yet.

Four things §27 is explicit about, each of which changes what the test must
actually *do*, not merely what it asserts:

- **Coverage deduplication (TC-PLAN-002)** needs a fixture "engineered
  specifically to exercise this": two included suites *sharing one* TestCase.
  §27 spells out why a simpler fixture is worthless here — "a single-suite
  fixture cannot distinguish 'deduplicated' from 'never had a duplicate to
  begin with'". `_seed_coverage_fixture` below builds exactly that shape: suite
  A holds {shared, only_a}, suite B holds {shared, only_b}, so the correct
  answer is 3 cases with `shared` appearing once, and a naive join-and-list
  returns 4.
- **Live-membership (§27)** must be "a sequenced triple (add-state, remove,
  both post-remove reads), not two independent assertions" — and the
  post-remove check must confirm the *coverage* query also stopped reaching the
  cases only the removed suite provided, while keeping those a still-included
  suite still provides.
- **Status transitions (§27)** must be "independent negative cases (not
  inferred from one another)", because an allow-list-shaped guard could accept
  an untested illegal pair. Each illegal pair below therefore gets its own
  freshly-seeded plan at the right starting status, never a plan left over from
  a previous assertion in the same test.
- **Non-status-field independence (§27)** is tested against a `superseded`
  (terminal) plan specifically, over real HTTP, to prove the guard scopes to the
  `status` field and not the whole route.

Every membership assertion queries `TestPlanTestSuite` directly via
`AsyncSessionLocal` rather than inferring state from a response body — same
posture REQ-3/REQ-4's files established for their own link tables.

Each test seeds its own rows and cleans up in a `finally` block; emails, org
slugs and names are unique per test.
"""

import os
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, or_, select

from app.core.security import create_access_token, hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import (
    TestCase,
    TestCaseStatus,
    TestSuite,
    TestSuiteTestCase,
)
from app.models.auth import AuthIdentity, AuthProvider
from app.models.planning import TestPlan, TestPlanStatus, TestPlanTestSuite
from app.models.project import Project
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


def _plan_membership_path(test_plan_id, test_suite_id) -> str:
    """`POST`/`DELETE` target — the include/remove pair."""
    return f"{API_PREFIX}/test-plans/{test_plan_id}/test-suites/{test_suite_id}"


def _plan_suites_path(test_plan_id) -> str:
    """`GET` target — the live included-suites list."""
    return f"{API_PREFIX}/test-plans/{test_plan_id}/test-suites"


def _plan_coverage_path(test_plan_id) -> str:
    """`GET` target — AC2's two-hop, deduplicated coverage query."""
    return f"{API_PREFIX}/test-plans/{test_plan_id}/test-cases"


def _plan_path(test_plan_id) -> str:
    """The generic factory's own `GET`/`PATCH`/`DELETE` target."""
    return f"{API_PREFIX}/test-plans/{test_plan_id}"


# --- seeding / cleanup helpers ---------------------------------------------------------------
# Mirrors test_req4_test_suite_membership.py's helpers of the same names and
# shapes, with the TestPlan / TestPlanTestSuite rows this story needs.


def _unique_email(tag: str) -> str:
    # `example.com` deliberately — never a reserved special-use TLD
    # (`.local`/`.test`/`.invalid`/`.example`), which `EmailStr` rejects at
    # login with a 422 that reads like a wrong password (backend/CLAUDE.md).
    return f"plan1-{tag}-{uuid4().hex[:8]}@example.com"


def _unique_slug(tag: str) -> str:
    return f"plan1-{tag}-{uuid4().hex[:8]}"


def _unique_name(tag: str) -> str:
    return f"PLAN-1 {tag} {uuid4().hex[:8]}"


async def _create_user(session, email: str, password: str = DEFAULT_PASSWORD) -> User:
    user = User(name="PLAN-1 Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()  # populate user.actor_id (joined-table inheritance PK/FK)
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"PLAN-1 Test Org {slug_prefix}", slug=_unique_slug(slug_prefix))
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


async def _assign_role(session, *, actor_id, org: Organization, role: Role, project_id=None):
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
    so a 403 proves the specific `test_plan.update`/`.read` gate fired rather
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


def _auth_headers(actor_id) -> dict[str, str]:
    return {"Authorization": f"Bearer {_access_token_for(actor_id)}"}


async def _create_project(session, org: Organization, tag: str) -> Project:
    project = Project(org_id=org.id, name=_unique_name(tag))
    session.add(project)
    await session.flush()
    return project


async def _create_test_suite(
    session, project: Project, tag: str, *, purpose: str = "regression"
) -> TestSuite:
    suite = TestSuite(project_id=project.id, name=_unique_name(f"Suite {tag}"), purpose=purpose)
    session.add(suite)
    await session.flush()
    return suite


async def _create_test_plan(
    session,
    project: Project,
    actor_id,
    tag: str,
    *,
    status: TestPlanStatus = TestPlanStatus.draft,
) -> TestPlan:
    plan = TestPlan(
        project_id=project.id,
        created_by_actor_id=actor_id,
        identifier=_unique_name(f"Plan {tag}"),
        scope=f"PLAN-1 seeded scope {tag}",
        status=status,
    )
    session.add(plan)
    await session.flush()
    return plan


async def _create_test_level(session, tag: str) -> TestLevel:
    level = TestLevel(name=f"PLAN-1 Level {tag} {uuid4().hex[:8]}")
    session.add(level)
    await session.flush()
    return level


async def _create_test_type(session, tag: str) -> TestType:
    test_type = TestType(name=f"PLAN-1 Type {tag} {uuid4().hex[:8]}")
    session.add(test_type)
    await session.flush()
    return test_type


async def _create_test_case(
    session, actor_id, test_level: TestLevel, test_type: TestType, tag: str
) -> TestCase:
    """A minimal standalone TestCase, reachable via its `TestSuiteTestCase` link.

    `test_condition_id` is left NULL and no `RequirementTestCaseLink` is
    created: these cases exist only to be suite members, and the suite link is
    ADR-0029 resolver branch 3, which is all the coverage query needs to walk.
    """
    test_case = TestCase(
        test_condition_id=None,
        test_level_id=test_level.id,
        test_type_id=test_type.id,
        created_by_actor_id=actor_id,
        title=_unique_name(f"TC {tag}"),
        status=TestCaseStatus.draft,
    )
    session.add(test_case)
    await session.flush()
    return test_case


# --- direct DB assertions (never inferred from a response body) ------------------------------


async def _plan_membership_rows(test_plan_id, test_suite_id) -> list:
    """Every `TestPlanTestSuite` row for one (plan, suite) pair.

    TC-PLAN-002 / §27: membership is proven against the junction table itself,
    not from a `201` body — the same reasoning ADR-0030's own tests used.
    """
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(TestPlanTestSuite.id).where(
                TestPlanTestSuite.test_plan_id == test_plan_id,
                TestPlanTestSuite.test_suite_id == test_suite_id,
            )
        )
        return [row[0] for row in result.all()]


async def _suite_ids_in_plan(test_plan_id) -> set:
    """All `test_suite_id`s joined to one plan, read straight from the DB."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(TestPlanTestSuite.test_suite_id).where(
                TestPlanTestSuite.test_plan_id == test_plan_id
            )
        )
        return {row[0] for row in result.all()}


async def _plan_status(test_plan_id) -> str:
    """The plan's persisted status, as a plain string.

    Read from the DB rather than trusted from a `PATCH` response body: a guard
    that returned a correct-looking `409` *after* already mutating the row would
    still pass a response-only assertion.
    """
    async with AsyncSessionLocal() as session:
        row = await session.get(TestPlan, test_plan_id)
        assert row is not None
        return row.status.value if hasattr(row.status, "value") else str(row.status)


async def _cleanup(
    *,
    emails: list[str] | None = None,
    user_ids: list | None = None,
    org_ids: list | None = None,
    role_ids: list | None = None,
    project_ids: list | None = None,
    test_plan_ids: list | None = None,
    test_suite_ids: list | None = None,
    test_case_ids: list | None = None,
    test_level_ids: list | None = None,
    test_type_ids: list | None = None,
) -> None:
    """Delete everything a test may have created, in FK-safe order.

    Same shape as `test_req4_test_suite_membership.py`'s `_cleanup`, with
    `TestPlanTestSuite`/`TestPlan` added: the junction rows go before both
    entities they reference, and `TestPlan` before its `Project`.
    """
    emails = emails or []
    user_ids = list(user_ids or [])
    org_ids = org_ids or []
    role_ids = role_ids or []
    project_ids = project_ids or []
    test_plan_ids = test_plan_ids or []
    test_suite_ids = test_suite_ids or []
    test_case_ids = test_case_ids or []
    test_level_ids = test_level_ids or []
    test_type_ids = test_type_ids or []

    async with AsyncSessionLocal() as session:
        if emails:
            result = await session.execute(select(User.actor_id).where(User.email.in_(emails)))
            user_ids.extend(row[0] for row in result.all() if row[0] not in user_ids)

        # Junction rows first — the entity FKs above them are RESTRICT.
        if test_plan_ids or test_suite_ids:
            conditions = []
            if test_plan_ids:
                conditions.append(TestPlanTestSuite.test_plan_id.in_(test_plan_ids))
            if test_suite_ids:
                conditions.append(TestPlanTestSuite.test_suite_id.in_(test_suite_ids))
            await session.execute(delete(TestPlanTestSuite).where(or_(*conditions)))

        if test_suite_ids or test_case_ids:
            conditions = []
            if test_suite_ids:
                conditions.append(TestSuiteTestCase.test_suite_id.in_(test_suite_ids))
            if test_case_ids:
                conditions.append(TestSuiteTestCase.test_case_id.in_(test_case_ids))
            await session.execute(delete(TestSuiteTestCase).where(or_(*conditions)))

        if test_plan_ids:
            await session.execute(delete(TestPlan).where(TestPlan.id.in_(test_plan_ids)))
        if test_suite_ids:
            await session.execute(delete(TestSuite).where(TestSuite.id.in_(test_suite_ids)))
        if test_case_ids:
            await session.execute(delete(TestCase).where(TestCase.id.in_(test_case_ids)))
        if test_level_ids:
            await session.execute(delete(TestLevel).where(TestLevel.id.in_(test_level_ids)))
        if test_type_ids:
            await session.execute(delete(TestType).where(TestType.id.in_(test_type_ids)))

        if user_ids:
            await session.execute(
                delete(RoleAssignment).where(RoleAssignment.actor_id.in_(user_ids))
            )
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


# --- TC-PLAN-001: create test plan ------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_test_plan_defaults_to_draft() -> None:  # TC-PLAN-001
    """TC-PLAN-001 literally: "POST with identifier/scope/approach/staffing/
    schedule" -> "Created with status `draft`".

    Exercises the pre-existing generic factory route (`POST /test-plans`), which
    ADR-0031 explicitly leaves alone — AC1 is closed by the column default, with
    no new route code. The test exists to pin that claim: if the default ever
    changed, or the new `update_guard` hook accidentally leaked into the create
    path, this is what catches it.

    The status is re-read from the DB as well as the response, so a route that
    echoed `draft` back without persisting it cannot pass.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    test_plan_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user, org = await _create_org_admin(session, "create")
            project = await _create_project(session, org, "create")
            await session.commit()
            user_ids.append(user.actor_id)
            org_ids.append(org.id)
            project_ids.append(project.id)

        payload = {
            "project_id": str(project.id),
            "identifier": _unique_name("Created Plan"),
            "scope": "Everything in the release",
            "approach": "Risk-based, automated where possible",
            "staffing_and_training": "2 testers, 1 automation engineer",
            "schedule": "Sprints 4-6",
        }
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            response = await client.post(
                f"{API_PREFIX}/test-plans", json=payload, headers=_auth_headers(user.actor_id)
            )

        assert response.status_code == 201, response.text
        body = response.json()
        test_plan_ids.append(body["id"])

        # AC1's actual claim: created in `draft` without the caller saying so.
        assert body["status"] == "draft"
        assert body["identifier"] == payload["identifier"]
        assert body["scope"] == payload["scope"]
        assert body["approach"] == payload["approach"]
        assert body["staffing_and_training"] == payload["staffing_and_training"]
        assert body["schedule"] == payload["schedule"]
        assert body["project_id"] == str(project.id)

        # Persisted, not just echoed.
        assert await _plan_status(body["id"]) == "draft"
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            test_plan_ids=test_plan_ids,
        )


# --- TC-PLAN-002: include suites + deduplicated coverage query --------------------------------


@pytest.mark.asyncio
async def test_include_suites_and_coverage_query_deduplicates() -> None:  # TC-PLAN-002
    """TC-PLAN-002 literally: "TestPlan + 2 TestSuites (same project) exist, one
    shared TestCase is a member of both" -> "POST for each suite, then GET
    `/test-plans/{id}/test-cases`" -> "Both `TestPlanTestSuite` rows exist; the
    coverage query returns the union of both suites' member TestCases, with the
    shared TestCase appearing exactly once (deduplicated)".

    The fixture is the whole point (§27): suite A = {shared, only_a}, suite B =
    {shared, only_b}. The correct answer is 3 distinct cases; a naive
    join-and-list returns 4 rows with `shared` twice. Both the id *set* and the
    *length* are asserted — the set alone would silently pass a duplicated
    result, since a set collapses the duplicate the route failed to.

    "Both rows exist" is checked against `TestPlanTestSuite` directly, not
    inferred from the two `201`s.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    test_plan_ids: list = []
    test_suite_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user, org = await _create_org_admin(session, "cov")
            project = await _create_project(session, org, "cov")
            plan = await _create_test_plan(session, project, user.actor_id, "cov")
            suite_a = await _create_test_suite(session, project, "A")
            suite_b = await _create_test_suite(session, project, "B")
            level = await _create_test_level(session, "cov")
            ttype = await _create_test_type(session, "cov")

            shared = await _create_test_case(session, user.actor_id, level, ttype, "shared")
            only_a = await _create_test_case(session, user.actor_id, level, ttype, "onlyA")
            only_b = await _create_test_case(session, user.actor_id, level, ttype, "onlyB")

            # The engineered overlap: `shared` is a member of BOTH suites.
            session.add(TestSuiteTestCase(test_suite_id=suite_a.id, test_case_id=shared.id))
            session.add(TestSuiteTestCase(test_suite_id=suite_a.id, test_case_id=only_a.id))
            session.add(TestSuiteTestCase(test_suite_id=suite_b.id, test_case_id=shared.id))
            session.add(TestSuiteTestCase(test_suite_id=suite_b.id, test_case_id=only_b.id))
            await session.commit()

            user_ids.append(user.actor_id)
            org_ids.append(org.id)
            project_ids.append(project.id)
            test_plan_ids.append(plan.id)
            test_suite_ids.extend([suite_a.id, suite_b.id])
            test_case_ids.extend([shared.id, only_a.id, only_b.id])
            test_level_ids.append(level.id)
            test_type_ids.append(ttype.id)

        headers = _auth_headers(user.actor_id)
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            include_a = await client.post(_plan_membership_path(plan.id, suite_a.id), headers=headers)
            include_b = await client.post(_plan_membership_path(plan.id, suite_b.id), headers=headers)
            suites_response = await client.get(_plan_suites_path(plan.id), headers=headers)
            coverage = await client.get(_plan_coverage_path(plan.id), headers=headers)

        assert include_a.status_code == 201, include_a.text
        assert include_b.status_code == 201, include_b.text

        # "Both `TestPlanTestSuite` rows exist" — queried directly.
        assert len(await _plan_membership_rows(plan.id, suite_a.id)) == 1
        assert len(await _plan_membership_rows(plan.id, suite_b.id)) == 1
        assert await _suite_ids_in_plan(plan.id) == {suite_a.id, suite_b.id}

        assert suites_response.status_code == 200, suites_response.text
        suites_body = suites_response.json()
        assert {item["id"] for item in suites_body["items"]} == {str(suite_a.id), str(suite_b.id)}
        assert suites_body["total"] == 2

        assert coverage.status_code == 200, coverage.text
        coverage_body = coverage.json()
        returned_ids = [item["id"] for item in coverage_body["items"]]

        # The union, deduplicated: 3 cases, not 4 rows.
        assert set(returned_ids) == {str(shared.id), str(only_a.id), str(only_b.id)}
        assert len(returned_ids) == 3, (
            "coverage query returned a duplicate — the shared TestCase must appear "
            f"exactly once, got {returned_ids}"
        )
        assert returned_ids.count(str(shared.id)) == 1
        # `total` must agree with the deduplicated result, not count join rows.
        assert coverage_body["total"] == 3
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            test_plan_ids=test_plan_ids,
            test_suite_ids=test_suite_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


@pytest.mark.asyncio
async def test_membership_and_coverage_are_live_across_a_removal() -> None:
    """§27's live-membership class, as "a sequenced triple ... not two
    independent assertions".

    One test, one fixture, three reads: the add-state, then the removal, then
    *both* post-remove reads. After removing suite B, the coverage query must
    drop `only_b` (reachable only through B) while keeping `shared` (still
    reachable through the still-included A) — the exact distinction §27 calls
    out, and one that a coverage query rebuilt from a stale snapshot, or one
    that dropped every case the removed suite touched, would both fail.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    test_plan_ids: list = []
    test_suite_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user, org = await _create_org_admin(session, "live")
            project = await _create_project(session, org, "live")
            plan = await _create_test_plan(session, project, user.actor_id, "live")
            suite_a = await _create_test_suite(session, project, "liveA")
            suite_b = await _create_test_suite(session, project, "liveB")
            level = await _create_test_level(session, "live")
            ttype = await _create_test_type(session, "live")

            shared = await _create_test_case(session, user.actor_id, level, ttype, "liveShared")
            only_b = await _create_test_case(session, user.actor_id, level, ttype, "liveOnlyB")

            session.add(TestSuiteTestCase(test_suite_id=suite_a.id, test_case_id=shared.id))
            session.add(TestSuiteTestCase(test_suite_id=suite_b.id, test_case_id=shared.id))
            session.add(TestSuiteTestCase(test_suite_id=suite_b.id, test_case_id=only_b.id))
            session.add(TestPlanTestSuite(test_plan_id=plan.id, test_suite_id=suite_a.id))
            session.add(TestPlanTestSuite(test_plan_id=plan.id, test_suite_id=suite_b.id))
            await session.commit()

            user_ids.append(user.actor_id)
            org_ids.append(org.id)
            project_ids.append(project.id)
            test_plan_ids.append(plan.id)
            test_suite_ids.extend([suite_a.id, suite_b.id])
            test_case_ids.extend([shared.id, only_b.id])
            test_level_ids.append(level.id)
            test_type_ids.append(ttype.id)

        headers = _auth_headers(user.actor_id)
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            # 1. add-state
            suites_before = await client.get(_plan_suites_path(plan.id), headers=headers)
            coverage_before = await client.get(_plan_coverage_path(plan.id), headers=headers)
            # 2. the removal
            removal = await client.delete(
                _plan_membership_path(plan.id, suite_b.id), headers=headers
            )
            # 3. both post-remove reads
            suites_after = await client.get(_plan_suites_path(plan.id), headers=headers)
            coverage_after = await client.get(_plan_coverage_path(plan.id), headers=headers)

        assert suites_before.status_code == 200
        assert {i["id"] for i in suites_before.json()["items"]} == {
            str(suite_a.id),
            str(suite_b.id),
        }
        assert coverage_before.status_code == 200
        assert {i["id"] for i in coverage_before.json()["items"]} == {
            str(shared.id),
            str(only_b.id),
        }

        assert removal.status_code == 204, removal.text

        # The suites list reflects the removal...
        assert suites_after.status_code == 200
        assert {i["id"] for i in suites_after.json()["items"]} == {str(suite_a.id)}
        assert await _suite_ids_in_plan(plan.id) == {suite_a.id}

        # ...and so does the coverage query: `only_b` is gone (only B provided
        # it), `shared` survives (A still provides it).
        assert coverage_after.status_code == 200
        after_ids = [i["id"] for i in coverage_after.json()["items"]]
        assert set(after_ids) == {str(shared.id)}
        assert str(only_b.id) not in after_ids
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            test_plan_ids=test_plan_ids,
            test_suite_ids=test_suite_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


@pytest.mark.asyncio
async def test_zero_membership_and_zero_coverage_return_200_empty_not_404() -> None:
    """§27's zero-coverage boundary: a fresh plan is a valid, common state.

    Both reads must be `200` with an empty list. `404` here would be wrong in a
    way that matters — the plan exists, and "has no suites yet" is not
    "not found". Also covers the "included suites with zero members" half: the
    second pair of reads includes a real (but empty) suite, which must still
    yield empty coverage rather than an error.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    test_plan_ids: list = []
    test_suite_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user, org = await _create_org_admin(session, "empty")
            project = await _create_project(session, org, "empty")
            plan = await _create_test_plan(session, project, user.actor_id, "empty")
            empty_suite = await _create_test_suite(session, project, "emptySuite")
            await session.commit()

            user_ids.append(user.actor_id)
            org_ids.append(org.id)
            project_ids.append(project.id)
            test_plan_ids.append(plan.id)
            test_suite_ids.append(empty_suite.id)

        headers = _auth_headers(user.actor_id)
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            suites_none = await client.get(_plan_suites_path(plan.id), headers=headers)
            coverage_none = await client.get(_plan_coverage_path(plan.id), headers=headers)
            # Now include a suite that itself has no members.
            included = await client.post(
                _plan_membership_path(plan.id, empty_suite.id), headers=headers
            )
            coverage_empty_suite = await client.get(_plan_coverage_path(plan.id), headers=headers)

        # No suites included at all.
        assert suites_none.status_code == 200, suites_none.text
        assert suites_none.json()["items"] == []
        assert suites_none.json()["total"] == 0
        assert coverage_none.status_code == 200, coverage_none.text
        assert coverage_none.json()["items"] == []
        assert coverage_none.json()["total"] == 0

        # One included suite, which has no member TestCases.
        assert included.status_code == 201, included.text
        assert coverage_empty_suite.status_code == 200, coverage_empty_suite.text
        assert coverage_empty_suite.json()["items"] == []
        assert coverage_empty_suite.json()["total"] == 0
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            test_plan_ids=test_plan_ids,
            test_suite_ids=test_suite_ids,
        )


# --- TC-PLAN-003: status transitions ----------------------------------------------------------


@pytest.mark.asyncio
async def test_valid_status_transition_sequence_succeeds() -> None:  # TC-PLAN-003 (positive)
    """TC-PLAN-003's positive half: "`PATCH` status draft->approved, then
    approved->superseded (both succeed)".

    Sequenced on one plan, since that is the literal wording — the second
    transition's legality depends on the first having actually persisted, which
    is also why each step re-reads the status from the DB rather than trusting
    the `PATCH` response body.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    test_plan_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user, org = await _create_org_admin(session, "seq")
            project = await _create_project(session, org, "seq")
            plan = await _create_test_plan(session, project, user.actor_id, "seq")
            await session.commit()
            user_ids.append(user.actor_id)
            org_ids.append(org.id)
            project_ids.append(project.id)
            test_plan_ids.append(plan.id)

        headers = _auth_headers(user.actor_id)
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            approve = await client.patch(
                _plan_path(plan.id), json={"status": "approved"}, headers=headers
            )
            assert approve.status_code == 200, approve.text
            assert approve.json()["status"] == "approved"
            assert await _plan_status(plan.id) == "approved"

            supersede = await client.patch(
                _plan_path(plan.id), json={"status": "superseded"}, headers=headers
            )
            assert supersede.status_code == 200, supersede.text
            assert supersede.json()["status"] == "superseded"
            assert await _plan_status(plan.id) == "superseded"
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            test_plan_ids=test_plan_ids,
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("start_status", "requested"),
    [
        (TestPlanStatus.draft, "superseded"),  # TC-PLAN-003's named negative
        (TestPlanStatus.approved, "draft"),  # backward
        (TestPlanStatus.draft, "draft"),  # same-state
        (TestPlanStatus.approved, "approved"),  # idempotent re-approval
        (TestPlanStatus.superseded, "draft"),  # terminal
        (TestPlanStatus.superseded, "approved"),  # terminal
        (TestPlanStatus.superseded, "superseded"),  # terminal + same-state
    ],
)
async def test_illegal_status_transitions_are_rejected_with_409(
    start_status: TestPlanStatus, requested: str
) -> None:  # TC-PLAN-003 (negatives)
    """Every illegal pair, each on its **own freshly-seeded plan**.

    §27 requires these be "independent negative cases (not inferred from one
    another)" — hence a new plan per case at exactly the right starting status,
    never a plan carried over from a previous assertion whose state a failing
    earlier step could have changed.

    Each case asserts three things: the `409`, the `invalid_status_transition`
    code specifically (the frontend branches on it, UI Design Document §4), and
    that the row's status is **unchanged in the DB** — a guard that rejected
    after mutating would pass the first two.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    test_plan_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user, org = await _create_org_admin(session, "neg")
            project = await _create_project(session, org, "neg")
            plan = await _create_test_plan(
                session, project, user.actor_id, "neg", status=start_status
            )
            await session.commit()
            user_ids.append(user.actor_id)
            org_ids.append(org.id)
            project_ids.append(project.id)
            test_plan_ids.append(plan.id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            response = await client.patch(
                _plan_path(plan.id),
                json={"status": requested},
                headers=_auth_headers(user.actor_id),
            )

        assert response.status_code == 409, response.text
        assert response.json()["code"] == "invalid_status_transition"
        # Nothing was written.
        assert await _plan_status(plan.id) == start_status.value
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            test_plan_ids=test_plan_ids,
        )


@pytest.mark.asyncio
async def test_non_status_fields_patch_freely_on_a_superseded_plan() -> None:
    """§27's non-status-field independence, against the terminal state.

    A `PATCH` body with no `status` key must be completely unaffected by the
    guard, "tested against a `superseded` (terminal-state) plan specifically, to
    prove the guard scopes to the `status` field alone, not the whole route".
    `superseded` is the strongest case: no transition out of it is legal, so a
    guard that had accidentally scoped itself to the whole route would reject
    this and fail here while passing every status-pair test.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    test_plan_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user, org = await _create_org_admin(session, "indep")
            project = await _create_project(session, org, "indep")
            plan = await _create_test_plan(
                session, project, user.actor_id, "indep", status=TestPlanStatus.superseded
            )
            await session.commit()
            user_ids.append(user.actor_id)
            org_ids.append(org.id)
            project_ids.append(project.id)
            test_plan_ids.append(plan.id)

        new_identifier = _unique_name("Renamed While Superseded")
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            response = await client.patch(
                _plan_path(plan.id),
                json={
                    "identifier": new_identifier,
                    "scope": "revised scope",
                    "approach": "revised approach",
                    "staffing_and_training": "revised staffing",
                    "schedule": "revised schedule",
                },
                headers=_auth_headers(user.actor_id),
            )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["identifier"] == new_identifier
        assert body["scope"] == "revised scope"
        # The status is untouched by a body that never mentioned it.
        assert body["status"] == "superseded"
        assert await _plan_status(plan.id) == "superseded"
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            test_plan_ids=test_plan_ids,
        )


# --- TC-PLAN-009: cross-project include rejected ----------------------------------------------


@pytest.mark.asyncio
async def test_cross_project_include_returns_422_not_404() -> None:  # TC-PLAN-009
    """TC-PLAN-009 literally: "TestPlan in Project A; TestSuite in Project B
    (same org)" -> POST -> "`422 validation_error`, never `404` (caller already
    proved org membership)".

    The `never 404` clause is the assertion that matters: `404` would be the
    right answer across an *org* boundary, and getting the two confused is the
    specific bug this class exists to catch. The join row must also not exist
    afterward — a route that rejected with `422` after inserting would pass a
    status-code-only check.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    test_plan_ids: list = []
    test_suite_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user, org = await _create_org_admin(session, "xproj")
            project_a = await _create_project(session, org, "projA")
            project_b = await _create_project(session, org, "projB")
            plan = await _create_test_plan(session, project_a, user.actor_id, "xproj")
            suite_b = await _create_test_suite(session, project_b, "inB")
            await session.commit()

            user_ids.append(user.actor_id)
            org_ids.append(org.id)
            project_ids.extend([project_a.id, project_b.id])
            test_plan_ids.append(plan.id)
            test_suite_ids.append(suite_b.id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            response = await client.post(
                _plan_membership_path(plan.id, suite_b.id),
                headers=_auth_headers(user.actor_id),
            )

        assert response.status_code == 422, response.text
        assert response.json()["code"] == "validation_error"
        # Nothing was written.
        assert await _plan_membership_rows(plan.id, suite_b.id) == []
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            test_plan_ids=test_plan_ids,
            test_suite_ids=test_suite_ids,
        )


# --- TC-PLAN-010: duplicate include is a conflict ---------------------------------------------


@pytest.mark.asyncio
async def test_duplicate_include_returns_409_not_422() -> None:  # TC-PLAN-010
    """TC-PLAN-010 literally: "POST the same pair again" -> "`409
    already_included_in_plan`, distinct from `422`; the first (non-duplicate)
    POST in the same test asserted `201` immediately prior".

    Written as the positive-then-negative pair the TC's own wording demands, in
    one test. The `409` *and* the specific code are both asserted: §27 flags
    that an implementation copy-pasting the generic `IntegrityError` -> `422`
    handler would fail this class, and so would one reusing REQ-4's
    `already_in_suite` code for a different relationship.

    Exactly one join row must exist afterward — the duplicate POST must not have
    written a second.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    test_plan_ids: list = []
    test_suite_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user, org = await _create_org_admin(session, "dup")
            project = await _create_project(session, org, "dup")
            plan = await _create_test_plan(session, project, user.actor_id, "dup")
            suite = await _create_test_suite(session, project, "dup")
            await session.commit()

            user_ids.append(user.actor_id)
            org_ids.append(org.id)
            project_ids.append(project.id)
            test_plan_ids.append(plan.id)
            test_suite_ids.append(suite.id)

        headers = _auth_headers(user.actor_id)
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            first = await client.post(_plan_membership_path(plan.id, suite.id), headers=headers)
            second = await client.post(_plan_membership_path(plan.id, suite.id), headers=headers)

        assert first.status_code == 201, first.text
        assert second.status_code == 409, second.text
        assert second.json()["code"] == "already_included_in_plan"
        # Distinct from REQ-4's own duplicate code for a different relationship.
        assert second.json()["code"] != "already_in_suite"
        # The duplicate wrote nothing.
        assert len(await _plan_membership_rows(plan.id, suite.id)) == 1
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            test_plan_ids=test_plan_ids,
            test_suite_ids=test_suite_ids,
        )


# --- TC-PLAN-011: remove a non-included suite is 404 ------------------------------------------


@pytest.mark.asyncio
async def test_remove_non_included_suite_returns_404() -> None:  # TC-PLAN-011
    """TC-PLAN-011 literally: "TestSuite was never included (or was already
    removed)" -> DELETE -> "`404` — deliberately asymmetric with `POST`'s
    `409`-on-already-true".

    Both halves of the precondition are exercised, since they are different
    states that could plausibly diverge in a buggy implementation: a suite that
    was never included, and one that was included and then removed (the second
    DELETE of the same pair).
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    test_plan_ids: list = []
    test_suite_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            user, org = await _create_org_admin(session, "rm")
            project = await _create_project(session, org, "rm")
            plan = await _create_test_plan(session, project, user.actor_id, "rm")
            never_included = await _create_test_suite(session, project, "never")
            included_then_removed = await _create_test_suite(session, project, "then")
            await session.commit()

            user_ids.append(user.actor_id)
            org_ids.append(org.id)
            project_ids.append(project.id)
            test_plan_ids.append(plan.id)
            test_suite_ids.extend([never_included.id, included_then_removed.id])

        headers = _auth_headers(user.actor_id)
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            # (a) never included
            never = await client.delete(
                _plan_membership_path(plan.id, never_included.id), headers=headers
            )
            # (b) included, removed, then removed again
            await client.post(
                _plan_membership_path(plan.id, included_then_removed.id), headers=headers
            )
            first_remove = await client.delete(
                _plan_membership_path(plan.id, included_then_removed.id), headers=headers
            )
            second_remove = await client.delete(
                _plan_membership_path(plan.id, included_then_removed.id), headers=headers
            )

        assert never.status_code == 404, never.text
        assert never.json()["code"] == "not_found"

        assert first_remove.status_code == 204, first_remove.text
        assert second_remove.status_code == 404, second_remove.text
        assert second_remove.json()["code"] == "not_found"
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            test_plan_ids=test_plan_ids,
            test_suite_ids=test_suite_ids,
        )


# --- §27 cross-org 404 / missing-permission 403 boundary --------------------------------------


@pytest.mark.asyncio
async def test_cross_org_plan_is_404_on_every_route() -> None:
    """§27's cross-org boundary, reusing §4/§19's Class B/C verbatim.

    A caller with no `OrgMembership` in the plan's org gets `404` from all four
    routes — including the coverage query — never `403` and never a `422`.
    Existence is not confirmable across an org boundary (NFR-1/ADR-0007).

    The outsider is a fully-provisioned `org_admin` **of their own org**, not a
    permissionless user: that way a `404` proves the *tenant* boundary fired,
    not merely that the actor holds no permissions anywhere.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    test_plan_ids: list = []
    test_suite_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            owner, owner_org = await _create_org_admin(session, "owner")
            outsider, outsider_org = await _create_org_admin(session, "outsider")
            project = await _create_project(session, owner_org, "xorg")
            plan = await _create_test_plan(session, project, owner.actor_id, "xorg")
            suite = await _create_test_suite(session, project, "xorg")
            await session.commit()

            user_ids.extend([owner.actor_id, outsider.actor_id])
            org_ids.extend([owner_org.id, outsider_org.id])
            project_ids.append(project.id)
            test_plan_ids.append(plan.id)
            test_suite_ids.append(suite.id)

        headers = _auth_headers(outsider.actor_id)
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            include = await client.post(_plan_membership_path(plan.id, suite.id), headers=headers)
            remove = await client.delete(_plan_membership_path(plan.id, suite.id), headers=headers)
            suites = await client.get(_plan_suites_path(plan.id), headers=headers)
            coverage = await client.get(_plan_coverage_path(plan.id), headers=headers)

        for response in (include, remove, suites, coverage):
            assert response.status_code == 404, response.text
            assert response.json()["code"] == "not_found"

        # And nothing leaked into the junction table.
        assert await _plan_membership_rows(plan.id, suite.id) == []
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            test_plan_ids=test_plan_ids,
            test_suite_ids=test_suite_ids,
        )


@pytest.mark.asyncio
async def test_member_without_test_plan_permissions_gets_403() -> None:
    """§27's Class C: membership present, required permission missing -> `403`.

    The actor deliberately holds an unrelated real permission (`project.read`),
    so a `403` proves the specific `test_plan.update`/`.read` gate fired rather
    than a blanket no-roles-at-all rejection — and distinguishes this from the
    `404` case above, which is what the same actor would get if the tenant
    boundary had fired instead.
    """
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    project_ids: list = []
    test_plan_ids: list = []
    test_suite_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            owner, org = await _create_org_admin(session, "permowner")
            project = await _create_project(session, org, "perm")
            plan = await _create_test_plan(session, project, owner.actor_id, "perm")
            suite = await _create_test_suite(session, project, "perm")
            weak_user, weak_role = await _create_custom_role_member(
                session, "weak", org, ["project.read"]
            )
            await session.commit()

            user_ids.extend([owner.actor_id, weak_user.actor_id])
            org_ids.append(org.id)
            role_ids.append(weak_role.id)
            project_ids.append(project.id)
            test_plan_ids.append(plan.id)
            test_suite_ids.append(suite.id)

        headers = _auth_headers(weak_user.actor_id)
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            include = await client.post(_plan_membership_path(plan.id, suite.id), headers=headers)
            remove = await client.delete(_plan_membership_path(plan.id, suite.id), headers=headers)
            suites = await client.get(_plan_suites_path(plan.id), headers=headers)
            coverage = await client.get(_plan_coverage_path(plan.id), headers=headers)

        for response in (include, remove, suites, coverage):
            assert response.status_code == 403, response.text
            assert response.json()["code"] == "permission_denied"

        assert await _plan_membership_rows(plan.id, suite.id) == []
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            role_ids=role_ids,
            project_ids=project_ids,
            test_plan_ids=test_plan_ids,
            test_suite_ids=test_suite_ids,
        )


@pytest.mark.asyncio
async def test_test_manager_can_use_every_plan_membership_route() -> None:
    """ADR-0031's "no RBAC catalog change" finding, verified rather than assumed.

    `test_manager` is FR-PLAN-1's own persona, and ADR-0031 concluded its seeded
    bundle already holds `test_plan.*`/`test_suite.*`, so no data migration was
    needed. That is exactly the kind of conclusion worth a test: this is the
    only case that would catch the bundle having drifted, or the ADR's reading
    of it having been wrong — a route that 403s for the very role its story's
    persona is meant to use is `backend/CLAUDE.md`'s named "common miss".
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    test_plan_ids: list = []
    test_suite_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            owner, org = await _create_org_admin(session, "tmowner")
            project = await _create_project(session, org, "tm")
            plan = await _create_test_plan(session, project, owner.actor_id, "tm")
            suite = await _create_test_suite(session, project, "tm")
            manager = await _create_member_with_role(session, "tm", org, "test_manager")
            await session.commit()

            user_ids.extend([owner.actor_id, manager.actor_id])
            org_ids.append(org.id)
            project_ids.append(project.id)
            test_plan_ids.append(plan.id)
            test_suite_ids.append(suite.id)

        headers = _auth_headers(manager.actor_id)
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            include = await client.post(_plan_membership_path(plan.id, suite.id), headers=headers)
            suites = await client.get(_plan_suites_path(plan.id), headers=headers)
            coverage = await client.get(_plan_coverage_path(plan.id), headers=headers)
            approve = await client.patch(
                _plan_path(plan.id), json={"status": "approved"}, headers=headers
            )
            remove = await client.delete(_plan_membership_path(plan.id, suite.id), headers=headers)

        assert include.status_code == 201, include.text
        assert suites.status_code == 200, suites.text
        assert {i["id"] for i in suites.json()["items"]} == {str(suite.id)}
        assert coverage.status_code == 200, coverage.text
        assert approve.status_code == 200, approve.text
        assert remove.status_code == 204, remove.text
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            test_plan_ids=test_plan_ids,
            test_suite_ids=test_suite_ids,
        )


@pytest.mark.asyncio
async def test_cross_org_suite_is_404_not_422() -> None:
    """The `404`-vs-`422` split on the *suite* side of `POST`.

    A suite in another org is `404` (existence-hiding), while a suite in another
    *project of the same org* is `422` (TC-PLAN-009 above). Both are "the suite
    isn't valid for this plan", and conflating them either leaks existence
    across a tenant boundary or hides a legitimate business-rule error — so the
    two are pinned as separate cases rather than assumed to follow from one
    another.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    test_plan_ids: list = []
    test_suite_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            owner, owner_org = await _create_org_admin(session, "sowner")
            other, other_org = await _create_org_admin(session, "sother")
            owner_project = await _create_project(session, owner_org, "sownerP")
            other_project = await _create_project(session, other_org, "sotherP")
            plan = await _create_test_plan(session, owner_project, owner.actor_id, "s")
            foreign_suite = await _create_test_suite(session, other_project, "foreign")
            await session.commit()

            user_ids.extend([owner.actor_id, other.actor_id])
            org_ids.extend([owner_org.id, other_org.id])
            project_ids.extend([owner_project.id, other_project.id])
            test_plan_ids.append(plan.id)
            test_suite_ids.append(foreign_suite.id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            response = await client.post(
                _plan_membership_path(plan.id, foreign_suite.id),
                headers=_auth_headers(owner.actor_id),
            )

        assert response.status_code == 404, response.text
        assert response.json()["code"] == "not_found"
        assert await _plan_membership_rows(plan.id, foreign_suite.id) == []
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            test_plan_ids=test_plan_ids,
            test_suite_ids=test_suite_ids,
        )
