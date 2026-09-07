# First-party MCP server — implementation notes (MCP-1, ADR-0033)

This file is the **forward-looking design summary** for `app/mcp/` — the architectural decisions that aren't obvious from reading the code, captured inline so MCP-2/3 (and any future "thin client over the existing REST surface" feature) don't repeat the discovery cycle. See ADR-0033 for the formal MADR-style decision record; this file is the implementation-side companion.

## Mental model

The MCP server is a **thin transport adapter**, not a parallel API. Every tool's body invokes the corresponding existing REST route handler directly, passing the resolved `AIAgent` actor and a fresh `AsyncSession` in place of FastAPI's `Depends(get_current_actor)` / `Depends(get_db)` defaults (see `backend/CLAUDE.md`'s "`Depends(...)` defaults can be bypassed" note). The route's business logic — NFR-1 boundary check, `has_permission` gate, ORM flush, link-table write, summary materialization — runs unchanged. **This is the architectural contract that gives MCP-1 AC1 ("no separate, weaker code path") its teeth**: any drift between REST and MCP must surface as a code change in either the route or the tool's call shape, not as a parallel validation tree.

## The four pieces (and why each is where it is)

### `app/mcp/server.py` — the `FastMCP` singleton

- `name="TestNexa-MCP"` — surfaces in every MCP `initialize` response. One shared instance per backend process (no per-tool/per-module `FastMCP`).
- `stateless_http=True`, `json_response=True` — no per-session server-side state; every request authenticates fresh from the `Authorization` header (decision 3); JSON responses, not SSE streams.
- `settings.streamable_http_path = "/"` — the SDK defaults to `/mcp` on its internal app; combined with the FastAPI `/mcp` mount, the default produces the ugly `/mcp/mcp` external URL. The override collapses the sub-app to the mount root so the full URL is `/mcp` (matches API Doc §6 + nginx's `location /mcp/` passthrough). **If you change this, also re-check `nginx/nginx.dev.conf`'s `proxy_pass` line** — they have to agree.
- `settings.transport_security.enable_dns_rebinding_protection = False` — the SDK's default allow-list (`["localhost:*", "127.0.0.1:*", "[::1]:*"]`) doesn't match nginx's proxied Host (nginx's `$host` is hostname-only, no port, so `localhost:*`'s `startswith("localhost:")` check fails). Disabling is the right call for self-hosted, single-tenant deployment behind a controlled reverse proxy; the bearer-key check is the actual auth boundary, and the proxy's own access controls cover the rest. **Don't "fix" this back to enabled without addressing the nginx-host-stripping mismatch.**

### `app/mcp/auth.py` — per-tool bearer resolution

- Reads `Authorization` off `ctx.request_context.request.headers` (the SDK's documented `Context` access pattern, same shape every public MCP server example online uses).
- Delegates the agent-row lookup to `app.core.rbac._resolve_agent_actor` — the very same function `get_current_actor`'s agent branch uses on the REST side (AUTH-4/ADR-0015). Reusing it preserves: `key_prefix`-narrowed lookup + argon2 verify per candidate, `revoked_at IS NULL` enforced in the `WHERE` clause (revoked key indistinguishable from never-existed, no-enumeration posture), `last_used_at` write-through on every successful resolution. **Do not reimplement any of these on the MCP side** — even small drift on revocation timing or audit stamping silently breaks the unified-actor guarantee.
- Raises `ToolError` carrying the API Doc §1 `invalid_token` envelope verbatim on every rejection reason (missing header, malformed `Bearer`, non-`tnx_agent_` prefix, unknown/revoked key). The prefix-detection rule: `ToolError` text gets `"Error executing tool <name>: "` prepended by the SDK, so test parsers must slice from the first `{` (see `backend/CLAUDE.md`'s "`ToolError` text gets a prefix" note for the canonical helper).

### `app/mcp/tools/test_cases.py` — tool bodies

- `@mcp.tool()` decorators define the JSON Schema the MCP client sees in `tools/list`. **Field-level types are the source of truth for the wire shape** — keep them aligned with the underlying Pydantic schemas in `app/schemas/assets.py` (Pydantic field types → JSON Schema via the SDK's inference).
- Tool body pattern, in order:
  1. `await resolve_agent_from_header(ctx)` — auth + actor resolution.
  2. Construct the Pydantic request model (`CreateTestCaseRequest`, `UpdateTestCaseRequest`, etc.) from the tool's named parameters.
  3. `async with AsyncSessionLocal() as db: result = await _dispatch(agent, db, handler, kwargs={...})` — own session, explicit `actor`/`db` overrides, `await` because the route handlers are `async def`.
  4. If `result` is a `JSONResponse`, raise `ToolError(json.dumps(payload))` to surface the API Doc §1 envelope (ADR-0033 decision 4). If it's a Pydantic model, `return result.model_dump(mode="json")` for `structuredContent` wire format.
- `_dispatch` is the bypass pattern (see `backend/CLAUDE.md`'s "Depends defaults bypassable" note) — wraps the call with `asyncio.iscoroutine` so the same helper works for any future sync or async handler.

### `app/main.py` — the mount + lifespan

- `app.mount("/mcp", _mcp_server.streamable_http_app())` — single line; no per-route registration, no FastAPI router. The MCP SDK exposes its handler at the mount root (because of the `streamable_http_path="/"` override in `server.py`), so the external URL is `/mcp`.
- `app.router.lifespan_context = mcp_lifespan` — bridges the MCP SDK's `session_manager.run()` into FastAPI's startup/shutdown. Required even with `stateless_http=True` — the SDK still allocates its session-manager state on startup regardless of transport mode.

## Adding a new tool (the MCP-2/3 recipe)

For each new `FR-MCP-N` tool:

1. **Pick the REST route** whose business logic should run (search `app/api/routes/`). Read its handler body end-to-end to confirm it does what you need — the tool is a thin wrapper, not a re-implementation.
2. **Add a `@mcp.tool()` function** in `app/mcp/tools/<resource>.py`. Match the existing `_dispatch` + `_raise_as_tool_error` pattern from `test_cases.py` verbatim.
3. **Reuse `app.mcp.auth.resolve_agent_from_header(ctx)`** — never reimplement bearer resolution.
4. **Wire the tool in `app/mcp/server.py`'s `register_tools(mcp)` call** (or add a new `register_tools` if grouping more than ~3 tools).
5. **Tests** — write all three layers:
   - **Unit** for any pure helpers (e.g. envelope-mapping, key-shape guards) in `tests/unit/test_mcp_*.py`.
   - **Integration** (httpx + JSON-RPC) for the full wire path with the existing `_mcp_initialize` / `_mcp_tools_list` / `_mcp_call_tool` helpers in `tests/integration/test_mcp_*.py`.
   - **E2E** using the MCP SDK's `ClientSession` + `streamable_http_client` (see `tests/integration/test_mcp_e2e_client.py`) — proves the SDK interop path real MCP clients (Claude Code, Cursor) take.

## What you should NOT add (the architectural anti-patterns)

- **No parallel validation in the tool body.** If you find yourself re-deriving `org_id` or re-checking `has_permission` in the tool, you're violating AC1. Pass the resolved actor into the route handler and let the route's own checks fire — that's the whole point.
- **No re-implementing the route's `_error()` shape.** Use `_raise_as_tool_error(JSONResponse)` to surface the route's own error envelope. If you find yourself writing `raise ToolError(json.dumps({"code": "permission_denied", ...}))` directly, you're hand-rolling something the route already produces for free.
- **No per-tool `FastMCP` instance.** One shared instance, registered once. Per-tool/per-module instances are the path to multi-instance surprise when tests import the module twice.
- **No stateful MCP server features** (no in-memory session caches, no SSE streaming response bodies) unless MCP-2/3's own ACs explicitly require them. The stateless + JSON posture is what makes the bearer-key write-through in `_resolve_agent_actor` the only audit-trail source — adding session state would create a second one and silently drift the `last_used_at` semantics.

## Cross-references

- `docs/adr/0033-mcp-server-architecture.md` — the formal MADR.
- `backend/CLAUDE.md` — three notes added in MCP-1's pass: `_actor_membership_exists`, MCP-mount gotchas, FastMCP `ToolError` prefix, `Depends`-bypass pattern, MCP SDK v1.x client API.
- `tests/integration/test_mcp_test_cases.py` — the wire-protocol reference (raw httpx + JSON-RPC).
- `tests/integration/test_mcp_e2e_client.py` — the SDK-interop reference (`ClientSession` + `streamable_http_client`).
