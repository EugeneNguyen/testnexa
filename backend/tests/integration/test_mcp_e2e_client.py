"""End-to-end MCP SDK client coverage for the MCP-1 surface.

These tests use the official MCP Python SDK transport/session stack
(`streamable_http_client` + `ClientSession`) against the live `/mcp/`
endpoint. That proves the server interoperates with a real MCP client, not
just raw JSON-RPC over `httpx`.

The SDK package used here exposes `ClientSession` (not a separate `Client`
class) in v1.29.1, so these tests exercise the same session API Claude Code /
Cursor build on under the hood.
"""

from __future__ import annotations

import json
import os
import secrets
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, AsyncIterator
from uuid import UUID, uuid4

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from app.db.session import AsyncSessionLocal
from app.mcp.tools.entity_tools import generated_tool_names
from app.models.tenancy import OrgMembershipStatus

from .test_mcp_test_cases import (
    _assign_role,
    _bearer_headers,
    _cleanup,
    _create_agent,
    _create_membership,
    _create_org,
    _create_project,
    _create_requirement,
    _create_role,
    _create_test_level,
    _create_test_type,
    _create_user,
    _grant_permission,
    _get_permission_by_code,
    _requirement_path,
)

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
MCP_BASE_URL = f"{TEST_API_BASE_URL}/mcp/"
# Optional cross-machine smoke target. Previously a hardcoded
# `http://192.168.25.203:54594/mcp/` — one session's own LAN IP and a port
# that never matched main's nginx (`54593`), so the test failed against every
# stack, permanently, and `backend/CLAUDE.md` flagged it as genuinely broken
# rather than a topology artifact, naming this exact fix. Made env-driven here
# (the change touches this file's own tool-surface assertions anyway, and a
# permanently-red test masks real regressions in the surface under test).
# Unset -> the test skips; set `E2E_LAN_MCP_BASE_URL` to exercise the LAN path.
LAN_MCP_BASE_URL = os.environ.get("E2E_LAN_MCP_BASE_URL")


@dataclass(slots=True)
class _SeededAgentScope:
    email: str
    user_ids: list[UUID]
    org_ids: list[UUID]
    project_ids: list[UUID]
    requirement_ids: list[UUID]
    test_level_ids: list[UUID]
    test_type_ids: list[UUID]
    role_ids: list[UUID]
    agent_ids: list[UUID]
    requirement_id: UUID
    test_level_id: UUID
    test_type_id: UUID
    agent_id: UUID
    raw_key: str
    acting_on_behalf_of_user_id: UUID


async def _seed_agent_scope(tag: str, *, permission_codes: tuple[str, ...]) -> _SeededAgentScope:
    email = f"mcp-e2e-{tag}-{uuid4().hex[:8]}@example.com"
    scope = _SeededAgentScope(
        email=email,
        user_ids=[],
        org_ids=[],
        project_ids=[],
        requirement_ids=[],
        test_level_ids=[],
        test_type_ids=[],
        role_ids=[],
        agent_ids=[],
        requirement_id=uuid4(),
        test_level_id=uuid4(),
        test_type_id=uuid4(),
        agent_id=uuid4(),
        raw_key="",
        acting_on_behalf_of_user_id=uuid4(),
    )

    async with AsyncSessionLocal() as session:
        user = await _create_user(session, email)
        org = await _create_org(session, f"mcp-e2e-{tag}")
        await _create_membership(session, user, org, status=OrgMembershipStatus.active)
        project = await _create_project(session, org)
        requirement = await _create_requirement(session, project)
        test_level = await _create_test_level(session)
        test_type = await _create_test_type(session)
        role = await _create_role(session, org, f"mcp-e2e-role-{tag}")

        for code in permission_codes:
            permission = await _get_permission_by_code(session, code)
            await _grant_permission(session, role, permission)

        agent, raw_key = await _create_agent(
            session,
            acting_on_behalf_of_user_id=user.actor_id,
            agent_name=f"MCP E2E Agent {tag}",
        )
        await _assign_role(session, actor_id=agent.actor_id, org=org, role=role)
        await session.commit()

        scope.user_ids = [user.actor_id]
        scope.org_ids = [org.id]
        scope.project_ids = [project.id]
        scope.requirement_ids = [requirement.id]
        scope.test_level_ids = [test_level.id]
        scope.test_type_ids = [test_type.id]
        scope.role_ids = [role.id]
        scope.agent_ids = [agent.actor_id]
        scope.requirement_id = requirement.id
        scope.test_level_id = test_level.id
        scope.test_type_id = test_type.id
        scope.agent_id = agent.actor_id
        scope.raw_key = raw_key
        scope.acting_on_behalf_of_user_id = user.actor_id
        return scope


@asynccontextmanager
async def _open_sdk_session(base_url: str, *, headers: dict[str, str] | None = None) -> AsyncIterator[ClientSession]:
    async with httpx.AsyncClient(headers=headers, timeout=30.0) as http_client:
        async with streamable_http_client(base_url, http_client=http_client, terminate_on_close=False) as (read, write, _):
            async with ClientSession(read, write) as session:
                yield session


def _tool_error_payload(result: Any) -> dict[str, Any]:
    assert result.isError is True, f"expected isError=True, got {result!r}"
    for item in result.content:
        if getattr(item, "type", None) == "text":
            text = item.text
            json_start = text.find("{")
            assert json_start >= 0, f"no JSON envelope in error text: {text!r}"
            return json.loads(text[json_start:])
    raise AssertionError(f"no text error content in result: {result!r}")


@pytest.mark.asyncio
async def test_mcp_sdk_client_handshake_and_tools_list() -> None:
    async with _open_sdk_session(MCP_BASE_URL) as session:
        await session.initialize()
        tools = await session.list_tools()

    # ADR-0067: the surface is now one tool per entity per supported action
    # (`tn_<resource>_<action>`), generated from `TOOL_REGISTRY` — ADR-0033's
    # `create_test_case`/`list_test_cases` and ADR-0065's 6 reflective
    # `*_entity`/`*_entities` tools are all gone, folded into this scheme.
    #
    # Asserted here only for what a *real SDK client over the wire* can see —
    # that the advertised set exactly equals what the server generates, and
    # that representative names/schemas arrive intact. The set's correctness
    # against `ALL_ENTITY_CONFIGS`/`full_methods` is proved separately, in
    # `tests/unit/test_mcp_tool_naming.py`; duplicating that diff here would
    # make this test fail for a reason that has nothing to do with transport.
    by_name = {tool.name: tool for tool in tools.tools}
    assert set(by_name) == set(generated_tool_names())
    assert {"create_test_case", "list_test_cases", "create_entity", "list_entities"}.isdisjoint(by_name)
    assert {"tn_test_case_create", "tn_test_case_list", "tn_requirement_list", "tn_project_get"} <= set(by_name)

    assert by_name["tn_test_case_create"].inputSchema == {
        "properties": {"fields": {"additionalProperties": True, "title": "Fields", "type": "object"}},
        "required": ["fields"],
        "title": "tn_test_case_createArguments",
        "type": "object",
    }
    assert by_name["tn_requirement_get"].inputSchema == {
        "properties": {"id": {"format": "uuid", "title": "Id", "type": "string"}},
        "required": ["id"],
        "title": "tn_requirement_getArguments",
        "type": "object",
    }
    assert by_name["tn_requirement_describe"].inputSchema == {
        "properties": {},
        "title": "tn_requirement_describeArguments",
        "type": "object",
    }
    assert by_name["tn_test_case_create"].outputSchema == {
        "additionalProperties": True,
        "title": "tn_test_case_createDictOutput",
        "type": "object",
    }
    # Every tool arrives with its generated description intact (the only
    # signal a client model has for picking among ~146 tools).
    assert "requirement_id" in by_name["tn_test_case_create"].description
    assert all(tool.description for tool in tools.tools)


@pytest.mark.asyncio
async def test_mcp_sdk_client_create_test_case_stamps_created_by_actor_id() -> None:
    scope = await _seed_agent_scope("create", permission_codes=("test_case.create", "test_case.read"))
    try:
        async with _open_sdk_session(MCP_BASE_URL, headers=_bearer_headers(scope.raw_key)) as session:
            await session.initialize()
            result = await session.call_tool(
                "tn_test_case_create",
                {
                    "fields": {
                        # ADR-0067: the bespoke create's own parent id rides in
                        # `fields` alongside the payload, not as a top-level
                        # tool argument the way MCP-1's hand-wired tool took it.
                        "requirement_id": str(scope.requirement_id),
                        "title": "SDK tn_test_case_create round-trip",
                        "test_level_id": str(scope.test_level_id),
                        "test_type_id": str(scope.test_type_id),
                        "preconditions": "Preconditions from SDK.",
                        "expected_result": "Created row is stamped by the AIAgent.",
                    }
                },
            )

        assert result.isError is False
        assert result.structuredContent is not None
        assert result.structuredContent["created_by_actor_id"] == str(scope.agent_id)
    finally:
        await _cleanup(
            emails=[scope.email],
            user_ids=scope.user_ids,
            org_ids=scope.org_ids,
            project_ids=scope.project_ids,
            requirement_ids=scope.requirement_ids,
            test_level_ids=scope.test_level_ids,
            test_type_ids=scope.test_type_ids,
            role_ids=scope.role_ids,
            agent_ids=scope.agent_ids,
        )


@pytest.mark.asyncio
async def test_mcp_sdk_client_create_test_case_without_authorization_returns_invalid_token() -> None:
    bogus_id = uuid4()
    async with _open_sdk_session(MCP_BASE_URL) as session:
        await session.initialize()
        result = await session.call_tool(
            "tn_test_case_create",
            {
                "fields": {
                    "requirement_id": str(bogus_id),
                    "title": "Should never authorize",
                    "test_level_id": str(bogus_id),
                    "test_type_id": str(bogus_id),
                }
            },
        )

    assert _tool_error_payload(result) == {
        "code": "invalid_token",
        "message": "Invalid or expired access token.",
        "field_errors": None,
    }


@pytest.mark.asyncio
async def test_mcp_sdk_client_create_test_case_with_wrong_agent_key_returns_invalid_token() -> None:
    fake_key = f"tnx_agent_{secrets.token_urlsafe(6)}_{secrets.token_urlsafe(32)}"
    bogus_id = uuid4()
    async with _open_sdk_session(MCP_BASE_URL, headers=_bearer_headers(fake_key)) as session:
        await session.initialize()
        result = await session.call_tool(
            "tn_test_case_create",
            {
                "fields": {
                    "requirement_id": str(bogus_id),
                    "title": "Should never authorize",
                    "test_level_id": str(bogus_id),
                    "test_type_id": str(bogus_id),
                }
            },
        )

    assert _tool_error_payload(result) == {
        "code": "invalid_token",
        "message": "Invalid or expired access token.",
        "field_errors": None,
    }


@pytest.mark.asyncio
async def test_mcp_sdk_client_list_test_cases_returns_seeded_case() -> None:
    scope = await _seed_agent_scope("list", permission_codes=("test_case.create", "test_case.read"))
    try:
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=30.0) as client:
            create_response = await client.post(
                _requirement_path(scope.requirement_id),
                json={
                    "title": "Seeded via REST for SDK tn_test_case_list",
                    "test_level_id": str(scope.test_level_id),
                    "test_type_id": str(scope.test_type_id),
                },
                headers=_bearer_headers(scope.raw_key),
            )
        assert create_response.status_code == 201, create_response.text
        created_test_case_id = create_response.json()["id"]

        async with _open_sdk_session(MCP_BASE_URL, headers=_bearer_headers(scope.raw_key)) as session:
            await session.initialize()
            result = await session.call_tool(
                "tn_test_case_list",
                # ADR-0067: the nested list's parent id rides in `scope`, the
                # same dict every other `tn_*_list` tool uses for its own scope
                # field — MCP-1's tool took it as a top-level `requirement_id`.
                {"scope": {"requirement_id": str(scope.requirement_id)}},
            )

        assert result.isError is False
        assert result.structuredContent is not None
        assert result.structuredContent["total"] == 1
        assert len(result.structuredContent["items"]) == 1
        assert result.structuredContent["items"][0]["id"] == created_test_case_id
    finally:
        await _cleanup(
            emails=[scope.email],
            user_ids=scope.user_ids,
            org_ids=scope.org_ids,
            project_ids=scope.project_ids,
            requirement_ids=scope.requirement_ids,
            test_level_ids=scope.test_level_ids,
            test_type_ids=scope.test_type_ids,
            role_ids=scope.role_ids,
            agent_ids=scope.agent_ids,
        )


@pytest.mark.asyncio
async def test_per_entity_tools_full_crud_cycle_via_real_sdk_client() -> None:
    """MCP-5's own end-to-end proof (ADR-0065), re-addressed for ADR-0067's
    per-entity names — the full `tn_requirement_create` -> `tn_requirement_get`
    -> `tn_requirement_update` -> `tn_requirement_list` -> `tn_requirement_delete`
    cycle against `requirements`, driven by the real MCP SDK `ClientSession`
    (not raw JSON-RPC over `httpx`, same "proves real client interop"
    distinction this file's own module docstring already draws for MCP-1)."""
    scope = await _seed_agent_scope("tc016e2e", permission_codes=("requirement.create", "requirement.read", "requirement.update", "requirement.delete"))
    try:
        async with _open_sdk_session(MCP_BASE_URL, headers=_bearer_headers(scope.raw_key)) as session:
            await session.initialize()

            create_result = await session.call_tool(
                "tn_requirement_create",
                {"fields": {"project_id": str(scope.project_ids[0]), "title": "MCP-5 E2E Requirement", "description": "created via real SDK client"}},
            )
            assert create_result.isError is False, create_result
            created_id = create_result.structuredContent["id"]

            get_result = await session.call_tool("tn_requirement_get", {"id": created_id})
            assert get_result.isError is False, get_result
            assert get_result.structuredContent["title"] == "MCP-5 E2E Requirement"

            update_result = await session.call_tool(
                "tn_requirement_update", {"id": created_id, "fields": {"title": "MCP-5 E2E Requirement (updated)"}}
            )
            assert update_result.isError is False, update_result
            assert update_result.structuredContent["title"] == "MCP-5 E2E Requirement (updated)"

            list_result = await session.call_tool("tn_requirement_list", {"scope": {"project_id": str(scope.project_ids[0])}})
            assert list_result.isError is False, list_result
            assert list_result.structuredContent["total"] == 2  # the fixture's own seeded requirement + this one
            assert any(item["id"] == created_id for item in list_result.structuredContent["items"])

            delete_result = await session.call_tool("tn_requirement_delete", {"id": created_id})
            assert delete_result.isError is False, delete_result

            confirm_result = await session.call_tool("tn_requirement_get", {"id": created_id})
            assert confirm_result.isError is True
            assert _tool_error_payload(confirm_result)["code"] == "not_found"
    finally:
        await _cleanup(
            emails=[scope.email],
            user_ids=scope.user_ids,
            org_ids=scope.org_ids,
            project_ids=scope.project_ids,
            requirement_ids=scope.requirement_ids,
            test_level_ids=scope.test_level_ids,
            test_type_ids=scope.test_type_ids,
            role_ids=scope.role_ids,
            agent_ids=scope.agent_ids,
        )


@pytest.mark.asyncio
async def test_mcp_sdk_client_handshake_and_tools_list_over_lan_ip() -> None:
    if not LAN_MCP_BASE_URL:
        pytest.skip("E2E_LAN_MCP_BASE_URL not set — LAN-IP transport smoke is opt-in (see LAN_MCP_BASE_URL above).")
    async with _open_sdk_session(LAN_MCP_BASE_URL) as session:
        await session.initialize()
        tools = await session.list_tools()

    # ADR-0067 tool surface — see the localhost twin above. This test's own
    # point is the LAN-IP transport path, not the tool set, so it asserts only
    # that the handshake returns the same generated surface.
    assert {tool.name for tool in tools.tools} == set(generated_tool_names())
