"""Integration tests for ADR-0025's backend completion: `TestExecution` full
CRUD, `TestLog` read-only, 2 of the 4 traceability link tables, and
`GET /orgs/{org_id}/permissions/mine`.

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), matching `test_admin2_crud.py`'s established style —
the package-level `tests/integration/conftest.py` fixture
(`_require_live_server`, autouse=True, session-scoped) applies automatically
here too. Entity-seeding helpers for `Requirement`/`TestCondition`/
`TestCase`/taxonomy/`Project`/`org_admin`/member-with-role are imported
directly from `test_admin2_crud.py` rather than duplicated (same
`_access_token_for`/`_unique_*` shape); this module adds its own helpers for
the entities `test_admin2_crud.py` doesn't already seed (`TestPlan`,
`TestCycle`, `Release`, `Environment`, `TestExecution`, `TestLog`, the link
tables).

Each test seeds its own rows directly via `AsyncSessionLocal` and cleans up
in a `finally` block. Emails/org slugs/lookup-table names are unique per
test.
"""

from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.execution import TestExecution, TestExecutionResult, TestLog, TestLogEventType
from app.models.planning import Environment, TestCycle, TestPlan
from app.models.project import Release
from app.models.rbac import RoleAssignment
from app.models.tenancy import OrgMembership, OrgMembershipStatus
from app.models.trace import RequirementTestCaseLink, TestConditionTestCaseLink
from tests.integration.test_admin2_crud import (
    API_PREFIX,
    TEST_API_BASE_URL,
    _access_token_for,
    _assign_role,
    _create_org_admin,
    _create_project,
    _create_requirement,
    _create_taxonomy_pair,
    _create_test_case,
    _create_test_condition,
    _create_user,
    _get_role_by_name,
    _unique_name,
)
from tests.integration.test_admin2_crud import _cleanup as _crud_cleanup

# --- seeding helpers this module adds on top of test_admin2_crud.py's own ----------------------


async def _create_test_plan(session, project, created_by, tag: str) -> TestPlan:
    plan = TestPlan(project_id=project.id, created_by_actor_id=created_by, identifier=_unique_name(f"plan-{tag}"))
    session.add(plan)
    await session.flush()
    return plan


async def _create_environment_row(session, project, tag: str) -> Environment:
    env = Environment(project_id=project.id, name=_unique_name(f"env-{tag}"))
    session.add(env)
    await session.flush()
    return env


async def _create_release(session, project, tag: str) -> Release:
    release = Release(project_id=project.id, version_label=_unique_name(f"release-{tag}"))
    session.add(release)
    await session.flush()
    return release


async def _create_test_cycle(session, *, test_plan, release, environment, tag: str) -> TestCycle:
    cycle = TestCycle(
        test_plan_id=test_plan.id,
        release_id=release.id,
        environment_id=environment.id,
        name=_unique_name(f"cycle-{tag}"),
    )
    session.add(cycle)
    await session.flush()
    return cycle


async def _create_test_execution(session, *, test_cycle, test_case, executed_by, tag: str) -> TestExecution:
    execution = TestExecution(
        test_cycle_id=test_cycle.id,
        test_case_id=test_case.id,
        executed_by_actor_id=executed_by,
        result=TestExecutionResult.passed,
        executed_at=datetime.now(UTC),
    )
    session.add(execution)
    await session.flush()
    return execution


async def _cleanup_extra(
    *,
    test_log_ids: list | None = None,
    test_execution_ids: list | None = None,
    test_cycle_ids: list | None = None,
    release_ids: list | None = None,
    environment_ids: list | None = None,
    link_ids: dict | None = None,
) -> None:
    """Delete this module's own extra entities, child-first, before
    `test_admin2_crud._cleanup` handles the shared ones."""
    async with AsyncSessionLocal() as session:
        if link_ids:
            if link_ids.get("requirement_test_case_link"):
                await session.execute(
                    delete(RequirementTestCaseLink).where(
                        RequirementTestCaseLink.id.in_(link_ids["requirement_test_case_link"])
                    )
                )
            if link_ids.get("test_condition_test_case_link"):
                await session.execute(
                    delete(TestConditionTestCaseLink).where(
                        TestConditionTestCaseLink.id.in_(link_ids["test_condition_test_case_link"])
                    )
                )
        if test_log_ids:
            await session.execute(delete(TestLog).where(TestLog.id.in_(test_log_ids)))
        if test_execution_ids:
            await session.execute(delete(TestExecution).where(TestExecution.id.in_(test_execution_ids)))
        if test_cycle_ids:
            await session.execute(delete(TestCycle).where(TestCycle.id.in_(test_cycle_ids)))
        if release_ids:
            await session.execute(delete(Release).where(Release.id.in_(release_ids)))
        if environment_ids:
            await session.execute(delete(Environment).where(Environment.id.in_(environment_ids)))
        await session.commit()


# --- TestExecution: full CRUD happy path + cross-org 404 ---------------------------------------


@pytest.mark.asyncio
async def test_test_execution_full_crud_happy_path() -> None:
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    test_plan_ids: list = []
    test_cycle_ids: list = []
    release_ids: list = []
    environment_ids: list = []
    test_execution_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "exec-crud")
            project = await _create_project(session, org, "exec-crud")
            requirement = await _create_requirement(session, project, "exec-crud")
            condition = await _create_test_condition(session, requirement, "exec-crud")
            level, type_ = await _create_taxonomy_pair(session, "exec-crud")
            case = await _create_test_case(
                session, test_condition=condition, test_level=level, test_type=type_,
                created_by=admin.actor_id, tag="exec-crud",
            )
            plan = await _create_test_plan(session, project, admin.actor_id, "exec-crud")
            release = await _create_release(session, project, "exec-crud")
            environment = await _create_environment_row(session, project, "exec-crud")
            cycle = await _create_test_cycle(
                session, test_plan=plan, release=release, environment=environment, tag="exec-crud"
            )
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_level_ids = [level.id]
            test_type_ids = [type_.id]
            test_plan_ids = [plan.id]
            release_ids = [release.id]
            environment_ids = [environment.id]
            test_cycle_ids = [cycle.id]
            token = _access_token_for(admin.actor_id)
            cycle_id, case_id = cycle.id, case.id

        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            create_response = await client.post(
                f"{API_PREFIX}/test-executions",
                json={
                    "test_cycle_id": str(cycle_id),
                    "test_case_id": str(case_id),
                    "result": "pass",
                    "executed_at": datetime.now(UTC).isoformat(),
                },
                headers=headers,
            )
            assert create_response.status_code == 201, create_response.text
            execution_id = create_response.json()["id"]
            test_execution_ids = [execution_id]

            get_response = await client.get(f"{API_PREFIX}/test-executions/{execution_id}", headers=headers)
            assert get_response.status_code == 200
            assert get_response.json()["result"] == "pass"

            list_response = await client.get(
                f"{API_PREFIX}/test-executions", params={"test_cycle_id": str(cycle_id)}, headers=headers
            )
            assert list_response.status_code == 200
            assert list_response.json()["total"] >= 1

            patch_response = await client.patch(
                f"{API_PREFIX}/test-executions/{execution_id}",
                json={"result": "fail", "actual_result": "it broke"},
                headers=headers,
            )
            assert patch_response.status_code == 200
            assert patch_response.json()["result"] == "fail"

            delete_response = await client.delete(f"{API_PREFIX}/test-executions/{execution_id}", headers=headers)
            assert delete_response.status_code == 204
            test_execution_ids = []  # already gone

            get_after_delete = await client.get(f"{API_PREFIX}/test-executions/{execution_id}", headers=headers)
            assert get_after_delete.status_code == 404
    finally:
        await _cleanup_extra(
            test_execution_ids=test_execution_ids,
            test_cycle_ids=test_cycle_ids,
            release_ids=release_ids,
            environment_ids=environment_ids,
        )
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
            test_plan_ids=test_plan_ids,
        )


@pytest.mark.asyncio
async def test_test_execution_cross_org_404() -> None:
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    test_plan_ids: list = []
    test_cycle_ids: list = []
    release_ids: list = []
    environment_ids: list = []
    test_execution_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_a, org_a = await _create_org_admin(session, "exec-404-a")
            admin_b, _org_b = await _create_org_admin(session, "exec-404-b")
            project = await _create_project(session, org_a, "exec-404")
            requirement = await _create_requirement(session, project, "exec-404")
            condition = await _create_test_condition(session, requirement, "exec-404")
            level, type_ = await _create_taxonomy_pair(session, "exec-404")
            case = await _create_test_case(
                session, test_condition=condition, test_level=level, test_type=type_,
                created_by=admin_a.actor_id, tag="exec-404",
            )
            plan = await _create_test_plan(session, project, admin_a.actor_id, "exec-404")
            release = await _create_release(session, project, "exec-404")
            environment = await _create_environment_row(session, project, "exec-404")
            cycle = await _create_test_cycle(
                session, test_plan=plan, release=release, environment=environment, tag="exec-404"
            )
            execution = await _create_test_execution(
                session, test_cycle=cycle, test_case=case, executed_by=admin_a.actor_id, tag="exec-404"
            )
            await session.commit()
            user_ids = [admin_a.actor_id, admin_b.actor_id]
            org_ids = [org_a.id, _org_b.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_level_ids = [level.id]
            test_type_ids = [type_.id]
            test_plan_ids = [plan.id]
            release_ids = [release.id]
            environment_ids = [environment.id]
            test_cycle_ids = [cycle.id]
            test_execution_ids = [execution.id]
            token_b = _access_token_for(admin_b.actor_id)
            execution_id = execution.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/test-executions/{execution_id}", headers={"Authorization": f"Bearer {token_b}"}
            )
        assert response.status_code == 404
        assert response.json()["code"] == "not_found"
    finally:
        await _cleanup_extra(
            test_execution_ids=test_execution_ids,
            test_cycle_ids=test_cycle_ids,
            release_ids=release_ids,
            environment_ids=environment_ids,
        )
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
            test_plan_ids=test_plan_ids,
        )


# --- TestLog: list/get only, no PATCH/DELETE route registered at all ---------------------------


@pytest.mark.asyncio
async def test_test_log_list_get_and_no_write_routes() -> None:
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    test_plan_ids: list = []
    test_cycle_ids: list = []
    release_ids: list = []
    environment_ids: list = []
    test_execution_ids: list = []
    test_log_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "log-rw")
            project = await _create_project(session, org, "log-rw")
            requirement = await _create_requirement(session, project, "log-rw")
            condition = await _create_test_condition(session, requirement, "log-rw")
            level, type_ = await _create_taxonomy_pair(session, "log-rw")
            case = await _create_test_case(
                session, test_condition=condition, test_level=level, test_type=type_,
                created_by=admin.actor_id, tag="log-rw",
            )
            plan = await _create_test_plan(session, project, admin.actor_id, "log-rw")
            release = await _create_release(session, project, "log-rw")
            environment = await _create_environment_row(session, project, "log-rw")
            cycle = await _create_test_cycle(
                session, test_plan=plan, release=release, environment=environment, tag="log-rw"
            )
            execution = await _create_test_execution(
                session, test_cycle=cycle, test_case=case, executed_by=admin.actor_id, tag="log-rw"
            )
            log = TestLog(
                test_execution_id=execution.id,
                event_type=TestLogEventType.status_change,
                payload={"from": "draft", "to": "pass"},
            )
            session.add(log)
            await session.flush()
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_level_ids = [level.id]
            test_type_ids = [type_.id]
            test_plan_ids = [plan.id]
            release_ids = [release.id]
            environment_ids = [environment.id]
            test_cycle_ids = [cycle.id]
            test_execution_ids = [execution.id]
            test_log_ids = [log.id]
            token = _access_token_for(admin.actor_id)
            execution_id, log_id = execution.id, log.id

        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            list_response = await client.get(
                f"{API_PREFIX}/test-logs", params={"test_execution_id": str(execution_id)}, headers=headers
            )
            assert list_response.status_code == 200
            assert list_response.json()["total"] >= 1

            get_response = await client.get(f"{API_PREFIX}/test-logs/{log_id}", headers=headers)
            assert get_response.status_code == 200
            assert get_response.json()["event_type"] == "status_change"

            # No PATCH/DELETE route is ever registered for TestLog (ADR-0025)
            # -- FastAPI/Starlette returns 405 Method Not Allowed for a path
            # that exists under a different method set, not 404.
            patch_response = await client.patch(
                f"{API_PREFIX}/test-logs/{log_id}", json={"payload": {"should": "never apply"}}, headers=headers
            )
            assert patch_response.status_code == 405

            delete_response = await client.delete(f"{API_PREFIX}/test-logs/{log_id}", headers=headers)
            assert delete_response.status_code == 405
    finally:
        await _cleanup_extra(
            test_log_ids=test_log_ids,
            test_execution_ids=test_execution_ids,
            test_cycle_ids=test_cycle_ids,
            release_ids=release_ids,
            environment_ids=environment_ids,
        )
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
            test_plan_ids=test_plan_ids,
        )


# --- Link tables: RequirementTestCaseLink (1-hop) + TestConditionTestCaseLink (2-hop) -----------


@pytest.mark.asyncio
async def test_requirement_test_case_link_list_get_and_cross_org_404() -> None:
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    link_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_a, org_a = await _create_org_admin(session, "rtcl-a")
            admin_b, _org_b = await _create_org_admin(session, "rtcl-b")
            project = await _create_project(session, org_a, "rtcl")
            requirement = await _create_requirement(session, project, "rtcl")
            condition = await _create_test_condition(session, requirement, "rtcl")
            level, type_ = await _create_taxonomy_pair(session, "rtcl")
            case = await _create_test_case(
                session, test_condition=condition, test_level=level, test_type=type_,
                created_by=admin_a.actor_id, tag="rtcl",
            )
            link = RequirementTestCaseLink(requirement_id=requirement.id, test_case_id=case.id)
            session.add(link)
            await session.flush()
            await session.commit()
            user_ids = [admin_a.actor_id, admin_b.actor_id]
            org_ids = [org_a.id, _org_b.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_level_ids = [level.id]
            test_type_ids = [type_.id]
            link_ids = [link.id]
            token_a = _access_token_for(admin_a.actor_id)
            token_b = _access_token_for(admin_b.actor_id)
            requirement_id, link_id = requirement.id, link.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            list_response = await client.get(
                f"{API_PREFIX}/requirement-test-case-links",
                params={"requirement_id": str(requirement_id)},
                headers={"Authorization": f"Bearer {token_a}"},
            )
            assert list_response.status_code == 200
            assert list_response.json()["total"] == 1

            get_response = await client.get(
                f"{API_PREFIX}/requirement-test-case-links/{link_id}",
                headers={"Authorization": f"Bearer {token_a}"},
            )
            assert get_response.status_code == 200

            cross_org_response = await client.get(
                f"{API_PREFIX}/requirement-test-case-links/{link_id}",
                headers={"Authorization": f"Bearer {token_b}"},
            )
            assert cross_org_response.status_code == 404
            assert cross_org_response.json()["code"] == "not_found"

            # No create/update/delete route exists for this link table at all.
            post_response = await client.post(
                f"{API_PREFIX}/requirement-test-case-links",
                json={"requirement_id": str(requirement_id), "test_case_id": str(case.id)},
                headers={"Authorization": f"Bearer {token_a}"},
            )
            assert post_response.status_code == 405
    finally:
        await _cleanup_extra(link_ids={"requirement_test_case_link": link_ids})
        await _crud_cleanup(
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
async def test_test_condition_test_case_link_list_get_and_cross_org_404() -> None:
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    link_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_a, org_a = await _create_org_admin(session, "tctcl-a")
            admin_b, _org_b = await _create_org_admin(session, "tctcl-b")
            project = await _create_project(session, org_a, "tctcl")
            requirement = await _create_requirement(session, project, "tctcl")
            condition = await _create_test_condition(session, requirement, "tctcl")
            level, type_ = await _create_taxonomy_pair(session, "tctcl")
            case = await _create_test_case(
                session, test_condition=condition, test_level=level, test_type=type_,
                created_by=admin_a.actor_id, tag="tctcl",
            )
            link = TestConditionTestCaseLink(test_condition_id=condition.id, test_case_id=case.id)
            session.add(link)
            await session.flush()
            await session.commit()
            user_ids = [admin_a.actor_id, admin_b.actor_id]
            org_ids = [org_a.id, _org_b.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_level_ids = [level.id]
            test_type_ids = [type_.id]
            link_ids = [link.id]
            token_a = _access_token_for(admin_a.actor_id)
            token_b = _access_token_for(admin_b.actor_id)
            condition_id, link_id = condition.id, link.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            list_response = await client.get(
                f"{API_PREFIX}/test-condition-test-case-links",
                params={"test_condition_id": str(condition_id)},
                headers={"Authorization": f"Bearer {token_a}"},
            )
            assert list_response.status_code == 200
            assert list_response.json()["total"] == 1

            cross_org_response = await client.get(
                f"{API_PREFIX}/test-condition-test-case-links/{link_id}",
                headers={"Authorization": f"Bearer {token_b}"},
            )
            assert cross_org_response.status_code == 404
            assert cross_org_response.json()["code"] == "not_found"
    finally:
        await _cleanup_extra(link_ids={"test_condition_test_case_link": link_ids})
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


# --- GET /orgs/{org_id}/permissions/mine --------------------------------------------------------


@pytest.mark.asyncio
async def test_permissions_mine_mixed_org_wide_and_project_scoped() -> None:
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "perm-mine-mixed")
            project = await _create_project(session, org, "perm-mine-mixed")
            member = await _create_user(session, f"perm-mine-{uuid4().hex[:8]}@example.com")
            session.add(
                OrgMembership(
                    org_id=org.id, user_id=member.actor_id, status=OrgMembershipStatus.active,
                    joined_at=datetime.now(UTC),
                )
            )
            await session.flush()
            auditor_role = await _get_role_by_name(session, "auditor")
            tester_role = await _get_role_by_name(session, "tester")
            # Org-wide auditor grant + project-scoped tester grant, both for `member`.
            await _assign_role(session, actor_id=member.actor_id, org=org, role=auditor_role)
            await _assign_role(session, actor_id=member.actor_id, org=org, role=tester_role, project_id=project.id)
            await session.commit()
            user_ids = [admin.actor_id, member.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            token = _access_token_for(member.actor_id)
            org_id, project_id = org.id, project.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/orgs/{org_id}/permissions/mine", headers={"Authorization": f"Bearer {token}"}
            )
        assert response.status_code == 200
        body = response.json()
        codes = body["codes"]

        org_wide_codes = {row["code"] for row in codes if row["project_id"] is None}
        project_scoped_codes = {row["code"] for row in codes if row["project_id"] == str(project_id)}

        # auditor bundle is read_codes(ALL_RESOURCES) + requirement.export_rtm -- org-wide.
        assert "requirement.read" in org_wide_codes
        assert "test_case.read" in org_wide_codes
        # tester bundle includes test_case.create -- project-scoped only, here.
        assert "test_case.create" in project_scoped_codes
        assert "test_case.create" not in org_wide_codes
    finally:
        async with AsyncSessionLocal() as session:
            if user_ids:
                await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(user_ids)))
            await session.commit()
        await _crud_cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


@pytest.mark.asyncio
async def test_permissions_mine_zero_grants_but_member_returns_empty_200() -> None:
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "perm-mine-zero")
            member = await _create_user(session, f"perm-mine-zero-{uuid4().hex[:8]}@example.com")
            session.add(
                OrgMembership(
                    org_id=org.id, user_id=member.actor_id, status=OrgMembershipStatus.active,
                    joined_at=datetime.now(UTC),
                )
            )
            await session.flush()
            await session.commit()
            user_ids = [admin.actor_id, member.actor_id]
            org_ids = [org.id]
            token = _access_token_for(member.actor_id)
            org_id = org.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/orgs/{org_id}/permissions/mine", headers={"Authorization": f"Bearer {token}"}
            )
        assert response.status_code == 200
        assert response.json() == {"codes": []}
    finally:
        await _crud_cleanup(user_ids=user_ids, org_ids=org_ids)


@pytest.mark.asyncio
async def test_permissions_mine_non_member_returns_404() -> None:
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            outsider = await _create_user(session, f"perm-mine-outsider-{uuid4().hex[:8]}@example.com")
            _admin, org = await _create_org_admin(session, "perm-mine-404")
            await session.commit()
            user_ids = [outsider.actor_id, _admin.actor_id]
            org_ids = [org.id]
            token = _access_token_for(outsider.actor_id)
            org_id = org.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/orgs/{org_id}/permissions/mine", headers={"Authorization": f"Bearer {token}"}
            )
        assert response.status_code == 404
        assert response.json()["code"] == "not_found"
    finally:
        await _crud_cleanup(user_ids=user_ids, org_ids=org_ids)
