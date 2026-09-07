"""MCP-1: `create_test_case` and `list_test_cases` tools (FR-MCP-1, ADR-0033).

Both tools dispatch by *direct call* into the existing bespoke route
handlers (`app.api.routes.assets.create_test_case_for_requirement` and
`...list_test_cases_for_requirement`), passing the resolved `AIAgent` and an
owned `AsyncSession` directly into the handler's parameters — bypassing the
handlers' default `Depends(get_current_actor)` / `Depends(get_db)` values
without invoking the dependency bodies themselves. See `app/mcp/server.py`'s
module docstring (and ADR-0033 decision 2) for the full rationale; the
short version is "AC1 says same path, this satisfies same path
mechanically — the handlers' bodies run unchanged, and the actor resolution
reuses `_resolve_agent_actor` via `app/mcp/auth.py`."

Tool → REST route mapping (verbatim per ADR-0033/API Doc §6):

- `create_test_case` → `POST /requirements/{id}/test-cases`
  (also `POST /test-conditions/{id}/test-cases` for REQ-3's rigor path —
  same `test_case.create` permission code, same `created_by_actor_id`
  stamping; both implemented in this single tool, dispatched on a
  non-null `test_condition_id` field).
- `list_test_cases` → `GET /requirements/{id}/test-cases`.

`test_condition_id` is intentionally absent from `create_test_case`'s
declared arguments — REQ-2's direct-link path is the only one MCP-1 needs
to ship; the rigor-path twin is a future story/MCP-2's follow-up (the
existing bespoke route already supports it; only this tool's arg surface
narrows to a single path per scope discipline).
"""

import json
from typing import Any
from uuid import UUID

from fastapi.responses import JSONResponse
from mcp.server.fastmcp import Context
from mcp.server.fastmcp.exceptions import ToolError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.assets import (
    create_test_case_for_requirement,
    list_test_cases_for_requirement,
)
from app.db.session import AsyncSessionLocal
from app.mcp.auth import resolve_agent_from_header
from app.models.actor import AIAgent
from app.schemas.assets import (
    CreateTestCaseRequest,
    TestCaseStatus,
)


def _raise_as_tool_error(response: JSONResponse) -> None:
    """Translate a REST `JSONResponse` (API Doc §1 error envelope) to MCP `ToolError`.

    ADR-0033 decision 4: the MCP-side error body must be the same
    `{code, message, field_errors}` shape a human caller sees via REST,
    so an MCP client pattern-matching on `code` doesn't need a separate
    branch. The SDK's `ToolError` exception path surfaces the message as
    `isError=True` text content; we serialize it to a JSON-encoded string
    so the structured envelope round-trips intact.
    """
    payload = json.loads(response.body)
    raise ToolError(json.dumps(payload))


async def _dispatch(
    agent: AIAgent,
    db: AsyncSession,
    handler: Any,
    *,
    kwargs: dict[str, Any],
) -> Any:
    """Invoke a route handler with explicit `actor=`/`db=` overrides.

    FastAPI's `Depends(get_current_actor)` is just a default-value thunk
    on the handler's signature — calling the handler with explicit
    `actor=`/`db=` arguments bypasses the dependency body without
    invoking it. The handler's actual business logic (org-resolution
    walk, permission check, ORM flush, link-table write, summary
    materialization) runs unchanged.

    Awaits the handler's return value uniformly — `assets.py`'s create
    and list handlers are both `async def`, so the un-awaited call would
    return a coroutine object (and the SDK's structured-content serializer
    would then crash on `'coroutine' has no .model_dump'`).
    """
    import asyncio

    raw = handler(actor=agent, db=db, **kwargs)
    return await raw if asyncio.iscoroutine(raw) else raw


def register_tools(mcp) -> None:
    """Register the MCP-1 tools against the shared FastMCP instance.

    The `async def` tool functions are defined inline below so the
    `@mcp.tool()` decorator calls happen inside this single registration
    function — one call site, easy to see which tools are wired.
    FastMCP's `@tool()` accepts both sync and async callables (the SDK
    handles the coroutine vs. return-value distinction internally), so
    `register_tools` itself is sync and can be called at app import time.
    """

    @mcp.tool()
    async def create_test_case(
        requirement_id: UUID,
        title: str,
        test_level_id: UUID,
        test_type_id: UUID,
        preconditions: str | None = None,
        expected_result: str | None = None,
        status: TestCaseStatus = "draft",
        ctx: Context = None,  # type: ignore[assignment]
    ) -> dict[str, Any]:
        """Create a `TestCase` directly linked to a `Requirement` via `RequirementTestCaseLink`.

        Permission: `test_case.create`. Attribution: `created_by_actor_id` is stamped
        from the calling `AIAgent` (per REST route's `_ACTOR_STAMPED_FIELDS` posture);
        `acting_on_behalf_of_user_id` on the AIAgent remains the human accountable
        for the agent's actions (MCP-1 AC2).

        The response shape matches `TestCaseSummary` verbatim (MCP-1 AC3 — no
        divergent contract between REST and MCP). Field-level validation errors
        surface as `{"code": "validation_error", "message": "...",
        "field_errors": {"<field>": [...]}}` via the ToolError envelope.
        """
        agent = await resolve_agent_from_header(ctx)
        payload = CreateTestCaseRequest(
            title=title,
            test_level_id=test_level_id,
            test_type_id=test_type_id,
            preconditions=preconditions,
            expected_result=expected_result,
            status=status,
        )

        async with AsyncSessionLocal() as db:
            result = await _dispatch(
                agent,
                db,
                create_test_case_for_requirement,
                kwargs={"id": requirement_id, "payload": payload},
            )

        if isinstance(result, JSONResponse):
            _raise_as_tool_error(result)
        return result.model_dump(mode="json")

    @mcp.tool()
    async def list_test_cases(
        requirement_id: UUID,
        page: int = 1,
        page_size: int = 25,
        ctx: Context = None,  # type: ignore[assignment]
    ) -> dict[str, Any]:
        """List `TestCase`s directly linked to a `Requirement` via `RequirementTestCaseLink`.

        Permission: `test_case.read`. Paginated with `page`/`page_size` (matches the
        REST route's own pagination verbatim — MCP-1 AC3 schema parity, including
        the `{items, total, page, page_size}` envelope shape).
        """
        agent = await resolve_agent_from_header(ctx)

        async with AsyncSessionLocal() as db:
            result = await _dispatch(
                agent,
                db,
                list_test_cases_for_requirement,
                kwargs={"id": requirement_id, "page": page, "page_size": page_size},
            )

        if isinstance(result, JSONResponse):
            _raise_as_tool_error(result)
        return result.model_dump(mode="json")
