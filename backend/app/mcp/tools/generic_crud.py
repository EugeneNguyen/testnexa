"""MCP-5: `list_entities`/`get_entity`/`create_entity`/`update_entity`/
`delete_entity`/`describe_entity` (FR-MCP-5, ADR-0065).

Six reflective tools replacing ADR-0033's originally-planned one-hand-wired-
tool-per-route shape (MCP-2/MCP-3's own never-built `update_test_case`/
`create_test_execution`/`read_requirement`) — every entity's list/get/
create/update/delete is reachable through these 5 verbs plus `describe_entity`
(self-discovery of an entity's own required fields), dispatched via
`app/mcp/tool_registry.py`'s single registry rather than a per-route tool
function. Same "no separate, weaker code path for MCP" posture MCP-1
established (ADR-0033 decision 2) — every executor in the registry is a
direct call onto the *same* handler function the REST route dispatches to
(either introspected off a throwaway `make_crud_router(config)`, or a named
bespoke route function imported directly), never a reimplementation.

`resource` is the plural, hyphenated API-slug key (`"requirements"`,
`"test-cases"`, ...) — the same key `GET /entities/{resource}/schema`
already uses, so a client that just called `describe_entity` to learn a
shape reuses that exact string for the mutating call.
"""

import json
from typing import Any
from uuid import UUID

from fastapi import Response
from fastapi.responses import JSONResponse
from mcp.server.fastmcp import Context
from mcp.server.fastmcp.exceptions import ToolError
from pydantic import ValidationError

from app.api.crud_factory import derive_entity_schema
from app.api.entity_registry import ALL_ENTITY_CONFIGS
from app.db.session import AsyncSessionLocal
from app.mcp.auth import resolve_agent_from_header
from app.mcp.tool_registry import TOOL_REGISTRY, unknown_entity_response, unsupported_method_response


def _raise_as_tool_error(response: JSONResponse) -> None:
    """Same translation `app/mcp/tools/test_cases.py` already established
    (ADR-0033 decision 4) — the API Document §1 `{code, message,
    field_errors}` envelope, serialized verbatim into FastMCP's `ToolError`
    text, so an MCP client's `code`/`field_errors` pattern-match works
    identically to a REST caller's."""
    payload = json.loads(response.body)
    raise ToolError(json.dumps(payload))


def _materialize(result: Any) -> dict[str, Any]:
    """Normalize every shape a registry executor can return into the plain
    dict an MCP tool hands back on success.

    Three shapes exist across this codebase's route handlers (not a defect
    to fix here — pre-existing, verified against each handler's own return
    type before writing this): a Pydantic model (`get_item`/`create_item`/
    `create_project`/...), a `JSONResponse` used for *both* errors (4xx/5xx)
    *and* some bespoke routes' own success body (`add_test_case_to_suite`/
    `include_suite_in_plan`'s `201` — no Pydantic model, per FR-REQ-4/PLAN-1),
    and a plain no-content `Response` (`delete_item`'s `204`). Distinguish
    error-vs-success `JSONResponse` by status code, not type alone.
    """
    if isinstance(result, JSONResponse):
        if result.status_code >= 400:
            _raise_as_tool_error(result)
        return json.loads(result.body)
    if isinstance(result, Response):
        return {"status": "deleted"}
    return result.model_dump(mode="json")


def _validation_error_response(exc: ValidationError) -> JSONResponse:
    """A `create_entity`/`update_entity` `fields` dict that fails the
    entity's own `create_schema`/`update_schema` (missing required field,
    malformed `UUID`, bad enum value, ...) raises a raw `pydantic.
    ValidationError` — MCP tools build these schemas from an untyped `fields:
    dict[str, Any]` themselves, so FastAPI's own `RequestValidationError`
    handler (`app/main.py`) never sees it (it only ever fires during
    FastAPI's own request-body parsing, which this call never goes through).
    Mirrors that handler's exact `loc`-based `field_errors` extraction so the
    envelope is identical either way."""
    field_errors: dict[str, list[str]] = {}
    for error in exc.errors():
        loc = error.get("loc", ())
        field = str(loc[-1]) if loc else "__root__"
        field_errors.setdefault(field, []).append(error.get("msg", "Invalid value."))
    return JSONResponse(status_code=422, content={"code": "validation_error", "message": "Request failed validation.", "field_errors": field_errors})


async def _run(executor: Any, /, **kwargs: Any) -> Any:
    """Invoke a registry executor, converting a `fields`-construction
    `pydantic.ValidationError` into the same `422` envelope shape REST
    callers get (see `_validation_error_response`) — every other error
    shape an executor can produce is already a `JSONResponse`/`Response`/
    Pydantic model, handled uniformly by `_materialize`."""
    try:
        return await executor(**kwargs)
    except ValidationError as exc:
        return _validation_error_response(exc)


def _lookup(resource: str, action: str) -> Any:
    entry = TOOL_REGISTRY.get(resource)
    if entry is None:
        _raise_as_tool_error(unknown_entity_response(resource))
    executor = entry.get(action)
    if executor is None:
        _raise_as_tool_error(unsupported_method_response())
    return executor


def register_tools(mcp) -> None:
    """Register the 6 MCP-5 tools against the shared FastMCP instance —
    same single-registration-function shape `app/mcp/tools/test_cases.py`
    (MCP-1) already established."""

    @mcp.tool()
    async def list_entities(
        resource: str,
        scope: dict[str, str] | None = None,
        filters: dict[str, str] | None = None,
        search: str | None = None,
        sort: str | None = None,
        page: int = 1,
        page_size: int = 25,
        ctx: Context = None,  # type: ignore[assignment]
    ) -> dict[str, Any]:
        """List rows of `resource` (the plural, hyphenated slug — `"requirements"`,
        `"test-cases"`, ...). `scope` supplies the entity's own required scope
        field(s) (e.g. `{"project_id": "..."}`) exactly as the REST list route's
        own query param does — omitted/ambiguous on a scoped entity is the same
        `422` REST gives. `filters`/`search`(`?q=`)/`sort` mirror the REST
        route's own query params verbatim. Rejected with the REST-equivalent
        error shape if `resource` doesn't register a `list` route at all.
        """
        agent = await resolve_agent_from_header(ctx)
        executor = _lookup(resource, "list")
        async with AsyncSessionLocal() as db:
            result = await _run(
                executor, actor=agent, db=db, scope=scope, filters=filters, search=search, sort=sort, page=page, page_size=page_size
            )
        return _materialize(result)

    @mcp.tool()
    async def get_entity(resource: str, id: UUID, ctx: Context = None) -> dict[str, Any]:  # type: ignore[assignment]
        """Fetch one `resource` row by `id` — same validation/permission/tenant-
        boundary check the REST `GET /{resource}/{id}` route performs."""
        agent = await resolve_agent_from_header(ctx)
        executor = _lookup(resource, "get")
        async with AsyncSessionLocal() as db:
            result = await _run(executor, actor=agent, db=db, item_id=id)
        return _materialize(result)

    @mcp.tool()
    async def create_entity(resource: str, fields: dict[str, Any], ctx: Context = None) -> dict[str, Any]:  # type: ignore[assignment]
        """Create a `resource` row. `fields` matches the entity's own create
        payload (call `describe_entity` first to learn required fields) —
        for the entities whose real create path is bespoke rather than
        generic-factory-registered (`test-cases`, `test-conditions`,
        `test-executions`, `defects`, `test-logs`, `projects`, `organizations`,
        `org-memberships`, `role-assignments`, `releases`, the 2 join-table
        "add" resources), `fields` additionally carries whichever parent id(s)
        that bespoke route takes as a path parameter on REST (e.g.
        `requirement_id` for `test-cases`) — same business-rule rejections
        (PLAN-3 scope check, cross-project rejection, etc.) apply either way.
        Rejected with the REST-equivalent error shape if `resource` has no
        `create` path at all (generic or bespoke).
        """
        agent = await resolve_agent_from_header(ctx)
        executor = _lookup(resource, "create")
        async with AsyncSessionLocal() as db:
            result = await _run(executor, actor=agent, db=db, fields=fields)
        return _materialize(result)

    @mcp.tool()
    async def update_entity(resource: str, id: UUID, fields: dict[str, Any], ctx: Context = None) -> dict[str, Any]:  # type: ignore[assignment]
        """Partially update one `resource` row — same validation/permission/
        tenant-boundary check (and, where configured, the same business-rule
        `update_guard`/`post_update_hook`) the REST `PATCH` route performs."""
        agent = await resolve_agent_from_header(ctx)
        executor = _lookup(resource, "update")
        async with AsyncSessionLocal() as db:
            result = await _run(executor, actor=agent, db=db, item_id=id, fields=fields)
        return _materialize(result)

    @mcp.tool()
    async def delete_entity(resource: str, id: UUID, ctx: Context = None) -> dict[str, Any]:  # type: ignore[assignment]
        """Delete one `resource` row — same validation/permission/tenant-
        boundary check the REST `DELETE` route performs, including the same
        `409 restrict_blocked` for a row still referenced by a RESTRICT FK."""
        agent = await resolve_agent_from_header(ctx)
        executor = _lookup(resource, "delete")
        async with AsyncSessionLocal() as db:
            result = await _run(executor, actor=agent, db=db, item_id=id)
        return _materialize(result)

    @mcp.tool()
    async def describe_entity(resource: str, ctx: Context = None) -> dict[str, Any]:  # type: ignore[assignment]
        """Return `resource`'s own field shape — the identical body
        `GET /entities/{resource}/schema` (ADR-0055) returns, not a second,
        drifted description of the same config. An unregistered `resource`
        (including `"releases"`, which has no `CrudEntityConfig` at all)
        gets the same `404 not_found` shape that REST route gives.
        """
        await resolve_agent_from_header(ctx)
        config = ALL_ENTITY_CONFIGS.get(resource)
        if config is None:
            _raise_as_tool_error(unknown_entity_response(resource))
        return derive_entity_schema(config)
