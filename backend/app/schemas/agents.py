"""Pydantic v2 schemas for the AUTH-4 agent-credential routes.

Source: API Document §2 (`POST /orgs/{org_id}/agents`,
`POST /orgs/{org_id}/agents/{agent_id}/revoke`,
`GET /orgs/{org_id}/agents` contracts), ADR-0015 (AI agent credential
mechanics), ADR-0063 (MCP Integration screens — the `GET` list route this
last schema pair backs).
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class CreateAgentRequest(BaseModel):
    """Body of `POST /orgs/{org_id}/agents`."""

    agent_name: str
    model_or_provider: str | None = None
    # Accountability link, not an approver (see `AIAgent.acting_on_behalf_of_user_id`
    # docstring, `app/models/actor.py`) — must resolve to an active
    # `OrgMembership` of the path's `org_id`, validated in the route (422 if
    # not), not enforced at the schema level (schema validation has no DB
    # access).
    acting_on_behalf_of_user_id: UUID


class CreateAgentResponse(BaseModel):
    """Response of `POST /orgs/{org_id}/agents`.

    `api_key` is the raw, unhashed credential — shown here once, at
    issuance, and never persisted or retrievable again (GitHub-PAT-style,
    ADR-0015). Callers must never log this response body.
    """

    agent_id: UUID
    agent_name: str
    api_key: str
    key_prefix: str


class RevokeAgentResponse(BaseModel):
    """Response of `POST /orgs/{org_id}/agents/{agent_id}/revoke`.

    Idempotent: revoking an already-revoked agent returns 200 with the
    existing `revoked_at` (not a fresh one, not an error) — mirrors
    `RefreshToken`'s revoke-is-idempotent posture (ADR-0015).
    """

    agent_id: UUID
    revoked_at: datetime


class AgentSummary(BaseModel):
    """Response shape for `GET /orgs/{org_id}/agents` list rows (ADR-0063).

    Never includes `api_key` — the raw credential is returned exactly once,
    by `CreateAgentResponse`, at issuance, and is not persisted anywhere
    this route could read it back from (ADR-0015).
    """

    agent_id: UUID
    agent_name: str
    model_or_provider: str | None = None
    key_prefix: str
    acting_on_behalf_of_user_id: UUID
    issued_at: datetime
    revoked_at: datetime | None = None
    last_used_at: datetime | None = None


class ListAgentsResponse(BaseModel):
    """Response of `GET /orgs/{org_id}/agents` (ADR-0063).

    Same `{items,total,page,page_size}` envelope every other list route in
    this codebase uses (NFR-6, ADR-0022) — this is a brand-new route with no
    prior bare-array shape to migrate away from, so it starts on the
    envelope directly rather than needing its own DS-2/ADR-0041-style
    breaking-change pass later.
    """

    items: list[AgentSummary]
    total: int
    page: int
    page_size: int
