"""Single shared FastMCP instance + lifespan wiring for the MCP-1 surface.

`app/main.py` mounts this module's `mcp` (`mcp.streamable_http_app()`) onto
the FastAPI app under `/mcp`, and stitches `mcp_lifespan` into the FastAPI
app's own startup/shutdown so the SDK's `session_manager.run()` context is
opened/closed in lockstep with the REST routes' lifecycle.

Per ADR-0033:

- `stateless_http=True` and `json_response=True` — no per-session server-side
  state, no SSE streaming. The MCP server is a stateless RPC front-end to
  the same database-backed service layer the REST routes use; every request
  authenticates fresh from the `Authorization` header (decision 3) and
  resolves a fresh `AsyncSession` per call (decision 2's `_dispatch`).
- `name="TestNexa-MCP"` — the value MCP clients see in the `initialize`
  response. No versioning yet; future MCP-* tools add here.
- `streamable_http_app()` is mounted at `/mcp` — single endpoint per MCP
  spec. `nginx/nginx.dev.conf`'s `location /mcp/` proxies it through to
  `backend:8000/mcp/` unchanged (same passthrough convention as `/api/`).
"""

import contextlib

from mcp.server.fastmcp import FastMCP

from app.mcp.tools import entity_tools as _entity_tools

# Single shared instance; ADR-0033 deliberately rejects any per-route or
# per-tool FastMCP instance — the same `name="TestNexa-MCP"` shows up in
# every MCP `initialize` response from this backend, period.
mcp = FastMCP(
    name="TestNexa-MCP",
    stateless_http=True,
    json_response=True,
)

# Default SDK `streamable_http_path` is `/mcp` (per spec). Since we mount
# the resulting ASGI sub-app on FastAPI at `/mcp` (`app.main`'s
# `app.mount("/mcp", _mcp_server.streamable_http_app())`), leaving the
# default would make the full external URL `/mcp/mcp` — an ugly, redundant
# path. Override to `"/"` so the sub-app serves at the mount root instead:
# full URL becomes `/mcp`, matching API Doc §6's contract and nginx's
# `location /mcp/` passthrough.
mcp.settings.streamable_http_path = "/"

# Disable DNS-rebinding protection (SDK default: on, allow-list =
# `localhost:*` etc.). The default allow-list doesn't cover nginx's
# `/mcp/` passthrough case: nginx strips the port from `Host` before
# forwarding (its `$host` is hostname-only), so the backend sees a bare
# `localhost` Host — which the SDK's `localhost:*` wildcard doesn't match
# (wildcard requires a literal `:` separator, not just bare hostname).
# For a self-hosted, single-tenant deployment behind a controlled reverse
# proxy, the Host-validation check buys very little extra protection
# beyond what the proxy's own access controls already provide — the
# bearer-key check (`app/mcp/auth.py`) is the actual auth boundary.
# Turn it off explicitly here rather than carry a fragile allow-list.
mcp.settings.transport_security.enable_dns_rebinding_protection = False


# Eagerly register the tool surface on import. Calling it here means a passing
# import-time check catches "imported the module but forgot to register"
# without a runtime request — cheap, improves diagnostic surface.
#
# ADR-0067: one module, generating one tool per entity per supported action
# (`tn_<resource>_<action>`). It replaces both prior tool modules — ADR-0033's
# `tools/test_cases.py` (MCP-1's 2 hand-wired `create_test_case`/
# `list_test_cases`) and ADR-0065's `tools/generic_crud.py` (MCP-5's 6
# reflective `*_entity`/`*_entities` tools) — whose capabilities are now
# `tn_test_case_create`/`tn_test_case_list` and the full generated set
# respectively. Both files are deleted, not left dormant: leaving either
# registered would publish two differently-named tools for the same
# capability, exactly the duplicate surface ADR-0067 exists to remove.
_entity_tools.register_tools(mcp)


@contextlib.asynccontextmanager
async def mcp_lifespan(_app):
    """FastAPI lifespan bridge — runs the MCP SDK's `session_manager` lifecycle.

    `app.main.py` installs this as `app.router.lifespan_context` so the SDK's
    session manager opens/closes in step with the FastAPI process. Required
    even when `stateless_http=True` — the SDK still allocates its
    session-manager state on startup regardless of transport mode (an SDK
    internal, not a per-session thing), and skipping this context keeps the
    server from handling any request at all.
    """
    async with mcp.session_manager.run():
        yield
