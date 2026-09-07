"""MCP-tool-side authentication (MCP-1 / ADR-0033 decision 3).

Every MCP tool that handles a mutating or permission-gated action receives
the MCP `Context` (auto-injected by FastMCP) and resolves the calling
`AIAgent` from the request's `Authorization: Bearer tnx_agent_<prefix>_<secret>`
header. The actual agent-row lookup is delegated to
`app.core.rbac._resolve_agent_actor` — the very same function
`get_current_actor`'s agent branch uses on the REST side (AUTH-4/ADR-0015).

Reusing `_resolve_agent_actor` is non-negotiable per ADR-0033:

- `key_prefix`-narrowed lookup + argon2 verify per candidate (ADR-0015's
  reason for using `key_prefix` as a lookup index — argon2 hashes are
  salted and non-deterministic, so `key_hash` can't be searched by
  equality).
- `revoked_at IS NULL` enforced in the `WHERE` clause itself (a revoked
  agent's key is indistinguishable from a never-existed one — same
  no-enumeration posture as the REST 401 path).
- `last_used_at = now()` write-through on every successful resolution
  (ADR-0015: per-request, not throttled).

Re-implementing any of these on the MCP side would silently introduce
drift on revocation timing, audit stamping, or the no-enumeration posture.

Surface contract:

- On success: returns the resolved `AIAgent` SQLAlchemy row.
- On any failure (missing/malformed `Authorization`, non-`tnx_agent_`
  prefix, no `AIAgent` row, argon2 verify fails across every candidate):
  raises the FastMCP `ToolError` carrying the API Document §1 401
  envelope verbatim (`{"code": "invalid_token", "message": ...}`), so an
  MCP client pattern-matching on `code` cannot tell "MCP path" from
  "REST path" — both surface the identical body for the same input.

Tool implementations call this helper with the MCP `Context` argument
they already receive (see `app/mcp/tools/test_cases.py`).
"""

import json

from fastapi import HTTPException
from mcp.server.fastmcp import Context
from mcp.server.fastmcp.exceptions import ToolError

from app.core.rbac import (
    _resolve_agent_actor,
)
from app.db.session import AsyncSessionLocal
from app.models.actor import AIAgent

# API Document §1/NFR-8 error-shape for unauthenticated callers — exact
# verbatim copy of the shape `get_current_actor` raises via FastAPI's
# `HTTPException(401, detail={...})` plus the global `http_exception_handler`
# flattening. We don't go through `HTTPException` here (we raise inside a
# tool function, not a route/dependency), but the body shape on the wire
# must match — both an MCP client and a REST client's pattern-matching on
# `code` reads the same value.
_INVALID_TOKEN_ERROR = {
    "code": "invalid_token",
    "message": "Invalid or expired access token.",
    "field_errors": None,
}


async def resolve_agent_from_header(ctx: Context) -> AIAgent:
    """Resolve the `Authorization: Bearer tnx_agent_...` header to its `AIAgent` row.

    Raises `ToolError` (FastMCP's `isError=True` primitive, surfaced as
    `{"code": "invalid_token", "message": ..., "field_errors": null}` in
    the tool's error content — ADR-0033 decision 4's envelope-mapping
    contract) on every rejection reason, indistinguishably — same posture
    as the REST 401 path documented in `app/core/rbac.py`.
    """
    raw_auth = _get_auth_header(ctx)
    raw_key = _extract_bearer_token(raw_auth)
    _ensure_agent_key_shape(raw_key)

    async with AsyncSessionLocal() as db:
        try:
            return await _resolve_agent_actor(raw_key, db)
        except HTTPException:
            # `_resolve_agent_actor` raises the shared `_unauthorized()` 401
            # exactly when the REST path would also 401 (no candidate row
            # with matching `key_prefix` + `revoked_at IS NULL`, or every
            # candidate's argon2 verify fails). Translate to ToolError so the
            # MCP client gets the same `isError=True` shape with the same
            # `code` body — caller cannot distinguish the rejection reason
            # from the REST-equivalent path.
            raise ToolError(json.dumps(_INVALID_TOKEN_ERROR)) from None


def _get_auth_header(ctx: Context) -> str | None:
    """Extract the `Authorization` header from the MCP request, if present."""
    # The SDK's authorization examples (e.g. volcengine/mcp-server's
    # `ctx.request_context.request.headers.get("Authorization")`) are the
    # documented shape — `ctx.request_context.request` is the underlying
    # Starlette `Request`, so `.headers` is a normal `Headers` object.
    try:
        request = ctx.request_context.request
    except AttributeError:
        return None
    return request.headers.get("authorization")


def _extract_bearer_token(raw_auth: str | None) -> str:
    """Pull the raw token out of a `Bearer <token>` value; `None`/wrong shape → ToolError."""
    if not raw_auth:
        raise ToolError(json.dumps(_INVALID_TOKEN_ERROR))
    parts = raw_auth.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise ToolError(json.dumps(_INVALID_TOKEN_ERROR))
    return parts[1].strip()


def _ensure_agent_key_shape(raw_key: str) -> None:
    """Branch on key *shape* before handing to `_resolve_agent_actor` — same posture.

    ADR-0015's discriminator: `tnx_agent_` prefix → agent-key path;
    everything else (`Bearer <jwt>`) is a human-JWT path that doesn't
    apply on MCP (the MCP server has no human login surface at all, so a
    human JWT presented to MCP is a malformed/misconfigured caller and
    gets the same generic 401 as a bad agent key). Skip the JWT decode
    attempt entirely — the REST path's discriminator exists to avoid
    paying for failed JWT-decodes on every agent request; on MCP there
    is no other decoding the request could succeed at.
    """
    # Literal `tnx_agent_` prefix — must match `app.core.rbac`'s
    # `_AGENT_KEY_LITERAL_PREFIX` verbatim. If the two drift apart the
    # discriminator silently rejects every caller, so prefer reusing the
    # constant if it's ever exported; for now the duplication is
    # bounded to a single 11-char literal.
    if not raw_key.startswith("tnx_agent_"):
        raise ToolError(json.dumps(_INVALID_TOKEN_ERROR))
