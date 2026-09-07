# ADR-0033: First-party MCP server — streamable-HTTP, direct-call tool dispatch, per-tool bearer resolution

**Date:** 2026-09-06
**Status:** Accepted (MCP-1 ships the direct-link path only — see "Drift" note below; rigor-path twin + MCP-2/MCP-3 backlog)

**Drift (post-MCP-1 ship, 2026-09-06):** The §"Tool → REST route mapping" line says `create_test_case` covers both `POST /requirements/{id}/test-cases` and `POST /test-conditions/{id}/test-cases`. MCP-1 only shipped the direct-link branch (REQ-2 path); the rigor-path branch (REQ-3 path, `create_test_case_for_test_condition`) is queued as WBS §5.2a backlog. The ADR's reasoning stands — both paths reuse the same `test_case.create` permission + `created_by_actor_id` stamping; the dispatch is a one-parameter-shape change in the tool — but the shipped surface is half what the ADR documents. Not silently edited (per root `CLAUDE.md`'s "ADR-vs-implementation drift must surface in the completion report" rule); backlog row carries the gap.
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0002](../api/../adr/0002-backend-framework-orm-migrations.md) (async FastAPI chosen partly for MCP fit), [ADR-0003](../api/../adr/0003-auth-token-strategy.md) (AIAgent API-key bearer scheme), [ADR-0015](../api/../adr/0015-ai-agent-credential-mechanics.md) (auth-4 / the agent-key resolution mechanism MCP inherits), [ADR-0028](../api/../adr/0028-req3-test-condition-rigor-path-bespoke-routes.md) (the bespoke `TestCase` create route MCP-1's `create_test_case` tool wraps), [ADR-0029](../api/../adr/0029-testcase-resolver-direct-link-fallback.md) (the `TestCase` resolver completeness rule MCP-1's create must respect), [User Stories: MCP-1/MCP-2/MCP-3](../user-stories/2026-09-03-ai-agent-mcp-stories.md), [API Document §6](../api/2026-09-03-api-design.md), the generic-CRUD factory [ADR-0022](../api/../adr/0022-generic-crud-router-factory.md), [TC-MCP-001/002/003](../test-cases/2026-09-03-test-cases.md)

## Context

ADR-0002 explicitly chose FastAPI in part because Python's async-first fit makes sharing one service layer between the human-facing REST API and a first-party MCP server straightforward — "no separate runtime" for the agent. [06-ai-mcp-landscape.md](../product-discovery/06-ai-mcp-landscape.md) found no self-hosted competitor ships a first-party MCP server today, so this implementation is the MVP's structural differentiator ([26-mvp.md](../product-discovery/26-mvp.md) scopes the MCP surface to "create/list/update `TestCase`, create `TestExecution`, read `Requirement`"). MCP-1 ([User Stories: MCP-1](../user-stories/2026-09-03-ai-agent-mcp-stories.md)) opens that surface with `create_test_case` and `list_test_cases`, gated on the same `test_case.create`/`.read` permission codes the REST routes already use.

Three design problems fall out of the AC1 phrasing ("no separate, weaker code path for MCP"):

1. **Transport choice.** MCP defines stdio, SSE, and Streamable HTTP. stdio is process-local — every agent process needs its own bundled server binary, blocking SaaS-style MCP clients (Claude Code web, Cursor cloud). SSE is the now-deprecated HTTP transport; Streamable HTTP is its 2025-successor and the modern target.
2. **Where the MCP server runs.** A second `mcp` container with its own process means the agent-key path has to exist twice (once for REST, once for the MCP service's own dedicated host), doubling the auth surface and creating two `last_used_at`/audit event sources for the same AIAgent. The alternative — mount the MCP server as an ASGI sub-app on the existing FastAPI — shares the FastAPI process, the `app/core/rbac.py` `get_current_actor` path, the `AsyncSessionLocal` engine, and the `actor.last_used_at` write-through. ADR-0002's "no separate runtime" argument points the same way.
3. **How to keep the code path the same.** AC1 is explicit: the MCP tool must perform "the same validation and permission check" as the REST endpoint — not "compatible" or "equivalent" validation, the *same*. The temptation to write tool-specific business logic (re-derive `org_id`, re-check `test_case.create`, re-validate `test_condition_id`) is a footgun, since every drift between the two paths would silently weaken one. Any of the four available architectures — re-implemented logic in the tool, helper functions shared between route and tool, full in-process ASGI dispatch over the route, direct call to the route handler bypassing FastAPI's `Depends` machinery — needs to be picked against this single requirement, not against how "clean" the tool module feels on its own.

A fourth, narrower concern also matters: per-request authentication on the MCP side. The MCP tool process receives a JSON-RPC request, not an HTTP request with a `Depends`-injected actor; it must read `Authorization: Bearer tnx_agent_...` from somewhere and resolve it to an `AIAgent` itself, reusing the same `_resolve_agent_actor` path `app/core/rbac.py` (AUTH-4/ADR-0015) already implements for the human-side REST flow.

## Decision

**1. Transport: Streamable HTTP, stateless, JSON response.** The MCP Python SDK (`mcp[cli]<2`, v1.x line — `pip install` of `mcp` now resolves to the v2 SDK which has a different API surface; pinning to v1 here is the deliberate choice and what every existing example online documents) is mounted as an ASGI sub-app on the existing FastAPI:

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP(name="TestNexa-MCP", stateless_http=True, json_response=True)
# ...
app.mount("/mcp", mcp.streamable_http_app())
```

The single external endpoint is `POST /mcp` per MCP spec, proxied via `nginx/nginx.dev.conf`'s `location /mcp/` block (matching the `/api/` passthrough convention). `stateless_http=True` means no per-session server-side state — each request resolves the AIAgent from the `Authorization` header (decision 3), no session manager cookies, no `mcp-session-id` round-trip. `json_response=True` selects the simpler JSON-RPC response shape over SSE; the SDK's own default of SSE is the wrong pick for a single-instance self-hosted deployment that doesn't benefit from long-lived streaming responses (none of the MCP-1/-2/-3 tools are long-running). `app.mount`'s `Mount` route is implicit — the SDK exposes its handler at `/mcp` regardless of where you mount the returned ASGI app, so `app.mount("/mcp", ...)` means tools address as `http://host/mcp/mcp` is wrong — it means the SDK's `/mcp` endpoint lives *under* the mount path: full URL is `http://host/mcp` (mount-path collapses with the SDK's internal default), confirmed by the SDK's own examples.

A custom FastAPI lifespan handler bridges the SDK's `mcp.session_manager.run()` into the existing FastAPI startup/shutdown:

```python
@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    async with mcp.session_manager.run():
        yield

app.router.lifespan_context = lifespan
```

**2. Direct-call tool dispatch, not in-process ASGI, not re-implementation.** Each `@mcp.tool()` body in `app/mcp/tools/test_cases.py` imports the *same* route handler function the REST route uses and calls it directly, supplying the `actor` and `db` arguments explicitly instead of letting FastAPI's `Depends(get_current_actor)` / `Depends(get_db)` machinery resolve them:

```python
from app.api.routes.assets import (
    create_test_case_for_requirement,
    list_test_cases_for_requirement,
)
from app.db.session import AsyncSessionLocal
from app.models.actor import AIAgent

@mcp.tool()
async def create_test_case(
    requirement_id: UUID,
    title: str,
    test_level_id: UUID,
    test_type_id: UUID,
    ctx: Context,
) -> dict:
    agent = await _resolve_agent_from_header(ctx)        # see decision 3
    payload = CreateTestCaseRequest(
        title=title,
        test_level_id=test_level_id,
        test_type_id=test_type_id,
    )
    async with AsyncSessionLocal() as db:
        result = await create_test_case_for_requirement(
            id=requirement_id,
            payload=payload,
            actor=agent,        # bypasses Depends(get_current_actor)
            db=db,              # bypasses Depends(get_db)
        )
    if isinstance(result, JSONResponse):
        _raise_as_tool_error(result)                     # MCP error envelope
    return result.model_dump()                           # MCP structured content
```

Three things this gets right that the alternatives don't:

- **The code path is literally the same function.** The 80-or-so lines of `_org_membership_exists` lookup, `resolve_requirement_org_id` walk, `has_permission("test_case.create")` call, `TestCase` insert flush + `RequirementTestCaseLink` insert flush + commit, `_test_case_summary()` materialization, and `422 validation_error` mapping all run inside `create_test_case_for_requirement`'s body, unchanged, in this exact call. No re-implementation, no shadow copy. AC1's "same validation and permission check" is satisfied by construction, not by parallel maintenance.
- **No ASGI hop in the same process.** In-process dispatch (hit `/api/v1/requirements/{id}/test-cases` over an `httpx.ASGITransport(app)`) would also satisfy AC1 — and is what the SDK's own authorization example implicitly uses — but it pays the cost of pushing the request through FastAPI's full middleware stack (CORS, validation error handlers, request logging) a second time, all of which were designed for the REST surface and add nothing to MCP. Direct call skips them, leaving only the business logic.
- **Bypassing `Depends(get_current_actor)` is mechanical, not semantic.** FastAPI's `Depends` is just a default-value thunk; calling the handler with explicit `actor=`/`db=` arguments replaces the defaults without invoking the dependency body. The dep body itself (`app.core.rbac.get_current_actor`) is reused on the MCP side via decision 3 below, so the actor resolution code path is shared even though the FastAPI dependency wiring isn't.

The handler signatures already accept `actor: User | AIAgent = Depends(...)` and `db: AsyncSession = Depends(...)` — `assets.py` and `test_condition_authoring.py` were written with this exact caller-flexibility in mind (every internal call to `create_test_case_for_requirement` from a test fixture passes `db=` explicitly the same way). MCP-1 is the first production caller to do so for the actor too.

**3. Per-tool bearer-token resolution, reusing `_resolve_agent_actor`.** Every MCP tool that handles a mutating or permission-gated action receives an MCP `Context` (auto-injected by FastMCP) and reads the request's `Authorization` header off `ctx.request_context.request.headers`, exactly the same shape as the SDK's own authorization example uses:

```python
from app.core.rbac import _resolve_agent_actor, _unauthorized
from app.db.session import AsyncSessionLocal

async def _resolve_agent_from_header(ctx: Context) -> AIAgent:
    """Same logic as `get_current_actor`'s agent branch — wraps `_resolve_agent_actor`,
    so a revoked/garbage key produces the identical 401 shape the REST API returns
    for the same input."""
    raw_auth = ctx.request_context.request.headers.get("authorization")
    if not raw_auth or not raw_auth.lower().startswith("bearer "):
        raise ToolError(json.dumps(_INVALID_TOKEN_ERROR))   # surfaced as isError=True
    raw_key = raw_auth.split(" ", 1)[1].strip()
    if not raw_key.startswith("tnx_agent_"):
        raise ToolError(json.dumps(_INVALID_TOKEN_ERROR))   # branch on shape, not on JWT decode
    async with AsyncSessionLocal() as db:
        try:
            return await _resolve_agent_actor(raw_key, db)
        except HTTPException:                              # _resolve_agent_actor's 401 raise
            raise ToolError(json.dumps(_INVALID_TOKEN_ERROR)) from None
```

The `_resolve_agent_actor` reuse (rather than re-implementing argon2 verify + `key_prefix` lookup) is non-negotiable: AUTH-4/ADR-0015's specific reason for using `key_prefix` as a lookup index (salt-non-deterministic argon2 hashing can't be searched by equality, requires prefix-narrowed scan) and `revoked_at IS NULL` in the `WHERE` clause (revoked key indistinguishable from never-existed) must be preserved on the MCP path exactly — implementing it a second way in MCP would silently introduce drift on revocation timing, audit (`last_used_at`) stamping, and the no-enumeration posture (the 401 is the generic `invalid_token` shape, not an "agent revoked" specific error). Sharing the function means sharing those guarantees.

**4. Tool errors map to MCP `isError=True` with the API Doc §1 envelope.** REST errors return `JSONResponse({"code", "message", "field_errors"})`; MCP has no equivalent primitive, so the tool function catches the `JSONResponse` and re-raises it as a FastMCP `ToolError(json.dumps(content))`:

```python
def _raise_as_tool_error(response: JSONResponse):
    payload = json.loads(response.body)   # {"code", "message", "field_errors"}
    raise ToolError(json.dumps(payload))
```

Field-level validation errors land in the MCP tool's `error` content as `{"code": "validation_error", "message": "...", "field_errors": {"title": [...]}}` — the same exact shape a human caller sees via `POST /api/v1/requirements/{id}/test-cases`, so an MCP client can pattern-match on `code`/`field_errors` the same way the frontend's RHF/Zod layer does today. No divergent error contract.

**5. Pydantic-typed tool parameters, not raw `dict[str, Any]`.** Each `@mcp.tool()` declares its arguments with concrete type annotations (`requirement_id: UUID`, `title: str`, ...) so the SDK auto-derives the JSON Schema the MCP client uses to discover what to send. The Pydantic models (`CreateTestCaseRequest`) used by the REST routes live in `app/schemas/assets.py`; the MCP side rebuilds them at the call site rather than accepting them as a single `dict` arg, because FastMCP's `@tool()` infers field-level JSON Schema from individual function parameters, not from `**kwargs`. The body shape is identical field-for-field (`title`, `test_level_id`, `test_type_id`, `preconditions`, `expected_result`, `status`) — AC3's "same shape/fields as the REST API's TestCase schema" is satisfied by reusing the same `CreateTestCaseRequest` schema object the route body uses.

## Consequences

**Positive.** AC1–AC3 each map to a concrete, mechanical implementation: AC1 (same path) → direct-call dispatch; AC2 (correct attribution) → caller is the resolved `AIAgent`, and `_resolve_agent_actor`'s `last_used_at` write-through is the same audit event REST sees; AC3 (schema parity) → reuse of `CreateTestCaseRequest`/`TestCaseSummary`/`TestCaseListResponse`. The four existing test cases for this story (`TC-MCP-001/002/003`, plus the implicit cross-project 403 from MCP-1 AC1's "same permission check" wording) become mechanical `httpx` tests against the live FastAPI/`/mcp` endpoint — same harness as every other integration test in `tests/integration/`, no special casing. A second MCP-aware surface (MCP-2 update / MCP-3 execution+requirement) is one additional file pair (`tools/test_cases.py` → `tools/more.py`) and 4 lines of `@mcp.tool()` per route, not a parallel implementation.

**Negative / Trade-offs.** Direct-call dispatch bypasses FastAPI's middleware stack — request-level logging, CORS, and the global `RequestValidationError` handler (`app/main.py`) don't see MCP-originated requests. For MCP-1 this is fine (the SDK's own per-request logging is the equivalent; CORS is meaningless on a non-browser client; the validation error handler would be re-triggered inside the SDK anyway), but any future cross-cutting middleware added to the FastAPI app must either accept "doesn't apply to MCP" as a known limitation or grow its own mirror in the MCP layer. The same applies to the inverse: any per-request validation added to MCP tools (auth tier checks, rate limiting) is invisible to the REST surface — the two layers must each carry their own per-concern code, not share a single decorator. `app/mcp/auth.py`'s reuse of `app/core/rbac.py` is the structural mitigation: anything tenant- or actor-shaped lives there, not in MCP-only modules. Tool input bodies are Pydantic-rebuilt at the call site rather than passed through verbatim, because the SDK's `@tool()` decorator derives JSON Schema from individual parameter annotations — a `payload: CreateTestCaseRequest` argument would collapse into one opaque `object` parameter the MCP client couldn't usefully fill. The price is two parallel constructions (route's `payload: CreateTestCaseRequest = Body(...)` and tool's `field-by-field, build-CreateTestCaseRequest-at-call-site`), but the *shape* on the wire (the JSON Schema / request body) is identical.

## Alternatives considered

- **Separate `mcp` container with its own process** — rejected: doubles the auth surface (agent-key resolution runs twice, `last_used_at` updates from two sources), is the opposite of ADR-0002's "no separate runtime" reasoning, and breaks the "same actor resolution code path" property AC1 implicitly assumes.
- **`stdio` transport** — rejected: every agent process needs its own bundled MCP server, blocking SaaS-style MCP clients (Claude Code web, Cursor cloud). Persona 3's agents run as a service-on-behalf-of-human; stdio is the wrong shape. Reconsidered as a future *secondary* transport for local-dev CLI tooling, not for the primary server.
- **SSE transport** — rejected: deprecated as of MCP 2025-06-03, replaced by Streamable HTTP. No new production deployment should pick the deprecated path.
- **In-process ASGI dispatch over the REST route** (`httpx.AsyncClient(transport=ASGITransport(app))` from inside the tool) — rejected: satisfies AC1 by going through the full middleware stack, but pays for middleware that was designed for the REST surface and adds an inner HTTP layer that contributes no value to MCP. Direct call is cheaper and gives the same code-path guarantee, since `Depends` defaults are bypassed mechanically, not by accident.
- **Re-implement tool business logic against `app.models`/`app.core.rbac` directly** — rejected: AC1's explicit wording leaves no room for parallel implementations; any drift between the two paths would silently weaken one. Sharing the route function body is the only structural mitigation.

## Implementation sketch (locking the decision)

```
backend/
  app/
    mcp/
      __init__.py            # empty marker
      server.py              # FastMCP(name="TestNexa-MCP", stateless_http=True, json_response=True) instance + tool registration
      auth.py                # _resolve_agent_from_header(ctx) helper, reusing _resolve_agent_actor
      tools/
        __init__.py
        test_cases.py        # @mcp.tool() create_test_case, list_test_cases — direct-call dispatch
  main.py                    # app.mount("/mcp", mcp.streamable_http_app()) + lifespan wiring
  pyproject.toml             # add  "mcp[cli]>=1.28,<2"
nginx/
  nginx.dev.conf             # location /mcp/ passthrough to backend:8000/mcp/
  nginx.prod.conf            # same
backend/tests/integration/
  test_mcp_test_cases.py     # TC-MCP-001/002/003 + cross-project 403 (MCP-1 AC1's "same permission check")
docs/
  adr/0033-mcp-server-architecture.md   # this file
  api/2026-09-03-api-design.md §6       # add concrete mount path + URL
```
