"""Integration tests for `POST`/`GET /projects/{project_id}/releases`,
`GET /releases/{id}`, `GET /releases/{id}/test-cycles` (PROJ-2, ADR-0019).

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), matching `test_projects.py`'s established style. The
package-level `tests/integration/conftest.py` fixture (`_require_live_server`,
autouse=True, session-scoped) applies automatically to this module too.

Covers TC-PROJ-004, 005, 014, 015, 016, 017 from
`docs/test-cases/2026-09-03-test-cases.md`.

Each test seeds its own `User`/`Organization`/`OrgMembership`/
`RoleAssignment`/`Project`/`Release` (and, where the test needs it,
`TestLevel`/`TestType`/`TestCase`/`TestPlan`/`Environment`/`TestCycle`/
`TestExecution` — none of which have a create route of their own yet, so
they're seeded directly via `AsyncSessionLocal`, same fixture-seeding
precedent `test_projects.py` established for RBAC data) and cleans up in a
`finally` block. Emails/org slugs/names are unique per test.
"""

import os
from datetime import UTC, date, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, select

from app.core.security import create_access_token, hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import TestCase, TestCaseStatus
from app.models.auth import AuthIdentity, AuthProvider
from app.models.execution import TestExecution, TestExecutionResult
from app.models.planning import Environment, TestCycle, TestPlan, TestPlanStatus
from app.models.project import Project, Release
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


def _releases_path(project_id) -> str:
    return f"{API_PREFIX}/projects/{project_id}/releases"


def _release_path(release_id) -> str:
    return f"{API_PREFIX}/releases/{release_id}"


def _release_test_cycles_path(release_id) -> str:
    return f"{API_PREFIX}/releases/{release_id}/test-cycles"


# --- seeding / cleanup helpers ---------------------------------------------------------------
# Mirrors test_projects.py's helpers of the same names/shapes, extended with
# the Release/TestCycle/TestExecution chain this story's own routes need.


def _unique_email(tag: str) -> str:
    return f"proj2-{tag}-{uuid4().hex[:8]}@example.com"


def _unique_slug(tag: str) -> str:
    return f"proj2-{tag}-{uuid4().hex[:8]}"


def _unique_name(tag: str) -> str:
    return f"PROJ-2 {tag} {uuid4().hex[:8]}"


async def _create_user(session, email: str, password: str = DEFAULT_PASSWORD) -> User:
    user = User(name="PROJ-2 Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()  # populate user.actor_id (joined-table inheritance PK/FK)
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"PROJ-2 Test Org {slug_prefix}", slug=_unique_slug(slug_prefix))
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


async def _create_custom_role_member(session, tag: str, org: Organization, permission_codes: list[str]) -> tuple[User, Role]:
    """Seed a human User with an active `OrgMembership` in `org` and a
    bespoke, org-scoped `Role` (NOT one of the 5 system roles) granting
    exactly `permission_codes` — used for TC-PROJ-015's exactly-2-of-3
    triple-gate sub-cases, where no existing system role's bundle shape
    fits.
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


async def _create_release(session, project: Project, tag: str, target_date: date | None = None) -> Release:
    release = Release(project_id=project.id, version_label=f"v-{tag}-{uuid4().hex[:6]}", target_date=target_date)
    session.add(release)
    await session.flush()
    return release


async def _create_test_level(session, tag: str) -> TestLevel:
    level = TestLevel(name=f"PROJ-2 Level {tag} {uuid4().hex[:8]}")
    session.add(level)
    await session.flush()
    return level


async def _create_test_type(session, tag: str) -> TestType:
    test_type = TestType(name=f"PROJ-2 Type {tag} {uuid4().hex[:8]}")
    session.add(test_type)
    await session.flush()
    return test_type


async def _create_test_case(session, actor_id, test_level: TestLevel, test_type: TestType, tag: str) -> TestCase:
    test_case = TestCase(
        test_level_id=test_level.id,
        test_type_id=test_type.id,
        created_by_actor_id=actor_id,
        title=f"PROJ-2 Test Case {tag}",
        status=TestCaseStatus.draft,
    )
    session.add(test_case)
    await session.flush()
    return test_case


async def _create_test_plan(session, project: Project, actor_id, tag: str) -> TestPlan:
    plan = TestPlan(
        project_id=project.id,
        created_by_actor_id=actor_id,
        identifier=f"PROJ-2-PLAN-{tag}-{uuid4().hex[:6]}",
        status=TestPlanStatus.draft,
    )
    session.add(plan)
    await session.flush()
    return plan


async def _create_environment(session, project: Project, tag: str) -> Environment:
    environment = Environment(project_id=project.id, name=f"PROJ-2 Env {tag} {uuid4().hex[:6]}")
    session.add(environment)
    await session.flush()
    return environment


async def _create_test_cycle(
    session,
    test_plan: TestPlan,
    release: Release,
    environment: Environment,
    tag: str,
    start_date: date | None = None,
    end_date: date | None = None,
) -> TestCycle:
    cycle = TestCycle(
        test_plan_id=test_plan.id,
        release_id=release.id,
        environment_id=environment.id,
        name=f"PROJ-2 Cycle {tag}",
        start_date=start_date,
        end_date=end_date,
    )
    session.add(cycle)
    await session.flush()
    return cycle


async def _create_test_execution(
    session,
    test_cycle: TestCycle,
    test_case: TestCase,
    executed_by_actor_id,
    result: TestExecutionResult = TestExecutionResult.passed,
) -> TestExecution:
    execution = TestExecution(
        test_cycle_id=test_cycle.id,
        test_case_id=test_case.id,
        executed_by_actor_id=executed_by_actor_id,
        result=result,
        executed_at=datetime.now(UTC),
    )
    session.add(execution)
    await session.flush()
    return execution


async def _cleanup(
    *,
    emails: list[str] | None = None,
    user_ids: list | None = None,
    org_ids: list | None = None,
    role_ids: list | None = None,
    project_ids: list | None = None,
    release_ids: list | None = None,
    test_execution_ids: list | None = None,
    test_cycle_ids: list | None = None,
    test_case_ids: list | None = None,
    test_plan_ids: list | None = None,
    environment_ids: list | None = None,
    test_level_ids: list | None = None,
    test_type_ids: list | None = None,
) -> None:
    """Delete everything a test may have created, in FK-safe order.

    Extends `test_projects.py`'s `_cleanup` with the Release/TestCycle/
    TestExecution/TestCase/TestPlan/Environment/TestLevel/TestType chain
    this story's own fixtures populate. Never deletes RBAC-4's seeded
    catalog `Role`/`Permission` rows (e.g. `org_admin`, `test_manager`) —
    only bespoke `Role` rows a test created itself via `role_ids`.
    """
    emails = emails or []
    user_ids = list(user_ids or [])
    org_ids = org_ids or []
    role_ids = role_ids or []
    project_ids = project_ids or []
    release_ids = release_ids or []
    test_execution_ids = test_execution_ids or []
    test_cycle_ids = test_cycle_ids or []
    test_case_ids = test_case_ids or []
    test_plan_ids = test_plan_ids or []
    environment_ids = environment_ids or []
    test_level_ids = test_level_ids or []
    test_type_ids = test_type_ids or []

    async with AsyncSessionLocal() as session:
        if emails:
            result = await session.execute(select(User.actor_id).where(User.email.in_(emails)))
            user_ids.extend(row[0] for row in result.all() if row[0] not in user_ids)

        if test_execution_ids:
            await session.execute(delete(TestExecution).where(TestExecution.id.in_(test_execution_ids)))
        if test_cycle_ids:
            await session.execute(delete(TestCycle).where(TestCycle.id.in_(test_cycle_ids)))
        if test_case_ids:
            await session.execute(delete(TestCase).where(TestCase.id.in_(test_case_ids)))
        if test_plan_ids:
            await session.execute(delete(TestPlan).where(TestPlan.id.in_(test_plan_ids)))
        if environment_ids:
            await session.execute(delete(Environment).where(Environment.id.in_(environment_ids)))
        if test_level_ids:
            await session.execute(delete(TestLevel).where(TestLevel.id.in_(test_level_ids)))
        if test_type_ids:
            await session.execute(delete(TestType).where(TestType.id.in_(test_type_ids)))
        if release_ids:
            await session.execute(delete(Release).where(Release.id.in_(release_ids)))
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


# --- TC-PROJ-004: create -> 201, scoped to project_id -----------------------------------------


@pytest.mark.asyncio
async def test_create_release_returns_201_scoped_to_project() -> None:  # TC-PROJ-004
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    release_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc004")
            project = await _create_project(session, org, "tc004")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            admin_id, project_id = admin.actor_id, project.id

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.post(
                _releases_path(project_id),
                json={"version_label": "2.3.0", "target_date": "2026-12-01"},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 201
        body = response.json()
        assert body["version_label"] == "2.3.0"
        assert body["project_id"] == str(project_id)
        assert body["target_date"] == "2026-12-01"
        assert "id" in body
        release_ids = [body["id"]]
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, release_ids=release_ids)


# --- TC-PROJ-005: query cycles for a release, nested executions per cycle ---------------------


@pytest.mark.asyncio
async def test_get_release_test_cycles_returns_cycles_with_nested_executions() -> None:  # TC-PROJ-005
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    release_ids: list = []
    test_execution_ids: list = []
    test_cycle_ids: list = []
    test_case_ids: list = []
    test_plan_ids: list = []
    environment_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc005")
            project = await _create_project(session, org, "tc005")
            release = await _create_release(session, project, "tc005")
            level = await _create_test_level(session, "tc005")
            test_type = await _create_test_type(session, "tc005")
            test_case_a = await _create_test_case(session, admin.actor_id, level, test_type, "tc005-a")
            test_case_b = await _create_test_case(session, admin.actor_id, level, test_type, "tc005-b")
            plan = await _create_test_plan(session, project, admin.actor_id, "tc005")
            environment = await _create_environment(session, project, "tc005")

            cycle_1 = await _create_test_cycle(session, plan, release, environment, "tc005-1")
            cycle_2 = await _create_test_cycle(session, plan, release, environment, "tc005-2")

            execution_1a = await _create_test_execution(
                session, cycle_1, test_case_a, admin.actor_id, TestExecutionResult.passed
            )
            execution_1b = await _create_test_execution(
                session, cycle_1, test_case_b, admin.actor_id, TestExecutionResult.fail
            )
            execution_2a = await _create_test_execution(
                session, cycle_2, test_case_a, admin.actor_id, TestExecutionResult.blocked
            )

            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            release_ids = [release.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            test_case_ids = [test_case_a.id, test_case_b.id]
            test_plan_ids = [plan.id]
            environment_ids = [environment.id]
            test_cycle_ids = [cycle_1.id, cycle_2.id]
            test_execution_ids = [execution_1a.id, execution_1b.id, execution_2a.id]

            admin_id, release_id = admin.actor_id, release.id
            cycle_1_id, cycle_2_id = cycle_1.id, cycle_2.id

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                _release_test_cycles_path(release_id),
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 200
        body = response.json()
        assert len(body) == 2

        by_id = {cycle["id"]: cycle for cycle in body}
        assert set(by_id.keys()) == {str(cycle_1_id), str(cycle_2_id)}

        cycle_1_body = by_id[str(cycle_1_id)]
        cycle_2_body = by_id[str(cycle_2_id)]
        assert len(cycle_1_body["executions"]) == 2
        assert len(cycle_2_body["executions"]) == 1
        # Nested, not flat-merged: cycle_2's single execution must not leak
        # into cycle_1's list or vice versa.
        cycle_1_results = {execution["result"] for execution in cycle_1_body["executions"]}
        assert cycle_1_results == {"pass", "fail"}
        cycle_2_results = {execution["result"] for execution in cycle_2_body["executions"]}
        assert cycle_2_results == {"blocked"}
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            release_ids=release_ids,
            test_execution_ids=test_execution_ids,
            test_cycle_ids=test_cycle_ids,
            test_case_ids=test_case_ids,
            test_plan_ids=test_plan_ids,
            environment_ids=environment_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


@pytest.mark.asyncio
async def test_get_release_test_cycles_empty_returns_200_empty_list() -> None:  # TC-PROJ-005 edge case
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    release_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc005empty")
            project = await _create_project(session, org, "tc005empty")
            release = await _create_release(session, project, "tc005empty")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            release_ids = [release.id]
            admin_id, release_id = admin.actor_id, release.id

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                _release_test_cycles_path(release_id),
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 200
        assert response.json() == []
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, release_ids=release_ids)


# --- TC-PROJ-014: sortable by target_date, NULLS LAST both directions -------------------------


@pytest.mark.asyncio
async def test_list_releases_sorted_by_target_date_nulls_last_both_directions() -> None:  # TC-PROJ-014
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    release_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc014")
            project = await _create_project(session, org, "tc014")

            release_early = await _create_release(session, project, "tc014-early", target_date=date(2026, 1, 1))
            release_mid = await _create_release(session, project, "tc014-mid", target_date=date(2026, 6, 1))
            release_late = await _create_release(session, project, "tc014-late", target_date=date(2026, 12, 1))
            release_null = await _create_release(session, project, "tc014-null", target_date=None)

            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            release_ids = [release_early.id, release_mid.id, release_late.id, release_null.id]
            admin_id, project_id = admin.actor_id, project.id

        access_token = _access_token_for(admin_id)
        headers = {"Authorization": f"Bearer {access_token}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            asc_response = await client.get(
                _releases_path(project_id),
                params={"sort": "target_date", "order": "asc"},
                headers=headers,
            )
            desc_response = await client.get(
                _releases_path(project_id),
                params={"sort": "target_date", "order": "desc"},
                headers=headers,
            )

        assert asc_response.status_code == 200
        asc_ids = [item["id"] for item in asc_response.json()["items"]]
        assert asc_ids == [
            str(release_early.id),
            str(release_mid.id),
            str(release_late.id),
            str(release_null.id),
        ]

        assert desc_response.status_code == 200
        desc_ids = [item["id"] for item in desc_response.json()["items"]]
        assert desc_ids == [
            str(release_late.id),
            str(release_mid.id),
            str(release_early.id),
            str(release_null.id),
        ]
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, release_ids=release_ids)


# --- TC-PROJ-015: test-cycles query triple-permission gate, exactly 2-of-3 -> 403 --------------


@pytest.mark.asyncio
async def test_test_cycles_triple_gate_403_when_missing_release_read() -> None:  # TC-PROJ-015 (1/3)
    await _assert_triple_gate_403_missing(
        "tc015a", missing="release.read", held=["test_cycle.read", "test_execution.read"]
    )


@pytest.mark.asyncio
async def test_test_cycles_triple_gate_403_when_missing_test_cycle_read() -> None:  # TC-PROJ-015 (2/3)
    await _assert_triple_gate_403_missing(
        "tc015b", missing="test_cycle.read", held=["release.read", "test_execution.read"]
    )


@pytest.mark.asyncio
async def test_test_cycles_triple_gate_403_when_missing_test_execution_read() -> None:  # TC-PROJ-015 (3/3)
    await _assert_triple_gate_403_missing(
        "tc015c", missing="test_execution.read", held=["release.read", "test_cycle.read"]
    )


async def _assert_triple_gate_403_missing(tag: str, *, missing: str, held: list[str]) -> None:
    """Shared body for TC-PROJ-015's 3 sub-cases: an actor holding exactly 2
    of {release.read, test_cycle.read, test_execution.read} must get 403 on
    `GET /releases/{id}/test-cycles`, never a partial/degraded 200.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    release_ids: list = []
    role_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, tag)
            project = await _create_project(session, org, tag)
            release = await _create_release(session, project, tag)
            member, custom_role = await _create_custom_role_member(session, tag, org, held)
            await session.commit()
            user_ids = [admin.actor_id, member.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            release_ids = [release.id]
            role_ids = [custom_role.id]
            member_id, release_id = member.actor_id, release.id

        access_token = _access_token_for(member_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                _release_test_cycles_path(release_id),
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 403, f"missing={missing!r} held={held!r}"
        assert response.json()["code"] == "permission_denied"
    finally:
        await _cleanup(
            user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, release_ids=release_ids, role_ids=role_ids
        )


# --- TC-PROJ-016: cross-org 404 on Release routes ----------------------------------------------


@pytest.mark.asyncio
async def test_cross_org_get_release_and_test_cycles_return_404() -> None:  # TC-PROJ-016 / TC-RBAC-002
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    release_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_a, org_a = await _create_org_admin(session, "tc016a")
            admin_b, org_b = await _create_org_admin(session, "tc016b")
            project = await _create_project(session, org_a, "tc016")
            release = await _create_release(session, project, "tc016")
            await session.commit()
            user_ids = [admin_a.actor_id, admin_b.actor_id]
            org_ids = [org_a.id, org_b.id]
            project_ids = [project.id]
            release_ids = [release.id]
            admin_b_id, release_id = admin_b.actor_id, release.id

        token_b = _access_token_for(admin_b_id)
        headers = {"Authorization": f"Bearer {token_b}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            get_response = await client.get(_release_path(release_id), headers=headers)
            assert get_response.status_code == 404
            assert get_response.json()["code"] == "not_found"

            cycles_response = await client.get(_release_test_cycles_path(release_id), headers=headers)
            assert cycles_response.status_code == 404
            assert cycles_response.json()["code"] == "not_found"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, release_ids=release_ids)


# --- TC-PROJ-017: test_manager can create/list Releases without org_admin ----------------------


@pytest.mark.asyncio
async def test_test_manager_can_create_and_list_releases_without_org_admin() -> None:  # TC-PROJ-017
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    release_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tc017")
            project = await _create_project(session, org, "tc017")
            # Actor holds ONLY test_manager, org-wide -- no org_admin RoleAssignment anywhere.
            manager = await _create_member_with_role(session, "tc017-manager", org, "test_manager")
            await session.commit()
            user_ids = [admin.actor_id, manager.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            manager_id, project_id = manager.actor_id, project.id

        access_token = _access_token_for(manager_id)
        headers = {"Authorization": f"Bearer {access_token}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            create_response = await client.post(
                _releases_path(project_id),
                json={"version_label": "2.3.0-tc017"},
                headers=headers,
            )
            assert create_response.status_code == 201
            release_ids = [create_response.json()["id"]]

            list_response = await client.get(_releases_path(project_id), headers=headers)
            assert list_response.status_code == 200
            body = list_response.json()
            assert any(item["id"] == release_ids[0] for item in body["items"])
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, release_ids=release_ids)
