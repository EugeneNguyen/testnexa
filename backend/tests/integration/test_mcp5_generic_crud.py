"""Integration tests for MCP-5 (full CRUD, all entities via MCP, ADR-0065).

Covers TC-MCP-016 (generic dispatch across representative entity classes),
TC-MCP-018 (`_actor_membership_exists` fix — AIAgent reaches the generic
factory for the first time, User unaffected), TC-MCP-019 (cross-tenant 404
boundary preserved), TC-MCP-020 (`RiskItem` branching-scope parity),
TC-MCP-021 (bespoke-create dispatch preserves the underlying route's own
validation/boundary). Real HTTP requests via `httpx.AsyncClient` against a
live server, same wire-protocol helpers `test_mcp_test_cases.py` (MCP-1)
established — duplicated here rather than cross-imported, matching this
repo's own per-file fixture-ownership convention.
"""

import json
import os
import uuid
from datetime import UTC, datetime
from uuid import UUID

import httpx
import pytest
from sqlalchemy import delete, select

from app.core.security import generate_api_key, hash_api_key
from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, AIAgent, User
from app.models.assets import Requirement, TestCase, TestCaseStatus, TestSuite, TestSuiteTestCase
from app.models.auth import AuthIdentity, AuthProvider, RefreshToken
from app.models.governance import RiskItem
from app.models.planning import Environment, TestCycle, TestPlan, TestPlanTestSuite
from app.models.project import Project, Release
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission
from app.models.taxonomy import TestLevel, TestType
from app.models.trace import RequirementTestCaseLink
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
MCP_PATH = "/mcp/"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


def _unique_email(tag: str) -> str:
    return f"mcp5-{tag}-{uuid.uuid4().hex[:8]}@example.com"


# --- seeding helpers (mirrors test_mcp_test_cases.py's own pattern) -----------------------


async def _create_user(session, email: str) -> User:
    from app.core.security import hash_password

    user = User(name="MCP-5 Test User", email=email, password_hash=hash_password(DEFAULT_PASSWORD))
    session.add(user)
    await session.flush()
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"MCP-5 Test Org {slug_prefix}", slug=f"{slug_prefix}-{uuid.uuid4().hex[:8]}")
    session.add(org)
    await session.flush()
    return org


async def _create_membership(session, user: User, org: Organization) -> OrgMembership:
    membership = OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=datetime.now(UTC))
    session.add(membership)
    await session.flush()
    return membership


async def _create_project(session, org: Organization) -> Project:
    project = Project(org_id=org.id, name=f"MCP-5 Project {uuid.uuid4().hex[:6]}", standards_profile=None)
    session.add(project)
    await session.flush()
    return project


async def _create_requirement(session, project: Project, title: str = "MCP-5 Requirement") -> Requirement:
    requirement = Requirement(project_id=project.id, title=title, description="MCP-5 fixture.", external_ref=None, source=None)
    session.add(requirement)
    await session.flush()
    return requirement


async def _create_agent(session, *, acting_on_behalf_of_user_id: UUID, agent_name: str = "MCP-5 Test Agent") -> tuple[AIAgent, str]:
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


async def _get_permission_by_code(session, code: str) -> Permission:
    result = await session.execute(select(Permission).where(Permission.code == code))
    permission = result.scalars().first()
    assert permission is not None, f"catalog Permission {code!r} must already be seeded (RBAC-4)"
    return permission


async def _get_permission_by_codes(session, *codes: str) -> list[Permission]:
    return [await _get_permission_by_code(session, code) for code in codes]


async def _create_role(session, org: Organization, name: str) -> Role:
    role = Role(org_id=org.id, name=name, is_system_role=False)
    session.add(role)
    await session.flush()
    return role


async def _grant_permission(session, role: Role, permission: Permission) -> None:
    session.add(RolePermission(role_id=role.id, permission_id=permission.id))
    await session.flush()


async def _assign_role(session, *, actor_id: UUID, org: Organization, role: Role) -> None:
    session.add(RoleAssignment(actor_id=actor_id, org_id=org.id, project_id=None, role_id=role.id))
    await session.flush()


async def _cleanup(
    *,
    user_ids: list | None = None,
    agent_ids: list | None = None,
    org_ids: list | None = None,
    project_ids: list | None = None,
    requirement_ids: list | None = None,
    role_ids: list | None = None,
    risk_item_ids: list | None = None,
    test_level_ids: list | None = None,
    test_type_ids: list | None = None,
    test_case_ids: list | None = None,
    test_suite_ids: list | None = None,
    test_plan_ids: list | None = None,
    test_cycle_ids: list | None = None,
    release_ids: list | None = None,
    environment_ids: list | None = None,
) -> None:
    user_ids = user_ids or []
    agent_ids = agent_ids or []
    org_ids = org_ids or []
    project_ids = project_ids or []
    requirement_ids = requirement_ids or []
    role_ids = role_ids or []
    risk_item_ids = risk_item_ids or []
    test_level_ids = test_level_ids or []
    test_type_ids = test_type_ids or []
    test_case_ids = test_case_ids or []
    test_suite_ids = test_suite_ids or []
    test_plan_ids = test_plan_ids or []
    test_cycle_ids = test_cycle_ids or []
    release_ids = release_ids or []
    environment_ids = environment_ids or []

    async with AsyncSessionLocal() as session:
        actor_ids = [*user_ids, *agent_ids]
        if actor_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(actor_ids)))
        if role_ids:
            await session.execute(delete(RolePermission).where(RolePermission.role_id.in_(role_ids)))
            await session.execute(delete(Role).where(Role.id.in_(role_ids)))
        if risk_item_ids:
            await session.execute(delete(RiskItem).where(RiskItem.id.in_(risk_item_ids)))
        if requirement_ids:
            await session.execute(delete(RiskItem).where(RiskItem.requirement_id.in_(requirement_ids)))
        # PLAN-3 scope-check fixture chain (TC-MCP-021), FK-safe (children first):
        # TestCycle -> TestPlanTestSuite -> TestPlan/TestSuite -> TestSuiteTestCase
        # -> TestCase -> RequirementTestCaseLink -> Requirement/Release/Environment.
        if test_cycle_ids:
            await session.execute(delete(TestCycle).where(TestCycle.id.in_(test_cycle_ids)))
        if test_plan_ids:
            await session.execute(delete(TestPlanTestSuite).where(TestPlanTestSuite.test_plan_id.in_(test_plan_ids)))
            await session.execute(delete(TestPlan).where(TestPlan.id.in_(test_plan_ids)))
        if test_suite_ids:
            await session.execute(delete(TestSuiteTestCase).where(TestSuiteTestCase.test_suite_id.in_(test_suite_ids)))
            await session.execute(delete(TestSuite).where(TestSuite.id.in_(test_suite_ids)))
        if test_case_ids:
            await session.execute(delete(RequirementTestCaseLink).where(RequirementTestCaseLink.test_case_id.in_(test_case_ids)))
            await session.execute(delete(TestSuiteTestCase).where(TestSuiteTestCase.test_case_id.in_(test_case_ids)))
            await session.execute(delete(TestCase).where(TestCase.id.in_(test_case_ids)))
        if requirement_ids:
            await session.execute(delete(RequirementTestCaseLink).where(RequirementTestCaseLink.requirement_id.in_(requirement_ids)))
            await session.execute(delete(Requirement).where(Requirement.id.in_(requirement_ids)))
        if release_ids:
            await session.execute(delete(Release).where(Release.id.in_(release_ids)))
        if environment_ids:
            await session.execute(delete(Environment).where(Environment.id.in_(environment_ids)))
        if project_ids:
            await session.execute(delete(Project).where(Project.id.in_(project_ids)))
        if test_level_ids:
            await session.execute(delete(TestLevel).where(TestLevel.id.in_(test_level_ids)))
        if test_type_ids:
            await session.execute(delete(TestType).where(TestType.id.in_(test_type_ids)))
        if agent_ids:
            await session.execute(delete(AIAgent).where(AIAgent.actor_id.in_(agent_ids)))
            await session.execute(delete(Actor).where(Actor.id.in_(agent_ids)))
        if user_ids:
            # `refresh_token` is `ON DELETE RESTRICT` back to `user` — any test
            # that actually logs a `User` in (not just seeds one) must clear
            # this first, per `backend/CLAUDE.md`'s documented FK-safe order.
            await session.execute(delete(RefreshToken).where(RefreshToken.user_id.in_(user_ids)))
            await session.execute(delete(OrgMembership).where(OrgMembership.user_id.in_(user_ids)))
            await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id.in_(user_ids)))
        if org_ids:
            await session.execute(delete(OrgMembership).where(OrgMembership.org_id.in_(org_ids)))
            await session.execute(delete(Organization).where(Organization.id.in_(org_ids)))
        if user_ids:
            await session.execute(delete(User).where(User.actor_id.in_(user_ids)))
            await session.execute(delete(Actor).where(Actor.id.in_(user_ids)))
        await session.commit()


# --- MCP wire helpers (duplicated from test_mcp_test_cases.py) ----------------------------


def _mcp_initialize_request() -> dict:
    return {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "mcp5-test-client", "version": "0.0.1"}},
    }


def _mcp_initialized_notification() -> dict:
    return {"jsonrpc": "2.0", "method": "notifications/initialized"}


def _mcp_tool_call_request(name: str, arguments: dict, req_id: int = 3) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "method": "tools/call", "params": {"name": name, "arguments": arguments}}


def _bearer_headers(raw_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {raw_key}",
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }


async def _mcp_initialize(client: httpx.AsyncClient) -> None:
    init_response = await client.post(MCP_PATH, json=_mcp_initialize_request(), headers={"Accept": "application/json, text/event-stream"})
    assert init_response.status_code == 200, init_response.text
    notif_response = await client.post(
        MCP_PATH, json=_mcp_initialized_notification(), headers={"Accept": "application/json, text/event-stream"}
    )
    assert notif_response.status_code in (202, 200), notif_response.text


async def _mcp_call_tool(client: httpx.AsyncClient, raw_key: str, name: str, arguments: dict, req_id: int = 3) -> dict:
    response = await client.post(MCP_PATH, json=_mcp_tool_call_request(name, arguments, req_id=req_id), headers=_bearer_headers(raw_key))
    assert response.status_code == 200, f"HTTP {response.status_code}: {response.text}"
    body = response.json()
    assert "result" in body, f"missing result envelope: {body}"
    return body["result"]


def _extract_tool_payload(result: dict) -> dict:
    if "structuredContent" in result:
        return result["structuredContent"]
    for item in result.get("content", []):
        if item.get("type") == "text":
            return json.loads(item["text"])
    raise AssertionError(f"no parseable payload in tool result: {result!r}")


def _extract_tool_error(result: dict) -> dict:
    assert result.get("isError") is True, f"expected isError=True, got: {result!r}"
    for item in result.get("content", []):
        if item.get("type") == "text":
            text = item["text"]
            json_start = text.find("{")
            if json_start < 0:
                raise AssertionError(f"no JSON envelope in error text: {text!r}")
            return json.loads(text[json_start:])
    raise AssertionError(f"no error text in tool result: {result!r}")


# --- TC-MCP-018: `_actor_membership_exists` fix — AIAgent + User, same session --------------


@pytest.mark.asyncio
async def test_agent_reaches_generic_factory_and_user_via_rest_is_unaffected() -> None:  # TC-MCP-018
    """Before ADR-0065's fix, every generic-factory route 404'd for any
    `AIAgent` caller unconditionally, regardless of permissions. Asserts,
    in one session: the agent's `list_entities`/`create_entity` calls
    (`requirements`) now succeed, AND a `User` in the same org calling the
    equivalent REST route directly still gets the exact same success shape
    it always did — a fix that narrowed the `User` path while fixing the
    `AIAgent` one would fail this second half."""
    email = _unique_email("tc018")
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    role_ids: list = []
    agent_ids: list = []

    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            org = await _create_org(session, "mcp5-tc018")
            await _create_membership(session, user, org)
            project = await _create_project(session, org)
            requirement = await _create_requirement(session, project)

            create_perm = await _get_permission_by_code(session, "requirement.create")
            read_perm = await _get_permission_by_code(session, "requirement.read")
            role = await _create_role(session, org, "mcp5_tc018_role")
            await _grant_permission(session, role, create_perm)
            await _grant_permission(session, role, read_perm)
            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=user.actor_id, agent_name="TC-MCP-018 Agent")
            await _assign_role(session, actor_id=agent.actor_id, org=org, role=role)
            await _assign_role(session, actor_id=user.actor_id, org=org, role=role)
            await session.commit()

            user_ids, org_ids, project_ids, requirement_ids, role_ids, agent_ids = (
                [user.actor_id],
                [org.id],
                [project.id],
                [requirement.id],
                [role.id],
                [agent.actor_id],
            )
            project_id = project.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=30.0) as client:
            await _mcp_initialize(client)

            # --- AIAgent via MCP: previously always 404'd, must now succeed ---
            list_result = await _mcp_call_tool(client, raw_key, "list_entities", {"resource": "requirements", "scope": {"project_id": str(project_id)}})
            list_payload = _extract_tool_payload(list_result)
            assert list_payload["total"] == 1, list_payload
            assert list_payload["items"][0]["title"] == "MCP-5 Requirement"

            create_result = await _mcp_call_tool(
                client,
                raw_key,
                "create_entity",
                {"resource": "requirements", "fields": {"project_id": str(project_id), "title": "MCP-5 agent-created requirement", "description": "via MCP"}},
            )
            created_payload = _extract_tool_payload(create_result)
            assert created_payload["title"] == "MCP-5 agent-created requirement"
            requirement_ids.append(UUID(created_payload["id"]))

            # --- Same-session User path via REST, unaffected -----------------
            login_resp = await client.post(f"{API_PREFIX}/auth/login", json={"email": email, "password": DEFAULT_PASSWORD})
            assert login_resp.status_code == 200, login_resp.text
            access_token = login_resp.json()["access_token"]
            rest_resp = await client.get(
                f"{API_PREFIX}/requirements",
                params={"project_id": str(project_id)},
                headers={"Authorization": f"Bearer {access_token}"},
            )
            assert rest_resp.status_code == 200, rest_resp.text
            assert rest_resp.json()["total"] == 2, rest_resp.json()
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, requirement_ids=requirement_ids, role_ids=role_ids, agent_ids=agent_ids)


# --- TC-MCP-019: cross-tenant 404 boundary preserved ---------------------------------------


@pytest.mark.asyncio
async def test_get_entity_cross_tenant_returns_404_not_403() -> None:  # TC-MCP-019
    """AIAgent with `requirement.read` in Org A only: `get_entity` against a
    Requirement in Org B, AND `list_entities` scoped to Org B's own Project,
    both → `404`, never a `403` that would confirm either the row's or the
    scope's existence across the tenant boundary (NFR-1)."""
    email_a = _unique_email("tc019a")
    email_b = _unique_email("tc019b")
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    role_ids: list = []
    agent_ids: list = []

    try:
        async with AsyncSessionLocal() as session:
            user_a = await _create_user(session, email_a)
            org_a = await _create_org(session, "mcp5-tc019a")
            await _create_membership(session, user_a, org_a)
            project_a = await _create_project(session, org_a)

            user_b = await _create_user(session, email_b)
            org_b = await _create_org(session, "mcp5-tc019b")
            await _create_membership(session, user_b, org_b)
            project_b = await _create_project(session, org_b)
            requirement_b = await _create_requirement(session, project_b, title="Org B's own requirement")

            read_perm = await _get_permission_by_code(session, "requirement.read")
            role_a = await _create_role(session, org_a, "mcp5_tc019_role")
            await _grant_permission(session, role_a, read_perm)
            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=user_a.actor_id, agent_name="TC-MCP-019 Agent")
            await _assign_role(session, actor_id=agent.actor_id, org=org_a, role=role_a)
            await session.commit()

            user_ids, org_ids, project_ids, requirement_ids, role_ids, agent_ids = (
                [user_a.actor_id, user_b.actor_id],
                [org_a.id, org_b.id],
                [project_a.id, project_b.id],
                [requirement_b.id],
                [role_a.id],
                [agent.actor_id],
            )
            requirement_b_id, project_b_id = requirement_b.id, project_b.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=30.0) as client:
            await _mcp_initialize(client)
            get_result = await _mcp_call_tool(client, raw_key, "get_entity", {"resource": "requirements", "id": str(requirement_b_id)})
            assert _extract_tool_error(get_result)["code"] == "not_found"

            list_result = await _mcp_call_tool(client, raw_key, "list_entities", {"resource": "requirements", "scope": {"project_id": str(project_b_id)}}, req_id=4)
            assert _extract_tool_error(list_result)["code"] == "not_found"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, requirement_ids=requirement_ids, role_ids=role_ids, agent_ids=agent_ids)


# --- TC-MCP-016: generic dispatch across representative entity classes ---------------------


@pytest.mark.asyncio
async def test_generic_dispatch_across_tenant_generic_and_global_catalog_classes() -> None:  # TC-MCP-016
    """TC-MCP-016 literally: `list_entities`/`get_entity` for all 3 of
    `requirements` (tenant-scoped generic), `test-levels` (global catalog,
    `is_global_catalog=True`), and `requirement-test-case-links` (read-only
    link table); `create_entity`/`update_entity`/`delete_entity` for
    `requirements` only. The registry mechanism dispatches all 3 classes
    identically — this is not a per-entity special case."""
    email = _unique_email("tc016")
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    role_ids: list = []
    agent_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    test_case_ids: list = []

    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            org = await _create_org(session, "mcp5-tc016")
            await _create_membership(session, user, org)
            project = await _create_project(session, org)
            requirement = await _create_requirement(session, project)
            level = TestLevel(name=f"MCP-5 TC016 Level {uuid.uuid4().hex[:6]}")
            session.add(level)
            await session.flush()
            test_type = TestType(name=f"MCP-5 TC016 Type {uuid.uuid4().hex[:6]}")
            session.add(test_type)
            await session.flush()
            test_case = TestCase(
                test_level_id=level.id,
                test_type_id=test_type.id,
                created_by_actor_id=user.actor_id,
                title="MCP-5 TC016 direct-link TestCase",
                status=TestCaseStatus.draft,
            )
            session.add(test_case)
            await session.flush()
            link = RequirementTestCaseLink(requirement_id=requirement.id, test_case_id=test_case.id)
            session.add(link)
            await session.flush()

            perms = await _get_permission_by_codes(
                session,
                "requirement.create",
                "requirement.read",
                "requirement.update",
                "requirement.delete",
                "test_level.read",
                "requirement_test_case_link.read",
            )
            role = await _create_role(session, org, "mcp5_tc016_role")
            for perm in perms:
                await _grant_permission(session, role, perm)
            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=user.actor_id, agent_name="TC-MCP-016 Agent")
            await _assign_role(session, actor_id=agent.actor_id, org=org, role=role)
            await session.commit()

            user_ids, org_ids, project_ids, requirement_ids, role_ids, agent_ids, test_level_ids, test_type_ids, test_case_ids = (
                [user.actor_id],
                [org.id],
                [project.id],
                [requirement.id],
                [role.id],
                [agent.actor_id],
                [level.id],
                [test_type.id],
                [test_case.id],
            )
            requirement_id, level_id, link_id = requirement.id, level.id, link.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=30.0) as client:
            await _mcp_initialize(client)

            # --- list_entities + get_entity for all 3 named classes -----------

            # 1. requirements — tenant-scoped generic.
            req_list = await _mcp_call_tool(client, raw_key, "list_entities", {"resource": "requirements", "scope": {"project_id": str(requirement.project_id)}})
            req_list_payload = _extract_tool_payload(req_list)
            assert req_list_payload["total"] == 1
            req_get = await _mcp_call_tool(client, raw_key, "get_entity", {"resource": "requirements", "id": str(requirement_id)})
            assert _extract_tool_payload(req_get)["id"] == str(requirement_id)

            # 2. test-levels — global catalog, no scope field at all.
            level_list = await _mcp_call_tool(client, raw_key, "list_entities", {"resource": "test-levels"})
            level_list_payload = _extract_tool_payload(level_list)
            assert any(item["id"] == str(level_id) for item in level_list_payload["items"])
            level_get = await _mcp_call_tool(client, raw_key, "get_entity", {"resource": "test-levels", "id": str(level_id)})
            assert _extract_tool_payload(level_get)["id"] == str(level_id)

            # 3. requirement-test-case-links — read-only link table.
            link_list = await _mcp_call_tool(
                client, raw_key, "list_entities", {"resource": "requirement-test-case-links", "scope": {"requirement_id": str(requirement_id)}}
            )
            link_list_payload = _extract_tool_payload(link_list)
            assert link_list_payload["total"] == 1
            link_get = await _mcp_call_tool(client, raw_key, "get_entity", {"resource": "requirement-test-case-links", "id": str(link_id)})
            assert _extract_tool_payload(link_get)["id"] == str(link_id)

            # --- create_entity/update_entity/delete_entity for requirements only --

            create_result = await _mcp_call_tool(
                client, raw_key, "create_entity", {"resource": "requirements", "fields": {"project_id": str(requirement.project_id), "title": "MCP-5 TC016 created", "description": "x"}}
            )
            created_payload = _extract_tool_payload(create_result)
            created_id = created_payload["id"]

            update_result = await _mcp_call_tool(
                client, raw_key, "update_entity", {"resource": "requirements", "id": created_id, "fields": {"title": "MCP-5 TC016 updated"}}
            )
            assert _extract_tool_payload(update_result)["title"] == "MCP-5 TC016 updated"

            delete_result = await _mcp_call_tool(client, raw_key, "delete_entity", {"resource": "requirements", "id": created_id})
            assert _extract_tool_payload(delete_result) == {"status": "deleted"}
            confirm = await _mcp_call_tool(client, raw_key, "get_entity", {"resource": "requirements", "id": created_id})
            assert _extract_tool_error(confirm)["code"] == "not_found"

    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            role_ids=role_ids,
            agent_ids=agent_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
            test_case_ids=test_case_ids,
        )


# --- TC-MCP-022: `describe_entity` parity, including the unregistered-entity case ----------


@pytest.mark.asyncio
async def test_describe_entity_parity_with_rest_schema_route_and_release_404() -> None:  # TC-MCP-022
    """TC-MCP-022 literally: `describe_entity` for `requirement` returns the
    identical shape `GET /entities/requirements/schema` returns; for
    `release` (no `CrudEntityConfig` at all, ADR-0055) it returns the same
    `404 not_found` the REST route gives, not a distinct MCP-only error."""
    email = _unique_email("tc022")
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    agent_ids: list = []

    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            org = await _create_org(session, "mcp5-tc022")
            await _create_membership(session, user, org)
            role = await _create_role(session, org, "mcp5_tc022_role")
            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=user.actor_id, agent_name="TC-MCP-022 Agent")
            await _assign_role(session, actor_id=agent.actor_id, org=org, role=role)
            await session.commit()
            user_ids, org_ids, role_ids, agent_ids = [user.actor_id], [org.id], [role.id], [agent.actor_id]

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=30.0) as client:
            await _mcp_initialize(client)

            schema_result = await _mcp_call_tool(client, raw_key, "describe_entity", {"resource": "requirements"})
            schema_payload = _extract_tool_payload(schema_result)
            rest_schema_resp = await client.get(f"{API_PREFIX}/entities/requirements/schema", headers=_bearer_headers(raw_key))
            assert rest_schema_resp.status_code == 200, rest_schema_resp.text
            assert schema_payload == rest_schema_resp.json()

            release_result = await _mcp_call_tool(client, raw_key, "describe_entity", {"resource": "releases"}, req_id=4)
            release_error = _extract_tool_error(release_result)
            rest_release_resp = await client.get(f"{API_PREFIX}/entities/releases/schema", headers=_bearer_headers(raw_key))
            assert rest_release_resp.status_code == 404
            assert release_error["code"] == "not_found" == rest_release_resp.json()["code"]
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, role_ids=role_ids, agent_ids=agent_ids)


# --- TC-MCP-017: method-gating parity (live) ------------------------------------------------


@pytest.mark.asyncio
async def test_create_entity_rejected_for_an_entity_with_no_create_method() -> None:  # TC-MCP-017
    """TC-MCP-017 literally (corrected 2026-09-14, then again 2026-09-15
    after REQ-5/ADR-0068 gave `test-cases` a genuine `list_entities`/
    `create_entity` — see the TC's own note): `releases` has no
    `list_entities` at all (100% bespoke, no generic `CrudEntityConfig`),
    `test-logs` has no `update_entity` (immutable), and a link table
    (`requirement-test-case-links`) has no `create_entity` (read-only) —
    all three get the exact `405`/`{"detail": "Method Not Allowed"}` shape
    a REST client hitting the unregistered method would."""
    email = _unique_email("tc017")
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    agent_ids: list = []

    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            org = await _create_org(session, "mcp5-tc017")
            await _create_membership(session, user, org)
            role = await _create_role(session, org, "mcp5_tc017_role")
            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=user.actor_id, agent_name="TC-MCP-017 Agent")
            await _assign_role(session, actor_id=agent.actor_id, org=org, role=role)
            await session.commit()
            user_ids, org_ids, role_ids, agent_ids = [user.actor_id], [org.id], [role.id], [agent.actor_id]

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=30.0) as client:
            await _mcp_initialize(client)

            list_result = await _mcp_call_tool(client, raw_key, "list_entities", {"resource": "releases"})
            assert _extract_tool_error(list_result) == {"detail": "Method Not Allowed"}

            update_result = await _mcp_call_tool(
                client, raw_key, "update_entity", {"resource": "test-logs", "id": str(uuid.uuid4()), "fields": {"event_type": "comment"}}, req_id=4
            )
            assert _extract_tool_error(update_result) == {"detail": "Method Not Allowed"}

            create_result = await _mcp_call_tool(
                client, raw_key, "create_entity", {"resource": "requirement-test-case-links", "fields": {}}, req_id=5
            )
            assert _extract_tool_error(create_result) == {"detail": "Method Not Allowed"}
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, role_ids=role_ids, agent_ids=agent_ids)


# --- TC-MCP-020: `RiskItem` branching-scope parity ------------------------------------------


@pytest.mark.asyncio
async def test_create_entity_risk_item_rejects_both_and_neither_scope_fields() -> None:  # TC-MCP-020
    email = _unique_email("tc020")
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    role_ids: list = []
    agent_ids: list = []
    risk_item_ids: list = []

    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            org = await _create_org(session, "mcp5-tc020")
            await _create_membership(session, user, org)
            project = await _create_project(session, org)
            requirement = await _create_requirement(session, project)
            create_perm = await _get_permission_by_code(session, "risk_item.create")
            role = await _create_role(session, org, "mcp5_tc020_role")
            await _grant_permission(session, role, create_perm)
            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=user.actor_id, agent_name="TC-MCP-020 Agent")
            await _assign_role(session, actor_id=agent.actor_id, org=org, role=role)
            await session.commit()
            user_ids, org_ids, project_ids, requirement_ids, role_ids, agent_ids = (
                [user.actor_id], [org.id], [project.id], [requirement.id], [role.id], [agent.actor_id],
            )
            requirement_id = requirement.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=30.0) as client:
            await _mcp_initialize(client)

            neither_result = await _mcp_call_tool(
                client, raw_key, "create_entity",
                {"resource": "risk-items", "fields": {"description": "x", "likelihood": "low", "impact": "low"}},
            )
            assert _extract_tool_error(neither_result)["code"] == "validation_error"

            both_result = await _mcp_call_tool(
                client, raw_key, "create_entity",
                {"resource": "risk-items", "fields": {"requirement_id": str(requirement_id), "test_plan_id": str(uuid.uuid4()), "description": "x", "likelihood": "low", "impact": "low"}},
            )
            assert _extract_tool_error(both_result)["code"] == "validation_error"

            ok_result = await _mcp_call_tool(
                client, raw_key, "create_entity",
                {"resource": "risk-items", "fields": {"requirement_id": str(requirement_id), "description": "Real risk", "likelihood": "high", "impact": "medium"}},
            )
            ok_payload = _extract_tool_payload(ok_result)
            assert ok_payload["requirement_id"] == str(requirement_id)
            risk_item_ids = [UUID(ok_payload["id"])]
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, requirement_ids=requirement_ids, role_ids=role_ids, agent_ids=agent_ids, risk_item_ids=risk_item_ids)


# --- TC-MCP-021: bespoke-create dispatch preserves the underlying route's own boundary -----


@pytest.mark.asyncio
async def test_bespoke_create_entity_test_execution_preserves_plan3_scope_check() -> None:  # TC-MCP-021
    """TC-MCP-021 literally: a `TestCase` that IS a real member of a real
    `TestSuite`, but that suite is not one this `TestCycle`'s own `TestPlan`
    includes — `create_entity("test-executions", ...)` must still `422
    validation_error` (the PLAN-3 scope-check rejection, FR-PLAN-3 AC3),
    proving `create_execution_for_cycle`'s own business-rule logic runs
    unchanged through the registry's bespoke dispatch, not silently
    bypassed by routing through `create_entity` instead of a dedicated
    per-route tool. Also covers the two boundary-adjacent cases (missing
    field -> `422` schema validation; nonexistent `test_cycle_id` -> `404`)
    as bonus, cheaper-to-construct edge cases."""
    email = _unique_email("tc021")
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    role_ids: list = []
    agent_ids: list = []
    test_case_ids: list = []
    test_suite_ids: list = []
    test_plan_ids: list = []
    test_cycle_ids: list = []
    release_ids: list = []
    environment_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []

    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            org = await _create_org(session, "mcp5-tc021")
            await _create_membership(session, user, org)
            project = await _create_project(session, org)
            requirement = await _create_requirement(session, project)

            level = TestLevel(name=f"MCP-5 TC021 Level {uuid.uuid4().hex[:6]}")
            session.add(level)
            test_type = TestType(name=f"MCP-5 TC021 Type {uuid.uuid4().hex[:6]}")
            session.add(test_type)
            await session.flush()

            # The out-of-scope `TestCase`: real member of a real `TestSuite`,
            # same project/org as everything else — this is what keeps the
            # rejection on the `422` scope branch rather than the `404`
            # tenant boundary (same reasoning TC-PLAN-008's own precedent
            # fixture, `test_plan3_test_cycle_execution.py`, documents).
            test_case = TestCase(
                test_level_id=level.id,
                test_type_id=test_type.id,
                created_by_actor_id=user.actor_id,
                title="MCP-5 TC021 out-of-scope TestCase",
                status=TestCaseStatus.draft,
            )
            session.add(test_case)
            await session.flush()
            session.add(RequirementTestCaseLink(requirement_id=requirement.id, test_case_id=test_case.id))

            excluded_suite = TestSuite(project_id=project.id, name="MCP-5 TC021 excluded suite")
            session.add(excluded_suite)
            await session.flush()
            session.add(TestSuiteTestCase(test_suite_id=excluded_suite.id, test_case_id=test_case.id))

            plan = TestPlan(project_id=project.id, created_by_actor_id=user.actor_id, identifier="MCP-5 TC021 Plan")
            session.add(plan)
            release = Release(project_id=project.id, version_label="MCP-5 TC021 Release")
            session.add(release)
            environment = Environment(project_id=project.id, name="MCP-5 TC021 Environment")
            session.add(environment)
            await session.flush()
            # Deliberately no `TestPlanTestSuite` row at all — the plan
            # includes zero suites, so `excluded_suite` (and therefore
            # `test_case`) is out of scope no matter which suite it's in.
            cycle = TestCycle(test_plan_id=plan.id, release_id=release.id, environment_id=environment.id, name="MCP-5 TC021 Cycle")
            session.add(cycle)
            await session.flush()

            create_perm = await _get_permission_by_code(session, "test_execution.create")
            role = await _create_role(session, org, "mcp5_tc021_role")
            await _grant_permission(session, role, create_perm)
            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=user.actor_id, agent_name="TC-MCP-021 Agent")
            await _assign_role(session, actor_id=agent.actor_id, org=org, role=role)
            await session.commit()

            (
                user_ids, org_ids, project_ids, requirement_ids, role_ids, agent_ids,
                test_case_ids, test_suite_ids, test_plan_ids, test_cycle_ids,
                release_ids, environment_ids, test_level_ids, test_type_ids,
            ) = (
                [user.actor_id], [org.id], [project.id], [requirement.id], [role.id], [agent.actor_id],
                [test_case.id], [excluded_suite.id], [plan.id], [cycle.id],
                [release.id], [environment.id], [level.id], [test_type.id],
            )
            test_case_id, cycle_id = test_case.id, cycle.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=30.0) as client:
            await _mcp_initialize(client)

            # --- TC-MCP-021's own literal claim: PLAN-3 scope-check 422 -------
            scope_result = await _mcp_call_tool(
                client, raw_key, "create_entity",
                {
                    "resource": "test-executions",
                    "fields": {
                        "test_cycle_id": str(cycle_id),
                        "test_case_id": str(test_case_id),
                        "result": "pass",
                        "actual_result": "Should be rejected — out of plan scope.",
                        "executed_at": datetime.now(UTC).isoformat(),
                    },
                },
            )
            scope_error = _extract_tool_error(scope_result)
            assert scope_error["code"] == "validation_error"
            assert scope_error["message"] == "This test case is not in scope for this test cycle's test plan."

            # --- Bonus boundary-adjacent cases ---------------------------------
            missing_field_result = await _mcp_call_tool(
                client, raw_key, "create_entity", {"resource": "test-executions", "fields": {"test_case_id": str(uuid.uuid4()), "result": "pass"}}, req_id=5
            )
            assert _extract_tool_error(missing_field_result)["code"] == "validation_error"

            not_found_result = await _mcp_call_tool(
                client, raw_key, "create_entity",
                {
                    "resource": "test-executions",
                    "fields": {
                        "test_cycle_id": str(uuid.uuid4()),
                        "test_case_id": str(uuid.uuid4()),
                        "result": "pass",
                        "executed_at": datetime.now(UTC).isoformat(),
                    },
                },
                req_id=6,
            )
            assert _extract_tool_error(not_found_result)["code"] == "not_found"
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            role_ids=role_ids,
            agent_ids=agent_ids,
            test_case_ids=test_case_ids,
            test_suite_ids=test_suite_ids,
            test_plan_ids=test_plan_ids,
            test_cycle_ids=test_cycle_ids,
            release_ids=release_ids,
            environment_ids=environment_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )
