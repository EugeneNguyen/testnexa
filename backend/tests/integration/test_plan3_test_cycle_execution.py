"""Integration tests for PLAN-3's two bespoke routes (ADR-0033):
`POST /test-plans/{id}/test-cycles` and `POST /test-cycles/{id}/executions`,
plus the generic `POST /test-executions` removal that had to land with them.

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), matching `test_req4_test_suite_membership.py`'s
established style — this module copies that file's seeding/cleanup helpers
verbatim in shape and extends them with the `TestPlan`/`Release`/`Environment`/
`TestCycle`/`TestExecution` rows this story needs. The package-level
`tests/integration/conftest.py` fixture (`_require_live_server`, autouse=True,
session-scoped) applies automatically to this module too.

Covers TC-PLAN-006, 007, 008, 015, 016, 017 from
`docs/test-cases/2026-09-03-test-cases.md`, plus every additional equivalence
class `docs/test-design/2026-09-03-test-design.md` §29 names for this story:
the `executed_by_actor_id` stamping class, the duplicate-name boundary, the
cross-org `404` boundary on both routes (including the `release_id`-from-a-
different-*org* case, which must be `404` and not the cross-*project* `422`),
the `403`-with-membership class on both routes, and the `test_manager`
RBAC-bundle-extension class that would catch migration `e5b21d7c8f40` silently
failing to apply.

Four things §29 is explicit about, each of which changes what the test must
actually *do* rather than just what it asserts:

- **TC-PLAN-006** must be a create-then-**immediate-read** round trip in one
  test (`backend/CLAUDE.md`'s standing resolver-completeness rule, ADR-0029's
  own precedent). A create-only assertion structurally cannot catch the class
  of bug where the row inserts fine and only the *subsequent* `GET` exposes a
  resolver gap.
- **TC-PLAN-015 and TC-PLAN-016 are two separate tests with two separate
  fixtures.** The route applies its three-way check to `release_id` and
  `environment_id` as two independent `if` branches over two separate rows, not
  one shared comparison — so a fix (or a regression) scoped to only one of the
  two fields must not be able to pass the other's case. In each, the *other*
  field is deliberately valid and same-project, so the only thing being
  rejected is the field under test.
- **TC-PLAN-008** exercises both directions in the SAME test: a scope check
  that always accepted (or always rejected) would each pass a test asserting
  only one direction. Its third clause — the covered case's membership
  confirmed against `GET /test-plans/{id}/test-cases`'s own result set — is what
  pins the gate's `EXISTS` join to PLAN-1's listing join so the two cannot
  silently diverge.
- **The `test_manager`-only test** is the single class that would catch
  migration `e5b21d7c8f40` not having applied: `environment.create` and
  `test_execution.create` are both brand-new grants for that bundle, and
  without them the story's own narrator persona 403s on her own flow. A
  `select(Role.name)` guard asserts the actor genuinely holds nothing else,
  exactly as `test_req4_test_suite_membership.py` does.

Each test seeds its own `User`/`Organization`/`OrgMembership`/`RoleAssignment`/
`Project`/... rows directly via `AsyncSessionLocal` and cleans up in a
`finally` block. Emails/org slugs/names are unique per test.
"""

import os
from datetime import UTC, date, datetime
from uuid import uuid4

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
from app.models.execution import TestExecution, TestExecutionResult, TestLog
from app.models.planning import Environment, TestCycle, TestPlan, TestPlanTestSuite
from app.models.project import Project, Release
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus
from app.models.trace import RequirementTestCaseLink, RequirementTestConditionLink

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


def _plan_test_cycles_path(test_plan_id) -> str:
    """`POST` target — PLAN-3's bespoke `TestCycle` create route."""
    return f"{API_PREFIX}/test-plans/{test_plan_id}/test-cycles"


def _plan_test_cases_path(test_plan_id) -> str:
    """`GET` target — PLAN-1's coverage query (ADR-0031), reused by TC-PLAN-008."""
    return f"{API_PREFIX}/test-plans/{test_plan_id}/test-cases"


def _cycle_executions_path(test_cycle_id) -> str:
    """`POST` target — PLAN-3's bespoke `TestExecution` create route."""
    return f"{API_PREFIX}/test-cycles/{test_cycle_id}/executions"


def _test_cycle_item_path(test_cycle_id) -> str:
    """`GET`/`PATCH`/`DELETE` target — the existing generic factory item route."""
    return f"{API_PREFIX}/test-cycles/{test_cycle_id}"


def _test_executions_path() -> str:
    """The generic collection route: `GET` list survives, `POST` must be gone."""
    return f"{API_PREFIX}/test-executions"


def _test_execution_item_path(test_execution_id) -> str:
    return f"{API_PREFIX}/test-executions/{test_execution_id}"


def _environments_path() -> str:
    """The existing generic factory create — TC-PLAN-007's first sequential call."""
    return f"{API_PREFIX}/environments"


# --- seeding / cleanup helpers ---------------------------------------------------------------
# Copied in shape from test_req4_test_suite_membership.py's helpers of the same
# names, extended with the TestPlan/Release/Environment/TestCycle/TestExecution
# rows this story needs.


def _unique_email(tag: str) -> str:
    return f"plan3-{tag}-{uuid4().hex[:8]}@example.com"


def _unique_slug(tag: str) -> str:
    return f"plan3-{tag}-{uuid4().hex[:8]}"


def _unique_name(tag: str) -> str:
    return f"PLAN-3 {tag} {uuid4().hex[:8]}"


async def _create_user(session, email: str, password: str = DEFAULT_PASSWORD) -> User:
    user = User(name="PLAN-3 Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()  # populate user.actor_id (joined-table inheritance PK/FK)
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"PLAN-3 Test Org {slug_prefix}", slug=_unique_slug(slug_prefix))
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


async def _assign_role(
    session, *, actor_id, org: Organization, role: Role, project_id=None
) -> RoleAssignment:
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
    so a 403 proves the specific `test_cycle.create`/`test_execution.create`
    gate fired rather than a blanket has-no-roles-at-all rejection.
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
        description=f"PLAN-3 requirement description {tag}",
    )
    session.add(requirement)
    await session.flush()
    return requirement


async def _create_test_suite(
    session, project: Project, tag: str, *, purpose: str = "regression"
) -> TestSuite:
    suite = TestSuite(project_id=project.id, name=_unique_name(f"Suite {tag}"), purpose=purpose)
    session.add(suite)
    await session.flush()
    return suite


async def _create_test_condition(session, requirement: Requirement, tag: str) -> TestCondition:
    condition = TestCondition(
        requirement_id=requirement.id,
        description=f"PLAN-3 seeded condition {tag} {uuid4().hex[:6]}",
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
    level = TestLevel(name=f"PLAN-3 Level {tag} {uuid4().hex[:8]}")
    session.add(level)
    await session.flush()
    return level


async def _create_test_type(session, tag: str) -> TestType:
    test_type = TestType(name=f"PLAN-3 Type {tag} {uuid4().hex[:8]}")
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
    `TestCondition.requirement_id` -> `Requirement.project_id`. Every
    `TestCase` in this module uses this branch so that its org always resolves,
    which is what keeps the scope-check tests on the `422` branch instead of
    accidentally testing the `404` one.
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


# --- PLAN-3's own new entities ----------------------------------------------------------------


async def _create_test_plan(session, project: Project, actor_id, tag: str) -> TestPlan:
    """`created_by_actor_id` is non-nullable — the seeding admin's actor id."""
    plan = TestPlan(
        project_id=project.id,
        created_by_actor_id=actor_id,
        identifier=_unique_name(f"Plan {tag}"),
        scope=f"PLAN-3 seeded plan scope {tag}",
    )
    session.add(plan)
    await session.flush()
    return plan


async def _create_release(session, project: Project, tag: str) -> Release:
    release = Release(
        project_id=project.id,
        version_label=_unique_name(f"Release {tag}"),
        target_date=date(2026, 12, 31),
    )
    session.add(release)
    await session.flush()
    return release


async def _create_environment(session, project: Project, tag: str) -> Environment:
    environment = Environment(
        project_id=project.id,
        name=_unique_name(f"Env {tag}"),
        config_notes=f"PLAN-3 seeded environment {tag}",
    )
    session.add(environment)
    await session.flush()
    return environment


async def _create_test_cycle(
    session, plan: TestPlan, release: Release, environment: Environment, tag: str
) -> TestCycle:
    cycle = TestCycle(
        test_plan_id=plan.id,
        release_id=release.id,
        environment_id=environment.id,
        name=_unique_name(f"Cycle {tag}"),
    )
    session.add(cycle)
    await session.flush()
    return cycle


async def _include_suite_in_plan(session, plan: TestPlan, suite: TestSuite) -> TestPlanTestSuite:
    row = TestPlanTestSuite(test_plan_id=plan.id, test_suite_id=suite.id)
    session.add(row)
    await session.flush()
    return row


async def _add_case_to_suite(session, suite: TestSuite, test_case: TestCase) -> TestSuiteTestCase:
    row = TestSuiteTestCase(test_suite_id=suite.id, test_case_id=test_case.id)
    session.add(row)
    await session.flush()
    return row


async def _create_test_execution(
    session, cycle: TestCycle, test_case: TestCase, actor_id, tag: str
) -> TestExecution:
    """Seed a `TestExecution` row directly — the only way to get one now that
    the generic `POST /test-executions` is gone (TC-PLAN-017's own precondition).

    NOTE the enum: the DB *value* is `"pass"` while the Python member is
    `passed` (`pass` is a Python keyword, `app/models/execution.py`).
    """
    execution = TestExecution(
        test_cycle_id=cycle.id,
        test_case_id=test_case.id,
        executed_by_actor_id=actor_id,
        result=TestExecutionResult.passed,
        actual_result=f"PLAN-3 seeded execution {tag}",
        executed_at=datetime.now(UTC),
    )
    session.add(execution)
    await session.flush()
    return execution


# --- direct DB assertions (never inferred from a response body) ------------------------------


async def _test_cycle_row(test_cycle_id):
    async with AsyncSessionLocal() as session:
        return await session.get(TestCycle, test_cycle_id)


async def _execution_ids_in_cycle(test_cycle_id) -> set:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(TestExecution.id).where(TestExecution.test_cycle_id == test_cycle_id)
        )
        return {row[0] for row in result.all()}


async def _cycle_ids_under_plan(test_plan_id) -> set:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(TestCycle.id).where(TestCycle.test_plan_id == test_plan_id)
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
    test_plan_ids: list | None = None,
) -> None:
    """Delete everything a test may have created, in FK-safe order.

    Same shape as `test_req4_test_suite_membership.py`'s `_cleanup`, extended
    for PLAN-3's entities. The FK constraints that dictate the order
    (`app/models/planning.py`, `app/models/execution.py`):

    - `TestExecution.test_cycle_id`/`.test_case_id`/`.executed_by_actor_id` are
      all `RESTRICT` -> executions go first of all.
    - `TestCycle.test_plan_id`/`.release_id`/`.environment_id` are all
      `RESTRICT` -> cycles go before plans, releases and environments.
    - `TestPlan.project_id`/`.created_by_actor_id`, `Release.project_id`,
      `Environment.project_id` are `RESTRICT` -> all three go before the
      `Project` and before the `Actor`/`User` rows.

    `TestPlan`/`Release`/`Environment`/`TestCycle` ids are **derived** from
    `project_ids` rather than passed in, so a test that fails partway through
    (before it could record an id returned by an HTTP call) still cleans up
    everything it created.
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
    test_plan_ids = list(test_plan_ids or [])

    async with AsyncSessionLocal() as session:
        if emails:
            result = await session.execute(select(User.actor_id).where(User.email.in_(emails)))
            user_ids.extend(row[0] for row in result.all() if row[0] not in user_ids)

        # Widen from the projects the test owns: everything PLAN-3 creates
        # hangs off a Project, including rows created by the routes under test.
        environment_ids: list = []
        release_ids: list = []
        if project_ids:
            result = await session.execute(
                select(TestPlan.id).where(TestPlan.project_id.in_(project_ids))
            )
            test_plan_ids.extend(row[0] for row in result.all() if row[0] not in test_plan_ids)
            result = await session.execute(
                select(Environment.id).where(Environment.project_id.in_(project_ids))
            )
            environment_ids = [row[0] for row in result.all()]
            result = await session.execute(
                select(Release.id).where(Release.project_id.in_(project_ids))
            )
            release_ids = [row[0] for row in result.all()]

        test_cycle_ids: list = []
        if test_plan_ids:
            result = await session.execute(
                select(TestCycle.id).where(TestCycle.test_plan_id.in_(test_plan_ids))
            )
            test_cycle_ids = [row[0] for row in result.all()]

        # EXEC-2: `TestLog.test_execution_id` is RESTRICT too, and every
        # `TestExecution` now gets at least one `TestLog` row appended
        # (create route + any `PATCH` that changes `result`) — logs must go
        # before the executions they reference, or the `DELETE` below fails
        # with a FK violation instead of a clean cleanup.
        if test_cycle_ids or test_case_ids:
            conditions = []
            if test_cycle_ids:
                conditions.append(TestExecution.test_cycle_id.in_(test_cycle_ids))
            if test_case_ids:
                conditions.append(TestExecution.test_case_id.in_(test_case_ids))
            execution_id_subquery = select(TestExecution.id).where(or_(*conditions))
            await session.execute(
                delete(TestLog).where(TestLog.test_execution_id.in_(execution_id_subquery))
            )

        # Executions next — every one of their three FKs is RESTRICT.
        if test_cycle_ids or test_case_ids:
            conditions = []
            if test_cycle_ids:
                conditions.append(TestExecution.test_cycle_id.in_(test_cycle_ids))
            if test_case_ids:
                conditions.append(TestExecution.test_case_id.in_(test_case_ids))
            await session.execute(delete(TestExecution).where(or_(*conditions)))
        if test_cycle_ids:
            await session.execute(delete(TestCycle).where(TestCycle.id.in_(test_cycle_ids)))

        # Junction rows next — the entity FKs above them are RESTRICT.
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

        if test_plan_ids:
            await session.execute(delete(TestPlan).where(TestPlan.id.in_(test_plan_ids)))
        if environment_ids:
            await session.execute(delete(Environment).where(Environment.id.in_(environment_ids)))
        if release_ids:
            await session.execute(delete(Release).where(Release.id.in_(release_ids)))

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


# --- TC-PLAN-006: create a TestCycle, then read it straight back --------------------------------


@pytest.mark.asyncio
async def test_create_test_cycle_then_read_it_back() -> None:  # TC-PLAN-006
    """TC-PLAN-006 literally: "TestPlan + Release + Environment exist (same
    project)" -> "POST `/test-plans/{id}/test-cycles` with
    `release_id`/`environment_id`/`name`, then GET `/test-cycles/{id}`" ->
    "`201`, linked to both plan and release; the immediate GET succeeds (proves
    no resolver gap, `backend/CLAUDE.md`)".

    The create-then-immediate-read round trip is the whole point and is
    deliberately one test: a create-only assertion structurally cannot catch
    ADR-0029's class of bug, where the row inserts perfectly and only the
    *subsequent* read exposes a resolver with no branch for the new row shape.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcplan006")
            project = await _create_project(session, org, "tcplan006")
            plan = await _create_test_plan(session, project, admin.actor_id, "tcplan006")
            # "TestPlan + Release + Environment exist (same project)".
            release = await _create_release(session, project, "tcplan006")
            environment = await _create_environment(session, project, "tcplan006")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            admin_id, plan_id = admin.actor_id, plan.id
            release_id, environment_id = release.id, environment.id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        cycle_name = _unique_name("Cycle tcplan006")

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            created = await client.post(
                _plan_test_cycles_path(plan_id),
                headers=headers,
                json={
                    "release_id": str(release_id),
                    "environment_id": str(environment_id),
                    "name": cycle_name,
                    "start_date": "2026-09-07",
                    "end_date": "2026-09-21",
                },
            )
            assert created.status_code == 201, created.text
            body = created.json()
            # "linked to both plan and release" — asserted against the seeded ids.
            assert body["test_plan_id"] == str(plan_id), body
            assert body["release_id"] == str(release_id), body
            assert body["environment_id"] == str(environment_id), body
            assert body["name"] == cycle_name
            assert body["start_date"] == "2026-09-07"
            assert body["end_date"] == "2026-09-21"
            new_cycle_id = body["id"]

            # "then GET /test-cycles/{id}" — the immediate read-back.
            read_back = await client.get(_test_cycle_item_path(new_cycle_id), headers=headers)
            assert read_back.status_code == 200, (
                f"the immediate GET must succeed — a 404 here is the ADR-0029 "
                f"resolver-gap class, not a tenant boundary: {read_back.text}"
            )
            assert read_back.json() == body, "the read-back row must be the row just created"

        # And the row genuinely exists with the FKs the response claimed.
        row = await _test_cycle_row(new_cycle_id)
        assert row is not None
        assert row.test_plan_id == plan_id
        assert row.release_id == release_id
        assert row.environment_id == environment_id
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


# --- TC-PLAN-007: create the Environment inline, then the cycle ---------------------------------


@pytest.mark.asyncio
async def test_create_environment_inline_then_cycle_linked_to_it() -> None:  # TC-PLAN-007
    """TC-PLAN-007 literally: "Setting up a cycle, no environment yet" -> "POST
    `/environments` then POST `/test-plans/{id}/test-cycles` with the returned
    `environment_id` (sequential calls, ADR-0033)" -> "Environment created;
    cycle linked to it in the same flow".

    ADR-0033 Decision #4 deliberately kept this as two sequential calls rather
    than an atomic combined route (there is no atomicity property the two calls
    would lose — `environment_id` is a plain FK, not a link table), so the test
    is literally the two calls in that order, the second consuming the first's
    returned `id`.

    The precondition is honoured exactly: the project is seeded with a Release
    but **no** Environment at all, so the `environment_id` used below can only
    have come from the first call.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcplan007")
            project = await _create_project(session, org, "tcplan007")
            plan = await _create_test_plan(session, project, admin.actor_id, "tcplan007")
            release = await _create_release(session, project, "tcplan007")
            # Deliberately NO Environment seeded — "no environment yet".
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            admin_id, project_id, plan_id, release_id = (
                admin.actor_id,
                project.id,
                plan.id,
                release.id,
            )

        async with AsyncSessionLocal() as session:
            existing = await session.execute(
                select(Environment.id).where(Environment.project_id == project_id)
            )
            assert existing.all() == [], "precondition: the project must start with no Environment"

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        environment_name = _unique_name("Inline Env tcplan007")

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # Call 1: POST /environments.
            environment_response = await client.post(
                _environments_path(),
                headers=headers,
                json={
                    "project_id": str(project_id),
                    "name": environment_name,
                    "config_notes": "Created inline during cycle setup (TC-PLAN-007).",
                },
            )
            assert environment_response.status_code == 201, environment_response.text
            environment_body = environment_response.json()
            assert environment_body["project_id"] == str(project_id)
            assert environment_body["name"] == environment_name
            new_environment_id = environment_body["id"]

            # Call 2: the cycle create, consuming call 1's returned id.
            cycle_response = await client.post(
                _plan_test_cycles_path(plan_id),
                headers=headers,
                json={
                    "release_id": str(release_id),
                    "environment_id": new_environment_id,
                    "name": _unique_name("Cycle tcplan007"),
                },
            )
            assert cycle_response.status_code == 201, cycle_response.text
            cycle_body = cycle_response.json()

        # "cycle linked to it in the same flow".
        assert cycle_body["environment_id"] == new_environment_id, cycle_body
        row = await _test_cycle_row(cycle_body["id"])
        assert row is not None
        assert str(row.environment_id) == new_environment_id
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


# --- TC-PLAN-008: execution scope enforcement, both directions ---------------------------------


@pytest.mark.asyncio
async def test_execution_scope_enforced_in_both_directions() -> None:  # TC-PLAN-008
    """TC-PLAN-008 literally: "Two `TestCase`s: one IS a member of a suite
    included in the plan, one is NOT" -> "POST `/test-cycles/{id}/executions`
    for each `test_case_id`" -> "Covered case -> `201`; uncovered case ->
    `422`, never `404`; covered case's membership additionally confirmed
    against `GET /test-plans/{id}/test-cases`'s own result set".

    All three clauses live in this one test on purpose (Test Design §29): a
    scope check that always accepted — or always rejected — would each pass a
    test asserting only one direction.

    The uncovered case (`case_out`) sits in the **same project and same org** as
    the covered one, reached through the same ADR-0029 resolver branch, and
    belongs to a real `TestSuite` that simply is not included in this plan. That
    is what keeps the assertion on the `422` scope branch: if it resolved to a
    different org it would legitimately be `404` and the test would be proving
    nothing about scope at all.

    The third clause pins `execution_authoring._test_case_is_in_plan_scope`'s
    `EXISTS` join to `test_plan_membership.list_covered_test_cases`'s own join —
    two independently-written joins could silently diverge, and the failure mode
    is a `TestCase` the UI shows as covered being rejected as out-of-scope.
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
            admin, org = await _create_org_admin(session, "tcplan008")
            project = await _create_project(session, org, "tcplan008")
            requirement = await _create_requirement(session, project, "tcplan008")
            condition = await _create_test_condition(session, requirement, "tcplan008")
            level = await _create_test_level(session, "tcplan008")
            test_type = await _create_test_type(session, "tcplan008")

            case_in = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tcplan008-in"
            )
            case_out = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tcplan008-out"
            )

            plan = await _create_test_plan(session, project, admin.actor_id, "tcplan008")
            suite_included = await _create_test_suite(session, project, "tcplan008-in")
            suite_excluded = await _create_test_suite(session, project, "tcplan008-out")
            # Only `suite_included` is included in the plan.
            await _include_suite_in_plan(session, plan, suite_included)
            await _add_case_to_suite(session, suite_included, case_in)
            # `case_out` is a real member of a real suite — one this plan does
            # not include. Same project, same org, so it resolves fine and the
            # 404 branch cannot fire.
            await _add_case_to_suite(session, suite_excluded, case_out)

            release = await _create_release(session, project, "tcplan008")
            environment = await _create_environment(session, project, "tcplan008")
            cycle = await _create_test_cycle(session, plan, release, environment, "tcplan008")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case_in.id, case_out.id]
            test_suite_ids = [suite_included.id, suite_excluded.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            admin_id, plan_id, cycle_id = admin.actor_id, plan.id, cycle.id
            case_in_id, case_out_id = case_in.id, case_out.id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        executed_at = datetime.now(UTC).isoformat()

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # Direction 1 — the covered case.
            covered = await client.post(
                _cycle_executions_path(cycle_id),
                headers=headers,
                json={
                    "test_case_id": str(case_in_id),
                    "result": "pass",
                    "actual_result": "Behaved as expected.",
                    "executed_at": executed_at,
                },
            )
            assert covered.status_code == 201, covered.text
            covered_body = covered.json()
            assert covered_body["test_cycle_id"] == str(cycle_id)
            assert covered_body["test_case_id"] == str(case_in_id)
            assert covered_body["result"] == "pass"

            # Direction 2 — the uncovered case: 422, explicitly NOT 404.
            uncovered = await client.post(
                _cycle_executions_path(cycle_id),
                headers=headers,
                json={
                    "test_case_id": str(case_out_id),
                    "result": "pass",
                    "executed_at": executed_at,
                },
            )
            assert uncovered.status_code == 422, (
                f"an out-of-scope TestCase must be 422 (business rule), never 404 "
                f"(existence-hiding) — the caller already proved org membership: "
                f"{uncovered.text}"
            )
            assert uncovered.status_code != 404
            assert uncovered.json()["code"] == "validation_error", uncovered.text
            # Confirms it is the *scope* branch that fired, not the route's
            # generic IntegrityError -> 422 fallback.
            assert "scope" in uncovered.json()["message"].lower(), uncovered.text

            # Clause 3 — the covered case's membership confirmed against
            # PLAN-1's own coverage query result set.
            coverage = await client.get(_plan_test_cases_path(plan_id), headers=headers)
            assert coverage.status_code == 200, coverage.text
            coverage_ids = {item["id"] for item in coverage.json()["items"]}
            assert str(case_in_id) in coverage_ids, (
                "the accepted TestCase must appear in GET /test-plans/{id}/test-cases' "
                f"own result set — the two routes must share one join: {coverage.json()}"
            )
            assert str(case_out_id) not in coverage_ids

        # Exactly one execution row was written: the rejected POST wrote nothing.
        execution_ids = await _execution_ids_in_cycle(cycle_id)
        assert len(execution_ids) == 1, execution_ids
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


# --- TC-PLAN-015: cross-project release rejected ------------------------------------------------


@pytest.mark.asyncio
async def test_cross_project_release_rejected_with_422() -> None:  # TC-PLAN-015
    """TC-PLAN-015 literally: "Release in Project A; TestPlan in Project B (same
    org)" -> "POST `/test-plans/{B-plan.id}/test-cycles` with `release_id =
    A-release.id`" -> "`422 validation_error`, never `404` (caller already
    proved org membership)".

    Its own fixture, separate from TC-PLAN-016's, because the route checks
    `release_id` and `environment_id` in two independent `if` branches over two
    separate rows — a fix or regression scoped to only one field must not be
    able to pass the other's case.

    The `environment_id` sent here is a **valid same-project** Environment (in
    Project B), so the only thing under test is the release. Both projects are
    in the same org and the caller is `org_admin` of it, so a `404` would mean
    the tenant check fired instead of the project-match rule.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcplan015")
            project_a = await _create_project(session, org, "tcplan015-A")
            project_b = await _create_project(session, org, "tcplan015-B")
            # Release in Project A; TestPlan in Project B.
            release_a = await _create_release(session, project_a, "tcplan015-A")
            plan_b = await _create_test_plan(session, project_b, admin.actor_id, "tcplan015-B")
            # Valid, same-project Environment so only the release is wrong.
            environment_b = await _create_environment(session, project_b, "tcplan015-B")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project_a.id, project_b.id]
            admin_id, plan_b_id = admin.actor_id, plan_b.id
            release_a_id, environment_b_id = release_a.id, environment_b.id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _plan_test_cycles_path(plan_b_id),
                headers=headers,
                json={
                    "release_id": str(release_a_id),
                    "environment_id": str(environment_b_id),
                    "name": _unique_name("Cycle tcplan015"),
                },
            )

        assert response.status_code == 422, (
            f"a same-org cross-PROJECT release must be 422, never 404 — the caller "
            f"already proved org membership: {response.text}"
        )
        assert response.status_code != 404
        assert response.json()["code"] == "validation_error", response.text
        # It is the *release* branch that rejected this, not the environment's
        # (which was valid) nor the generic IntegrityError fallback.
        assert "release" in response.json()["message"].lower(), response.text
        assert await _cycle_ids_under_plan(plan_b_id) == set()
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


# --- TC-PLAN-016: cross-project environment rejected, independently -----------------------------


@pytest.mark.asyncio
async def test_cross_project_environment_rejected_with_422() -> None:  # TC-PLAN-016
    """TC-PLAN-016 literally: "Environment in Project A; TestPlan in Project B
    (same org)" -> "POST `/test-plans/{B-plan.id}/test-cycles` with
    `environment_id = A-environment.id`" -> "`422 validation_error`, never
    `404` — tested independently of TC-PLAN-015 (a fix scoped to only one of the
    two fields must not pass this case)".

    Deliberately a separate test function with its own fixture, per that
    "tested independently" clause. Here the mirror image of TC-PLAN-015's setup:
    the `release_id` is a **valid same-project** Release (Project B) and only
    the `environment_id` is cross-project.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcplan016")
            project_a = await _create_project(session, org, "tcplan016-A")
            project_b = await _create_project(session, org, "tcplan016-B")
            # Environment in Project A; TestPlan in Project B.
            environment_a = await _create_environment(session, project_a, "tcplan016-A")
            plan_b = await _create_test_plan(session, project_b, admin.actor_id, "tcplan016-B")
            # Valid, same-project Release so only the environment is wrong.
            release_b = await _create_release(session, project_b, "tcplan016-B")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project_a.id, project_b.id]
            admin_id, plan_b_id = admin.actor_id, plan_b.id
            environment_a_id, release_b_id = environment_a.id, release_b.id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _plan_test_cycles_path(plan_b_id),
                headers=headers,
                json={
                    "release_id": str(release_b_id),
                    "environment_id": str(environment_a_id),
                    "name": _unique_name("Cycle tcplan016"),
                },
            )

        assert response.status_code == 422, (
            f"a same-org cross-PROJECT environment must be 422, never 404, and must "
            f"be rejected by its own branch rather than the release's: {response.text}"
        )
        assert response.status_code != 404
        assert response.json()["code"] == "validation_error", response.text
        # The point of testing this field independently: the *environment*
        # branch must be the one that fired. The release was valid, so a
        # message naming the release would mean the two checks were collapsed
        # into one shared comparison.
        assert "environment" in response.json()["message"].lower(), response.text
        assert await _cycle_ids_under_plan(plan_b_id) == set()
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


# --- TC-PLAN-017: the generic TestExecution create route is gone, the rest is not ---------------


@pytest.mark.asyncio
async def test_generic_test_execution_create_route_removed_rest_unaffected() -> None:  # TC-PLAN-017
    """TC-PLAN-017 literally: "POST `/test-executions` (the pre-ADR-0033 generic
    factory route)" -> "No longer accepts `POST`; `GET`/`PATCH`/`DELETE
    /test-executions/{id}` and `GET /test-executions?test_cycle_id=`
    unaffected".

    Both halves matter equally: asserting only the `405` would pass just as well
    against an accidental blanket removal of the entity's whole router, which is
    exactly what the "unaffected" clause exists to rule out. The seeded
    `TestExecution` row is created directly via `AsyncSessionLocal` — with the
    generic `POST` gone, that is now the only way to obtain one outside the
    bespoke cycle-scoped route.

    `DELETE` is exercised last -- **updated for EXEC-2**: the `PATCH` above
    changes `result` (`pass` -> `fail`), which appends a `TestLog` row
    (`RESTRICT` FK on `test_execution_id`). `DELETE` is therefore still
    "unaffected" in the sense this TC cares about (the route is reachable,
    not accidentally removed along with generic `create`) but no longer
    consumes the row -- a `TestExecution` with any audit-trail entries can't
    actually be deleted once real logs exist (see
    `test_admin2_execution_trace.py`'s own note on the same consequence).
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
            admin, org = await _create_org_admin(session, "tcplan017")
            project = await _create_project(session, org, "tcplan017")
            requirement = await _create_requirement(session, project, "tcplan017")
            condition = await _create_test_condition(session, requirement, "tcplan017")
            level = await _create_test_level(session, "tcplan017")
            test_type = await _create_test_type(session, "tcplan017")
            case = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tcplan017"
            )
            plan = await _create_test_plan(session, project, admin.actor_id, "tcplan017")
            suite = await _create_test_suite(session, project, "tcplan017")
            await _include_suite_in_plan(session, plan, suite)
            await _add_case_to_suite(session, suite, case)
            release = await _create_release(session, project, "tcplan017")
            environment = await _create_environment(session, project, "tcplan017")
            cycle = await _create_test_cycle(session, plan, release, environment, "tcplan017")
            execution = await _create_test_execution(
                session, cycle, case, admin.actor_id, "tcplan017"
            )
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
            admin_id, cycle_id, case_id = admin.actor_id, cycle.id, case.id
            execution_id = execution.id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # "No longer accepts POST" — the path itself still exists (the list
            # route lives there), so FastAPI answers 405, not 404.
            removed = await client.post(
                _test_executions_path(),
                headers=headers,
                json={
                    "test_cycle_id": str(cycle_id),
                    "test_case_id": str(case_id),
                    "result": "pass",
                    "executed_at": datetime.now(UTC).isoformat(),
                },
            )
            assert removed.status_code == 405, (
                f"POST /test-executions must no longer be accepted (ADR-0033): {removed.text}"
            )

            # "...GET /test-executions/{id} ... unaffected".
            read = await client.get(_test_execution_item_path(execution_id), headers=headers)
            assert read.status_code == 200, read.text
            assert read.json()["id"] == str(execution_id)
            assert read.json()["result"] == "pass"

            # "...PATCH /test-executions/{id} ... unaffected".
            patched = await client.patch(
                _test_execution_item_path(execution_id),
                headers=headers,
                json={"result": "fail", "actual_result": "Edited via the surviving PATCH route."},
            )
            assert patched.status_code == 200, patched.text
            assert patched.json()["result"] == "fail"

            # "...GET /test-executions?test_cycle_id= unaffected".
            listed = await client.get(
                _test_executions_path(),
                headers=headers,
                params={"test_cycle_id": str(cycle_id)},
            )
            assert listed.status_code == 200, listed.text
            listed_body = listed.json()
            assert [item["id"] for item in listed_body["items"]] == [str(execution_id)], listed_body

            # "...DELETE /test-executions/{id} ... unaffected" — the route is
            # still reachable (not removed along with generic `create`), but
            # EXEC-2's `PATCH`-appended `TestLog` row above now blocks it from
            # actually succeeding (`RESTRICT` FK) — see this test's own
            # docstring.
            deleted = await client.delete(
                _test_execution_item_path(execution_id), headers=headers
            )
            assert deleted.status_code == 409, deleted.text
            assert deleted.json()["code"] == "restrict_blocked"

        assert await _execution_ids_in_cycle(cycle_id) == {execution_id}, (
            "the blocked DELETE must not have removed the row"
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


# --- Test Design §29: `executed_by_actor_id` stamping class -------------------------------------


@pytest.mark.asyncio
async def test_executed_by_actor_id_is_stamped_from_the_authenticated_caller() -> None:
    """§29's stamping class: "the response's `executed_by_actor_id` always
    equals the authenticated caller's own `actor_id`, regardless of any value
    the request body might attempt to supply for it".

    The request below deliberately carries a bogus `executed_by_actor_id` — a
    random UUID belonging to no actor at all. `CreateExecutionForCycleRequest`
    has no such field, so Pydantic ignores it rather than honoring it; a route
    that had (re)introduced the field would either stamp the wrong actor or
    fail the FK, both of which this assertion catches.
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
            admin, org = await _create_org_admin(session, "tcstamp")
            project = await _create_project(session, org, "tcstamp")
            requirement = await _create_requirement(session, project, "tcstamp")
            condition = await _create_test_condition(session, requirement, "tcstamp")
            level = await _create_test_level(session, "tcstamp")
            test_type = await _create_test_type(session, "tcstamp")
            case = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tcstamp"
            )
            plan = await _create_test_plan(session, project, admin.actor_id, "tcstamp")
            suite = await _create_test_suite(session, project, "tcstamp")
            await _include_suite_in_plan(session, plan, suite)
            await _add_case_to_suite(session, suite, case)
            release = await _create_release(session, project, "tcstamp")
            environment = await _create_environment(session, project, "tcstamp")
            cycle = await _create_test_cycle(session, plan, release, environment, "tcstamp")
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
            admin_id, cycle_id, case_id = admin.actor_id, cycle.id, case.id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        bogus_actor_id = str(uuid4())

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _cycle_executions_path(cycle_id),
                headers=headers,
                json={
                    "test_case_id": str(case_id),
                    "result": "blocked",
                    "executed_at": datetime.now(UTC).isoformat(),
                    # Not a field on the request schema — must be ignored.
                    "executed_by_actor_id": bogus_actor_id,
                },
            )

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["executed_by_actor_id"] == str(admin_id), (
            "executed_by_actor_id must be stamped from the authenticated caller, "
            f"not taken from the request body: {body}"
        )
        assert body["executed_by_actor_id"] != bogus_actor_id

        # The stored row agrees with the response, not with the body.
        async with AsyncSessionLocal() as session:
            row = await session.get(TestExecution, body["id"])
            assert row is not None
            assert row.executed_by_actor_id == admin_id
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


# --- Test Design §29: duplicate-name boundary (a positive case, not a conflict) -----------------


@pytest.mark.asyncio
async def test_duplicate_cycle_name_under_one_plan_is_two_201s_not_a_409() -> None:
    """§29's duplicate-name class: "two `TestCycle`s with the identical `name`
    under the same `TestPlan` -> both `201`, no `409` — no unique constraint
    exists on `(test_plan_id, name)`".

    Tested as an explicit positive case so a future accidental unique-constraint
    addition (or a copy-pasted `409` branch from ADR-0030/ADR-0031's membership
    routes, which *do* have one) is caught as a regression rather than
    discovered in production.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcdupname")
            project = await _create_project(session, org, "tcdupname")
            plan = await _create_test_plan(session, project, admin.actor_id, "tcdupname")
            release = await _create_release(session, project, "tcdupname")
            environment = await _create_environment(session, project, "tcdupname")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            admin_id, plan_id = admin.actor_id, plan.id
            release_id, environment_id = release.id, environment.id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        shared_name = _unique_name("Duplicate Cycle Name")
        payload = {
            "release_id": str(release_id),
            "environment_id": str(environment_id),
            "name": shared_name,
        }

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            first = await client.post(
                _plan_test_cycles_path(plan_id), headers=headers, json=payload
            )
            assert first.status_code == 201, first.text

            second = await client.post(
                _plan_test_cycles_path(plan_id), headers=headers, json=payload
            )
            assert second.status_code == 201, (
                f"an identical cycle name under the same plan is a plain 201 — there is "
                f"no unique constraint on (test_plan_id, name): {second.text}"
            )
            assert second.status_code != 409

        assert first.json()["name"] == second.json()["name"] == shared_name
        assert first.json()["id"] != second.json()["id"], "two distinct rows, not an upsert"
        assert len(await _cycle_ids_under_plan(plan_id)) == 2
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


# --- Test Design §29: cross-org 404 boundary on the cycle-create route --------------------------


@pytest.mark.asyncio
async def test_cross_org_test_plan_returns_404_on_cycle_create() -> None:
    """§29's cross-org 404 boundary: "A `TestPlan` itself belonging to a
    different org -> `404` on the whole route" (NFR-1/ADR-0007).

    The outsider is `org_admin` of their **own** org, so a `403` here would
    prove the tenant walk was skipped in favour of a bare permission check —
    that is the specific miscoding this class exists to catch.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_a, org_a = await _create_org_admin(session, "tcxorgplan-a")
            admin_b, org_b = await _create_org_admin(session, "tcxorgplan-b")
            project_a = await _create_project(session, org_a, "tcxorgplan-a")
            plan_a = await _create_test_plan(session, project_a, admin_a.actor_id, "tcxorgplan-a")
            release_a = await _create_release(session, project_a, "tcxorgplan-a")
            environment_a = await _create_environment(session, project_a, "tcxorgplan-a")
            await session.commit()
            user_ids = [admin_a.actor_id, admin_b.actor_id]
            org_ids = [org_a.id, org_b.id]
            project_ids = [project_a.id]
            outsider_id, plan_a_id = admin_b.actor_id, plan_a.id
            release_a_id, environment_a_id = release_a.id, environment_a.id

        headers = {"Authorization": f"Bearer {_access_token_for(outsider_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _plan_test_cycles_path(plan_a_id),
                headers=headers,
                json={
                    "release_id": str(release_a_id),
                    "environment_id": str(environment_a_id),
                    "name": _unique_name("Cycle tcxorgplan"),
                },
            )

        assert response.status_code == 404, (
            f"a cross-org TestPlan must be 404, never 403 — existence is not "
            f"confirmable across an org boundary: {response.text}"
        )
        assert response.status_code != 403
        assert response.json()["code"] == "not_found"
        assert await _cycle_ids_under_plan(plan_a_id) == set()
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


@pytest.mark.asyncio
async def test_cross_org_release_and_environment_return_404_not_the_cross_project_422() -> None:
    """§29's per-field cross-org boundary, and the NFR-1 distinction this story
    is most likely to miscode: "a `release_id`/`environment_id` that ... resolves
    to a different org than the caller's own `TestPlan` -> `404`".

    A different **project** in the same org is a `422` (TC-PLAN-015/016 above);
    a different **org** must be a `404`, indistinguishable from a nonexistent
    id. Getting `422` here would confirm the foreign row exists — an NFR-1 leak.
    Both fields are asserted, each with the *other* field valid and
    same-project, so neither arm can be satisfied by the other's branch.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_a, org_a = await _create_org_admin(session, "tcxorgfield-a")
            admin_b, org_b = await _create_org_admin(session, "tcxorgfield-b")
            # The caller's own org/project/plan, with valid same-project rows.
            project_a = await _create_project(session, org_a, "tcxorgfield-a")
            plan_a = await _create_test_plan(session, project_a, admin_a.actor_id, "tcxorgfield-a")
            release_a = await _create_release(session, project_a, "tcxorgfield-a")
            environment_a = await _create_environment(session, project_a, "tcxorgfield-a")
            # A foreign org's Release/Environment.
            project_b = await _create_project(session, org_b, "tcxorgfield-b")
            release_b = await _create_release(session, project_b, "tcxorgfield-b")
            environment_b = await _create_environment(session, project_b, "tcxorgfield-b")
            await session.commit()
            user_ids = [admin_a.actor_id, admin_b.actor_id]
            org_ids = [org_a.id, org_b.id]
            project_ids = [project_a.id, project_b.id]
            caller_id, plan_a_id = admin_a.actor_id, plan_a.id
            release_a_id, environment_a_id = release_a.id, environment_a.id
            release_b_id, environment_b_id = release_b.id, environment_b.id

        headers = {"Authorization": f"Bearer {_access_token_for(caller_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # Arm 1 — cross-ORG release, valid same-project environment.
            foreign_release = await client.post(
                _plan_test_cycles_path(plan_a_id),
                headers=headers,
                json={
                    "release_id": str(release_b_id),
                    "environment_id": str(environment_a_id),
                    "name": _unique_name("Cycle tcxorgfield-r"),
                },
            )
            assert foreign_release.status_code == 404, (
                f"a cross-ORG release must be 404 (existence-hiding), not the "
                f"cross-PROJECT 422: {foreign_release.text}"
            )
            assert foreign_release.status_code != 422
            assert foreign_release.json()["code"] == "not_found"
            assert "release" in foreign_release.json()["message"].lower(), foreign_release.text

            # Arm 2 — cross-ORG environment, valid same-project release.
            foreign_environment = await client.post(
                _plan_test_cycles_path(plan_a_id),
                headers=headers,
                json={
                    "release_id": str(release_a_id),
                    "environment_id": str(environment_b_id),
                    "name": _unique_name("Cycle tcxorgfield-e"),
                },
            )
            assert foreign_environment.status_code == 404, (
                f"a cross-ORG environment must be 404 (existence-hiding), not the "
                f"cross-PROJECT 422: {foreign_environment.text}"
            )
            assert foreign_environment.status_code != 422
            assert foreign_environment.json()["code"] == "not_found"
            assert "environment" in foreign_environment.json()["message"].lower(), (
                foreign_environment.text
            )

        assert await _cycle_ids_under_plan(plan_a_id) == set()
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


# --- Test Design §29: 403 with membership present, on both new routes ---------------------------


@pytest.mark.asyncio
async def test_cycle_create_without_permission_returns_403() -> None:
    """§29: "Membership present but missing `test_cycle.create` -> `403`" — the
    other half of the boundary (same-org callers DO get told it's a permission
    problem; only cross-org callers get the existence-hiding 404).

    The custom role grants an unrelated **real** permission (`test_case.read`),
    so a `403` proves the specific `test_cycle.create` gate fired rather than a
    blanket has-no-roles-at-all rejection.
    """
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc403cycle")
            project = await _create_project(session, org, "tc403cycle")
            plan = await _create_test_plan(session, project, admin.actor_id, "tc403cycle")
            release = await _create_release(session, project, "tc403cycle")
            environment = await _create_environment(session, project, "tc403cycle")
            member, custom_role = await _create_custom_role_member(
                session, "tc403cycle", org, ["test_case.read"]
            )
            await session.commit()
            user_ids = [admin.actor_id, member.actor_id]
            org_ids = [org.id]
            role_ids = [custom_role.id]
            project_ids = [project.id]
            member_id, plan_id = member.actor_id, plan.id
            release_id, environment_id = release.id, environment.id

        headers = {"Authorization": f"Bearer {_access_token_for(member_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _plan_test_cycles_path(plan_id),
                headers=headers,
                json={
                    "release_id": str(release_id),
                    "environment_id": str(environment_id),
                    "name": _unique_name("Cycle tc403cycle"),
                },
            )

        assert response.status_code == 403, response.text
        assert response.json()["code"] == "permission_denied"
        assert await _cycle_ids_under_plan(plan_id) == set()
    finally:
        await _cleanup(
            user_ids=user_ids, org_ids=org_ids, role_ids=role_ids, project_ids=project_ids
        )


@pytest.mark.asyncio
async def test_execution_create_without_permission_returns_403() -> None:
    """The same class on the executions route: membership present, but missing
    `test_execution.create` -> `403 permission_denied`.

    Asserted separately from the cycle route's own 403 because the two routes
    gate on two different permission codes via two separate `has_permission`
    calls — one being correct says nothing about the other.
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
            admin, org = await _create_org_admin(session, "tc403exec")
            project = await _create_project(session, org, "tc403exec")
            requirement = await _create_requirement(session, project, "tc403exec")
            condition = await _create_test_condition(session, requirement, "tc403exec")
            level = await _create_test_level(session, "tc403exec")
            test_type = await _create_test_type(session, "tc403exec")
            case = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tc403exec"
            )
            plan = await _create_test_plan(session, project, admin.actor_id, "tc403exec")
            suite = await _create_test_suite(session, project, "tc403exec")
            await _include_suite_in_plan(session, plan, suite)
            await _add_case_to_suite(session, suite, case)
            release = await _create_release(session, project, "tc403exec")
            environment = await _create_environment(session, project, "tc403exec")
            cycle = await _create_test_cycle(session, plan, release, environment, "tc403exec")
            member, custom_role = await _create_custom_role_member(
                session, "tc403exec", org, ["test_case.read"]
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
            member_id, cycle_id, case_id = member.actor_id, cycle.id, case.id

        headers = {"Authorization": f"Bearer {_access_token_for(member_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _cycle_executions_path(cycle_id),
                headers=headers,
                json={
                    "test_case_id": str(case_id),
                    "result": "pass",
                    "executed_at": datetime.now(UTC).isoformat(),
                },
            )

        assert response.status_code == 403, response.text
        assert response.json()["code"] == "permission_denied"
        assert await _execution_ids_in_cycle(cycle_id) == set()
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


# --- Test Design §29: cross-org TestCase on the executions route is 404, not 422 ----------------


@pytest.mark.asyncio
async def test_cross_org_test_case_on_executions_route_returns_404_not_422() -> None:
    """§29's `TestCase`-side cross-org boundary: "a `test_case_id` that ...
    resolves to a different org than the caller's `TestCycle` -> `404`".

    The distinction this class defends: an out-of-scope but same-org `TestCase`
    is `422` (TC-PLAN-008 above), while a cross-org one must be
    indistinguishable from a nonexistent id. Getting `422` here would confirm
    the foreign case exists — the NFR-1 leak. The `TestCycle` is one the caller
    genuinely CAN see, so the only foreign thing in the request is the case.
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
            admin_a, org_a = await _create_org_admin(session, "tcxorgcase-a")
            admin_b, org_b = await _create_org_admin(session, "tcxorgcase-b")
            # The caller's own org: a TestCycle they can see.
            project_a = await _create_project(session, org_a, "tcxorgcase-a")
            plan_a = await _create_test_plan(session, project_a, admin_a.actor_id, "tcxorgcase-a")
            suite_a = await _create_test_suite(session, project_a, "tcxorgcase-a")
            await _include_suite_in_plan(session, plan_a, suite_a)
            release_a = await _create_release(session, project_a, "tcxorgcase-a")
            environment_a = await _create_environment(session, project_a, "tcxorgcase-a")
            cycle_a = await _create_test_cycle(
                session, plan_a, release_a, environment_a, "tcxorgcase-a"
            )
            # A foreign org's TestCase.
            project_b = await _create_project(session, org_b, "tcxorgcase-b")
            requirement_b = await _create_requirement(session, project_b, "tcxorgcase-b")
            condition_b = await _create_test_condition(session, requirement_b, "tcxorgcase-b")
            level = await _create_test_level(session, "tcxorgcase")
            test_type = await _create_test_type(session, "tcxorgcase")
            foreign_case = await _create_condition_path_test_case(
                session, condition_b, admin_b.actor_id, level, test_type, "tcxorgcase"
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
            caller_id, cycle_a_id = admin_a.actor_id, cycle_a.id
            foreign_case_id = foreign_case.id

        headers = {"Authorization": f"Bearer {_access_token_for(caller_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _cycle_executions_path(cycle_a_id),
                headers=headers,
                json={
                    "test_case_id": str(foreign_case_id),
                    "result": "fail",
                    "executed_at": datetime.now(UTC).isoformat(),
                },
            )

        assert response.status_code == 404, (
            f"a cross-ORG TestCase must be 404 (existence-hiding), not the "
            f"out-of-scope 422: {response.text}"
        )
        assert response.status_code != 422
        assert response.json()["code"] == "not_found"
        assert await _execution_ids_in_cycle(cycle_a_id) == set()
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


# --- Test Design §29: the `test_manager` RBAC-bundle-extension class ----------------------------


@pytest.mark.asyncio
async def test_test_manager_can_create_environment_cycle_and_execution() -> None:
    """§29's `test_manager` bundle-extension class — the single class that would
    catch migration `e5b21d7c8f40` silently failing to apply.

    `test_manager` has held full `test_cycle` CRUD since RBAC-4, but held
    **none** of `environment.*` and neither `test_execution.create` nor
    `.read` before ADR-0033. Without that migration, Priya (the story's own
    narrator persona) 403s on her own flow. So the whole PLAN-3 path is walked
    end to end by a `test_manager`-only actor:

    (a) `POST /environments` -> `201`   (needs the new `environment.create`)
    (b) `POST /test-plans/{id}/test-cycles` -> `201` (pre-existing `test_cycle.create`,
        consuming (a)'s Environment — TC-PLAN-007's flow, as this persona lives it)
    (c) `POST /test-cycles/{id}/executions` -> `201` (needs the new `test_execution.create`)

    The `select(Role.name)` guard below asserts the actor genuinely holds
    nothing but `test_manager` — exactly as
    `test_req4_test_suite_membership.py::test_test_manager_can_add_and_remove_suite_membership`
    does — so no `org_admin` grant can quietly satisfy any of the three.
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
            admin, org = await _create_org_admin(session, "tcmgr-plan3")
            project = await _create_project(session, org, "tcmgr-plan3")
            requirement = await _create_requirement(session, project, "tcmgr-plan3")
            condition = await _create_test_condition(session, requirement, "tcmgr-plan3")
            level = await _create_test_level(session, "tcmgr-plan3")
            test_type = await _create_test_type(session, "tcmgr-plan3")
            case = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tcmgr-plan3"
            )
            plan = await _create_test_plan(session, project, admin.actor_id, "tcmgr-plan3")
            suite = await _create_test_suite(session, project, "tcmgr-plan3")
            await _include_suite_in_plan(session, plan, suite)
            await _add_case_to_suite(session, suite, case)
            release = await _create_release(session, project, "tcmgr-plan3")
            manager = await _create_member_with_role(
                session, "tcmgr-plan3-m", org, "test_manager"
            )
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
            manager_id, project_id, plan_id = manager.actor_id, project.id, plan.id
            release_id, case_id = release.id, case.id

        # Guard: the actor genuinely holds no role other than test_manager.
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
            # (a) environment.create — a brand-new grant in e5b21d7c8f40.
            environment_response = await client.post(
                _environments_path(),
                headers=headers,
                json={
                    "project_id": str(project_id),
                    "name": _unique_name("Env tcmgr-plan3"),
                },
            )
            assert environment_response.status_code == 201, (
                "test_manager must hold environment.create — a 403 here means "
                f"migration e5b21d7c8f40 has not applied: {environment_response.text}"
            )
            new_environment_id = environment_response.json()["id"]

            # (b) test_cycle.create — held since RBAC-4, asserted so the flow is
            # continuous rather than three unrelated calls.
            cycle_response = await client.post(
                _plan_test_cycles_path(plan_id),
                headers=headers,
                json={
                    "release_id": str(release_id),
                    "environment_id": new_environment_id,
                    "name": _unique_name("Cycle tcmgr-plan3"),
                },
            )
            assert cycle_response.status_code == 201, cycle_response.text
            new_cycle_id = cycle_response.json()["id"]
            assert cycle_response.json()["environment_id"] == new_environment_id

            # (c) test_execution.create — the other brand-new grant.
            execution_response = await client.post(
                _cycle_executions_path(new_cycle_id),
                headers=headers,
                json={
                    "test_case_id": str(case_id),
                    "result": "pass",
                    "executed_at": datetime.now(UTC).isoformat(),
                },
            )
            assert execution_response.status_code == 201, (
                "test_manager must hold test_execution.create — a 403 here means "
                f"migration e5b21d7c8f40 has not applied: {execution_response.text}"
            )
            assert execution_response.json()["executed_by_actor_id"] == str(manager_id)

        assert len(await _execution_ids_in_cycle(new_cycle_id)) == 1
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
