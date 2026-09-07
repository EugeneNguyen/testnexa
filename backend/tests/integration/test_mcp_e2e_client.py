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
LAN_MCP_BASE_URL = "http://192.168.25.203:54594/mcp/"


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

    assert [tool.name for tool in tools.tools] == ["create_test_case", "list_test_cases"]
    assert len(tools.tools) == 2
    assert tools.tools[0].inputSchema == {
        "properties": {
            "requirement_id": {"format": "uuid", "title": "Requirement Id", "type": "string"},
            "title": {"title": "Title", "type": "string"},
            "test_level_id": {"format": "uuid", "title": "Test Level Id", "type": "string"},
            "test_type_id": {"format": "uuid", "title": "Test Type Id", "type": "string"},
            "preconditions": {"anyOf": [{"type": "string"}, {"type": "null"}], "default": None, "title": "Preconditions"},
            "expected_result": {"anyOf": [{"type": "string"}, {"type": "null"}], "default": None, "title": "Expected Result"},
            "status": {
                "default": "draft",
                "enum": ["draft", "reviewed", "approved", "deprecated"],
                "title": "Status",
                "type": "string",
            },
        },
        "required": ["requirement_id", "title", "test_level_id", "test_type_id"],
        "title": "create_test_caseArguments",
        "type": "object",
    }
    assert tools.tools[1].inputSchema == {
        "properties": {
            "requirement_id": {"format": "uuid", "title": "Requirement Id", "type": "string"},
            "page": {"default": 1, "title": "Page", "type": "integer"},
            "page_size": {"default": 25, "title": "Page Size", "type": "integer"},
        },
        "required": ["requirement_id"],
        "title": "list_test_casesArguments",
        "type": "object",
    }
    assert tools.tools[0].outputSchema == {"additionalProperties": True, "title": "create_test_caseDictOutput", "type": "object"}
    assert tools.tools[1].outputSchema == {"additionalProperties": True, "title": "list_test_casesDictOutput", "type": "object"}


@pytest.mark.asyncio
async def test_mcp_sdk_client_create_test_case_stamps_created_by_actor_id() -> None:
    scope = await _seed_agent_scope("create", permission_codes=("test_case.create", "test_case.read"))
    try:
        async with _open_sdk_session(MCP_BASE_URL, headers=_bearer_headers(scope.raw_key)) as session:
            await session.initialize()
            result = await session.call_tool(
                "create_test_case",
                {
                    "requirement_id": str(scope.requirement_id),
                    "title": "SDK create_test_case round-trip",
                    "test_level_id": str(scope.test_level_id),
                    "test_type_id": str(scope.test_type_id),
                    "preconditions": "Preconditions from SDK.",
                    "expected_result": "Created row is stamped by the AIAgent.",
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
            "create_test_case",
            {
                "requirement_id": str(bogus_id),
                "title": "Should never authorize",
                "test_level_id": str(bogus_id),
                "test_type_id": str(bogus_id),
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
            "create_test_case",
            {
                "requirement_id": str(bogus_id),
                "title": "Should never authorize",
                "test_level_id": str(bogus_id),
                "test_type_id": str(bogus_id),
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
                    "title": "Seeded via REST for SDK list_test_cases",
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
                "list_test_cases",
                {"requirement_id": str(scope.requirement_id)},
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
async def test_mcp_sdk_client_handshake_and_tools_list_over_lan_ip() -> None:
    async with _open_sdk_session(LAN_MCP_BASE_URL) as session:
        await session.initialize()
        tools = await session.list_tools()

    assert [tool.name for tool in tools.tools] == ["create_test_case", "list_test_cases"]
