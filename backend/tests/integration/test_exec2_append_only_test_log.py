"""Integration tests for EXEC-2 (append-only `TestLog`, this story's own ADR).

Covers AC1 (a `TestLog` row is appended on the initial recording, on any
`result` correction, on a comment, and on an `AIAgent`-originated action —
never overwriting the `TestExecution`'s own prior state), AC2 (no
`create`/`update`/`delete` route ever reachable for `TestLog` — already
exercised end to end by `test_admin2_execution_trace.py`'s `405` assertions,
not duplicated here) and AC3 (the ordered timeline read, `GET
/executions/{id}/logs`).

Fixture helpers (org/project/plan/cycle/suite/case graph, `_cleanup`,
role/permission seeding) are **imported** from
`test_plan3_test_cycle_execution.py`, same posture
`test_exec1_dashboard_and_history.py` already established — that module owns
the FK-safe delete ordering for this entity graph, and (as of this story) the
`TestLog`-before-`TestExecution` sweep the new auto-appended rows require; a
second hand-maintained copy would only be free to drift.

Real HTTP via `httpx.AsyncClient` against a live server (`TEST_API_BASE_URL`);
the package-level `conftest.py` skip-guard applies here too.
"""

import os
from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import select

from app.core.security import generate_api_key, hash_api_key
from app.db.session import AsyncSessionLocal
from app.models.actor import AIAgent
from app.models.execution import TestExecution, TestLog

from tests.integration.test_plan3_test_cycle_execution import (
    _access_token_for,
    _add_case_to_suite,
    _cleanup,
    _create_condition_path_test_case,
    _create_custom_role_member,
    _create_environment,
    _create_org_admin,
    _create_project,
    _create_release,
    _create_requirement,
    _create_test_condition,
    _create_test_cycle,
    _create_test_level,
    _create_test_plan,
    _create_test_suite,
    _create_test_type,
    _get_role_by_name,
    _assign_role,
    _include_suite_in_plan,
    _unique_name,
)

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"


def _cycle_executions_path(test_cycle_id) -> str:
    return f"{API_PREFIX}/test-cycles/{test_cycle_id}/executions"


def _test_execution_item_path(test_execution_id) -> str:
    return f"{API_PREFIX}/test-executions/{test_execution_id}"


def _execution_comments_path(test_execution_id) -> str:
    return f"{API_PREFIX}/executions/{test_execution_id}/comments"


def _execution_logs_path(test_execution_id) -> str:
    return f"{API_PREFIX}/executions/{test_execution_id}/logs"


async def _create_agent(session, *, acting_on_behalf_of_user_id, agent_name: str = "EXEC-2 Test Agent"):
    raw_key, key_prefix = generate_api_key()
    agent = AIAgent(
        agent_name=agent_name,
        model_or_provider="test-provider/test-model",
        acting_on_behalf_of_user_id=acting_on_behalf_of_user_id,
        key_hash=hash_api_key(raw_key),
        key_prefix=key_prefix,
        issued_at=datetime.now(UTC),
        revoked_at=None,
        last_used_at=None,
    )
    session.add(agent)
    await session.flush()
    return agent, raw_key


async def _seed_scope(session, tag: str):
    """One org/project/requirement/condition/case/plan/suite/release/environment/
    cycle graph, scoped so a `TestCase` is genuinely in the cycle's plan
    (ADR-0033's own precondition) — same shape `test_exec1_dashboard_and_history
    .py`'s own fixture builds, factored out here since every test in this file
    needs it.
    """
    admin, org = await _create_org_admin(session, tag)
    project = await _create_project(session, org, tag)
    requirement = await _create_requirement(session, project, tag)
    condition = await _create_test_condition(session, requirement, tag)
    level = await _create_test_level(session, tag)
    test_type = await _create_test_type(session, tag)
    case = await _create_condition_path_test_case(session, condition, admin.actor_id, level, test_type, tag)
    plan = await _create_test_plan(session, project, admin.actor_id, tag)
    suite = await _create_test_suite(session, project, tag)
    await _include_suite_in_plan(session, plan, suite)
    await _add_case_to_suite(session, suite, case)
    release = await _create_release(session, project, tag)
    environment = await _create_environment(session, project, tag)
    cycle = await _create_test_cycle(session, plan, release, environment, tag)
    return {
        "admin": admin,
        "org": org,
        "project": project,
        "requirement": requirement,
        "condition": condition,
        "level": level,
        "test_type": test_type,
        "case": case,
        "plan": plan,
        "suite": suite,
        "release": release,
        "environment": environment,
        "cycle": cycle,
    }


def _cleanup_ids(scope: dict) -> dict:
    return {
        "user_ids": [scope["admin"].actor_id],
        "org_ids": [scope["org"].id],
        "project_ids": [scope["project"].id],
        "requirement_ids": [scope["requirement"].id],
        "test_condition_ids": [scope["condition"].id],
        "test_case_ids": [scope["case"].id],
        "test_suite_ids": [scope["suite"].id],
        "test_level_ids": [scope["level"].id],
        "test_type_ids": [scope["test_type"].id],
    }


async def _create_execution(client, headers, cycle_id, case_id, result: str, actual_result: str | None = None):
    response = await client.post(
        _cycle_executions_path(cycle_id),
        headers=headers,
        json={
            "test_case_id": str(case_id),
            "result": result,
            "actual_result": actual_result,
            "executed_at": datetime.now(UTC).isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _list_logs(client, headers, execution_id):
    response = await client.get(_execution_logs_path(execution_id), headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


# --- AC1: initial recording gets its own log entry (Q2 default) ---------------------------------


@pytest.mark.asyncio
async def test_creating_an_execution_appends_an_initial_status_change_log() -> None:
    scope_ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            scope = await _seed_scope(session, "exec2-create")
            await session.commit()
            scope_ids = _cleanup_ids(scope)
            admin_id, cycle_id, case_id = scope["admin"].actor_id, scope["cycle"].id, scope["case"].id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            execution = await _create_execution(client, headers, cycle_id, case_id, "pass")
            execution_id = execution["id"]

            logs = await _list_logs(client, headers, execution_id)
            assert logs["total"] == 1
            entry = logs["items"][0]
            assert entry["event_type"] == "status_change"
            assert entry["payload"]["from"] is None
            assert entry["payload"]["to"] == "pass"
            assert entry["payload"]["actor_id"] == str(admin_id)
            assert entry["logged_at"] is not None
    finally:
        await _cleanup(**scope_ids)


# --- AC1: a later correction appends, never overwrites ------------------------------------------


@pytest.mark.asyncio
async def test_correcting_result_appends_a_second_log_and_keeps_the_first() -> None:
    scope_ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            scope = await _seed_scope(session, "exec2-correct")
            await session.commit()
            scope_ids = _cleanup_ids(scope)
            admin_id, cycle_id, case_id = scope["admin"].actor_id, scope["cycle"].id, scope["case"].id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            execution = await _create_execution(client, headers, cycle_id, case_id, "pass")
            execution_id = execution["id"]

            corrected = await client.patch(
                _test_execution_item_path(execution_id),
                headers=headers,
                json={"result": "fail", "actual_result": "corrected: it actually broke"},
            )
            assert corrected.status_code == 200, corrected.text
            assert corrected.json()["result"] == "fail"

            logs = await _list_logs(client, headers, execution_id)
            assert logs["total"] == 2, "the correction must append, not replace"
            first, second = logs["items"]
            assert first["event_type"] == "status_change"
            assert first["payload"] == {
                "kind": "status_change",
                "from": None,
                "to": "pass",
                "actor_id": str(admin_id),
                "actor_type": "user",
            }
            assert second["event_type"] == "status_change"
            assert second["payload"]["from"] == "pass"
            assert second["payload"]["to"] == "fail"
            assert first["logged_at"] <= second["logged_at"], "timeline must be oldest first"

            # The `TestExecution`'s own current-state field is genuinely
            # superseded (AC1's own "not overwritten, only superseded"
            # wording) -- current state shows `fail`, history shows both.
            current = await client.get(_test_execution_item_path(execution_id), headers=headers)
            assert current.json()["result"] == "fail"
    finally:
        await _cleanup(**scope_ids)


@pytest.mark.asyncio
async def test_patch_without_a_result_field_appends_no_log() -> None:
    """Q6 default: `actual_result`/`executed_at`-only edits are not a
    `result` correction and log nothing."""
    scope_ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            scope = await _seed_scope(session, "exec2-noop-field")
            await session.commit()
            scope_ids = _cleanup_ids(scope)
            admin_id, cycle_id, case_id = scope["admin"].actor_id, scope["cycle"].id, scope["case"].id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            execution = await _create_execution(client, headers, cycle_id, case_id, "pass")
            execution_id = execution["id"]

            patched = await client.patch(
                _test_execution_item_path(execution_id),
                headers=headers,
                json={"actual_result": "just adding notes, no result change"},
            )
            assert patched.status_code == 200, patched.text

            logs = await _list_logs(client, headers, execution_id)
            assert logs["total"] == 1, "only the create-time log should exist"
    finally:
        await _cleanup(**scope_ids)


@pytest.mark.asyncio
async def test_patch_with_the_same_result_value_appends_no_log() -> None:
    """A `PATCH` that sets `result` to the value it already had is not a
    change -- no second log entry."""
    scope_ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            scope = await _seed_scope(session, "exec2-noop-value")
            await session.commit()
            scope_ids = _cleanup_ids(scope)
            admin_id, cycle_id, case_id = scope["admin"].actor_id, scope["cycle"].id, scope["case"].id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            execution = await _create_execution(client, headers, cycle_id, case_id, "pass")
            execution_id = execution["id"]

            patched = await client.patch(
                _test_execution_item_path(execution_id), headers=headers, json={"result": "pass"}
            )
            assert patched.status_code == 200, patched.text

            logs = await _list_logs(client, headers, execution_id)
            assert logs["total"] == 1
    finally:
        await _cleanup(**scope_ids)


# --- AC1: comment/attachment triggers (Q4 default) -----------------------------------------------


@pytest.mark.asyncio
async def test_adding_a_comment_appends_a_comment_log() -> None:
    scope_ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            scope = await _seed_scope(session, "exec2-comment")
            await session.commit()
            scope_ids = _cleanup_ids(scope)
            admin_id, cycle_id, case_id = scope["admin"].actor_id, scope["cycle"].id, scope["case"].id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            execution = await _create_execution(client, headers, cycle_id, case_id, "pass")
            execution_id = execution["id"]

            comment_text = _unique_name("EXEC-2 comment text")
            commented = await client.post(
                _execution_comments_path(execution_id), headers=headers, json={"text": comment_text}
            )
            assert commented.status_code == 201, commented.text
            body = commented.json()
            assert body["event_type"] == "comment"
            assert body["payload"]["text"] == comment_text

            logs = await _list_logs(client, headers, execution_id)
            assert logs["total"] == 2
            assert logs["items"][1]["event_type"] == "comment"
    finally:
        await _cleanup(**scope_ids)


@pytest.mark.asyncio
async def test_comment_with_an_attachment_reference_logs_as_attachment() -> None:
    scope_ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            scope = await _seed_scope(session, "exec2-attach")
            await session.commit()
            scope_ids = _cleanup_ids(scope)
            admin_id, cycle_id, case_id = scope["admin"].actor_id, scope["cycle"].id, scope["case"].id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            execution = await _create_execution(client, headers, cycle_id, case_id, "pass")
            execution_id = execution["id"]

            attached = await client.post(
                _execution_comments_path(execution_id),
                headers=headers,
                json={
                    "text": "see screenshot",
                    "attachment_url": "https://example.com/evidence.png",
                    "file_name": "evidence.png",
                },
            )
            assert attached.status_code == 201, attached.text
            assert attached.json()["event_type"] == "attachment"
    finally:
        await _cleanup(**scope_ids)


# --- AC1: an AIAgent-originated action logs as `agent_action` (Q3 default) -----------------------


@pytest.mark.asyncio
async def test_ai_agent_actions_log_as_agent_action() -> None:
    scope_ids: dict = {}
    agent_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            scope = await _seed_scope(session, "exec2-agent")
            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=scope["admin"].actor_id)
            ai_agent_scoped_role = await _get_role_by_name(session, "ai_agent_scoped")
            await _assign_role(session, actor_id=agent.actor_id, org=scope["org"], role=ai_agent_scoped_role)
            await session.commit()
            scope_ids = _cleanup_ids(scope)
            agent_ids = [agent.actor_id]
            cycle_id, case_id = scope["cycle"].id, scope["case"].id

        agent_headers = {"Authorization": f"Bearer {raw_key}"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            execution = await _create_execution(client, agent_headers, cycle_id, case_id, "pass")
            execution_id = execution["id"]

            commented = await client.post(
                _execution_comments_path(execution_id), headers=agent_headers, json={"text": "agent note"}
            )
            assert commented.status_code == 201, commented.text
            assert commented.json()["event_type"] == "agent_action"

            logs = await _list_logs(client, agent_headers, execution_id)
            assert logs["total"] == 2
            create_entry, comment_entry = logs["items"]
            assert create_entry["event_type"] == "agent_action"
            assert create_entry["payload"]["kind"] == "status_change"
            assert create_entry["payload"]["actor_type"] == "ai_agent"
            assert comment_entry["event_type"] == "agent_action"
            assert comment_entry["payload"]["kind"] == "comment"
    finally:
        # This test's `TestExecution` stamped `executed_by_actor_id` = the
        # **agent's** own `actor_id` (the create route stamps the
        # authenticated caller, and the caller here is the agent, not the
        # human it acts for) -- so the FK-safe order is: that `TestExecution`
        # row's own `TestLog`s, then the row itself, then the agent's
        # `RoleAssignment`/`AIAgent`/`Actor` rows, *then* `_cleanup` (which
        # has no `agent_ids` parameter of its own and would otherwise try to
        # delete the human admin's `User`/`Actor` row while the agent's
        # `AIAgent.acting_on_behalf_of_user_id` still points at it).
        if agent_ids:
            from sqlalchemy import delete

            from app.models.actor import Actor
            from app.models.rbac import RoleAssignment

            async with AsyncSessionLocal() as session:
                execution_id_subquery = select(TestExecution.id).where(
                    TestExecution.executed_by_actor_id.in_(agent_ids)
                )
                await session.execute(
                    delete(TestLog).where(TestLog.test_execution_id.in_(execution_id_subquery))
                )
                await session.execute(
                    delete(TestExecution).where(TestExecution.executed_by_actor_id.in_(agent_ids))
                )
                await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(agent_ids)))
                await session.execute(delete(AIAgent).where(AIAgent.actor_id.in_(agent_ids)))
                await session.execute(delete(Actor).where(Actor.id.in_(agent_ids)))
                await session.commit()
        await _cleanup(**scope_ids)


# --- AC2 consequence: a TestExecution with any log entries can't be deleted ----------------------


@pytest.mark.asyncio
async def test_execution_with_a_log_entry_cannot_be_deleted() -> None:
    """Not itself an EXEC-2 AC, but a direct structural consequence of AC1/AC2
    together: `TestLog.test_execution_id` is `RESTRICT`, and every
    `TestExecution` now has at least one log row from the moment it's
    created -- so the generic `DELETE /test-executions/{id}` route, which
    still exists, can never actually succeed once real logs exist. That's the
    correct behavior for an audit-grade log (deleting the parent must not be
    a back door around "TestLog rows are immutable once written"), not a bug;
    pinned here explicitly so a future change can't silently "fix" it back to
    an actual delete.
    """
    scope_ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            scope = await _seed_scope(session, "exec2-delete-blocked")
            await session.commit()
            scope_ids = _cleanup_ids(scope)
            admin_id, cycle_id, case_id = scope["admin"].actor_id, scope["cycle"].id, scope["case"].id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            execution = await _create_execution(client, headers, cycle_id, case_id, "pass")
            execution_id = execution["id"]

            deleted = await client.delete(_test_execution_item_path(execution_id), headers=headers)
            assert deleted.status_code == 409, deleted.text
            assert deleted.json()["code"] == "restrict_blocked"
    finally:
        await _cleanup(**scope_ids)


# --- NFR-1: cross-tenant existence-hiding on both new bespoke routes -----------------------------


@pytest.mark.asyncio
async def test_comment_and_logs_routes_404_across_org_boundary() -> None:
    scope_ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            scope = await _seed_scope(session, "exec2-tenant")
            outsider_org_admin, outsider_org = await _create_org_admin(session, "exec2-outsider-org")
            await session.commit()
            scope_ids = _cleanup_ids(scope)
            scope_ids["user_ids"] = scope_ids["user_ids"] + [outsider_org_admin.actor_id]
            scope_ids["org_ids"] = scope_ids["org_ids"] + [outsider_org.id]
            admin_id, cycle_id, case_id = scope["admin"].actor_id, scope["cycle"].id, scope["case"].id
            outsider_id = outsider_org_admin.actor_id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        outsider_headers = {"Authorization": f"Bearer {_access_token_for(outsider_id)}"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            execution = await _create_execution(client, headers, cycle_id, case_id, "pass")
            execution_id = execution["id"]

            comment_response = await client.post(
                _execution_comments_path(execution_id), headers=outsider_headers, json={"text": "should 404"}
            )
            assert comment_response.status_code == 404, comment_response.text
            assert comment_response.json()["code"] == "not_found"

            logs_response = await client.get(_execution_logs_path(execution_id), headers=outsider_headers)
            assert logs_response.status_code == 404, logs_response.text
            assert logs_response.json()["code"] == "not_found"
    finally:
        await _cleanup(**scope_ids)


# --- permission gate: membership present, required permission missing -> 403 ---------------------


@pytest.mark.asyncio
async def test_comment_and_logs_routes_403_when_permission_missing() -> None:
    scope_ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            scope = await _seed_scope(session, "exec2-403")
            # Holds a real, unrelated permission -- proves the specific
            # `test_execution.update`/`.read` gate fired, not a blanket
            # has-no-roles-at-all rejection (same posture
            # `_create_custom_role_member`'s own docstring establishes).
            member, role = await _create_custom_role_member(
                session, "exec2-403", scope["org"], ["test_case.read"]
            )
            await session.commit()
            scope_ids = _cleanup_ids(scope)
            scope_ids["user_ids"] = scope_ids["user_ids"] + [member.actor_id]
            scope_ids["role_ids"] = [role.id]
            admin_id, cycle_id, case_id = scope["admin"].actor_id, scope["cycle"].id, scope["case"].id
            member_id = member.actor_id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        member_headers = {"Authorization": f"Bearer {_access_token_for(member_id)}"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            execution = await _create_execution(client, headers, cycle_id, case_id, "pass")
            execution_id = execution["id"]

            comment_response = await client.post(
                _execution_comments_path(execution_id), headers=member_headers, json={"text": "should 403"}
            )
            assert comment_response.status_code == 403, comment_response.text
            assert comment_response.json()["code"] == "permission_denied"

            logs_response = await client.get(_execution_logs_path(execution_id), headers=member_headers)
            assert logs_response.status_code == 403, logs_response.text
            assert logs_response.json()["code"] == "permission_denied"
    finally:
        await _cleanup(**scope_ids)
