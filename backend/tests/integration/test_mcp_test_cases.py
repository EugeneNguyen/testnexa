"""Integration tests for MCP-1 (Agent creates and lists TestCases via MCP, ADR-0033).

Real HTTP requests via `httpx.AsyncClient` against a live FastAPI server
mounting the MCP surface at `/mcp` (ADR-0033), matching the style of
`test_agents.py`. The package-level `tests/integration/conftest.py`
fixture (`_require_live_server`, autouse=True, session-scoped) applies
automatically to this module too.

Covers the MCP-1-scoped cases from `docs/test-cases/2026-09-03-test-cases.md`:
TC-MCP-001 (create + list via MCP, same validation/permission path as REST),
TC-MCP-002 (MCP-originated write stamps `created_by_actor_id` = AIAgent;
`acting_on_behalf_of_user_id` preserves accountability), TC-MCP-003
(MCP/REST response shape parity — fetch same TestCase via REST, identical
field set). MCP-1 AC1's "same permission check" also gets an explicit
cross-org negative test — an AIAgent scoped to one project's `test_case.create`
must 403 when called against a different project's Requirement, the same
shape the REST route returns (no separate, weaker path for MCP).

Each test seeds its own `User`/`Organization`/`OrgMembership`/`AIAgent`/
`Project`/`Requirement`/`TestLevel`/`TestType`/`Role`/`Permission`/
`RoleAssignment` rows directly via `AsyncSessionLocal` (the test process
shares `DATABASE_URL` with the live server under test), the same
fixture-seeding precedent `test_agents.py` established for the
agent-bearer-auth flow. Cleans up in a `finally` block. Emails/org slugs
unique per test as an extra safety net against cross-test collisions.

Wire protocol: Streamable-HTTP-transport MCP JSON-RPC 2.0 over a single
`POST /mcp` endpoint. With `stateless_http=True`/`json_response=True` set
on the FastMCP instance (`app/mcp/server.py`), every call is its own
request — no `mcp-session-id` header required — and the server responds
with a single JSON object (not SSE). The handshake is still required for
spec compliance (`initialize` + `notifications/initialized`), but doesn't
allocate any server-side state.
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
from app.models.assets import (
    Requirement,
    TestCase,
    TestCaseStatus,
)
from app.models.auth import AuthIdentity, AuthProvider
from app.models.project import Project
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus
from app.models.trace import RequirementTestCaseLink

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
MCP_PATH = "/mcp/"  # the ADR-0033 mount path, NOT under /api/ — trailing slash
                    # required by nginx's `location /mcp/` passthrough; without
                    # it nginx 301-redirects (the test would silently follow
                    # the redirect in a real `httpx` client but the
                    # redirect-target response wouldn't carry the original
                    # POST body, breaking every tool call after `initialize`).
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


def _unique_email(tag: str) -> str:
    return f"mcp1-{tag}-{uuid.uuid4().hex[:8]}@example.com"


def _requirement_path(requirement_id) -> str:
    return f"{API_PREFIX}/requirements/{requirement_id}/test-cases"


# --- seeding / cleanup helpers (mirrors test_agents.py's pattern) -------------------------


async def _create_user(session, email: str) -> User:
    """Seed a User row + AuthIdentity, returning the row."""
    from app.core.security import hash_password

    user = User(name="MCP-1 Test User", email=email, password_hash=hash_password(DEFAULT_PASSWORD))
    session.add(user)
    await session.flush()
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"MCP-1 Test Org {slug_prefix}", slug=f"{slug_prefix}-{uuid.uuid4().hex[:8]}")
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


async def _create_project(session, org: Organization) -> Project:
    project = Project(
        org_id=org.id,
        name=f"MCP-1 Project {uuid.uuid4().hex[:6]}",
        standards_profile=None,
    )
    session.add(project)
    await session.flush()
    return project


async def _create_requirement(session, project: Project, title: str = "MCP-1 Requirement") -> Requirement:
    requirement = Requirement(
        project_id=project.id,
        title=title,
        description="Test fixture for MCP-1 TestCase authoring.",
        external_ref=None,
        source=None,
    )
    session.add(requirement)
    await session.flush()
    return requirement


async def _create_test_level(session, name: str = "MCP-1 Level") -> TestLevel:
    level = TestLevel(name=name)
    session.add(level)
    await session.flush()
    return level


async def _create_test_type(session, name: str = "MCP-1 Type") -> TestType:
    type_ = TestType(name=name)
    session.add(type_)
    await session.flush()
    return type_


async def _create_agent(
    session,
    *,
    acting_on_behalf_of_user_id: UUID,
    agent_name: str = "MCP-1 Test Agent",
) -> tuple[AIAgent, str]:
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


async def _create_role(session, org: Organization, name: str) -> Role:
    role = Role(org_id=org.id, name=name, is_system_role=False)
    session.add(role)
    await session.flush()
    return role


async def _grant_permission(session, role: Role, permission: Permission) -> RolePermission:
    row = RolePermission(role_id=role.id, permission_id=permission.id)
    session.add(row)
    await session.flush()
    return row


async def _assign_role(
    session, *, actor_id: UUID, org: Organization, role: Role, project_id=None
) -> RoleAssignment:
    row = RoleAssignment(actor_id=actor_id, org_id=org.id, project_id=project_id, role_id=role.id)
    session.add(row)
    await session.flush()
    return row


async def _cleanup(
    *,
    emails: list[str] | None = None,
    user_ids: list | None = None,
    agent_ids: list | None = None,
    org_ids: list | None = None,
    project_ids: list | None = None,
    requirement_ids: list | None = None,
    test_level_ids: list | None = None,
    test_type_ids: list | None = None,
    role_ids: list | None = None,
) -> None:
    """Delete everything seeded by a test, in FK-safe order."""
    emails = emails or []
    user_ids = user_ids or []
    agent_ids = agent_ids or []
    org_ids = org_ids or []
    project_ids = project_ids or []
    requirement_ids = requirement_ids or []
    test_level_ids = test_level_ids or []
    test_type_ids = test_type_ids or []
    role_ids = role_ids or []

    async with AsyncSessionLocal() as session:
        actor_ids_for_role_assignment_cleanup = [*user_ids, *agent_ids]
        if actor_ids_for_role_assignment_cleanup:
            await session.execute(
                delete(RoleAssignment).where(
                    RoleAssignment.actor_id.in_(actor_ids_for_role_assignment_cleanup)
                )
            )
        if role_ids:
            await session.execute(delete(RolePermission).where(RolePermission.role_id.in_(role_ids)))
            await session.execute(delete(Role).where(Role.id.in_(role_ids)))
        if requirement_ids:
            # Delete TestCase rows (and the RequirementTestCaseLink rows the test
            # itself left behind) before the Requirement rows — FK-safe order.
            linked_tc_subquery = select(RequirementTestCaseLink.test_case_id).where(
                RequirementTestCaseLink.requirement_id.in_(requirement_ids)
            )
            await session.execute(
                delete(TestCase).where(TestCase.id.in_(linked_tc_subquery))
            )
            await session.execute(
                delete(RequirementTestCaseLink).where(
                    RequirementTestCaseLink.requirement_id.in_(requirement_ids)
                )
            )
            await session.execute(delete(Requirement).where(Requirement.id.in_(requirement_ids)))
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
            await session.execute(delete(OrgMembership).where(OrgMembership.user_id.in_(user_ids)))
            await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id.in_(user_ids)))
        if org_ids:
            await session.execute(delete(OrgMembership).where(OrgMembership.org_id.in_(org_ids)))
            await session.execute(delete(Organization).where(Organization.id.in_(org_ids)))
        if user_ids:
            await session.execute(delete(User).where(User.actor_id.in_(user_ids)))
            await session.execute(delete(Actor).where(Actor.id.in_(user_ids)))
        await session.commit()


# --- MCP JSON-RPC wire helpers ------------------------------------------------------------


def _mcp_initialize_request() -> dict:
    return {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "mcp1-test-client", "version": "0.0.1"},
        },
    }


def _mcp_initialized_notification() -> dict:
    return {"jsonrpc": "2.0", "method": "notifications/initialized"}


def _mcp_tools_list_request(req_id: int = 2) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "method": "tools/list",
        "params": {},
    }


def _mcp_tool_call_request(name: str, arguments: dict, req_id: int = 3) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
    }


def _bearer_headers(raw_key: str) -> dict[str, str]:
    """Headers the live server will accept for an AIAgent bearer call."""
    return {
        "Authorization": f"Bearer {raw_key}",
        # Streamable-HTTP transports the SDK's Accept header advertises both
        # `application/json` and `text/event-stream`; with `json_response=True`
        # the server picks JSON. The full header is required for the SDK's
        # Accept negotiation to short-circuit to JSON-mode rather than SSE.
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }


async def _mcp_initialize(client: httpx.AsyncClient) -> None:
    """Send the `initialize` handshake + `notifications/initialized` ack."""
    init_response = await client.post(
        MCP_PATH,
        json=_mcp_initialize_request(),
        headers={"Accept": "application/json, text/event-stream"},
    )
    assert init_response.status_code == 200, init_response.text
    notif_response = await client.post(
        MCP_PATH,
        json=_mcp_initialized_notification(),
        headers={"Accept": "application/json, text/event-stream"},
    )
    assert notif_response.status_code in (202, 200), notif_response.text


async def _mcp_tools_list(client: httpx.AsyncClient) -> dict:
    """Return the parsed JSON-RPC `result` for `tools/list`."""
    response = await client.post(
        MCP_PATH,
        json=_mcp_tools_list_request(),
        headers={"Accept": "application/json, text/event-stream"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert "result" in body, f"missing result envelope: {body}"
    return body["result"]


async def _mcp_call_tool(
    client: httpx.AsyncClient, raw_key: str, name: str, arguments: dict, req_id: int = 3
) -> dict:
    """POST `tools/call`, return the parsed JSON-RPC `result` envelope."""
    response = await client.post(
        MCP_PATH,
        json=_mcp_tool_call_request(name, arguments, req_id=req_id),
        headers=_bearer_headers(raw_key),
    )
    assert response.status_code == 200, f"HTTP {response.status_code}: {response.text}"
    body = response.json()
    assert "result" in body, f"missing result envelope: {body}"
    return body["result"]


def _extract_tool_payload(result: dict) -> dict:
    """Decode the structured-content payload from a successful `tools/call` response.

    `FastMCP` returns tool output as `{"content": [...TextContent...],
    "structuredContent": {...}}`; we surface the structured shape (a
    Pydantic-model `model_dump(mode="json")`) directly so parity with the
    REST `TestCaseSummary` is exact, no second parse step.
    """
    if "structuredContent" in result:
        return result["structuredContent"]
    # Fallback: TextContent envelope, JSON-encoded. Should not happen for
    # our tools since they return `dict[str, Any]`, but defensive.
    for item in result.get("content", []):
        if item.get("type") == "text":
            return json.loads(item["text"])
    raise AssertionError(f"no parseable payload in tool result: {result!r}")


def _extract_tool_error(result: dict) -> dict:
    """Decode the API Document §1 error envelope from an `isError=True` result.

    `FastMCP`'s `ToolError` becomes `{"content": [{"type": "text",
    "text": "Error executing tool <name>: <json>"}], "isError": True}` —
    the SDK prepends an `Error executing tool ...: ` prefix before our
    raw ToolError text. Our ToolError text IS the JSON-encoded
    `{code, message, field_errors}` envelope (ADR-0033 decision 4), so
    we locate the first `{` and slice the rest.
    """
    assert result.get("isError") is True, f"expected isError=True, got: {result!r}"
    for item in result.get("content", []):
        if item.get("type") == "text":
            text = item["text"]
            json_start = text.find("{")
            if json_start < 0:
                raise AssertionError(f"no JSON envelope in error text: {text!r}")
            return json.loads(text[json_start:])
    raise AssertionError(f"no error text in tool result: {result!r}")


# --- TC-MCP-001 + TC-MCP-002 + TC-MCP-003 + cross-project-403 --------------------------------


@pytest.mark.asyncio
async def test_mcp_create_and_list_test_case_with_attribution_and_schema_parity() -> None:  # TC-MCP-001 + TC-MCP-002 + TC-MCP-003
    """MCP-1 AC1+AC2+AC3 in one end-to-end test, plus the MCP/REST parity check.

    - Seeds: User, Org+active membership, Project, Requirement,
      TestLevel, TestType, AIAgent with a role that holds
      `test_case.create`/`.read` only.
    - Asserts `tools/list` advertises exactly `create_test_case` +
      `list_test_cases` (no other tools leaked into the registry).
    - Calls `create_test_case` via MCP — assert response shape equals
      `TestCaseSummary` verbatim (TC-MCP-003).
    - Asserts `created_by_actor_id` is the AIAgent's `actor_id` (TC-MCP-002)
      and `acting_on_behalf_of_user_id` still points at the human user.
    - Calls `list_test_cases` via MCP — assert the new case appears and
      the envelope matches `TestCaseListResponse` shape (TC-MCP-001).
    - Calls `GET /api/v1/requirements/{id}/test-cases` via REST — assert
      the same shape, same row (TC-MCP-003 schema parity cross-check).
    """
    email = _unique_email("tc001")
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    role_ids: list = []
    agent_ids: list = []

    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            org = await _create_org(session, "mcp1-tc001")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            project = await _create_project(session, org)
            requirement = await _create_requirement(session, project)
            test_level = await _create_test_level(session)
            test_type = await _create_test_type(session)

            create_perm = await _get_permission_by_code(session, "test_case.create")
            read_perm = await _get_permission_by_code(session, "test_case.read")
            role = await _create_role(session, org, "mcp1_tc001_role")
            await _grant_permission(session, role, create_perm)
            await _grant_permission(session, role, read_perm)
            agent, raw_key = await _create_agent(
                session,
                acting_on_behalf_of_user_id=user.actor_id,
                agent_name="TC-MCP-001/2/3 Agent",
            )
            await _assign_role(session, actor_id=agent.actor_id, org=org, role=role)
            await session.commit()

            (
                user_ids,
                org_ids,
                project_ids,
                requirement_ids,
                test_level_ids,
                test_type_ids,
                role_ids,
                agent_ids,
            ) = (
                [user.actor_id],
                [org.id],
                [project.id],
                [requirement.id],
                [test_level.id],
                [test_type.id],
                [role.id],
                [agent.actor_id],
            )
            (
                requirement_id,
                test_level_id,
                test_type_id,
                agent_id,
                agent_acting_on_behalf_id,
            ) = (
                requirement.id,
                test_level.id,
                test_type.id,
                agent.actor_id,
                user.actor_id,
            )

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=30.0) as client:
            await _mcp_initialize(client)
            tools = await _mcp_tools_list(client)
            tool_names = {tool["name"] for tool in tools["tools"]}
            assert tool_names == {"create_test_case", "list_test_cases"}, tool_names

            # --- TC-MCP-001 + AC2: create_test_case via MCP --------------------
            create_result = await _mcp_call_tool(
                client,
                raw_key,
                "create_test_case",
                {
                    "requirement_id": str(requirement_id),
                    "title": "MCP-1 first test case",
                    "test_level_id": str(test_level_id),
                    "test_type_id": str(test_type_id),
                    "preconditions": "Pre-state precondition text.",
                    "expected_result": "Expected post-state result text.",
                },
            )
            created_payload = _extract_tool_payload(create_result)

            # TC-MCP-002: created_by_actor_id = AIAgent.actor_id, accountability preserved.
            assert created_payload["created_by_actor_id"] == str(agent_id)
            # The AIAgent row's `acting_on_behalf_of_user_id` is unchanged —
            # re-fetch from DB to confirm it's still the same human user
            # (not silently swapped by the create path).
            async with AsyncSessionLocal() as session:
                stored_agent = (await session.execute(
                    select(AIAgent).where(AIAgent.actor_id == agent_id)
                )).scalars().one()
            assert stored_agent.acting_on_behalf_of_user_id == agent_acting_on_behalf_id

            # TC-MCP-003: response shape parity vs `TestCaseSummary` field-by-field.
            expected_fields = {
                "id",
                "test_condition_id",
                "test_level_id",
                "test_type_id",
                "created_by_actor_id",
                "title",
                "preconditions",
                "expected_result",
                "status",
            }
            assert expected_fields <= set(created_payload.keys()), (
                f"missing TestCaseSummary fields: {expected_fields - set(created_payload.keys())}"
            )
            assert created_payload["title"] == "MCP-1 first test case"
            assert created_payload["status"] == TestCaseStatus.draft.value
            assert created_payload["test_condition_id"] is None
            created_id = created_payload["id"]

            # --- TC-MCP-001: list_test_cases via MCP returns the new row -----
            list_result = await _mcp_call_tool(
                client,
                raw_key,
                "list_test_cases",
                {"requirement_id": str(requirement_id)},
            )
            list_payload = _extract_tool_payload(list_result)
            assert list_payload["total"] == 1
            assert list_payload["page"] == 1
            assert list_payload["page_size"] == 25
            assert "items" in list_payload
            assert len(list_payload["items"]) == 1
            listed_item = list_payload["items"][0]
            assert listed_item["id"] == created_id

            # TC-MCP-003 cross-check: same row fetched via REST must match
            # field-for-field. Use the same AIAgent bearer key (the agent
            # already holds `test_case.read` for this story, and using the
            # same caller on both surfaces makes the parity assertion
            # cleaner — no need to also grant the human user permissions
            # they don't otherwise need).
            rest_response = await client.get(
                _requirement_path(requirement_id),
                headers=_bearer_headers(raw_key),
            )
            assert rest_response.status_code == 200, rest_response.text
            rest_payload = rest_response.json()
            assert rest_payload["total"] == 1
            assert len(rest_payload["items"]) == 1
            rest_item = rest_payload["items"][0]
            # Same shape — same set of fields, same values.
            assert set(rest_item.keys()) == set(listed_item.keys())
            for field_name, expected_value in listed_item.items():
                assert rest_item[field_name] == expected_value, (
                    f"field {field_name!r} disagrees: MCP={expected_value!r} REST={rest_item[field_name]!r}"
                )
    finally:
        await _cleanup(
            emails=[email],
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
            role_ids=role_ids,
            agent_ids=agent_ids,
        )


@pytest.mark.asyncio
async def test_mcp_missing_authorization_header_returns_invalid_token() -> None:  # MCP-1 AC1 negative (auth)
    """No `Authorization` header → 401 `invalid_token` (MCP-1 AC1: same path as REST).

    Validates that the MCP tool-side bearer resolution reuses
    `_resolve_agent_actor`'s no-enumeration posture: a missing header
    produces the same generic `invalid_token` body shape as the REST
    `get_current_actor` rejection, not a tool-specific error.
    """
    async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=30.0) as client:
        await _mcp_initialize(client)
        bogus_uuid = str(uuid.uuid4())
        response = await client.post(
            MCP_PATH,
            json=_mcp_tool_call_request(
                "create_test_case",
                {
                    "requirement_id": bogus_uuid,
                    "title": "Should never reach this path.",
                    "test_level_id": bogus_uuid,
                    "test_type_id": bogus_uuid,
                },
            ),
            headers={"Accept": "application/json, text/event-stream", "Content-Type": "application/json"},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    error = _extract_tool_error(body["result"])
    assert error == {
        "code": "invalid_token",
        "message": "Invalid or expired access token.",
        "field_errors": None,
    }


@pytest.mark.asyncio
async def test_mcp_agent_without_test_case_create_permission_yields_permission_denied() -> None:  # MCP-1 AC1 negative (permission)
    """AIAgent with `test_case.read` but NOT `test_case.create` → 403 (MCP-1 AC1).

    MCP-1 AC1's "same validation and permission check" wording is the
    explicit reason this test belongs to MCP-1 rather than MCP-2 — the
    403 round-trip is the cheapest possible proof that the MCP tool
    reuses `has_permission` (not a parallel weaker check). Without it,
    an MCP-1 shippable claim of "same permission path" is a self-report
    with no negative coverage behind it.
    """
    email = _unique_email("tc003")
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    role_ids: list = []
    agent_ids: list = []

    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            org = await _create_org(session, "mcp1-tc003")
            await _create_membership(session, user, org, OrgMembershipStatus.active)
            project = await _create_project(session, org)
            requirement = await _create_requirement(session, project)
            test_level = await _create_test_level(session, "MCP-1 TC-003 Level")
            test_type = await _create_test_type(session, "MCP-1 TC-003 Type")

            # Grant only `test_case.read` — agent must NOT have `test_case.create`.
            read_perm = await _get_permission_by_code(session, "test_case.read")
            role = await _create_role(session, org, "mcp1_tc003_role")
            await _grant_permission(session, role, read_perm)
            agent, raw_key = await _create_agent(
                session,
                acting_on_behalf_of_user_id=user.actor_id,
                agent_name="TC-MCP-001-Permission Agent",
            )
            await _assign_role(session, actor_id=agent.actor_id, org=org, role=role)
            await session.commit()

            (
                user_ids,
                org_ids,
                project_ids,
                requirement_ids,
                test_level_ids,
                test_type_ids,
                role_ids,
                agent_ids,
            ) = (
                [user.actor_id],
                [org.id],
                [project.id],
                [requirement.id],
                [test_level.id],
                [test_type.id],
                [role.id],
                [agent.actor_id],
            )
            requirement_id, test_level_id, test_type_id = (
                requirement.id,
                test_level.id,
                test_type.id,
            )

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=30.0) as client:
            await _mcp_initialize(client)
            result = await _mcp_call_tool(
                client,
                raw_key,
                "create_test_case",
                {
                    "requirement_id": str(requirement_id),
                    "title": "Should be 403 — agent has only test_case.read.",
                    "test_level_id": str(test_level_id),
                    "test_type_id": str(test_type_id),
                },
            )
        error = _extract_tool_error(result)
        # The REST route's `_error()` produces
        # `{"code": "permission_denied", "message": "...", "field_errors": None}`.
        # MCP-1 AC1 requires the same body shape — no divergent envelope.
        assert error["code"] == "permission_denied"
        assert error["message"] == "You do not have permission to perform this action."
        assert error["field_errors"] is None
    finally:
        await _cleanup(
            emails=[email],
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
            role_ids=role_ids,
            agent_ids=agent_ids,
        )
