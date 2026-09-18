"""Integration tests for ADR-0090's `GET /agents/me/orgs` + its MCP mirror
`tn_agent_org_list`.

The `AIAgent`-only inverse of `GET /auth/me/orgs` (SHELL-6/ADR-0036, see
`test_shell6_me_orgs.py`) — same fixture/helper shapes, copied rather than
cross-imported (this repo's own per-file fixture-ownership convention),
covering the mirrored equivalence classes: human -> 403 `actor_forbidden`,
agent -> 200 active-only, unauthenticated -> 401, zero active memberships ->
200 empty (not an error), and the same call reachable over MCP as
`tn_agent_org_list` with no `scope`/`fields` required.
"""

import json
import os
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete

from app.core.security import create_access_token, generate_api_key, hash_api_key, hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, AIAgent, User
from app.models.auth import AuthIdentity, AuthProvider, LoginAttempt, RefreshToken
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
MCP_PATH = "/mcp/"
AGENT_ME_ORGS_PATH = f"{API_PREFIX}/agents/me/orgs"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


def _unique_email(tag: str) -> str:
    return f"adr90-{tag}-{uuid4().hex[:8]}@example.com"


async def _create_user(session, email: str) -> User:
    user = User(name="ADR-90 Test User", email=email, password_hash=hash_password(DEFAULT_PASSWORD))
    session.add(user)
    await session.flush()
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str, name: str) -> Organization:
    org = Organization(name=name, slug=f"{slug_prefix}-{uuid4().hex[:8]}")
    session.add(org)
    await session.flush()
    return org


async def _create_membership(session, user: User, org: Organization, status: OrgMembershipStatus) -> None:
    session.add(
        OrgMembership(
            org_id=org.id,
            user_id=user.actor_id,
            status=status,
            joined_at=datetime.now(UTC) if status != OrgMembershipStatus.invited else None,
        )
    )
    await session.flush()


async def _create_agent(session, *, acting_on_behalf_of_user_id) -> tuple[AIAgent, str]:
    raw_key, key_prefix = generate_api_key()
    agent = AIAgent(
        agent_name="ADR-90 Test Agent",
        model_or_provider="test-provider/test-model",
        acting_on_behalf_of_user_id=acting_on_behalf_of_user_id,
        key_hash=hash_api_key(raw_key),
        key_prefix=key_prefix,
        issued_at=datetime.now(UTC),
    )
    session.add(agent)
    await session.flush()
    return agent, raw_key


async def _cleanup(*, emails=None, user_ids=None, agent_ids=None, org_ids=None) -> None:
    emails = emails or []
    user_ids = user_ids or []
    agent_ids = agent_ids or []
    org_ids = org_ids or []

    async with AsyncSessionLocal() as session:
        if emails:
            await session.execute(delete(LoginAttempt).where(LoginAttempt.email.in_(emails)))
        if agent_ids:
            await session.execute(delete(AIAgent).where(AIAgent.actor_id.in_(agent_ids)))
            await session.execute(delete(Actor).where(Actor.id.in_(agent_ids)))
        if user_ids:
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


# --- MCP wire helpers (copied from test_mcp_entity_tools.py verbatim) --------------------


def _bearer_headers(raw_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {raw_key}",
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }


async def _mcp_initialize(client: httpx.AsyncClient) -> None:
    init_response = await client.post(
        MCP_PATH,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "adr90-test-client", "version": "0.0.1"}},
        },
        headers={"Accept": "application/json, text/event-stream"},
    )
    assert init_response.status_code == 200, init_response.text
    notif_response = await client.post(
        MCP_PATH,
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        headers={"Accept": "application/json, text/event-stream"},
    )
    assert notif_response.status_code in (202, 200), notif_response.text


async def _mcp_call_tool(client: httpx.AsyncClient, raw_key: str, name: str, arguments: dict, req_id: int = 3) -> dict:
    response = await client.post(
        MCP_PATH,
        json={"jsonrpc": "2.0", "id": req_id, "method": "tools/call", "params": {"name": name, "arguments": arguments}},
        headers=_bearer_headers(raw_key),
    )
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


@pytest.mark.asyncio
async def test_agent_me_orgs_active_only_agent_only_and_authenticated_only() -> None:
    """TC-ADR90-001: mirrors TC-AUTH-035, gates inverted.

    One `User` with active/suspended/invited memberships across 3 orgs and an
    `AIAgent` acting on their behalf: the agent's own bearer key -> 200,
    active-only; the human's own access token -> 403 `actor_forbidden`;
    unauthenticated -> 401.
    """
    email = _unique_email("mixed")
    user_ids: list = []
    agent_ids: list = []
    org_ids: list = []

    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            user_ids.append(user.actor_id)

            active_org = await _create_org(session, "adr90-active", "ADR-90 Active Org")
            suspended_org = await _create_org(session, "adr90-susp", "ADR-90 Suspended Org")
            invited_org = await _create_org(session, "adr90-inv", "ADR-90 Invited Org")
            org_ids.extend([active_org.id, suspended_org.id, invited_org.id])

            await _create_membership(session, user, active_org, OrgMembershipStatus.active)
            await _create_membership(session, user, suspended_org, OrgMembershipStatus.suspended)
            await _create_membership(session, user, invited_org, OrgMembershipStatus.invited)

            agent, raw_agent_key = await _create_agent(session, acting_on_behalf_of_user_id=user.actor_id)
            agent_ids.append(agent.actor_id)

            await session.commit()
            active_org_id = str(active_org.id)
            active_org_name = active_org.name
            active_org_slug = active_org.slug

        access_token = create_access_token(str(user_ids[0]))

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            # --- the AIAgent bearer-key call -> 200, active-only ---------------
            agent_response = await client.get(AGENT_ME_ORGS_PATH, headers={"Authorization": f"Bearer {raw_agent_key}"})
            assert agent_response.status_code == 200, agent_response.text
            body = agent_response.json()
            assert list(body.keys()) == ["orgs"], body
            returned = body["orgs"]
            assert len(returned) == 1, f"expected only the active-status org, got {returned}"
            assert returned[0] == {"id": active_org_id, "name": active_org_name, "slug": active_org_slug}
            returned_ids = {org["id"] for org in returned}
            assert str(suspended_org.id) not in returned_ids
            assert str(invited_org.id) not in returned_ids

            # --- the human User call -> 403 actor_forbidden, no leak ----------
            user_response = await client.get(AGENT_ME_ORGS_PATH, headers={"Authorization": f"Bearer {access_token}"})
            assert user_response.status_code == 403, user_response.text
            user_body = user_response.json()
            assert user_body["code"] == "actor_forbidden", user_body
            assert "orgs" not in user_body, user_body

            # --- unauthenticated -> 401 ----------------------------------------
            anon_response = await client.get(AGENT_ME_ORGS_PATH)
            assert anon_response.status_code == 401, anon_response.text

            # --- the identical call reachable over MCP, no scope/fields -------
            async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as mcp_client:
                await _mcp_initialize(mcp_client)
                mcp_result = await _mcp_call_tool(mcp_client, raw_agent_key, "tn_agent_org_list", {})
                mcp_payload = _extract_tool_payload(mcp_result)
                assert mcp_payload == body, (mcp_payload, body)
    finally:
        await _cleanup(emails=[email], user_ids=user_ids, agent_ids=agent_ids, org_ids=org_ids)


@pytest.mark.asyncio
async def test_agent_me_orgs_with_zero_active_memberships_is_200_empty() -> None:
    """Zero active memberships -> `200` with `orgs: []`, not an error — same
    posture `GET /auth/me/orgs` takes for a human caller (test-design §31)."""
    email = _unique_email("zero")
    user_ids: list = []
    agent_ids: list = []
    org_ids: list = []

    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            user_ids.append(user.actor_id)
            org = await _create_org(session, "adr90-zero", "ADR-90 Suspended-Only Org")
            org_ids.append(org.id)
            await _create_membership(session, user, org, OrgMembershipStatus.suspended)
            agent, raw_agent_key = await _create_agent(session, acting_on_behalf_of_user_id=user.actor_id)
            agent_ids.append(agent.actor_id)
            await session.commit()

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            response = await client.get(AGENT_ME_ORGS_PATH, headers={"Authorization": f"Bearer {raw_agent_key}"})

        assert response.status_code == 200, response.text
        assert response.json() == {"orgs": []}
    finally:
        await _cleanup(emails=[email], user_ids=user_ids, agent_ids=agent_ids, org_ids=org_ids)
