"""Integration tests for full CRUD over every entity via MCP.

Originally `test_mcp5_generic_crud.py` (MCP-5/ADR-0065, six reflective
`resource`-parameterised tools); renamed and updated in place for MCP-6/
ADR-0068's per-entity surface. Every test's *coverage claim* is unchanged —
these are still MCP-5's own TC-MCP-016..022 rows, and the dispatch path
under test (registry executor → direct call into the REST route handler) is
byte-for-byte the same. What changed is only how each call is addressed:
`("create_entity", {"resource": "requirements", "fields": {...}})` became
`("tn_requirement_create", {"fields": {...}})`.

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
from app.models.assets import Requirement, TestCase, TestCaseStatus, TestCondition, TestConditionPriority, TestSuite, TestSuiteTestCase
from app.models.auth import AuthIdentity, AuthProvider, RefreshToken
from app.models.governance import RiskItem
from app.models.planning import Environment, TestCycle, TestPlan, TestPlanTestSuite
from app.models.project import Project, Release
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission
from app.models.taxonomy import TestLevel, TestType
from app.models.trace import RequirementTestCaseLink, RequirementTestConditionLink, TestConditionTestCaseLink
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
    test_condition_ids: list | None = None,
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
    test_condition_ids = test_condition_ids or []
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
            await session.execute(delete(TestConditionTestCaseLink).where(TestConditionTestCaseLink.test_case_id.in_(test_case_ids)))
            await session.execute(delete(TestCase).where(TestCase.id.in_(test_case_ids)))
        if test_condition_ids:
            # REQ-3 rigor-path chain: both of a TestCondition's link tables must
            # go before the row itself, and the TestCase rows it points at are
            # cleaned by `test_case_ids` above (so pass both, children first).
            await session.execute(delete(TestConditionTestCaseLink).where(TestConditionTestCaseLink.test_condition_id.in_(test_condition_ids)))
            await session.execute(delete(RequirementTestConditionLink).where(RequirementTestConditionLink.test_condition_id.in_(test_condition_ids)))
            await session.execute(delete(TestCondition).where(TestCondition.id.in_(test_condition_ids)))
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


async def _mcp_tool_names(client: httpx.AsyncClient, raw_key: str, req_id: int = 2) -> set[str]:
    """The advertised tool surface, as a real MCP client sees it.

    ADR-0068 makes this the primary way an unsupported entity/action pair is
    asserted: the pair has no `tn_<resource>_<action>` tool at all, so there
    is no call to make and no error envelope to inspect — the absence *is* the
    contract (a strictly stronger form of MCP-5's "MCP never grants a
    capability REST doesn't have" AC, which previously refused the call at
    dispatch time with a `405` envelope)."""
    response = await client.post(
        MCP_PATH, json={"jsonrpc": "2.0", "id": req_id, "method": "tools/list", "params": {}}, headers=_bearer_headers(raw_key)
    )
    assert response.status_code == 200, f"HTTP {response.status_code}: {response.text}"
    return {tool["name"] for tool in response.json()["result"]["tools"]}


def _extract_unknown_tool_error(result: dict, name: str) -> str:
    """FastMCP's own rejection for a name it never registered.

    Asserts the *form* as well as the content, because "not this app's envelope"
    is half of TC-MCP-017/022's own literal expected result: the text must be
    the SDK's plain-text `Unknown tool: <name>`, and must NOT parse as this
    project's API Doc §1 `{code, message, field_errors}` envelope — the request
    never reaches application code, so §1's parity contract does not apply. A
    bare `name in text` check would pass on a JSON envelope that happened to
    mention the tool, which is exactly the outcome this asserts against."""
    assert result.get("isError") is True, f"expected isError=True, got: {result!r}"
    for item in result.get("content", []):
        if item.get("type") == "text":
            text = item["text"]
            assert "Unknown tool" in text, f"expected the SDK's plain-text unknown-tool rejection, got: {text!r}"
            assert name in text, f"rejection does not name the tool: {text!r}"
            assert "{" not in text, f"expected plain text, not a JSON envelope: {text!r}"
            return text
    raise AssertionError(f"no error text in tool result: {result!r}")


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
    in one session: the agent's `tn_requirement_list`/`tn_requirement_create` calls
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
            list_result = await _mcp_call_tool(client, raw_key, "tn_requirement_list", {"scope": {"project_id": str(project_id)}})
            list_payload = _extract_tool_payload(list_result)
            assert list_payload["total"] == 1, list_payload
            assert list_payload["items"][0]["title"] == "MCP-5 Requirement"

            create_result = await _mcp_call_tool(
                client,
                raw_key,
                "tn_requirement_create",
                {"fields": {"project_id": str(project_id), "title": "MCP-5 agent-created requirement", "description": "via MCP"}},
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

            # TC-MCP-018's Expected result says the User's own result is
            # byte-identical to its pre-fix behaviour, "same 200/201 it always
            # got" — the `200` above is only half of that. The `_actor_membership_exists`
            # swap touches `_resolve_scope_for_write` (the create/list scope gate)
            # as much as `_fetch_and_gate`, so a `User`-path narrowing would show
            # up on the write gate specifically, which a read-only assertion
            # cannot see. Same role, same session, same actor set.
            rest_create = await client.post(
                f"{API_PREFIX}/requirements",
                json={"project_id": str(project_id), "title": "MCP-5 user-created requirement", "description": "via REST"},
                headers={"Authorization": f"Bearer {access_token}"},
            )
            assert rest_create.status_code == 201, rest_create.text
            requirement_ids.append(UUID(rest_create.json()["id"]))
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, requirement_ids=requirement_ids, role_ids=role_ids, agent_ids=agent_ids)


# --- TC-MCP-019: cross-tenant 404 boundary preserved ---------------------------------------


@pytest.mark.asyncio
async def test_get_entity_cross_tenant_returns_404_not_403() -> None:  # TC-MCP-019
    """AIAgent with `requirement.read` in Org A only: `tn_requirement_get` against a
    Requirement in Org B, AND `tn_requirement_list` scoped to Org B's own Project,
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
            get_result = await _mcp_call_tool(client, raw_key, "tn_requirement_get", {"id": str(requirement_b_id)})
            assert _extract_tool_error(get_result)["code"] == "not_found"

            list_result = await _mcp_call_tool(client, raw_key, "tn_requirement_list", {"scope": {"project_id": str(project_b_id)}}, req_id=4)
            assert _extract_tool_error(list_result)["code"] == "not_found"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, requirement_ids=requirement_ids, role_ids=role_ids, agent_ids=agent_ids)


# --- TC-MCP-016: generic dispatch across representative entity classes ---------------------


@pytest.mark.asyncio
async def test_generic_dispatch_across_tenant_generic_and_global_catalog_classes() -> None:  # TC-MCP-016
    """TC-MCP-016 literally: `tn_<entity>_list`/`tn_<entity>_get` for all 3 of
    `requirements` (tenant-scoped generic), `test-levels` (global catalog,
    `is_global_catalog=True`), and `requirement-test-case-links` (read-only
    link table); `tn_requirement_create`/`_update`/`_delete` for
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

            # --- list + get for all 3 named entity classes --------------------

            # 1. requirements — tenant-scoped generic.
            req_list = await _mcp_call_tool(client, raw_key, "tn_requirement_list", {"scope": {"project_id": str(requirement.project_id)}})
            req_list_payload = _extract_tool_payload(req_list)
            assert req_list_payload["total"] == 1
            req_get = await _mcp_call_tool(client, raw_key, "tn_requirement_get", {"id": str(requirement_id)})
            assert _extract_tool_payload(req_get)["id"] == str(requirement_id)

            # 2. test-levels — global catalog, no scope field at all.
            level_list = await _mcp_call_tool(client, raw_key, "tn_test_level_list", {})
            level_list_payload = _extract_tool_payload(level_list)
            assert any(item["id"] == str(level_id) for item in level_list_payload["items"])
            level_get = await _mcp_call_tool(client, raw_key, "tn_test_level_get", {"id": str(level_id)})
            assert _extract_tool_payload(level_get)["id"] == str(level_id)

            # 3. requirement-test-case-links — read-only link table.
            link_list = await _mcp_call_tool(
                client, raw_key, "tn_requirement_test_case_link_list", {"scope": {"requirement_id": str(requirement_id)}}
            )
            link_list_payload = _extract_tool_payload(link_list)
            assert link_list_payload["total"] == 1
            link_get = await _mcp_call_tool(client, raw_key, "tn_requirement_test_case_link_get", {"id": str(link_id)})
            assert _extract_tool_payload(link_get)["id"] == str(link_id)

            # --- create/update/delete for requirements only --------------------

            create_result = await _mcp_call_tool(
                client, raw_key, "tn_requirement_create", {"fields": {"project_id": str(requirement.project_id), "title": "MCP-5 TC016 created", "description": "x"}}
            )
            created_payload = _extract_tool_payload(create_result)
            created_id = created_payload["id"]

            update_result = await _mcp_call_tool(
                client, raw_key, "tn_requirement_update", {"id": created_id, "fields": {"title": "MCP-5 TC016 updated"}}
            )
            assert _extract_tool_payload(update_result)["title"] == "MCP-5 TC016 updated"

            # --- TC-MCP-016's second Expected-result clause: "response shape
            # matches the REST route's own schema VERBATIM (no divergent
            # MCP-only contract)". Every assertion above compares against a
            # literal, which proves the call worked but says nothing about
            # shape parity — a divergent MCP serializer producing the same
            # `title` would pass all of them. Fetch the same rows over REST and
            # diff the whole payload, for all three named entity classes, not
            # just the one this block happens to mutate.
            for tool, rest_path, row_id in (
                ("tn_requirement_get", f"{API_PREFIX}/requirements/{created_id}", created_id),
                ("tn_test_level_get", f"{API_PREFIX}/test-levels/{level_id}", str(level_id)),
                ("tn_requirement_test_case_link_get", f"{API_PREFIX}/requirement-test-case-links/{link_id}", str(link_id)),
            ):
                mcp_payload = _extract_tool_payload(await _mcp_call_tool(client, raw_key, tool, {"id": row_id}))
                rest_resp = await client.get(rest_path, headers=_bearer_headers(raw_key))
                assert rest_resp.status_code == 200, rest_resp.text
                assert mcp_payload == rest_resp.json(), f"{tool} diverges from {rest_path}"

            delete_result = await _mcp_call_tool(client, raw_key, "tn_requirement_delete", {"id": created_id})
            assert _extract_tool_payload(delete_result) == {"status": "deleted"}
            confirm = await _mcp_call_tool(client, raw_key, "tn_requirement_get", {"id": created_id})
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


# --- TC-MCP-022: `describe` parity, including the no-config-entity case --------------------


@pytest.mark.asyncio
async def test_describe_tool_parity_with_rest_schema_route_and_release_has_none() -> None:  # TC-MCP-022
    """TC-MCP-022, corrected for ADR-0068: `tn_requirement_describe` returns the
    identical shape `GET /entities/requirements/schema` returns.

    The TC's second half needed a real correction, not just a rename. Its
    original wording — "`describe_entity` for `release` returns the same
    `404 not_found` the REST route gives" — described the reflective tool,
    where `resource` was a runtime argument that could name an entity with no
    `CrudEntityConfig`. Under ADR-0068 `describe` is generated only for the 27
    entities that *have* a config, so `tn_release_describe` is never
    registered: the claim's intent (a client cannot obtain a schema for
    `release` over MCP, exactly as REST cannot) now holds by the tool's
    absence, and asserting an error envelope from a call would be asserting
    FastMCP's own unknown-tool string, not this app's behaviour. Both halves
    are checked below — absence from `tools/list`, and REST's own unchanged
    `404` — rather than either being dropped."""
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

            schema_result = await _mcp_call_tool(client, raw_key, "tn_requirement_describe", {})
            schema_payload = _extract_tool_payload(schema_result)
            rest_schema_resp = await client.get(f"{API_PREFIX}/entities/requirements/schema", headers=_bearer_headers(raw_key))
            assert rest_schema_resp.status_code == 200, rest_schema_resp.text
            assert schema_payload == rest_schema_resp.json()

            # `release` has no config -> no describe tool is advertised at all.
            tool_names = await _mcp_tool_names(client, raw_key, req_id=4)
            assert "tn_requirement_describe" in tool_names
            assert "tn_release_describe" not in tool_names
            assert not any(name.startswith("tn_release_") and name.endswith("_describe") for name in tool_names)

            # ...and REST's own answer for the same question is unchanged.
            rest_release_resp = await client.get(f"{API_PREFIX}/entities/releases/schema", headers=_bearer_headers(raw_key))
            assert rest_release_resp.status_code == 404
            assert rest_release_resp.json()["code"] == "not_found"

            # Calling the unregistered name anyway is rejected by the SDK before
            # reaching any app code — asserted explicitly so the "never
            # advertised" claim isn't silently weaker than it reads.
            release_result = await _mcp_call_tool(client, raw_key, "tn_release_describe", {}, req_id=5)
            _extract_unknown_tool_error(release_result, "tn_release_describe")
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, role_ids=role_ids, agent_ids=agent_ids)


# --- TC-MCP-017: method-gating parity (live) ------------------------------------------------


@pytest.mark.asyncio
async def test_no_tool_is_advertised_for_a_method_the_entity_does_not_support() -> None:  # TC-MCP-017
    """TC-MCP-017, corrected a second time for ADR-0068.

    Two things changed, both real corrections rather than renames:

    1. The refusal *mechanism*. ADR-0065 refused an unsupported entity/action
       pair at dispatch time with `405`/`{"detail": "Method Not Allowed"}`.
       ADR-0068 never advertises the pair, so the assertion is absence from
       `tools/list` (plus the SDK's own unknown-tool rejection if called
       anyway) — the capability is not merely refused, it does not exist.
    2. One of the TC's three named examples stopped being true. `test_case`
       *does* now have a `list` (`tn_test_case_list`), because ADR-0068 folded
       MCP-1's own nested `list_test_cases` into the naming scheme — REST has
       always had that route, it simply had no generic-factory `list` row.
       Replaced with `permission` (global catalog, genuinely read-only via the
       factory) so the TC still names three real, still-unsupported pairs:
       `test_log.update` (immutable), `requirement_test_case_link.create`
       (link tables are read-only), `permission.delete`.

    Also asserts the positive side of each: the entity is reachable for the
    methods it *does* support, so a missing tool proves method-gating rather
    than a wholesale registration failure."""
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

            tool_names = await _mcp_tool_names(client, raw_key)

            unsupported = {
                "tn_test_log_update",  # TestLog is get/list/create(comment) only — immutable otherwise
                "tn_test_log_delete",
                "tn_requirement_test_case_link_create",  # link tables are read-only
                "tn_requirement_test_case_link_update",
                "tn_requirement_test_case_link_delete",
                "tn_permission_create",  # global catalog, read-only via the factory
                "tn_permission_update",
                "tn_permission_delete",
            }
            assert unsupported.isdisjoint(tool_names), sorted(unsupported & tool_names)

            # Positive control: each of those three entities IS reachable for
            # the methods REST does grant it — so the absences above are
            # method-gating, not a whole entity failing to register.
            supported = {
                "tn_test_log_get",
                "tn_test_log_list",
                "tn_test_log_create",  # the bespoke POST /executions/{id}/comments route
                "tn_requirement_test_case_link_get",
                "tn_requirement_test_case_link_list",
                "tn_permission_get",
                "tn_permission_list",
                "tn_test_case_list",  # folded in from MCP-1's nested list — see this test's docstring
            }
            assert supported <= tool_names, sorted(supported - tool_names)

            # Calling an unadvertised name is rejected by the SDK itself.
            update_result = await _mcp_call_tool(
                client, raw_key, "tn_test_log_update", {"id": str(uuid.uuid4()), "fields": {"event_type": "comment"}}, req_id=4
            )
            _extract_unknown_tool_error(update_result, "tn_test_log_update")

            create_result = await _mcp_call_tool(
                client, raw_key, "tn_requirement_test_case_link_create", {"fields": {}}, req_id=5
            )
            _extract_unknown_tool_error(create_result, "tn_requirement_test_case_link_create")
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
                client, raw_key, "tn_risk_item_create",
                {"fields": {"description": "x", "likelihood": "low", "impact": "low"}},
            )
            neither_error = _extract_tool_error(neither_result)
            assert neither_error["code"] == "validation_error"
            # TC-MCP-020's literal claim is the "exactly one, both/neither is
            # invalid" rule specifically — `code == "validation_error"` alone
            # cannot distinguish it from any other validation failure, so pin
            # the rule's own field_errors (same discipline TC-MCP-021's test
            # applies by asserting its exact scope-check message).
            # `scope_validation_error` (crud_factory.py) keys the error by the
            # scope's own `primary_field` only ("requirement_id" — the first
            # candidate), never by every candidate field, for both the
            # "neither present" and "both present" cases below.
            assert set(neither_error["field_errors"]) == {"requirement_id"}, neither_error

            both_result = await _mcp_call_tool(
                client, raw_key, "tn_risk_item_create",
                {"fields": {"requirement_id": str(requirement_id), "test_plan_id": str(uuid.uuid4()), "description": "x", "likelihood": "low", "impact": "low"}},
            )
            both_error = _extract_tool_error(both_result)
            assert both_error["code"] == "validation_error"
            # The both-case passes a syntactically valid but nonexistent
            # `test_plan_id`; without this the test would still pass if a guard
            # reordering made it fail for "no such test plan" instead of the
            # branching-scope rule the TC actually names.
            assert set(both_error["field_errors"]) == {"requirement_id"}, both_error

            ok_result = await _mcp_call_tool(
                client, raw_key, "tn_risk_item_create",
                {"fields": {"requirement_id": str(requirement_id), "description": "Real risk", "likelihood": "high", "impact": "medium"}},
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
    includes — `tn_test_execution_create(fields={...})` must still `422
    validation_error` (the PLAN-3 scope-check rejection, FR-PLAN-3 AC3),
    proving `create_execution_for_cycle`'s own business-rule logic runs
    unchanged through the registry's bespoke dispatch, not silently
    bypassed by routing through the generated create tool instead of a dedicated
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
                client, raw_key, "tn_test_execution_create",
                {
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
                client, raw_key, "tn_test_execution_create", {"fields": {"test_case_id": str(uuid.uuid4()), "result": "pass"}}, req_id=5
            )
            assert _extract_tool_error(missing_field_result)["code"] == "validation_error"

            not_found_result = await _mcp_call_tool(
                client, raw_key, "tn_test_execution_create",
                {
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


# --- ADR-0068 Decision §5: the rigor-path branch `tn_test_case_create` gained ---------------


@pytest.mark.asyncio
async def test_tn_test_case_create_dispatches_the_rigor_path_when_given_a_test_condition_id() -> None:
    """ADR-0068 Decision §5 calls folding MCP-1's `create_test_case` into
    `tn_test_case_create` "a strict capability gain, not a port," because the
    registry executor supports **both** REQ-2's direct-link path and REQ-3's
    rigor path, while the hand-wired tool only ever shipped the former (that
    omission is ADR-0033's own documented Drift note).

    Nothing tested that claim. Every other MCP create in this suite passes
    `requirement_id`, so the `test_condition_id` branch in
    `tool_registry._test_case_create` — the one clause the ADR advertises as
    *new* — had zero coverage, which is exactly the "an ADR claims a capability
    nothing exercises" gap this repo's own ADR-vs-implementation-drift
    convention exists to surface.

    Asserts the branch is genuinely taken, not merely that a row appears: the
    created `TestCase` must carry `test_condition_id` (the direct-link path
    leaves it null), its link row must be a `TestConditionTestCaseLink` and
    **not** a `RequirementTestCaseLink`, and `status` must be `draft` — which
    the rigor route forces regardless of input, per ADR-0028.
    """
    email = _unique_email("adr67rigor")
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    role_ids: list = []
    agent_ids: list = []

    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            org = await _create_org(session, "adr67-rigor")
            await _create_membership(session, user, org)
            project = await _create_project(session, org)
            requirement = await _create_requirement(session, project, title="ADR-0068 rigor-path requirement")
            condition = TestCondition(
                requirement_id=requirement.id,
                description="ADR-0068 rigor-path condition",
                priority=TestConditionPriority.medium,
            )
            session.add(condition)
            await session.flush()
            level = TestLevel(name=f"ADR67 level {uuid.uuid4().hex[:8]}")
            type_ = TestType(name=f"ADR67 type {uuid.uuid4().hex[:8]}")
            session.add_all([level, type_])
            await session.flush()
            role = await _create_role(session, org, "adr67_rigor_role")
            for code in ("test_case.create", "test_case.read"):
                await _grant_permission(session, role, await _get_permission_by_code(session, code))
            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=user.actor_id, agent_name="ADR-0068 Rigor Agent")
            await _assign_role(session, actor_id=agent.actor_id, org=org, role=role)
            await session.commit()
            user_ids, org_ids, project_ids = [user.actor_id], [org.id], [project.id]
            requirement_ids, test_condition_ids = [requirement.id], [condition.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            role_ids, agent_ids = [role.id], [agent.actor_id]
            condition_id, level_id, type_id = condition.id, level.id, type_.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=30.0) as client:
            await _mcp_initialize(client)

            result = await _mcp_call_tool(
                client,
                raw_key,
                "tn_test_case_create",
                {
                    "fields": {
                        "test_condition_id": str(condition_id),
                        "title": "ADR-0068 rigor-path test case",
                        "test_level_id": str(level_id),
                        "test_type_id": str(type_id),
                    }
                },
            )
            payload = _extract_tool_payload(result)
            test_case_ids.append(UUID(payload["id"]))

            # The rigor branch stamps `test_condition_id`; the direct-link
            # branch leaves it null. This is the assertion that proves which
            # of the two executor branches actually ran.
            assert payload["test_condition_id"] == str(condition_id), payload
            assert payload["status"] == "draft", payload  # ADR-0028: always draft on this route

            # And the link table written is the rigor path's, not REQ-2's.
            async with AsyncSessionLocal() as session:
                rigor_links = (await session.execute(
                    select(TestConditionTestCaseLink).where(TestConditionTestCaseLink.test_case_id == UUID(payload["id"]))
                )).scalars().all()
                direct_links = (await session.execute(
                    select(RequirementTestCaseLink).where(RequirementTestCaseLink.test_case_id == UUID(payload["id"]))
                )).scalars().all()
            assert len(rigor_links) == 1, rigor_links
            assert rigor_links[0].test_condition_id == condition_id
            assert direct_links == [], "rigor path must not also write REQ-2's direct link"

            # Round-trip read (backend/CLAUDE.md's resolver-completeness rule:
            # a create-only assertion cannot catch an unresolvable-tenant 404
            # on the very next read, which is exactly what ADR-0029 fixed for
            # this entity's *other* create path).
            read_back = _extract_tool_payload(await _mcp_call_tool(client, raw_key, "tn_test_case_get", {"id": payload["id"]}, req_id=4))
            assert read_back == payload
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_case_ids=test_case_ids,
            test_condition_ids=test_condition_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
            role_ids=role_ids,
            agent_ids=agent_ids,
        )

