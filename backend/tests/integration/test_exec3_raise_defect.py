"""Integration tests for EXEC-3 (raise a Defect from a failed TestExecution,
ADR-0044).

Covers TC-EXEC-007 (atomic create+link, create-then-read), TC-EXEC-008
(`external_ref` v1 posture), TC-EXEC-009 (most-recent-first ordering,
pairwise), TC-EXEC-011 (non-fail rejection, ×3 fixtures, no orphaned link
row), TC-EXEC-012 (`test_manager`/`tester` RBAC bundle-extension positive
class), plus the cross-org-404/permission-403 boundary on both new bespoke
routes.

Fixture helpers (`_seed_scope`/`_cleanup_ids`/`_create_execution`) are
**imported** from `test_exec2_append_only_test_log.py`, same posture that
file's own docstring already established for reusing
`test_plan3_test_cycle_execution.py`'s graph — a second hand-maintained copy
would only be free to drift. `Defect`/`TestCaseDefectLink` cleanup (neither
covered by the imported `_cleanup`) is this file's own addition: `Defect.
test_execution_id` is `RESTRICT`, so any `Defect` this file creates must be
deleted before `_cleanup`'s own `TestExecution` sweep runs, or that sweep
FK-violates. `TestCaseDefectLink` needs no explicit delete of its own — its
FK to `defect.id` is `ON DELETE CASCADE` (Database Document §3.9), so
deleting the `Defect` row cascades it away automatically.

Real HTTP via `httpx.AsyncClient` against a live server (`TEST_API_BASE_URL`);
the package-level `conftest.py` skip-guard applies here too.
"""

import os
from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import delete, select

from app.db.session import AsyncSessionLocal
from app.models.execution import Defect

from tests.integration.test_exec2_append_only_test_log import (
    _cleanup_ids,
    _create_execution,
    _seed_scope,
)
from tests.integration.test_plan3_test_cycle_execution import (
    _access_token_for,
    _cleanup,
    _create_custom_role_member,
    _create_member_with_role,
    _create_org_admin,
)

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"


def _raise_defect_path(test_execution_id) -> str:
    return f"{API_PREFIX}/executions/{test_execution_id}/defects"


def _test_case_defects_path(test_case_id) -> str:
    return f"{API_PREFIX}/test-cases/{test_case_id}/defects"


def _defect_item_path(defect_id) -> str:
    return f"{API_PREFIX}/defects/{defect_id}"


def _test_case_defect_links_path(test_case_id) -> str:
    return f"{API_PREFIX}/test-case-defect-links?test_case_id={test_case_id}"


async def _delete_defects(defect_ids: list) -> None:
    """Must run BEFORE the imported `_cleanup()` — see this module's own
    docstring for why (`Defect.test_execution_id` is `RESTRICT`).
    `TestCaseDefectLink` rows cascade away with their `Defect`, no separate
    delete needed.
    """
    if not defect_ids:
        return
    async with AsyncSessionLocal() as session:
        await session.execute(delete(Defect).where(Defect.id.in_(defect_ids)))
        await session.commit()


async def _raise_defect(client, headers, execution_id, *, severity="high", external_ref=None, status=None):
    return await client.post(
        _raise_defect_path(execution_id),
        headers=headers,
        json={"external_ref": external_ref, "severity": severity, "status": status},
    )


# --- TC-EXEC-007: atomic create+link, verified by create-then-read --------------------------------


@pytest.mark.asyncio
async def test_raise_defect_creates_defect_and_test_case_defect_link_atomically() -> None:
    scope_ids: dict = {}
    defect_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            scope = await _seed_scope(session, "exec3-atomic")
            await session.commit()
            scope_ids = _cleanup_ids(scope)
            admin_id, cycle_id, case_id = scope["admin"].actor_id, scope["cycle"].id, scope["case"].id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            execution = await _create_execution(client, headers, cycle_id, case_id, "fail")
            execution_id = execution["id"]

            response = await _raise_defect(
                client, headers, execution_id, severity="high", external_ref="JIRA-4821"
            )
            assert response.status_code == 201, response.text
            body = response.json()
            defect_id = body["id"]
            defect_ids = [defect_id]
            assert body["test_execution_id"] == execution_id
            assert body["reported_by_actor_id"] == str(admin_id)
            assert body["external_ref"] == "JIRA-4821"
            assert body["severity"] == "high"
            assert body["status"] == "open"

            # Not inferred from the `201` alone -- both halves independently
            # re-read via their own routes (resolver-completeness discipline,
            # backend/CLAUDE.md's standing rule).
            defect_get = await client.get(_defect_item_path(defect_id), headers=headers)
            assert defect_get.status_code == 200, defect_get.text
            assert defect_get.json()["test_execution_id"] == execution_id

            links = await client.get(_test_case_defect_links_path(case_id), headers=headers)
            assert links.status_code == 200, links.text
            link_defect_ids = {item["defect_id"] for item in links.json()["items"]}
            assert str(defect_id) in link_defect_ids
    finally:
        await _delete_defects(defect_ids)
        await _cleanup(**scope_ids)


# --- TC-EXEC-008: external_ref v1 posture (plain string / URL / omitted) --------------------------


@pytest.mark.asyncio
async def test_external_ref_accepts_plain_string_url_and_omitted() -> None:
    scope_ids: dict = {}
    defect_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            scope = await _seed_scope(session, "exec3-extref")
            await session.commit()
            scope_ids = _cleanup_ids(scope)
            admin_id, cycle_id, case_id = scope["admin"].actor_id, scope["cycle"].id, scope["case"].id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # Plain string.
            exec_a = await _create_execution(client, headers, cycle_id, case_id, "fail")
            resp_a = await _raise_defect(client, headers, exec_a["id"], external_ref="BUG-1")
            assert resp_a.status_code == 201, resp_a.text
            defect_ids.append(resp_a.json()["id"])
            assert resp_a.json()["external_ref"] == "BUG-1"

            # Plain URL.
            exec_b = await _create_execution(client, headers, cycle_id, case_id, "fail")
            url = "https://github.com/org/repo/issues/12"
            resp_b = await _raise_defect(client, headers, exec_b["id"], external_ref=url)
            assert resp_b.status_code == 201, resp_b.text
            defect_ids.append(resp_b.json()["id"])
            assert resp_b.json()["external_ref"] == url

            # Omitted entirely -> null, not an empty string, not a validation error.
            exec_c = await _create_execution(client, headers, cycle_id, case_id, "fail")
            resp_c = await _raise_defect(client, headers, exec_c["id"], external_ref=None)
            assert resp_c.status_code == 201, resp_c.text
            defect_ids.append(resp_c.json()["id"])
            assert resp_c.json()["external_ref"] is None
    finally:
        await _delete_defects(defect_ids)
        await _cleanup(**scope_ids)


# --- TC-EXEC-011: non-fail rejection, three independent fixtures ----------------------------------


@pytest.mark.asyncio
async def test_raising_a_defect_against_a_non_fail_execution_is_rejected() -> None:
    scope_ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            scope = await _seed_scope(session, "exec3-nonfail")
            await session.commit()
            scope_ids = _cleanup_ids(scope)
            admin_id, cycle_id, case_id = scope["admin"].actor_id, scope["cycle"].id, scope["case"].id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            for result in ("pass", "blocked", "skipped"):
                execution = await _create_execution(client, headers, cycle_id, case_id, result)
                response = await _raise_defect(client, headers, execution["id"])
                assert response.status_code == 422, (result, response.text)
                assert response.json()["code"] == "validation_error"

                # No orphaned link row from a partial insert before rejecting.
                links = await client.get(_test_case_defect_links_path(case_id), headers=headers)
                assert links.status_code == 200, links.text
                assert links.json()["total"] == 0, (result, links.json())
    finally:
        await _cleanup(**scope_ids)


# --- TC-EXEC-009: most-recent-first ordering, pairwise across 3 defects / 2+ executions -----------


@pytest.mark.asyncio
async def test_test_case_defects_are_returned_most_recent_first() -> None:
    scope_ids: dict = {}
    defect_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            scope = await _seed_scope(session, "exec3-order")
            await session.commit()
            scope_ids = _cleanup_ids(scope)
            admin_id, cycle_id, case_id = scope["admin"].actor_id, scope["cycle"].id, scope["case"].id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # Zero-defect boundary, checked before any exist.
            empty = await client.get(_test_case_defects_path(case_id), headers=headers)
            assert empty.status_code == 200, empty.text
            assert empty.json()["items"] == []

            exec_1 = await _create_execution(client, headers, cycle_id, case_id, "fail")
            resp_1 = await _raise_defect(client, headers, exec_1["id"], external_ref="first")
            defect_ids.append(resp_1.json()["id"])

            exec_2 = await _create_execution(client, headers, cycle_id, case_id, "fail")
            resp_2 = await _raise_defect(client, headers, exec_2["id"], external_ref="second")
            defect_ids.append(resp_2.json()["id"])

            resp_3 = await _raise_defect(client, headers, exec_2["id"], external_ref="third")
            defect_ids.append(resp_3.json()["id"])

            listed = await client.get(_test_case_defects_path(case_id), headers=headers)
            assert listed.status_code == 200, listed.text
            items = listed.json()["items"]
            assert len(items) == 3
            assert [item["external_ref"] for item in items] == ["third", "second", "first"]
    finally:
        await _delete_defects(defect_ids)
        await _cleanup(**scope_ids)


# --- TC-EXEC-012: test_manager/tester RBAC bundle-extension positive class ------------------------


@pytest.mark.asyncio
async def test_manager_and_tester_can_reach_both_routes_without_org_admin() -> None:
    scope_ids: dict = {}
    defect_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            scope = await _seed_scope(session, "exec3-rbac")
            manager = await _create_member_with_role(session, "exec3-manager", scope["org"], "test_manager")
            tester = await _create_member_with_role(session, "exec3-tester", scope["org"], "tester")
            await session.commit()

            scope_ids = _cleanup_ids(scope)
            scope_ids["user_ids"] = scope_ids["user_ids"] + [manager.actor_id, tester.actor_id]
            admin_id = scope["admin"].actor_id
            cycle_id, case_id = scope["cycle"].id, scope["case"].id
            manager_id, tester_id = manager.actor_id, tester.actor_id

        admin_headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        manager_headers = {"Authorization": f"Bearer {_access_token_for(manager_id)}"}
        tester_headers = {"Authorization": f"Bearer {_access_token_for(tester_id)}"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            execution = await _create_execution(client, admin_headers, cycle_id, case_id, "fail")

            manager_response = await _raise_defect(client, manager_headers, execution["id"])
            assert manager_response.status_code == 201, manager_response.text
            defect_ids.append(manager_response.json()["id"])

            manager_view = await client.get(_test_case_defects_path(case_id), headers=manager_headers)
            assert manager_view.status_code == 200, manager_view.text

            tester_view = await client.get(_test_case_defects_path(case_id), headers=tester_headers)
            assert tester_view.status_code == 200, tester_view.text
            assert tester_view.json()["total"] == 1
    finally:
        await _delete_defects(defect_ids)
        await _cleanup(**scope_ids)


# --- NFR-1: cross-tenant existence-hiding + permission-missing 403 on both new bespoke routes -----


@pytest.mark.asyncio
async def test_both_routes_404_across_org_boundary_and_403_when_permission_missing() -> None:
    scope_ids: dict = {}
    defect_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            scope = await _seed_scope(session, "exec3-tenant")
            outsider_admin, outsider_org = await _create_org_admin(session, "exec3-outsider-org")
            member, role = await _create_custom_role_member(
                session, "exec3-403", scope["org"], ["test_case.read"]
            )
            await session.commit()
            scope_ids = _cleanup_ids(scope)
            scope_ids["user_ids"] = scope_ids["user_ids"] + [outsider_admin.actor_id, member.actor_id]
            scope_ids["org_ids"] = scope_ids["org_ids"] + [outsider_org.id]
            scope_ids["role_ids"] = [role.id]
            admin_id = scope["admin"].actor_id
            cycle_id, case_id = scope["cycle"].id, scope["case"].id
            outsider_id, member_id = outsider_admin.actor_id, member.actor_id

        admin_headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        outsider_headers = {"Authorization": f"Bearer {_access_token_for(outsider_id)}"}
        member_headers = {"Authorization": f"Bearer {_access_token_for(member_id)}"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            execution = await _create_execution(client, admin_headers, cycle_id, case_id, "fail")
            execution_id = execution["id"]

            # Cross-org: 404, not 403 -- existence never confirmable across
            # the tenant boundary (NFR-1).
            cross_org_create = await _raise_defect(client, outsider_headers, execution_id)
            assert cross_org_create.status_code == 404, cross_org_create.text
            assert cross_org_create.json()["code"] == "not_found"

            cross_org_read = await client.get(_test_case_defects_path(case_id), headers=outsider_headers)
            assert cross_org_read.status_code == 404, cross_org_read.text
            assert cross_org_read.json()["code"] == "not_found"

            # Membership present, required permission missing -> 403, proven
            # with an actor holding a real, unrelated permission.
            forbidden_create = await _raise_defect(client, member_headers, execution_id)
            assert forbidden_create.status_code == 403, forbidden_create.text
            assert forbidden_create.json()["code"] == "permission_denied"

            forbidden_read = await client.get(_test_case_defects_path(case_id), headers=member_headers)
            assert forbidden_read.status_code == 403, forbidden_read.text
            assert forbidden_read.json()["code"] == "permission_denied"
    finally:
        await _delete_defects(defect_ids)
        await _cleanup(**scope_ids)
